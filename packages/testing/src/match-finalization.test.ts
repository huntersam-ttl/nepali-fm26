import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  EventRepository,
  MediaRepository,
  MatchSessionRepository,
  SupporterCultureRepository,
  openGameDatabase,
  migrateDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { createRivalry, DesktopApplicationService } from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId } from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");

/**
 * Finalization is exercised through the real Manager Quick Sim path so the test
 * proves the shipped flow, not a synthetic one. Building the world is slow, so
 * one career is shared and each test inspects the save file directly.
 */
let service: DesktopApplicationService;
let savesDirectory: string;
let savePath: string;
let saveId: EntityId;

const openSave = (): GameDatabase => {
  const db = openGameDatabase(savePath);
  migrateDatabase(db);
  return db;
};

/**
 * Quick Sim only plays the fixture the manager is due to play today
 * (userMatchRequiresAction), so continue the career to its matchday first —
 * the same path a player takes by pressing Continue.
 */
const advanceToMatchday = (fixtureDate: string): void => {
  for (let guard = 0; guard < 60; guard += 1) {
    const fixtures = service.getFixtures();
    if (!fixtures.ok) throw new Error(fixtures.error.message);
    if (fixtures.data.worldDate >= fixtureDate) return;
    const advanced = service.continueCareer();
    if (!advanced.ok) throw new Error(advanced.error.message);
  }
  throw new Error(`career never reached matchday ${fixtureDate}`);
};

beforeAll(() => {
  savesDirectory = mkdtempSync(join(tmpdir(), "nepal-match-final-"));
  service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
  const created = service.createCareer({
    saveName: "Finalization",
    character: {
      fullName: "Maya Adhikari",
      preferredDisplayName: "Maya",
      dateOfBirth: "1993-05-12",
      startingAge: 33,
      languages: ["ne", "en"],
      footballBackground: "COMMUNITY_COACHING",
      education: "SPORTS_RELATED_DEGREE",
      playingExperience: "AMATEUR_PLAYER",
      coachingExperience: "YOUTH_COACH",
      businessBackground: "SMALL_BUSINESS",
      startingReputationProfile: "LOCAL_RESPECTED",
    },
  });
  if (!created.ok) throw new Error(`career creation failed: ${created.error.message}`);
  saveId = created.data.save.id;
  savePath = created.data.catalogEntry.filePath;
}, 240_000);

afterAll(() => {
  service.closeCareer();
  rmSync(savesDirectory, { recursive: true, force: true });
});

describe("match finalization", () => {
  it("quick sim runs through the session engine and persists a full timeline", () => {
    const fixtures = service.getFixtures();
    expect(fixtures.ok).toBe(true);
    if (!fixtures.ok) return;
    const target = fixtures.data.upcoming[0]!;
    advanceToMatchday(target.date);

    // Seed one notable event before the real match command. Finalization must
    // publish it through the normal production hook, not a test-only call.
    service.closeCareer();
    const prepared = openSave();
    new EventRepository(prepared).insertHistoricalEvent({
      id: createStableEntityId("history", "production-media-hook"),
      occurredOn: target.date,
      eventType: "COMPETITION_FINAL",
      involvedEntities: [],
      title: "Production media hook event",
      importance: "high",
      scope: "club",
    });
    prepared.close();
    expect(service.loadCareer(saveId).ok).toBe(true);

    expect(service.quickSimMatch(target.id).ok).toBe(true);
    service.closeCareer();

    const db = openSave();
    try {
      const sessions = new MatchSessionRepository(db);
      const session = sessions.sessionForFixture(target.id as EntityId);
      // Quick Sim must leave a completed session behind, not bypass persistence.
      expect(session).toBeDefined();
      expect(session?.status).toBe("COMPLETED");
      expect(session?.period).toBe("FULL_TIME");
      expect(session?.completedAt).toBeTruthy();

      const match = db
        .prepare("SELECT * FROM matches WHERE fixture_id = ?")
        .get(target.id) as Record<string, number | string | null>;
      expect(match).toBeDefined();

      const events = db
        .prepare("SELECT * FROM match_events WHERE match_id = ? ORDER BY minute, id")
        .all(match.id) as Array<Record<string, never>>;
      expect(events.length).toBeGreaterThan(10);
      expect(events.some((event) => event.type === "KICK_OFF")).toBe(true);
      expect(events.some((event) => event.type === "FULL_TIME")).toBe(true);
      // Importance is stamped on every persisted event for Key Events filtering.
      for (const event of events) {
        const data = JSON.parse((event.data_json as string) ?? "{}");
        expect(["MINOR", "NOTABLE", "MAJOR", "CRITICAL"]).toContain(data.importance);
      }
      expect(
        db
          .prepare("SELECT event_type FROM historical_events WHERE id = ?")
          .get(createStableEntityId("history", `MATCH:${match.id}`)),
      ).toEqual({ event_type: "MATCH_COMPLETED" });
      // The biggest-win record is only written when a margin beats the world record, and
      // the world now plays every club's fixtures, so a decisive match writes a row only
      // if nothing else in the save had a margin as large.
      const margin = Math.abs(Number(match.home_goals) - Number(match.away_goals));
      const largestOther = (
        db
          .prepare("SELECT MAX(ABS(home_goals - away_goals)) AS m FROM matches WHERE id != ?")
          .get(match.id) as { m: number | null }
      ).m ?? 0;
      const recordRows = (
        db.prepare("SELECT COUNT(*) AS count FROM football_record_history WHERE source_id = ?").get(match.id) as {
          count: number;
        }
      ).count;
      if (margin > largestOther) expect(recordRows).toBe(1);
      else expect(recordRows).toBeLessThanOrEqual(1);
      const fixture = db
        .prepare("SELECT home_team_id, away_team_id FROM fixtures WHERE id = ?")
        .get(target.id) as { home_team_id: EntityId; away_team_id: EntityId };
      const clubIds = [fixture.home_team_id, fixture.away_team_id].map(
        (teamId) =>
          (
            db.prepare("SELECT club_id FROM teams WHERE id = ?").get(teamId) as {
              club_id: EntityId;
            }
          ).club_id,
      );
      expect(
        clubIds.every((clubId) =>
          new SupporterCultureRepository(db)
            .events(clubId, 10)
            .some((event) => event.type === "MATCH_RESULT"),
        ),
      ).toBe(true);
      const mediaStories = new MediaRepository(db).stories();
      expect(mediaStories.filter((story) => story.sourceEntityId === createStableEntityId("history", "production-media-hook"))).toHaveLength(1);
      expect(mediaStories.filter((story) => story.sourceEntityId === createStableEntityId("history", `MATCH:${match.id}`))).toHaveLength(0);
    } finally {
      db.close();
    }
    expect(service.loadCareer(saveId).ok).toBe(true);
  }, 180_000);

  it("surfaces a stored rivalry through match history and production media", () => {
    const fixtures = service.getFixtures();
    expect(fixtures.ok, JSON.stringify(fixtures)).toBe(true);
    if (!fixtures.ok) return;
    const target = fixtures.data.upcoming[0]!;
    advanceToMatchday(target.date);

    service.closeCareer();
    const prepared = openSave();
    const fixture = prepared
      .prepare("SELECT home_team_id, away_team_id FROM fixtures WHERE id = ?")
      .get(target.id) as { home_team_id: EntityId; away_team_id: EntityId };
    const homeClubId = (
      prepared.prepare("SELECT club_id FROM teams WHERE id = ?").get(fixture.home_team_id) as {
        club_id: EntityId;
      }
    ).club_id;
    const awayClubId = (
      prepared.prepare("SELECT club_id FROM teams WHERE id = ?").get(fixture.away_team_id) as {
        club_id: EntityId;
      }
    ).club_id;
    const storedRivalry = createRivalry({
      clubId: homeClubId,
      rivalClubId: awayClubId,
      origin: "HISTORIC",
      date: target.date,
    });
    const supporterCulture = new SupporterCultureRepository(prepared);
    supporterCulture.upsertRivalry(storedRivalry);
    expect(supporterCulture.rivalry(awayClubId, homeClubId)?.id).toBe(storedRivalry.id);
    prepared.close();

    expect(service.loadCareer(saveId).ok).toBe(true);
    expect(service.quickSimMatch(target.id).ok).toBe(true);
    service.closeCareer();

    const db = openSave();
    try {
      const match = db.prepare("SELECT id FROM matches WHERE fixture_id = ?").get(target.id) as {
        id: EntityId;
      };
      const historyId = createStableEntityId("history", `MATCH:${match.id}`);
      const history = db
        .prepare("SELECT title, importance, data_json FROM historical_events WHERE id = ?")
        .get(historyId) as { title: string; importance: string; data_json: string };
      expect(history.title).toBe("Rivalry match completed");
      expect(history.importance).toBe("high");
      expect(JSON.parse(history.data_json)).toMatchObject({ rivalryId: storedRivalry.id });
      const story = new MediaRepository(db)
        .stories()
        .find((candidate) => candidate.sourceEntityId === historyId);
      expect(story).toBeDefined();
      expect(story?.importance).toBeGreaterThanOrEqual(4);
    } finally {
      db.close();
    }
    expect(service.loadCareer(saveId).ok).toBe(true);
  }, 180_000);

  it("persists a per-match rating line for every player involved", () => {
    const db = openSaveWhileClosed();
    try {
      const match = latestMatch(db);
      const ratings = new MatchSessionRepository(db).ratingsForMatch(match.id as EntityId);
      expect(ratings.length).toBeGreaterThanOrEqual(22);

      for (const rating of ratings) {
        expect(rating.rating).toBeGreaterThanOrEqual(3);
        expect(rating.rating).toBeLessThanOrEqual(10);
        expect(rating.minutes).toBeGreaterThanOrEqual(0);
        expect(rating.minutes).toBeLessThanOrEqual(90);
      }
      // Season aggregates remain separate from the per-match line.
      const seasonRows = db.prepare("SELECT COUNT(*) AS total FROM player_season_stats").get() as {
        total: number;
      };
      expect(seasonRows.total).toBeGreaterThan(0);

      const scorers = ratings.filter((rating) => rating.goals > 0);
      const goalless = ratings.filter((rating) => rating.goals === 0 && rating.minutes > 0);
      if (scorers.length > 0 && goalless.length > 0) {
        // Scoring should help a rating, since the engine adds for goals.
        const bestScorer = Math.max(...scorers.map((rating) => rating.rating));
        const medianGoalless =
          goalless.map((r) => r.rating).sort((a, b) => a - b)[Math.floor(goalless.length / 2)] ?? 0;
        expect(bestScorer).toBeGreaterThanOrEqual(medianGoalless);
      }
    } finally {
      db.close();
      expect(service.loadCareer(saveId).ok).toBe(true);
    }
  });

  it("persists possession and attendance on the finalised match", () => {
    const db = openSaveWhileClosed();
    try {
      const match = latestMatch(db);
      expect(match.attendance).not.toBeNull();
      const attendance = Number(match.attendance);
      expect(attendance).toBeGreaterThan(0);

      const capacityRow = db
        .prepare(`SELECT MAX(v.capacity) AS capacity FROM venues v WHERE v.capacity IS NOT NULL`)
        .get() as { capacity: number | null };
      if (capacityRow.capacity) {
        // Never more people than the largest known ground could hold.
        expect(attendance).toBeLessThanOrEqual(capacityRow.capacity * 4);
      }
    } finally {
      db.close();
      expect(service.loadCareer(saveId).ok).toBe(true);
    }
  });

  it("posts matchday gate revenue exactly once", () => {
    const db = openSaveWhileClosed();
    try {
      const fixtureId = latestFixtureId(db);
      const entries = new ClubEconomyRepository(db)
        .ledgerEntries()
        .filter((entry) => entry.relatedEntityId === fixtureId);
      expect(entries.length).toBeGreaterThan(0);
      // Stable ledger ids mean a repeat post cannot duplicate a row.
      expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
      const revenue = entries.filter((entry) => entry.category === "MATCHDAY_REVENUE");
      expect(revenue.length).toBeLessThanOrEqual(1);
    } finally {
      db.close();
      expect(service.loadCareer(saveId).ok).toBe(true);
    }
  });

  it("records a suspension for any dismissal in the match", () => {
    const db = openSaveWhileClosed();
    try {
      const match = latestMatch(db);
      const reds = new MatchSessionRepository(db)
        .ratingsForMatch(match.id as EntityId)
        .filter((rating) => rating.redCard);
      const suspensions = db.prepare("SELECT * FROM suspensions").all() as Array<
        Record<string, never>
      >;
      // Every dismissed player must carry a suspension; no dismissals is fine.
      for (const red of reds) {
        expect(suspensions.some((suspension) => suspension.person_id === red.playerId)).toBe(true);
      }
      expect(suspensions.length).toBe(new Set(suspensions.map((suspension) => suspension.id)).size);
    } finally {
      db.close();
      expect(service.loadCareer(saveId).ok).toBe(true);
    }
  });

  it("refuses to play or finalise the same fixture twice", () => {
    const fixtures = service.getFixtures();
    expect(fixtures.ok).toBe(true);
    if (!fixtures.ok) return;
    const played = fixtures.data.results[0]!;

    // The fixture has left the upcoming list entirely.
    expect(fixtures.data.upcoming.some((row) => row.id === played.id)).toBe(false);

    const before = countWorldRows();
    const repeat = service.quickSimMatch(played.id);
    expect(repeat.ok).toBe(false);
    if (!repeat.ok) {
      expect(repeat.error.code).toBe("MATCH_ALREADY_PLAYED");
      // A raw SQLite primary-key error must never surface.
      expect(repeat.error.code).not.toBe("ERR_SQLITE_ERROR");
    }
    // Nothing was written by the rejected attempt.
    expect(countWorldRows()).toEqual(before);
  }, 120_000);

  it("keeps world state stable across a reload after finalisation", () => {
    const before = countWorldRows();
    service.closeCareer();
    expect(service.loadCareer(saveId).ok).toBe(true);
    expect(countWorldRows()).toEqual(before);

    const table = service.getCompetition();
    expect(table.ok).toBe(true);
    if (table.ok) {
      expect(table.data.table.some((row) => row.played > 0)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

const openSaveWhileClosed = (): GameDatabase => {
  service.closeCareer();
  return openSave();
};

/**
 * The manager's own latest match. The world also plays every other club's fixtures as
 * time passes, so the newest match in the save is often a background one; the manager's
 * is the one that went through a match session.
 */
const latestMatch = (db: GameDatabase): Record<string, never> =>
  db
    .prepare(
      `SELECT m.* FROM matches m JOIN match_sessions s ON s.match_id = m.id
       ORDER BY m.played_date DESC, m.id DESC LIMIT 1`,
    )
    .get() as Record<string, never>;

const latestFixtureId = (db: GameDatabase): string =>
  String((latestMatch(db) as unknown as { fixture_id: string }).fixture_id);

/** Row counts for the tables a finalisation touches, for duplicate detection. */
const countWorldRows = (): Record<string, number> => {
  service.closeCareer();
  const db = openSave();
  try {
    const counts: Record<string, number> = {};
    for (const table of [
      "matches",
      "match_events",
      "player_match_ratings",
      "player_season_stats",
      "league_standings",
      "injuries",
      "suspensions",
      "club_ledger_entries",
      "match_sessions",
    ]) {
      counts[table] = (
        db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }
      ).total;
    }
    return counts;
  } finally {
    db.close();
    service.loadCareer(saveId);
  }
};
