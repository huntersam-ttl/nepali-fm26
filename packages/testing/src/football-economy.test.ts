import { describe, expect, it } from "vitest";
import {
  broadcastDistribution,
  evaluateCompetitionBroadcastValue,
  evaluateHostingBid,
  footballEconomySummary,
  hostingStatusAfterDecision,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const clubs = ["a", "b", "c"].map((id) => id as EntityId);

describe("hosting and football economy", () => {
  it("evaluates hosting deterministically with bounded readiness factors", () => {
    const input = {
      readiness: 80,
      fundingPlan: 70,
      governmentSupport: 60,
      federationContribution: 55,
      projectedBenefit: 65,
      nationalDevelopment: 50,
      reputation: 45,
      organisationalCapacity: 60,
    };
    expect(evaluateHostingBid(input)).toEqual(evaluateHostingBid(input));
    expect(evaluateHostingBid(input).score).toBeGreaterThanOrEqual(0);
    expect(evaluateHostingBid(input).score).toBeLessThanOrEqual(100);
  });

  it("values broadcast appeal without runaway growth", () => {
    const value = evaluateCompetitionBroadcastValue({
      competitionReputation: 70,
      attendance: 80000,
      mediaInterest: 60,
      clubReputation: 55,
      nationalDevelopment: 50,
      competitiveness: 65,
      broadcasterStrength: 70,
    });
    expect(value).toBeLessThanOrEqual(4_200_000);
    expect(value).toBeGreaterThan(25_000);
  });

  it("keeps hosting decisions terminal and idempotent", () => {
    expect(hostingStatusAfterDecision("SUBMITTED", "WON")).toBe("WON");
    expect(hostingStatusAfterDecision("WON", "COMPLETED")).toBe("COMPLETED");
    expect(hostingStatusAfterDecision("LOST", "WON")).toBe("LOST");
  });

  it.each(["EQUAL_SHARE", "MERIT_SHARE", "MIXED_EQUAL_MERIT"] as const)(
    "distributes rights through transparent %s shares",
    (model) => {
      const distribution = broadcastDistribution({
        total: 900,
        clubIds: clubs,
        model,
        meritOrder: clubs,
      });
      expect(Object.keys(distribution)).toHaveLength(3);
      expect(Object.values(distribution).reduce((sum, amount) => sum + amount, 0)).toBe(900);
    },
  );

  it("derives a broad economic trend from real indicators", () => {
    expect(
      footballEconomySummary({
        federationId: "federation" as EntityId,
        revenueTrend: 80,
        attendanceTrend: 70,
        sponsorshipTrend: 75,
        wagePressure: 30,
        transferActivity: 60,
        infrastructureSpend: 65,
        competitionReputationTrend: "RISING",
        asOf: "2028-06-01",
      }).trend,
    ).toBe("GROWING");
    expect(
      footballEconomySummary({
        federationId: "federation" as EntityId,
        revenueTrend: 30,
        attendanceTrend: 30,
        sponsorshipTrend: 30,
        wagePressure: 85,
        transferActivity: 20,
        infrastructureSpend: 10,
        competitionReputationTrend: "FALLING",
        asOf: "2028-06-01",
      }).trend,
    ).toBe("STRESSED");
  });
});
