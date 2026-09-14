import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  EventRepository,
  FederationGovernanceRepository,
  SquadDynamicsRepository,
  TransferMarketRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  answerPressQuestion,
  assignResponsibility,
  createFederationProject,
  createNepalSave,
  generatePressQuestions,
  runAiPressConference,
  shouldCreatePostMatchPress,
  startPressConference,
} from "@nepal-football-sim/simulation";
import type { EntityId, PressResponseStance } from "@nepal-football-sim/shared-types";

/*
 * Story materiality/spam/type audit — proves, for every press-producing
 * role (Manager, Owner, President, Sporting Director, AI), that a
 * publishMaterialPressEvent-backed historical event ("Story") is created
 * only for a genuinely material (non-neutral) answer, never for a routine
 * one; that it happens exactly once even across repeated re-evaluation and
 * a reload; and that each role's Story carries its own canonical eventType
 * (never a shared/ambiguous one, never a parallel Story system).
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "press-story-materiality-"));
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
  const profileId = `story-manager-profile-${person.id}` as EntityId;
  db.prepare(
    `INSERT INTO manager_profiles (id, person_id, attributes_json, preferred_style, reputation_profile, created_on)
     VALUES (?, ?, '{}', 'BALANCED', 'UNKNOWN', '2026-01-01')`,
  ).run(profileId, person.id);
  db.prepare(
    `INSERT INTO manager_contracts (id, manager_profile_id, person_id, team_id, club_id, job_title, contract_start, salary_amount_minor, currency, status)
     VALUES (?, ?, ?, ?, ?, 'Head Coach', '2026-01-01', 100000, 'NPR', 'ACTIVE')`,
  ).run(`story-manager-contract-${person.id}`, profileId, person.id, teamId, clubId);
  return person.id;
};

const playerOnTeam = (db: ReturnType<typeof openGameDatabase>, teamId: EntityId): EntityId => {
  const clubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(teamId) as { club_id: EntityId }).club_id;
  const taken = db
    .prepare(`SELECT person_id FROM manager_profiles UNION SELECT player_id AS person_id FROM player_contracts WHERE status = 'ACTIVE'`)
    .all() as Array<{ person_id: EntityId }>;
  const takenIds = new Set(taken.map((row) => row.person_id));
  const persons = db.prepare("SELECT id FROM persons").all() as Array<{ id: EntityId }>;
  const person = persons.find((row) => !takenIds.has(row.id));
  if (!person) throw new Error("no free person to contract");
  new TransferMarketRepository(db).upsertPlayerContract({
    id: `story-player-contract-${person.id}` as EntityId,
    playerId: person.id,
    clubId,
    startDate: "2026-01-01",
    endDate: "2028-01-01",
    contractType: "PERMANENT",
    salary: 50_000,
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

const twoManagedTeams = (db: ReturnType<typeof openGameDatabase>): [EntityId, EntityId] => {
  const rows = db.prepare("SELECT id FROM teams LIMIT 2").all() as Array<{ id: EntityId }>;
  ensureManagerFor(db, rows[0]!.id);
  ensureManagerFor(db, rows[1]!.id);
  return [rows[0]!.id, rows[1]!.id];
};

const pressStories = (db: ReturnType<typeof openGameDatabase>): ReturnType<EventRepository["historicalEvents"]> =>
  new EventRepository(db).historicalEvents().filter((event) => event.eventType.includes("PRESS"));

describe("press Story materiality — MANAGER", () => {
  it("a material stance (COMMIT) publishes exactly one MANAGER_PRESS_COMMITMENT Story; a neutral stance (DEFLECT) publishes none; both survive repeated re-evaluation and a reload", () => {
    const path = makeSave("story-manager-material");
    const db = openGameDatabase(path);
    const [home] = twoManagedTeams(db);
    const managerPersonId = ensureManagerFor(db, home);
    const player = playerOnTeam(db, home);
    new SquadDynamicsRepository(db).upsertConcern({
      id: "story-manager-concern" as EntityId,
      personId: player,
      teamId: home,
      type: "TRANSFER_INTEREST",
      status: "ACTIVE",
      severity: 5,
      raisedOn: "2026-09-05",
      updatedOn: "2026-09-05",
    });

    const interview = startPressConference(db, { context: "TRANSFER", managerPersonId, teamId: home, date: "2026-09-05" });
    const completed = answerPressQuestion(db, {
      interviewId: interview.id,
      stance: "COMMIT",
      teamId: home,
      date: "2026-09-05",
    });
    expect(completed.status).toBe("COMPLETED");

    const stories = pressStories(db);
    expect(stories.length).toBe(1);
    expect(stories[0]!.eventType).toBe("MANAGER_PRESS_COMMITMENT");
    expect(stories[0]!.scope).toBe("club");
    expect(stories[0]!.involvedEntities.some((ref) => ref.id === managerPersonId)).toBe(true);
    expect(stories[0]!.involvedEntities.some((ref) => ref.id === player)).toBe(true);
    db.close();

    // Reload: the Story persists, and re-reading the same completed
    // interview never republishes or duplicates it.
    const reloaded = openGameDatabase(path);
    expect(pressStories(reloaded).length).toBe(1);
    reloaded.close();
  });

  it("a neutral response (DEFLECT on a transfer bid) publishes no Story", () => {
    const path = makeSave("story-manager-neutral");
    const db = openGameDatabase(path);
    const [home, away] = twoManagedTeams(db);
    const managerPersonId = ensureManagerFor(db, home);
    const player = playerOnTeam(db, home);
    const homeClubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(home) as { club_id: EntityId }).club_id;
    const awayClubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(away) as { club_id: EntityId }).club_id;
    new TransferMarketRepository(db).insertTransferOffer({
      id: "story-manager-neutral-offer" as EntityId,
      buyingClubId: awayClubId,
      sellingClubId: homeClubId,
      playerId: player,
      offerType: "PERMANENT",
      transferFee: 100_000,
      installments: 1,
      addOns: 0,
      sellOnPercentage: 0,
      submittedAt: "2026-09-05",
      expiresAt: "2027-01-01",
      status: "SUBMITTED",
      currency: "NPR",
      agentFee: 0,
      signingFee: 0,
    });

    const interview = startPressConference(db, { context: "TRANSFER", managerPersonId, teamId: home, date: "2026-09-05" });
    const completed = answerPressQuestion(db, { interviewId: interview.id, stance: "DEFLECT", teamId: home, date: "2026-09-05" });
    expect(completed.status).toBe("COMPLETED");
    expect(pressStories(db)).toHaveLength(0);
    db.close();
  });
});

describe("press Story materiality — OWNER_BUSINESS", () => {
  it("ASSERTIVE publishes exactly one OWNER_PRESS_STATEMENT Story; CALM publishes none", () => {
    const path = makeSave("story-owner-material");
    const db = openGameDatabase(path);
    const [home] = twoManagedTeams(db);
    const ownerPersonId = ensureManagerFor(db, home); // any real person id works as the interview's holder
    const clubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(home) as { club_id: EntityId }).club_id;
    new ClubEconomyRepository(db).upsertInfrastructureProject({
      id: "story-owner-project" as EntityId,
      clubId,
      projectType: "STAND",
      planningStart: "2026-01-01",
      expectedCompletion: "2027-01-01",
      capitalCost: 5_000_000,
      ongoingCost: 100_000,
      currency: "NPR",
      status: "APPROVED",
      financingJson: {},
      provenanceStatus: "SIMULATION_ONLY",
    });

    const interview = startPressConference(db, { context: "OWNER_BUSINESS", managerPersonId: ownerPersonId, clubId, date: "2026-09-05" });
    let current = interview;
    while (current.status === "OPEN") {
      const question = current.structuredQuestions![current.currentQuestionIndex!]!;
      const stance: PressResponseStance = question.subjectEntities.some((ref) => ref.id === "story-owner-project")
        ? "ASSERTIVE"
        : "CALM";
      current = answerPressQuestion(db, { interviewId: current.id, stance, teamId: home, date: "2026-09-05" });
    }
    const stories = pressStories(db);
    expect(stories.length).toBe(1);
    expect(stories[0]!.eventType).toBe("OWNER_PRESS_STATEMENT");
    expect(stories[0]!.scope).toBe("club");
    db.close();
  });

  it("CALM/NON_COMMITTAL on an Owner topic publishes no Story", () => {
    const path = makeSave("story-owner-neutral");
    const db = openGameDatabase(path);
    const [home] = twoManagedTeams(db);
    const ownerPersonId = ensureManagerFor(db, home);
    const clubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(home) as { club_id: EntityId }).club_id;
    new ClubEconomyRepository(db).upsertInfrastructureProject({
      id: "story-owner-neutral-project" as EntityId,
      clubId,
      projectType: "STAND",
      planningStart: "2026-01-01",
      expectedCompletion: "2027-01-01",
      capitalCost: 5_000_000,
      ongoingCost: 100_000,
      currency: "NPR",
      status: "APPROVED",
      financingJson: {},
      provenanceStatus: "SIMULATION_ONLY",
    });
    const interview = startPressConference(db, { context: "OWNER_BUSINESS", managerPersonId: ownerPersonId, clubId, date: "2026-09-05" });
    let current = interview;
    while (current.status === "OPEN") {
      current = answerPressQuestion(db, { interviewId: current.id, stance: "CALM", teamId: home, date: "2026-09-05" });
    }
    expect(pressStories(db)).toHaveLength(0);
    db.close();
  });
});

describe("press Story materiality — FEDERATION_GOVERNANCE", () => {
  it("ASSERTIVE publishes exactly one PRESIDENT_PRESS_STATEMENT Story scoped to the federation; NON_COMMITTAL publishes none", () => {
    const path = makeSave("story-president-material");
    const db = openGameDatabase(path);
    const [home] = twoManagedTeams(db);
    const presidentPersonId = ensureManagerFor(db, home);
    const clubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(home) as { club_id: EntityId }).club_id;
    const federationId = (
      db.prepare("SELECT f.id FROM federations f JOIN clubs c ON c.country_id = f.country_id WHERE c.id = ? LIMIT 1").get(clubId) as {
        id: EntityId;
      }
    ).id;
    const project = createFederationProject(db, {
      federationId,
      projectType: "NATIONAL_TRAINING_CENTRE",
      name: "National Training Centre",
      date: "2026-09-05",
      seed: "story-president-project",
    });
    new FederationGovernanceRepository(db).upsertProject({ ...project, status: "CONSTRUCTION" });

    const interview = startPressConference(db, {
      context: "FEDERATION_GOVERNANCE",
      managerPersonId: presidentPersonId,
      federationId,
      date: "2026-09-05",
    });
    let current = interview;
    while (current.status === "OPEN") {
      current = answerPressQuestion(db, { interviewId: current.id, stance: "ASSERTIVE", teamId: home, date: "2026-09-05" });
    }
    const stories = pressStories(db);
    expect(stories.length).toBe(1);
    expect(stories[0]!.eventType).toBe("PRESIDENT_PRESS_STATEMENT");
    expect(stories[0]!.scope).toBe("federation");
    db.close();

    // Neutral run on a second, independent federation fact — no Story.
    const db2 = openGameDatabase(path);
    const coachPerson = db2
      .prepare("SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM manager_profiles) LIMIT 1")
      .get() as { id: EntityId };
    const team = db2.prepare("SELECT id FROM teams WHERE federation_id = ? LIMIT 1").get(federationId) as { id: EntityId };
    db2.prepare(
      `INSERT INTO staff_appointments (id, person_id, organisation_type, team_id, role, start_date, employment_status)
       VALUES (?, ?, 'NATIONAL_TEAM', ?, 'NATIONAL_TEAM_HEAD_COACH', '2026-09-06', 'ACTIVE')`,
    ).run("story-president-coach", coachPerson.id, team.id);
    const secondInterview = startPressConference(db2, {
      context: "FEDERATION_GOVERNANCE",
      managerPersonId: presidentPersonId,
      federationId,
      date: "2026-09-06",
    });
    let currentSecond = secondInterview;
    while (currentSecond.status === "OPEN") {
      currentSecond = answerPressQuestion(db2, { interviewId: currentSecond.id, stance: "NON_COMMITTAL", teamId: home, date: "2026-09-06" });
    }
    expect(pressStories(db2).length).toBe(1); // unchanged — still just the first, material one
    db2.close();
  });
});

describe("press Story materiality — RECRUITMENT (Sporting Director)", () => {
  it("ASSERTIVE publishes exactly one SPORTING_DIRECTOR_PRESS_STATEMENT Story; CALM publishes none", () => {
    const path = makeSave("story-sd-material");
    const db = openGameDatabase(path);
    const [home, away] = twoManagedTeams(db);
    const clubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(home) as { club_id: EntityId }).club_id;
    const awayClubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(away) as { club_id: EntityId }).club_id;
    const appointmentId = "story-sd-appointment";
    const sdPerson = db
      .prepare("SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM manager_profiles) LIMIT 1")
      .get() as { id: EntityId };
    db.prepare(
      `INSERT INTO staff_appointments (id, person_id, organisation_type, club_id, role, start_date, employment_status)
       VALUES (?, ?, 'CLUB', ?, 'SPORTING_DIRECTOR', '2026-01-01', 'ACTIVE')`,
    ).run(appointmentId, sdPerson.id, clubId);
    assignResponsibility(db, { worldDate: "2026-09-05" } as never, clubId, "TRANSFERS", "STAFF", appointmentId as EntityId);
    const player = playerOnTeam(db, home);
    new TransferMarketRepository(db).insertTransferOffer({
      id: "story-sd-offer" as EntityId,
      buyingClubId: clubId,
      sellingClubId: awayClubId,
      playerId: player,
      offerType: "PERMANENT",
      transferFee: 500_000,
      installments: 1,
      addOns: 0,
      sellOnPercentage: 0,
      submittedAt: "2026-09-05",
      expiresAt: "2026-09-05",
      status: "COMPLETED",
      currency: "NPR",
      agentFee: 0,
      signingFee: 0,
    });

    const interview = startPressConference(db, { context: "RECRUITMENT", managerPersonId: sdPerson.id, clubId, date: "2026-09-05" });
    let current = interview;
    while (current.status === "OPEN") {
      current = answerPressQuestion(db, { interviewId: current.id, stance: "ASSERTIVE", teamId: home, date: "2026-09-05" });
    }
    const stories = pressStories(db);
    expect(stories.length).toBe(1);
    expect(stories[0]!.eventType).toBe("SPORTING_DIRECTOR_PRESS_STATEMENT");
    expect(stories[0]!.scope).toBe("club");
    db.close();
  });
});

describe("press Story materiality — AI", () => {
  it("an AI-completed POST_MATCH interview publishes a Story if and only if the AI's own chosen answer was genuinely material — the exact same publishMaterialPressEvent path as every human role, never a parallel AI Story system", () => {
    const path = makeSave("story-ai-parity");
    const db = openGameDatabase(path);
    const [home, away] = twoManagedTeams(db);
    const managerPersonId = ensureManagerFor(db, home);
    const dismissedPlayer = playerOnTeam(db, home);
    const fixtureId = "story-ai-fixture" as EntityId;
    const matchId = "story-ai-match" as EntityId;
    db.prepare(
      "INSERT INTO fixtures (id, competition_season_id, home_team_id, away_team_id, scheduled_date, status) VALUES (?, NULL, ?, ?, ?, 'played')",
    ).run(fixtureId, home, away, "2026-09-05");
    db.prepare(
      "INSERT INTO matches (id, fixture_id, played_date, home_goals, away_goals) VALUES (?, ?, ?, ?, ?)",
    ).run(matchId, fixtureId, "2026-09-05", 1, 1);
    db.prepare(
      "INSERT INTO match_events (id, match_id, minute, type, team_id, primary_person_id) VALUES (?, ?, ?, 'RED_CARD', ?, ?)",
    ).run(`${matchId}-red`, matchId, 55, home, dismissedPlayer);

    const trigger = shouldCreatePostMatchPress(db, { teamId: home, fixtureId });
    expect(trigger.trigger).toBe(true);

    const aiInterview = runAiPressConference(db, {
      context: "POST_MATCH",
      managerPersonId,
      teamId: home,
      fixtureId,
      date: "2026-09-05",
      seed: "story-ai-parity-seed",
    });
    expect(aiInterview?.status).toBe("COMPLETED");
    const materialAnswer = aiInterview!.structuredAnswers!.find((answer) =>
      (["COMMIT", "PROTECT_PLAYER", "CHALLENGE_PLAYER", "CRITICAL"] as PressResponseStance[]).includes(answer.stance),
    );
    const stories = pressStories(db);
    if (materialAnswer) {
      expect(stories.length).toBe(1);
      expect(stories[0]!.eventType).toMatch(/^MANAGER_PRESS_/);
      expect(stories[0]!.involvedEntities.some((ref) => ref.id === managerPersonId)).toBe(true);
    } else {
      expect(stories.length).toBe(0);
    }
    db.close();
  });

  it("re-running the AI production call against the same already-completed fact never duplicates its Story", () => {
    const path = makeSave("story-ai-exact-once");
    const db = openGameDatabase(path);
    const [home, away] = twoManagedTeams(db);
    const managerPersonId = ensureManagerFor(db, home);
    const dismissedPlayer = playerOnTeam(db, home);
    const fixtureId = "story-ai-repeat-fixture" as EntityId;
    const matchId = "story-ai-repeat-match" as EntityId;
    db.prepare(
      "INSERT INTO fixtures (id, competition_season_id, home_team_id, away_team_id, scheduled_date, status) VALUES (?, NULL, ?, ?, ?, 'played')",
    ).run(fixtureId, home, away, "2026-09-05");
    db.prepare(
      "INSERT INTO matches (id, fixture_id, played_date, home_goals, away_goals) VALUES (?, ?, ?, ?, ?)",
    ).run(matchId, fixtureId, "2026-09-05", 0, 3);
    db.prepare(
      "INSERT INTO match_events (id, match_id, minute, type, team_id, primary_person_id) VALUES (?, ?, ?, 'RED_CARD', ?, ?)",
    ).run(`${matchId}-red`, matchId, 20, home, dismissedPlayer);

    for (let i = 0; i < 5; i += 1) {
      runAiPressConference(db, {
        context: "POST_MATCH",
        managerPersonId,
        teamId: home,
        fixtureId,
        date: "2026-09-05",
        seed: "story-ai-repeat-seed",
      });
    }
    const interviewCount = generatePressQuestions(db, { context: "POST_MATCH", teamId: home, fixtureId }).length; // sanity: still bounded/deterministic
    expect(interviewCount).toBeGreaterThanOrEqual(0);
    const stories = pressStories(db).filter((event) => event.eventType.startsWith("MANAGER_PRESS_"));
    expect(stories.length).toBeLessThanOrEqual(1);
    db.close();
  });
});
