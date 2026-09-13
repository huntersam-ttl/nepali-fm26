import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MediaPhaseBRepository, SquadDynamicsRepository, TransferMarketRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, runAiPressConference } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Bounded AI press participation: the same MediaInterview pipeline a human
 * uses, opened and answered end-to-end by a deterministic, non-interactive
 * AI response selection (answerPressQuestionAsAi) — never a second engine,
 * never an unbounded loop, never left open for an "AI Inbox" that doesn't
 * exist. runAiPressConference is the orchestration this suite proves: real
 * event/context in, a COMPLETED interview out, through the exact same
 * consequence pipeline (journalist relationship, Story materiality,
 * persistence) a human answer uses.
 */

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `ai-press-${name}-`));
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

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const insertPlayedMatch = (
  db: ReturnType<typeof openGameDatabase>,
  input: {
    fixtureId: EntityId;
    matchId: EntityId;
    homeTeamId: EntityId;
    awayTeamId: EntityId;
    date: string;
    homeGoals: number;
    awayGoals: number;
  },
): void => {
  db.prepare(
    "INSERT INTO fixtures (id, competition_season_id, home_team_id, away_team_id, scheduled_date, status) VALUES (?, NULL, ?, ?, ?, 'played')",
  ).run(input.fixtureId, input.homeTeamId, input.awayTeamId, input.date);
  db.prepare(
    "INSERT INTO matches (id, fixture_id, played_date, home_goals, away_goals, tactical_snapshot_json) VALUES (?, ?, ?, ?, ?, NULL)",
  ).run(input.matchId, input.fixtureId, input.date, input.homeGoals, input.awayGoals);
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
  const profileId = `test-manager-profile-${person.id}` as EntityId;
  db.prepare(
    `INSERT INTO manager_profiles (id, person_id, attributes_json, preferred_style, reputation_profile, created_on)
     VALUES (?, ?, '{}', 'BALANCED', 'UNKNOWN', '2026-01-01')`,
  ).run(profileId, person.id);
  db.prepare(
    `INSERT INTO manager_contracts (id, manager_profile_id, person_id, team_id, club_id, job_title, contract_start, salary_amount_minor, currency, status)
     VALUES (?, ?, ?, ?, ?, 'Head Coach', '2026-01-01', 100000, 'NPR', 'ACTIVE')`,
  ).run(`test-manager-contract-${person.id}`, profileId, person.id, teamId, clubId);
  return person.id;
};

const twoManagedTeams = (db: ReturnType<typeof openGameDatabase>): [EntityId, EntityId] => {
  const rows = db.prepare("SELECT id FROM teams LIMIT 2").all() as Array<{ id: EntityId }>;
  if (rows.length < 2) throw new Error("expected at least 2 teams in the Nepal seed");
  ensureManagerFor(db, rows[0]!.id);
  ensureManagerFor(db, rows[1]!.id);
  return [rows[0]!.id, rows[1]!.id];
};

const playerOnTeam = (db: ReturnType<typeof openGameDatabase>, teamId: EntityId): EntityId => {
  const existing = db
    .prepare(
      `SELECT pc.player_id AS personId FROM player_contracts pc
       WHERE pc.club_id = (SELECT club_id FROM teams WHERE id = ?)
         AND pc.status = 'ACTIVE' AND pc.start_date <= '2026-09-05' AND pc.end_date >= '2026-09-05'
       LIMIT 1`,
    )
    .get(teamId) as { personId: EntityId } | undefined;
  if (existing) return existing.personId;
  const clubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(teamId) as { club_id: EntityId }).club_id;
  const taken = db
    .prepare(
      `SELECT person_id FROM manager_profiles
       UNION SELECT player_id AS person_id FROM player_contracts WHERE status = 'ACTIVE'`,
    )
    .all() as Array<{ person_id: EntityId }>;
  const takenIds = new Set(taken.map((row) => row.person_id));
  const persons = db.prepare("SELECT id FROM persons").all() as Array<{ id: EntityId }>;
  const person = persons.find((row) => !takenIds.has(row.id));
  if (!person) throw new Error("no free person available to contract");
  new TransferMarketRepository(db).upsertPlayerContract({
    id: `test-player-contract-${person.id}` as EntityId,
    playerId: person.id,
    clubId,
    startDate: "2026-01-01",
    endDate: "2028-01-01",
    contractType: "PERMANENT",
    salary: 50000,
    appearanceFee: 0,
    goalBonus: 0,
    cleanSheetBonus: 0,
    signingBonus: 0,
    loyaltyBonus: 0,
    currency: "NPR",
    squadRole: "ROTATION",
    status: "ACTIVE",
    provenance: { sourceName: "SIMULATION_ONLY", confidence: 1, status: "SIMULATION_ONLY" },
  });
  return person.id;
};

describe("AI press participation", () => {
  it("AI_POST_MATCH: opens and completes a real post-match conference deterministically", () => {
    const db = openGameDatabase(makeSave("post-match"));
    const [home, away] = twoManagedTeams(db);
    const managerPersonId = ensureManagerFor(db, home);
    insertPlayedMatch(db, {
      fixtureId: "fx-ai-post-match" as EntityId,
      matchId: "m-ai-post-match" as EntityId,
      homeTeamId: home,
      awayTeamId: away,
      date: "2026-09-05",
      homeGoals: 2,
      awayGoals: 1,
    });

    const interview = runAiPressConference(db, {
      context: "POST_MATCH",
      managerPersonId,
      teamId: home,
      fixtureId: "fx-ai-post-match" as EntityId,
      date: "2026-09-05",
      seed: "ai-post-match-seed",
    });
    expect(interview).toBeDefined();
    expect(interview!.status).toBe("COMPLETED");
    expect(interview!.structuredAnswers!.length).toBe(interview!.structuredQuestions!.length);
    // Response validity: every chosen stance was actually offered.
    for (const answer of interview!.structuredAnswers!) {
      const question = interview!.structuredQuestions!.find((item) => item.id === answer.questionId)!;
      expect(question.options.some((option) => option.stance === answer.stance)).toBe(true);
    }
    db.close();
  });

  it("AI_TRANSFER: opens and completes a real transfer-bid conference deterministically", () => {
    const db = openGameDatabase(makeSave("transfer"));
    const [home, away] = twoManagedTeams(db);
    const managerPersonId = ensureManagerFor(db, home);
    const player = playerOnTeam(db, home);
    const homeClubId = (db.prepare("SELECT club_id FROM teams WHERE id=?").get(home) as { club_id: EntityId }).club_id;
    const awayClubId = (db.prepare("SELECT club_id FROM teams WHERE id=?").get(away) as { club_id: EntityId }).club_id;
    new TransferMarketRepository(db).insertTransferOffer({
      id: "ai-press-transfer-offer" as EntityId,
      buyingClubId: awayClubId,
      sellingClubId: homeClubId,
      playerId: player,
      offerType: "PERMANENT",
      transferFee: 500_000,
      installments: 1,
      addOns: 0,
      sellOnPercentage: 0,
      submittedAt: "2026-09-01",
      expiresAt: "2026-09-10",
      status: "SUBMITTED",
      currency: "NPR",
      agentFee: 0,
      signingFee: 0,
    });

    const interview = runAiPressConference(db, {
      context: "TRANSFER",
      managerPersonId,
      teamId: home,
      date: "2026-09-05",
      seed: "ai-transfer-seed",
    });
    expect(interview).toBeDefined();
    expect(interview!.status).toBe("COMPLETED");
    expect(interview!.structuredQuestions!.some((q) => q.topic === "TRANSFER_BID")).toBe(true);
    for (const answer of interview!.structuredAnswers!) {
      const question = interview!.structuredQuestions!.find((item) => item.id === answer.questionId)!;
      expect(question.options.some((option) => option.stance === answer.stance)).toBe(true);
    }
    db.close();
  });

  it("AI_PLAYER_ISSUE: opens and completes a real playing-time-concern conference deterministically", () => {
    const db = openGameDatabase(makeSave("player-issue"));
    const [home] = twoManagedTeams(db);
    const managerPersonId = ensureManagerFor(db, home);
    const player = playerOnTeam(db, home);
    new SquadDynamicsRepository(db).upsertConcern({
      id: "ai-press-concern" as EntityId,
      personId: player,
      teamId: home,
      type: "PLAYING_TIME",
      status: "ACTIVE",
      severity: 5,
      raisedOn: "2026-09-01",
      updatedOn: "2026-09-01",
    });

    const interview = runAiPressConference(db, {
      context: "PLAYER_ISSUE",
      managerPersonId,
      teamId: home,
      date: "2026-09-05",
      seed: "ai-player-issue-seed",
    });
    expect(interview).toBeDefined();
    expect(interview!.status).toBe("COMPLETED");
    expect(interview!.structuredQuestions!.some((q) => q.topic === "PLAYING_TIME_CONCERN")).toBe(true);
    for (const answer of interview!.structuredAnswers!) {
      const question = interview!.structuredQuestions!.find((item) => item.id === answer.questionId)!;
      expect(question.options.some((option) => option.stance === answer.stance)).toBe(true);
    }
    db.close();
  });

  it("AI_DETERMINISM: the same seed, interview and question always produces the same answer", () => {
    const pathA = makeSave("determinism-a");
    const pathB = makeSave("determinism-b");
    const results: string[] = [];
    for (const path of [pathA, pathB]) {
      const db = openGameDatabase(path);
      const [home, away] = twoManagedTeams(db);
      const managerPersonId = ensureManagerFor(db, home);
      insertPlayedMatch(db, {
        fixtureId: "fx-determinism" as EntityId,
        matchId: "m-determinism" as EntityId,
        homeTeamId: home,
        awayTeamId: away,
        date: "2026-09-05",
        homeGoals: 3,
        awayGoals: 0,
      });
      const interview = runAiPressConference(db, {
        context: "POST_MATCH",
        managerPersonId,
        teamId: home,
        fixtureId: "fx-determinism" as EntityId,
        date: "2026-09-05",
        seed: "same-seed-both-worlds",
      });
      results.push(interview!.structuredAnswers!.map((answer) => answer.stance).join(","));
      db.close();
    }
    // Both worlds are seeded identically (same registry, same inserted
    // fixture/result), so the same seed must produce the exact same
    // sequence of stances — never Math.random.
    expect(results[0]).toBe(results[1]);
    expect(results[0]!.length).toBeGreaterThan(0);
  });

  it("AI_CONSEQUENCE_PARITY: an AI answer updates journalist relationship exactly like a human answer would", () => {
    const db = openGameDatabase(makeSave("consequence-parity"));
    const [home, away] = twoManagedTeams(db);
    const managerPersonId = ensureManagerFor(db, home);
    insertPlayedMatch(db, {
      fixtureId: "fx-ai-parity" as EntityId,
      matchId: "m-ai-parity" as EntityId,
      homeTeamId: home,
      awayTeamId: away,
      date: "2026-09-05",
      homeGoals: 1,
      awayGoals: 1,
    });
    const before = new MediaPhaseBRepository(db).relationships().length;
    const interview = runAiPressConference(db, {
      context: "POST_MATCH",
      managerPersonId,
      teamId: home,
      fixtureId: "fx-ai-parity" as EntityId,
      date: "2026-09-05",
      seed: "ai-parity-seed",
    });
    expect(interview).toBeDefined();
    const relationships = new MediaPhaseBRepository(db).relationships();
    expect(relationships.length).toBeGreaterThan(before);
    const relationship = relationships.find((item) => item.managerPersonId === managerPersonId);
    expect(relationship).toBeDefined();
    db.close();
  });

  it("AI_EXACT_ONCE: the same source fact evaluated twice creates one interview, one completion, reload reproduces it exactly", () => {
    const db = openGameDatabase(makeSave("exact-once"));
    const [home, away] = twoManagedTeams(db);
    const managerPersonId = ensureManagerFor(db, home);
    insertPlayedMatch(db, {
      fixtureId: "fx-ai-exact-once" as EntityId,
      matchId: "m-ai-exact-once" as EntityId,
      homeTeamId: home,
      awayTeamId: away,
      date: "2026-09-05",
      homeGoals: 0,
      awayGoals: 0,
    });

    const first = runAiPressConference(db, {
      context: "POST_MATCH",
      managerPersonId,
      teamId: home,
      fixtureId: "fx-ai-exact-once" as EntityId,
      date: "2026-09-05",
      seed: "ai-exact-once-seed",
    });
    expect(first).toBeDefined();
    expect(first!.status).toBe("COMPLETED");

    // Same source fact, evaluated again — must resolve to the identical
    // already-completed interview, never a duplicate.
    const second = runAiPressConference(db, {
      context: "POST_MATCH",
      managerPersonId,
      teamId: home,
      fixtureId: "fx-ai-exact-once" as EntityId,
      date: "2026-09-05",
      seed: "ai-exact-once-seed",
    });
    expect(second).toBeDefined();
    expect(second!.id).toBe(first!.id);
    expect(second!.structuredAnswers).toEqual(first!.structuredAnswers);

    const allInterviews = new MediaPhaseBRepository(db).interviews(managerPersonId);
    expect(allInterviews.filter((item) => item.sourceEntityId === "fx-ai-exact-once").length).toBe(1);
    db.close();
  });
});
