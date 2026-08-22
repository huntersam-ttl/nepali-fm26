import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  validateNepalWorldDataset,
  validateNepalWorldReferences,
} from "@nepal-football-sim/data-import";
import {
  CURRENT_DATABASE_VERSION,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import { createNepalSave, inspectNepalSave } from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const fixturePath = resolve(process.cwd(), "data/fixtures/testing-only-nepal-world.json");
const clubRegistryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-stage-two-"));
  tempDirs.push(dir);
  return join(dir, "nepal-save.sqlite");
};

const loadFixture = (): unknown => JSON.parse(readFileSync(fixturePath, "utf8"));
const loadClubRegistry = (): unknown => JSON.parse(readFileSync(clubRegistryPath, "utf8"));

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("stage two Nepal world data pipeline", () => {
  it("applies the additive Stage 2 migration", () => {
    const db = openGameDatabase(":memory:");
    expect(migrateDatabase(db)).toBe(CURRENT_DATABASE_VERSION);
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('venues', 'team_person_assignments', 'entity_provenance',
            'club_aliases', 'club_memberships', 'club_relationships', 'academies',
            'venue_relationships')
        ORDER BY name`,
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      "academies",
      "club_aliases",
      "club_memberships",
      "club_relationships",
      "entity_provenance",
      "team_person_assignments",
      "venue_relationships",
      "venues",
    ]);
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

  it("validates the canonical Nepal club registry without players", () => {
    const dataset = validateNepalWorldDataset(loadClubRegistry());

    expect(validateNepalWorldReferences(dataset)).toEqual([]);
    expect(dataset.clubs).toHaveLength(53);
    expect(dataset.clubs.filter((club) => club.key.startsWith("NEP-NSL-"))).toHaveLength(9);
    expect(dataset.clubs.filter((club) => club.key.startsWith("NEP-DEP-"))).toHaveLength(3);
    expect(dataset.clubMemberships).toHaveLength(51);
    expect(dataset.teams.filter((team) => team.gender === "women")).toHaveLength(10);
    expect(dataset.academies).toHaveLength(8);
    expect(dataset.persons).toEqual([]);
    expect(dataset.playerAttributes).toEqual([]);

    const nslJhapa = dataset.clubs.find((club) => club.key === "NEP-NSL-JHA");
    const pyramidJhapa = dataset.clubs.find((club) => club.key === "NEP-DIVB-JHA");
    expect(nslJhapa?.name).toBe("Jhapa FC (NSL)");
    expect(pyramidJhapa?.name).toBe("Jhapa Football Club (ANFA pyramid)");
  });

  it("persists the Nepal club registry into a reloadable save", () => {
    const databasePath = tempDbPath();
    const created = createNepalSave({
      databasePath,
      dataset: loadClubRegistry(),
      saveName: "Nepal Club Registry August 2026",
      gameVersion: "0.2.0",
      randomSeed: "club-registry-seed",
    });

    expect(created.inspection).toMatchObject({
      countries: 1,
      locations: 20,
      venues: 7,
      federations: 1,
      competitions: 4,
      competitionSeasons: 4,
      clubs: 53,
      clubAliases: 18,
      clubMemberships: 51,
      teams: 61,
      academies: 8,
      venueRelationships: 0,
      persons: 0,
      playerAttributes: 0,
    });
    expect(inspectNepalSave(databasePath)).toEqual(created);

    const db = openGameDatabase(databasePath);
    migrateDatabase(db);
    const jhapaRows = db
      .prepare(
        "SELECT canonical_external_id, name FROM clubs WHERE canonical_external_id IN ('NEP-NSL-JHA', 'NEP-DIVB-JHA') ORDER BY canonical_external_id",
      )
      .all();
    expect(jhapaRows).toEqual([
      { canonical_external_id: "NEP-DIVB-JHA", name: "Jhapa Football Club (ANFA pyramid)" },
      { canonical_external_id: "NEP-NSL-JHA", name: "Jhapa FC (NSL)" },
    ]);

    const apfWomen = db
      .prepare(
        `SELECT cr.relationship_type
        FROM club_relationships cr
        JOIN teams t ON t.id = cr.child_team_id
        JOIN clubs c ON c.id = cr.parent_club_id
        WHERE c.canonical_external_id = 'NEP-DEP-APF'
          AND t.canonical_external_id = 'NEP-WOM-APF'`,
      )
      .get();
    expect(apfWomen).toEqual({ relationship_type: "WOMENS_BRANCH" });

    const aliasCount = db
      .prepare("SELECT COUNT(*) AS count FROM club_aliases WHERE alias IN ('NRT', 'MMC', 'APF FC')")
      .get() as { count: number };
    expect(aliasCount.count).toBe(3);
    db.close();
  });
});
