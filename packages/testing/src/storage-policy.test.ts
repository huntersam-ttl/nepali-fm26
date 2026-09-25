import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CURRENT_DATABASE_VERSION, RecruitmentRepository, maxAppliedSchemaVersion, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  COMPACTED_EVENT_TYPES,
  DesktopApplicationService,
  buildPostMatchReport,
  compactOldMatchEvents,
  compactResolvedInterviews,
  matchAnalytics,
  teamAnalyticsForSeason,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 11B: the save-growth policy changes what is stored, never what happened.
 * A real save plays two seasons through the production path; the finished first
 * season's background matches are compacted when the second season is rolled over.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterAll(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })));

const character = {
  fullName: "Storage Tester",
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

const withDb = <T,>(savePath: string, run: (db: GameDatabase) => T): T => {
  const db = openGameDatabase(savePath);
  try {
    return run(db);
  } finally {
    db.close();
  }
};
const count = (db: GameDatabase, sql: string, ...params: unknown[]): number => (db.prepare(sql).get(...(params as [])) as { n: number }).n;

const playSeason = (service: DesktopApplicationService): void => {
  for (let guard = 0; guard < 700; guard += 1) {
    const status = service.getSeasonStatus();
    if (!status.ok) throw new Error(status.error.message);
    if (status.data.phase !== "IN_PROGRESS") return;
    const step = service.continueCareer();
    if (!step.ok) throw new Error(`continue: ${step.error.code} ${step.error.message} ${String((step.error as { detail?: unknown }).detail)}`);
    service.quickSimMatch();
  }
  throw new Error("The season never completed.");
};
const transition = (service: DesktopApplicationService): void => {
  for (let guard = 0; guard < 40; guard += 1) {
    const step = service.advanceSeasonTransition();
    if (!step.ok) throw new Error(`${step.error.code}: ${step.error.message}`);
    if (step.data.seasonStatus.phase === "TRANSITION_FAILED") throw new Error(step.data.seasonStatus.transition?.error ?? "failed");
    if (step.data.finished) return;
  }
  throw new Error("The transition never finished.");
};

const removedTypes = COMPACTED_EVENT_TYPES.map((type) => `'${type}'`).join(",");

describe("the save-growth policy on a real two-season save", () => {
  it("compacts old background matches without changing any statistic, and never touches the rest", () => {
    const directory = mkdtempSync(join(tmpdir(), "storage-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const created = service.createCareer({ saveName: "storage", character });
    if (!created.ok) throw new Error(created.error.message);
    const savePath = created.data.catalogEntry.filePath;

    // Season one, then its transition: nothing may be compacted yet (it is the latest finished season).
    playSeason(service);
    transition(service);
    service.closeCareer();

    const before = withDb(savePath, (db) => {
      expect(maxAppliedSchemaVersion(db)).toBe(CURRENT_DATABASE_VERSION);
      expect(count(db, "SELECT COUNT(*) AS n FROM match_event_compactions")).toBe(0);
      const humanClubs = db.prepare("SELECT DISTINCT club_id AS id FROM manager_contracts WHERE person_id IN (SELECT person_id FROM career_characters)").all() as Array<{ id: EntityId }>;
      expect(humanClubs.length).toBeGreaterThan(0);
      const humanTeams = new Set((db.prepare(`SELECT id FROM teams WHERE club_id IN (${humanClubs.map(() => "?").join(",")})`).all(...humanClubs.map((c) => c.id)) as Array<{ id: EntityId }>).map((row) => row.id));
      const matches = db
        .prepare(
          `SELECT m.id AS id, f.id AS fixtureId, f.home_team_id AS home, f.away_team_id AS away, f.competition_season_id AS season
           FROM matches m JOIN fixtures f ON f.id = m.fixture_id ORDER BY m.id`,
        )
        .all() as Array<{ id: EntityId; fixtureId: EntityId; home: EntityId; away: EntityId; season: EntityId }>;
      const background = matches.filter((match) => !humanTeams.has(match.home) && !humanTeams.has(match.away));
      const human = matches.filter((match) => humanTeams.has(match.home) || humanTeams.has(match.away));
      expect(background.length).toBeGreaterThan(100);
      expect(human.length).toBeGreaterThan(10);
      const sample = background.filter((_, index) => index % 9 === 0).slice(0, 60);
      return {
        seasonIds: [...new Set(matches.map((match) => match.season))],
        sample,
        humanSample: human.slice(0, 5),
        analytics: sample.map((match) => JSON.stringify(matchAnalytics(db, match.id))),
        reports: sample.map((match) => JSON.stringify(buildPostMatchReport(db, match.fixtureId, match.home, "League")?.stats)),
        seasonAnalytics: Object.fromEntries(
          [...new Set(sample.map((match) => `${match.season}|${match.home}`))].map((key) => {
            const [season, team] = key.split("|") as [EntityId, EntityId];
            return [key, JSON.stringify(teamAnalyticsForSeason(db, season, team))];
          }),
        ),
        goalEvents: sample.map((match) => count(db, "SELECT COUNT(*) AS n FROM match_events WHERE match_id = ? AND type = 'GOAL'", match.id)),
        totalsBefore: {
          standings: JSON.stringify(db.prepare("SELECT * FROM league_standings ORDER BY competition_season_id, team_id").all()),
          playerStats: JSON.stringify(db.prepare("SELECT * FROM player_season_stats ORDER BY 1, 2, 3").all()),
          results: JSON.stringify(db.prepare("SELECT fixture_id, home_goals, away_goals FROM matches ORDER BY fixture_id").all()),
          ledger: count(db, "SELECT COUNT(*) AS n FROM club_ledger_entries"),
          federationLedger: count(db, "SELECT COUNT(*) AS n FROM federation_ledger_entries"),
          media: count(db, "SELECT COUNT(*) AS n FROM media_stories"),
          history: count(db, "SELECT COUNT(*) AS n FROM historical_events"),
          transfers: count(db, "SELECT COUNT(*) AS n FROM transfer_history_events"),
          timeline: count(db, "SELECT COUNT(*) AS n FROM career_timeline_events"),
          ratings: count(db, "SELECT COUNT(*) AS n FROM player_match_ratings"),
          matches: count(db, "SELECT COUNT(*) AS n FROM matches"),
          applications: count(db, "SELECT COUNT(*) AS n FROM manager_job_applications"),
        },
        eventsBefore: count(db, "SELECT COUNT(*) AS n FROM match_events"),
      };
    });

    // Season two and its transition: season one's background matches are now compactable.
    service.loadCareerByPath(savePath);
    playSeason(service);
    transition(service);
    service.closeCareer();

    withDb(savePath, (db) => {
      const compacted = count(db, "SELECT COUNT(*) AS n FROM match_event_compactions");
      expect(compacted, "background matches of the finished first season were compacted").toBeGreaterThan(100);
      const removed = count(db, "SELECT SUM(events_removed) AS n FROM match_event_compactions");
      expect(removed).toBeGreaterThan(compacted * 15);
      expect(count(db, `SELECT COUNT(*) AS n FROM match_events WHERE match_id IN (SELECT match_id FROM match_event_compactions) AND type IN (${removedTypes})`)).toBe(0);

      // Every statistic reads exactly as before, from the stored totals.
      let compactedSampled = 0;
      before.sample.forEach((match, index) => {
        const isCompacted = count(db, "SELECT COUNT(*) AS n FROM match_event_compactions WHERE match_id = ?", match.id) === 1;
        if (!isCompacted) return;
        compactedSampled += 1;
        expect(JSON.stringify(matchAnalytics(db, match.id)), `analytics for ${match.id}`).toBe(before.analytics[index]);
        expect(JSON.stringify(buildPostMatchReport(db, match.fixtureId, match.home, "League")?.stats), `report stats for ${match.id}`).toBe(before.reports[index]);
        // Goals, and so scorers and the score, are never compacted.
        expect(count(db, "SELECT COUNT(*) AS n FROM match_events WHERE match_id = ? AND type = 'GOAL'", match.id)).toBe(before.goalEvents[index]);
      });
      expect(compactedSampled).toBeGreaterThan(20);
      for (const [key, snapshot] of Object.entries(before.seasonAnalytics)) {
        const [season, team] = key.split("|") as [EntityId, EntityId];
        expect(JSON.stringify(teamAnalyticsForSeason(db, season, team)), `season analytics ${key}`).toBe(snapshot);
      }

      // The human's own matches keep every event, and so does the latest finished season.
      for (const match of before.humanSample) {
        expect(count(db, "SELECT COUNT(*) AS n FROM match_event_compactions WHERE match_id = ?", match.id)).toBe(0);
      }
      const latest = db.prepare("SELECT DISTINCT f.competition_season_id AS id FROM fixtures f WHERE f.competition_season_id NOT IN (" + before.seasonIds.map(() => "?").join(",") + ")").all(...before.seasonIds) as Array<{ id: EntityId }>;
      expect(latest.length).toBeGreaterThan(0);
      for (const season of latest) {
        expect(count(db, "SELECT COUNT(*) AS n FROM match_event_compactions c JOIN matches m ON m.id = c.match_id JOIN fixtures f ON f.id = m.fixture_id WHERE f.competition_season_id = ?", season.id)).toBe(0);
      }

      // Nothing that is history changed or shrank.
      expect(JSON.stringify(db.prepare("SELECT * FROM league_standings WHERE competition_season_id IN (" + before.seasonIds.map(() => "?").join(",") + ") ORDER BY competition_season_id, team_id").all(...before.seasonIds))).toBe(
        JSON.stringify((JSON.parse(before.totalsBefore.standings) as Array<{ competition_season_id: string }>).filter((row) => before.seasonIds.includes(row.competition_season_id as EntityId))),
      );
      expect(JSON.stringify(db.prepare("SELECT fixture_id, home_goals, away_goals FROM matches WHERE fixture_id IN (" + before.sample.map(() => "?").join(",") + ") ORDER BY fixture_id").all(...before.sample.map((m) => m.fixtureId)))).toBe(
        JSON.stringify((JSON.parse(before.totalsBefore.results) as Array<{ fixture_id: string }>).filter((row) => before.sample.some((m) => m.fixtureId === row.fixture_id))),
      );
      expect(count(db, "SELECT COUNT(*) AS n FROM matches")).toBeGreaterThanOrEqual(before.totalsBefore.matches);
      for (const [table, floor] of [
        ["club_ledger_entries", before.totalsBefore.ledger],
        ["federation_ledger_entries", before.totalsBefore.federationLedger],
        ["media_stories", before.totalsBefore.media],
        ["historical_events", before.totalsBefore.history],
        ["transfer_history_events", before.totalsBefore.transfers],
        ["career_timeline_events", before.totalsBefore.timeline],
        ["player_match_ratings", before.totalsBefore.ratings],
      ] as const) {
        expect(count(db, `SELECT COUNT(*) AS n FROM ${table}`), table).toBeGreaterThanOrEqual(floor);
      }

      // The policy is idempotent, and re-opening the save duplicates no migration, index or row.
      // Resolved background interviews older than a year are gone with their memories; the decisions stay.
      const cutoff = (db.prepare("SELECT date(MAX(from_season_end_date), '-1 year') AS d FROM season_transitions").get() as { d: string }).d;
      const protectedOld = `
        AND (json_extract(u.data_json, '$.initiator.entityId') IN (SELECT person_id FROM career_characters)
          OR json_extract(u.data_json, '$.organisationId') IN (SELECT club_id FROM manager_contracts WHERE person_id IN (SELECT person_id FROM career_characters))
          OR EXISTS (SELECT 1 FROM manager_job_applications a WHERE a.vacancy_id = u.linked_id AND a.person_id = json_extract(u.data_json, '$.initiator.entityId') AND a.status IN ('OFFERED','ACCEPTED')))`;
      const oldInterviews = count(db, "SELECT COUNT(*) AS n FROM universal_interactions u WHERE interaction_type = 'MANAGER_INTERVIEW' AND json_extract(u.data_json, '$.worldDate') < ?", cutoff);
      expect(count(db, `SELECT COUNT(*) AS n FROM universal_interactions u WHERE interaction_type = 'MANAGER_INTERVIEW' AND json_extract(u.data_json, '$.worldDate') < ? ${protectedOld}`, cutoff), "every old interview left is protected").toBe(oldInterviews);
      expect(count(db, "SELECT COUNT(*) AS n FROM universal_interactions WHERE interaction_type = 'MANAGER_INTERVIEW' AND json_extract(data_json, '$.worldDate') >= ?", cutoff)).toBeGreaterThan(0);
      expect(count(db, "SELECT COUNT(*) AS n FROM interaction_memories")).toBe(count(db, "SELECT COUNT(*) AS n FROM universal_interactions"));
      expect(count(db, "SELECT COUNT(*) AS n FROM manager_job_applications")).toBeGreaterThanOrEqual(before.totalsBefore.applications);
      expect(compactResolvedInterviews(db, "2029-01-01")).toBeGreaterThanOrEqual(0);
      expect(compactResolvedInterviews(db, "2029-01-01")).toBe(0);

      const summariesBefore = count(db, "SELECT COUNT(*) AS n FROM match_team_summaries");
      expect(compactOldMatchEvents(db, "2029-01-01")).toEqual({ matchesCompacted: 0, eventsRemoved: 0 });
      expect(count(db, "SELECT COUNT(*) AS n FROM match_team_summaries")).toBe(summariesBefore);
      expect(count(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'idx_match_events_match'")).toBe(1);
      expect(count(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('idx_team_person_assignments_team','idx_manager_job_applications_profile','idx_media_stories_source','idx_player_potentials_player')")).toBe(4);
      expect(count(db, "SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 102")).toBe(1);
      expect((db.prepare("SELECT database_version AS v FROM saves").get() as { v: number }).v).toBe(CURRENT_DATABASE_VERSION);
      expect((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    });
    withDb(savePath, (db) => {
      expect(count(db, "SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 102")).toBe(1);
    });
    // The compacted save still loads and plays on.
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    expect(service.continueCareer().ok).toBe(true);
    service.closeCareer();
  }, 3_600_000);

  it("keeps one knowledge row per club and player however often it is updated", () => {
    const directory = mkdtempSync(join(tmpdir(), "storage-knowledge-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const created = service.createCareer({ saveName: "knowledge", character });
    if (!created.ok) throw new Error(created.error.message);
    const savePath = created.data.catalogEntry.filePath;
    service.closeCareer();
    withDb(savePath, (db) => {
      const recruitment = new RecruitmentRepository(db);
      const club = (db.prepare("SELECT observer_organisation_id AS id FROM player_knowledge GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1").get() as { id: EntityId }).id;
      const first = recruitment.playerKnowledgeForClub(club)[0]!;
      const rows = count(db, "SELECT COUNT(*) AS n FROM player_knowledge");
      for (let round = 1; round <= 5; round += 1) {
        recruitment.upsertPlayerKnowledge({ ...first, id: `other-id-${round}` as EntityId, observations: first.observations + round, updatedAt: `2026-09-0${round}` });
      }
      expect(count(db, "SELECT COUNT(*) AS n FROM player_knowledge")).toBe(rows);
      expect(count(db, "SELECT COUNT(*) AS n FROM player_knowledge WHERE observer_type = 'CLUB' AND observer_organisation_id = ? AND player_id = ?", club, first.playerId)).toBe(1);
      const current = recruitment.playerKnowledge(club, first.playerId)!;
      expect(current.observations).toBe(first.observations + 5);
      expect(current.id).toBe(first.id);
      expect(
        count(db, "SELECT COUNT(*) AS n FROM (SELECT 1 FROM player_knowledge GROUP BY observer_type, observer_organisation_id, player_id HAVING COUNT(*) > 1)"),
      ).toBe(0);
    });
  }, 300_000);
});
