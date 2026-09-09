import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CompetitionRepository,
  ManagerRepository,
  PlayerRepository,
  SquadDynamicsRepository,
  TransferMarketRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  ConcernActionError,
  buildPlayerProfile,
  createCareerCharacter,
  evaluateSquadDynamics,
  manageAiPromisesForTeam,
  respondToConcern,
  testLicence,
} from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type Club,
  type EntityId,
  type PlayerAttributeSet,
  type PlayerConcern,
  type Team,
  type TransferOffer,
} from "@nepal-football-sim/shared-types";

const attributesFor = (personId: EntityId): PlayerAttributeSet => ({
  id: createStableEntityId("attributes", personId),
  personId,
  primaryPosition: "CM",
  secondaryPositions: [],
  technical: {
    firstTouch: 10,
    passing: 10,
    crossing: 10,
    dribbling: 10,
    finishing: 10,
    heading: 10,
    tackling: 10,
    technique: 10,
    longShots: 10,
    setPieces: 10,
  },
  mental: {
    decisions: 10,
    vision: 10,
    composure: 10,
    positioning: 10,
    anticipation: 10,
    workRate: 10,
    teamwork: 10,
    leadership: 10,
    aggression: 10,
    determination: 10,
    professionalism: 12,
  },
  physical: {
    pace: 10,
    acceleration: 10,
    strength: 10,
    stamina: 10,
    agility: 10,
    balance: 10,
    jumping: 10,
    naturalFitness: 10,
  },
  goalkeeping: {
    handling: 1,
    reflexes: 1,
    oneOnOnes: 1,
    aerialReach: 1,
    kicking: 1,
    distribution: 1,
    commandOfArea: 1,
  },
});

describe("squad dynamics phase B: conversations and promises", () => {
  const savesDirectory = mkdtempSync(join(tmpdir(), "squad-dynamics-promises-"));
  const dbPath = join(savesDirectory, "career.sqlite");
  let db = openGameDatabase(dbPath);
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
  const club: Club = {
    id: createStableEntityId("club", "sdb-club"),
    name: "Promise FC",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const team: Team = {
    id: createStableEntityId("team", "sdb-club-senior"),
    clubId: club.id,
    name: "Promise FC",
    level: "senior",
    gender: "men",
  };
  const competitionId = createStableEntityId("competition", "sdb-league");
  const seasonId = createStableEntityId("season", "sdb-league-2026");
  const keyPlayerId = createStableEntityId("person", "sdb-key-player");

  let managerProfileId: EntityId;

  beforeAll(() => {
    const world = new WorldRepository(db);
    world.insertCountry(country);
    world.insertClub(club);
    world.insertTeam(team);
    world.insertCompetition({ id: competitionId, name: "Test League", scope: "domestic" });
    world.insertCompetitionSeason({
      id: seasonId,
      competitionId,
      name: "2026 Test League",
      startDate: "2026-08-01",
      endDate: "2027-05-31",
    });
    world.insertClubMembership({
      id: createStableEntityId("membership", "sdb-club"),
      clubId: club.id,
      teamId: team.id,
      competitionId,
      competitionSeasonId: seasonId,
      membershipType: "LEAGUE_MEMBER",
      status: "ACTIVE",
    });

    world.insertPerson({
      id: keyPlayerId,
      fullName: "Key Player",
      nationalityCountryId: country.id,
      languages: ["ne"],
    });
    world.insertPersonRole({
      id: createStableEntityId("role", `${keyPlayerId}:player`),
      personId: keyPlayerId,
      role: "PLAYER",
      activeFrom: "2026-08-01",
    });
    world.insertTeamPersonAssignment({
      id: createStableEntityId("assignment", `${keyPlayerId}:player`),
      personId: keyPlayerId,
      teamId: team.id,
      role: "PLAYER",
      startedOn: "2026-08-01",
    });
    new PlayerRepository(db).insertAttributes(attributesFor(keyPlayerId));

    new TransferMarketRepository(db).upsertPlayerContract({
      id: createStableEntityId("contract", "sdb-key-player"),
      playerId: keyPlayerId,
      clubId: club.id,
      startDate: "2026-08-01",
      endDate: "2027-06-01",
      contractType: "PROFESSIONAL",
      salary: 100_000,
      appearanceFee: 0,
      goalBonus: 0,
      cleanSheetBonus: 0,
      signingBonus: 0,
      loyaltyBonus: 0,
      currency: "NPR",
      squadRole: "KEY_PLAYER",
      status: "ACTIVE",
      provenance: { sourceName: "test", confidence: 1, status: "SIMULATION_ONLY" },
    });
    new CompetitionRepository(db).upsertPlayerSeasonStat({
      competitionSeasonId: seasonId,
      personId: keyPlayerId,
      teamId: team.id,
      appearances: 1,
      starts: 1,
      minutes: 90,
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      averageRating: 6.5,
      cleanSheets: 0,
    });
    new CompetitionRepository(db).upsertStanding({
      competitionSeasonId: seasonId,
      teamId: team.id,
      played: 10,
      won: 4,
      drawn: 3,
      lost: 3,
      goalsFor: 12,
      goalsAgainst: 10,
      goalDifference: 2,
      points: 15,
    });

    const character = createCareerCharacter({
      fullName: "Test Manager",
      dateOfBirth: "1980-01-01",
      startingAge: 46,
      nationalityCountryId: country.id,
      languages: ["ne"],
      footballBackground: "LOCAL_FOOTBALL",
      education: "UNIVERSITY",
      playingExperience: "PROFESSIONAL_PLAYER",
      coachingExperience: "SENIOR_COACH",
      coachingLicences: [testLicence("Testing A Licence", 3)],
      businessBackground: "NONE",
      startingReputationProfile: "FORMER_PLAYER",
      careerStartDate: "2026-08-01",
    });
    world.insertPerson(character.person);
    new ManagerRepository(db).insertProfile(character.managerProfile);
    managerProfileId = character.managerProfile.id;

    // Establishes the PLAYING_TIME concern this whole suite responds to.
    evaluateSquadDynamics(db, saveAt("2026-10-15"), team.id, club.id, managerProfileId);
  });

  const saveAt = (worldDate: string) => ({
    id: createStableEntityId("save", "squad-dynamics-promises-test"),
    name: "Squad Dynamics Promises Test",
    worldDate,
    databaseVersion: 25,
    gameVersion: "test",
    randomSeed: "squad-dynamics-promises-test",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSavedAt: "2026-01-01T00:00:00.000Z",
  });

  it("rejects a response to a concern that does not exist", () => {
    expect(() =>
      respondToConcern(
        db,
        saveAt("2026-10-15"),
        managerProfileId,
        createStableEntityId("concern", "missing"),
        "REASSURE",
      ),
    ).toThrow(ConcernActionError);
  });

  it("rejects an action that does not fit the concern type", () => {
    const concern = new SquadDynamicsRepository(db).concern(keyPlayerId, team.id, "PLAYING_TIME")!;
    expect(() =>
      respondToConcern(
        db,
        saveAt("2026-10-15"),
        managerProfileId,
        concern.id,
        "PROMISE_CONTRACT_REVIEW",
      ),
    ).toThrow(ConcernActionError);
  });

  let concernId: EntityId;

  it("making a playing-time promise creates an ACTIVE promise and logs the response", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const concern = dynamics.concern(keyPlayerId, team.id, "PLAYING_TIME")!;
    concernId = concern.id;

    // Push the relationship high enough that the outcome is deterministically
    // not a rejection, so the rest of this suite can assert on a real promise.
    dynamics.upsertRelationship({
      id: createStableEntityId("relationship", `${managerProfileId}:${keyPlayerId}`),
      managerProfileId,
      personId: keyPlayerId,
      score: 90,
      level: "STRONG",
      updatedOn: "2026-10-15",
    });

    const response = respondToConcern(
      db,
      saveAt("2026-10-15"),
      managerProfileId,
      concernId,
      "PROMISE_PLAYING_TIME",
    );
    expect(response.outcome).not.toBe("REJECTED");

    const responses = dynamics.responsesForConcern(concernId);
    expect(responses).toHaveLength(1);
    expect(responses[0]!.action).toBe("PROMISE_PLAYING_TIME");

    expect(response.promiseId).toBeDefined();
    const promise = dynamics.promiseById(response.promiseId!)!;
    expect(promise.status).toBe("ACTIVE");
    expect(promise.type).toBe("PLAYING_TIME");
    expect(promise.baselineMetric).toBe(1);

    const history = dynamics.historyForPerson(keyPlayerId);
    expect(history.some((event) => event.eventType === "PROMISE_MADE")).toBe(true);

    // A day later, still well short of the promise's due date, the concern's
    // own 30-day escalation clock has not fired and the promise suppresses it
    // regardless.
    evaluateSquadDynamics(db, saveAt("2026-10-16"), team.id, club.id, managerProfileId);
    const stillActive = dynamics.concernById(concernId)!;
    expect(stillActive.status).not.toBe("ESCALATED");
  });

  it("keeping the promise resolves the concern and improves the relationship", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const promise = dynamics.activePromisesForTeam(team.id).find((p) => p.concernId === concernId)!;
    expect(promise).toBeDefined();

    // Give the player real, matching game time before the promise falls due.
    new CompetitionRepository(db).upsertPlayerSeasonStat({
      competitionSeasonId: seasonId,
      personId: keyPlayerId,
      teamId: team.id,
      appearances: 5,
      starts: 5,
      minutes: 450,
      goals: 1,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      averageRating: 6.9,
      cleanSheets: 0,
    });

    const before = dynamics.relationship(managerProfileId, keyPlayerId)?.score ?? 0;
    evaluateSquadDynamics(db, saveAt(promise.dueOn), team.id, club.id, managerProfileId);

    const resolvedPromise = dynamics.promiseById(promise.id)!;
    expect(resolvedPromise.status).toBe("FULFILLED");
    const concern = dynamics.concernById(concernId)!;
    expect(concern.status).toBe("RESOLVED");
    const after = dynamics.relationship(managerProfileId, keyPlayerId)?.score ?? 0;
    expect(after).toBeGreaterThan(before);

    const history = dynamics.historyForPerson(keyPlayerId);
    expect(history.some((event) => event.eventType === "PROMISE_KEPT")).toBe(true);
  });

  it("persists promises and concern responses across a save/load cycle", () => {
    db.close();
    db = openGameDatabase(dbPath);

    const dynamics = new SquadDynamicsRepository(db);
    const promises = dynamics.promisesForPerson(keyPlayerId, team.id);
    expect(promises.length).toBeGreaterThan(0);
    const responses = dynamics.responsesForConcern(concernId);
    expect(responses.length).toBeGreaterThan(0);
  });

  it("lets an AI manager make one feasible promise through the canonical path", () => {
    let dynamics = new SquadDynamicsRepository(db);
    const concern: PlayerConcern = {
      id: createStableEntityId("concern", "ai-playing-time"),
      personId: keyPlayerId,
      teamId: team.id,
      type: "PLAYING_TIME",
      status: "ACTIVE",
      severity: 7,
      raisedOn: "2026-10-15",
      updatedOn: "2026-10-15",
    };
    dynamics.upsertConcern(concern);
    const storedConcern = dynamics.concern(keyPlayerId, team.id, "PLAYING_TIME")!;
    // Keep contract-review feasibility out of this isolated AI playing-time case.
    db.prepare("UPDATE player_contracts SET end_date = ? WHERE player_id = ?").run(
      "2027-12-01",
      keyPlayerId,
    );
    db.prepare(
      "UPDATE player_season_stats SET appearances = 1 WHERE person_id = ? AND team_id = ?",
    ).run(keyPlayerId, team.id);

    const outcome = manageAiPromisesForTeam(
      db,
      saveAt("2026-10-15"),
      team.id,
      club.id,
      managerProfileId,
    );
    expect(outcome.createdPromises).toHaveLength(1);
    expect(outcome.createdPromises[0]!.type).toBe("PLAYING_TIME");
    expect(dynamics.responsesForConcern(storedConcern.id).at(-1)!.outcome).toBe("ACCEPTED");

    const replay = manageAiPromisesForTeam(
      db,
      saveAt("2026-10-15"),
      team.id,
      club.id,
      managerProfileId,
    );
    expect(replay.createdPromises).toHaveLength(0);

    db.close();
    db = openGameDatabase(dbPath);
    dynamics = new SquadDynamicsRepository(db);
    expect(dynamics.promiseById(outcome.createdPromises[0]!.id)?.status).toBe("ACTIVE");

    db.prepare(
      "UPDATE player_season_stats SET appearances = 5 WHERE person_id = ? AND team_id = ?",
    ).run(keyPlayerId, team.id);
    const aiPromise = outcome.createdPromises[0]!;
    evaluateSquadDynamics(db, saveAt(aiPromise.dueOn), team.id, club.id, managerProfileId);
    expect(dynamics.promiseById(aiPromise.id)!.status).toBe("FULFILLED");
    const relationshipAfterFulfilment =
      dynamics.relationship(managerProfileId, keyPlayerId)?.score ?? 0;
    evaluateSquadDynamics(db, saveAt(aiPromise.dueOn), team.id, club.id, managerProfileId);
    expect(dynamics.relationship(managerProfileId, keyPlayerId)?.score).toBe(
      relationshipAfterFulfilment,
    );
  });

  it("does not create an AI transfer promise without a real transfer concern", () => {
    const dynamics = new SquadDynamicsRepository(db);
    db.prepare(
      "UPDATE player_season_stats SET appearances = 5 WHERE person_id = ? AND team_id = ?",
    ).run(keyPlayerId, team.id);
    const concern: PlayerConcern = {
      id: createStableEntityId("concern", "ai-transfer-infeasible"),
      personId: keyPlayerId,
      teamId: team.id,
      type: "TRANSFER_INTEREST",
      status: "ACTIVE",
      severity: 7,
      raisedOn: "2027-02-01",
      updatedOn: "2027-02-01",
    };
    dynamics.upsertConcern(concern);
    const outcome = manageAiPromisesForTeam(
      db,
      saveAt("2027-02-01"),
      team.id,
      club.id,
      managerProfileId,
    );
    expect(outcome.createdPromises).toHaveLength(0);
    expect(dynamics.activePromiseForConcern(concern.id)).toBeUndefined();
  });
});

describe("squad dynamics phase B: a broken promise", () => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
  const club: Club = {
    id: createStableEntityId("club", "sdb-broken-club"),
    name: "Broken Promise FC",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const team: Team = {
    id: createStableEntityId("team", "sdb-broken-senior"),
    clubId: club.id,
    name: "Broken Promise FC",
    level: "senior",
    gender: "men",
  };
  const competitionId = createStableEntityId("competition", "sdb-broken-league");
  const seasonId = createStableEntityId("season", "sdb-broken-league-2026");
  const playerId = createStableEntityId("person", "sdb-broken-player");
  let managerProfileId: EntityId;

  const saveAt = (worldDate: string) => ({
    id: createStableEntityId("save", "sdb-broken-test"),
    name: "Broken Promise Test",
    worldDate,
    databaseVersion: 25,
    gameVersion: "test",
    randomSeed: "sdb-broken-test",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSavedAt: "2026-01-01T00:00:00.000Z",
  });

  beforeAll(() => {
    const world = new WorldRepository(db);
    world.insertCountry(country);
    world.insertClub(club);
    world.insertTeam(team);
    world.insertCompetition({ id: competitionId, name: "Test League", scope: "domestic" });
    world.insertCompetitionSeason({
      id: seasonId,
      competitionId,
      name: "2026 Test League",
      startDate: "2026-08-01",
      endDate: "2027-05-31",
    });
    world.insertClubMembership({
      id: createStableEntityId("membership", "sdb-broken-club"),
      clubId: club.id,
      teamId: team.id,
      competitionId,
      competitionSeasonId: seasonId,
      membershipType: "LEAGUE_MEMBER",
      status: "ACTIVE",
    });
    world.insertPerson({
      id: playerId,
      fullName: "Bench Player",
      nationalityCountryId: country.id,
      languages: ["ne"],
    });
    world.insertPersonRole({
      id: createStableEntityId("role", `${playerId}:player`),
      personId: playerId,
      role: "PLAYER",
      activeFrom: "2026-08-01",
    });
    world.insertTeamPersonAssignment({
      id: createStableEntityId("assignment", `${playerId}:player`),
      personId: playerId,
      teamId: team.id,
      role: "PLAYER",
      startedOn: "2026-08-01",
    });
    new PlayerRepository(db).insertAttributes(attributesFor(playerId));
    new TransferMarketRepository(db).upsertPlayerContract({
      id: createStableEntityId("contract", "sdb-broken-player"),
      playerId,
      clubId: club.id,
      startDate: "2026-08-01",
      endDate: "2027-06-01",
      contractType: "PROFESSIONAL",
      salary: 100_000,
      appearanceFee: 0,
      goalBonus: 0,
      cleanSheetBonus: 0,
      signingBonus: 0,
      loyaltyBonus: 0,
      currency: "NPR",
      squadRole: "KEY_PLAYER",
      status: "ACTIVE",
      provenance: { sourceName: "test", confidence: 1, status: "SIMULATION_ONLY" },
    });
    new CompetitionRepository(db).upsertPlayerSeasonStat({
      competitionSeasonId: seasonId,
      personId: playerId,
      teamId: team.id,
      appearances: 1,
      starts: 1,
      minutes: 90,
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      averageRating: 6.5,
      cleanSheets: 0,
    });
    new CompetitionRepository(db).upsertStanding({
      competitionSeasonId: seasonId,
      teamId: team.id,
      played: 10,
      won: 4,
      drawn: 3,
      lost: 3,
      goalsFor: 12,
      goalsAgainst: 10,
      goalDifference: 2,
      points: 15,
    });

    const character = createCareerCharacter({
      fullName: "Test Manager Two",
      dateOfBirth: "1980-01-01",
      startingAge: 46,
      nationalityCountryId: country.id,
      languages: ["ne"],
      footballBackground: "LOCAL_FOOTBALL",
      education: "UNIVERSITY",
      playingExperience: "PROFESSIONAL_PLAYER",
      coachingExperience: "SENIOR_COACH",
      coachingLicences: [testLicence("Testing A Licence", 3)],
      businessBackground: "NONE",
      startingReputationProfile: "FORMER_PLAYER",
      careerStartDate: "2026-08-01",
    });
    world.insertPerson(character.person);
    new ManagerRepository(db).insertProfile(character.managerProfile);
    managerProfileId = character.managerProfile.id;

    evaluateSquadDynamics(db, saveAt("2026-10-15"), team.id, club.id, managerProfileId);
  });

  it("breaking a playing-time promise escalates the concern and hurts the relationship", () => {
    const dynamics = new SquadDynamicsRepository(db);
    // Force an ACCEPTED/SKEPTICAL outcome deterministically by boosting the
    // relationship before responding, so the promise is actually created.
    dynamics.upsertRelationship({
      id: createStableEntityId("relationship", `${managerProfileId}:${playerId}`),
      managerProfileId,
      personId: playerId,
      // The seeded response roll is intentionally outside the normal success
      // band; use the maximum relationship only to make promise setup stable.
      score: 100,
      level: "STRONG",
      updatedOn: "2026-10-15",
    });

    const concern = dynamics.concern(playerId, team.id, "PLAYING_TIME")!;
    const response = respondToConcern(
      db,
      saveAt("2026-10-15"),
      managerProfileId,
      concern.id,
      "PROMISE_PLAYING_TIME",
    );
    expect(response.outcome).not.toBe("REJECTED");
    const promise = dynamics.promiseById(response.promiseId!)!;

    const before = dynamics.relationship(managerProfileId, playerId)?.score ?? 0;
    // No improvement in appearances by the due date — the promise is broken.
    evaluateSquadDynamics(db, saveAt(promise.dueOn), team.id, club.id, managerProfileId);

    const resolvedPromise = dynamics.promiseById(promise.id)!;
    expect(resolvedPromise.status).toBe("BROKEN");
    const escalatedConcern = dynamics.concernById(concern.id)!;
    expect(escalatedConcern.status).toBe("ESCALATED");
    const after = dynamics.relationship(managerProfileId, playerId)?.score ?? 0;
    expect(after).toBeLessThan(before);

    const history = dynamics.historyForPerson(playerId);
    expect(history.some((event) => event.eventType === "PROMISE_BROKEN")).toBe(true);
  });
});

/**
 * Blocked (foreign) transfer — the player-facing relationship layer around a
 * real TRANSFER_INTEREST concern: the Player Profile's own transfer-context
 * DTO, and the DISMISS/REASSURE ends of the same respondToConcern pipeline
 * every other concern type already uses. PROMISE_TRANSFER_STANCE/
 * PROMISE_LOAN_CONSIDERATION's own measurable fulfil/break rules are covered
 * in the next describe block, isolated from these two so a later
 * evaluateSquadDynamics call here can never cross-contaminate them.
 */
describe("squad dynamics phase B: blocked-transfer (TRANSFER_INTEREST) reject/reassure and profile context", () => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "btr"), name: "BTR Country", isoCode: "BR" };
  const foreignCountry = { id: createStableEntityId("country", "btr-foreign"), name: "BTR Foreign Country", isoCode: "BF" };
  const foreignFederation = { id: createStableEntityId("federation", "btr-foreign-fed"), countryId: foreignCountry.id, name: "BTR Foreign Federation" };
  const club: Club = { id: createStableEntityId("club", "btr-club"), name: "Blocked Reject FC", countryId: country.id, ownershipType: "PRIVATE" };
  const team: Team = { id: createStableEntityId("team", "btr-senior"), clubId: club.id, name: "Blocked Reject FC", level: "senior", gender: "men" };
  const competitionId = createStableEntityId("competition", "btr-league");
  const seasonId = createStableEntityId("season", "btr-league-2026");
  const foreignClub: Club = { id: createStableEntityId("club", "btr-foreign-club"), name: "Overseas United", countryId: foreignCountry.id, ownershipType: "PRIVATE" };
  const leagueId = createStableEntityId("competition", "btr-foreign-league");

  const dismissPlayerId = createStableEntityId("person", "btr-dismiss");
  const reassurePlayerId = createStableEntityId("person", "btr-reassure");
  let managerProfileId: EntityId;

  const saveAt = (worldDate: string) => ({
    id: createStableEntityId("save", "btr-test"),
    name: "BTR Test",
    worldDate,
    databaseVersion: 97,
    gameVersion: "test",
    randomSeed: "btr-test",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSavedAt: "2026-01-01T00:00:00.000Z",
  });

  beforeAll(() => {
    const world = new WorldRepository(db);
    world.insertCountry(country);
    world.insertCountry(foreignCountry);
    world.insertFederation(foreignFederation);
    world.insertClub(club);
    world.insertTeam(team);
    world.insertClub(foreignClub);
    world.insertCompetition({ id: competitionId, name: "BTR League", scope: "domestic" });
    world.insertCompetitionSeason({ id: seasonId, competitionId, name: "2026 BTR League", startDate: "2026-08-01", endDate: "2027-05-31" });
    world.insertClubMembership({
      id: createStableEntityId("membership", "btr-club"), clubId: club.id, teamId: team.id,
      competitionId, competitionSeasonId: seasonId, membershipType: "LEAGUE_MEMBER", status: "ACTIVE",
    });
    world.insertCompetition({ id: leagueId, federationId: foreignFederation.id, name: "BTR Foreign League", scope: "domestic" });
    db.prepare(
      `INSERT INTO external_league_context (league_id, federation_id, country_id, tier, reputation, simulation_depth, continental_qualification)
       VALUES (?, ?, ?, 1, 9, 'CONTEXT_ONLY', 1)`,
    ).run(leagueId, foreignFederation.id, foreignCountry.id);
    db.prepare(
      `INSERT INTO external_club_context (club_id, league_id, federation_id, country_id, reputation, financial_band, academy_strength, scouting_reach, recruitment_regions_json, simulation_depth)
       VALUES (?, ?, ?, ?, 9, 'HIGH', 9, 9, '[]', 'CONTEXT_ONLY')`,
    ).run(foreignClub.id, leagueId, foreignFederation.id, foreignCountry.id);

    for (const id of [dismissPlayerId, reassurePlayerId]) {
      world.insertPerson({ id, fullName: `Player ${id}`, nationalityCountryId: country.id, languages: ["en"] });
      world.insertPersonRole({ id: createStableEntityId("role", `${id}:player`), personId: id, role: "PLAYER", activeFrom: "2026-08-01" });
      world.insertTeamPersonAssignment({ id: createStableEntityId("assignment", `${id}:player`), personId: id, teamId: team.id, role: "PLAYER", startedOn: "2026-08-01" });
      new PlayerRepository(db).insertAttributes(attributesFor(id));
    }
    const transfers = new TransferMarketRepository(db);
    for (const id of [dismissPlayerId, reassurePlayerId]) {
      transfers.upsertPlayerContract({
        id: createStableEntityId("contract", `btr-${id}`), playerId: id, clubId: club.id,
        startDate: "2026-08-01", endDate: "2028-05-31", contractType: "PROFESSIONAL", salary: 150_000,
        appearanceFee: 0, goalBonus: 0, cleanSheetBonus: 0, signingBonus: 0, loyaltyBonus: 0, currency: "NPR",
        squadRole: "IMPORTANT_PLAYER", status: "ACTIVE", provenance: { sourceName: "test", confidence: 1, status: "SIMULATION_ONLY" },
      });
    }

    const character = createCareerCharacter({
      fullName: "BTR Test Manager", dateOfBirth: "1980-01-01", startingAge: 46, nationalityCountryId: country.id,
      languages: ["en"], footballBackground: "LOCAL_FOOTBALL", education: "UNIVERSITY",
      playingExperience: "PROFESSIONAL_PLAYER", coachingExperience: "SENIOR_COACH",
      coachingLicences: [testLicence("Testing A Licence", 3)], businessBackground: "NONE",
      startingReputationProfile: "FORMER_PLAYER", careerStartDate: "2026-08-01",
    });
    world.insertPerson(character.person);
    new ManagerRepository(db).insertProfile(character.managerProfile);
    managerProfileId = character.managerProfile.id;

    const dynamics = new SquadDynamicsRepository(db);
    for (const id of [dismissPlayerId, reassurePlayerId]) {
      // A high, stable relationship so REASSURE's outcome is deterministic
      // (well outside the random-roll band), matching the pattern the
      // playing-time suite above already uses.
      dynamics.upsertRelationship({
        id: createStableEntityId("relationship", `${managerProfileId}:${id}`),
        managerProfileId, personId: id, score: 90, level: "STRONG", updatedOn: "2026-08-01",
      });
      // A real, already-ACTIVE TRANSFER_INTEREST concern and a matching
      // real, live buying offer — inserted directly rather than through the
      // ambition-scoring pipeline (already covered end to end by
      // blocked-transfer-chain.test.ts), so this suite isolates only the
      // response/DTO behaviour.
      dynamics.upsertConcern({
        id: createStableEntityId("concern", `${id}:transfer-interest`),
        personId: id, teamId: team.id, type: "TRANSFER_INTEREST", status: "ACTIVE",
        severity: 6, raisedOn: "2026-09-01", updatedOn: "2026-09-01",
      });
      const offer: TransferOffer = {
        id: createStableEntityId("transfer-offer", `${id}:offer`),
        buyingClubId: foreignClub.id, sellingClubId: club.id, playerId: id,
        offerType: "PERMANENT", transferFee: 1_500_000, installments: 0, addOns: 0, sellOnPercentage: 5,
        submittedAt: "2026-09-01", expiresAt: "2027-06-01", status: "NEGOTIATING", currency: "NPR",
        agentFee: 0, signingFee: 0,
      };
      transfers.insertTransferOffer(offer);
    }
  });

  const clubViewer = () => ({ role: "CHAIRMAN_OWNER" as const, clubId: club.id, teamId: team.id });

  it("Player Profile surfaces the real interested club, competition, and offer status", () => {
    const profile = buildPlayerProfile(db, saveAt("2026-09-01"), clubViewer(), dismissPlayerId);
    const concern = profile.relationship?.concerns.find((c) => c.type === "TRANSFER_INTEREST");
    expect(concern?.transferContext?.interestedClub.id).toBe(foreignClub.id);
    expect(concern?.transferContext?.interestedClub.label).toBe("Overseas United");
    expect(concern?.transferContext?.competition?.id).toBe(leagueId);
    expect(concern?.transferContext?.offerStatus).toBe("NEGOTIATING");
  });

  it("DISMISS ('too important to sell') rejects the concern, escalates it, and hurts the relationship", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const concern = dynamics.concern(dismissPlayerId, team.id, "TRANSFER_INTEREST")!;
    const before = dynamics.relationship(managerProfileId, dismissPlayerId)?.score ?? 0;
    const response = respondToConcern(db, saveAt("2026-09-01"), managerProfileId, concern.id, "DISMISS");
    expect(response.outcome).toBe("REJECTED");
    const updated = dynamics.concernById(concern.id)!;
    expect(updated.status).toBe("ESCALATED");
    const after = dynamics.relationship(managerProfileId, dismissPlayerId)?.score ?? 0;
    expect(after).toBeLessThan(before);

    const history = dynamics.historyForPerson(dismissPlayerId);
    expect(history.some((event) => event.eventType === "CONCERN_RESPONSE")).toBe(true);
  });

  it("REASSURE ('we'll revisit this'), accepted, eases the concern without creating a promise", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const concern = dynamics.concern(reassurePlayerId, team.id, "TRANSFER_INTEREST")!;
    const response = respondToConcern(db, saveAt("2026-09-01"), managerProfileId, concern.id, "REASSURE");
    expect(response.outcome).toBe("ACCEPTED");
    expect(response.promiseId).toBeUndefined();
    const updated = dynamics.concernById(concern.id)!;
    expect(updated.status).not.toBe("ESCALATED");
    expect(updated.severity).toBeLessThan(concern.severity);
  });

  it("clears the Player Profile transfer context once the offer becomes terminal", () => {
    const transfers = new TransferMarketRepository(db);
    const offer = transfers.transferOffers().find((candidate) => candidate.playerId === dismissPlayerId)!;
    transfers.insertTransferOffer({ ...offer, status: "REJECTED" });
    const profile = buildPlayerProfile(db, saveAt("2026-09-16"), clubViewer(), dismissPlayerId);
    const concern = profile.relationship?.concerns.find((c) => c.type === "TRANSFER_INTEREST");
    expect(concern?.transferContext).toBeUndefined();
  });

  it("refuses a second meeting for the same concern within the meeting cooldown, preventing a duplicate response/promise", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const concern = dynamics.concern(reassurePlayerId, team.id, "TRANSFER_INTEREST")!;
    expect(() =>
      respondToConcern(db, saveAt("2026-09-02"), managerProfileId, concern.id, "PROMISE_LOAN_CONSIDERATION"),
    ).toThrow();
    expect(dynamics.responsesForConcern(concern.id)).toHaveLength(1);
  });
});

/**
 * The PROMISE_TRANSFER_STANCE / PROMISE_LOAN_CONSIDERATION ends of the same
 * pipeline — a real, measurable promise (dueOn a fixed window from the
 * response), judged against real transfer-status/loan state at that
 * deadline, never resolved from display text. Kept in its own fixture so
 * the evaluateSquadDynamics calls at each promise's own deadline can never
 * cross-contaminate the DISMISS/REASSURE assertions above.
 */
describe("squad dynamics phase B: blocked-transfer (TRANSFER_INTEREST) promise semantics", () => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "btp"), name: "BTP Country", isoCode: "BP" };
  const foreignCountry = { id: createStableEntityId("country", "btp-foreign"), name: "BTP Foreign Country", isoCode: "PF" };
  const foreignFederation = { id: createStableEntityId("federation", "btp-foreign-fed"), countryId: foreignCountry.id, name: "BTP Foreign Federation" };
  const club: Club = { id: createStableEntityId("club", "btp-club"), name: "Blocked Promise FC", countryId: country.id, ownershipType: "PRIVATE" };
  const team: Team = { id: createStableEntityId("team", "btp-senior"), clubId: club.id, name: "Blocked Promise FC", level: "senior", gender: "men" };
  const competitionId = createStableEntityId("competition", "btp-league");
  const seasonId = createStableEntityId("season", "btp-league-2026");
  const foreignClub: Club = { id: createStableEntityId("club", "btp-foreign-club"), name: "Promise Overseas FC", countryId: foreignCountry.id, ownershipType: "PRIVATE" };
  const leagueId = createStableEntityId("competition", "btp-foreign-league");

  const stanceKeptPlayerId = createStableEntityId("person", "btp-stance-kept");
  const stanceBrokenPlayerId = createStableEntityId("person", "btp-stance-broken");
  const loanKeptPlayerId = createStableEntityId("person", "btp-loan-kept");
  const players = [stanceKeptPlayerId, stanceBrokenPlayerId, loanKeptPlayerId];
  let managerProfileId: EntityId;

  const saveAt = (worldDate: string) => ({
    id: createStableEntityId("save", "btp-test"),
    name: "BTP Test",
    worldDate,
    databaseVersion: 97,
    gameVersion: "test",
    randomSeed: "btp-test",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSavedAt: "2026-01-01T00:00:00.000Z",
  });

  beforeAll(() => {
    const world = new WorldRepository(db);
    world.insertCountry(country);
    world.insertCountry(foreignCountry);
    world.insertFederation(foreignFederation);
    world.insertClub(club);
    world.insertTeam(team);
    world.insertClub(foreignClub);
    world.insertCompetition({ id: competitionId, name: "BTP League", scope: "domestic" });
    world.insertCompetitionSeason({ id: seasonId, competitionId, name: "2026 BTP League", startDate: "2026-08-01", endDate: "2027-05-31" });
    world.insertClubMembership({
      id: createStableEntityId("membership", "btp-club"), clubId: club.id, teamId: team.id,
      competitionId, competitionSeasonId: seasonId, membershipType: "LEAGUE_MEMBER", status: "ACTIVE",
    });
    world.insertCompetition({ id: leagueId, federationId: foreignFederation.id, name: "BTP Foreign League", scope: "domestic" });
    db.prepare(
      `INSERT INTO external_league_context (league_id, federation_id, country_id, tier, reputation, simulation_depth, continental_qualification)
       VALUES (?, ?, ?, 1, 9, 'CONTEXT_ONLY', 1)`,
    ).run(leagueId, foreignFederation.id, foreignCountry.id);
    db.prepare(
      `INSERT INTO external_club_context (club_id, league_id, federation_id, country_id, reputation, financial_band, academy_strength, scouting_reach, recruitment_regions_json, simulation_depth)
       VALUES (?, ?, ?, ?, 9, 'HIGH', 9, 9, '[]', 'CONTEXT_ONLY')`,
    ).run(foreignClub.id, leagueId, foreignFederation.id, foreignCountry.id);

    for (const id of players) {
      world.insertPerson({ id, fullName: `Player ${id}`, nationalityCountryId: country.id, languages: ["en"] });
      world.insertPersonRole({ id: createStableEntityId("role", `${id}:player`), personId: id, role: "PLAYER", activeFrom: "2026-08-01" });
      world.insertTeamPersonAssignment({ id: createStableEntityId("assignment", `${id}:player`), personId: id, teamId: team.id, role: "PLAYER", startedOn: "2026-08-01" });
      new PlayerRepository(db).insertAttributes(attributesFor(id));
    }
    const transfers = new TransferMarketRepository(db);
    for (const id of players) {
      transfers.upsertPlayerContract({
        id: createStableEntityId("contract", `btp-${id}`), playerId: id, clubId: club.id,
        startDate: "2026-08-01", endDate: "2028-05-31", contractType: "PROFESSIONAL", salary: 150_000,
        appearanceFee: 0, goalBonus: 0, cleanSheetBonus: 0, signingBonus: 0, loyaltyBonus: 0, currency: "NPR",
        squadRole: "IMPORTANT_PLAYER", status: "ACTIVE", provenance: { sourceName: "test", confidence: 1, status: "SIMULATION_ONLY" },
      });
    }

    const character = createCareerCharacter({
      fullName: "BTP Test Manager", dateOfBirth: "1980-01-01", startingAge: 46, nationalityCountryId: country.id,
      languages: ["en"], footballBackground: "LOCAL_FOOTBALL", education: "UNIVERSITY",
      playingExperience: "PROFESSIONAL_PLAYER", coachingExperience: "SENIOR_COACH",
      coachingLicences: [testLicence("Testing A Licence", 3)], businessBackground: "NONE",
      startingReputationProfile: "FORMER_PLAYER", careerStartDate: "2026-08-01",
    });
    world.insertPerson(character.person);
    new ManagerRepository(db).insertProfile(character.managerProfile);
    managerProfileId = character.managerProfile.id;

    const dynamics = new SquadDynamicsRepository(db);
    for (const id of players) {
      dynamics.upsertRelationship({
        id: createStableEntityId("relationship", `${managerProfileId}:${id}`),
        managerProfileId, personId: id, score: 90, level: "STRONG", updatedOn: "2026-08-01",
      });
      dynamics.upsertConcern({
        id: createStableEntityId("concern", `${id}:transfer-interest`),
        personId: id, teamId: team.id, type: "TRANSFER_INTEREST", status: "ACTIVE",
        severity: 6, raisedOn: "2026-09-01", updatedOn: "2026-09-01",
      });
      const offer: TransferOffer = {
        id: createStableEntityId("transfer-offer", `${id}:offer`),
        buyingClubId: foreignClub.id, sellingClubId: club.id, playerId: id,
        offerType: "PERMANENT", transferFee: 1_500_000, installments: 0, addOns: 0, sellOnPercentage: 5,
        submittedAt: "2026-09-01", expiresAt: "2027-06-01", status: "NEGOTIATING", currency: "NPR",
        agentFee: 0, signingFee: 0,
      };
      transfers.insertTransferOffer(offer);
    }
  });

  it("PROMISE_TRANSFER_STANCE ('I will consider a suitable offer'/not sanction a move) is fulfilled when the player is never transfer-listed by the deadline", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const concern = dynamics.concern(stanceKeptPlayerId, team.id, "TRANSFER_INTEREST")!;
    const response = respondToConcern(db, saveAt("2026-09-01"), managerProfileId, concern.id, "PROMISE_TRANSFER_STANCE");
    expect(response.outcome).not.toBe("REJECTED");
    const promise = dynamics.promiseById(response.promiseId!)!;
    expect(promise.type).toBe("TRANSFER_STANCE");
    expect(promise.status).toBe("ACTIVE");
    expect(promise.dueOn).not.toBe(promise.madeOn);

    const before = dynamics.relationship(managerProfileId, stanceKeptPlayerId)?.score ?? 0;
    evaluateSquadDynamics(db, saveAt(promise.dueOn), team.id, club.id, managerProfileId);
    const resolved = dynamics.promiseById(promise.id)!;
    expect(resolved.status).toBe("FULFILLED");
    const resolvedConcern = dynamics.concernById(concern.id)!;
    expect(resolvedConcern.status).toBe("RESOLVED");
    const after = dynamics.relationship(managerProfileId, stanceKeptPlayerId)?.score ?? 0;
    expect(after).toBeGreaterThan(before);

    const history = dynamics.historyForPerson(stanceKeptPlayerId);
    expect(history.some((event) => event.eventType === "PROMISE_KEPT")).toBe(true);
  });

  it("breaking a TRANSFER_STANCE promise (the club transfer-lists the player before the deadline) escalates the concern again", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const concern = dynamics.concern(stanceBrokenPlayerId, team.id, "TRANSFER_INTEREST")!;
    const response = respondToConcern(db, saveAt("2026-09-01"), managerProfileId, concern.id, "PROMISE_TRANSFER_STANCE");
    const promise = dynamics.promiseById(response.promiseId!)!;

    // The club itself decides to transfer-list the player — breaking the
    // manager's own promise not to sanction a move.
    new TransferMarketRepository(db).upsertTransferStatus({
      id: createStableEntityId("player-transfer-status", stanceBrokenPlayerId),
      playerId: stanceBrokenPlayerId, clubId: club.id, status: "TRANSFER_LISTED",
      reason: "Club lists player", setBy: "CLUB", updatedAt: "2026-09-15",
    });

    const before = dynamics.relationship(managerProfileId, stanceBrokenPlayerId)?.score ?? 0;
    evaluateSquadDynamics(db, saveAt(promise.dueOn), team.id, club.id, managerProfileId);
    const resolved = dynamics.promiseById(promise.id)!;
    expect(resolved.status).toBe("BROKEN");
    const escalated = dynamics.concernById(concern.id)!;
    expect(escalated.status).toBe("ESCALATED");
    const after = dynamics.relationship(managerProfileId, stanceBrokenPlayerId)?.score ?? 0;
    expect(after).toBeLessThan(before);

    const history = dynamics.historyForPerson(stanceBrokenPlayerId);
    expect(history.some((event) => event.eventType === "PROMISE_BROKEN")).toBe(true);
  });

  it("PROMISE_LOAN_CONSIDERATION is fulfilled once a real active loan exists by the deadline", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const concern = dynamics.concern(loanKeptPlayerId, team.id, "TRANSFER_INTEREST")!;
    const response = respondToConcern(db, saveAt("2026-09-01"), managerProfileId, concern.id, "PROMISE_LOAN_CONSIDERATION");
    const promise = dynamics.promiseById(response.promiseId!)!;
    expect(promise.type).toBe("LOAN_CONSIDERATION");

    new TransferMarketRepository(db).upsertLoan({
      id: createStableEntityId("loan", `${loanKeptPlayerId}:loan`),
      parentClubId: club.id, loanClubId: foreignClub.id, playerId: loanKeptPlayerId,
      startDate: "2026-09-10", endDate: promise.dueOn, wageContributionPercent: 50,
      playingTimeExpectation: "FIRST_TEAM", recallAllowed: true, status: "ACTIVE",
    });

    evaluateSquadDynamics(db, saveAt(promise.dueOn), team.id, club.id, managerProfileId);
    const resolved = dynamics.promiseById(promise.id)!;
    expect(resolved.status).toBe("FULFILLED");
    const resolvedConcern = dynamics.concernById(concern.id)!;
    expect(resolvedConcern.status).toBe("RESOLVED");

    const history = dynamics.historyForPerson(loanKeptPlayerId);
    expect(history.some((event) => event.eventType === "PROMISE_KEPT")).toBe(true);
  });
});
