import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TransferMarketRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { createNepalSave, initializeTransferMarketForSave } from "@nepal-football-sim/simulation";

/*
 * The starting market invariant is not "every imported player has a contract"
 * and not a magic total: it is that every player whose factual current club
 * resolves to a canonical club holds exactly one active contract, and that
 * nobody holds two.
 *
 * This broke because world creation now generates lower-league squads before
 * the market is initialized, and those carry youth contracts. The market's
 * "any contract exists" guard tripped on them and returned before a single
 * imported player was contracted.
 */

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const createSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-transfer-integrity-"));
  tempDirs.push(dir);
  const databasePath = join(dir, "market.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Starting market ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  return databasePath;
};

const initialize = (databasePath: string, seed: string): void => {
  const db = openGameDatabase(databasePath);
  try {
    initializeTransferMarketForSave({ db, worldDate: "2026-08-01", seed });
  } finally {
    db.close();
  }
};

const scalar = (databasePath: string, sql: string): number => {
  const db = openGameDatabase(databasePath);
  try {
    return Number((db.prepare(sql).get() as { n?: number } | undefined)?.n ?? 0);
  } finally {
    db.close();
  }
};

/*
 * The market manages simulated players — those carrying attributes. The global
 * dataset also contributes context-only factual identities with no attributes,
 * which are reference records rather than squad members, so the invariant is
 * scoped to what the market actually manages.
 */
const PLAYERS_WITH_RESOLVABLE_CLUB = `
  SELECT COUNT(*) n FROM player_factual_profiles pfp
  JOIN player_attributes pa ON pa.person_id = pfp.player_id
  JOIN clubs c ON c.id = pfp.current_club_id`;

const RESOLVABLE_PLAYERS_WITHOUT_CONTRACT = `
  SELECT COUNT(*) n FROM player_factual_profiles pfp
  JOIN player_attributes pa ON pa.person_id = pfp.player_id
  JOIN clubs c ON c.id = pfp.current_club_id
  WHERE NOT EXISTS (
    SELECT 1 FROM player_contracts pc
    WHERE pc.player_id = pfp.player_id AND pc.status = 'ACTIVE')`;


const PLAYERS_WITH_MULTIPLE_ACTIVE_CONTRACTS = `
  SELECT COUNT(*) n FROM (
    SELECT player_id FROM player_contracts WHERE status = 'ACTIVE'
    GROUP BY player_id HAVING COUNT(*) > 1)`;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("starting transfer market integrity", () => {
  it("contracts every player whose factual current club resolves, and only once", () => {
    const databasePath = createSave("invariant");

    // World creation alone leaves the imported squad uncontracted; the market
    // initializer is what must close that gap.
    const resolvable = scalar(databasePath, PLAYERS_WITH_RESOLVABLE_CLUB);
    expect(resolvable).toBeGreaterThan(0);

    initialize(databasePath, "invariant");

    expect(scalar(databasePath, RESOLVABLE_PLAYERS_WITHOUT_CONTRACT)).toBe(0);
    expect(scalar(databasePath, PLAYERS_WITH_MULTIPLE_ACTIVE_CONTRACTS)).toBe(0);
    // Every contract points at a real club and a real person.
    expect(
      scalar(
        databasePath,
        `SELECT COUNT(*) n FROM player_contracts pc
         LEFT JOIN clubs c ON c.id = pc.club_id
         LEFT JOIN persons p ON p.id = pc.player_id
         WHERE c.id IS NULL OR p.id IS NULL`,
      ),
    ).toBe(0);
  }, 300000);

  it("does not re-contract players generated during world creation", () => {
    const databasePath = createSave("generated");

    // Lower-league bootstrap contracts its generated players before the market
    // is initialized. Those agreements must survive untouched.
    const generatedBefore = scalar(
      databasePath,
      `SELECT COUNT(*) n FROM player_contracts pc
       JOIN generated_player_origins gpo ON gpo.player_id = pc.player_id
       WHERE pc.status = 'ACTIVE'`,
    );
    expect(generatedBefore).toBeGreaterThan(0);

    initialize(databasePath, "generated");

    const generatedAfter = scalar(
      databasePath,
      `SELECT COUNT(*) n FROM player_contracts pc
       JOIN generated_player_origins gpo ON gpo.player_id = pc.player_id
       WHERE pc.status = 'ACTIVE'`,
    );
    expect(generatedAfter).toBe(generatedBefore);
    expect(scalar(databasePath, PLAYERS_WITH_MULTIPLE_ACTIVE_CONTRACTS)).toBe(0);
  }, 300000);

  it("is idempotent across repeated initialization and reload", () => {
    const databasePath = createSave("idempotent");
    initialize(databasePath, "idempotent");

    const snapshot = () => ({
      contracts: scalar(databasePath, "SELECT COUNT(*) n FROM player_contracts"),
      windows: scalar(databasePath, "SELECT COUNT(*) n FROM transfer_windows"),
      statuses: scalar(databasePath, "SELECT COUNT(*) n FROM player_transfer_statuses"),
    });
    const first = snapshot();
    expect(first.contracts).toBeGreaterThan(0);
    expect(first.windows).toBeGreaterThan(0);

    // Each call reopens the save, so these are genuine reloads.
    initialize(databasePath, "idempotent");
    initialize(databasePath, "idempotent");

    expect(snapshot()).toEqual(first);
    expect(scalar(databasePath, PLAYERS_WITH_MULTIPLE_ACTIVE_CONTRACTS)).toBe(0);
  }, 300000);

  it("leaves an unattached player as a free agent rather than inventing a club", () => {
    const databasePath = createSave("free-agent");

    // Detach one player from their factual club to represent a genuinely
    // unattached starting player.
    const detachedId = (() => {
      const db = openGameDatabase(databasePath);
      try {
        const row = db
          .prepare(
            `SELECT pfp.player_id FROM player_factual_profiles pfp
             JOIN player_attributes pa ON pa.person_id = pfp.player_id
             WHERE pfp.current_club_id IS NOT NULL ORDER BY pfp.player_id LIMIT 1`,
          )
          .get() as { player_id: string };
        db.prepare("UPDATE player_factual_profiles SET current_club_id = NULL WHERE player_id = ?").run(
          row.player_id,
        );
        return row.player_id;
      } finally {
        db.close();
      }
    })();

    initialize(databasePath, "free-agent");

    const db = openGameDatabase(databasePath);
    try {
      const contracts = db
        .prepare("SELECT COUNT(*) n FROM player_contracts WHERE player_id = ? AND status = 'ACTIVE'")
        .get(detachedId) as { n: number };
      expect(contracts.n).toBe(0);

      const status = new TransferMarketRepository(db).transferStatus(detachedId as EntityId);
      expect(status).toBeDefined();
      expect(status?.clubId ?? undefined).toBeUndefined();
    } finally {
      db.close();
    }

    // The rest of the squad is unaffected.
    // Only the player deliberately detached above is left without a contract.
    expect(scalar(databasePath, RESOLVABLE_PLAYERS_WITHOUT_CONTRACT)).toBe(0);
  }, 300000);
});
