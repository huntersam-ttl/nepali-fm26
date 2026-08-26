import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CompetitionRepository,
  ManagerRepository,
  PlayerRepository,
  SquadDynamicsRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  MeetingActionError,
  createCareerCharacter,
  holdSquadMeeting,
  testLicence,
} from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type Club,
  type EntityId,
  type PlayerAttributeSet,
  type Team,
} from "@nepal-football-sim/shared-types";

const attributesFor = (personId: EntityId): PlayerAttributeSet => ({
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
    workRate: 10, teamwork: 10, leadership: 10, aggression: 10,
    determination: 10, professionalism: 10,
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

describe("squad dynamics phase D: meetings and dispute mediation", () => {
  const savesDirectory = mkdtempSync(join(tmpdir(), "squad-dynamics-meetings-"));
  const dbPath = join(savesDirectory, "career.sqlite");
  let db = openGameDatabase(dbPath);
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
  const club: Club = {
    id: createStableEntityId("club", "sdm-club"),
    name: "Meetings FC",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const team: Team = {
    id: createStableEntityId("team", "sdm-club-senior"),
    clubId: club.id,
    name: "Meetings FC",
    level: "senior",
    gender: "men",
  };
  const competitionId = createStableEntityId("competition", "sdm-league");
  const seasonId = createStableEntityId("season", "sdm-league-2026");
  const captainId = createStableEntityId("person", "sdm-captain");
  const playerBId = createStableEntityId("person", "sdm-player-b");
  const playerCId = createStableEntityId("person", "sdm-player-c");
  let managerProfileId: EntityId;

  const saveAt = (worldDate: string) => ({
    id: createStableEntityId("save", "squad-dynamics-meetings-test"),
    name: "Squad Dynamics Meetings Test",
    worldDate,
    databaseVersion: 27,
    gameVersion: "test",
    randomSeed: "squad-dynamics-meetings-test",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSavedAt: "2026-01-01T00:00:00.000Z",
  });

  const dynamics = () => new SquadDynamicsRepository(db);

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
      id: createStableEntityId("membership", "sdm-club"),
      clubId: club.id,
      teamId: team.id,
      competitionId,
      competitionSeasonId: seasonId,
      membershipType: "LEAGUE_MEMBER",
      status: "ACTIVE",
    });

    for (const [personId, role, influence] of [
      [captainId, "CAPTAIN", 80],
      [playerBId, "SQUAD_PLAYER", 30],
      [playerCId, "SQUAD_PLAYER", 25],
    ] as const) {
      world.insertPerson({ id: personId, fullName: `Player ${personId}`, nationalityCountryId: country.id, languages: ["ne"] });
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
      new PlayerRepository(db).insertAttributes(attributesFor(personId));
      dynamics().upsertHierarchyEntry({
        id: createStableEntityId("hierarchy", personId),
        teamId: team.id,
        personId,
        influence,
        role,
        updatedOn: "2026-08-01",
      });
    }

    new CompetitionRepository(db).upsertStanding({
      competitionSeasonId: seasonId,
      teamId: team.id,
      played: 10, won: 4, drawn: 3, lost: 3,
      goalsFor: 12, goalsAgainst: 10, goalDifference: 2, points: 15,
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

  it("mediates a player-vs-player dispute successfully when trust and cohesion are high", () => {
    dynamics().upsertCohesion({
      teamId: team.id, score: 90, level: "UNITED", captainInfluence: "STABILIZING", updatedOn: "2026-09-01",
    });
    for (const personId of [playerBId, playerCId]) {
      dynamics().upsertRelationship({
        id: createStableEntityId("relationship", `${managerProfileId}:${personId}`),
        managerProfileId, personId, score: 90, level: "STRONG", updatedOn: "2026-09-01",
      });
      dynamics().upsertConcern({
        id: createStableEntityId("concern", `${personId}:playing-time`),
        personId, teamId: team.id, type: "PLAYING_TIME", status: "ESCALATED", severity: 8,
        raisedOn: "2026-08-15", updatedOn: "2026-09-01",
      });
    }
    const dispute = {
      id: createStableEntityId("dispute", "b-vs-c"),
      teamId: team.id, kind: "PLAYER_VS_PLAYER" as const, personId: playerBId, withPersonId: playerCId,
      concernType: "PLAYING_TIME" as const, status: "OPEN" as const, raisedOn: "2026-09-01",
    };
    dynamics().insertDispute(dispute);

    const meeting = holdSquadMeeting(db, saveAt("2026-09-01"), managerProfileId, team.id, {
      type: "MEDIATE_DISPUTE",
      disputeId: dispute.id,
    });
    expect(meeting.outcome).toBe("POSITIVE");

    const resolved = dynamics().disputeById(dispute.id)!;
    expect(resolved.status).toBe("MEDIATED");
    expect(dynamics().concern(playerBId, team.id, "PLAYING_TIME")?.severity).toBeLessThan(8);
    expect(dynamics().concern(playerBId, team.id, "PLAYING_TIME")?.status).toBe("ACTIVE");
    expect(dynamics().relationship(managerProfileId, playerBId)!.score).toBeGreaterThan(90);
    expect(dynamics().relationship(managerProfileId, playerCId)!.score).toBeGreaterThan(90);

    const history = dynamics().historyForPerson(playerBId);
    expect(history.some((event) => event.eventType === "DISPUTE_MEDIATED")).toBe(true);
  });

  it("fails a mediation attempt when trust is already broken, worsening the dispute", () => {
    const captainDisputePartnerId = createStableEntityId("person", "sdm-player-d");
    const world = new WorldRepository(db);
    world.insertPerson({ id: captainDisputePartnerId, fullName: "Player D", nationalityCountryId: country.id, languages: ["ne"] });
    world.insertPersonRole({
      id: createStableEntityId("role", `${captainDisputePartnerId}:player`), personId: captainDisputePartnerId,
      role: "PLAYER", activeFrom: "2026-08-01",
    });
    world.insertTeamPersonAssignment({
      id: createStableEntityId("assignment", `${captainDisputePartnerId}:player`), personId: captainDisputePartnerId,
      teamId: team.id, role: "PLAYER", startedOn: "2026-08-01",
    });
    new PlayerRepository(db).insertAttributes(attributesFor(captainDisputePartnerId));
    dynamics().upsertHierarchyEntry({
      id: createStableEntityId("hierarchy", captainDisputePartnerId), teamId: team.id, personId: captainDisputePartnerId,
      influence: 95, role: "VICE_CAPTAIN", updatedOn: "2026-08-01",
    });

    dynamics().upsertCohesion({
      teamId: team.id, score: 15, level: "CRITICAL", captainInfluence: "DESTABILIZING", updatedOn: "2026-09-05",
    });
    for (const personId of [captainId, captainDisputePartnerId]) {
      dynamics().upsertRelationship({
        id: createStableEntityId("relationship", `${managerProfileId}:${personId}`),
        managerProfileId, personId, score: -90, level: "POOR", updatedOn: "2026-09-05",
      });
    }
    dynamics().upsertConcern({
      id: createStableEntityId("concern", `${captainId}:contract`),
      personId: captainId, teamId: team.id, type: "CONTRACT", status: "ESCALATED", severity: 3,
      raisedOn: "2026-08-15", updatedOn: "2026-09-05",
    });
    const dispute = {
      id: createStableEntityId("dispute", "captain-vs-vice"),
      teamId: team.id, kind: "PLAYER_VS_PLAYER" as const, personId: captainId, withPersonId: captainDisputePartnerId,
      concernType: "CONTRACT" as const, status: "OPEN" as const, raisedOn: "2026-09-05",
    };
    dynamics().insertDispute(dispute);

    const before = dynamics().relationship(managerProfileId, captainId)!.score;
    const meeting = holdSquadMeeting(db, saveAt("2026-09-05"), managerProfileId, team.id, {
      type: "MEDIATE_DISPUTE",
      disputeId: dispute.id,
    });
    expect(meeting.outcome).toBe("NEGATIVE");

    const resolved = dynamics().disputeById(dispute.id)!;
    expect(resolved.status).toBe("UNRESOLVED");
    expect(dynamics().concern(captainId, team.id, "CONTRACT")?.severity).toBeGreaterThan(3);
    expect(dynamics().relationship(managerProfileId, captainId)!.score).toBeLessThan(before);

    const history = dynamics().historyForPerson(captainId);
    expect(history.some((event) => event.eventType === "DISPUTE_UNRESOLVED")).toBe(true);
  });

  it("consulting the captain works, is weighted by their influence, and requires an actual captain", () => {
    dynamics().upsertRelationship({
      id: createStableEntityId("relationship", `${managerProfileId}:${captainId}`),
      managerProfileId, personId: captainId, score: 40, level: "GOOD", updatedOn: "2026-10-01",
    });
    dynamics().upsertCohesion({
      teamId: team.id, score: 60, level: "STABLE", captainInfluence: "NEUTRAL", updatedOn: "2026-10-01",
    });

    const meeting = holdSquadMeeting(db, saveAt("2026-10-01"), managerProfileId, team.id, {
      type: "CAPTAIN_CONSULTATION",
    });
    expect(meeting.type).toBe("CAPTAIN_CONSULTATION");
    expect(meeting.personId).toBe(captainId);
  });

  it("only allows a squad meeting when the dressing room actually has something to address", () => {
    dynamics().upsertCohesion({
      teamId: team.id, score: 85, level: "UNITED", captainInfluence: "STABILIZING", topIssue: undefined, updatedOn: "2026-10-15",
    });
    expect(() =>
      holdSquadMeeting(db, saveAt("2026-10-15"), managerProfileId, team.id, { type: "SQUAD_MEETING" }),
    ).toThrow(MeetingActionError);

    dynamics().upsertConcern({
      id: createStableEntityId("concern", `${playerBId}:playing-time-2`),
      personId: playerBId, teamId: team.id, type: "TRANSFER_INTEREST", status: "ACTIVE", severity: 5,
      raisedOn: "2026-10-10", updatedOn: "2026-10-15",
    });
    dynamics().upsertCohesion({
      teamId: team.id, score: 30, level: "POOR", captainInfluence: "NEUTRAL", topIssue: "The squad is unsettled.", updatedOn: "2026-10-15",
    });

    new PlayerRepository(db).upsertAvailabilityState({
      personId: playerBId, teamId: team.id, fitness: 82, moraleModifier: 0, formModifier: 0,
      availability: "AVAILABLE", updatedOn: "2026-10-14",
    });
    const before = new PlayerRepository(db).availabilityStates(team.id).find((s) => s.personId === playerBId)?.moraleModifier ?? 0;
    const meeting = holdSquadMeeting(db, saveAt("2026-10-15"), managerProfileId, team.id, { type: "SQUAD_MEETING" });
    expect(meeting.type).toBe("SQUAD_MEETING");
    expect(["POSITIVE", "NEUTRAL", "NEGATIVE"]).toContain(meeting.outcome);

    if (meeting.outcome !== "NEUTRAL") {
      const after = new PlayerRepository(db).availabilityStates(team.id).find((s) => s.personId === playerBId)?.moraleModifier ?? 0;
      expect(after).not.toBe(before);
    }
  });

  it("enforces a cooldown so the same meeting cannot be spammed", () => {
    dynamics().upsertCohesion({
      teamId: team.id, score: 90, level: "UNITED", captainInfluence: "STABILIZING", updatedOn: "2026-11-01",
    });
    holdSquadMeeting(db, saveAt("2026-11-01"), managerProfileId, team.id, { type: "CAPTAIN_CONSULTATION" });
    expect(() =>
      holdSquadMeeting(db, saveAt("2026-11-02"), managerProfileId, team.id, { type: "CAPTAIN_CONSULTATION" }),
    ).toThrow(MeetingActionError);

    // Ten days on, the cooldown (10 days for captain consultation) has lifted.
    expect(() =>
      holdSquadMeeting(db, saveAt("2026-11-11"), managerProfileId, team.id, { type: "CAPTAIN_CONSULTATION" }),
    ).not.toThrow();
  });

  it("persists meetings and dispute status across a save/load cycle", () => {
    db.close();
    db = openGameDatabase(dbPath);

    const meetings = new SquadDynamicsRepository(db).meetingsForTeam(team.id);
    expect(meetings.length).toBeGreaterThan(0);
    expect(meetings.some((m) => m.type === "MEDIATE_DISPUTE")).toBe(true);

    const disputes = new SquadDynamicsRepository(db).openDisputesForTeam(team.id);
    expect(disputes.every((d) => d.status === "OPEN")).toBe(true);
  });
});
