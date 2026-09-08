import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, initializeClubEconomyForSave, runClubAiSeasonPlanning } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * AI clubs must be able to develop their own facilities over time, not sit
 * permanently static — `runClubAiSeasonPlanning` already starts an
 * INFRASTRUCTURE_FIRST-identity club's training-ground project through the
 * canonical `createInfrastructureProject` engine once it can plausibly
 * afford it, but this had no dedicated test proving the AI path (as opposed
 * to the human chairman command) actually persists a project.
 */

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("AI clubs develop facilities through the canonical project engine", () => {
  it("starts a real infrastructure project for a well-capitalised club with no project in progress", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-facility-"));
    dirs.push(dir);
    const path = join(dir, "career.sqlite");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "ai-facility",
      gameVersion: "test",
      randomSeed: "ai-facility",
    });
    const db: GameDatabase = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "ai-facility" });
    const economy = new ClubEconomyRepository(db);

    // Context-only external clubs are deliberately excluded from Nepal AI
    // planning (see runClubAiSeasonPlanning) — pick a real, in-scope club.
    const club = db
      .prepare(
        `SELECT c.id FROM clubs c
         WHERE NOT EXISTS (
           SELECT 1 FROM external_club_context ecc
           WHERE ecc.club_id = c.id AND ecc.simulation_depth = 'CONTEXT_ONLY'
         )
         ORDER BY c.id LIMIT 1`,
      )
      .get() as { id: EntityId };
    // Give the club real, affordable cash and an infrastructure-leaning
    // board policy — the same conditions a real well-run club would have —
    // rather than inventing a shortcut around the canonical gate.
    const account = economy.financialAccount(club.id)!;
    economy.upsertFinancialAccount({ ...account, cashBalance: 20_000_000, financialHealth: "STABLE" });
    // Identity is derived each planning cycle from the board policy itself
    // (see candidateIdentity) rather than stored directly — a high
    // infrastructurePriority is what actually yields INFRASTRUCTURE_FIRST.
    const policy = economy.boardPolicy(club.id);
    if (policy) economy.upsertBoardPolicy({ ...policy, infrastructurePriority: 0.9 });

    const before = economy.infrastructureProjects(club.id);
    expect(before).toHaveLength(0);

    const decisions = runClubAiSeasonPlanning(db, { date: "2026-08-28", seed: "ai-facility-run" });
    expect(decisions.length).toBeGreaterThan(0);

    const after = economy.infrastructureProjects(club.id);
    expect(after.length).toBeGreaterThan(0);
    const project = after[0]!;
    expect(project.clubId).toBe(club.id);
    expect(project.capitalCost).toBeGreaterThan(0);
    // Nepal-scale: bounded well under a European academy build-out.
    expect(project.capitalCost).toBeLessThan(60_000_000);
    expect(project.provenanceStatus).toBe("SIMULATION_ONLY");

    // A second planning pass on the same club must not start a duplicate
    // project while one is already in progress.
    runClubAiSeasonPlanning(db, { date: "2026-08-28", seed: "ai-facility-run" });
    expect(economy.infrastructureProjects(club.id)).toHaveLength(after.length);
    db.close();
  });

  it("never starts a project the club cannot plausibly afford", () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-facility-poor-"));
    dirs.push(dir);
    const path = join(dir, "career.sqlite");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "ai-facility-poor",
      gameVersion: "test",
      randomSeed: "ai-facility-poor",
    });
    const db: GameDatabase = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "ai-facility-poor" });
    const economy = new ClubEconomyRepository(db);
    const club = db
      .prepare(
        `SELECT c.id FROM clubs c
         WHERE NOT EXISTS (
           SELECT 1 FROM external_club_context ecc
           WHERE ecc.club_id = c.id AND ecc.simulation_depth = 'CONTEXT_ONLY'
         )
         ORDER BY c.id LIMIT 1`,
      )
      .get() as { id: EntityId };
    const account = economy.financialAccount(club.id)!;
    economy.upsertFinancialAccount({ ...account, cashBalance: 100_000, financialHealth: "DISTRESSED" });

    runClubAiSeasonPlanning(db, { date: "2026-08-28", seed: "ai-facility-poor-run" });
    expect(economy.infrastructureProjects(club.id)).toHaveLength(0);
    db.close();
  });
});
