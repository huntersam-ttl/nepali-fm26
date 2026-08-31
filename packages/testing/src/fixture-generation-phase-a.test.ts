import { describe, expect, it } from "vitest";
import { fixtureCongestion, generateKnockoutFixtures, generateLeagueFixtures, rescheduleFixture } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";
const id = (value: string) => value as EntityId;
const ruleSet = { id:id("rule"), competitionSeasonId:id("season"), competitionType:"CUP", pointsForWin:3, pointsForDraw:1, pointsForLoss:0, tiebreakers:[] as never[], numberOfRounds:1, homeAwayStructure:"single", seasonStartDate:"2027-08-01", seasonEndDate:"2028-05-01", roundSpacingDays:14, promotionSlots:0, relegationSlots:0, continentalQualificationSlots:0 } as const;
describe("fixture generation phase A", () => { it("creates deterministic paired two-leg ties and detects congestion", () => { const first=generateKnockoutFixtures({competitionSeasonId:id("season"),teamIds:[id("a"),id("b"),id("c"),id("d")],ruleSet,seed:"fixed",twoLegged:true}); const second=generateKnockoutFixtures({competitionSeasonId:id("season"),teamIds:[id("a"),id("b"),id("c"),id("d")],ruleSet,seed:"fixed",twoLegged:true}); expect(first).toEqual(second); expect(first).toHaveLength(4); expect(new Set(first.map((item)=>item.id)).size).toBe(4); expect(first.filter((item)=>item.tieId===first[0]?.tieId).map((item)=>item.leg)).toEqual([1,2]); expect(fixtureCongestion(first,3).length).toBe(0); }); it("reschedules deterministically around overlap and preserves tie context", () => { const [fixture, blocker] = generateKnockoutFixtures({competitionSeasonId:id("season"),teamIds:[id("a"),id("b")],ruleSet,seed:"fixed",twoLegged:true}); const result=rescheduleFixture({fixture,existingFixtures:[fixture,blocker],reason:"shared_ground_conflict",windowStart:"2027-08-01",windowEnd:"2027-08-31",blockedDates:["2027-08-02"]}); expect(result?.fixture.scheduledDate).toBe("2027-08-03"); expect(result?.fixture.tieId).toBe(fixture.tieId); expect(result?.fixture.leg).toBe(fixture.leg); expect(result?.history.data).toMatchObject({reason:"shared_ground_conflict",previousDate:fixture.scheduledDate}); }); });

describe("double round-robin integrity", () => {
  it.each([14, 12, 10])("derives %i teams at 2 × (N - 1) matches per club", (teamCount) => {
    const teams = Array.from({ length: teamCount }, (_, index) => id(`team-${index + 1}`));
    const fixtures = generateLeagueFixtures({
      competitionSeasonId: id(`season-${teamCount}`),
      teamIds: teams,
      ruleSet: { ...ruleSet, homeAwayStructure: "double" },
      seed: "round-robin-integrity",
    });
    expect(fixtures).toHaveLength((teamCount * 2 * (teamCount - 1)) / 2);
    expect(new Set(fixtures.map((fixture) => fixture.id)).size).toBe(fixtures.length);
    expect(fixtures.every((fixture) => fixture.homeTeamId !== fixture.awayTeamId)).toBe(true);
    for (const team of teams) {
      const home = fixtures.filter((fixture) => fixture.homeTeamId === team);
      const away = fixtures.filter((fixture) => fixture.awayTeamId === team);
      expect(home.length + away.length).toBe(2 * (teamCount - 1));
      expect(home.length).toBe(teamCount - 1);
      expect(away.length).toBe(teamCount - 1);
    }
    for (let left = 0; left < teams.length; left += 1) {
      for (let right = left + 1; right < teams.length; right += 1) {
        const pair = fixtures.filter((fixture) => new Set([fixture.homeTeamId, fixture.awayTeamId]).size === 2 && fixture.homeTeamId !== fixture.awayTeamId && [fixture.homeTeamId, fixture.awayTeamId].includes(teams[left]!) && [fixture.homeTeamId, fixture.awayTeamId].includes(teams[right]!));
        expect(pair).toHaveLength(2);
        expect(pair.some((fixture) => fixture.homeTeamId === teams[left] && fixture.awayTeamId === teams[right])).toBe(true);
        expect(pair.some((fixture) => fixture.homeTeamId === teams[right] && fixture.awayTeamId === teams[left])).toBe(true);
      }
    }
  });
});
