import { describe, expect, it } from "vitest";
import {
  generateLeagueFixtures,
  prioritizeInfrastructure,
  reformCanApplyAtBoundary,
  validateLeagueFixtures,
} from "@nepal-football-sim/simulation";
import type { CompetitionRuleSet, EntityId } from "@nepal-football-sim/shared-types";

const teams = ["a", "b", "c", "d"].map((id) => id as EntityId);
const ruleSet: CompetitionRuleSet = {
  id: "rules" as EntityId,
  competitionSeasonId: "season" as EntityId,
  competitionType: "ROUND_ROBIN",
  pointsForWin: 3,
  pointsForDraw: 1,
  pointsForLoss: 0,
  tiebreakers: ["points"],
  numberOfRounds: 2,
  homeAwayStructure: "double",
  seasonStartDate: "2027-08-01",
  seasonEndDate: "2028-05-31",
  roundSpacingDays: 7,
  promotionSlots: 0,
  relegationSlots: 0,
  continentalQualificationSlots: 0,
};

describe("federation restructuring and strategy", () => {
  it("validates dynamic double round-robin fixtures", () => {
    const fixtures = generateLeagueFixtures({
      competitionSeasonId: ruleSet.competitionSeasonId,
      teamIds: teams,
      ruleSet,
      seed: "strategy",
    });
    expect(validateLeagueFixtures({ teamIds: teams, fixtures, ruleSet })).toMatchObject({
      valid: true,
      expectedMatches: 12,
      actualMatches: 12,
      missingPairings: 0,
    });
  });

  it("gates reform application to a future season boundary", () => {
    expect(
      reformCanApplyAtBoundary({
        effectiveSeason: "2028",
        currentDate: "2027-09-01",
        activeSeasonStart: "2027-08-01",
        activeSeasonEnd: "2028-05-31",
      }),
    ).toBe(false);
    expect(
      reformCanApplyAtBoundary({
        effectiveSeason: "2028",
        currentDate: "2028-06-01",
        activeSeasonStart: "2027-08-01",
        activeSeasonEnd: "2028-05-31",
      }),
    ).toBe(true);
  });

  it("balances infrastructure need with potential and funding path", () => {
    const priority = prioritizeInfrastructure({
      projectType: "REGIONAL_CENTRE",
      districtId: "district" as EntityId,
      regionalNeed: 85,
      facilitiesQuality: 20,
      youthPotential: 70,
      hotspotLabel: "DEVELOPING",
      nationalGap: 40,
      federationFunds: 20,
      governmentSupport: 75,
    });
    expect(priority.priorityLabel).toBe("URGENT");
    expect(priority.fundingPath).toBe("JOINT_FUNDING");
    expect(priority.rationale.length).toBeGreaterThan(0);
  });
});
