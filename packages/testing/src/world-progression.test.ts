import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService, SEASON_TRANSITION_STAGES } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 11A: the world plays every club's fixtures as time passes, whoever the
 * human is; tables are the whole league's; and the season transition is staged,
 * atomic per stage, resumable after a failure or a restart, and never runs twice.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterAll(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })));

const character = {
  fullName: "World Tester",
  dateOfBirth: "1985-01-01",
  startingAge: 41,
  languages: ["en"],
  footballBackground: "COMMUNITY_COACHING",
  education: "SPORTS_RELATED_DEGREE",
  playingExperience: "AMATEUR_PLAYER",
  coachingExperience: "YOUTH_COACH",
  businessBackground: "SMALL_BUSINESS",
  startingReputationProfile: "LOCAL_RESPECTED",
};

const newService = (label: string) => {
  const directory = mkdtempSync(join(tmpdir(), `world-${label}-`));
  dirs.push(directory);
  return new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
};

const withDb = <T,>(savePath: string, run: (db: GameDatabase) => T): T => {
  const db = openGameDatabase(savePath);
  try {
    return run(db);
  } finally {
    db.close();
  }
};
const count = (db: GameDatabase, sql: string, ...params: unknown[]): number => (db.prepare(sql).get(...(params as [])) as { n: number }).n;

const cycleSeasonIds = (db: GameDatabase): EntityId[] =>
  (db.prepare("SELECT s.competition_season_id AS id FROM competition_season_states s WHERE s.status != 'ROLLED_OVER'").all() as Array<{ id: EntityId }>).map((row) => row.id);

describe("the world plays on as time passes", () => {
  it("plays other clubs' fixtures on schedule with real tables, for a manager and for an unemployed manager alike", () => {
    // A manager plays only their own matches; the world plays everyone else's.
    const manager = newService("manager");
    const created = manager.createCareer({ saveName: "world manager", character });
    if (!created.ok) throw new Error(created.error.message);
    const path = created.data.catalogEntry.filePath;
    for (let round = 0; round < 4; round += 1) {
      const step = manager.continueCareer();
      if (!step.ok) throw new Error(`${step.error.code}: ${step.error.message}`);
      manager.quickSimMatch();
    }
    const worldDate = manager.continueCareer();
    if (!worldDate.ok) throw new Error(worldDate.error.message);
    const today = worldDate.data.save.worldDate;
    manager.closeCareer();
    withDb(path, (db) => {
      const seasons = cycleSeasonIds(db);
      expect(seasons.length).toBeGreaterThan(3);
      const humanTeam = (db.prepare("SELECT id FROM teams WHERE name = ?").get(worldDate.data.home.teamName!) as { id: EntityId }).id;
      const overdue = count(
        db,
        `SELECT COUNT(*) AS n FROM fixtures WHERE status != 'played' AND scheduled_date < ?
           AND home_team_id != ? AND away_team_id != ? AND competition_season_id IN (${seasons.map(() => "?").join(",")})`,
        today,
        humanTeam,
        humanTeam,
        ...seasons,
      );
      expect(overdue, "no other club has an overdue fixture").toBe(0);
      const played = count(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'played'");
      expect(played).toBeGreaterThan(20);
      // Each table is the whole competition's table.
      for (const season of seasons) {
        const rows = db.prepare("SELECT team_id, played FROM league_standings WHERE competition_season_id = ?").all(season) as Array<{ team_id: EntityId; played: number }>;
        for (const row of rows) {
          const stored = count(db, "SELECT COUNT(*) AS n FROM matches m JOIN fixtures f ON f.id = m.fixture_id WHERE f.competition_season_id = ? AND (f.home_team_id = ? OR f.away_team_id = ?)", season, row.team_id, row.team_id);
          expect(row.played).toBe(stored);
        }
        if (rows.length > 0) expect(Math.max(...rows.map((row) => row.played))).toBeGreaterThan(0);
      }
      expect(count(db, "SELECT COUNT(*) AS n FROM world_progress_cursors WHERE key = 'world_month'")).toBe(1);
      expect(count(db, "SELECT COUNT(*) AS n FROM world_progress_cursors WHERE key = 'world_systems_ready'")).toBe(1);
    });

    // With no club at all the world still plays every fixture that has come due.
    const jobless = newService("jobless");
    const createdJobless = jobless.createCareer({ saveName: "world jobless", character });
    if (!createdJobless.ok) throw new Error(createdJobless.error.message);
    const joblessPath = createdJobless.data.catalogEntry.filePath;
    expect(jobless.resignFromClub().ok).toBe(true);
    let joblessDate = createdJobless.data.save.worldDate;
    for (let step = 0; step < 12; step += 1) {
      const result = jobless.continueCareer();
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      joblessDate = result.data.save.worldDate;
    }
    jobless.closeCareer();
    withDb(joblessPath, (db) => {
      const seasons = cycleSeasonIds(db);
      const overdue = count(db, `SELECT COUNT(*) AS n FROM fixtures WHERE status != 'played' AND scheduled_date <= ? AND competition_season_id IN (${seasons.map(() => "?").join(",")})`, joblessDate, ...seasons);
      expect(overdue).toBe(0);
      expect(count(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'played'")).toBeGreaterThan(20);
    });
  }, 900_000);
});

describe("the staged season transition", () => {
  it("rolls a failed stage back whole, reports it, survives a restart, and resumes exactly where it stopped", () => {
    const service = newService("transition");
    const created = service.createCareer({ saveName: "world transition", character });
    if (!created.ok) throw new Error(created.error.message);
    const savePath = created.data.catalogEntry.filePath;
    for (let guard = 0; guard < 600; guard += 1) {
      const status = service.getSeasonStatus();
      if (status.ok && status.data.phase !== "IN_PROGRESS") break;
      service.continueCareer();
      service.quickSimMatch();
    }
    expect(service.getSeasonStatus()).toMatchObject({ ok: true, data: { phase: "COMPLETE" } });
    const stageKeys = SEASON_TRANSITION_STAGES.map((stage) => stage.key);
    expect(stageKeys).toEqual([
      "close-competitions",
      "promotion-relegation",
      "transfers",
      "youth-retirement",
      "monthly-processing",
      "club-finance",
      "federation",
      "international",
      "external-world",
      "next-season",
      "storage",
      "finalize",
    ]);
    const dateBefore = (service.continueCareer() as { ok: true; data: { save: { worldDate: string } } }).data.save.worldDate;
    // Continue never moves time past a finished season.
    expect((service.continueCareer() as { ok: true; data: { save: { worldDate: string } } }).data.save.worldDate).toBe(dateBefore);

    const measure = () => withDb(savePath, (db) => ({
      people: count(db, "SELECT COUNT(*) AS n FROM persons"),
      youth: count(db, "SELECT COUNT(*) AS n FROM youth_intake_events"),
      seasons: count(db, "SELECT COUNT(*) AS n FROM competition_seasons"),
      rolled: count(db, "SELECT COUNT(*) AS n FROM competition_season_states WHERE status = 'ROLLED_OVER'"),
      movements: count(db, "SELECT COUNT(*) AS n FROM competition_movements"),
    }));
    const start = measure();

    // Stage 2 fails: nothing it wrote is kept, and no next season half-exists.
    withDb(savePath, (db) => db.exec("CREATE TRIGGER fail_movement BEFORE INSERT ON competition_movements BEGIN SELECT RAISE(ABORT, 'movement store is unavailable'); END;"));
    const first = service.advanceSeasonTransition();
    if (!first.ok) throw new Error(first.error.message);
    expect(first.data.seasonStatus.phase).toBe("TRANSITIONING");
    const failedStep = service.advanceSeasonTransition();
    if (!failedStep.ok) throw new Error(failedStep.error.message);
    expect(failedStep.data.seasonStatus.phase).toBe("TRANSITION_FAILED");
    expect(failedStep.data.seasonStatus.transition).toMatchObject({ completedStages: 1, currentStageKey: "promotion-relegation" });
    expect(failedStep.data.seasonStatus.transition?.error).toMatch(/movement store is unavailable/);
    expect(failedStep.data.seasonStatus.stages.map((stage) => stage.state).slice(0, 3)).toEqual(["DONE", "FAILED", "PENDING"]);
    expect(measure()).toEqual(start);

    // A restart in the middle of a failed transition loses nothing.
    service.closeCareer();
    withDb(savePath, (db) => db.exec("DROP TRIGGER fail_movement;"));
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    const resumed = service.getSeasonStatus();
    expect(resumed).toMatchObject({ ok: true, data: { phase: "TRANSITION_FAILED" } });
    expect(service.continueCareer()).toMatchObject({ ok: true });
    expect((service.continueCareer() as { ok: true; data: { save: { worldDate: string } } }).data.save.worldDate).toBe(dateBefore);

    // Retrying runs the same stage, then the youth stage fails after promotion has been kept.
    withDb(savePath, (db) => db.exec("CREATE TRIGGER fail_youth BEFORE INSERT ON youth_intake_events BEGIN SELECT RAISE(ABORT, 'intake registry is unavailable'); END;"));
    let sawYouthFailure = false;
    let promotionKept = false;
    for (let guard = 0; guard < 6 && !sawYouthFailure; guard += 1) {
      const step = service.advanceSeasonTransition();
      if (!step.ok) throw new Error(step.error.message);
      if (step.data.seasonStatus.phase === "TRANSITION_FAILED") {
        sawYouthFailure = true;
        expect(step.data.seasonStatus.transition?.currentStageKey).toBe("youth-retirement");
        expect(step.data.seasonStatus.transition?.completedStages).toBe(3);
        promotionKept = measure().rolled > start.rolled && measure().movements > start.movements;
      }
    }
    expect(sawYouthFailure).toBe(true);
    expect(promotionKept, "the finished promotion stage stays applied").toBe(true);
    expect(measure().youth).toBe(start.youth);
    withDb(savePath, (db) => db.exec("DROP TRIGGER fail_youth;"));

    // Now it runs to the end, once: one intake, one set of next seasons.
    for (let guard = 0; guard < 20; guard += 1) {
      const step = service.advanceSeasonTransition();
      if (!step.ok) throw new Error(step.error.message);
      if (step.data.finished) break;
    }
    const end = measure();
    expect(end.youth).toBeGreaterThan(start.youth);
    expect(end.people).toBeGreaterThan(start.people);
    service.closeCareer();
    withDb(savePath, (db) => {
      expect(count(db, "SELECT COUNT(*) AS n FROM season_transitions WHERE status = 'COMPLETED'")).toBe(1);
      const row = db.prepare("SELECT completed_stages, total_stages, stage_timings_json FROM season_transitions").get() as { completed_stages: number; total_stages: number; stage_timings_json: string };
      expect(row.completed_stages).toBe(SEASON_TRANSITION_STAGES.length);
      expect((JSON.parse(row.stage_timings_json) as Array<{ key: string }>).map((entry) => entry.key)).toEqual(stageKeys);
      // Each competition's next season exists once.
      const duplicates = count(db, "SELECT COUNT(*) AS n FROM (SELECT competition_id, start_date, COUNT(*) c FROM competition_seasons GROUP BY competition_id, start_date HAVING c > 1)");
      expect(duplicates).toBe(0);
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    const again = service.advanceSeasonTransition();
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("SEASON_NOT_COMPLETE");
    service.closeCareer();
  }, 1_800_000);
});
