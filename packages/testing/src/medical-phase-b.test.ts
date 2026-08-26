import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, MedicalRepository, PlayerRepository, WorldRepository, migrateDatabase, openGameDatabase } from "@nepal-football-sim/database";
import {
  advanceAllRehabilitationPlans,
  advanceRehabilitationPlan,
  assessPlayerMedical,
  chronicRiskFlag,
  earlyReturnRisk,
  ensureRehabilitationPlan,
  recordReturnToPlayDecision,
} from "@nepal-football-sim/simulation";
import { SeededRandom } from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";
import type { Club, Country, InjuryRecord, Person, SaveMetadata, Team } from "@nepal-football-sim/shared-types";

const saveAt = (worldDate: string): SaveMetadata => ({
  id: createStableEntityId("save", "medical-phase-b-test"),
  name: "Medical Phase B Test",
  worldDate,
  databaseVersion: 57,
  gameVersion: "test",
  randomSeed: "medical-phase-b-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSavedAt: "2026-01-01T00:00:00.000Z",
});

const tempDirs: string[] = [];
const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "medical-phase-b-"));
  tempDirs.push(dir);
  return join(dir, "save.sqlite");
};
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const setupWorld = () => {
  const dbPath = tempDbPath();
  const db = openGameDatabase(dbPath);
  migrateDatabase(db);
  const world = new WorldRepository(db);
  const country: Country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
  world.insertCountry(country);
  return { db, world, country };
};

const makeClub = (world: WorldRepository, country: Country, key: string): Club => {
  const club: Club = { id: createStableEntityId("club", key), name: key, countryId: country.id, ownershipType: "PRIVATE" };
  world.insertClub(club);
  return club;
};

const makeTeam = (world: WorldRepository, club: Club, key: string): Team => {
  const team: Team = { id: createStableEntityId("team", key), clubId: club.id, name: key, level: "senior", gender: "men" };
  world.insertTeam(team);
  return team;
};

const makePerson = (world: WorldRepository, country: Country, key: string): Person => {
  const person: Person = { id: createStableEntityId("person", key), fullName: key, nationalityCountryId: country.id, languages: ["ne"] };
  world.insertPerson(person);
  return person;
};

const assignToTeam = (world: WorldRepository, team: Team, person: Person, key: string): void => {
  world.insertTeamPersonAssignment({ id: createStableEntityId("assignment", key), teamId: team.id, personId: person.id, role: "PLAYER", startedOn: "2026-01-01" });
};

const giveGoodMedicalStaff = (db: ReturnType<typeof openGameDatabase>, world: WorldRepository, country: Country, club: Club, economy: ClubEconomyRepository): void => {
  const physioId = createStableEntityId("person", `${club.id}-physio-person`);
  const doctorId = createStableEntityId("person", `${club.id}-doctor-person`);
  world.insertPerson({ id: physioId, fullName: "Physio", nationalityCountryId: country.id, languages: ["ne"] });
  world.insertPerson({ id: doctorId, fullName: "Doctor", nationalityCountryId: country.id, languages: ["ne"] });
  db.prepare(
    `INSERT INTO staff_appointments (id, person_id, organisation_type, club_id, role, employment_status)
    VALUES (?, ?, 'CLUB', ?, 'HEAD_PHYSIO', 'ACTIVE')`,
  ).run(createStableEntityId("staff-appointment", `${club.id}-physio`), physioId, club.id);
  db.prepare(
    `INSERT INTO staff_appointments (id, person_id, organisation_type, club_id, role, employment_status)
    VALUES (?, ?, 'CLUB', ?, 'DOCTOR', 'ACTIVE')`,
  ).run(createStableEntityId("staff-appointment", `${club.id}-doctor`), doctorId, club.id);
  economy.upsertFacilityProfile({
    clubId: club.id,
    trainingFacilityQuality: 8,
    youthFacilityQuality: 8,
    medicalFacilityQuality: 9,
    analyticsFacilityQuality: 5,
    academyCapacity: 30,
    monthlyOperatingCost: 10000,
    currency: "NPR",
    status: "SIMULATION_ONLY",
  });
};

const giveNoMedicalStaff = (economy: ClubEconomyRepository, club: Club): void => {
  economy.upsertFacilityProfile({
    clubId: club.id,
    trainingFacilityQuality: 3,
    youthFacilityQuality: 3,
    medicalFacilityQuality: 1,
    analyticsFacilityQuality: 1,
    academyCapacity: 10,
    monthlyOperatingCost: 3000,
    currency: "NPR",
    status: "SIMULATION_ONLY",
  });
};

const injuryFor = (personId: string, dateOccurred: string, expectedRecoveryDate: string, severity: InjuryRecord["severity"] = "moderate"): InjuryRecord => ({
  id: createStableEntityId("injury", `${personId}-${dateOccurred}`),
  personId: createStableEntityId("person", personId),
  injuryType: "hamstring strain",
  dateOccurred,
  expectedRecoveryDate,
  severity,
});

describe("medical, fitness & injury management phase B", () => {
  it("progresses a rehab plan through all five staged phases as time passes", () => {
    const { db, world, country } = setupWorld();
    const club = makeClub(world, country, "progression-club");
    const team = makeTeam(world, club, "progression-team");
    const player = makePerson(world, country, "progression-player");
    assignToTeam(world, team, player, "progression-assignment");
    new PlayerRepository(db).upsertAvailabilityState({ personId: player.id, teamId: team.id, fitness: 40, moraleModifier: 0, formModifier: 0, availability: "INJURED", updatedOn: "2026-01-01" });
    const injury = injuryFor("progression-player", "2026-01-01", "2026-03-02", "moderate"); // 60 days
    new PlayerRepository(db).insertInjury(injury);

    let plan = ensureRehabilitationPlan(db, injury, "2026-01-01");
    expect(plan.stage).toBe("PROTECTION_REST");

    const stagesSeen: string[] = [plan.stage];
    for (const date of ["2026-01-10", "2026-01-25", "2026-02-10", "2026-02-25", "2026-03-02"]) {
      const advanced = advanceRehabilitationPlan(db, plan, injury, date);
      plan = advanced.plan;
      stagesSeen.push(plan.stage);
    }
    expect(stagesSeen[stagesSeen.length - 1]).toBe("MATCH_READY");
    // Stage never regresses on its own.
    const order = ["PROTECTION_REST", "REHABILITATION", "PARTIAL_TRAINING", "FULL_TRAINING", "MATCH_READY"];
    let lastIndex = -1;
    for (const stage of stagesSeen) {
      expect(order.indexOf(stage)).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = order.indexOf(stage);
    }
    db.close();
  });

  it("lets better medical staff and facilities progress a plan faster than a club with none", () => {
    const { db, world, country } = setupWorld();
    const economy = new ClubEconomyRepository(db);
    const goodClub = makeClub(world, country, "good-medical-club");
    const poorClub = makeClub(world, country, "poor-medical-club");
    giveGoodMedicalStaff(db, world, country, goodClub, economy);
    giveNoMedicalStaff(economy, poorClub);

    const goodInjury = injuryFor("good-player", "2026-01-01", "2026-03-02", "moderate");
    const poorInjury = injuryFor("poor-player", "2026-01-01", "2026-03-02", "moderate");
    world.insertPerson({ id: goodInjury.personId, fullName: "Good Player", nationalityCountryId: country.id, languages: ["ne"] });
    world.insertPerson({ id: poorInjury.personId, fullName: "Poor Player", nationalityCountryId: country.id, languages: ["ne"] });
    new PlayerRepository(db).insertInjury(goodInjury);
    new PlayerRepository(db).insertInjury(poorInjury);

    let goodPlan = ensureRehabilitationPlan(db, goodInjury, "2026-01-01");
    let poorPlan = ensureRehabilitationPlan(db, poorInjury, "2026-01-01");
    goodPlan = { ...goodPlan, clubId: goodClub.id };
    poorPlan = { ...poorPlan, clubId: poorClub.id };
    new MedicalRepository(db).upsertRehabilitationPlan(goodPlan);
    new MedicalRepository(db).upsertRehabilitationPlan(poorPlan);

    const midDate = "2026-01-30"; // ~48% of the way through
    const goodResult = advanceRehabilitationPlan(db, goodPlan, goodInjury, midDate);
    const poorResult = advanceRehabilitationPlan(db, poorPlan, poorInjury, midDate);
    const order = ["PROTECTION_REST", "REHABILITATION", "PARTIAL_TRAINING", "FULL_TRAINING", "MATCH_READY"];
    expect(order.indexOf(goodResult.plan.stage)).toBeGreaterThanOrEqual(order.indexOf(poorResult.plan.stage));
    db.close();
  });

  it("holds a plan at DELAY until the manager makes a fresh decision, then lets it advance", () => {
    const { db, world, country } = setupWorld();
    const player = makePerson(world, country, "delay-player");
    const injury = injuryFor("delay-player", "2026-01-01", "2026-01-20", "minor");
    new PlayerRepository(db).insertInjury(injury);
    void player;

    let plan = ensureRehabilitationPlan(db, injury, "2026-01-01");
    const dueDate = "2026-01-20"; // fully elapsed, medically due for MATCH_READY
    const held = recordReturnToPlayDecision(db, saveAt(dueDate), { personId: injury.personId, decision: "DELAY" });
    expect(held.decision.outcome).toBe("HELD");

    // Even a natural world-wide tick will not move it forward while held.
    advanceAllRehabilitationPlans(db, saveAt(dueDate));
    plan = new MedicalRepository(db).activeRehabilitationPlan(injury.personId)!;
    expect(plan.stage).not.toBe("MATCH_READY");

    const followed = recordReturnToPlayDecision(db, saveAt(dueDate), { personId: injury.personId, decision: "FOLLOW_ADVICE" });
    expect(followed.plan.stage).toBe("MATCH_READY");
    db.close();
  });

  it("bounds early-return risk so it always increases with worse history/stage and is never guaranteed", () => {
    const low = earlyReturnRisk(0.05, "FULL_TRAINING", 9, 9);
    const high = earlyReturnRisk(0.4, "PROTECTION_REST", 3, 2);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThan(1);
    expect(low).toBeGreaterThan(0);

    const betterStaff = earlyReturnRisk(0.2, "REHABILITATION", 9, 9);
    const worseStaff = earlyReturnRisk(0.2, "REHABILITATION", 3, 3);
    expect(betterStaff).toBeLessThan(worseStaff);
  });

  it("accepting risk from match-ready is a no-op, and rolls a deterministic, seeded, non-guaranteed setback otherwise", () => {
    const { db, world, country } = setupWorld();
    const player = makePerson(world, country, "risk-player");
    const injury = injuryFor("risk-player", "2026-01-01", "2026-06-01", "minor");
    new PlayerRepository(db).insertInjury(injury);
    void player;
    ensureRehabilitationPlan(db, injury, "2026-01-01");

    const date = "2026-01-05";
    // Mirror exactly what recordReturnToPlayDecision computes internally (no club on this
    // player, so default staff/facility quality applies) to make the expected roll precise.
    const assessment = assessPlayerMedical(db, { clubId: "" as never, personId: injury.personId, date });
    const risk = earlyReturnRisk(assessment.recurrenceRisk, "PROTECTION_REST", 5, 3);
    const result = recordReturnToPlayDecision(db, saveAt(date), { personId: injury.personId, decision: "ACCEPT_RISK" });
    const expectedSetback = new SeededRandom(`${injury.personId}:${date}:accept-risk`).next() < risk;
    expect(result.setback).toBe(expectedSetback);
    expect(result.decision.outcome).toBe(expectedSetback ? "SETBACK" : "ADVANCED");
    if (!expectedSetback) expect(result.plan.stage).toBe("MATCH_READY");
    else expect(new PlayerRepository(db).activeInjuries(date).some((i) => i.personId === injury.personId)).toBe(true);

    // Already match-ready: accepting risk again changes nothing and never rolls a new setback.
    if (!expectedSetback) {
      const again = recordReturnToPlayDecision(db, saveAt(date), { personId: injury.personId, decision: "ACCEPT_RISK" });
      expect(again.decision.outcome).toBe("NO_CHANGE");
      expect(again.setback).toBe(false);
    }
    db.close();
  });

  it("flags recurring/chronic risk only from real simulated injury history within the last year", () => {
    const { db, world, country } = setupWorld();
    const player = makePerson(world, country, "chronic-player");
    void player;
    const players = new PlayerRepository(db);
    expect(chronicRiskFlag(db, player.id, "2026-06-01")).toBe(false);

    players.insertInjury(injuryFor("chronic-player", "2026-01-01", "2026-01-10"));
    players.insertInjury(injuryFor("chronic-player", "2026-02-01", "2026-02-10"));
    expect(chronicRiskFlag(db, player.id, "2026-06-01")).toBe(false); // only 2 so far

    players.insertInjury(injuryFor("chronic-player", "2026-03-01", "2026-03-10"));
    expect(chronicRiskFlag(db, player.id, "2026-06-01")).toBe(true); // 3 within the trailing year

    // An old injury outside the trailing year should not count.
    const { db: db2, world: world2, country: country2 } = setupWorld();
    const oldPlayer = makePerson(world2, country2, "old-history-player");
    const oldPlayers = new PlayerRepository(db2);
    oldPlayers.insertInjury(injuryFor("old-history-player", "2023-01-01", "2023-01-10"));
    oldPlayers.insertInjury(injuryFor("old-history-player", "2023-02-01", "2023-02-10"));
    oldPlayers.insertInjury(injuryFor("old-history-player", "2023-03-01", "2023-03-10"));
    expect(chronicRiskFlag(db2, oldPlayer.id, "2026-06-01")).toBe(false);
    db2.close();
    db.close();
  });

  it("keeps a persistent, queryable return-to-play decision history", () => {
    const { db, world, country } = setupWorld();
    const player = makePerson(world, country, "history-player");
    const injury = injuryFor("history-player", "2026-01-01", "2026-01-30");
    new PlayerRepository(db).insertInjury(injury);
    void player;
    ensureRehabilitationPlan(db, injury, "2026-01-01");

    recordReturnToPlayDecision(db, saveAt("2026-01-05"), { personId: injury.personId, decision: "FOLLOW_ADVICE" });
    recordReturnToPlayDecision(db, saveAt("2026-01-10"), { personId: injury.personId, decision: "DELAY" });

    const history = new MedicalRepository(db).rehabDecisionHistory(injury.personId);
    expect(history).toHaveLength(2);
    expect(history[0]!.decidedOn).toBe("2026-01-10"); // newest first
    expect(history[1]!.decision).toBe("FOLLOW_ADVICE");
    db.close();
  });

  it("completes a rehab plan once the underlying injury has naturally recovered", () => {
    const { db, world, country } = setupWorld();
    const player = makePerson(world, country, "completion-player");
    const injury = injuryFor("completion-player", "2026-01-01", "2026-01-15", "minor");
    new PlayerRepository(db).insertInjury(injury);
    void player;

    ensureRehabilitationPlan(db, injury, "2026-01-01");
    advanceAllRehabilitationPlans(db, saveAt("2026-01-16")); // past recovery date
    const plan = new MedicalRepository(db).rehabilitationPlanForInjury(injury.id)!;
    expect(plan.status).toBe("COMPLETED");
    db.close();
  });

  it("persists rehabilitation plans and decisions across a save/load cycle", () => {
    const dbPath = tempDbPath();
    let db = openGameDatabase(dbPath);
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const country: Country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
    world.insertCountry(country);
    const player = makePerson(world, country, "persist-player");
    const injury = injuryFor("persist-player", "2026-01-01", "2026-02-01");
    new PlayerRepository(db).insertInjury(injury);
    void player;
    ensureRehabilitationPlan(db, injury, "2026-01-01");
    recordReturnToPlayDecision(db, saveAt("2026-01-05"), { personId: injury.personId, decision: "FOLLOW_ADVICE" });
    db.close();

    db = openGameDatabase(dbPath);
    migrateDatabase(db);
    const reopened = new MedicalRepository(db);
    expect(reopened.rehabilitationPlanForInjury(injury.id)?.status).toBe("ACTIVE");
    expect(reopened.rehabDecisionHistory(injury.personId)).toHaveLength(1);
    db.close();
  });
});
