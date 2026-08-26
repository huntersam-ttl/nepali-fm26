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
import { createCareerCharacter, evaluateSquadDynamics, testLicence } from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type Club,
  type EntityId,
  type PlayerAttributeSet,
  type Team,
} from "@nepal-football-sim/shared-types";

const PLAYER_COUNT = 10;
// Descending boosts give a deterministic influence ranking: 0,1,2 -> core
// leaders (captain/vice/senior), 3-7 -> main group, 8-9 -> peripheral.
const BOOSTS = [9, 8, 7, 5, 4, 3, 2, 1, 0, 0];

const attributesFor = (personId: EntityId, boost: number): PlayerAttributeSet => ({
  id: createStableEntityId("attributes", personId),
  personId,
  primaryPosition: "CM",
  secondaryPositions: [],
  technical: {
    firstTouch: 10, passing: 10, crossing: 10, dribbling: 10, finishing: 10,
    heading: 10, tackling: 10, technique: 10, longShots: 10, setPieces: 10,
  },
  mental: {
    decisions: 10, vision: 10, composure: 10, positioning: 10, anticipation: 10,
    workRate: 10, teamwork: 10, leadership: 10 + boost, aggression: 10,
    determination: 10 + boost, professionalism: 10 + boost,
  },
  physical: {
    pace: 10, acceleration: 10, strength: 10, stamina: 10, agility: 10,
    balance: 10, jumping: 10, naturalFitness: 10,
  },
  goalkeeping: {
    handling: 1, reflexes: 1, oneOnOnes: 1, aerialReach: 1, kicking: 1,
    distribution: 1, commandOfArea: 1,
  },
});

describe("squad dynamics phase C: dressing-room groups and cohesion", () => {
  const savesDirectory = mkdtempSync(join(tmpdir(), "squad-dynamics-cohesion-"));
  const dbPath = join(savesDirectory, "career.sqlite");
  let db = openGameDatabase(dbPath);
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
  const club: Club = {
    id: createStableEntityId("club", "sdc-club"),
    name: "Cohesion FC",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const team: Team = {
    id: createStableEntityId("team", "sdc-club-senior"),
    clubId: club.id,
    name: "Cohesion FC",
    level: "senior",
    gender: "men",
  };
  const competitionId = createStableEntityId("competition", "sdc-league");
  const seasonId = createStableEntityId("season", "sdc-league-2026");
  const playerIds = Array.from({ length: PLAYER_COUNT }, (_, i) =>
    createStableEntityId("person", `sdc-player-${i}`),
  );
  let managerProfileId: EntityId;

  const saveAt = (worldDate: string) => ({
    id: createStableEntityId("save", "squad-dynamics-cohesion-test"),
    name: "Squad Dynamics Cohesion Test",
    worldDate,
    databaseVersion: 26,
    gameVersion: "test",
    randomSeed: "squad-dynamics-cohesion-test",
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
      id: createStableEntityId("membership", "sdc-club"),
      clubId: club.id,
      teamId: team.id,
      competitionId,
      competitionSeasonId: seasonId,
      membershipType: "LEAGUE_MEMBER",
      status: "ACTIVE",
    });

    playerIds.forEach((personId, index) => {
      world.insertPerson({
        id: personId,
        fullName: `Player ${index}`,
        nationalityCountryId: country.id,
        languages: ["ne"],
      });
      world.insertPersonRole({
        id: createStableEntityId("role", `${personId}:player`),
        personId,
        role: "PLAYER",
        activeFrom: "2026-08-01",
      });
      world.insertTeamPersonAssignment({
        id: createStableEntityId("assignment", `${personId}:player`),
        personId,
        teamId: team.id,
        role: "PLAYER",
        startedOn: "2026-08-01",
      });
      new PlayerRepository(db).insertAttributes(attributesFor(personId, BOOSTS[index]!));
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

  it("forms core-leader, main-group and peripheral clusters from real hierarchy standing", () => {
    evaluateSquadDynamics(db, saveAt("2026-10-01"), team.id, club.id, managerProfileId);
    const dynamics = new SquadDynamicsRepository(db);
    const groups = dynamics.groupsForTeam(team.id);
    expect(groups).toHaveLength(PLAYER_COUNT);

    const groupOf = (index: number) => groups.find((g) => g.personId === playerIds[index])?.groupType;
    expect(groupOf(0)).toBe("CORE_LEADERS");
    expect(groupOf(1)).toBe("CORE_LEADERS");
    expect(groupOf(2)).toBe("CORE_LEADERS");
    expect(groupOf(5)).toBe("MAIN_GROUP");
    expect(groupOf(9)).toBe("PERIPHERAL");

    const hierarchy = dynamics.hierarchyForTeam(team.id);
    expect(hierarchy.find((h) => h.role === "CAPTAIN")?.personId).toBe(playerIds[0]);
    expect(hierarchy.find((h) => h.role === "VICE_CAPTAIN")?.personId).toBe(playerIds[1]);
  });

  it("a trusted, concern-free captain stabilizes the whole dressing room", () => {
    const dynamics = new SquadDynamicsRepository(db);
    dynamics.upsertRelationship({
      id: createStableEntityId("relationship", `${managerProfileId}:${playerIds[0]}`),
      managerProfileId,
      personId: playerIds[0]!,
      score: 60,
      level: "STRONG",
      updatedOn: "2026-10-01",
    });

    const before =
      new PlayerRepository(db).availabilityStates(team.id).find((s) => s.personId === playerIds[5])
        ?.moraleModifier ?? 0;
    evaluateSquadDynamics(db, saveAt("2026-10-02"), team.id, club.id, managerProfileId);

    const cohesion = dynamics.cohesion(team.id)!;
    expect(cohesion.captainInfluence).toBe("STABILIZING");

    const bystander = new PlayerRepository(db)
      .availabilityStates(team.id)
      .find((state) => state.personId === playerIds[5]);
    expect(bystander?.moraleModifier ?? 0).toBeGreaterThan(before);
  });

  it("two players escalating the same concern together spark a dispute, and a core leader's escalation spills onto the squad", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const transfers = new TransferMarketRepository(db);
    const stats = new CompetitionRepository(db);

    // A core leader (index 2) and a main-group player (index 3) are both
    // barely playing despite being nominally key players.
    for (const index of [2, 3]) {
      transfers.upsertPlayerContract({
        id: createStableEntityId("contract", `sdc-player-${index}`),
        playerId: playerIds[index]!,
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
      stats.upsertPlayerSeasonStat({
        competitionSeasonId: seasonId,
        personId: playerIds[index]!,
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
    }

    // Day 0: both concerns raise.
    evaluateSquadDynamics(db, saveAt("2026-10-05"), team.id, club.id, managerProfileId);
    expect(dynamics.concern(playerIds[2]!, team.id, "PLAYING_TIME")?.status).toBe("RAISED");
    expect(dynamics.concern(playerIds[3]!, team.id, "PLAYING_TIME")?.status).toBe("RAISED");

    const bystanderBefore =
      new PlayerRepository(db).availabilityStates(team.id).find((s) => s.personId === playerIds[7])
        ?.moraleModifier ?? 0;

    // Day 31+: both escalate together in the same tick.
    evaluateSquadDynamics(db, saveAt("2026-11-06"), team.id, club.id, managerProfileId);
    expect(dynamics.concern(playerIds[2]!, team.id, "PLAYING_TIME")?.status).toBe("ESCALATED");
    expect(dynamics.concern(playerIds[3]!, team.id, "PLAYING_TIME")?.status).toBe("ESCALATED");

    const history2 = dynamics.historyForPerson(playerIds[2]!);
    expect(history2.some((event) => event.eventType === "DISPUTE_FLARED")).toBe(true);

    const cohesion = dynamics.cohesion(team.id)!;
    expect(cohesion.topIssue).toBeDefined();

    // The core leader's escalation should have unsettled an uninvolved player.
    const bystanderAfter = new PlayerRepository(db)
      .availabilityStates(team.id)
      .find((s) => s.personId === playerIds[7])?.moraleModifier;
    expect(bystanderAfter ?? 0).toBeLessThan(bystanderBefore);

    const spilloverLogged = dynamics
      .historyForPerson(playerIds[2]!)
      .some((event) => event.eventType === "SPILLOVER_APPLIED");
    expect(spilloverLogged).toBe(true);
  });

  it("persists group membership and cohesion across a save/load cycle", () => {
    db.close();
    db = openGameDatabase(dbPath);

    const dynamics = new SquadDynamicsRepository(db);
    expect(dynamics.groupsForTeam(team.id)).toHaveLength(PLAYER_COUNT);
    const cohesion = dynamics.cohesion(team.id);
    expect(cohesion).toBeDefined();
    expect(cohesion?.updatedOn).toBe("2026-11-06");
  });
});
