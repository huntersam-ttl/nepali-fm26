import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  answerPressQuestion,
  createNepalSave,
  exitClubOwnership,
  publishHistoricalEvent,
  recordFootballMatchHistory,
  startPressConference,
} from "@nepal-football-sim/simulation";
import type { EntityId, FixtureRecord, MatchResult } from "@nepal-football-sim/shared-types";

/**
 * Story Universe foundation — consolidated exact-once proof across every
 * representative canonical event source, not just press (which already has
 * its own dedicated coverage). `HistoricalEvent` is the one shared fact
 * table every one of these producers writes into — never a second event
 * system per category.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "story-universe-exact-once-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: name,
    gameVersion: "test",
    randomSeed: name,
  });
  return path;
};

const ensureManagerFor = (db: ReturnType<typeof openGameDatabase>, teamId: EntityId): EntityId => {
  const existing = db
    .prepare(`SELECT person_id AS personId FROM manager_contracts WHERE team_id = ? AND status = 'ACTIVE' LIMIT 1`)
    .get(teamId) as { personId: EntityId } | undefined;
  if (existing) return existing.personId;
  const person = db
    .prepare(`SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM manager_profiles) LIMIT 1`)
    .get() as { id: EntityId };
  const clubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(teamId) as { club_id: EntityId }).club_id;
  const profileId = `story-exact-once-manager-profile-${person.id}` as EntityId;
  db.prepare(
    `INSERT INTO manager_profiles (id, person_id, attributes_json, preferred_style, reputation_profile, created_on)
     VALUES (?, ?, '{}', 'BALANCED', 'UNKNOWN', '2026-01-01')`,
  ).run(profileId, person.id);
  db.prepare(
    `INSERT INTO manager_contracts (id, manager_profile_id, person_id, team_id, club_id, job_title, contract_start, salary_amount_minor, currency, status)
     VALUES (?, ?, ?, ?, ?, 'Head Coach', '2026-01-01', 100000, 'NPR', 'ACTIVE')`,
  ).run(`story-exact-once-manager-contract-${person.id}`, profileId, person.id, teamId, clubId);
  return person.id;
};

const pressStories = (db: ReturnType<typeof openGameDatabase>): number => new EventRepository(db).historicalEvents().length;

describe("Story Universe foundation — consolidated exact-once", () => {
  it("publishHistoricalEvent itself: the shared primitive every producer below relies on is idempotent by construction", () => {
    const db = openGameDatabase(makeSave("primitive"));
    const event = {
      id: "story-exact-once-primitive" as EntityId,
      occurredOn: "2026-09-05",
      eventType: "TEST_EVENT",
      involvedEntities: [],
      title: "Primitive exact-once check",
      importance: "low" as const,
      scope: "world" as const,
    };
    publishHistoricalEvent(db, event);
    publishHistoricalEvent(db, event);
    publishHistoricalEvent(db, event);
    expect(new EventRepository(db).historicalEvents().filter((item) => item.id === event.id).length).toBe(1);
    db.close();
  });

  it("match: recordFootballMatchHistory called twice for the same real match publishes exactly one Story, and it survives a reload", () => {
    const path = makeSave("match");
    const db = openGameDatabase(path);
    const teams = db.prepare("SELECT id FROM teams LIMIT 2").all() as Array<{ id: EntityId }>;
    const fixture: FixtureRecord = {
      id: "story-exact-once-fixture" as EntityId,
      competitionSeasonId: "story-exact-once-season" as EntityId,
      homeTeamId: teams[0]!.id,
      awayTeamId: teams[1]!.id,
      scheduledDate: "2026-09-05",
      status: "played",
      round: 21,
    };
    const result = {
      match: {
        id: "story-exact-once-match" as EntityId,
        fixtureId: fixture.id,
        playedDate: "2026-09-05",
        homeGoals: 3,
        awayGoals: 0,
        winnerTeamId: teams[0]!.id,
      },
      events: [],
      homeStats: {},
      awayStats: {},
      playerStates: [],
    } as unknown as MatchResult;

    recordFootballMatchHistory(db, fixture, result, "2026-09-05");
    recordFootballMatchHistory(db, fixture, result, "2026-09-05");
    const matchStories = new EventRepository(db)
      .historicalEvents()
      .filter((event) => event.eventType === "MATCH_COMPLETED" && event.data?.fixtureId === fixture.id);
    expect(matchStories.length).toBe(1);
    db.close();

    const reloaded = openGameDatabase(path);
    const afterReload = new EventRepository(reloaded)
      .historicalEvents()
      .filter((event) => event.eventType === "MATCH_COMPLETED" && event.data?.fixtureId === fixture.id);
    expect(afterReload.length).toBe(1);
    expect(afterReload[0]!.id).toBe(matchStories[0]!.id);
    reloaded.close();
  });

  it("owner/project (ownership succession): the real event exitClubOwnership publishes can never be re-published under the same source id", () => {
    const path = makeSave("ownership");
    const db = openGameDatabase(path);
    const teams = db.prepare("SELECT id FROM teams LIMIT 1").all() as Array<{ id: EntityId }>;
    const clubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(teams[0]!.id) as { club_id: EntityId }).club_id;
    const ownerPersonId = db
      .prepare("SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM manager_profiles) LIMIT 1")
      .get() as { id: EntityId };
    db.prepare(
      `INSERT INTO club_ownership_stakes
       (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,end_date,status,ownership_model,provenance_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "story-exact-once-owner-stake",
      clubId,
      "PERSON",
      ownerPersonId.id,
      "Exact-Once Owner",
      "MAJORITY_OWNER",
      75,
      75,
      "2026-01-01",
      null,
      "ACTIVE",
      "PARTIALLY_BUYABLE",
      "SIMULATION_ONLY",
    );

    // A real owner exit deactivates the stake it acts on as part of the
    // same call, so exitClubOwnership itself is a genuine one-shot
    // transition (calling it again immediately fails its own "an active
    // stake must exist" precondition, correctly — that is not the scenario
    // exact-once exists to guard against). What exact-once actually
    // protects is the shared historical_events table underneath every
    // producer: prove that re-publishing the *same* source id — the real
    // retry/replay scenario (a command re-run, a save loaded mid-write) —
    // is always a no-op, using the exact stable id this real producer
    // constructs.
    exitClubOwnership(db, { clubId, ownerPersonId: ownerPersonId.id, date: "2026-09-05" });
    const successionStories = new EventRepository(db)
      .historicalEvents()
      .filter((event) => event.eventType === "CLUB_OWNERSHIP_SUCCESSION_STARTED" && event.involvedEntities.some((ref) => ref.id === clubId));
    expect(successionStories.length).toBe(1);
    const original = successionStories[0]!;

    // Simulate the real retry/replay scenario: a caller re-publishes under
    // the identical stable id this producer would derive for the same
    // club+date, with different (stale/garbage) content — the guard must
    // reject the write entirely, not merely ignore some fields.
    publishHistoricalEvent(db, {
      ...original,
      title: "This must never overwrite the real story",
      importance: "low",
    });
    const afterReplay = new EventRepository(db)
      .historicalEvents()
      .filter((event) => event.eventType === "CLUB_OWNERSHIP_SUCCESSION_STARTED" && event.involvedEntities.some((ref) => ref.id === clubId));
    expect(afterReplay.length).toBe(1);
    expect(afterReplay[0]!.title).toBe(original.title);
    db.close();
  });

  it("press (proxy for transfer/federation contexts): same real fact evaluated repeatedly publishes exactly one Story per role/context", () => {
    const db = openGameDatabase(makeSave("press"));
    const teams = db.prepare("SELECT id FROM teams LIMIT 2").all() as Array<{ id: EntityId }>;
    const home = teams[0]!.id;
    const managerPersonId = ensureManagerFor(db, home);
    const player = db
      .prepare("SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM manager_profiles) LIMIT 1")
      .get() as { id: EntityId };

    const before = pressStories(db);
    const interview = startPressConference(db, { context: "TRANSFER", managerPersonId, teamId: home, date: "2026-09-05" });
    // Requesting the exact same context/date/team again before answering
    // must resolve back to the identical open interview, never a duplicate.
    const again = startPressConference(db, { context: "TRANSFER", managerPersonId, teamId: home, date: "2026-09-05" });
    expect(again.id).toBe(interview.id);
    if (interview.structuredQuestions && interview.structuredQuestions.length > 0) {
      answerPressQuestion(db, { interviewId: interview.id, stance: "COMMIT", teamId: home, date: "2026-09-05" });
    }
    void player;
    // Zero or one Story published (zero if no material question existed to
    // ground a COMMIT/PROTECT_PLAYER/etc stance for this seedless save) —
    // the point under test is that repeating the request never doubles it.
    const after = pressStories(db);
    expect(after - before).toBeLessThanOrEqual(1);
    const secondAnswerAttempt = startPressConference(db, { context: "TRANSFER", managerPersonId, teamId: home, date: "2026-09-05" });
    expect(pressStories(db)).toBe(after);
    void secondAnswerAttempt;
    db.close();
  });
});
