import { describe, expect, it } from "vitest";
import {
  FAMILIARITY_CAP,
  FAMILIARITY_FLOOR,
  calculateTacticalModifiers,
  createTacticalSetup,
  familiarityAfterTacticChange,
  progressFamiliarity,
} from "@nepal-football-sim/simulation";
import { FORMATION_PRESETS } from "@nepal-football-sim/simulation";
import type { EntityId, TacticalFamiliarity } from "@nepal-football-sim/shared-types";

const TEAM = "team-1" as EntityId;

const setupOf = (formationName: string, style: Parameters<typeof createTacticalSetup>[0]["style"]) => {
  const formation = FORMATION_PRESETS.find((f) => f.name === formationName)!;
  return {
    ...createTacticalSetup({ teamId: TEAM, name: formationName, formation, style }),
    familiarity: { formation: 90, style: 88, roles: 85, instructions: 86 } as TacticalFamiliarity,
  };
};

describe("familiarityAfterTacticChange — a real switch costs familiarity", () => {
  it("drops formation familiarity sharply when the shape changes, keeps the rest", () => {
    const previous = setupOf("4-3-3", "BALANCED");
    const next = setupOf("3-5-2", "BALANCED");
    const result = familiarityAfterTacticChange(previous, next);
    expect(result.formation).toBeLessThan(previous.familiarity.formation - 20);
    expect(result.formation).toBeGreaterThanOrEqual(FAMILIARITY_FLOOR);
    // style unchanged (still BALANCED preset), roles slot ids identical → untouched
    expect(result.style).toBe(previous.familiarity.style);
  });

  it("drops style familiarity when only the style changes, not formation", () => {
    const previous = setupOf("4-3-3", "BALANCED");
    const next = setupOf("4-3-3", "GEGENPRESS");
    const result = familiarityAfterTacticChange(previous, next);
    expect(result.formation).toBe(previous.familiarity.formation);
    expect(result.style).toBeLessThan(previous.familiarity.style - 10);
    expect(result.instructions).toBeLessThan(previous.familiarity.instructions);
  });

  it("is a no-op when nothing material changed", () => {
    const previous = setupOf("4-3-3", "BALANCED");
    const next = setupOf("4-3-3", "BALANCED");
    expect(familiarityAfterTacticChange(previous, next)).toEqual(previous.familiarity);
  });

  it("never drops below the fundamentals floor even from a low base", () => {
    const previous = {
      ...setupOf("4-3-3", "BALANCED"),
      familiarity: { formation: FAMILIARITY_FLOOR + 1, style: 40, roles: 40, instructions: 40 },
    };
    const next = setupOf("3-4-2-1", "LOW_BLOCK");
    const result = familiarityAfterTacticChange(previous, next);
    for (const value of Object.values(result)) expect(value).toBeGreaterThanOrEqual(FAMILIARITY_FLOOR);
  });
});

describe("progressFamiliarity — time, training and matches raise it; idle drifts", () => {
  const base: TacticalFamiliarity = { formation: 40, style: 40, roles: 40, instructions: 40 };

  it("is deterministic for identical input", () => {
    const input = { days: 14, tacticalTrainingDays: 4, matchesPlayed: 2, managerTacticalKnowledge: 12 };
    expect(progressFamiliarity(base, input)).toEqual(progressFamiliarity(base, input));
  });

  it("raises familiarity over a training window", () => {
    const after = progressFamiliarity(base, {
      days: 14,
      tacticalTrainingDays: 3,
      matchesPlayed: 1,
      managerTacticalKnowledge: 12,
    });
    expect(after.formation).toBeGreaterThan(base.formation);
    expect(after.roles).toBeGreaterThan(base.roles);
  });

  it("dedicated tactical drill days accelerate progression", () => {
    const window = { days: 14, matchesPlayed: 0, managerTacticalKnowledge: 12 };
    const light = progressFamiliarity(base, { ...window, tacticalTrainingDays: 0 });
    const heavy = progressFamiliarity(base, { ...window, tacticalTrainingDays: 8 });
    expect(heavy.formation).toBeGreaterThan(light.formation);
  });

  it("matches contribute on top of training time", () => {
    const window = { days: 7, tacticalTrainingDays: 1, managerTacticalKnowledge: 12 };
    const noMatch = progressFamiliarity(base, { ...window, matchesPlayed: 0 });
    const withMatches = progressFamiliarity(base, { ...window, matchesPlayed: 3 });
    expect(withMatches.formation).toBeGreaterThan(noMatch.formation);
  });

  it("a long idle window drifts toward neutral without ever resetting", () => {
    const high: TacticalFamiliarity = { formation: 95, style: 95, roles: 95, instructions: 95 };
    const after = progressFamiliarity(high, {
      days: 45,
      tacticalTrainingDays: 0,
      matchesPlayed: 0,
    });
    expect(after.formation).toBeLessThan(high.formation);
    expect(after.formation).toBeGreaterThan(50);
  });

  it("stays within [FLOOR, CAP]", () => {
    const maxed = progressFamiliarity(
      { formation: 99, style: 99, roles: 99, instructions: 99 },
      { days: 60, tacticalTrainingDays: 60, matchesPlayed: 12, managerTacticalKnowledge: 20 },
    );
    for (const value of Object.values(maxed)) {
      expect(value).toBeLessThanOrEqual(FAMILIARITY_CAP);
      expect(value).toBeGreaterThanOrEqual(FAMILIARITY_FLOOR);
    }
  });
});

describe("familiarity is a bounded execution modifier in the match engine", () => {
  it("a freshly-switched (low familiarity) setup executes below a drilled one", () => {
    const drilled = setupOf("4-3-3", "POSSESSION");
    const fresh = {
      ...drilled,
      familiarity: { formation: FAMILIARITY_FLOOR, style: FAMILIARITY_FLOOR, roles: FAMILIARITY_FLOOR, instructions: FAMILIARITY_FLOOR },
    };
    const drilledMods = calculateTacticalModifiers({ setup: drilled, averageRoleFit: 75 });
    const freshMods = calculateTacticalModifiers({ setup: fresh, averageRoleFit: 75 });
    expect(freshMods.control).toBeLessThan(drilledMods.control);
    // ...but bounded — never a collapse.
    expect(freshMods.control).toBeGreaterThan(0.8);
  });
});
