import { describe, expect, it } from "vitest";
import {
  calculateTacticalModifiers,
  createTacticalSetup,
  prepareTacticalSetup,
} from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

describe("tactical preparation", () => {
  it("advances persisted familiarity deterministically without changing the setup identity", () => {
    const setup = createTacticalSetup({
      teamId: createStableEntityId("team", "prep"),
      name: "Match plan",
    });
    const input = {
      setup,
      preparedOn: "2026-08-14",
      daysAvailable: 7,
      trainingQuality: 80,
      managerQuality: 75,
      averageRoleFit: 78,
      oppositionKnowledge: 65,
    };
    const first = prepareTacticalSetup(input);
    const second = prepareTacticalSetup(input);
    expect(first).toEqual(second);
    expect(first.setup.id).toBe(setup.id);
    expect(first.setup.updatedOn).toBe("2026-08-14");
    expect(first.setup.familiarity.formation).toBeGreaterThan(setup.familiarity.formation);
    expect(first.gains.instructions).toBeGreaterThan(0);
  });

  it("feeds the prepared familiarity into the existing match modifiers", () => {
    const setup = createTacticalSetup({
      teamId: createStableEntityId("team", "prep"),
      name: "Match plan",
    });
    const prepared = prepareTacticalSetup({
      setup,
      preparedOn: "2026-08-14",
      daysAvailable: 14,
      trainingQuality: 90,
      managerQuality: 85,
      averageRoleFit: 82,
      oppositionKnowledge: 80,
    }).setup;
    const before = calculateTacticalModifiers({ setup });
    const after = calculateTacticalModifiers({ setup: prepared });
    expect(after.control).toBeGreaterThan(before.control);
  });
});
