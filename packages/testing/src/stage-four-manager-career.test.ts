import { describe, expect, it } from "vitest";
import {
  CompetitionRepository,
  ManagerRepository,
  PlayerRepository,
  WorldRepository,
  createNewSave,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  FORMATION_PRESETS,
  TACTICAL_STYLE_PRESETS,
  analyzeTacticalShape,
  calculateRoleFit,
  createCareerCharacter,
  createCustomFormation,
  createManagerContract,
  createTacticalSetup,
  quickSimManagerMatch,
  persistQuickSimResult,
  roleById,
  testLicence,
  validateSelection,
  type QuickSimInput,
} from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type Club,
  type Competition,
  type CompetitionSeason,
  type Country,
  type EntityId,
  type FixtureRecord,
  type Person,
  type PlayerAttributeSet,
  type TacticalAssignment,
  type TacticalSetup,
  type TableTiebreaker,
  type Team,
} from "@nepal-football-sim/shared-types";

describe("stage four manager career and tactics", () => {
  it("validates flexible character age and creates a manager profile from one person identity", () => {
    const countryId = createStableEntityId("country", "NP");
    const result = createCareerCharacter({
      fullName: "Maya Adhikari",
      preferredDisplayName: "Maya",
      dateOfBirth: "1993-05-12",
      startingAge: 33,
      nationalityCountryId: countryId,
      languages: ["ne", "en"],
      footballBackground: "COMMUNITY_COACHING",
      education: "SPORTS_RELATED_DEGREE",
      playingExperience: "AMATEUR_PLAYER",
      coachingExperience: "YOUTH_COACH",
      coachingLicences: [testLicence("Testing C Licence", 1)],
      businessBackground: "SMALL_BUSINESS",
      startingReputationProfile: "LOCAL_RESPECTED",
      careerStartDate: "2026-08-01",
    });

    expect(result.person.id).toBe(result.managerRole.personId);
    expect(result.character.personId).toBe(result.person.id);
    expect(result.managerProfile.personId).toBe(result.person.id);
    expect(result.managerProfile.attributes.tactical.tacticalKnowledge).toBeGreaterThan(6);
    expect(result.managerProfile.attributes.personality.reputation).toBeLessThanOrEqual(14);
    expect(() =>
      createCareerCharacter({
        ...result.character,
        fullName: "Bad Age",
        dateOfBirth: "1980-01-01",
        nationalityCountryId: countryId,
        languages: ["ne"],
        footballBackground: "OTHER",
        education: "SECONDARY",
        playingExperience: "NO_PLAYING_EXPERIENCE",
        coachingExperience: "NONE",
        coachingLicences: [],
        businessBackground: "NONE",
        startingReputationProfile: "LOCAL_UNKNOWN",
        careerStartDate: "2026-08-01",
        startingAge: 22,
      }),
    ).toThrow(/inconsistent/);
  });

  it("persists manager contracts, tactical setups, inbox items and fitness without exposing SQLite", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    const world = seedWorld(db);
    const career = createCareerCharacter({
      fullName: "Maya Adhikari",
      dateOfBirth: "1993-05-12",
      startingAge: 33,
      nationalityCountryId: world.country.id,
      languages: ["ne"],
      footballBackground: "LOCAL_FOOTBALL",
      education: "UNIVERSITY",
      playingExperience: "AMATEUR_PLAYER",
      coachingExperience: "GRASSROOTS",
      coachingLicences: [testLicence("Testing C Licence")],
      businessBackground: "NONE",
      startingReputationProfile: "LOCAL_UNKNOWN",
      careerStartDate: "2026-08-01",
    });
    const repo = new WorldRepository(db);
    const managers = new ManagerRepository(db);
    repo.insertPerson(career.person);
    repo.insertPersonRole(career.managerRole);
    repo.insertCareerCharacter(career.character);
    managers.insertProfile(career.managerProfile);
    const contract = createManagerContract({
      managerProfileId: career.managerProfile.id,
      personId: career.person.id,
      teamId: world.homeTeam.id,
      clubId: world.homeClub.id,
      contractStart: "2026-08-01",
      contractEnd: "2027-05-31",
      salaryAmountMinor: 9_000_000,
    });
    managers.insertContract(contract);
    const setup = setupFor(world.homeTeam.id, world.homePlayers, career.managerProfile.id);
    managers.insertTacticalSetup(setup);

    expect(repo.getPersonRoles(career.person.id).map((role) => role.role)).toEqual(["MANAGER"]);
    expect(repo.getCareerCharacter(career.character.id)?.coachingExperience).toBe("GRASSROOTS");
    expect(managers.activeContract(career.managerProfile.id)?.status).toBe("ACTIVE");
    expect(managers.tacticalSetups(world.homeTeam.id)[0]?.formation.slots).toHaveLength(11);
    db.close();
  });

  it("supports custom formations, role fit and selectable poor fits with validation warnings", () => {
    const world = createWorldModel();
    const custom = createCustomFormation({
      name: "Narrow Test",
      slots: FORMATION_PRESETS[0]!.slots.map((slot) => ({
        ...slot,
        x: ["DL", "DR", "AML", "AMR"].includes(slot.id) ? 50 : slot.x,
      })),
    });
    const setup = setupFor(world.homeTeam.id, world.homePlayers);
    const duplicateSetup: TacticalSetup = {
      ...setup,
      formation: custom,
      assignments: setup.assignments.map((assignment, index) =>
        index < 2 ? { ...assignment, playerId: world.homePlayers[0]!.personId } : assignment,
      ),
    };
    const badFit = calculateRoleFit({
      player: world.homePlayers.find((player) => player.primaryPosition === "CB")!,
      slot: FORMATION_PRESETS[0]!.slots.find((slot) => slot.id === "STC")!,
      role: roleById("PRESSING_FORWARD"),
    });
    const validation = validateSelection({ setup: duplicateSetup, players: world.homePlayers });

    expect(custom.kind).toBe("CUSTOM");
    expect(analyzeTacticalShape(custom).warnings).toContain("Wide coverage is limited.");
    expect(badFit.overall).toBeLessThan(75);
    expect(badFit.label).not.toBe("Natural");
    expect(validation.isValid).toBe(false);
    expect(validation.blockingErrors).toContain("A player cannot occupy two tactical slots.");
  });

  it("makes tactics affect outcomes while remaining deterministic for the same seed", () => {
    const world = createWorldModel();
    const balanced = setupFor(world.homeTeam.id, world.homePlayers);
    const highPress = {
      ...balanced,
      style: "HIGH_PRESS" as const,
      instructions: TACTICAL_STYLE_PRESETS.HIGH_PRESS,
      familiarity: { formation: 76, style: 76, roles: 76, instructions: 76 },
    };
    const lowBlock = {
      ...balanced,
      style: "LOW_BLOCK" as const,
      instructions: TACTICAL_STYLE_PRESETS.LOW_BLOCK,
      familiarity: { formation: 76, style: 76, roles: 76, instructions: 76 },
    };
    const away = setupFor(world.awayTeam.id, world.awayPlayers);
    const first = quickSimManagerMatch(input(world, highPress, away, "same"));
    const second = quickSimManagerMatch(input(world, highPress, away, "same"));
    const defensive = quickSimManagerMatch(input(world, lowBlock, away, "same"));

    expect(first.result.match).toEqual(second.result.match);
    expect(first.result.homeStats.shots).not.toBe(defensive.result.homeStats.shots);
    expect(first.result.playerStates[0]!.currentFitness).toBeLessThan(
      defensive.result.playerStates[0]!.currentFitness,
    );
  });

  it("quick sim persists result, events, stats, standings, inbox and fitness", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    const world = seedWorld(db);
    const save = createNewSave(db, {
      name: "Stage 4 Save",
      worldDate: "2026-08-01",
      gameVersion: "0.1.0",
      randomSeed: "stage-four",
    });
    const setup = setupFor(world.homeTeam.id, world.homePlayers);
    const output = quickSimManagerMatch(
      input(world, setup, setupFor(world.awayTeam.id, world.awayPlayers), "persist"),
    );
    const quickInput: QuickSimInput = {
      ...input(world, setup, setupFor(world.awayTeam.id, world.awayPlayers), "persist"),
      save,
    };
    persistQuickSimResult(db, quickInput, output);

    expect(db.prepare("SELECT COUNT(*) AS count FROM matches").get()).toMatchObject({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM match_events").get()).toMatchObject({
      count: output.result.events.length,
    });
    expect(
      new CompetitionRepository(db).standings(world.fixture.competitionSeasonId!),
    ).toHaveLength(2);
    expect(
      new ManagerRepository(db).inboxItems().some((item) => item.type === "MATCH_RESULT"),
    ).toBe(true);
    expect(new PlayerRepository(db).availabilityStates(world.homeTeam.id)).toHaveLength(11);
    db.close();
  });
});

const createWorldModel = () => {
  const country: Country = {
    id: createStableEntityId("country", "NP"),
    name: "Nepal",
    isoCode: "NP",
  };
  const homeClub: Club = {
    id: createStableEntityId("club", "stage-four-home"),
    name: "Kathmandu Testing Club",
    countryId: country.id,
    ownershipType: "COMMUNITY",
  };
  const awayClub: Club = {
    id: createStableEntityId("club", "stage-four-away"),
    name: "Lalitpur Test XI",
    countryId: country.id,
    ownershipType: "COMMUNITY",
  };
  const homeTeam: Team = {
    id: createStableEntityId("team", "stage-four-home"),
    clubId: homeClub.id,
    name: "Kathmandu Testing Club",
    level: "senior",
    gender: "men",
  };
  const awayTeam: Team = {
    id: createStableEntityId("team", "stage-four-away"),
    clubId: awayClub.id,
    name: "Lalitpur Test XI",
    level: "senior",
    gender: "men",
  };
  const competition: Competition = {
    id: createStableEntityId("competition", "stage-four-test"),
    name: "Stage Four Testing League",
    scope: "domestic",
  };
  const competitionSeason: CompetitionSeason = {
    id: createStableEntityId("competition-season", "stage-four-test"),
    competitionId: competition.id,
    name: "Stage Four Testing League 2026",
    startDate: "2026-08-01",
    endDate: "2027-05-31",
  };
  const fixture: FixtureRecord = {
    id: createStableEntityId("fixture", "stage-four-opener"),
    competitionSeasonId: competitionSeason.id,
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    scheduledDate: "2026-08-03",
    status: "scheduled",
    round: 1,
  };
  return {
    country,
    homeClub,
    awayClub,
    homeTeam,
    awayTeam,
    competition,
    competitionSeason,
    fixture,
    ruleSet: {
      id: createStableEntityId("rules", "stage-four-test"),
      competitionSeasonId: fixture.competitionSeasonId!,
      competitionType: "DOUBLE_ROUND_ROBIN" as const,
      pointsForWin: 3,
      pointsForDraw: 1,
      pointsForLoss: 0,
      tiebreakers: ["points", "goalDifference", "goalsScored", "wins"] as TableTiebreaker[],
      numberOfRounds: 2,
      homeAwayStructure: "double" as const,
      seasonStartDate: "2026-08-01",
      seasonEndDate: "2027-05-31",
      roundSpacingDays: 7,
      promotionSlots: 0,
      relegationSlots: 1,
      continentalQualificationSlots: 1,
    },
    homePlayers: createSquad(homeTeam.id, 12),
    awayPlayers: createSquad(awayTeam.id, 12),
  };
};

const seedWorld = (db: ReturnType<typeof openGameDatabase>) => {
  const world = createWorldModel();
  const repo = new WorldRepository(db);
  repo.insertCountry(world.country);
  repo.insertClub(world.homeClub);
  repo.insertClub(world.awayClub);
  repo.insertTeam(world.homeTeam);
  repo.insertTeam(world.awayTeam);
  repo.insertCompetition(world.competition);
  repo.insertCompetitionSeason(world.competitionSeason);
  const playerTeams = [
    ...world.homePlayers.map((player) => ({ player, teamId: world.homeTeam.id })),
    ...world.awayPlayers.map((player) => ({ player, teamId: world.awayTeam.id })),
  ];
  for (const { player, teamId } of playerTeams) {
    const person: Person = {
      id: player.personId,
      fullName: `Player ${player.personId}`,
      nationalityCountryId: world.country.id,
      languages: ["ne"],
    };
    repo.insertPerson(person);
    repo.insertPersonRole({
      id: createStableEntityId("role", `${player.personId}:player`),
      personId: player.personId,
      role: "PLAYER",
      activeFrom: "2026-08-01",
    });
    repo.insertTeamPersonAssignment({
      id: createStableEntityId("assignment", `${player.personId}:${player.primaryPosition}`),
      personId: player.personId,
      teamId,
      role: "PLAYER",
      startedOn: "2026-08-01",
    });
    new PlayerRepository(db).insertAttributes(player);
  }
  new CompetitionRepository(db).insertFixture(world.fixture);
  return world;
};

const setupFor = (
  teamId: EntityId,
  players: readonly PlayerAttributeSet[],
  managerProfileId?: EntityId,
): TacticalSetup => {
  const formation = FORMATION_PRESETS[0]!;
  return createTacticalSetup({
    teamId,
    managerProfileId,
    name: "Stage 4 4-3-3",
    formation,
    style: "BALANCED",
    assignments: formation.slots.map<TacticalAssignment>((slot, index) => ({
      slotId: slot.id,
      playerId: players[index]?.personId,
      roleId:
        slot.id === "GK"
          ? "GOALKEEPER"
          : slot.id === "STC"
            ? "PRESSING_FORWARD"
            : "CENTRAL_MIDFIELDER",
    })),
  });
};

const input = (
  world: ReturnType<typeof createWorldModel>,
  homeTacticalSetup: TacticalSetup,
  awayTacticalSetup: TacticalSetup,
  seed: string,
): QuickSimInput => ({
  fixture: world.fixture,
  competitionTeamIds: [world.homeTeam.id, world.awayTeam.id],
  ruleSet: world.ruleSet,
  homePlayers: world.homePlayers,
  awayPlayers: world.awayPlayers,
  homeTacticalSetup,
  awayTacticalSetup,
  seed,
});

const createSquad = (teamId: EntityId, ability: number): PlayerAttributeSet[] => {
  const positions = ["GK", "RB", "CB", "CB", "LB", "CM", "CM", "AM", "RW", "LW", "ST"] as const;
  return positions.map((position, index) => ({
    id: createStableEntityId("attributes", `${teamId}:${index}`),
    personId: createStableEntityId("person", `${teamId}:${index}`),
    primaryPosition: position,
    secondaryPositions: position === "CB" ? ["RB", "LB"] : [],
    technical: group(ability, [
      "firstTouch",
      "passing",
      "crossing",
      "dribbling",
      "finishing",
      "heading",
      "tackling",
      "technique",
      "longShots",
      "setPieces",
    ]),
    mental: group(ability, [
      "decisions",
      "vision",
      "composure",
      "positioning",
      "anticipation",
      "workRate",
      "teamwork",
      "leadership",
      "aggression",
      "determination",
      "professionalism",
    ]),
    physical: group(ability, [
      "pace",
      "acceleration",
      "strength",
      "stamina",
      "agility",
      "balance",
      "jumping",
      "naturalFitness",
    ]),
    goalkeeping: group(position === "GK" ? ability + 3 : 4, [
      "handling",
      "reflexes",
      "oneOnOnes",
      "aerialReach",
      "kicking",
      "distribution",
      "commandOfArea",
    ]),
  }));
};

const group = <T extends string>(ability: number, keys: readonly T[]): Record<T, number> =>
  Object.fromEntries(keys.map((key) => [key, Math.max(1, Math.min(20, ability))])) as Record<
    T,
    number
  >;
