import { describe, expect, it } from "vitest";
import {
  deriveClubCulture,
  evolveClubCulture,
  playerCareerPhase,
  playerClubFit,
  retirementDecision,
} from "@nepal-football-sim/simulation";
import type { ClubBoardPolicy, ClubCulture, EntityId } from "@nepal-football-sim/shared-types";

const policy: ClubBoardPolicy = {
  clubId: "club" as EntityId,
  financialRiskTolerance: "LOW",
  transferPhilosophy: "PLAYER_TRADING",
  youthPriority: 0.8,
  commercialPriority: 0.4,
  infrastructurePriority: 0.5,
  strategicObjective: "YOUTH_DEVELOPMENT",
  updatedAt: "2026-08-01",
  status: "SIMULATION_ONLY",
};

const culture: ClubCulture = {
  clubId: policy.clubId,
  labels: ["YOUTH_DEVELOPMENT", "STABILITY", "COMMUNITY_FOCUSED"],
  seasonStrength: 70,
  updatedOn: "2026-08-01",
  provenanceStatus: "SIMULATION_ONLY",
};

describe("career arcs and club culture", () => {
  it("derives career phases from exposure and trajectory, not age alone", () => {
    expect(
      playerCareerPhase({
        age: 19,
        ability: 8,
        developmentTrend: "IMPROVING",
        minutesLast30Days: 30,
      }),
    ).toBe("EMERGING");
    expect(
      playerCareerPhase({
        age: 22,
        ability: 11,
        developmentTrend: "IMPROVING",
        minutesLast30Days: 240,
        roleStatus: "REGULAR",
      }),
    ).toBe("ESTABLISHED");
    expect(
      playerCareerPhase({
        age: 33,
        ability: 12,
        developmentTrend: "STABLE",
        minutesLast30Days: 300,
        roleStatus: "REGULAR",
      }),
    ).toBe("PRIME");
    expect(
      playerCareerPhase({
        age: 36,
        ability: 12,
        developmentTrend: "STABLE",
        minutesLast30Days: 300,
      }),
    ).toBe("VETERAN");
  });

  it("keeps culture changes gradual and fit explainable", () => {
    const target = deriveClubCulture({
      clubId: policy.clubId,
      date: "2027-08-01",
      policy,
      historicalSuccess: 40,
    });
    const evolved = evolveClubCulture(culture, target, 1);
    expect(evolved.labels).toContain("YOUTH_DEVELOPMENT");
    expect(evolved.seasonStrength).toBeGreaterThanOrEqual(0);
    expect(evolved.seasonStrength).toBeLessThanOrEqual(100);
    expect(
      playerClubFit({
        culture,
        personality: { professionalism: 80, ambition: 50, adaptability: 70 },
        phase: "EMERGING",
        expectedRole: "REGULAR",
      }).rationale.length,
    ).toBeGreaterThan(0);
  });

  it("uses deterministic physical and career signals for retirement", () => {
    expect(
      retirementDecision({
        age: 37,
        physicalDecline: 1,
        recentMajorInjuries: 2,
        appearancesLastSeason: 1,
        reputation: 20,
        contractYearsRemaining: 0,
        ambition: 10,
      }).shouldRetire,
    ).toBe(true);
    expect(
      retirementDecision({
        age: 28,
        physicalDecline: 0,
        recentMajorInjuries: 0,
        appearancesLastSeason: 20,
        reputation: 40,
        contractYearsRemaining: 2,
        ambition: 70,
      }).shouldRetire,
    ).toBe(false);
  });
});
