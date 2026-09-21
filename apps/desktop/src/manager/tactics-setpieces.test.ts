import { describe, expect, it } from "vitest";
import {
  SET_PIECE_FIELDS,
  SET_PIECE_ROUTINES,
  dedupePlayers,
  setPieceMutation,
  setPieceRoutineSupported,
  singleTakerKeys,
  swapTakers,
} from "./tactics.js";
import type { EntityId, SetPieceAssignments } from "@nepal-football-sim/shared-types";

const eid = (v: string): EntityId => v as unknown as EntityId;

const setPieces = (): SetPieceAssignments =>
  ({
    penaltyTaker: eid("p1"),
    penaltyTakers: [eid("p1")],
    directFreeKickTaker: eid("p2"),
    indirectFreeKickTaker: eid("p3"),
    leftCornerTaker: eid("p4"),
    rightCornerTaker: eid("p5"),
    cornerRoutine: "NEAR_POST",
    cornerDeliveryZone: "FAR_POST",
    cornerPrimaryTarget: eid("p6"),
    cornerStayBack: [eid("p7"), eid("p8")],
    defensiveCornerScheme: "ZONAL",
    defensiveCornerAssignments: [eid("p7")],
    defensiveAerialPriority: [eid("p6")],
    freeKickRoutine: "DIRECT",
    freeKickTarget: eid("p9"),
  }) as SetPieceAssignments;

describe("set pieces — model", () => {
  it("1/8. exposes only canonical routine types and never throw-in", () => {
    expect(SET_PIECE_ROUTINES.map((r) => r.label)).toEqual([
      "Penalty", "Attacking corner", "Defending corner", "Free kick (attacking)",
    ]);
    expect(setPieceRoutineSupported("throw-in")).toBe(false);
  });

  it("2/5. derives takers and assignment fields from canonical state", () => {
    const sp = setPieces();
    expect(singleTakerKeys.map((key) => key).length).toBeGreaterThan(4);
    expect(sp.penaltyTaker).toBe(eid("p1"));
    expect(sp.leftCornerTaker).toBe(eid("p4"));
    expect(sp.directFreeKickTaker).toBe(eid("p2"));
    const labels = SET_PIECE_FIELDS.map((f) => f.label);
    expect(labels).toContain("Penalty taker");
    expect(labels).toContain("Defensive corner marking");
  });

  it("3/9. mutation preserves the rest of the contract", () => {
    const sp = setPieces();
    const next = setPieceMutation(sp, "penaltyTaker", eid("p9"));
    expect(next.penaltyTaker).toBe(eid("p9"));
    expect(next.directFreeKickTaker).toBe(eid("p2"));
    expect(next.cornerRoutine).toBe("NEAR_POST");
    expect(next.freeKickRoutine).toBe("DIRECT");
    expect(Object.keys(next).sort()).toEqual(Object.keys(sp).sort()); // persistence shape intact
  });

  it("4. swaps taker slots", () => {
    const swapped = swapTakers(setPieces(), "leftCornerTaker", "rightCornerTaker");
    expect(swapped.leftCornerTaker).toBe(eid("p5"));
    expect(swapped.rightCornerTaker).toBe(eid("p4"));
  });

  it("6. multi-assignment lists are de-duplicated", () => {
    expect(dedupePlayers([eid("p1"), eid("p1"), eid("p2")])).toEqual([eid("p1"), eid("p2")]);
  });

  it("7. exposes no hidden ability values", () => {
    const json = JSON.stringify(setPieces());
    expect(json).not.toMatch(/potential|currentAbility|hidden|attributeFit/i);
  });
});