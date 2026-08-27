import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import {
  createNepalSave,
  initializeForeignFootballWorldForSave,
  processForeignFootballWorldSeason,
} from "@nepal-football-sim/simulation";

/*
 * The foreign world is bootstrapped once per save and replenished per season.
 * Conflating the two used to re-derive the same deterministic person ids on
 * every career entry, which collided on persons.id as soon as a save was
 * reloaded. These tests pin the lifecycle boundary rather than the id format.
 */

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const createSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-foreign-world-"));
  tempDirs.push(dir);
  const databasePath = join(dir, "world.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Foreign world ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  return databasePath;
};

type Snapshot = {
  persons: number;
  foreignClubs: number;
  foreignTeams: number;
  foreignPlayers: number;
  foreignStaff: number;
  playerIds: string[];
};

const snapshot = (databasePath: string): Snapshot => {
  const db = openGameDatabase(databasePath);
  try {
    const scalar = (sql: string): number =>
      Number((db.prepare(sql).get() as { n?: number } | undefined)?.n ?? 0);
    const playerIds = (
      db
        .prepare(
          `SELECT gpo.player_id AS id FROM generated_player_origins gpo
           JOIN clubs c ON c.id = gpo.club_id
           WHERE c.canonical_external_id LIKE 'SIM-FOREIGN-%' ORDER BY gpo.player_id`,
        )
        .all() as Array<{ id: string }>
    ).map((row) => row.id);
    return {
      persons: scalar("SELECT COUNT(*) n FROM persons"),
      foreignClubs: scalar(
        "SELECT COUNT(*) n FROM clubs WHERE canonical_external_id LIKE 'SIM-FOREIGN-%'",
      ),
      foreignTeams: scalar(
        `SELECT COUNT(*) n FROM teams t JOIN clubs c ON c.id = t.club_id
         WHERE c.canonical_external_id LIKE 'SIM-FOREIGN-%'`,
      ),
      foreignPlayers: playerIds.length,
      foreignStaff: scalar(
        `SELECT COUNT(*) n FROM staff_profiles sp JOIN persons p ON p.id = sp.person_id
         JOIN countries co ON co.id = p.nationality_country_id WHERE co.iso_code != 'NPL'`,
      ),
      playerIds,
    };
  } finally {
    db.close();
  }
};

/** Each call opens and closes the save, so every step is a genuine reload. */
const initialize = (databasePath: string, worldDate: string, seed: string): void => {
  const db = openGameDatabase(databasePath);
  try {
    initializeForeignFootballWorldForSave({ db, worldDate, seed });
  } finally {
    db.close();
  }
};

const replenish = (databasePath: string, seasonEndDate: string, seed: string): void => {
  const db = openGameDatabase(databasePath);
  try {
    processForeignFootballWorldSeason({ db, seasonEndDate, seed });
  } finally {
    db.close();
  }
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("foreign football world initialization", () => {
  it("bootstraps a foreign world once and adds nothing on repeat or reload", () => {
    const databasePath = createSave("bootstrap");
    const before = snapshot(databasePath);
    expect(before.foreignClubs).toBe(0);

    initialize(databasePath, "2026-08-01", "world");
    const first = snapshot(databasePath);
    expect(first.foreignClubs).toBeGreaterThan(0);
    expect(first.foreignTeams).toBe(first.foreignClubs);
    expect(first.foreignPlayers).toBeGreaterThan(0);
    expect(first.foreignStaff).toBeGreaterThan(0);
    expect(first.persons).toBeGreaterThan(before.persons);

    // Defensive second call within the same session: pure no-op.
    initialize(databasePath, "2026-08-01", "world");
    expect(snapshot(databasePath)).toEqual(first);

    // Reload and initialize again: still a no-op, identities unchanged.
    initialize(databasePath, "2026-08-01", "world");
    const afterReload = snapshot(databasePath);
    expect(afterReload).toEqual(first);
    expect(afterReload.playerIds).toEqual(first.playerIds);
  }, 300000);

  it("keeps foreign identities and squad membership stable across repeated reloads", () => {
    const databasePath = createSave("reloads");
    initialize(databasePath, "2026-08-01", "world");
    const baseline = snapshot(databasePath);

    for (let reload = 0; reload < 3; reload += 1) {
      initialize(databasePath, "2026-08-01", "world");
    }
    const after = snapshot(databasePath);

    // Reload alone must never change the size of the world.
    expect(after.persons).toBe(baseline.persons);
    expect(after.foreignPlayers).toBe(baseline.foreignPlayers);
    expect(after.foreignClubs).toBe(baseline.foreignClubs);
    expect(after.playerIds).toEqual(baseline.playerIds);
    // Deterministic identities, and no duplicate person rows behind them.
    expect(new Set(after.playerIds).size).toBe(after.playerIds.length);
  }, 300000);

  it("marks a pre-existing foreign world as bootstrapped instead of regenerating it", () => {
    const databasePath = createSave("legacy");
    initialize(databasePath, "2026-08-01", "world");
    const bootstrapped = snapshot(databasePath);

    // A save that already holds a foreign world, entering a later world date:
    // the bootstrap must stay closed rather than seeding a second intake.
    initialize(databasePath, "2027-08-01", "world");
    const later = snapshot(databasePath);
    expect(later.foreignPlayers).toBe(bootstrapped.foreignPlayers);
    expect(later.playerIds).toEqual(bootstrapped.playerIds);
  }, 300000);

  it("still replenishes a genuine shortage, with identities distinct from the bootstrap", () => {
    const databasePath = createSave("replenish");
    initialize(databasePath, "2026-08-01", "world");
    const bootstrapped = snapshot(databasePath);

    replenish(databasePath, "2027-07-31", "world");
    const replenished = snapshot(databasePath);

    // Seasonal replenishment is allowed to add players...
    expect(replenished.foreignPlayers).toBeGreaterThan(bootstrapped.foreignPlayers);
    // ...but never by reusing a bootstrap identity.
    const bootstrapIds = new Set(bootstrapped.playerIds);
    const added = replenished.playerIds.filter((id) => !bootstrapIds.has(id));
    expect(added.length).toBeGreaterThan(0);
    expect(new Set(replenished.playerIds).size).toBe(replenished.playerIds.length);
    for (const id of bootstrapped.playerIds) {
      expect(replenished.playerIds).toContain(id);
    }

    // Re-running the same season is idempotent, including across a reload.
    replenish(databasePath, "2027-07-31", "world");
    replenish(databasePath, "2027-07-31", "world");
    expect(snapshot(databasePath)).toEqual(replenished);

    // A later season is a new cycle and may add again without colliding.
    replenish(databasePath, "2028-07-31", "world");
    const nextSeason = snapshot(databasePath);
    expect(new Set(nextSeason.playerIds).size).toBe(nextSeason.playerIds.length);
    expect(nextSeason.foreignPlayers).toBeGreaterThanOrEqual(replenished.foreignPlayers);
  }, 300000);

  it("gives every generated foreign player a person record and simulation provenance", () => {
    const databasePath = createSave("pairing");
    initialize(databasePath, "2026-08-01", "world");

    const db = openGameDatabase(databasePath);
    try {
      const orphans = db
        .prepare(
          `SELECT gpo.player_id AS id FROM generated_player_origins gpo
           JOIN clubs c ON c.id = gpo.club_id
           LEFT JOIN persons p ON p.id = gpo.player_id
           WHERE c.canonical_external_id LIKE 'SIM-FOREIGN-%' AND p.id IS NULL`,
        )
        .all() as Array<{ id: string }>;
      expect(orphans).toEqual([]);

      const provenance = db
        .prepare(
          `SELECT DISTINCT gpo.origin_data_type AS status FROM generated_player_origins gpo
           JOIN clubs c ON c.id = gpo.club_id
           WHERE c.canonical_external_id LIKE 'SIM-FOREIGN-%'`,
        )
        .all() as Array<{ status: string }>;
      expect(provenance.map((row) => row.status)).toEqual(["SIMULATION_ONLY"]);

      const duplicateClubs = db
        .prepare(
          `SELECT canonical_external_id, COUNT(*) n FROM clubs
           WHERE canonical_external_id LIKE 'SIM-FOREIGN-%'
           GROUP BY canonical_external_id HAVING n > 1`,
        )
        .all();
      expect(duplicateClubs).toEqual([]);
    } finally {
      db.close();
    }
  }, 300000);
});
