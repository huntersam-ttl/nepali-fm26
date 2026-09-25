import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 11A: a real desktop save crosses season boundaries through the same
 * commands the app uses. Nothing here calls the offline batch: the manager
 * plays each season with Continue and Quick Sim, the world plays everyone
 * else's fixtures as time passes, and the staged season transition runs when
 * the season is complete.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterAll(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })));

const character = {
  fullName: "Season Tester",
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
  const directory = mkdtempSync(join(tmpdir(), `season-${label}-`));
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

const count = (db: GameDatabase, sql: string, ...params: unknown[]): number =>
  (db.prepare(sql).get(...(params as [])) as { n: number }).n;

/** Plays the manager's season the way a player does: Continue, then Quick Sim on matchday, until the season is complete. */
const playManagerSeason = (service: DesktopApplicationService): { continues: number; matches: number } => {
  let continues = 0;
  let matches = 0;
  for (let guard = 0; guard < 600; guard += 1) {
    const status = service.getSeasonStatus();
    if (!status.ok) throw new Error(status.error.message);
    if (status.data.phase !== "IN_PROGRESS") return { continues, matches };
    const step = service.continueCareer();
    if (!step.ok) throw new Error(`continue failed: ${step.error.code} ${step.error.message} ${(step.error as { detail?: string }).detail ?? ""}`);
    continues += 1;
    if (service.quickSimMatch().ok) matches += 1;
  }
  throw new Error("The season never completed.");
};

const runTransition = (service: DesktopApplicationService) => {
  const stages: Array<{ done: number; phase: string }> = [];
  for (let guard = 0; guard < 40; guard += 1) {
    const step = service.advanceSeasonTransition();
    if (!step.ok) throw new Error(`${step.error.code}: ${step.error.message}`);
    stages.push({ done: step.data.seasonStatus.transition?.completedStages ?? -1, phase: step.data.seasonStatus.phase });
    if (step.data.seasonStatus.phase === "TRANSITION_FAILED") throw new Error(step.data.seasonStatus.transition?.error ?? "stage failed");
    if (step.data.finished) return { stages, state: step.data.state! };
  }
  throw new Error("The transition never finished.");
};

describe("a real desktop save across three seasons", () => {
  it("plays, closes and rolls over three consecutive seasons with correct tables, movement and world progress", () => {
    const service = newService("three");
    const created = service.createCareer({ saveName: "three seasons", character });
    if (!created.ok) throw new Error(created.error.message);
    const savePath = created.data.catalogEntry.filePath;
    const seasonIdsSeen = new Set<string>();
    const timings: Array<Record<string, unknown>> = [];

    // A transition cannot start early.
    const early = service.advanceSeasonTransition();
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.error.code).toBe("SEASON_NOT_COMPLETE");

    for (let season = 1; season <= 3; season += 1) {
      const startedAt = Date.now();
      const played = playManagerSeason(service);
      const playSeconds = Math.round((Date.now() - startedAt) / 1000);
      expect(played.matches).toBeGreaterThan(10);

      const status = service.getSeasonStatus();
      if (!status.ok) throw new Error(status.error.message);
      expect(status.data.phase).toBe("COMPLETE");
      expect(status.data.competitions.completed).toBe(status.data.competitions.total);
      expect(status.data.summary?.champion).toBeTruthy();

      // Every competition's table is the whole season's table, not the last match.
      service.closeCareer();
      withDb(savePath, (db) => {
        const seasons = db
          .prepare("SELECT cs.id, cs.name FROM competition_seasons cs JOIN competition_season_states s ON s.competition_season_id = cs.id WHERE s.status = 'COMPLETED'")
          .all() as Array<{ id: EntityId; name: string }>;
        expect(seasons.length).toBe(status.data.competitions.total);
        for (const item of seasons) {
          seasonIdsSeen.add(item.id);
          const unplayed = count(db, "SELECT COUNT(*) AS n FROM fixtures WHERE competition_season_id = ? AND status != 'played'", item.id);
          expect(unplayed, `${item.name} has unplayed fixtures`).toBe(0);
          const table = db.prepare("SELECT team_id, played, points, goals_for, goals_against FROM league_standings WHERE competition_season_id = ?").all(item.id) as Array<{ team_id: EntityId; played: number; points: number; goals_for: number; goals_against: number }>;
          expect(table.length).toBeGreaterThan(1);
          for (const row of table) {
            const matchesPlayed = count(db, "SELECT COUNT(*) AS n FROM matches m JOIN fixtures f ON f.id = m.fixture_id WHERE f.competition_season_id = ? AND (f.home_team_id = ? OR f.away_team_id = ?)", item.id, row.team_id, row.team_id);
            expect(row.played, `${item.name}: standings played vs stored matches`).toBe(matchesPlayed);
          }
          expect(table.reduce((sum, row) => sum + row.goals_for, 0)).toBe(table.reduce((sum, row) => sum + row.goals_against, 0));
        }
        // Player season stats accumulate across the season.
        const mostAppearances = count(db, "SELECT MAX(appearances) AS n FROM player_season_stats");
        expect(mostAppearances).toBeGreaterThan(10);
      });
      expect(service.loadCareerByPath(savePath).ok).toBe(true);

      const before = withDb(savePath, (db) => ({
        people: count(db, "SELECT COUNT(*) AS n FROM persons"),
        youthEvents: count(db, "SELECT COUNT(*) AS n FROM youth_intake_events"),
        movements: count(db, "SELECT COUNT(*) AS n FROM competition_movements WHERE status = 'APPLIED'"),
        editions: count(db, "SELECT COUNT(*) AS n FROM international_competition_editions"),
      }));

      const transitionStartedAt = Date.now();
      const { stages, state } = runTransition(service);
      const transitionSeconds = Math.round((Date.now() - transitionStartedAt) / 1000);
      expect(stages.map((stage) => stage.done)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, -1].slice(0, stages.length));
      expect(state.seasonStatus?.phase).toBe("IN_PROGRESS");

      // The same transition cannot run a second time.
      const again = service.advanceSeasonTransition();
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe("SEASON_NOT_COMPLETE");

      service.closeCareer();
      withDb(savePath, (db) => {
        // Finished seasons are rolled over; the next ones exist, with fixtures and members.
        const rolled = count(db, "SELECT COUNT(*) AS n FROM competition_season_states WHERE status = 'ROLLED_OVER'");
        expect(rolled).toBe(season * status.data.competitions.total);
        const next = db
          .prepare("SELECT cs.id, cs.name FROM competition_seasons cs JOIN competition_season_states s ON s.competition_season_id = cs.id WHERE s.status != 'ROLLED_OVER'")
          .all() as Array<{ id: EntityId; name: string }>;
        expect(next.length).toBe(status.data.competitions.total);
        for (const item of next) {
          expect(seasonIdsSeen.has(item.id)).toBe(false);
          expect(count(db, "SELECT COUNT(*) AS n FROM fixtures WHERE competition_season_id = ?", item.id), `${item.name} fixtures`).toBeGreaterThan(0);
          expect(count(db, "SELECT COUNT(*) AS n FROM club_memberships WHERE competition_season_id = ?", item.id), `${item.name} members`).toBeGreaterThan(1);
        }
        // Promotion and relegation moved clubs; youth intake ran once for this season.
        expect(count(db, "SELECT COUNT(*) AS n FROM competition_movements WHERE status = 'APPLIED'")).toBeGreaterThan(before.movements);
        expect(count(db, "SELECT COUNT(*) AS n FROM persons")).toBeGreaterThan(before.people);
        expect(count(db, "SELECT COUNT(*) AS n FROM youth_intake_events")).toBeGreaterThan(before.youthEvents);
        // The offline batch was never involved: every transition is one completed row.
        expect(count(db, "SELECT COUNT(*) AS n FROM season_transitions WHERE status = 'COMPLETED'")).toBe(season);
        expect(count(db, "SELECT COUNT(*) AS n FROM season_transitions WHERE status != 'COMPLETED'")).toBe(0);
        timings.push({
          season,
          playSeconds,
          transitionSeconds,
          worldDate: (db.prepare("SELECT world_date AS d FROM saves LIMIT 1").get() as { d: string }).d,
          fileMB: +(statSync(savePath).size / 1048576).toFixed(1),
          editions: count(db, "SELECT COUNT(*) AS n FROM international_competition_editions"),
          campaigns: count(db, "SELECT COUNT(*) AS n FROM national_team_campaigns"),
          federationLedger: count(db, "SELECT COUNT(*) AS n FROM federation_ledger_entries"),
          fixturesPlayed: count(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'played'"),
        });
      });
      // Saving and loading between seasons keeps everything.
      expect(service.loadCareerByPath(savePath).ok).toBe(true);
      const resumed = service.continueCareer();
      expect(resumed.ok).toBe(true);
    }

    console.log("SEASON_TIMINGS " + JSON.stringify(timings));
    // Season two is an odd calendar year: the youth and qualification editions ran, and Nepal's teams were entered in them.
    expect(Number(timings[timings.length - 1]!.editions)).toBeGreaterThan(0);
    expect(Number(timings[timings.length - 1]!.campaigns)).toBeGreaterThan(0);
    service.closeCareer();
  }, 3_600_000);
});
