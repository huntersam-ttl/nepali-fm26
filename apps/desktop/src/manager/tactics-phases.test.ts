import { describe, expect, it } from "vitest";
import {
  TACTICAL_MODES,
  changeRole,
  currentRoleId,
  IN_POSSESSION_GROUPS,
  legalDuties,
  legalRolesForSlot,
  updatePhase,
} from "./tactics.js";
import type { TacticalSetup } from "@nepal-football-sim/shared-types";

const instructions = {
  mentality: "BALANCED",
  inPossession: {
    tempo: 50, passingLength: 50, width: 50, buildUpRisk: 40,
    playFromBack: false, workBallIntoBox: false, earlyCrosses: false,
    focusMiddle: false, focusLeft: false, focusRight: true,
    overlapLeft: false, overlapRight: false, underlapLeft: false, underlapRight: false,
  },
  transition: {
    counterPress: false, regroup: false, counter: false, holdShape: false,
    goalkeeperDistributionStyle: "SHORT",
  },
  outOfPossession: {
    pressingIntensity: 50, defensiveLine: 50, engagementLine: 50, tacklingIntensity: 50,
    pressGoalkeeper: false, stopShortDistribution: false, forceInside: false, forceOutside: false,
  },
} as unknown as TacticalSetup["instructions"];

const mkSetup = (): TacticalSetup =>
  ({
    id: "t1",
    teamId: "team1",
    name: "Default",
    formation: { id: "4-4-2", slots: [{ id: "gk", label: "GK", x: 50, y: 6, zone: "goalkeeper" }] },
    style: "BALANCED",
    instructions,
    assignments: [
      { slotId: "gk", playerId: "p1", roleId: "goalkeeper-defend", duty: "SUPPORT" },
      { slotId: "rb", playerId: "p2", roleId: "centre-back", duty: "DEFEND" },
    ],
    bench: [],
  }) as unknown as TacticalSetup;

const roles: Array<{ id: string; name: string; family: string; zones: string[] }> = [
  { id: "goalkeeper-defend", name: "Goalkeeper (Defend)", family: "GK", zones: ["goalkeeper"] },
  { id: "centre-back", name: "Centre-back", family: "Defender", zones: ["defender"] },
  { id: "half-back", name: "Half-back", family: "Defender", zones: [] },
];

describe("roles", () => {
  it("1/4. filters valid role options by slot zone and excludes invalid ones", () => {
    const gk = legalRolesForSlot("goalkeeper", roles);
    expect(gk.map((r) => r.id)).toEqual(["goalkeeper-defend", "half-back"]);
    // A goalkeeper-only role must be absent for a striker slot.
    const striker = legalRolesForSlot("attacker", roles);
    expect(striker.map((r) => r.id)).not.toContain("goalkeeper-defend");
  });

  it("2. derives the current role for a slot", () => {
    expect(currentRoleId(mkSetup(), "gk")).toBe("goalkeeper-defend");
  });

  it("3. role change is a canonical assignment mutation touching only that slot", () => {
    const next = changeRole(mkSetup(), "gk", "centre-back");
    const map = new Map(next.assignments.map((a) => [a.slotId, a.roleId]));
    expect(map.get("gk")).toBe("centre-back");
    expect(map.get("rb")).toBe("centre-back"); // untouched
  });

  it("5. assignments carry no hidden ability data", () => {
    const json = JSON.stringify(mkSetup().assignments);
    expect(json).not.toMatch(/potential|currentAbility|hidden/i);
  });
});

describe("duties", () => {
  it("6/7. honors a role's allowedDuties and defaults to all three otherwise", () => {
    expect(legalDuties({ allowedDuties: ["DEFEND", "SUPPORT"] })).toEqual(["DEFEND", "SUPPORT"]);
    expect(legalDuties({})).toEqual(["DEFEND", "SUPPORT", "ATTACK"]);
  });
});

describe("phase instructions", () => {
  it("8. in-possession groups map to real canonical keys", () => {
    const real = new Set(Object.keys(instructions.inPossession));
    for (const group of IN_POSSESSION_GROUPS) {
      for (const key of group.keys) expect(real.has(key)).toBe(true);
    }
    const covered = new Set(IN_POSSESSION_GROUPS.flatMap((g) => g.keys));
    expect([...real].sort()).toEqual([...covered].sort());
  });

  it("9/10. in-possession update touches only that phase", () => {
    const next = updatePhase(instructions, "inPossession", { tempo: 70, focusMiddle: true });
    expect(next.inPossession.tempo).toBe(70);
    expect(next.inPossession.focusMiddle).toBe(true);
    expect(next.inPossession.focusRight).toBe(true); // unrelated field preserved
    expect(next.transition.goalkeeperDistributionStyle).toBe("SHORT"); // other phase preserved
    expect(next.outOfPossession.pressingIntensity).toBe(50);
    expect(next.mentality).toBe("BALANCED");
  });

  it("11/12. transition update leaves other phases and mentality intact", () => {
    const next = updatePhase(instructions, "transition", { regroup: true });
    expect(next.transition.regroup).toBe(true);
    expect(next.inPossession.tempo).toBe(50);
    expect(next.outOfPossession.pressingIntensity).toBe(50);
  });

  it("13/14. out-of-possession update leaves other phases intact", () => {
    const next = updatePhase(instructions, "outOfPossession", { pressingIntensity: 30 });
    expect(next.outOfPossession.pressingIntensity).toBe(30);
    expect(next.inPossession.tempo).toBe(50);
    expect(next.transition.regroup).toBe(false);
  });
});

describe("global + navigation model", () => {
  it("15. formation/style are global across modes (phase updates never touch them)", () => {
    const next = updatePhase(instructions, "transition", { counter: true });
    expect(next.mentality).toBe("BALANCED");
  });

  it("active-mode model is a closed set with Team Shape first", () => {
    expect(TACTICAL_MODES.map((m) => m.value)).toEqual([
      "teamShape", "setPieces", "inPossession", "transition", "outOfPossession",
    ]);
  });
});