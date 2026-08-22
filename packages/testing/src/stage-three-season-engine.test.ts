import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import {
  completionReport,
  createDemoLeagueInput,
  generateLeagueFixtures,
  simulateMatch,
  simulateSeason,
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
  type Country,
  type LeagueStanding,
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

    db.close();
    const reloaded = openGameDatabase(databasePath);
    expect(
      new EventRepository(reloaded).historicalEvents().map((event) => event.eventType),
    ).toContain("COMPETITION_CHAMPION_DECLARED");
    const rows = reloaded
      .prepare("SELECT COUNT(*) AS count FROM league_standings WHERE competition_season_id = ?")
      .get(input.competitionSeason.id) as { count: number };
    expect(rows.count).toBe(input.teamIds.length);
    reloaded.close();
  });
});

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
