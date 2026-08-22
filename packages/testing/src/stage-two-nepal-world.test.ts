import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  validateNepalWorldDataset,
  validateNepalWorldReferences,
} from "@nepal-football-sim/data-import";
import { migrateDatabase, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, inspectNepalSave } from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const fixturePath = resolve(process.cwd(), "data/fixtures/testing-only-nepal-world.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-stage-two-"));
  tempDirs.push(dir);
  return join(dir, "nepal-save.sqlite");
};

const loadFixture = (): unknown => JSON.parse(readFileSync(fixturePath, "utf8"));

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("stage two Nepal world data pipeline", () => {
  it("applies the additive Stage 2 migration", () => {
    const db = openGameDatabase(":memory:");
    expect(migrateDatabase(db)).toBe(4);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('venues', 'team_person_assignments', 'entity_provenance') ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual(["entity_provenance", "team_person_assignments", "venues"]);
    db.close();
  });

  it("validates a complete testing-only Nepal world dataset", () => {
    const dataset = validateNepalWorldDataset(loadFixture());

    expect(dataset.meta.targetDatabaseDate).toBe("2026-08");
    expect(validateNepalWorldReferences(dataset)).toEqual([]);
  });

  it("rejects unavailable facts that pretend to have unknown values", () => {
    const dataset = loadFixture() as any;
    dataset.venues[0].capacity = {
      value: 15000,
      status: "UNKNOWN",
    };

    expect(() => validateNepalWorldDataset(dataset)).toThrow();
  });

  it("reports broken dataset references before importing", () => {
    const dataset = validateNepalWorldDataset(loadFixture());
    dataset.teams[0]!.clubKey = {
      value: "missing-club",
      status: "REPORTED",
    };

    expect(validateNepalWorldReferences(dataset)).toEqual([
      {
        path: "teams.0.clubKey",
        message: "Unknown reference: missing-club",
      },
    ]);
  });

  it("creates, reloads and inspects a Nepal save from an importable dataset", () => {
    const databasePath = tempDbPath();
    const created = createNepalSave({
      databasePath,
      dataset: loadFixture(),
      saveName: "Testing-only Nepal August 2026",
      gameVersion: "0.2.0",
      randomSeed: "stage-two-seed",
    });

    expect(created.worldDate).toBe("2026-08-01");
    expect(created.inspection).toMatchObject({
      countries: 1,
      locations: 1,
      venues: 1,
      federations: 1,
      competitions: 1,
      competitionSeasons: 1,
      clubs: 1,
      teams: 1,
      persons: 2,
      personRoles: 2,
      teamPersonAssignments: 2,
      entityProvenance: 14,
    });

    expect(inspectNepalSave(databasePath)).toEqual(created);
  });
});
