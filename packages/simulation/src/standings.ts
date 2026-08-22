import type {
  CompetitionRuleSet,
  EntityId,
  FixtureRecord,
  LeagueStanding,
  MatchResult,
  PlayerSeasonStat,
  TableTiebreaker,
  TeamSeasonStat,
} from "@nepal-football-sim/shared-types";

export const calculateStandings = (input: {
  competitionSeasonId: EntityId;
  teamIds: readonly EntityId[];
  ruleSet: CompetitionRuleSet;
  results: readonly MatchResult[];
}): LeagueStanding[] => {
  const table = new Map<EntityId, LeagueStanding>(
    input.teamIds.map((teamId) => [
      teamId,
      {
        competitionSeasonId: input.competitionSeasonId,
        teamId,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
      },
    ]),
  );

  for (const result of input.results) {
    const home = table.get(result.homeStats.teamId)!;
    const away = table.get(result.awayStats.teamId)!;
    applyResult(home, result.match.homeGoals ?? 0, result.match.awayGoals ?? 0, input.ruleSet);
    applyResult(away, result.match.awayGoals ?? 0, result.match.homeGoals ?? 0, input.ruleSet);
  }

  return sortStandings([...table.values()], input.ruleSet.tiebreakers);
};

export const sortStandings = (
  standings: readonly LeagueStanding[],
  tiebreakers: readonly TableTiebreaker[],
): LeagueStanding[] =>
  [...standings].sort((a, b) => {
    for (const breaker of tiebreakers) {
      const difference = compareBreaker(a, b, breaker);
      if (difference !== 0) {
        return difference;
      }
    }
    return String(a.teamId).localeCompare(String(b.teamId));
  });

export const summarizeTeamStats = (
  competitionSeasonId: EntityId,
  standings: readonly LeagueStanding[],
): TeamSeasonStat[] =>
  standings.map((standing) => ({
    competitionSeasonId,
    teamId: standing.teamId,
    played: standing.played,
    wins: standing.won,
    draws: standing.drawn,
    losses: standing.lost,
    goalsFor: standing.goalsFor,
    goalsAgainst: standing.goalsAgainst,
    cleanSheets: 0,
  }));

export const summarizePlayerStats = (
  competitionSeasonId: EntityId,
  results: readonly MatchResult[],
): PlayerSeasonStat[] => {
  const totals = new Map<string, PlayerSeasonStat & { ratingTotal: number }>();
  for (const result of results) {
    for (const state of result.playerStates) {
      const key = `${state.personId}:${state.teamId}`;
      const current =
        totals.get(key) ??
        ({
          competitionSeasonId,
          personId: state.personId,
          teamId: state.teamId,
          appearances: 0,
          starts: 0,
          minutes: 0,
          goals: 0,
          assists: 0,
          yellowCards: 0,
          redCards: 0,
          averageRating: 0,
          cleanSheets: 0,
          ratingTotal: 0,
        } satisfies PlayerSeasonStat & { ratingTotal: number });
      current.appearances += 1;
      current.starts += 1;
      current.minutes += state.minutesPlayed;
      current.goals += state.goals;
      current.assists += state.assists;
      current.yellowCards += state.yellowCards;
      current.redCards += Number(state.redCard);
      current.ratingTotal += state.rating;
      if (state.position === "GK") {
        const teamGoalsAgainst =
          result.homeStats.teamId === state.teamId
            ? (result.match.awayGoals ?? 0)
            : (result.match.homeGoals ?? 0);
        current.cleanSheets += teamGoalsAgainst === 0 ? 1 : 0;
      }
      totals.set(key, current);
    }
  }

  return [...totals.values()].map(({ ratingTotal, ...stat }) => ({
    ...stat,
    averageRating: Math.round((ratingTotal / Math.max(1, stat.appearances)) * 100) / 100,
  }));
};

export const completionReport = (input: {
  seasonName: string;
  fixtures: readonly FixtureRecord[];
  results: readonly MatchResult[];
  standings: readonly LeagueStanding[];
}): SeasonReport => {
  const champion = input.standings[0]?.teamId;
  const runnerUp = input.standings[1]?.teamId;
  const bottomTeams = input.standings.slice(-2).map((standing) => standing.teamId);
  const goals = input.results.reduce(
    (total, result) => total + (result.match.homeGoals ?? 0) + (result.match.awayGoals ?? 0),
    0,
  );
  const homeWins = input.results.filter(
    (result) => (result.match.homeGoals ?? 0) > (result.match.awayGoals ?? 0),
  ).length;
  const draws = input.results.filter(
    (result) => result.match.homeGoals === result.match.awayGoals,
  ).length;
  const totalXg = input.results.reduce(
    (total, result) => total + result.homeStats.xg + result.awayStats.xg,
    0,
  );
  const cards = input.results.reduce(
    (total, result) =>
      total +
      result.homeStats.yellowCards +
      result.awayStats.yellowCards +
      result.homeStats.redCards +
      result.awayStats.redCards,
    0,
  );
  return {
    season: input.seasonName,
    champion,
    runnerUp,
    bottomTeams,
    matchesPlayed: input.results.length,
    goals,
    goalsPerMatch: round(goals / Math.max(1, input.results.length)),
    homeWinPercentage: round((homeWins / Math.max(1, input.results.length)) * 100),
    drawPercentage: round((draws / Math.max(1, input.results.length)) * 100),
    awayWinPercentage: round(
      ((input.results.length - homeWins - draws) / Math.max(1, input.results.length)) * 100,
    ),
    averageCards: round(cards / Math.max(1, input.results.length)),
    averageXg: round(totalXg / Math.max(1, input.results.length)),
  };
};

export type SeasonReport = {
  season: string;
  champion?: EntityId;
  runnerUp?: EntityId;
  bottomTeams: EntityId[];
  matchesPlayed: number;
  goals: number;
  goalsPerMatch: number;
  homeWinPercentage: number;
  drawPercentage: number;
  awayWinPercentage: number;
  averageCards: number;
  averageXg: number;
};

const applyResult = (
  standing: LeagueStanding,
  goalsFor: number,
  goalsAgainst: number,
  ruleSet: CompetitionRuleSet,
): void => {
  standing.played += 1;
  standing.goalsFor += goalsFor;
  standing.goalsAgainst += goalsAgainst;
  standing.goalDifference = standing.goalsFor - standing.goalsAgainst;
  if (goalsFor > goalsAgainst) {
    standing.won += 1;
    standing.points += ruleSet.pointsForWin;
  } else if (goalsFor === goalsAgainst) {
    standing.drawn += 1;
    standing.points += ruleSet.pointsForDraw;
  } else {
    standing.lost += 1;
    standing.points += ruleSet.pointsForLoss;
  }
};

const compareBreaker = (a: LeagueStanding, b: LeagueStanding, breaker: TableTiebreaker): number => {
  switch (breaker) {
    case "points":
      return b.points - a.points;
    case "goalDifference":
    case "headToHeadGoalDifference":
      return b.goalDifference - a.goalDifference;
    case "goalsScored":
    case "headToHeadGoals":
      return b.goalsFor - a.goalsFor;
    case "wins":
    case "headToHeadPoints":
      return b.won - a.won;
    case "fairPlay":
    case "playoff":
      return 0;
  }
};

const round = (value: number): number => Math.round(value * 100) / 100;
