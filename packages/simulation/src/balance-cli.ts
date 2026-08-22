import { createDemoLeagueInput } from "./demo-league.js";
import { generateLeagueFixtures } from "./fixture-generation.js";
import { simulateMatch } from "./match-engine.js";

const samples = 1000;
const scenarios = [
  { name: "equal", homeAbility: 12, awayAbility: 12 },
  { name: "strong-vs-weak", homeAbility: 16, awayAbility: 8 },
  { name: "slight-edge", homeAbility: 13, awayAbility: 11 },
].map((scenario) =>
  runScenario(scenario.name, scenario.homeAbility, scenario.awayAbility, samples),
);

console.log(JSON.stringify({ samples, scenarios }, null, 2));

function runScenario(name: string, homeAbility: number, awayAbility: number, count: number) {
  const input = createDemoLeagueInput(`balance:${name}`);
  const fixture = generateLeagueFixtures({
    competitionSeasonId: input.competitionSeason.id,
    teamIds: input.teamIds.slice(0, 2),
    ruleSet: { ...input.ruleSet, homeAwayStructure: "single" },
    seed: `balance:${name}:fixture`,
  })[0]!;
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let goals = 0;
  let xg = 0;
  let cards = 0;
  let injuries = 0;
  const homePlayers = input.playersByTeam
    .get(fixture.homeTeamId)!
    .map((player) => adjust(player, homeAbility));
  const awayPlayers = input.playersByTeam
    .get(fixture.awayTeamId)!
    .map((player) => adjust(player, awayAbility));
  for (let index = 0; index < count; index += 1) {
    const result = simulateMatch({
      fixture,
      homePlayers,
      awayPlayers,
      seed: `balance:${name}:${index}`,
    });
    const homeGoals = result.match.homeGoals ?? 0;
    const awayGoals = result.match.awayGoals ?? 0;
    homeWins += Number(homeGoals > awayGoals);
    draws += Number(homeGoals === awayGoals);
    awayWins += Number(homeGoals < awayGoals);
    goals += homeGoals + awayGoals;
    xg += result.homeStats.xg + result.awayStats.xg;
    cards +=
      result.homeStats.yellowCards +
      result.awayStats.yellowCards +
      result.homeStats.redCards +
      result.awayStats.redCards;
    injuries += result.events.filter((event) => event.type === "INJURY").length;
  }
  return {
    name,
    homeWinPercentage: pct(homeWins, count),
    drawPercentage: pct(draws, count),
    awayWinPercentage: pct(awayWins, count),
    goalsPerMatch: round(goals / count),
    averageXg: round(xg / count),
    averageCards: round(cards / count),
    injuriesPerMatch: round(injuries / count),
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
