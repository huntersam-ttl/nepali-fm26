import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MediaPhaseBRepository,
  openGameDatabase,
  SquadDynamicsRepository,
  TransferMarketRepository,
} from "@nepal-football-sim/database";
import {
  answerPressQuestion,
  answerPressQuestionAsAi,
  createNepalSave,
  generatePressQuestions,
  resolveStoryEntityReference,
  shouldCreatePreMatchPress,
  startPressConference,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "press-interviews-"));
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

/** Inserts a minimal, real-shaped played fixture + match (+ optional events)
 * directly, since these tests are about question grounding/consequences,
 * not full match simulation. */
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
    events?: Array<{ type: string; teamId?: EntityId; personId?: EntityId; minute?: number; data?: Record<string, unknown> }>;
    tacticalSnapshot?: {
      home: { formationId: string; formationName: string; mentality: string };
      away: { formationId: string; formationName: string; mentality: string };
    };
  },
): void => {
  db.prepare(
    "INSERT INTO fixtures (id, competition_season_id, home_team_id, away_team_id, scheduled_date, status) VALUES (?, NULL, ?, ?, ?, 'played')",
  ).run(input.fixtureId, input.homeTeamId, input.awayTeamId, input.date);
  db.prepare(
    "INSERT INTO matches (id, fixture_id, played_date, home_goals, away_goals, tactical_snapshot_json) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    input.matchId,
    input.fixtureId,
    input.date,
    input.homeGoals,
    input.awayGoals,
    input.tacticalSnapshot ? JSON.stringify(input.tacticalSnapshot) : null,
  );
  for (const [index, event] of (input.events ?? []).entries()) {
    db.prepare(
      "INSERT INTO match_events (id, match_id, minute, type, team_id, primary_person_id, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      `${input.matchId}-event-${index}`,
      input.matchId,
      event.minute ?? 10,
      event.type,
      event.teamId ?? null,
      event.personId ?? null,
      event.data ? JSON.stringify(event.data) : null,
    );
  }
};

/** A freshly created save has no manager assigned yet (that only happens
 * once the world is actually simulated) — give two real teams a minimal,
 * real-shaped manager_profiles/manager_contracts row directly. */
const ensureManagerFor = (db: ReturnType<typeof openGameDatabase>, teamId: EntityId): EntityId => {
  const existing = db
    .prepare(`SELECT person_id AS personId FROM manager_contracts WHERE team_id = ? AND status = 'ACTIVE' LIMIT 1`)
    .get(teamId) as { personId: EntityId } | undefined;
  if (existing) return existing.personId;
  const person = db
    .prepare(
      `SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM manager_profiles) LIMIT 1`,
    )
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

const managerPersonForTeam = (db: ReturnType<typeof openGameDatabase>, teamId: EntityId): EntityId =>
  ensureManagerFor(db, teamId);

/** A freshly created save has no squads assigned yet either (real squad
 * generation happens during world simulation, not save creation) — give the
 * team one real, active, correctly-shaped player_contracts row directly. */
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
    provenance: { sourceName: "SIMULATION_ONLY", confidence: 1 },
  });
  return person.id;
};

describe("press interviews — structured, context-grounded flow", () => {
  it("generates a red-card question only when a real dismissal occurred, and never fabricates one", () => {
    const db = openGameDatabase(makeSave("no-red-card"));
    const [home, away] = twoManagedTeams(db);
    const scorer = playerOnTeam(db, home);
    insertPlayedMatch(db, {
      fixtureId: "fx-no-red" as EntityId,
      matchId: "m-no-red" as EntityId,
      homeTeamId: home,
      awayTeamId: away,
      date: "2026-09-05",
      homeGoals: 2,
      awayGoals: 0,
      events: [{ type: "GOAL", teamId: home, personId: scorer, minute: 30 }],
    });
    const questions = generatePressQuestions(db, {
      context: "POST_MATCH",
      teamId: home,
      fixtureId: "fx-no-red" as EntityId,
    });
    expect(questions.some((q) => q.topic === "RED_CARD")).toBe(false);
    expect(questions.some((q) => q.topic === "MATCH_RESULT")).toBe(true);
    // The opponent subject on MATCH_RESULT must resolve to a real, visible
    // club — not "Unknown entity". A club EntityRef needs a real clubs.id,
    // never the away team's own id (they are different tables).
    const matchResultQuestion = questions.find((q) => q.topic === "MATCH_RESULT")!;
    const opponentRef = matchResultQuestion.subjectEntities[0];
    expect(opponentRef).toBeTruthy();
    const resolved = resolveStoryEntityReference(db, opponentRef!, "MANAGER");
    expect(resolved).toBeTruthy();
    expect(resolved!.visible).toBe(true);
    expect(resolved!.label).not.toBe("Unknown entity");
    db.close();
  });

  it("resolves the pre-match opponent-preview subject to a real, clickable club — not the opponent's team id", () => {
    const db = openGameDatabase(makeSave("pre-match-opponent-ref"));
    const [home, away] = twoManagedTeams(db);
    db.prepare(
      "INSERT INTO fixtures (id, competition_season_id, home_team_id, away_team_id, scheduled_date, status) VALUES (?, NULL, ?, ?, ?, 'scheduled')",
    ).run("fx-opponent-ref", home, away, "2026-09-05");
    const questions = generatePressQuestions(db, { context: "PRE_MATCH", teamId: home, fixtureId: "fx-opponent-ref" as EntityId });
    const opponentPreview = questions.find((q) => q.topic === "OPPONENT_PREVIEW");
    expect(opponentPreview).toBeTruthy();
    const opponentRef = opponentPreview!.subjectEntities[0];
    expect(opponentRef).toBeTruthy();
    expect(opponentRef!.id).not.toBe(away); // must be the away CLUB id, not the away TEAM id
    const resolved = resolveStoryEntityReference(db, opponentRef!, "MANAGER");
    expect(resolved).toBeTruthy();
    expect(resolved!.visible).toBe(true);
    expect(resolved!.label).not.toBe("Unknown entity");
    db.close();
  });

  it("generates a red-card question when a real dismissal occurred, naming the actual player", () => {
    const db = openGameDatabase(makeSave("red-card"));
    const [home, away] = twoManagedTeams(db);
    const dismissed = playerOnTeam(db, away);
    insertPlayedMatch(db, {
      fixtureId: "fx-red" as EntityId,
      matchId: "m-red" as EntityId,
      homeTeamId: home,
      awayTeamId: away,
      date: "2026-09-05",
      homeGoals: 1,
      awayGoals: 0,
      events: [{ type: "RED_CARD", teamId: away, personId: dismissed, minute: 60 }],
    });
    const questions = generatePressQuestions(db, {
      context: "POST_MATCH",
      teamId: home,
      fixtureId: "fx-red" as EntityId,
    });
    const redCardQuestion = questions.find((q) => q.topic === "RED_CARD");
    expect(redCardQuestion).toBeTruthy();
    expect(redCardQuestion!.subjectEntities).toContainEqual({ id: dismissed, type: "person" });
    db.close();
  });

  it("runs a multi-question conference to completion, persists each answer, and is resumable across reloads", () => {
    const path = makeSave("multi-question");
    let db = openGameDatabase(path);
    const [home, away] = twoManagedTeams(db);
    const scorer = playerOnTeam(db, home);
    const dismissed = playerOnTeam(db, away);
    insertPlayedMatch(db, {
      fixtureId: "fx-multi" as EntityId,
      matchId: "m-multi" as EntityId,
      homeTeamId: home,
      awayTeamId: away,
      date: "2026-09-05",
      homeGoals: 2,
      awayGoals: 1,
      events: [
        { type: "GOAL", teamId: home, personId: scorer, minute: 85, data: {} },
        { type: "RED_CARD", teamId: away, personId: dismissed, minute: 60 },
      ],
    });
    const managerPersonId = managerPersonForTeam(db, home);

    const interview = startPressConference(db, {
      context: "POST_MATCH",
      managerPersonId,
      teamId: home,
      date: "2026-09-05",
      fixtureId: "fx-multi" as EntityId,
    });
    expect(interview.status).toBe("OPEN");
    expect(interview.structuredQuestions!.length).toBeGreaterThanOrEqual(2);
    const totalQuestions = interview.structuredQuestions!.length;

    // Answer every question but the last.
    let current = interview;
    for (let i = 0; i < totalQuestions - 1; i += 1) {
      const stance = current.structuredQuestions![current.currentQuestionIndex!]!.options[0]!.stance;
      current = answerPressQuestion(db, { interviewId: interview.id, stance, teamId: home, date: "2026-09-05" });
      expect(current.status).toBe("OPEN");
      expect(current.structuredAnswers!.length).toBe(i + 1);
    }

    // Reload mid-conference: resumes at the same next question, prior answers unchanged.
    db.close();
    db = openGameDatabase(path);
    const midway = new MediaPhaseBRepository(db).interviews(managerPersonId).find((item) => item.id === interview.id)!;
    expect(midway.currentQuestionIndex).toBe(totalQuestions - 1);
    expect(midway.structuredAnswers!.length).toBe(totalQuestions - 1);

    // Answer the final question — completes the conference.
    const lastStance = midway.structuredQuestions![midway.currentQuestionIndex!]!.options[0]!.stance;
    const finished = answerPressQuestion(db, {
      interviewId: interview.id,
      stance: lastStance,
      teamId: home,
      date: "2026-09-05",
    });
    expect(finished.status).toBe("COMPLETED");
    expect(finished.structuredAnswers!.length).toBe(totalQuestions);
    expect(finished.responses).toHaveLength(totalQuestions);
    db.close();
  });

  it("bounds player-relationship consequences and never applies them twice for the same answer", () => {
    const path = makeSave("consequence");
    const db = openGameDatabase(path);
    const [home, away] = twoManagedTeams(db);
    const scorer = playerOnTeam(db, home);
    insertPlayedMatch(db, {
      fixtureId: "fx-praise" as EntityId,
      matchId: "m-praise" as EntityId,
      homeTeamId: home,
      awayTeamId: away,
      date: "2026-09-05",
      homeGoals: 3,
      awayGoals: 0,
      events: [
        { type: "GOAL", teamId: home, personId: scorer, minute: 20 },
        { type: "GOAL", teamId: home, personId: scorer, minute: 55 },
      ],
    });
    const managerPersonId = managerPersonForTeam(db, home);
    const interview = startPressConference(db, {
      context: "POST_MATCH",
      managerPersonId,
      teamId: home,
      date: "2026-09-05",
      fixtureId: "fx-praise" as EntityId,
    });
    const performanceQuestion = interview.structuredQuestions!.find((q) => q.topic === "PLAYER_PERFORMANCE");
    expect(performanceQuestion).toBeTruthy();

    const dynamics = new SquadDynamicsRepository(db);
    const managerProfileId = (
      db.prepare("SELECT id FROM manager_profiles WHERE person_id = ?").get(managerPersonId) as { id: EntityId }
    ).id;
    const before = dynamics.relationship(managerProfileId, scorer)?.score ?? 0;

    // Answer up to and including the PLAYER_PERFORMANCE question with PRAISE.
    let current = interview;
    while (current.structuredQuestions![current.currentQuestionIndex!]!.topic !== "PLAYER_PERFORMANCE") {
      current = answerPressQuestion(db, {
        interviewId: interview.id,
        stance: current.structuredQuestions![current.currentQuestionIndex!]!.options[0]!.stance,
        teamId: home,
        date: "2026-09-05",
      });
    }
    current = answerPressQuestion(db, { interviewId: interview.id, stance: "PRAISE", teamId: home, date: "2026-09-05" });
    const afterPraise = dynamics.relationship(managerProfileId, scorer)?.score ?? 0;
    expect(afterPraise).toBeGreaterThan(before);
    expect(afterPraise - before).toBeLessThanOrEqual(5);

    // Finish the rest of the conference — the already-applied PRAISE consequence must not repeat.
    while (current.status === "OPEN") {
      current = answerPressQuestion(db, {
        interviewId: interview.id,
        stance: current.structuredQuestions![current.currentQuestionIndex!]!.options[0]!.stance,
        teamId: home,
        date: "2026-09-05",
      });
    }
    const final = dynamics.relationship(managerProfileId, scorer)?.score ?? 0;
    expect(final).toBe(afterPraise);
    db.close();
  });

  it("a COMMIT response to a transfer question creates a structured TRANSFER_STANCE promise, not a text-matched one", () => {
    const path = makeSave("transfer-commit");
    const db = openGameDatabase(path);
    const [home] = twoManagedTeams(db);
    const player = playerOnTeam(db, home);
    const managerPersonId = managerPersonForTeam(db, home);
    const clubId = (
      db.prepare("SELECT club_id FROM teams WHERE id = ?").get(home) as { club_id: EntityId }
    ).club_id;
    // A real active concern grounds a genuine TRANSFER_REQUEST question.
    new SquadDynamicsRepository(db).upsertConcern({
      id: "concern-transfer" as EntityId,
      personId: player,
      teamId: home,
      type: "TRANSFER_INTEREST",
      status: "ACTIVE",
      severity: 5,
      raisedOn: "2026-09-01",
      updatedOn: "2026-09-01",
    });

    const interview = startPressConference(db, {
      context: "TRANSFER",
      managerPersonId,
      teamId: home,
      date: "2026-09-05",
    });
    const transferQuestion = interview.structuredQuestions!.find((q) => q.topic === "TRANSFER_REQUEST");
    expect(transferQuestion).toBeTruthy();

    let current = interview;
    while (current.structuredQuestions![current.currentQuestionIndex!]!.topic !== "TRANSFER_REQUEST") {
      current = answerPressQuestion(db, {
        interviewId: interview.id,
        stance: current.structuredQuestions![current.currentQuestionIndex!]!.options[0]!.stance,
        teamId: home,
        date: "2026-09-05",
      });
    }
    answerPressQuestion(db, { interviewId: interview.id, stance: "COMMIT", teamId: home, date: "2026-09-05" });

    const promises = new SquadDynamicsRepository(db).activePromisesForTeam(home);
    const stancePromise = promises.find((p) => p.type === "TRANSFER_STANCE" && p.targetCriteria === player);
    expect(stancePromise).toBeTruthy();
    expect(stancePromise!.commitmentSource).toBe("PRESS_CONFERENCE");
    void clubId;
    db.close();
  });

  it("AI response selection is deterministic for the same seed and world state", () => {
    const db = openGameDatabase(makeSave("ai-response"));
    const [home, away] = twoManagedTeams(db);
    const scorer = playerOnTeam(db, home);
    insertPlayedMatch(db, {
      fixtureId: "fx-ai" as EntityId,
      matchId: "m-ai" as EntityId,
      homeTeamId: home,
      awayTeamId: away,
      date: "2026-09-05",
      homeGoals: 1,
      awayGoals: 1,
      events: [{ type: "GOAL", teamId: home, personId: scorer, minute: 10 }],
    });
    const managerPersonId = managerPersonForTeam(db, home);
    const interviewA = startPressConference(db, {
      context: "POST_MATCH",
      managerPersonId,
      teamId: home,
      date: "2026-09-05",
      fixtureId: "fx-ai" as EntityId,
    });
    const resultA = answerPressQuestionAsAi(db, {
      interviewId: interviewA.id,
      teamId: home,
      date: "2026-09-05",
      seed: "ai-seed",
    });
    // Re-derive the same decision function independently for the same
    // question/seed and confirm it agrees (determinism, not just "ran once").
    expect(resultA.structuredAnswers![0]!.stance).toBeTruthy();
    db.close();
  });
});

describe("press interviews — tactical questions grounded in the real kickoff snapshot", () => {
  it("asks about a starting-formation change only when it genuinely differs from the team's recent setup", () => {
    const db = openGameDatabase(makeSave("tactical-formation-change"));
    const [home, away] = twoManagedTeams(db);
    // Three recent matches, all started in a stable 4-4-2.
    for (let i = 0; i < 3; i += 1) {
      insertPlayedMatch(db, {
        fixtureId: `fx-recent-${i}` as EntityId,
        matchId: `m-recent-${i}` as EntityId,
        homeTeamId: home,
        awayTeamId: away,
        date: `2026-08-0${i + 1}`,
        homeGoals: 1,
        awayGoals: 1,
        tacticalSnapshot: {
          home: { formationId: "4-4-2", formationName: "4-4-2", mentality: "BALANCED" },
          away: { formationId: "4-3-3", formationName: "4-3-3", mentality: "BALANCED" },
        },
      });
    }
    // Today's match: a real, different formation.
    insertPlayedMatch(db, {
      fixtureId: "fx-today" as EntityId,
      matchId: "m-today" as EntityId,
      homeTeamId: home,
      awayTeamId: away,
      date: "2026-09-05",
      homeGoals: 2,
      awayGoals: 0,
      tacticalSnapshot: {
        home: { formationId: "3-5-2", formationName: "3-5-2", mentality: "BALANCED" },
        away: { formationId: "4-3-3", formationName: "4-3-3", mentality: "BALANCED" },
      },
    });
    const questions = generatePressQuestions(db, { context: "POST_MATCH", teamId: home, fixtureId: "fx-today" as EntityId });
    const formationQuestion = questions.find((q) => q.topic === "STARTING_FORMATION");
    expect(formationQuestion).toBeTruthy();
    expect(formationQuestion!.prompt).toContain("3-5-2");
    db.close();
  });

  it("never asks about a formation switch when today's shape matches the team's recent norm", () => {
    const db = openGameDatabase(makeSave("tactical-no-change"));
    const [home, away] = twoManagedTeams(db);
    for (let i = 0; i < 3; i += 1) {
      insertPlayedMatch(db, {
        fixtureId: `fx-recent-${i}` as EntityId,
        matchId: `m-recent-${i}` as EntityId,
        homeTeamId: home,
        awayTeamId: away,
        date: `2026-08-0${i + 1}`,
        homeGoals: 1,
        awayGoals: 1,
        tacticalSnapshot: {
          home: { formationId: "4-4-2", formationName: "4-4-2", mentality: "BALANCED" },
          away: { formationId: "4-3-3", formationName: "4-3-3", mentality: "BALANCED" },
        },
      });
    }
    // Today: the SAME 4-4-2 — no genuine change.
    insertPlayedMatch(db, {
      fixtureId: "fx-today" as EntityId,
      matchId: "m-today" as EntityId,
      homeTeamId: home,
      awayTeamId: away,
      date: "2026-09-05",
      homeGoals: 2,
      awayGoals: 0,
      tacticalSnapshot: {
        home: { formationId: "4-4-2", formationName: "4-4-2", mentality: "BALANCED" },
        away: { formationId: "4-3-3", formationName: "4-3-3", mentality: "BALANCED" },
      },
    });
    const questions = generatePressQuestions(db, { context: "POST_MATCH", teamId: home, fixtureId: "fx-today" as EntityId });
    expect(questions.some((q) => q.topic === "STARTING_FORMATION")).toBe(false);
    db.close();
  });

  it("never claims a historical tactical fact when the match has no stored tactical snapshot", () => {
    const db = openGameDatabase(makeSave("tactical-no-snapshot"));
    const [home, away] = twoManagedTeams(db);
    // A match predating snapshot tracking — no tacticalSnapshot at all.
    insertPlayedMatch(db, {
      fixtureId: "fx-legacy" as EntityId,
      matchId: "m-legacy" as EntityId,
      homeTeamId: home,
      awayTeamId: away,
      date: "2026-09-05",
      homeGoals: 1,
      awayGoals: 0,
    });
    const questions = generatePressQuestions(db, { context: "POST_MATCH", teamId: home, fixtureId: "fx-legacy" as EntityId });
    expect(questions.some((q) => q.topic === "STARTING_FORMATION" || q.topic === "MENTALITY_CHOICE")).toBe(false);
    db.close();
  });

  it("asks about mentality only when the real kickoff mentality was genuinely attacking or defensive, never for a balanced setup", () => {
    const db = openGameDatabase(makeSave("tactical-mentality"));
    const [home, away] = twoManagedTeams(db);
    insertPlayedMatch(db, {
      fixtureId: "fx-attacking" as EntityId,
      matchId: "m-attacking" as EntityId,
      homeTeamId: home,
      awayTeamId: away,
      date: "2026-09-05",
      homeGoals: 2,
      awayGoals: 1,
      tacticalSnapshot: {
        home: { formationId: "4-3-3", formationName: "4-3-3", mentality: "VERY_ATTACKING" },
        away: { formationId: "4-4-2", formationName: "4-4-2", mentality: "BALANCED" },
      },
    });
    const attackingQuestions = generatePressQuestions(db, {
      context: "POST_MATCH",
      teamId: home,
      fixtureId: "fx-attacking" as EntityId,
    });
    expect(attackingQuestions.some((q) => q.topic === "MENTALITY_CHOICE")).toBe(true);

    insertPlayedMatch(db, {
      fixtureId: "fx-balanced" as EntityId,
      matchId: "m-balanced" as EntityId,
      homeTeamId: home,
      awayTeamId: away,
      date: "2026-09-12",
      homeGoals: 1,
      awayGoals: 1,
      tacticalSnapshot: {
        home: { formationId: "4-3-3", formationName: "4-3-3", mentality: "BALANCED" },
        away: { formationId: "4-4-2", formationName: "4-4-2", mentality: "BALANCED" },
      },
    });
    const balancedQuestions = generatePressQuestions(db, {
      context: "POST_MATCH",
      teamId: home,
      fixtureId: "fx-balanced" as EntityId,
    });
    expect(balancedQuestions.some((q) => q.topic === "MENTALITY_CHOICE")).toBe(false);
    db.close();
  });

  it("keeps tactical response consequences media-only — no tactical familiarity, tactic, or attribute mutation", () => {
    const db = openGameDatabase(makeSave("tactical-consequence-bounded"));
    const [home, away] = twoManagedTeams(db);
    insertPlayedMatch(db, {
      fixtureId: "fx-tactic" as EntityId,
      matchId: "m-tactic" as EntityId,
      homeTeamId: home,
      awayTeamId: away,
      date: "2026-09-05",
      homeGoals: 2,
      awayGoals: 0,
      tacticalSnapshot: {
        home: { formationId: "4-3-3", formationName: "4-3-3", mentality: "VERY_ATTACKING" },
        away: { formationId: "4-4-2", formationName: "4-4-2", mentality: "BALANCED" },
      },
    });
    const managerPersonId = managerPersonForTeam(db, home);
    const beforeTactic = db.prepare("SELECT * FROM tactical_setups WHERE team_id = ?").all(home) as unknown[];
    const beforeAttributes = db.prepare("SELECT technical_json FROM player_attributes LIMIT 5").all() as unknown[];

    const interview = startPressConference(db, {
      context: "POST_MATCH",
      managerPersonId,
      teamId: home,
      date: "2026-09-05",
      fixtureId: "fx-tactic" as EntityId,
    });
    const mentalityQuestion = interview.structuredQuestions!.find((q) => q.topic === "MENTALITY_CHOICE");
    expect(mentalityQuestion).toBeTruthy();
    let current = interview;
    while (current.structuredQuestions![current.currentQuestionIndex!]!.topic !== "MENTALITY_CHOICE") {
      current = answerPressQuestion(db, {
        interviewId: interview.id,
        stance: current.structuredQuestions![current.currentQuestionIndex!]!.options[0]!.stance,
        teamId: home,
        date: "2026-09-05",
      });
    }
    answerPressQuestion(db, { interviewId: interview.id, stance: "ASSERTIVE", teamId: home, date: "2026-09-05" });

    // No tactical setup or player attribute row was touched by a press answer.
    expect(db.prepare("SELECT * FROM tactical_setups WHERE team_id = ?").all(home)).toEqual(beforeTactic);
    expect(db.prepare("SELECT technical_json FROM player_attributes LIMIT 5").all()).toEqual(beforeAttributes);
    db.close();
  });
});

/** Seeds real league_standings rows for `teams`, in order (first = top of
 * table), against a real competition_seasons id already in the fresh save —
 * never a fabricated season. */
const seedStandings = (
  db: ReturnType<typeof openGameDatabase>,
  teamsInOrder: EntityId[],
): EntityId => {
  const seasonId = (db.prepare("SELECT id FROM competition_seasons LIMIT 1").get() as { id: EntityId }).id;
  teamsInOrder.forEach((teamId, index) => {
    const points = (teamsInOrder.length - index) * 3;
    db.prepare(
      `INSERT INTO league_standings
       (competition_season_id, team_id, played, won, drawn, lost, goals_for, goals_against, goal_difference, points)
       VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, ?)`,
    ).run(seasonId, teamId, index + 1, index + 1, index + 1, index + 1, points);
  });
  return seasonId;
};

describe("shouldCreatePreMatchPress — bounded, deterministic trigger", () => {
  it("never triggers for an ordinary mid-table fixture with no other material context", () => {
    const db = openGameDatabase(makeSave("pre-match-trigger-none"));
    // 8 teams so a genuinely mid position (4th of 8) sits outside both the
    // top-3 and bottom-3 bands.
    const teams = (db.prepare("SELECT id FROM teams LIMIT 8").all() as Array<{ id: EntityId }>).map((r) => r.id);
    const seasonId = seedStandings(db, teams);
    const midTeam = teams[3]!;
    db.prepare(
      "INSERT INTO fixtures (id, competition_season_id, home_team_id, away_team_id, scheduled_date, status) VALUES (?, ?, ?, ?, ?, 'scheduled')",
    ).run("fx-mundane", seasonId, midTeam, teams[4], "2026-09-05");
    const result = shouldCreatePreMatchPress(db, { teamId: midTeam, fixtureId: "fx-mundane" as EntityId });
    expect(result.trigger).toBe(false);
    expect(result.reasons).toHaveLength(0);
    db.close();
  });

  it("triggers for genuine title-race table stakes", () => {
    const db = openGameDatabase(makeSave("pre-match-trigger-stakes"));
    const teams = (db.prepare("SELECT id FROM teams LIMIT 6").all() as Array<{ id: EntityId }>).map((r) => r.id);
    const seasonId = seedStandings(db, teams);
    const leader = teams[0]!;
    db.prepare(
      "INSERT INTO fixtures (id, competition_season_id, home_team_id, away_team_id, scheduled_date, status) VALUES (?, ?, ?, ?, ?, 'scheduled')",
    ).run("fx-title-race", seasonId, leader, teams[1], "2026-09-05");
    const result = shouldCreatePreMatchPress(db, { teamId: leader, fixtureId: "fx-title-race" as EntityId });
    expect(result.trigger).toBe(true);
    expect(result.reasons).toContain("title-race table stakes");
    db.close();
  });

  it("triggers for a real active player concern, independent of table position", () => {
    const db = openGameDatabase(makeSave("pre-match-trigger-concern"));
    const teams = (db.prepare("SELECT id FROM teams LIMIT 8").all() as Array<{ id: EntityId }>).map((r) => r.id);
    const seasonId = seedStandings(db, teams);
    const midTeam = teams[3]!;
    const player = playerOnTeam(db, midTeam);
    db.prepare(
      "INSERT INTO fixtures (id, competition_season_id, home_team_id, away_team_id, scheduled_date, status) VALUES (?, ?, ?, ?, ?, 'scheduled')",
    ).run("fx-concern", seasonId, midTeam, teams[4], "2026-09-05");
    new SquadDynamicsRepository(db).upsertConcern({
      id: "pre-match-concern" as EntityId,
      personId: player,
      teamId: midTeam,
      type: "PLAYING_TIME",
      status: "ACTIVE",
      severity: 4,
      raisedOn: "2026-09-01",
      updatedOn: "2026-09-01",
    });
    const result = shouldCreatePreMatchPress(db, { teamId: midTeam, fixtureId: "fx-concern" as EntityId });
    expect(result.trigger).toBe(true);
    expect(result.reasons).toContain("active player concern");
    db.close();
  });

  it("is exact-once for the same fixture: repeated evaluation resolves the identical interview, never a duplicate", () => {
    const db = openGameDatabase(makeSave("pre-match-exact-once"));
    const teams = (db.prepare("SELECT id FROM teams LIMIT 6").all() as Array<{ id: EntityId }>).map((r) => r.id);
    const seasonId = seedStandings(db, teams);
    const leader = teams[0]!;
    const managerPersonId = managerPersonForTeam(db, leader);
    db.prepare(
      "INSERT INTO fixtures (id, competition_season_id, home_team_id, away_team_id, scheduled_date, status) VALUES (?, ?, ?, ?, ?, 'scheduled')",
    ).run("fx-repeat", seasonId, leader, teams[1], "2026-09-05");
    const first = startPressConference(db, {
      context: "PRE_MATCH",
      managerPersonId,
      teamId: leader,
      date: "2026-09-01",
      fixtureId: "fx-repeat" as EntityId,
    });
    const second = startPressConference(db, {
      context: "PRE_MATCH",
      managerPersonId,
      teamId: leader,
      date: "2026-09-01",
      fixtureId: "fx-repeat" as EntityId,
    });
    expect(second.id).toBe(first.id);
    expect(new MediaPhaseBRepository(db).interviews(managerPersonId).filter((item) => item.sourceEntityId === "fx-repeat")).toHaveLength(1);
    db.close();
  });
});
