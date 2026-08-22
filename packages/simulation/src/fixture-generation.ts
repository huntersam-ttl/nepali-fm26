import {
  createStableEntityId,
  type CompetitionRuleSet,
  type EntityId,
  type FixtureRecord,
} from "@nepal-football-sim/shared-types";
import { SeededRandom } from "./rng.js";

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

export const generateLeagueFixtures = (input: {
  competitionSeasonId: EntityId;
  teamIds: readonly EntityId[];
  ruleSet: CompetitionRuleSet;
  seed: string;
}): FixtureRecord[] => {
  if (input.teamIds.length < 2) {
    return [];
  }
  const rng = new SeededRandom(input.seed);
  const shuffled = [...input.teamIds].sort(() => rng.next() - 0.5);
  const teams = shuffled.length % 2 === 0 ? shuffled : [...shuffled, undefined];
  const rounds: Array<Array<[EntityId, EntityId]>> = [];
  const roundCount = teams.length - 1;
  const half = teams.length / 2;
  let rotating = [...teams];

  for (let round = 0; round < roundCount; round += 1) {
    const pairings: Array<[EntityId, EntityId]> = [];
    for (let index = 0; index < half; index += 1) {
      const left = rotating[index];
      const right = rotating[rotating.length - 1 - index];
      if (left && right) {
        pairings.push(round % 2 === 0 ? [left, right] : [right, left]);
      }
    }
    rounds.push(pairings);
    rotating = [rotating[0], rotating[rotating.length - 1], ...rotating.slice(1, -1)];
  }

  const allRounds =
    input.ruleSet.homeAwayStructure === "double"
      ? [
          ...rounds,
          ...rounds.map((round) =>
            round.map(([home, away]) => [away, home] as [EntityId, EntityId]),
          ),
        ]
      : rounds;

  return allRounds.flatMap((round, roundIndex) =>
    round.map(([homeTeamId, awayTeamId], fixtureIndex) => ({
      id: createStableEntityId(
        "fixture",
        `${input.competitionSeasonId}:${roundIndex + 1}:${fixtureIndex}:${homeTeamId}:${awayTeamId}`,
      ),
      competitionSeasonId: input.competitionSeasonId,
      homeTeamId,
      awayTeamId,
      scheduledDate: addDays(
        input.ruleSet.seasonStartDate,
        roundIndex * input.ruleSet.roundSpacingDays,
      ),
      status: "scheduled",
      round: roundIndex + 1,
    })),
  );
};
