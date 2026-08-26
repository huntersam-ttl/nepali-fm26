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

export const generateKnockoutFixtures = (input: { competitionSeasonId: EntityId; teamIds: readonly EntityId[]; ruleSet: CompetitionRuleSet; seed: string; twoLegged?: boolean }): FixtureRecord[] => {
  if (input.teamIds.length < 2) return [];
  const rng = new SeededRandom(input.seed); const teams = [...input.teamIds].sort((a, b) => String(a).localeCompare(String(b))).sort(() => rng.next() - 0.5); const fixtures: FixtureRecord[] = []; const twoLegged = input.twoLegged ?? false;
  for (let index = 0; index + 1 < teams.length; index += 2) {
    const home = teams[index]!; const away = teams[index + 1]!; const tieId = createStableEntityId("fixture-tie", `${input.competitionSeasonId}:${Math.floor(index / 2)}:${home}:${away}`);
    fixtures.push({ id:createStableEntityId("fixture", `${input.competitionSeasonId}:knockout:${index}:1:${home}:${away}`), competitionSeasonId:input.competitionSeasonId, homeTeamId:home, awayTeamId:away, scheduledDate:addDays(input.ruleSet.seasonStartDate, Math.floor(index / 2) * input.ruleSet.roundSpacingDays), status:"scheduled", round:1, tieId, leg:1 });
    if (twoLegged) fixtures.push({ id:createStableEntityId("fixture", `${input.competitionSeasonId}:knockout:${index}:2:${away}:${home}`), competitionSeasonId:input.competitionSeasonId, homeTeamId:away, awayTeamId:home, scheduledDate:addDays(input.ruleSet.seasonStartDate, Math.floor(index / 2) * input.ruleSet.roundSpacingDays + Math.max(7, input.ruleSet.roundSpacingDays)), status:"scheduled", round:1, tieId, leg:2 });
  }
  return fixtures;
};

export const fixtureCongestion = (fixtures: readonly FixtureRecord[], minimumRestDays = 3): { teamId: EntityId; fixtureIds: EntityId[] }[] => { const byTeam = new Map<EntityId, FixtureRecord[]>(); for (const fixture of fixtures) for (const team of [fixture.homeTeamId, fixture.awayTeamId]) byTeam.set(team, [...(byTeam.get(team) ?? []), fixture]); const result: { teamId: EntityId; fixtureIds: EntityId[] }[] = []; for (const [teamId, items] of byTeam) { const sorted = [...items].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)); const conflicts = sorted.filter((item, index) => index > 0 && (Date.parse(item.scheduledDate) - Date.parse(sorted[index - 1]!.scheduledDate)) / 86400000 < minimumRestDays).map((item) => item.id); if (conflicts.length) result.push({ teamId, fixtureIds: conflicts }); } return result; };
