import type {
  EntityId,
  PlayerAttributeSet,
  TacticalSetup,
  TacticalStyleId,
} from "@nepal-football-sim/shared-types";
import { createDemoLeagueInput } from "./demo-league.js";
import { generateLeagueFixtures } from "./fixture-generation.js";
import { simulateMatch } from "./match-engine.js";
import { createTacticalSetup, FORMATION_PRESETS, TACTICAL_STYLE_PRESETS } from "./tactics.js";

const samples = 500;
const scenarios = [
  {
    name: "Balanced vs Balanced",
    homeAbility: 12,
    awayAbility: 12,
    homeStyle: "BALANCED",
    awayStyle: "BALANCED",
  },
  {
    name: "High Press vs Balanced",
    homeAbility: 12,
    awayAbility: 12,
    homeStyle: "HIGH_PRESS",
    awayStyle: "BALANCED",
  },
  {
    name: "Possession vs Direct",
    homeAbility: 12,
    awayAbility: 12,
    homeStyle: "POSSESSION",
    awayStyle: "DIRECT",
  },
  {
    name: "Low Block vs Attacking",
    homeAbility: 12,
    awayAbility: 12,
    homeStyle: "LOW_BLOCK",
    awayStyle: "VERTICAL",
  },
  {
    name: "Strong bad fit",
    homeAbility: 15,
    awayAbility: 11,
    homeStyle: "GEGENPRESS",
    awayStyle: "BALANCED",
    poorFitHome: true,
  },
  {
    name: "Weaker good fit",
    homeAbility: 11,
    awayAbility: 14,
    homeStyle: "BALANCED",
    awayStyle: "POSSESSION",
    poorFitHome: false,
  },
] satisfies readonly TacticalScenario[];

console.log(
  JSON.stringify(
    { samples, scenarios: scenarios.map((scenario) => runScenario(scenario, samples)) },
    null,
    2,
  ),
);

type TacticalScenario = {
  name: string;
  homeAbility: number;
  awayAbility: number;
  homeStyle: TacticalStyleId;
  awayStyle: TacticalStyleId;
  poorFitHome?: boolean;
};

function runScenario(scenario: TacticalScenario, count: number) {
  const input = createDemoLeagueInput(`tactical-balance:${scenario.name}`);
  const fixture = generateLeagueFixtures({
    competitionSeasonId: input.competitionSeason.id,
    teamIds: input.teamIds.slice(0, 2),
    ruleSet: { ...input.ruleSet, homeAwayStructure: "single" },
    seed: `tactical-balance:${scenario.name}:fixture`,
  })[0]!;
  const homePlayers = input.playersByTeam
    .get(fixture.homeTeamId)!
    .map((player) => adjust(player, scenario.homeAbility));
  const awayPlayers = input.playersByTeam
    .get(fixture.awayTeamId)!
    .map((player) => adjust(player, scenario.awayAbility));
  const homeSetup = setup(
    fixture.homeTeamId,
    homePlayers,
    scenario.homeStyle,
    Boolean(scenario.poorFitHome),
  );
  const awaySetup = setup(fixture.awayTeamId, awayPlayers, scenario.awayStyle, false);
  const totals = {
    homeWins: 0,
    draws: 0,
    awayWins: 0,
    goals: 0,
    homeXg: 0,
    awayXg: 0,
    homeShots: 0,
    awayShots: 0,
    homePossession: 0,
    awayPossession: 0,
    homeFitness: 0,
    awayFitness: 0,
  };

  for (let index = 0; index < count; index += 1) {
    const result = simulateMatch({
      fixture,
      homePlayers,
      awayPlayers,
      homeTacticalSetup: homeSetup,
      awayTacticalSetup: awaySetup,
      seed: `tactical-balance:${scenario.name}:${index}`,
    });
    const homeGoals = result.match.homeGoals ?? 0;
    const awayGoals = result.match.awayGoals ?? 0;
    totals.homeWins += Number(homeGoals > awayGoals);
    totals.draws += Number(homeGoals === awayGoals);
    totals.awayWins += Number(homeGoals < awayGoals);
    totals.goals += homeGoals + awayGoals;
    totals.homeXg += result.homeStats.xg;
    totals.awayXg += result.awayStats.xg;
    totals.homeShots += result.homeStats.shots;
    totals.awayShots += result.awayStats.shots;
    totals.homePossession += result.homeStats.possession;
    totals.awayPossession += result.awayStats.possession;
    totals.homeFitness += average(
      result.playerStates
        .filter((state) => state.teamId === fixture.homeTeamId)
        .map((state) => state.currentFitness),
    );
    totals.awayFitness += average(
      result.playerStates
        .filter((state) => state.teamId === fixture.awayTeamId)
        .map((state) => state.currentFitness),
    );
  }

  return {
    name: scenario.name,
    outcomes: {
      homeWinPercentage: pct(totals.homeWins, count),
      drawPercentage: pct(totals.draws, count),
      awayWinPercentage: pct(totals.awayWins, count),
    },
    goalsPerMatch: round(totals.goals / count),
    xg: { home: round(totals.homeXg / count), away: round(totals.awayXg / count) },
    shots: { home: round(totals.homeShots / count), away: round(totals.awayShots / count) },
    possession: {
      home: round(totals.homePossession / count),
      away: round(totals.awayPossession / count),
    },
    finalFitness: {
      home: round(totals.homeFitness / count),
      away: round(totals.awayFitness / count),
    },
  };
}

function setup(
  teamId: EntityId,
  players: readonly PlayerAttributeSet[],
  style: TacticalStyleId,
  poorFit: boolean,
): TacticalSetup {
  const formation = FORMATION_PRESETS.find((candidate) => candidate.name === "4-3-3")!;
  const pool = poorFit ? [...players].reverse() : players;
  const tacticalSetup = createTacticalSetup({
    teamId,
    name: `${style} test`,
    formation,
    style,
    assignments: formation.slots.map((slot, index) => ({
      slotId: slot.id,
      playerId: pool[index]?.personId,
      roleId:
        slot.position === "GK"
          ? "SWEEPER_KEEPER"
          : slot.y > 76
            ? "PRESSING_FORWARD"
            : "CENTRAL_MIDFIELDER",
    })),
    bench: pool.slice(11, 18).map((player) => player.personId),
  });
  return {
    ...tacticalSetup,
    instructions: TACTICAL_STYLE_PRESETS[style],
    familiarity: poorFit
      ? { formation: 45, style: 42, roles: 38, instructions: 44 }
      : { formation: 76, style: 74, roles: 72, instructions: 74 },
  };
}

function adjust<
  T extends {
    technical: Record<string, number>;
    mental: Record<string, number>;
    physical: Record<string, number>;
    goalkeeping: Record<string, number>;
  },
>(player: T, ability: number): T {
  const map = (group: Record<string, number>) =>
    Object.fromEntries(Object.keys(group).map((key) => [key, ability]));
  return {
    ...player,
    technical: map(player.technical),
    mental: map(player.mental),
    physical: map(player.physical),
    goalkeeping: map(player.goalkeeping),
  };
}

function pct(value: number, total: number): number {
  return round((value / total) * 100);
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
