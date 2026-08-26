import {
  createStableEntityId,
  type CompetitionRuleSet,
  type EntityId,
  type FixtureRecord,
  type HistoricalEvent,
  type ISODate,
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

export type FixturePostponementReason =
  | "venue_unavailable"
  | "shared_ground_conflict"
  | "weather_disruption"
  | "competition_clash"
  | "exceptional_scheduling_conflict";

export type FixtureRescheduleResult = {
  fixture: FixtureRecord;
  history: HistoricalEvent;
  compressed: boolean;
};

const dateDistance = (left: ISODate, right: ISODate): number =>
  Math.round((Date.parse(left) - Date.parse(right)) / 86400000);

const dateAt = (date: ISODate, days: number): ISODate => addDays(date, days);

/**
 * Picks a bounded date for a postponed fixture. Existing fixtures are treated
 * as facts: no date is invented outside the competition window and a team's
 * venue/tie context is carried unchanged. The final pass permits compressed
 * rest only when the window has no normal solution.
 */
export const rescheduleFixture = (input: {
  fixture: FixtureRecord;
  existingFixtures: readonly FixtureRecord[];
  reason: FixturePostponementReason;
  windowStart: ISODate;
  windowEnd: ISODate;
  minimumRestDays?: number;
  blockedDates?: readonly ISODate[];
  internationalWindowDates?: readonly ISODate[];
  maxSearchDays?: number;
  rescheduledOn?: ISODate;
}): FixtureRescheduleResult | undefined => {
  const minimumRestDays = Math.max(0, input.minimumRestDays ?? 3);
  const blocked = new Set([...(input.blockedDates ?? []), ...(input.internationalWindowDates ?? [])]);
  const peers = input.existingFixtures.filter((item) => item.id !== input.fixture.id);
  const teams = new Set([input.fixture.homeTeamId, input.fixture.awayTeamId]);
  const venue = input.fixture.venueId;
  const maxSearchDays = Math.max(1, input.maxSearchDays ?? 370);
  const candidates: ISODate[] = [];
  const startOffset = Math.max(0, dateDistance(input.fixture.scheduledDate, input.windowStart) + 1);
  for (let offset = startOffset; offset <= maxSearchDays; offset += 1) {
    const candidate = dateAt(input.windowStart, offset);
    if (candidate > input.windowEnd) break;
    candidates.push(candidate);
  }
  const isAvailable = (candidate: ISODate, enforceRest: boolean): boolean => {
    if (blocked.has(candidate)) return false;
    const sameDay = peers.filter((item) => item.scheduledDate === candidate);
    if (sameDay.some((item) => teams.has(item.homeTeamId) || teams.has(item.awayTeamId))) return false;
    if (venue && sameDay.some((item) => item.venueId === venue)) return false;
    if (!enforceRest) return true;
    return peers.every((item) => {
      if (!teams.has(item.homeTeamId) && !teams.has(item.awayTeamId)) return true;
      return Math.abs(dateDistance(candidate, item.scheduledDate)) >= minimumRestDays;
    });
  };
  const scheduledDate = candidates.find((candidate) => isAvailable(candidate, true)) ?? candidates.find((candidate) => isAvailable(candidate, false));
  if (!scheduledDate) return undefined;
  const compressed = !isAvailable(scheduledDate, true);
  const fixture: FixtureRecord = { ...input.fixture, scheduledDate, status: "postponed" };
  const history: HistoricalEvent = {
    id: createStableEntityId("fixture-reschedule", `${fixture.id}:${scheduledDate}:${input.reason}`),
    occurredOn: input.rescheduledOn ?? scheduledDate,
    eventType: "fixture_rescheduled",
    involvedEntities: [{ id: fixture.id, type: "fixture" }],
    title: "Fixture rescheduled",
    data: { reason: input.reason, previousDate: input.fixture.scheduledDate, scheduledDate, compressed, tieId: fixture.tieId, leg: fixture.leg },
    importance: "medium",
    scope: "club",
  };
  return { fixture, history, compressed };
};
