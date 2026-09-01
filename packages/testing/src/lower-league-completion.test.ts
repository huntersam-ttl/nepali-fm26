import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, lowerLeagueCoverageReport } from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("lower-league completion", () => {
  it("makes every selectable A/B/C club playable, staffed or market-visible, and idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-football-lower-league-"));
    tempDirs.push(dir);
    const databasePath = join(dir, "lower-league.sqlite");
    createNepalSave({
      databasePath,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "Lower League Completion",
      gameVersion: "0.2.0",
      randomSeed: "lower-league-completion",
    });

    const db = openGameDatabase(databasePath);
    const first = lowerLeagueCoverageReport({ db, date: "2026-08-01" });
    const generatedAfterFirst = (
      db.prepare("SELECT COUNT(*) AS n FROM generated_player_origins").get() as { n: number }
    ).n;
    const vacancies = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM staff_vacancies WHERE role='HEAD_COACH' AND status='VACANT'",
        )
        .get() as { n: number }
    ).n;
    expect(first.clubs).toHaveLength(42);
    expect(first.clubs.filter((club) => club.division === "A")).toHaveLength(14);
    expect(first.clubs.filter((club) => club.division === "B")).toHaveLength(14);
    expect(first.clubs.filter((club) => club.division === "C")).toHaveLength(14);
    expect(first.clubs.every((club) => club.playableSquad)).toBe(true);
    expect(first.generatedStartingPlayers).toBeGreaterThan(0);
    expect(vacancies).toBe(42);
    expect(first.aDivisionRealPlayers).toBeGreaterThanOrEqual(0);
    expect(first.bDivisionRealPlayers).toBeGreaterThanOrEqual(0);
    expect(first.cDivisionRealPlayers).toBeGreaterThanOrEqual(0);

    const second = lowerLeagueCoverageReport({ db, date: "2026-08-01" });
    const generatedAfterSecond = (
      db.prepare("SELECT COUNT(*) AS n FROM generated_player_origins").get() as { n: number }
    ).n;
    expect(second).toEqual(first);
    expect(generatedAfterSecond).toBe(generatedAfterFirst);
    db.close();
  });

  it("repairs the two known empty A-Division clubs without replacing factual players", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-football-a-division-repair-"));
    tempDirs.push(dir);
    const databasePath = join(dir, "a-division.sqlite");
    const dataset = JSON.parse(readFileSync(registryPath, "utf8")) as {
      teamPersonAssignments: Array<{ role: string; teamKey: string }>;
      teams: Array<{ key: string; name: string; level: string; gender: string }>;
      clubMemberships: Array<{
        teamKey?: { value?: string };
        competitionKey: string;
        status: string;
      }>;
      competitions: Array<{ key: string; name: string }>;
      clubs: Array<{ key: string; name: string }>;
    };
    const aCompetitionKeys = new Set(
      dataset.competitions
        .filter((competition) => /A-DIVISION/i.test(competition.name))
        .map((competition) => competition.key),
    );
    const aTeamKeys = new Set(
      dataset.clubMemberships
        .filter(
          (membership) =>
            membership.status === "ACTIVE" &&
            aCompetitionKeys.has(membership.competitionKey) &&
            membership.teamKey?.value,
        )
        .map((membership) => membership.teamKey!.value!),
    );
    const factualCounts = new Map<string, number>();
    for (const assignment of dataset.teamPersonAssignments) {
      if (assignment.role === "PLAYER" && aTeamKeys.has(assignment.teamKey))
        factualCounts.set(assignment.teamKey, (factualCounts.get(assignment.teamKey) ?? 0) + 1);
    }
    createNepalSave({
      databasePath,
      dataset,
      saveName: "A Division Repair",
      gameVersion: "0.2.0",
      randomSeed: "a-division-repair",
    });
    const db = openGameDatabase(databasePath);
    try {
      const rows = db
        .prepare(
          `SELECT c.name AS club_name, t.id AS team_id, COUNT(DISTINCT CASE WHEN gpo.player_id IS NULL THEN tpa.person_id END) AS real_players, COUNT(*) AS total_players FROM teams t JOIN clubs c ON c.id=t.club_id JOIN team_person_assignments tpa ON tpa.team_id=t.id AND tpa.role='PLAYER' AND tpa.ended_on IS NULL LEFT JOIN generated_player_origins gpo ON gpo.player_id=tpa.person_id WHERE t.level='senior' AND t.gender='men' AND c.name IN ('Khumaltar Youth Club','Three Star Club') GROUP BY c.name,t.id ORDER BY c.name`,
        )
        .all() as Array<{
        club_name: string;
        team_id: string;
        real_players: number;
        total_players: number;
      }>;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.total_players).toBeGreaterThanOrEqual(11);
        expect(row.real_players).toBe(
          factualCounts.get(dataset.teams.find((team) => team.name === row.club_name)?.key ?? "") ??
            0,
        );
      }
    } finally {
      db.close();
    }
  });

  it("generates the same bounded A/B/C repair cohort for the same seed", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-football-bootstrap-determinism-"));
    tempDirs.push(dir);
    const dataset = JSON.parse(readFileSync(registryPath, "utf8")) as unknown;
    const paths = [join(dir, "first.sqlite"), join(dir, "second.sqlite")];
    for (const databasePath of paths)
      createNepalSave({
        databasePath,
        dataset,
        saveName: "Deterministic Bootstrap",
        gameVersion: "0.2.0",
        randomSeed: "same-bootstrap-seed",
      });
    const cohorts = paths.map((databasePath) => {
      const db = openGameDatabase(databasePath);
      try {
        return db
          .prepare(
            "SELECT player_id, club_id, generated_on FROM generated_player_origins ORDER BY player_id",
          )
          .all();
      } finally {
        db.close();
      }
    });
    expect(cohorts[1]).toEqual(cohorts[0]);
  });
});
