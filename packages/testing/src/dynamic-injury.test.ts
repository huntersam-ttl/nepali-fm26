import { describe, expect, it } from "vitest";
import {
  dynamicInjuryRisk,
  physicalDevelopmentTrend,
  workloadLabel,
} from "@nepal-football-sim/simulation";
import type { PlayerDevelopmentState } from "@nepal-football-sim/shared-types";

const state: PlayerDevelopmentState = {
  id: "development" as PlayerDevelopmentState["id"],
  playerId: "player" as PlayerDevelopmentState["playerId"],
  developmentPhase: "PRIME",
  trainingLoad: 50,
  fatigue: 20,
  matchSharpness: 65,
  fitness: 85,
  recovery: 80,
  developmentMomentum: 20,
  positionFamiliarity: {},
  roleFamiliarity: {},
};

describe("dynamic injury and physical development signals", () => {
  it("raises bounded deterministic risk for workload and prior injuries", () => {
    const normal = dynamicInjuryRisk({
      baseRisk: 0.02,
      age: 24,
      trainingIntensity: 40,
      minutesLast30Days: 180,
    });
    const overloaded = dynamicInjuryRisk({
      baseRisk: 0.02,
      age: 34,
      trainingIntensity: 95,
      minutesLast30Days: 540,
      priorInjuriesLastYear: 3,
      physicalCondition: 50,
      recovery: 45,
    });
    expect(overloaded.risk).toBeGreaterThan(normal.risk);
    expect(overloaded.risk).toBeLessThanOrEqual(0.35);
    expect(overloaded.recurrenceRisk).toBeLessThanOrEqual(0.8);
    expect(overloaded.workload).toBe("VERY_HIGH");
  });

  it("keeps workload labels and development trends deterministic", () => {
    expect(workloadLabel(20)).toBe("LOW");
    expect(workloadLabel(50)).toBe("OPTIMAL");
    expect(workloadLabel(90)).toBe("VERY_HIGH");
    expect(
      physicalDevelopmentTrend({ age: 20, state, trainingQuality: 1.2, professionalism: 1.1 }),
    ).toBe("IMPROVING");
    expect(
      physicalDevelopmentTrend({
        age: 36,
        state: { ...state, developmentMomentum: -20 },
        trainingQuality: 0.8,
        professionalism: 0.7,
        majorOrRecurringInjuries: 2,
      }),
    ).toBe("DECLINING");
  });
});
