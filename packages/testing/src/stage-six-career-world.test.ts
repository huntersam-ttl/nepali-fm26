import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StaffMarketRepository, WorldRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, simulateNepalCareer } from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-career-world-"));
  tempDirs.push(dir);
  return join(dir, "career.sqlite");
};

const createSave = (seed: string): string => {
  const databasePath = tempDbPath();
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Career world ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  return databasePath;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("full Nepal career season simulation", () => {
  it("runs a fixture-backed three-season Nepal career loop with imported players", () => {
    const databasePath = createSave("three-season-career");
    const db = openGameDatabase(databasePath);
    const report = simulateNepalCareer({
      db,
      seasons: 3,
      seed: "three-season-career",
      savePath: databasePath,
    });

    expect(report.worldDate).toBe("2029-07-31");
    expect(report.runnableCompetitions).toContain("ANFA National League");
    expect(report.skippedCompetitions.map((item) => item.seasonName)).toContain(
      "Nepal Super League 2026",
    );
    expect(report.seasons.length).toBeGreaterThanOrEqual(3);
    expect(
      report.seasons.every((season) => season.fixturesGenerated === season.matchesPlayed),
    ).toBe(true);
    expect(report.seasons.every((season) => season.championTeamId)).toBe(true);
    expect(report.seasons.some((season) => season.promotions > 0 || season.relegations > 0)).toBe(
      true,
    );
    expect(report.seasons.every((season) => season.developedPlayers > 0)).toBe(true);
    expect(report.seasons.every((season) => season.squadHealth.emergencyLineupCases === 0)).toBe(
      true,
    );

    const inspection = new WorldRepository(db).inspectWorld();
    expect(inspection.fixtures).toBeGreaterThan(400);
    expect(inspection.playerCareerStats).toBeGreaterThan(0);
    expect(inspection.seasonAwards).toBeGreaterThan(0);
    const historyRows = db.prepare(
      "SELECT COUNT(*) AS count, COUNT(DISTINCT id) AS distinctCount FROM training_history_events",
    ).get() as { count: number; distinctCount: number };
    expect(historyRows.count).toBeGreaterThan(0);
    expect(historyRows).toEqual({ count: historyRows.count, distinctCount: historyRows.count });
    expect(historyRows.count).toBeLessThan(100_000);
    db.close();
  });

  it("reuses persisted fixtures and avoids duplicate stats after reload continuation", () => {
    const databasePath = createSave("reload-career");
    const db = openGameDatabase(databasePath);
    const partial = simulateNepalCareer({
      db,
      seasons: 1,
      seed: "reload-career",
      competitionSeasonId: "anfa-national-league-2026" as any,
      maxFixturesPerSeason: 12,
    });
    expect(partial.seasons[0]?.matchesPlayed).toBe(12);
    db.close();

    const reloaded = openGameDatabase(databasePath);
    const continued = simulateNepalCareer({
      db: reloaded,
      seasons: 1,
      seed: "reload-career",
      competitionSeasonId: "anfa-national-league-2026" as any,
    });
    const fixtureRows = reloaded
      .prepare(
        `SELECT COUNT(*) AS count, COUNT(DISTINCT id) AS distinctCount
        FROM fixtures
        WHERE competition_season_id = ?`,
      )
      .get("9c75caea-dfff-5c1c-93a2-fd95156ec60b") as {
      count: number;
      distinctCount: number;
    };
    const statRows = reloaded
      .prepare(
        `SELECT COUNT(*) AS count
        FROM player_season_stats
        WHERE competition_season_id = ?`,
      )
      .get("9c75caea-dfff-5c1c-93a2-fd95156ec60b") as { count: number };

    expect(continued.seasons[0]?.matchesPlayed).toBe(153);
    expect(fixtureRows).toEqual({ count: 153, distinctCount: 153 });
    expect(statRows.count).toBeGreaterThan(0);
    const historyRows = reloaded.prepare(
      "SELECT COUNT(*) AS count, COUNT(DISTINCT id) AS distinctCount FROM training_history_events",
    ).get() as { count: number; distinctCount: number };
    expect(historyRows).toEqual({ count: historyRows.count, distinctCount: historyRows.count });
    reloaded.close();
  });

  it("is deterministic for the same imported save and seed", () => {
    const firstPath = createSave("deterministic-career");
    const secondPath = createSave("deterministic-career");
    const first = openGameDatabase(firstPath);
    const second = openGameDatabase(secondPath);

    const firstReport = simulateNepalCareer({
      db: first,
      seasons: 1,
      seed: "deterministic-career",
      competitionSeasonId: "anfa-national-league-2026" as any,
    });
    const secondReport = simulateNepalCareer({
      db: second,
      seasons: 1,
      seed: "deterministic-career",
      competitionSeasonId: "anfa-national-league-2026" as any,
    });

    expect(stripPath(firstReport)).toEqual(stripPath(secondReport));
    const staff = new StaffMarketRepository(first);
    expect(staff.activeEmploymentContracts().length).toBeGreaterThan(0);
    const appointmentsBeforeReload = staff.activeEmploymentContracts().map((contract) => contract.id).sort();
    first.close();
    const reloaded = openGameDatabase(firstPath);
    expect(new StaffMarketRepository(reloaded).activeEmploymentContracts().map((contract) => contract.id).sort()).toEqual(
      appointmentsBeforeReload,
    );
    reloaded.close();
    second.close();
  });
});

function stripPath<T extends { savePath?: string }>(report: T): Omit<T, "savePath"> {
  const { savePath, ...rest } = report;
  void savePath;
  return rest;
}
