import { describe, expect, it } from "vitest";
import {
  decideSupporterPolitics,
  initialSupporterCultureProfile,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const profile = initialSupporterCultureProfile({
  clubId: "club-supporters" as EntityId,
  gender: "men",
  tier: 1,
  date: "2026-08-01",
  seed: "supporter-politics",
  populationContext: 50,
  historicStature: 50,
});

describe("supporter politics", () => {
  it("does not trigger a protest after one loss", () => {
    const decision = decideSupporterPolitics(profile, {
      performanceVsExpectation: -40,
      sustainedIssueDays: 0,
      daysSinceLastProtest: 0,
    });
    expect(decision.protestTriggered).toBe(false);
  });

  it("requires sustained issues and a cooldown before protest", () => {
    const input = {
      performanceVsExpectation: -40,
      attendanceContext: 0,
      managerConfidence: 0,
      ownershipChange: -40,
      transferPolicyAlignment: 0,
      youthVisionAlignment: 0,
      facilitiesChange: 0,
      financialInstability: true,
      repeatedBrokenPromises: 2,
      sustainedIssueDays: 35,
    } as const;
    expect(
      decideSupporterPolitics(profile, { ...input, daysSinceLastProtest: 0 }).protestTriggered,
    ).toBe(false);
    expect(
      decideSupporterPolitics(profile, { ...input, daysSinceLastProtest: 30 }).protestTriggered,
    ).toBe(true);
  });

  it("keeps pressure effects bounded and allows recovery", () => {
    const protest = decideSupporterPolitics(profile, {
      performanceVsExpectation: -40,
      attendanceContext: 0,
      managerConfidence: 0,
      ownershipChange: -40,
      transferPolicyAlignment: 0,
      youthVisionAlignment: 0,
      facilitiesChange: 0,
      sustainedIssueDays: 35,
      daysSinceLastProtest: 30,
    });
    const recovered = decideSupporterPolitics(
      { ...profile, unrest: "PROTESTING" },
      {
        performanceVsExpectation: 30,
        attendanceContext: 80,
        managerConfidence: 80,
        ownershipChange: 20,
        transferPolicyAlignment: 80,
        youthVisionAlignment: 80,
        facilitiesChange: 80,
      },
    );
    expect(protest.attendanceModifier).toBeGreaterThanOrEqual(-0.12);
    expect(protest.attendanceModifier).toBeLessThanOrEqual(0.04);
    expect(recovered.reaction).toBe("SUPPORTIVE");
  });
});
