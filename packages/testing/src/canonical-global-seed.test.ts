import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import {
  CANONICAL_GLOBAL_SEED_PATH,
  applyCanonicalGlobalDatasetSeed,
  createNepalSave,
} from "@nepal-football-sim/simulation";

/*
 * The global dataset used to exist only inside whichever database an operator
 * had run APPLY against, from a workbook that lives outside the repository. A
 * fresh checkout could never see it. These tests pin the replacement contract:
 * the committed seed is the runtime source, a normal new save receives it, and
 * nothing reaches for the workbook or a developer's local files.
 */

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const seedPath = resolve(process.cwd(), CANONICAL_GLOBAL_SEED_PATH);

/** A normal new save: no APPLY call, no workbook, no explicit seed argument. */
const newSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-global-seed-"));
  tempDirs.push(dir);
  const databasePath = join(dir, "career.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Seed ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  return databasePath;
};

type Db = ReturnType<typeof openGameDatabase>;
const scalar = (db: Db, sql: string, ...params: unknown[]): number =>
  Number((db.prepare(sql).get(...(params as [])) as { n?: number } | undefined)?.n ?? 0);

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("canonical global dataset seed", () => {
  it("is a committed artifact carrying the approved dataset, with no workbook reference", () => {
    const seed = JSON.parse(readFileSync(seedPath, "utf8")) as Record<string, unknown>;
    expect(seed.datasetVersion).toBe("football_world_import_v16_reconciled_final");
    // Runtime must never be pointed back at the research workbook.
    expect(String(seed.sourcePath)).toBe(CANONICAL_GLOBAL_SEED_PATH);
    expect(JSON.stringify(seed)).not.toContain("/tmp/");
    expect(JSON.stringify(seed)).not.toMatch(/\.xlsx/i);

    // The approved dataset, at the counts the import reported.
    expect((seed.players as unknown[]).length).toBe(1458);
    expect((seed.clubs as unknown[]).length).toBe(540);
    expect((seed.staff as unknown[]).length).toBe(149);
    expect((seed.leagues as unknown[]).length).toBe(169);
    expect((seed.federations as unknown[]).length).toBe(63);
    expect((seed.sources as unknown[]).length).toBe(12);
  });

  it("reaches a fresh database through normal new-save initialization", () => {
    const databasePath = newSave("fresh");
    const db = openGameDatabase(databasePath);
    try {
      // Applied once, recorded by version, with no manual APPLY step.
      const marker = db
        .prepare("SELECT dataset_version, status FROM global_dataset_imports")
        .all() as Array<{ dataset_version: string; status: string }>;
      expect(marker).toHaveLength(1);
      expect(marker[0]!.dataset_version).toBe("football_world_import_v16_reconciled_final");
      expect(marker[0]!.status).toBe("ACTIVE");

      // Imported people are really present and carry factual profiles.
      expect(scalar(db, "SELECT COUNT(*) n FROM player_factual_profiles")).toBeGreaterThan(1458);
      expect(scalar(db, "SELECT COUNT(*) n FROM clubs")).toBeGreaterThan(540);

      // Imported identities keep their provenance rather than being downgraded.
      const simulationOnly = scalar(
        db,
        "SELECT COUNT(*) n FROM player_factual_profiles WHERE record_status = 'SIMULATION_ONLY'",
      );
      expect(simulationOnly).toBe(0);
    } finally {
      db.close();
    }
  }, 300000);

  it("keeps Nepal canonical and every imported foreign entity context-only", () => {
    const databasePath = newSave("precedence");
    const db = openGameDatabase(databasePath);
    try {
      // Nepal clubs are not duplicated by the global dataset.
      const duplicated = db
        .prepare(
          `SELECT c.name, COUNT(*) n FROM clubs c
           JOIN countries co ON co.id = c.country_id
           WHERE co.iso_code IN ('NPL','NP')
           GROUP BY lower(c.name) HAVING n > 1`,
        )
        .all();
      expect(duplicated).toEqual([]);

      // Every external club and league the seed registered is context-only.
      const playableExternal = scalar(
        db,
        "SELECT COUNT(*) n FROM external_club_context WHERE simulation_depth != 'CONTEXT_ONLY'",
      );
      expect(playableExternal).toBe(0);
      const playableLeagues = scalar(
        db,
        "SELECT COUNT(*) n FROM external_league_context WHERE simulation_depth != 'CONTEXT_ONLY'",
      );
      expect(playableLeagues).toBe(0);

      // No external club is entered into a playable Nepal competition.
      expect(
        scalar(
          db,
          `SELECT COUNT(*) n FROM club_memberships cm
           JOIN external_club_context ecc ON ecc.club_id = cm.club_id`,
        ),
      ).toBe(0);
    } finally {
      db.close();
    }
  }, 300000);

  it("applies exactly once, so repeated initialization cannot duplicate the world", () => {
    const databasePath = newSave("idempotent");
    const db = openGameDatabase(databasePath);
    try {
      const before = {
        persons: scalar(db, "SELECT COUNT(*) n FROM persons"),
        clubs: scalar(db, "SELECT COUNT(*) n FROM clubs"),
        profiles: scalar(db, "SELECT COUNT(*) n FROM player_factual_profiles"),
        competitions: scalar(db, "SELECT COUNT(*) n FROM competitions"),
      };

      const second = applyCanonicalGlobalDatasetSeed(db);
      expect(second.applied).toBe(false);
      expect(second.reason).toBe("ALREADY_APPLIED");

      expect({
        persons: scalar(db, "SELECT COUNT(*) n FROM persons"),
        clubs: scalar(db, "SELECT COUNT(*) n FROM clubs"),
        profiles: scalar(db, "SELECT COUNT(*) n FROM player_factual_profiles"),
        competitions: scalar(db, "SELECT COUNT(*) n FROM competitions"),
      }).toEqual(before);
    } finally {
      db.close();
    }
  }, 300000);

  it("builds a Nepal-only world when the caller opts out of the global dataset", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-football-global-seed-off-"));
    tempDirs.push(dir);
    const databasePath = join(dir, "career.sqlite");
    createNepalSave({
      databasePath,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "Nepal only",
      gameVersion: "0.2.0",
      randomSeed: "nepal-only",
      globalSeedPath: null,
    });
    const db = openGameDatabase(databasePath);
    try {
      expect(scalar(db, "SELECT COUNT(*) n FROM global_dataset_imports")).toBe(0);
      expect(scalar(db, "SELECT COUNT(*) n FROM player_factual_profiles")).toBe(573);
    } finally {
      db.close();
    }
  }, 300000);
});
