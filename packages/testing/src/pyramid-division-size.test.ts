import { describe, expect, it } from "vitest";
import { progressPyramidSeason } from "@nepal-football-sim/simulation";
import type {
  ClubMembership,
  CompetitionRelationship,
  CompetitionRuleSet,
  CompetitionSeason,
  EntityId,
  LeagueStanding,
} from "@nepal-football-sim/shared-types";

const upperSeason = {
  id: "upper-2026" as EntityId,
  competitionId: "upper" as EntityId,
  name: "Upper 2026",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
};
const lowerSeason = {
  id: "lower-2026" as EntityId,
  competitionId: "lower" as EntityId,
  name: "Lower 2026",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
};
const nextUpper = { ...upperSeason, id: "upper-2027" as EntityId, name: "Upper 2027" };
const nextLower = { ...lowerSeason, id: "lower-2027" as EntityId, name: "Lower 2027" };

const ruleSet = (seasonId: EntityId, promotionSlots: number, relegationSlots: number) =>
  ({
    id: `${seasonId}-rule` as EntityId,
    competitionSeasonId: seasonId,
    competitionType: "ROUND_ROBIN",
    pointsForWin: 3,
    pointsForDraw: 1,
    pointsForLoss: 0,
    tiebreakers: ["points"],
    numberOfRounds: 1,
    homeAwayStructure: "single",
    seasonStartDate: "2026-01-01",
    seasonEndDate: "2026-12-31",
    roundSpacingDays: 7,
    promotionSlots,
    relegationSlots,
    continentalQualificationSlots: 0,
  }) as CompetitionRuleSet;

const membership = (
  clubId: string,
  competitionId: EntityId,
  competitionSeasonId: EntityId,
): ClubMembership => ({
  id: `${clubId}-${competitionSeasonId}` as EntityId,
  clubId: clubId as EntityId,
  teamId: `${clubId}-team` as EntityId,
  competitionId,
  competitionSeasonId,
  membershipType: "LEAGUE_MEMBER",
  status: "ACTIVE",
});

/** Standings are supplied best-first; points descend so ordering is unambiguous. */
const standings = (seasonId: EntityId, clubIds: readonly string[]): LeagueStanding[] =>
  clubIds.map(
    (clubId, index) =>
      ({
        competitionSeasonId: seasonId,
        teamId: `${clubId}-team` as EntityId,
        played: 10,
        won: clubIds.length - index,
        drawn: 0,
        lost: index,
        goalsFor: 10,
        goalsAgainst: index,
        goalDifference: 10 - index,
        points: (clubIds.length - index) * 3,
      }) as LeagueStanding,
  );

const upperClubs = ["u1", "u2", "u3", "u4"];
const lowerClubs = ["l1", "l2", "l3", "l4"];

const run = (eligibleClubIds: ReadonlySet<EntityId> | undefined) =>
  progressPyramidSeason({
    completedSeasons: [
      {
        season: upperSeason as CompetitionSeason,
        ruleSet: ruleSet(upperSeason.id, 0, 2),
        standings: standings(upperSeason.id, upperClubs),
        memberships: upperClubs.map((club) =>
          membership(club, upperSeason.competitionId, upperSeason.id),
        ),
      },
      {
        season: lowerSeason as CompetitionSeason,
        ruleSet: ruleSet(lowerSeason.id, 2, 0),
        standings: standings(lowerSeason.id, lowerClubs),
        memberships: lowerClubs.map((club) =>
          membership(club, lowerSeason.competitionId, lowerSeason.id),
        ),
      },
    ],
    nextSeasons: new Map([
      [nextUpper.competitionId, nextUpper as CompetitionSeason],
      [nextLower.competitionId, nextLower as CompetitionSeason],
    ]),
    relationships: [
      {
        id: "promotion" as EntityId,
        fromCompetitionId: lowerSeason.competitionId,
        toCompetitionId: upperSeason.competitionId,
        movementType: "PROMOTION",
        numberOfTeams: 2,
        selectionMethod: "TOP_TABLE",
      } as CompetitionRelationship,
      {
        id: "relegation" as EntityId,
        fromCompetitionId: upperSeason.competitionId,
        toCompetitionId: lowerSeason.competitionId,
        movementType: "RELEGATION",
        numberOfTeams: 2,
        selectionMethod: "BOTTOM_TABLE",
      } as CompetitionRelationship,
    ],
    eligibleClubIds,
  });

const clubsIn = (result: ReturnType<typeof run>, seasonId: EntityId): string[] =>
  result.nextMemberships
    .filter((item) => item.competitionSeasonId === seasonId)
    .map((item) => item.clubId as string)
    .sort();

const statusFor = (result: ReturnType<typeof run>, clubId: string): string | undefined =>
  result.movements.find((movement) => movement.clubId === (clubId as EntityId))?.status;

describe("division size reconciliation", () => {
  it("relegates on sporting merit even when the club fails licensing", () => {
    // u4 finishes last and holds no licence; it must still go down.
    const result = run(new Set(["u1", "u2", "u3", "l1", "l2"] as EntityId[]));
    expect(statusFor(result, "u4")).toBe("APPLIED");
    expect(clubsIn(result, nextUpper.id)).not.toContain("u4");
    expect(clubsIn(result, nextLower.id)).toContain("u4");
  });

  it("keeps the division full by reprieving when both promotions fail licensing", () => {
    const result = run(new Set(upperClubs as EntityId[]));
    expect(statusFor(result, "l1")).toBe("INELIGIBLE");
    expect(statusFor(result, "l2")).toBe("INELIGIBLE");
    expect(statusFor(result, "u3")).toBe("REPRIEVED");
    expect(statusFor(result, "u4")).toBe("REPRIEVED");
    expect(clubsIn(result, nextUpper.id)).toEqual(["u1", "u2", "u3", "u4"]);
    expect(clubsIn(result, nextLower.id)).toEqual(["l1", "l2", "l3", "l4"]);
  });

  it("reprieves the best-placed relegation candidate first when one promotion fails", () => {
    const result = run(new Set([...upperClubs, "l1"] as EntityId[]));
    expect(statusFor(result, "l1")).toBe("APPLIED");
    expect(statusFor(result, "l2")).toBe("INELIGIBLE");
    // u3 finished above u4, so u3 stays up and u4 goes down.
    expect(statusFor(result, "u3")).toBe("REPRIEVED");
    expect(statusFor(result, "u4")).toBe("APPLIED");
    expect(clubsIn(result, nextUpper.id)).toEqual(["l1", "u1", "u2", "u3"]);
    expect(clubsIn(result, nextLower.id)).toEqual(["l2", "l3", "l4", "u4"]);
  });

  it("reprieves nobody when every promotion slot is filled", () => {
    const result = run(undefined);
    expect(result.movements.every((movement) => movement.status === "APPLIED")).toBe(true);
    expect(clubsIn(result, nextUpper.id)).toEqual(["l1", "l2", "u1", "u2"]);
    expect(clubsIn(result, nextLower.id)).toEqual(["l3", "l4", "u3", "u4"]);
  });

  it("records no promotion or relegation history for movements that did not happen", () => {
    const result = run(new Set(upperClubs as EntityId[]));
    const relegationEvents = result.historicalEvents.filter(
      (event) => event.eventType === "CLUB_RELEGATED" || event.eventType === "CLUB_PROMOTED",
    );
    expect(relegationEvents).toHaveLength(0);
  });

  it("is deterministic and never places a club in two divisions", () => {
    const first = run(new Set(upperClubs as EntityId[]));
    const second = run(new Set(upperClubs as EntityId[]));
    expect(clubsIn(first, nextUpper.id)).toEqual(clubsIn(second, nextUpper.id));
    expect(clubsIn(first, nextLower.id)).toEqual(clubsIn(second, nextLower.id));
    const upper = new Set(clubsIn(first, nextUpper.id));
    expect(clubsIn(first, nextLower.id).some((club) => upper.has(club))).toBe(false);
  });
});
