import {
  createEntityId,
  createStableEntityId,
  type CompetitionRuleSet,
  type CompetitionSeason,
  type EntityId,
  type FixtureRecord,
  type HistoricalEvent,
  type MatchResult,
  type PlayerAttributeSet,
} from "@nepal-football-sim/shared-types";
import {
  CompetitionRepository,
  EventRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { generateLeagueFixtures } from "./fixture-generation.js";
import { simulateMatch } from "./match-engine.js";
import {
  calculateStandings,
  completionReport,
  summarizePlayerStats,
  summarizeTeamStats,
  type SeasonReport,
} from "./standings.js";

export type SeasonSimulationInput = {
  competitionSeason: CompetitionSeason;
  ruleSet: CompetitionRuleSet;
  teamIds: readonly EntityId[];
  playersByTeam: ReadonlyMap<EntityId, readonly PlayerAttributeSet[]>;
  seed: string;
};

export type SeasonSimulationResult = {
  fixtures: FixtureRecord[];
  results: MatchResult[];
  report: SeasonReport;
  nextSeason: CompetitionSeason;
};

export const simulateSeason = (input: SeasonSimulationInput): SeasonSimulationResult => {
  const fixtures = generateLeagueFixtures({
    competitionSeasonId: input.competitionSeason.id,
    teamIds: input.teamIds,
    ruleSet: input.ruleSet,
    seed: `${input.seed}:fixtures`,
  });
  const results = fixtures.map((fixture, index) =>
    simulateMatch({
      fixture,
      homePlayers: input.playersByTeam.get(fixture.homeTeamId) ?? [],
      awayPlayers: input.playersByTeam.get(fixture.awayTeamId) ?? [],
      seed: `${input.seed}:match:${index}:${fixture.id}`,
    }),
  );
  const standings = calculateStandings({
    competitionSeasonId: input.competitionSeason.id,
    teamIds: input.teamIds,
    ruleSet: input.ruleSet,
    results,
  });
  const nextSeason = rollSeason(input.competitionSeason, input.ruleSet);
  return {
    fixtures,
    results,
    report: completionReport({
      seasonName: input.competitionSeason.name,
      fixtures,
      results,
      standings,
    }),
    nextSeason,
  };
};

export const persistSeasonSimulation = (
  db: GameDatabase,
  input: SeasonSimulationInput,
  result: SeasonSimulationResult,
): void => {
  const competitions = new CompetitionRepository(db);
  const events = new EventRepository(db);
  for (const fixture of result.fixtures) {
    competitions.insertFixture(fixture);
  }
  for (const matchResult of result.results) {
    competitions.insertMatch(matchResult.match);
    competitions.markFixturePlayed(matchResult.match.fixtureId);
    for (const event of matchResult.events) {
      competitions.insertMatchEvent(event);
    }
  }
  const standings = calculateStandings({
    competitionSeasonId: input.competitionSeason.id,
    teamIds: input.teamIds,
    ruleSet: input.ruleSet,
    results: result.results,
  });
  for (const standing of standings) {
    competitions.upsertStanding(standing);
  }
  for (const stat of summarizeTeamStats(input.competitionSeason.id, standings)) {
    competitions.upsertTeamSeasonStat(stat);
  }
  for (const stat of summarizePlayerStats(input.competitionSeason.id, result.results)) {
    competitions.upsertPlayerSeasonStat(stat);
  }
  const champion = standings[0];
  if (champion) {
    const winnerId = createEntityId();
    competitions.insertWinner({
      id: winnerId,
      competitionSeasonId: input.competitionSeason.id,
      teamId: champion.teamId,
      decidedOn: input.ruleSet.seasonEndDate,
    });
    events.insertHistoricalEvent(
      championHistory(input.competitionSeason, champion.teamId, winnerId),
    );
  }
};

export const rollSeason = (
  season: CompetitionSeason,
  ruleSet: CompetitionRuleSet,
): CompetitionSeason => {
  const nextStart = addYears(ruleSet.seasonStartDate, 1);
  const nextEnd = addYears(ruleSet.seasonEndDate, 1);
  return {
    id: createStableEntityId("competition-season", `${season.competitionId}:${nextStart}`),
    competitionId: season.competitionId,
    name: `${season.name} +1`,
    startDate: nextStart,
    endDate: nextEnd,
  };
};

const championHistory = (
  season: CompetitionSeason,
  teamId: EntityId,
  winnerId: EntityId,
): HistoricalEvent => ({
  id: createEntityId(),
  occurredOn: season.endDate,
  eventType: "COMPETITION_CHAMPION_DECLARED",
  involvedEntities: [
    { type: "competitionSeason", id: season.id },
    { type: "team", id: teamId },
    { type: "match", id: winnerId },
  ],
  title: `Champion declared for ${season.name}`,
  data: { teamId },
  importance: "high",
  scope: "club",
});

const addYears = (date: string, years: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + years);
  return parsed.toISOString().slice(0, 10);
};
