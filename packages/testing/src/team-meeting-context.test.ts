import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CompetitionRepository,
  ManagerRepository,
  PlayerRepository,
  SquadDynamicsRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  MeetingActionError,
  createCareerCharacter,
  evaluateTeamMeetingContext,
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

describe("team meeting context engine", () => {
  let db: GameDatabase;
  let world: WorldRepository;
  let competitions: CompetitionRepository;
  const country = { id: createStableEntityId("country", "TMC"), name: "Testland", isoCode: "TL" };

  const makeClub = (slug: string, name: string): { club: Club; team: Team } => {
    const club: Club = {
      id: createStableEntityId("club", slug),
      name,
      countryId: country.id,
      ownershipType: "PRIVATE",
    };
    const team: Team = {
      id: createStableEntityId("team", `${slug}-senior`),
      clubId: club.id,
      name,
      level: "senior",
      gender: "men",
    };
    world.insertClub(club);
    world.insertTeam(team);
    return { club, team };
  };

  // A generic N-team league, membership + standings for every team, so
  // percentage-based title/relegation zones are meaningful (not hardcoded
  // to any particular real competition).
  const setUpLeague = (teamCount: number, seasonStart: string, seasonEnd: string) => {
    const competitionId = createStableEntityId("competition", `tmc-league-${teamCount}`);
    const seasonId = createStableEntityId("season", `tmc-league-${teamCount}-season`);
    world.insertCompetition({ id: competitionId, name: `Test League ${teamCount}`, scope: "domestic" });
    world.insertCompetitionSeason({
      id: seasonId,
      competitionId,
      name: `Test League ${teamCount} Season`,
      startDate: seasonStart,
      endDate: seasonEnd,
    });
    competitions.insertRuleSet({
      id: createStableEntityId("ruleset", `tmc-league-${teamCount}`),
      competitionSeasonId: seasonId,
      competitionType: "LEAGUE",
      pointsForWin: 3,
      pointsForDraw: 1,
      pointsForLoss: 0,
      tiebreakers: ["goalDifference"],
      numberOfRounds: 1,
      homeAwayStructure: "double",
      seasonStartDate: seasonStart,
      seasonEndDate: seasonEnd,
      roundSpacingDays: 7,
      promotionSlots: 0,
      relegationSlots: 0,
      continentalQualificationSlots: 0,
    });
    const teams: Team[] = [];
    for (let i = 0; i < teamCount; i++) {
      const { club, team } = makeClub(`tmc-${teamCount}-${i}`, `Team ${teamCount}-${i}`);
      teams.push(team);
      world.insertClubMembership({
        id: createStableEntityId("membership", `tmc-${teamCount}-${i}`),
        clubId: club.id,
        teamId: team.id,
        competitionId,
        competitionSeasonId: seasonId,
        membershipType: "LEAGUE_MEMBER",
        status: "ACTIVE",
      });
    }
    return { competitionId, seasonId, teams };
  };

  const setStanding = (
    seasonId: EntityId,
    teamId: EntityId,
    values: { played: number; points: number; goalDifference: number },
  ) => {
    competitions.upsertStanding({
      competitionSeasonId: seasonId,
      teamId,
      played: values.played,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: values.goalDifference,
      points: values.points,
    });
  };

  beforeEach(() => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "team-meeting-context-"));
    db = openGameDatabase(join(savesDirectory, "career.sqlite"));
    migrateDatabase(db);
    world = new WorldRepository(db);
    competitions = new CompetitionRepository(db);
    world.insertCountry(country);
  });

  it("returns undefined when nothing warrants a meeting", () => {
    const { seasonId, teams } = setUpLeague(10, "2026-08-01", "2027-05-31");
    // A genuinely mid-table team, well clear of both the title race and the
    // relegation zone, with no fixtures/cohesion data suggesting otherwise.
    const ownTeam = teams[5]!;
    for (let i = 0; i < teams.length; i++) {
      setStanding(seasonId, teams[i]!.id, { played: 15, points: 30 - i * 3, goalDifference: 0 });
    }
    const context = evaluateTeamMeetingContext(db, "2027-01-15", ownTeam.id);
    expect(context).toBeUndefined();
  });

  it("detects DRESSING_ROOM_TENSION from real squad cohesion, ahead of table state", () => {
    const { seasonId, teams } = setUpLeague(10, "2026-08-01", "2027-05-31");
    const ownTeam = teams[0]!;
    for (let i = 0; i < teams.length; i++) {
      setStanding(seasonId, teams[i]!.id, { played: 15, points: 20 - i, goalDifference: 0 });
    }
    new SquadDynamicsRepository(db).upsertCohesion({
      teamId: ownTeam.id, score: 20, level: "POOR", captainInfluence: "DESTABILIZING",
      topIssue: "Several players are unhappy.", updatedOn: "2027-01-15",
    });
    const context = evaluateTeamMeetingContext(db, "2027-01-15", ownTeam.id);
    expect(context?.type).toBe("DRESSING_ROOM_TENSION");
    expect(context?.evidence.some((line: string) => line.includes("Several players are unhappy"))).toBe(true);
    expect(context?.messages.length).toBeGreaterThan(0);
  });

  it("detects POOR_RUN only from a genuine multi-game losing sample, not a single loss", () => {
    const { seasonId, teams } = setUpLeague(10, "2026-08-01", "2027-05-31");
    const ownTeam = teams[0]!;
    const opponent = teams[1]!;
    for (let i = 0; i < teams.length; i++) {
      setStanding(seasonId, teams[i]!.id, { played: 15, points: 20 - i, goalDifference: 0 });
    }

    const playFixture = (date: string, index: number, homeGoals: number, awayGoals: number) => {
      const fixtureId = createStableEntityId("fixture", `tmc-poor-run-${index}`);
      competitions.insertFixture({
        id: fixtureId,
        competitionSeasonId: seasonId,
        homeTeamId: ownTeam.id,
        awayTeamId: opponent.id,
        scheduledDate: date,
        status: "played",
        round: index,
      });
      competitions.insertMatch({
        id: createStableEntityId("match", `tmc-poor-run-${index}`),
        fixtureId,
        playedDate: date,
        homeGoals,
        awayGoals,
      });
    };

    // A single loss should not trigger anything.
    playFixture("2027-01-01", 1, 0, 1);
    expect(evaluateTeamMeetingContext(db, "2027-01-02", ownTeam.id)?.type).not.toBe("POOR_RUN");

    // Five straight losses (a genuine sample) should.
    playFixture("2027-01-08", 2, 0, 1);
    playFixture("2027-01-15", 3, 0, 2);
    playFixture("2027-01-22", 4, 1, 2);
    playFixture("2027-01-29", 5, 0, 3);
    const context = evaluateTeamMeetingContext(db, "2027-02-01", ownTeam.id);
    expect(context?.type).toBe("POOR_RUN");
    expect(context?.evidence[0]).toMatch(/5 defeats/);
  });

  it("derives TITLE_PUSH and RELEGATION_PRESSURE from percentage-based table zones, not hardcoded club names", () => {
    const { seasonId, teams } = setUpLeague(20, "2026-08-01", "2027-05-31");
    for (let i = 0; i < teams.length; i++) {
      setStanding(seasonId, teams[i]!.id, { played: 20, points: 60 - i * 2, goalDifference: 0 });
    }
    const leader = teams[0]!;
    const second = teams[1]!;
    const bottom = teams[teams.length - 1]!;

    const titleContext = evaluateTeamMeetingContext(db, "2027-02-15", second.id);
    expect(titleContext?.type).toBe("TITLE_PUSH");

    const relegationContext = evaluateTeamMeetingContext(db, "2027-02-15", bottom.id);
    expect(relegationContext?.type).toBe("RELEGATION_PRESSURE");

    // The leader itself, far clear at the top, is not "pushing" for anything.
    setStanding(seasonId, leader.id, { played: 20, points: 90, goalDifference: 0 });
    const leaderContext = evaluateTeamMeetingContext(db, "2027-02-15", leader.id);
    expect(leaderContext?.type).not.toBe("RELEGATION_PRESSURE");
  });

  it("derives SEASON_OPENING and SEASON_CLOSING from the real season calendar", () => {
    const { seasonId, teams } = setUpLeague(10, "2027-08-01", "2028-05-31");
    const ownTeam = teams[0]!;
    for (let i = 0; i < teams.length; i++) {
      setStanding(seasonId, teams[i]!.id, { played: 0, points: 0, goalDifference: 0 });
    }
    expect(evaluateTeamMeetingContext(db, "2027-08-05", ownTeam.id)?.type).toBe("SEASON_OPENING");

    for (let i = 0; i < teams.length; i++) {
      setStanding(seasonId, teams[i]!.id, { played: 34, points: 20 - i, goalDifference: 0 });
    }
    expect(evaluateTeamMeetingContext(db, "2028-05-25", ownTeam.id)?.type).toBe("SEASON_CLOSING");
  });
});

describe("holdSquadMeeting: contextual team meetings", () => {
  let db: GameDatabase;
  let world: WorldRepository;
  const country = { id: createStableEntityId("country", "TMH"), name: "Holdland", isoCode: "HL" };
  const club: Club = {
    id: createStableEntityId("club", "tmh-club"),
    name: "Team Meeting FC",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const team: Team = {
    id: createStableEntityId("team", "tmh-club-senior"),
    clubId: club.id,
    name: "Team Meeting FC",
    level: "senior",
    gender: "men",
  };
  const captainId = createStableEntityId("person", "tmh-captain");
  let managerProfileId: EntityId;

  const saveAt = (worldDate: string) => ({
    id: createStableEntityId("save", "team-meeting-context-test"),
    name: "Team Meeting Context Test",
    worldDate,
    databaseVersion: 27,
    gameVersion: "test",
    randomSeed: "team-meeting-context-test",
    createdAt: "2027-01-01T00:00:00.000Z",
    lastSavedAt: "2027-01-01T00:00:00.000Z",
  });

  const dynamics = () => new SquadDynamicsRepository(db);

  beforeEach(() => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "hold-squad-meeting-tmc-"));
    db = openGameDatabase(join(savesDirectory, "career.sqlite"));
    migrateDatabase(db);
    world = new WorldRepository(db);
    world.insertCountry(country);
    world.insertClub(club);
    world.insertTeam(team);

    world.insertPerson({ id: captainId, fullName: "Captain", nationalityCountryId: country.id, languages: ["ne"] });
    world.insertPersonRole({ id: createStableEntityId("role", `${captainId}:player`), personId: captainId, role: "PLAYER", activeFrom: "2027-01-01" });
    world.insertTeamPersonAssignment({ id: createStableEntityId("assignment", `${captainId}:player`), personId: captainId, teamId: team.id, role: "PLAYER", startedOn: "2027-01-01" });
    new PlayerRepository(db).insertAttributes(attributesFor(captainId));
    dynamics().upsertHierarchyEntry({
      id: createStableEntityId("hierarchy", captainId), teamId: team.id, personId: captainId,
      influence: 80, role: "CAPTAIN", updatedOn: "2027-01-01",
    });

    const character = createCareerCharacter({
      fullName: "Test Manager",
      dateOfBirth: "1980-01-01",
      startingAge: 47,
      nationalityCountryId: country.id,
      languages: ["ne"],
      footballBackground: "LOCAL_FOOTBALL",
      education: "UNIVERSITY",
      playingExperience: "PROFESSIONAL_PLAYER",
      coachingExperience: "SENIOR_COACH",
      coachingLicences: [testLicence("Testing A Licence", 3)],
      businessBackground: "NONE",
      startingReputationProfile: "FORMER_PLAYER",
      careerStartDate: "2027-01-01",
    });
    world.insertPerson(character.person);
    new ManagerRepository(db).insertProfile(character.managerProfile);
    managerProfileId = character.managerProfile.id;
  });

  it("rejects a squad meeting with a broader, still-genuine 'nothing to address' message when no context applies", () => {
    dynamics().upsertCohesion({
      teamId: team.id, score: 85, level: "UNITED", captainInfluence: "STABILIZING", updatedOn: "2027-01-10",
    });
    expect(() =>
      holdSquadMeeting(db, saveAt("2027-01-10"), managerProfileId, team.id, { type: "SQUAD_MEETING" }),
    ).toThrow(MeetingActionError);
  });

  it("applies a message-fit bonus that nudges the outcome without overriding the underlying state", () => {
    dynamics().upsertCohesion({
      teamId: team.id, score: 55, level: "POOR", captainInfluence: "NEUTRAL",
      topIssue: "The dressing room is uneasy.", updatedOn: "2027-01-10",
    });

    const goodMessage = holdSquadMeeting(db, saveAt("2027-01-10"), managerProfileId, team.id, {
      type: "SQUAD_MEETING",
      messageId: "CONFRONT_ISSUE",
    });
    expect(goodMessage.type).toBe("SQUAD_MEETING");
    expect(goodMessage.summary).toContain("Confront the issue");
  });

  it("records exactly one TEAM_MEETING_RESULT historical event per meeting, scoped to the club", () => {
    dynamics().upsertCohesion({
      teamId: team.id, score: 55, level: "POOR", captainInfluence: "NEUTRAL",
      topIssue: "The dressing room is uneasy.", updatedOn: "2027-01-10",
    });
    holdSquadMeeting(db, saveAt("2027-01-10"), managerProfileId, team.id, {
      type: "SQUAD_MEETING",
      messageId: "CONFRONT_ISSUE",
    });

    const rows = db
      .prepare("SELECT * FROM historical_events WHERE event_type = 'TEAM_MEETING_RESULT'")
      .all() as Array<{ id: string }>;
    expect(rows.length).toBe(1);
  });
});
