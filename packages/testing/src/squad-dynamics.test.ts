import { mkdtempSync } from "node:fs";
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
  activeConcernCount,
  appointCaptaincy,
  CaptaincyActionError,
  createCareerCharacter,
  evaluateSquadDynamics,
  testLicence,
} from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type Club,
  type EntityId,
  type PlayerAttributeSet,
  type Team,
} from "@nepal-football-sim/shared-types";

const attributesFor = (personId: EntityId, mentalBoost: number): PlayerAttributeSet => ({
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
    leadership: 10 + mentalBoost,
    aggression: 10,
    determination: 10 + mentalBoost,
    professionalism: 10 + mentalBoost,
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

describe("squad dynamics: hierarchy, relationships, concerns and morale", () => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
  const club: Club = {
    id: createStableEntityId("club", "sd-club"),
    name: "Squad Dynamics FC",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const team: Team = {
    id: createStableEntityId("team", "sd-club-senior"),
    clubId: club.id,
    name: "Squad Dynamics FC",
    level: "senior",
    gender: "men",
  };
  const competitionId = createStableEntityId("competition", "sd-league");
  const seasonId = createStableEntityId("season", "sd-league-2026");

  const keyPlayerId = createStableEntityId("person", "sd-key-player");
  const backupId = createStableEntityId("person", "sd-backup");
  const captainCandidateId = createStableEntityId("person", "sd-captain");

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
      id: createStableEntityId("membership", "sd-club"),
      clubId: club.id,
      teamId: team.id,
      competitionId,
      competitionSeasonId: seasonId,
      membershipType: "LEAGUE_MEMBER",
      status: "ACTIVE",
    });

    for (const [id, boost] of [
      [captainCandidateId, 6],
      [keyPlayerId, 2],
      [backupId, 0],
    ] as const) {
      world.insertPerson({ id, fullName: `Player ${id}`, nationalityCountryId: country.id, languages: ["ne"] });
      world.insertPersonRole({
        id: createStableEntityId("role", `${id}:player`),
        personId: id,
        role: "PLAYER",
        activeFrom: "2026-08-01",
      });
      world.insertTeamPersonAssignment({
        id: createStableEntityId("assignment", `${id}:player`),
        personId: id,
        teamId: team.id,
        role: "PLAYER",
        startedOn: "2026-08-01",
      });
      new PlayerRepository(db).insertAttributes(attributesFor(id, boost));
    }

    const transfers = new TransferMarketRepository(db);
    transfers.upsertPlayerContract({
      id: createStableEntityId("contract", "key-player"),
      playerId: keyPlayerId,
      clubId: club.id,
      startDate: "2026-08-01",
      endDate: "2027-02-01", // inside the 6-month contract-concern window as of 2026-10-15
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
    transfers.upsertPlayerContract({
      id: createStableEntityId("contract", "backup"),
      playerId: backupId,
      clubId: club.id,
      startDate: "2026-08-01",
      endDate: "2028-05-31",
      contractType: "PROFESSIONAL",
      salary: 20_000,
      appearanceFee: 0,
      goalBonus: 0,
      cleanSheetBonus: 0,
      signingBonus: 0,
      loyaltyBonus: 0,
      currency: "NPR",
      squadRole: "BACKUP",
      status: "ACTIVE",
      provenance: { sourceName: "test", confidence: 1, status: "SIMULATION_ONLY" },
    });

    // Key player has started almost none of the team's games.
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
  });

  const saveAt = (worldDate: string) => ({
    id: createStableEntityId("save", "squad-dynamics-test"),
    name: "Squad Dynamics Test",
    worldDate,
    databaseVersion: 23,
    gameVersion: "test",
    randomSeed: "squad-dynamics-test",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSavedAt: "2026-01-01T00:00:00.000Z",
  });

  it("ranks the highest-leadership player as captain", () => {
    evaluateSquadDynamics(db, saveAt("2026-10-15"), team.id, club.id, managerProfileId);
    const hierarchy = new SquadDynamicsRepository(db).hierarchyForTeam(team.id);
    const captain = hierarchy.find((entry) => entry.role === "CAPTAIN");
    expect(captain?.personId).toBe(captainCandidateId);
  });


  it("raises playing-time and contract concerns from real state, and hits the manager's inbox count", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const playingTime = dynamics.concern(keyPlayerId, team.id, "PLAYING_TIME");
    expect(playingTime?.status).toBe("RAISED");
    const contract = dynamics.concern(keyPlayerId, team.id, "CONTRACT");
    expect(contract?.status).toBe("RAISED");

    expect(activeConcernCount(db, team.id)).toBeGreaterThanOrEqual(2);

    const backupConcerns = dynamics.concernsForPerson(backupId, team.id);
    expect(backupConcerns.every((concern) => concern.status !== "RAISED")).toBe(true);
  });

  it("worsens the manager relationship and applies a morale penalty for the concerned player", () => {
    const relationship = new SquadDynamicsRepository(db).relationship(managerProfileId, keyPlayerId);
    expect(relationship?.score).toBeLessThan(0);

    const state = new PlayerRepository(db)
      .availabilityStates(team.id)
      .find((entry) => entry.personId === keyPlayerId);
    expect(state?.moraleModifier).toBeLessThan(0);
  });

  it("logs a history event for the raised concern", () => {
    const history = new SquadDynamicsRepository(db).historyForPerson(keyPlayerId);
    expect(history.some((event) => event.eventType === "CONCERN_RAISED")).toBe(true);
  });

  it("resolves the playing-time concern once appearances recover, and improves the relationship", () => {
    new CompetitionRepository(db).upsertPlayerSeasonStat({
      competitionSeasonId: seasonId,
      personId: keyPlayerId,
      teamId: team.id,
      appearances: 8,
      starts: 8,
      minutes: 720,
      goals: 2,
      assists: 1,
      yellowCards: 0,
      redCards: 0,
      averageRating: 7.1,
      cleanSheets: 0,
    });
    // Renew the contract so the contract concern also clears.
    new TransferMarketRepository(db).upsertPlayerContract({
      id: createStableEntityId("contract", "key-player"),
      playerId: keyPlayerId,
      clubId: club.id,
      startDate: "2026-08-01",
      endDate: "2029-05-31",
      contractType: "PROFESSIONAL",
      salary: 120_000,
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

    const before = new SquadDynamicsRepository(db).relationship(managerProfileId, keyPlayerId)?.score ?? 0;
    evaluateSquadDynamics(db, saveAt("2026-10-20"), team.id, club.id, managerProfileId);

    const dynamics = new SquadDynamicsRepository(db);
    expect(dynamics.concern(keyPlayerId, team.id, "PLAYING_TIME")?.status).toBe("RESOLVED");
    expect(dynamics.concern(keyPlayerId, team.id, "CONTRACT")?.status).toBe("RESOLVED");
    const after = dynamics.relationship(managerProfileId, keyPlayerId)?.score ?? 0;
    expect(after).toBeGreaterThan(before);

    const history = dynamics.historyForPerson(keyPlayerId);
    expect(history.some((event) => event.eventType === "CONCERN_RESOLVED")).toBe(true);
  });

  it("escalates a concern that stays unresolved past the grace window", () => {
    new TransferMarketRepository(db).upsertTransferStatus({
      id: createStableEntityId("transfer-status", "backup"),
      playerId: backupId,
      clubId: club.id,
      status: "INTERESTED_IN_MOVE",
      reason: "Wants regular football",
      setBy: "PLAYER",
      updatedAt: "2026-10-20",
    });

    evaluateSquadDynamics(db, saveAt("2026-10-20"), team.id, club.id, managerProfileId);
    const dynamics = new SquadDynamicsRepository(db);
    expect(dynamics.concern(backupId, team.id, "TRANSFER_INTEREST")?.status).toBe("RAISED");

    evaluateSquadDynamics(db, saveAt("2026-12-05"), team.id, club.id, managerProfileId); // > 30 days later
    expect(dynamics.concern(backupId, team.id, "TRANSFER_INTEREST")?.status).toBe("ESCALATED");

    const history = dynamics.historyForPerson(backupId);
    expect(history.some((event) => event.eventType === "CONCERN_ESCALATED")).toBe(true);
  });

  it("never leaves a raw SCREAMING_SNAKE_CASE enum value in a concern's user-facing note", () => {
    evaluateSquadDynamics(db, saveAt("2026-10-20"), team.id, club.id, managerProfileId);
    const concerns = new SquadDynamicsRepository(db).concernsForTeam(team.id);
    expect(concerns.length).toBeGreaterThan(0);
    for (const concern of concerns) {
      expect(concern.note).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
    }
  });
  describe("manual captaincy appointment", () => {
    // These tests share one connection's persisted override sequentially
    // (matching this file's existing fixture style), so each appointment
    // explicitly sets both slots rather than relying on omission — that
    // keeps every test's starting state unambiguous regardless of order.
    it("lets the manager captain a player other than the highest-influence one, and it survives recomputation", () => {
      const worldDate = "2026-10-16";
      const entries = appointCaptaincy(db, worldDate, managerProfileId, team.id, {
        captainPersonId: keyPlayerId,
        viceCaptainPersonId: null,
      });
      expect(entries.find((entry) => entry.role === "CAPTAIN")?.personId).toBe(keyPlayerId);
      // The previously auto-selected captain is demoted, not deleted.
      expect(
        entries.find((entry) => entry.personId === captainCandidateId)?.role,
      ).not.toBe("CAPTAIN");

      // A later, independent recompute (e.g. the next matchday tick) must
      // keep honouring the override rather than reverting to raw influence.
      evaluateSquadDynamics(db, saveAt("2026-10-20"), team.id, club.id, managerProfileId);
      const hierarchy = new SquadDynamicsRepository(db).hierarchyForTeam(team.id);
      expect(hierarchy.find((entry) => entry.role === "CAPTAIN")?.personId).toBe(keyPlayerId);
    });

    it("also supports appointing a vice-captain independently of the captain", () => {
      appointCaptaincy(db, "2026-10-17", managerProfileId, team.id, {
        captainPersonId: captainCandidateId,
        viceCaptainPersonId: keyPlayerId,
      });
      const hierarchy = new SquadDynamicsRepository(db).hierarchyForTeam(team.id);
      expect(hierarchy.find((entry) => entry.role === "CAPTAIN")?.personId).toBe(captainCandidateId);
      expect(hierarchy.find((entry) => entry.role === "VICE_CAPTAIN")?.personId).toBe(keyPlayerId);
    });

    it("clearing an override with null returns that role to influence-derived selection", () => {
      appointCaptaincy(db, "2026-10-18", managerProfileId, team.id, {
        captainPersonId: keyPlayerId,
        viceCaptainPersonId: null,
      });
      appointCaptaincy(db, "2026-10-19", managerProfileId, team.id, { captainPersonId: null });
      const hierarchy = new SquadDynamicsRepository(db).hierarchyForTeam(team.id);
      expect(hierarchy.find((entry) => entry.role === "CAPTAIN")?.personId).toBe(captainCandidateId);
    });

    it("rejects a player who is not part of this squad, and captain/vice-captain being the same person", () => {
      const outsiderId = createStableEntityId("person", "sd-outsider");
      expect(() =>
        appointCaptaincy(db, "2026-10-16", managerProfileId, team.id, {
          captainPersonId: outsiderId,
        }),
      ).toThrow(CaptaincyActionError);
      expect(() =>
        appointCaptaincy(db, "2026-10-16", managerProfileId, team.id, {
          captainPersonId: keyPlayerId,
          viceCaptainPersonId: keyPlayerId,
        }),
      ).toThrow(CaptaincyActionError);
      // The merged-state check also fires when only one slot is passed but
      // would collide with the OTHER slot's already-persisted value.
      appointCaptaincy(db, "2026-10-16", managerProfileId, team.id, {
        captainPersonId: captainCandidateId,
        viceCaptainPersonId: keyPlayerId,
      });
      expect(() =>
        appointCaptaincy(db, "2026-10-16", managerProfileId, team.id, {
          captainPersonId: keyPlayerId,
        }),
      ).toThrow(CaptaincyActionError);
    });

    it("persists as exactly one real row, not a re-rolled or duplicated override", () => {
      appointCaptaincy(db, "2026-10-21", managerProfileId, team.id, {
        captainPersonId: keyPlayerId,
        viceCaptainPersonId: backupId,
      });
      // A second, independent repository instance against the same
      // connection reads the identical persisted row — proving this is
      // real database state, not an in-memory field on the first instance.
      const before = new SquadDynamicsRepository(db).captaincyOverride(team.id);
      const after = new SquadDynamicsRepository(db).captaincyOverride(team.id);
      expect(after).toEqual(before);
      const rowCount = (
        db
          .prepare("SELECT COUNT(*) AS c FROM squad_captaincy_overrides WHERE team_id = ?")
          .get(team.id) as { c: number }
      ).c;
      expect(rowCount).toBe(1);

      // Appointing again (e.g. a later matchday) must update the same row,
      // never insert a second one for this team.
      appointCaptaincy(db, "2026-10-22", managerProfileId, team.id, {
        captainPersonId: backupId,
        viceCaptainPersonId: null,
      });
      const rowCountAfterSecondAppointment = (
        db
          .prepare("SELECT COUNT(*) AS c FROM squad_captaincy_overrides WHERE team_id = ?")
          .get(team.id) as { c: number }
      ).c;
      expect(rowCountAfterSecondAppointment).toBe(1);
    });
  });
});

/**
 * A genuine, un-forced former-captain reaction — real influence-based
 * hierarchy recomputation, not a manually-inserted terminal state. A
 * high-influence captain is demoted to a genuinely low hierarchy tier
 * (real attribute-derived FRINGE_PLAYER rank, not a fabricated one) by
 * appointing a different, even-higher-influence captain — reactToCaptaincyLoss
 * fires only from that real recomputation.
 */
describe("captaincy: a genuine former-captain reaction, real threshold", () => {
  const dir = mkdtempSync(join(tmpdir(), "captaincy-reaction-"));
  const dbPath = join(dir, "career.sqlite");
  let db = openGameDatabase(dbPath);
  migrateDatabase(db);

  const mentalAttributesFor = (
    personId: EntityId,
    leadership: number,
    professionalism: number,
    determination: number,
  ): PlayerAttributeSet => ({
    id: createStableEntityId("attributes", personId),
    personId,
    primaryPosition: "CM",
    secondaryPositions: [],
    technical: { firstTouch: 10, passing: 10, crossing: 10, dribbling: 10, finishing: 10, heading: 10, tackling: 10, technique: 10, longShots: 10, setPieces: 10 },
    mental: { decisions: 10, vision: 10, composure: 10, positioning: 10, anticipation: 10, workRate: 10, teamwork: 10, leadership, aggression: 10, determination, professionalism },
    physical: { pace: 10, acceleration: 10, strength: 10, stamina: 10, agility: 10, balance: 10, jumping: 10, naturalFitness: 10 },
    goalkeeping: { handling: 1, reflexes: 1, oneOnOnes: 1, aerialReach: 1, kicking: 1, distribution: 1, commandOfArea: 1 },
  });

  const country = { id: createStableEntityId("country", "cap-real"), name: "Cap Real Country", isoCode: "CR" };
  const club: Club = { id: createStableEntityId("club", "cap-real"), name: "Cap Real FC", countryId: country.id, ownershipType: "PRIVATE" };
  const team: Team = { id: createStableEntityId("team", "cap-real-senior"), clubId: club.id, name: "Cap Real FC", level: "senior", gender: "men" };

  // A: the eventual demoted former captain — high influence (76, clears the
  // >=75 threshold for a demand too), but ranks below 6 even-higher-influence
  // teammates once no longer reserved as captain.
  const playerAId = createStableEntityId("person", "cap-real-a");
  // B..G: deliberately higher influence than A, so A ranks into the bottom
  // quartile (FRINGE_PLAYER) of an 8-player squad once demoted.
  const highInfluenceIds = ["b", "c", "d", "e", "f", "g"].map((letter) =>
    createStableEntityId("person", `cap-real-${letter}`),
  );
  const playerHId = createStableEntityId("person", "cap-real-h");
  const allPlayerIds = [playerAId, ...highInfluenceIds, playerHId];

  let managerProfileId: EntityId;
  const saveAt = (worldDate: string) => ({
    id: createStableEntityId("save", "cap-real-test"), name: "Cap Real Test", worldDate, databaseVersion: 97,
    gameVersion: "test", randomSeed: "cap-real-test", createdAt: "2026-01-01T00:00:00.000Z", lastSavedAt: "2026-01-01T00:00:00.000Z",
  });

  beforeAll(() => {
    const world = new WorldRepository(db);
    world.insertCountry(country);
    world.insertClub(club);
    world.insertTeam(team);
    for (const id of allPlayerIds) {
      world.insertPerson({ id, fullName: `Player ${id}`, nationalityCountryId: country.id, languages: ["en"] });
      world.insertPersonRole({ id: createStableEntityId("role", `${id}:player`), personId: id, role: "PLAYER", activeFrom: "2026-08-01" });
      world.insertTeamPersonAssignment({ id: createStableEntityId("assignment", `${id}:player`), personId: id, teamId: team.id, role: "PLAYER", startedOn: "2026-08-01" });
    }
    const players = new PlayerRepository(db);
    players.insertAttributes(mentalAttributesFor(playerAId, 15, 16, 15)); // influence ≈ 76
    for (const id of highInfluenceIds) players.insertAttributes(mentalAttributesFor(id, 20, 20, 20)); // influence = 100
    players.insertAttributes(mentalAttributesFor(playerHId, 1, 1, 1)); // influence ≈ 6

    const character = createCareerCharacter({
      fullName: "Cap Real Manager", dateOfBirth: "1980-01-01", startingAge: 46, nationalityCountryId: country.id,
      languages: ["en"], footballBackground: "LOCAL_FOOTBALL", education: "UNIVERSITY",
      playingExperience: "PROFESSIONAL_PLAYER", coachingExperience: "SENIOR_COACH",
      coachingLicences: [testLicence("Testing A Licence", 3)], businessBackground: "NONE",
      startingReputationProfile: "FORMER_PLAYER", careerStartDate: "2026-08-01",
    });
    world.insertPerson(character.person);
    new ManagerRepository(db).insertProfile(character.managerProfile);
    managerProfileId = character.managerProfile.id;
  });

  it("appointing A captain despite lower raw influence, then demoting A for a higher-influence player, triggers a real reaction + demand", () => {
    appointCaptaincy(db, "2026-09-01", managerProfileId, team.id, { captainPersonId: playerAId, viceCaptainPersonId: null });
    const afterFirst = new SquadDynamicsRepository(db).hierarchyForTeam(team.id);
    expect(afterFirst.find((entry) => entry.personId === playerAId)?.role).toBe("CAPTAIN");

    // Demote A by appointing a genuinely higher-influence teammate captain —
    // A's own real rank (once no longer reserved) determines their new role,
    // never a directly-assigned demotion.
    appointCaptaincy(db, "2026-09-02", managerProfileId, team.id, {
      captainPersonId: highInfluenceIds[0]!,
      viceCaptainPersonId: null,
    });
    const dynamics = new SquadDynamicsRepository(db);
    const hierarchy = dynamics.hierarchyForTeam(team.id);
    const demotedEntry = hierarchy.find((entry) => entry.personId === playerAId);
    expect(demotedEntry?.role).toBe("FRINGE_PLAYER");
    expect(demotedEntry!.influence).toBeGreaterThanOrEqual(75);

    // The reaction is a real, un-forced consequence of that recomputation.
    const history = dynamics.historyForPerson(playerAId);
    expect(history.some((event) => event.eventType === "CAPTAINCY_REACTION")).toBe(true);

    const demand = dynamics.demand(playerAId, team.id, "CAPTAINCY_CONCERN");
    expect(demand?.status).toBe("OPEN");
    expect(demand?.trigger).toBe("Lost the captaincy despite a strong standing in the squad.");

    const relationship = dynamics.relationship(managerProfileId, playerAId);
    expect(relationship!.score).toBeLessThan(0);

    // A real historical_events row exists for the reaction, with the
    // demoted player and their club as clickable involved entities (a real
    // Story Universe entry, exact-once — deterministic id, so a second
    // recompute below cannot duplicate it).
    const historicalEvent = db
      .prepare("SELECT * FROM historical_events WHERE event_type = 'CAPTAINCY_REACTION'")
      .get() as { involved_entities_json: string } | undefined;
    expect(historicalEvent).toBeDefined();
    const involvedIds = JSON.parse(historicalEvent!.involved_entities_json).map((entity: { id: string }) => entity.id);
    expect(involvedIds).toContain(playerAId);
    expect(involvedIds).toContain(club.id);

    // buildStoryActions gives the Manager a real "Open meeting" action for
    // this now-formal demand, reachable from the Story Universe.
    // (Story routing/action-building itself is exercised end-to-end in
    // story-actions.test.ts; this proves the real state it depends on exists.)
    expect(dynamics.demandById(demand!.id)?.status).toBe("OPEN");
  });

  it("never duplicates the reaction/demand on a later, unrelated recompute (evaluateSquadDynamics)", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const before = dynamics.historyForPerson(playerAId).filter((event) => event.eventType === "CAPTAINCY_REACTION").length;
    evaluateSquadDynamics(db, saveAt("2026-09-05"), team.id, club.id, managerProfileId);
    const after = dynamics.historyForPerson(playerAId).filter((event) => event.eventType === "CAPTAINCY_REACTION").length;
    expect(after).toBe(before);
    expect(dynamics.demand(playerAId, team.id, "CAPTAINCY_CONCERN")?.status).toBe("OPEN");
  });

  it("persists identically across a real file reload — same override, same hierarchy, same reaction, same demand, same relationship", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const beforeOverride = dynamics.captaincyOverride(team.id);
    const beforeHierarchy = dynamics.hierarchyForTeam(team.id).find((entry) => entry.personId === playerAId);
    const beforeDemand = dynamics.demand(playerAId, team.id, "CAPTAINCY_CONCERN");
    const beforeReactionCount = dynamics
      .historyForPerson(playerAId)
      .filter((event) => event.eventType === "CAPTAINCY_REACTION").length;
    const beforeRelationship = dynamics.relationship(managerProfileId, playerAId);

    db.close();
    db = openGameDatabase(dbPath);
    const reloaded = new SquadDynamicsRepository(db);

    expect(reloaded.captaincyOverride(team.id)).toEqual(beforeOverride);
    const afterHierarchy = reloaded.hierarchyForTeam(team.id).find((entry) => entry.personId === playerAId);
    expect(afterHierarchy?.role).toBe(beforeHierarchy?.role);
    expect(afterHierarchy?.influence).toBe(beforeHierarchy?.influence);
    const afterDemand = reloaded.demand(playerAId, team.id, "CAPTAINCY_CONCERN");
    expect(afterDemand?.id).toBe(beforeDemand?.id);
    expect(afterDemand?.status).toBe(beforeDemand?.status);
    const afterReactionCount = reloaded
      .historyForPerson(playerAId)
      .filter((event) => event.eventType === "CAPTAINCY_REACTION").length;
    expect(afterReactionCount).toBe(beforeReactionCount);
    expect(reloaded.relationship(managerProfileId, playerAId)?.score).toBe(beforeRelationship?.score);
  });
});
