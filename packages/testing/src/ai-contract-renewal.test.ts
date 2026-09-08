import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TransferMarketRepository, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, initializeClubEconomyForSave, simulateTransferWindow } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * AI clubs — not just the human-controlled one — must renew or release their
 * own expiring contracts through the ordinary season loop, with no player
 * action involved. `simulateTransferWindow` (called every transfer window
 * from career-world.ts's season processing) already applies
 * `shouldRenew`/`renewContract`/`releasePlayer` across every active club's
 * expiring contracts, not just the human's — this proves that end to end for
 * a club the player never manages.
 */

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("AI clubs process contract expiries through the ordinary season loop", () => {
  it("renews or releases an AI club's expiring contract without any human involvement", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-contract-renewal-"));
    dirs.push(dir);
    const path = join(dir, "career.sqlite");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "ai-contract-renewal",
      gameVersion: "test",
      randomSeed: "ai-contract-renewal",
    });
    const db: GameDatabase = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "ai-contract-renewal" });
    const market = new TransferMarketRepository(db);

    // Pick a real club with a real senior contract and force it to expire
    // inside the window this call will process — the club is never touched
    // by any manager-context command in this test.
    const contract = db
      .prepare(
        `SELECT pc.id AS id, pc.player_id AS playerId, pc.club_id AS clubId
         FROM player_contracts pc
         JOIN teams t ON t.club_id = pc.club_id AND t.level = 'senior'
         WHERE pc.status = 'ACTIVE'
         ORDER BY pc.id LIMIT 1`,
      )
      .get() as { id: EntityId; playerId: EntityId; clubId: EntityId };
    db.prepare("UPDATE player_contracts SET end_date = ? WHERE id = ?").run(
      "2026-08-20",
      contract.id,
    );

    const report = simulateTransferWindow({ db, worldDate: "2026-08-15", seed: "ai-contract-renewal" });
    expect(report.renewals + report.releases).toBeGreaterThan(0);

    const original = market.allPlayerContracts().find((item) => item.id === contract.id);
    expect(original?.status).not.toBe("ACTIVE");

    // Whichever way it resolved, the player is not simply stuck on a lapsed
    // contract with no consequence: either a fresh ACTIVE renewal exists, or
    // they were genuinely released (contract terminated, no club tie left).
    const newContract = market
      .allPlayerContracts()
      .find((item) => item.playerId === contract.playerId && item.status === "ACTIVE");
    const history = market
      .transferHistory()
      .filter(
        (event) =>
          event.playerId === contract.playerId &&
          ["CONTRACT_RENEWED", "PLAYER_RELEASED"].includes(event.eventType),
      );
    expect(history.length).toBeGreaterThan(0);
    if (newContract) {
      expect(newContract.clubId).toBe(contract.clubId);
      expect(newContract.endDate > "2026-08-20").toBe(true);
    }
    db.close();
  });
});
