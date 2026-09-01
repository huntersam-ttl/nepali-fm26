import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import {
  completionReport,
  createDemoLeagueInput,
  createPlayer,
  generateLeagueFixtures,
  simulateMatch,
  simulateSeason,
  progressPyramidSeason,
  persistPyramidProgression,
  sortStandings,
  summarizePlayerStats,
  persistSeasonSimulation,
} from "@nepal-football-sim/simulation";
import {
  EventRepository,
  migrateDatabase,
  openGameDatabase,
  WorldRepository,
} from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type EntityId,
  type Country,
  type ClubMembership,
  type CompetitionRelationship,
  type CompetitionRuleSet,
  type CompetitionSeason,
  type LeagueStanding,
  type PlayerAttributeSet,
} from "@nepal-football-sim/shared-types";

const tempDirs: string[] = [];

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-stage-three-"));
  tempDirs.push(dir);
  return join(dir, "season.sqlite");
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("stage three competition and season engine", () => {
  it("generates complete deterministic double round-robin fixtures with home/away balance", () => {
    const input = createDemoLeagueInput("fixtures");
    const a = generateLeagueFixtures({
      competitionSeasonId: input.competitionSeason.id,
      teamIds: input.teamIds,
      ruleSet: input.ruleSet,
      seed: "same",
    });
    const b = generateLeagueFixtures({
      competitionSeasonId: input.competitionSeason.id,
      teamIds: input.teamIds,
      ruleSet: input.ruleSet,
      seed: "same",
    });

    expect(a).toEqual(b);
    expect(new Set(a.map((fixture) => fixture.id)).size).toBe(a.length);
    expect(a).toHaveLength(12);
    for (const teamId of input.teamIds) {
      expect(a.filter((fixture) => fixture.homeTeamId === teamId)).toHaveLength(3);
      expect(a.filter((fixture) => fixture.awayTeamId === teamId)).toHaveLength(3);
    }
    expect(a.some((fixture) => fixture.homeTeamId === fixture.awayTeamId)).toBe(false);
  });

  it("applies standings tiebreakers", () => {
    const seasonId = createStableEntityId("competition-season", "tie");
    const rows: LeagueStanding[] = [
      standing(seasonId, "a", 7, 2, 6),
      standing(seasonId, "b", 7, 4, 5),
      standing(seasonId, "c", 6, 8, 10),
    ];

    expect(
      sortStandings(rows, ["points", "goalDifference", "goalsScored"]).map((row) => row.teamId),
    ).toEqual(["b", "a", "c"]);
  });

  it("simulates deterministic matches from event streams with coherent player stats", () => {
    const input = createDemoLeagueInput("match");
    const fixture = generateLeagueFixtures({
      competitionSeasonId: input.competitionSeason.id,
      teamIds: input.teamIds.slice(0, 2),
      ruleSet: { ...input.ruleSet, homeAwayStructure: "single" },
      seed: "fixture",
    })[0]!;
    const result = simulateMatch({
      fixture,
      homePlayers: input.playersByTeam.get(fixture.homeTeamId)!,
      awayPlayers: input.playersByTeam.get(fixture.awayTeamId)!,
      seed: "match-seed",
    });
    const repeat = simulateMatch({
      fixture,
      homePlayers: input.playersByTeam.get(fixture.homeTeamId)!,
      awayPlayers: input.playersByTeam.get(fixture.awayTeamId)!,
      seed: "match-seed",
    });

    expect(result.match.homeGoals).toBe(repeat.match.homeGoals);
    expect(result.match.awayGoals).toBe(repeat.match.awayGoals);
    expect(result.events.map((event) => event.type)).toContain("FULL_TIME");
    const eventGoals = result.events.filter((event) => event.type === "GOAL").length;
    const playerGoals = result.playerStates.reduce((total, state) => total + state.goals, 0);
    expect(playerGoals).toBe(eventGoals);
    expect(result.homeStats.shots).toBeGreaterThanOrEqual(result.homeStats.shotsOnTarget);
    expect(result.homeStats.xg + result.awayStats.xg).toBeGreaterThan(0);
  });

  it("keeps probabilistic balance plausible across deterministic samples", () => {
    const input = createDemoLeagueInput("balance-test");
    const fixture = generateLeagueFixtures({
      competitionSeasonId: input.competitionSeason.id,
      teamIds: input.teamIds.slice(0, 2),
      ruleSet: { ...input.ruleSet, homeAwayStructure: "single" },
      seed: "balance-fixture",
    })[0]!;
    let strongWins = 0;
    let underdogWins = 0;
    let draws = 0;
    let goals = 0;
    let redCards = 0;
    let injuries = 0;

    for (let index = 0; index < 500; index += 1) {
      const result = simulateMatch({
        fixture,
        homePlayers: input.playersByTeam.get(fixture.homeTeamId)!,
        awayPlayers: input.playersByTeam.get(fixture.awayTeamId)!,
        seed: `sample:${index}`,
      });
      const homeGoals = result.match.homeGoals ?? 0;
      const awayGoals = result.match.awayGoals ?? 0;
      strongWins += Number(homeGoals > awayGoals);
      underdogWins += Number(homeGoals < awayGoals);
      draws += Number(homeGoals === awayGoals);
      goals += homeGoals + awayGoals;
      redCards += result.events.filter((event) => event.type === "RED_CARD").length;
      injuries += result.events.filter((event) => event.type === "INJURY").length;
    }

    expect(strongWins).toBeGreaterThan(underdogWins);
    expect(underdogWins).toBeGreaterThan(0);
    expect(draws).toBeGreaterThan(0);
    expect(goals / 500).toBeGreaterThan(1.2);
    expect(goals / 500).toBeLessThan(5.2);
    expect(redCards).toBeGreaterThan(0);
    expect(redCards / 500).toBeLessThan(0.35);
    expect(injuries).toBeGreaterThan(0);
  });

  it("keeps Stage 3.1 balance regressions in broad believable ranges", () => {
    const equal = sampleBalance("stage-3-1-equal", 12, 12, 600);
    expect(equal.homeWins).toBeGreaterThan(equal.awayWins);
    expect(equal.draws).toBeGreaterThan(120);
    expect(equal.goalsPerMatch).toBeGreaterThan(2);
    expect(equal.goalsPerMatch).toBeLessThan(3.1);
    expect(equal.zeroGoalMatches).toBeGreaterThan(20);
    expect(equal.fivePlusGoalMatches / 600).toBeLessThan(0.18);

    const strong = sampleBalance("stage-3-1-strong", 16, 8, 600);
    expect(strong.homeWins / 600).toBeGreaterThan(0.65);
    expect(strong.homeWins / 600).toBeLessThan(0.9);
    expect(strong.awayWins).toBeGreaterThan(10);
    expect(strong.draws).toBeGreaterThan(40);

    const slight = sampleBalance("stage-3-1-slight", 13, 11, 600);
    expect(slight.homeWins / 600).toBeGreaterThan(0.38);
    expect(slight.homeWins / 600).toBeLessThan(0.62);
    expect(slight.awayWins).toBeGreaterThan(60);

    expect(equal.redCardsPerMatch).toBeLessThan(0.22);
    expect(equal.injuriesPerMatch).toBeLessThan(0.22);
  });

  it("completes a season, rolls forward and summarizes player/team stats from results", () => {
    const input = createDemoLeagueInput("season");
    const result = simulateSeason(input);

    expect(result.fixtures).toHaveLength(12);
    expect(result.results).toHaveLength(12);
    expect(result.report.champion).toBeTruthy();
    expect(result.report.matchesPlayed).toBe(12);
    expect(result.nextSeason.startDate).toBe("2027-08-01");

    const playerStats = summarizePlayerStats(input.competitionSeason.id, result.results);
    const eventGoals = result.results
      .flatMap((match) => match.events)
      .filter((event) => event.type === "GOAL").length;
    expect(playerStats.reduce((total, stat) => total + stat.goals, 0)).toBe(eventGoals);
    expect(
      completionReport({
        seasonName: input.competitionSeason.name,
        fixtures: result.fixtures,
        results: result.results,
        standings: [
          {
            competitionSeasonId: input.competitionSeason.id,
            teamId: result.report.champion!,
            played: 1,
            won: 1,
            drawn: 0,
            lost: 0,
            goalsFor: 1,
            goalsAgainst: 0,
            goalDifference: 1,
            points: 3,
          },
        ],
      }).season,
    ).toBe(input.competitionSeason.name);
  });

  it("persists champion history for completed seasons", () => {
    const databasePath = tempDbPath();
    const db = openGameDatabase(databasePath);
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const country: Country = {
      id: createStableEntityId("country", "stage-three"),
      name: "Testing-only Country",
      isoCode: "TST",
    };
    world.insertCountry(country);
    const input = createDemoLeagueInput("persist");
    for (const teamId of input.teamIds) {
      world.insertClub({
        id: createStableEntityId("club", String(teamId)),
        name: String(teamId),
        countryId: country.id,
        ownershipType: "UNKNOWN",
      });
      world.insertTeam({
        id: teamId,
        clubId: createStableEntityId("club", String(teamId)),
        name: String(teamId),
        level: "senior",
        gender: "men",
      });
      for (const player of input.playersByTeam.get(teamId) ?? []) {
        world.insertPerson({
          id: player.personId,
          fullName: `Testing-only Player ${player.personId}`,
          nationalityCountryId: country.id,
          languages: [],
        });
      }
    }
    world.insertCompetition({
      id: input.competitionSeason.competitionId,
      name: "Testing-only Competition",
      scope: "domestic",
    });
    world.insertCompetitionSeason(input.competitionSeason);
    const result = simulateSeason(input);
    persistSeasonSimulation(db, input, result);
    persistSeasonSimulation(db, input, result);

    db.close();
    const reloaded = openGameDatabase(databasePath);
    expect(
      new EventRepository(reloaded).historicalEvents().map((event) => event.eventType),
    ).toContain("COMPETITION_CHAMPION_DECLARED");
    expect(
      new EventRepository(reloaded)
        .historicalEvents()
        .filter((event) => event.eventType === "COMPETITION_CHAMPION_DECLARED"),
    ).toHaveLength(1);
    const rows = reloaded
      .prepare("SELECT COUNT(*) AS count FROM league_standings WHERE competition_season_id = ?")
      .get(input.competitionSeason.id) as { count: number };
    expect(rows.count).toBe(input.teamIds.length);
    reloaded.close();
  });

  it("creates next-season memberships from promotion and relegation without changing club IDs", () => {
    const pyramid = createPyramidScenario();
    const year = 2026;
    const result = progressPyramidSeason({
      completedSeasons: [
        completedPyramidSeason(pyramid, "A", year),
        completedPyramidSeason(pyramid, "B", year),
      ],
      nextSeasons: nextSeasonMap(pyramid, year),
      relationships: pyramidOnlyRelationships(pyramid),
    });

    const planningBoyz = pyramid.clubIds["B1"]!;
    const bottomA = pyramid.clubIds["A14"]!;
    const bottomB = pyramid.clubIds["B14"]!;
    const nextA = pyramid.seasonIds("A", year + 1);
    const nextB = pyramid.seasonIds("B", year + 1);
    const nextC = pyramid.seasonIds("C", year + 1);

    expect(hasMembership(result.nextMemberships, planningBoyz, nextA)).toBe(true);
    expect(hasMembership(result.nextMemberships, bottomA, nextB)).toBe(true);
    expect(hasMembership(result.nextMemberships, bottomB, nextC)).toBe(true);
    expect(hasMembership(result.nextMemberships, planningBoyz, nextB)).toBe(false);
    expect(hasMembership(result.nextMemberships, bottomA, nextA)).toBe(false);
    expect(result.movements.map((movement) => movement.movementType).sort()).toEqual([
      "PROMOTION",
      "RELEGATION",
      "RELEGATION",
    ]);
    expect(result.historicalEvents.map((event) => event.eventType).sort()).toEqual([
      "CLUB_PROMOTED",
      "CLUB_RELEGATED",
      "CLUB_RELEGATED",
    ]);
  });

  it("supports suspended relegation and franchise leagues through season rules", () => {
    const pyramid = createPyramidScenario();
    const year = 2026;
    const suspendedA = {
      ...completedPyramidSeason(pyramid, "A", year),
      ruleSet: {
        ...pyramid.rule("A", year),
        relegationSlots: 2,
        specialRules: { relegationSuspended: true },
      },
    };
    const nslSeason = completedPyramidSeason(pyramid, "NSL", year);
    const result = progressPyramidSeason({
      completedSeasons: [suspendedA, nslSeason],
      nextSeasons: nextSeasonMap(pyramid, year),
      relationships: pyramidOnlyRelationships(pyramid),
    });

    expect(result.movements).toEqual([]);
    expect(
      result.nextMemberships.filter(
        (membership) => membership.competitionId === pyramid.competitionIds.A,
      ),
    ).toHaveLength(14);
    expect(result.historicalEvents.map((event) => event.eventType)).toContain(
      "RELEGATION_SUSPENDED",
    );
    expect(
      result.historicalEvents.some(
        (event) => event.eventType === "CLUB_PROMOTED" || event.eventType === "CLUB_RELEGATED",
      ),
    ).toBe(false);
  });

  it("models National League qualification as non-permanent membership", () => {
    const pyramid = createPyramidScenario();
    const year = 2026;
    const result = progressPyramidSeason({
      completedSeasons: [completedPyramidSeason(pyramid, "A", year)],
      nextSeasons: nextSeasonMap(pyramid, year),
      relationships: pyramid.relationships,
    });

    const nextNational = pyramid.seasonIds("NATIONAL", year + 1);
    const qualified = result.nextMemberships.filter(
      (membership) => membership.competitionSeasonId === nextNational,
    );
    expect(qualified).toHaveLength(4);
    expect(qualified.every((membership) => membership.status === "QUALIFIED")).toBe(true);
    expect(
      hasMembership(
        result.nextMemberships,
        pyramid.clubIds["A1"]!,
        pyramid.seasonIds("A", year + 1),
      ),
    ).toBe(true);
  });

  it("handles league expansion through data-driven suspended relegation and promotion rules", () => {
    const pyramid = createPyramidScenario();
    const year = 2026;
    const result = progressPyramidSeason({
      completedSeasons: [
        {
          ...completedPyramidSeason(pyramid, "A", year),
          ruleSet: {
            ...pyramid.rule("A", year),
            relegationSlots: 0,
            specialRules: { relegationSuspended: true, temporaryExpandedLeague: true },
          },
        },
        {
          ...completedPyramidSeason(pyramid, "B", year),
          ruleSet: { ...pyramid.rule("B", year), promotionSlots: 2 },
        },
      ],
      nextSeasons: nextSeasonMap(pyramid, year),
      relationships: pyramidOnlyRelationships(pyramid, { bPromotionSlots: 2 }),
    });

    const nextA = pyramid.seasonIds("A", year + 1);
    expect(
      result.nextMemberships.filter((membership) => membership.competitionSeasonId === nextA),
    ).toHaveLength(16);
    expect(result.historicalEvents.map((event) => event.eventType)).toContain(
      "COMPETITION_EXPANDED",
    );
  });

  it("persists movement records and history events", () => {
    const db = openGameDatabase(tempDbPath());
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const competitions = new EventRepository(db);
    const pyramid = createPyramidScenario();
    const countryId = createStableEntityId("country", "pyramid-persist");
    world.insertCountry({ id: countryId, name: "Testing-only Country", isoCode: "PYR" });
    for (const [key, clubId] of Object.entries(pyramid.clubIds)) {
      const teamId = pyramid.teamIds[key]!;
      world.insertClub({ id: clubId, name: key, countryId, ownershipType: "UNKNOWN" });
      world.insertTeam({ id: teamId, clubId, name: `${key} Team`, level: "senior", gender: "men" });
    }
    for (const [key, competitionId] of Object.entries(pyramid.competitionIds)) {
      world.insertCompetition({ id: competitionId, name: key, scope: "domestic" });
      world.insertCompetitionSeason(pyramid.season(key as PyramidCompetitionKey, 2026));
      world.insertCompetitionSeason(pyramid.season(key as PyramidCompetitionKey, 2027));
    }
    const result = progressPyramidSeason({
      completedSeasons: [
        completedPyramidSeason(pyramid, "A", 2026),
        completedPyramidSeason(pyramid, "B", 2026),
      ],
      nextSeasons: nextSeasonMap(pyramid, 2026),
      relationships: pyramidOnlyRelationships(pyramid),
    });
    persistPyramidProgression(db, result);
    persistPyramidProgression(db, result);

    expect(competitions.historicalEvents().map((event) => event.eventType)).toContain(
      "CLUB_PROMOTED",
    );
    expect(
      competitions.historicalEvents().filter((event) => event.eventType === "CLUB_PROMOTED"),
    ).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM competition_movements").get()).toEqual({
      count: 3,
    });
    db.close();
  });

  it("keeps a synthetic Nepal pyramid stable across 10 seasons", () => {
    const pyramid = createPyramidScenario();
    let active = new Map<PyramidCompetitionKey, EntityId[]>([
      ["A", numberedIds(pyramid.clubIds, "A", 14)],
      ["B", numberedIds(pyramid.clubIds, "B", 14)],
      ["C", numberedIds(pyramid.clubIds, "C", 14)],
      ["NSL", numberedIds(pyramid.clubIds, "NSL", 4)],
      ["NATIONAL", []],
    ]);
    const originalIds = new Set([...active.values()].flat());
    let movementCount = 0;

    for (let year = 2026; year < 2036; year += 1) {
      const completed = (["A", "B", "C"] as const).map((key) =>
        completedPyramidSeason(pyramid, key, year, active.get(key)!),
      );
      const result = progressPyramidSeason({
        completedSeasons: completed,
        nextSeasons: nextSeasonMap(pyramid, year),
        relationships: pyramid.relationships.filter(
          (relationship) => relationship.toCompetitionId !== pyramid.competitionIds.NATIONAL,
        ),
      });
      movementCount += result.movements.length;
      active = membershipsToActive(result.nextMemberships, pyramid, year + 1);

      expect(active.get("A")).toHaveLength(14);
      expect(active.get("B")).toHaveLength(14);
      expect(active.get("C")).toHaveLength(14);
      const pyramidMemberships = [...active.get("A")!, ...active.get("B")!, ...active.get("C")!];
      expect(new Set(pyramidMemberships).size).toBe(pyramidMemberships.length);
      expect(pyramidMemberships.every((clubId) => originalIds.has(clubId))).toBe(true);
    }

    expect(movementCount).toBeGreaterThan(0);
  });
});

const sampleBalance = (
  seed: string,
  homeAbility: number,
  awayAbility: number,
  samples: number,
): {
  homeWins: number;
  draws: number;
  awayWins: number;
  goalsPerMatch: number;
  zeroGoalMatches: number;
  fivePlusGoalMatches: number;
  redCardsPerMatch: number;
  injuriesPerMatch: number;
} => {
  const input = createDemoLeagueInput(seed);
  const fixture = generateLeagueFixtures({
    competitionSeasonId: input.competitionSeason.id,
    teamIds: input.teamIds.slice(0, 2),
    ruleSet: { ...input.ruleSet, homeAwayStructure: "single" },
    seed,
  })[0]!;
  const homePlayers = createFlatSquad(fixture.homeTeamId, homeAbility);
  const awayPlayers = createFlatSquad(fixture.awayTeamId, awayAbility);
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let goals = 0;
  let zeroGoalMatches = 0;
  let fivePlusGoalMatches = 0;
  let redCards = 0;
  let injuries = 0;

  for (let index = 0; index < samples; index += 1) {
    const result = simulateMatch({
      fixture,
      homePlayers,
      awayPlayers,
      seed: `${seed}:${index}`,
    });
    const homeGoals = result.match.homeGoals ?? 0;
    const awayGoals = result.match.awayGoals ?? 0;
    const totalGoals = homeGoals + awayGoals;
    homeWins += Number(homeGoals > awayGoals);
    draws += Number(homeGoals === awayGoals);
    awayWins += Number(homeGoals < awayGoals);
    goals += totalGoals;
    zeroGoalMatches += Number(totalGoals === 0);
    fivePlusGoalMatches += Number(totalGoals >= 5);
    redCards += result.homeStats.redCards + result.awayStats.redCards;
    injuries += result.events.filter((event) => event.type === "INJURY").length;
  }

  return {
    homeWins,
    draws,
    awayWins,
    goalsPerMatch: goals / samples,
    zeroGoalMatches,
    fivePlusGoalMatches,
    redCardsPerMatch: redCards / samples,
    injuriesPerMatch: injuries / samples,
  };
};

const createFlatSquad = (teamId: EntityId, ability: number): PlayerAttributeSet[] =>
  ["GK", "RB", "CB", "CB", "LB", "CM", "CM", "AM", "RW", "LW", "ST"].map((position, index) =>
    createPlayer(teamId, position as PlayerAttributeSet["primaryPosition"], index, ability),
  );

const standing = (
  seasonId: ReturnType<typeof createStableEntityId>,
  teamId: string,
  points: number,
  goalDifference: number,
  goalsFor: number,
): LeagueStanding => ({
  competitionSeasonId: seasonId,
  teamId: teamId as LeagueStanding["teamId"],
  played: 3,
  won: 2,
  drawn: 1,
  lost: 0,
  goalsFor,
  goalsAgainst: goalsFor - goalDifference,
  goalDifference,
  points,
});

type PyramidCompetitionKey = "A" | "B" | "C" | "NSL" | "NATIONAL";

const createPyramidScenario = () => {
  const competitionIds = {
    A: createStableEntityId("competition", "pyramid-a"),
    B: createStableEntityId("competition", "pyramid-b"),
    C: createStableEntityId("competition", "pyramid-c"),
    NSL: createStableEntityId("competition", "pyramid-nsl"),
    NATIONAL: createStableEntityId("competition", "pyramid-national"),
  } satisfies Record<PyramidCompetitionKey, EntityId>;
  const clubIds: Record<string, EntityId> = {};
  const teamIds: Record<string, EntityId> = {};
  for (const prefix of ["A", "B", "C"] as const) {
    for (let index = 1; index <= 14; index += 1) {
      clubIds[`${prefix}${index}`] = createStableEntityId("club", `pyramid-${prefix}${index}`);
      teamIds[`${prefix}${index}`] = createStableEntityId("team", `pyramid-${prefix}${index}`);
    }
  }
  for (let index = 1; index <= 4; index += 1) {
    clubIds[`NSL${index}`] = createStableEntityId("club", `pyramid-nsl${index}`);
    teamIds[`NSL${index}`] = createStableEntityId("team", `pyramid-nsl${index}`);
  }

  const season = (key: PyramidCompetitionKey, year: number): CompetitionSeason => ({
    id: createStableEntityId("competition-season", `pyramid-${key}:${year}`),
    competitionId: competitionIds[key],
    name: `Testing-only ${key} ${year}`,
    startDate: `${year}-08-01`,
    endDate: `${year + 1}-05-31`,
  });
  const rule = (
    key: PyramidCompetitionKey,
    year: number,
    overrides: Partial<CompetitionRuleSet> = {},
  ): CompetitionRuleSet => ({
    id: createStableEntityId("competition-rule", `pyramid-${key}:${year}`),
    competitionSeasonId: season(key, year).id,
    competitionType: key === "NSL" ? "ROUND_ROBIN" : "DOUBLE_ROUND_ROBIN",
    pointsForWin: 3,
    pointsForDraw: 1,
    pointsForLoss: 0,
    tiebreakers: ["points", "goalDifference", "goalsScored", "wins"],
    numberOfRounds: key === "NSL" ? 1 : 2,
    homeAwayStructure: key === "NSL" ? "single" : "double",
    seasonStartDate: `${year}-08-01`,
    seasonEndDate: `${year + 1}-05-31`,
    roundSpacingDays: 7,
    promotionSlots: key === "B" || key === "C" ? 1 : 0,
    relegationSlots: key === "A" || key === "B" ? 1 : 0,
    continentalQualificationSlots: 0,
    promotionEnabled: key !== "NSL",
    relegationEnabled: key !== "NSL",
    ...overrides,
  });

  return {
    competitionIds,
    clubIds,
    teamIds,
    relationships: [
      relationship(
        "a-relegation-b",
        competitionIds.A,
        competitionIds.B,
        "RELEGATION",
        1,
        "BOTTOM_TABLE",
      ),
      relationship(
        "b-promotion-a",
        competitionIds.B,
        competitionIds.A,
        "PROMOTION",
        1,
        "TOP_TABLE",
      ),
      relationship(
        "b-relegation-c",
        competitionIds.B,
        competitionIds.C,
        "RELEGATION",
        1,
        "BOTTOM_TABLE",
      ),
      relationship(
        "c-promotion-b",
        competitionIds.C,
        competitionIds.B,
        "PROMOTION",
        1,
        "TOP_TABLE",
      ),
      relationship(
        "a-qualification-national",
        competitionIds.A,
        competitionIds.NATIONAL,
        "QUALIFICATION",
        4,
        "TOP_TABLE",
      ),
    ],
    season,
    seasonIds: (key: PyramidCompetitionKey, year: number) => season(key, year).id,
    rule,
  };
};

const relationship = (
  key: string,
  fromCompetitionId: EntityId,
  toCompetitionId: EntityId,
  movementType: CompetitionRelationship["movementType"],
  numberOfTeams: number,
  selectionMethod: CompetitionRelationship["selectionMethod"],
): CompetitionRelationship => ({
  id: createStableEntityId("competition-relationship", key),
  fromCompetitionId,
  toCompetitionId,
  movementType,
  numberOfTeams,
  selectionMethod,
});

const pyramidOnlyRelationships = (
  pyramid: ReturnType<typeof createPyramidScenario>,
  options: { bPromotionSlots?: number } = {},
): CompetitionRelationship[] =>
  pyramid.relationships
    .filter((item) => item.toCompetitionId !== pyramid.competitionIds.NATIONAL)
    .map((item) =>
      item.fromCompetitionId === pyramid.competitionIds.B &&
      item.toCompetitionId === pyramid.competitionIds.A &&
      item.movementType === "PROMOTION" &&
      options.bPromotionSlots !== undefined
        ? { ...item, numberOfTeams: options.bPromotionSlots }
        : item,
    );

const completedPyramidSeason = (
  pyramid: ReturnType<typeof createPyramidScenario>,
  key: PyramidCompetitionKey,
  year: number,
  clubIds = numberedIds(pyramid.clubIds, key, key === "NSL" ? 4 : 14),
): {
  season: CompetitionSeason;
  ruleSet: CompetitionRuleSet;
  standings: LeagueStanding[];
  memberships: ClubMembership[];
} => {
  const season = pyramid.season(key, year);
  const memberships = clubIds.map((clubId) =>
    membership(
      clubId,
      teamForClub(pyramid, clubId),
      pyramid.competitionIds[key],
      season.id,
      key === "NSL" ? "FRANCHISE" : "LEAGUE_MEMBER",
    ),
  );
  return {
    season,
    ruleSet: pyramid.rule(key, year),
    standings: standingsForMemberships(season.id, memberships),
    memberships,
  };
};

const membership = (
  clubId: EntityId,
  teamId: EntityId,
  competitionId: EntityId,
  competitionSeasonId: EntityId,
  membershipType: ClubMembership["membershipType"],
): ClubMembership => ({
  id: createStableEntityId("club-membership", `${clubId}:${competitionSeasonId}`),
  clubId,
  teamId,
  competitionId,
  competitionSeasonId,
  membershipType,
  status: "ACTIVE",
});

const standingsForMemberships = (
  competitionSeasonId: EntityId,
  memberships: readonly ClubMembership[],
): LeagueStanding[] =>
  memberships.map((membership, index) => ({
    competitionSeasonId,
    teamId: membership.teamId!,
    played: memberships.length - 1,
    won: Math.max(0, memberships.length - index - 1),
    drawn: 0,
    lost: index,
    goalsFor: Math.max(1, memberships.length - index),
    goalsAgainst: index,
    goalDifference: memberships.length - index * 2,
    points: (memberships.length - index) * 3,
  }));

const nextSeasonMap = (
  pyramid: ReturnType<typeof createPyramidScenario>,
  year: number,
): ReadonlyMap<EntityId, CompetitionSeason> =>
  new Map(
    (["A", "B", "C", "NSL", "NATIONAL"] as const).map((key) => [
      pyramid.competitionIds[key],
      pyramid.season(key, year + 1),
    ]),
  );

const numberedIds = (
  ids: Record<string, EntityId>,
  prefix: PyramidCompetitionKey,
  count: number,
): EntityId[] => Array.from({ length: count }, (_, index) => ids[`${prefix}${index + 1}`]!);

const hasMembership = (
  memberships: readonly ClubMembership[],
  clubId: EntityId,
  competitionSeasonId: EntityId,
): boolean =>
  memberships.some(
    (membership) =>
      membership.clubId === clubId && membership.competitionSeasonId === competitionSeasonId,
  );

const teamForClub = (
  pyramid: ReturnType<typeof createPyramidScenario>,
  clubId: EntityId,
): EntityId => {
  const entry = Object.entries(pyramid.clubIds).find(([, id]) => id === clubId);
  if (entry === undefined) {
    throw new Error(`Missing team for club ${clubId}`);
  }
  return pyramid.teamIds[entry[0]]!;
};

const membershipsToActive = (
  memberships: readonly ClubMembership[],
  pyramid: ReturnType<typeof createPyramidScenario>,
  year: number,
): Map<PyramidCompetitionKey, EntityId[]> =>
  new Map(
    (["A", "B", "C", "NSL", "NATIONAL"] as const).map((key) => [
      key,
      memberships
        .filter((membership) => membership.competitionSeasonId === pyramid.seasonIds(key, year))
        .map((membership) => membership.clubId),
    ]),
  );
