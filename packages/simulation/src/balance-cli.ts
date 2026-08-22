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
  const totals = {
    homeWins: 0,
    draws: 0,
    awayWins: 0,
    goals: 0,
    homeGoals: 0,
    awayGoals: 0,
    homeShots: 0,
    awayShots: 0,
    homeShotsOnTarget: 0,
    awayShotsOnTarget: 0,
    homeXg: 0,
    awayXg: 0,
    yellowCards: 0,
    redCards: 0,
    injuries: 0,
    saves: 0,
    goalBuckets: [0, 0, 0, 0, 0, 0],
    scorelines: new Map<string, number>(),
    trackedScorelines: new Map<string, number>(
      ["0-0", "1-0", "0-1", "1-1", "2-0", "0-2", "2-1", "1-2", "2-2"].map((score) => [score, 0]),
    ),
    threeGoalMarginVictories: 0,
  };
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
    const totalGoals = homeGoals + awayGoals;
    const scoreline = `${homeGoals}-${awayGoals}`;
    totals.homeWins += Number(homeGoals > awayGoals);
    totals.draws += Number(homeGoals === awayGoals);
    totals.awayWins += Number(homeGoals < awayGoals);
    totals.goals += totalGoals;
    totals.homeGoals += homeGoals;
    totals.awayGoals += awayGoals;
    totals.homeShots += result.homeStats.shots;
    totals.awayShots += result.awayStats.shots;
    totals.homeShotsOnTarget += result.homeStats.shotsOnTarget;
    totals.awayShotsOnTarget += result.awayStats.shotsOnTarget;
    totals.homeXg += result.homeStats.xg;
    totals.awayXg += result.awayStats.xg;
    totals.yellowCards += result.homeStats.yellowCards + result.awayStats.yellowCards;
    totals.redCards += result.homeStats.redCards + result.awayStats.redCards;
    totals.injuries += result.events.filter((event) => event.type === "INJURY").length;
    totals.saves += result.events.filter((event) => event.type === "SAVE").length;
    totals.goalBuckets[Math.min(5, totalGoals)] += 1;
    totals.scorelines.set(scoreline, (totals.scorelines.get(scoreline) ?? 0) + 1);
    if (totals.trackedScorelines.has(scoreline)) {
      totals.trackedScorelines.set(scoreline, totals.trackedScorelines.get(scoreline)! + 1);
    }
    totals.threeGoalMarginVictories += Number(Math.abs(homeGoals - awayGoals) >= 3);
  }

  return {
    name,
    outcomes: {
      homeWinPercentage: pct(totals.homeWins, count),
      drawPercentage: pct(totals.draws, count),
      awayWinPercentage: pct(totals.awayWins, count),
    },
    goals: {
      goalsPerMatch: round(totals.goals / count),
      homeGoalsPerMatch: round(totals.homeGoals / count),
      awayGoalsPerMatch: round(totals.awayGoals / count),
      distribution: {
        zero: pct(totals.goalBuckets[0], count),
        one: pct(totals.goalBuckets[1], count),
        two: pct(totals.goalBuckets[2], count),
        three: pct(totals.goalBuckets[3], count),
        four: pct(totals.goalBuckets[4], count),
        fivePlus: pct(totals.goalBuckets[5], count),
      },
      trackedScorelines: Object.fromEntries(
        [...totals.trackedScorelines.entries()].map(([scoreline, value]) => [
          scoreline,
          pct(value, count),
        ]),
      ),
      threeGoalMarginVictoryPercentage: pct(totals.threeGoalMarginVictories, count),
      commonScorelines: [...totals.scorelines.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
        .map(([scoreline, value]) => ({ scoreline, percentage: pct(value, count) })),
    },
    diagnostics: {
      shotsPerTeam: {
        home: round(totals.homeShots / count),
        away: round(totals.awayShots / count),
      },
      shotsOnTargetPerTeam: {
        home: round(totals.homeShotsOnTarget / count),
        away: round(totals.awayShotsOnTarget / count),
      },
      xgPerTeam: {
        home: round(totals.homeXg / count),
        away: round(totals.awayXg / count),
      },
      goalsPerTeam: {
        home: round(totals.homeGoals / count),
        away: round(totals.awayGoals / count),
      },
      conversionRate: pct(totals.goals, Math.max(1, totals.homeShots + totals.awayShots)),
      saveRate: pct(totals.saves, Math.max(1, totals.homeShotsOnTarget + totals.awayShotsOnTarget)),
    },
    disciplineAndInjuries: {
      yellowCardsPerMatch: round(totals.yellowCards / count),
      redCardsPerMatch: round(totals.redCards / count),
      injuriesPerMatch: round(totals.injuries / count),
    },
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
