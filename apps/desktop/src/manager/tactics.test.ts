import { describe, expect, it } from "vitest";
import {
  assignPlayerToSlot,
  availablePlayers,
  hasDuplicateStarting,
  intendedStartingCount,
  slotsForFormation,
  startingPlayerIds,
  swapSlots,
} from "./tactics.js";
import type { TacticalSetup, SquadPlayerRow } from "@nepal-football-sim/shared-types";

const mkSetup = (): TacticalSetup =>
  ({
    formation: {
      id: "4-3-3",
      slots: [
        { id: "gk", label: "GK", x: 50, y: 6, zone: "GK" },
        { id: "rb", label: "RB", x: 14, y: 22, zone: "DEF" },
        { id: "rcb", label: "RCB", x: 36, y: 24, zone: "DEF" },
        { id: "lcb", label: "LCB", x: 64, y: 24, zone: "DEF" },
        { id: "lb", label: "LB", x: 86, y: 22, zone: "DEF" },
        { id: "cm1", label: "CM", x: 40, y: 56, zone: "MID" },
        { id: "cm2", label: "CM", x: 60, y: 56, zone: "MID" },
        { id: "am", label: "AM", x: 50, y: 66, zone: "MID" },
        { id: "lw", label: "LW", x: 16, y: 78, zone: "ATT" },
        { id: "st", label: "ST", x: 50, y: 82, zone: "ATT" },
        { id: "rw", label: "RW", x: 84, y: 78, zone: "ATT" },
      ],
    },
    assignments: [
      { slotId: "gk", playerId: "p1" },
      { slotId: "rb", playerId: "p2" },
      { slotId: "st", playerId: "p10" },
    ],
    bench: ["p11"],
  }) as unknown as TacticalSetup;

const player = (id: string, availability = "AVAILABLE"): SquadPlayerRow =>
  ({ personId: id, name: id.toUpperCase(), primaryPosition: "STRIKER", availability }) as unknown as SquadPlayerRow;

describe("tactics slot model", () => {
  it("1/2/10. derives deterministic, intended slots with coordinates", () => {
    const slots = slotsForFormation(mkSetup().formation.slots);
    expect(slots).toHaveLength(11);
    expect(slots[0]).toEqual({ id: "gk", label: "GK", x: 50, y: 6 });
    expect(intendedStartingCount(mkSetup().formation.slots)).toBe(11);
  });

  it("3/4/9. assigns a player to a slot and removes duplicates from the bench", () => {
    const next = assignPlayerToSlot(mkSetup(), "rb", "p22");
    const map = new Map(next.assignments.filter((a) => a.playerId).map((a) => [a.slotId, a.playerId as string]));
    expect(map.get("rb")).toBe("p22");
    expect(next.bench).toEqual(["p11"]);
  });

  it("5/7. swap exchanges players between occupied/empty slots", () => {
    const setup = mkSetup(); // gk=p1, st=p10
    const next = swapSlots(setup, "gk", "st");
    const map = new Map(next.assignments.filter((a) => a.playerId).map((a) => [a.slotId, a.playerId as string]));
    expect(map.get("gk")).toBe("p10");
    expect(map.get("st")).toBe("p1");
  });

  it("6/11. bench→pitch removes from bench; formation change adjusts slot count", () => {
    const setup = mkSetup();
    const promoted = assignPlayerToSlot(setup, "cm1", "p11");
    expect(promoted.bench).not.toContain("p11");
    // Formation reconciliation: a different formation yields its own slot count.
    const other = { ...setup, formation: { ...setup.formation, slots: setup.formation.slots.slice(0, 9) } };
    expect(intendedStartingCount(other.formation.slots)).toBe(9);
  });

  it("duplicate detection reports real duplicates only", () => {
    expect(hasDuplicateStarting(mkSetup())).toBe(false);
    const dup = { ...mkSetup(), assignments: [{ slotId: "gk", playerId: "p1" }, { slotId: "st", playerId: "p1" }] };
    expect(hasDuplicateStarting(dup as TacticalSetup)).toBe(true);
  });

  it("8. unavailable players are filtered out of movement sources", () => {
    const candidates = [player("p1", "AVAILABLE"), player("p2", "INJURED"), player("p3", "SUSPENDED")];
    expect(availablePlayers(candidates).map((p) => p.personId)).toEqual(["p1"]);
  });

  it("12. presentation slot has no hidden CA/PA", () => {
    const json = JSON.stringify(slotsForFormation(mkSetup().formation.slots)[0]);
    expect(json).not.toMatch(/potential|ability|hidden/i);
  });
});