import { describe, expect, it } from "vitest";
import {
  consolidateValidation,
  dedupeStrings,
  readinessItems,
  setPieceReadiness,
  startingXIStatus,
  tacticalCohesionPresent,
} from "./tactics.js";
import type { TacticalSetup } from "@nepal-football-sim/shared-types";

const eid = (v: string) => v as unknown as TacticalSetup["assignments"][number]["playerId"];
const familiar = { formation: 88, style: 70, roles: 62, instructions: 44 };
const emptyFamiliar = { formation: 0, style: 0, roles: 0, instructions: 0 };

const mkSetup = (over: Partial<TacticalSetup> = {}): TacticalSetup =>
  ({
    id: "t1",
    teamId: "team1",
    name: "Default",
    formation: {
      id: "4-3-3",
      slots: [
        { id: "gk", label: "GK", x: 50, y: 6, position: "GK", zone: "goalkeeper" },
        { id: "rb", label: "RB", x: 14, y: 22, position: "DR", zone: "defender" },
        { id: "st", label: "ST", x: 50, y: 82, position: "STC", zone: "forward" },
      ],
    },
    style: "BALANCED",
    instructions: { mentality: "BALANCED" } as unknown as TacticalSetup["instructions"],
    assignments: [{ slotId: "gk", playerId: eid("p1"), roleId: "GK" }],
    bench: [],
    setPieces: {},
    ...over,
  }) as unknown as TacticalSetup;

const fullSetup = (): TacticalSetup => ({
  ...mkSetup(),
  assignments: [
    { slotId: "gk", playerId: eid("p1"), roleId: "GK" },
    { slotId: "rb", playerId: eid("p2"), roleId: "WINGBACK" },
    { slotId: "st", playerId: eid("p3"), roleId: "STRIKER" },
  ],
});

describe("familiarity presentation", () => {
  it("1/2/3/4. derives an informational familiarity line from canonical numbers only", () => {
    const items = readinessItems(fullSetup(), familiar, { blockingErrors: [], warnings: [] });
    const famLine = items.find((i) => i.text.startsWith("Tactical familiarity"));
    expect(famLine?.text).toContain("formation 88%");
    expect(famLine?.text).toContain("instructions 44%");
    expect(famLine?.text).toContain("roles 62%");
    expect(famLine?.text).not.toMatch(/excellent|good|poor|thoughtful|chemistry/i);
    const zero = readinessItems(fullSetup(), emptyFamiliar, { blockingErrors: [], warnings: [] });
    expect(zero.find((i) => i.text.startsWith("Tactical familiarity"))?.text).toContain("formation 0%");
  });
});

describe("cohesion", () => {
  it("5. tactical cohesion beyond familiarity is explicitly absent", () => {
    expect(tacticalCohesionPresent()).toBe(false);
  });
});

describe("preparation / readiness", () => {
  it("6. XI-complete state", () => {
    expect(startingXIStatus(fullSetup())).toMatchObject({ required: 3, selected: 3, complete: true, hasGoalkeeper: true });
  });
  it("7. incomplete XI state", () => {
    expect(startingXIStatus(mkSetup())).toMatchObject({ required: 3, selected: 1, complete: false });
    const noGk = { ...fullSetup(), assignments: fullSetup().assignments.filter((a) => a.slotId !== "gk") };
    expect(startingXIStatus(noGk)).toMatchObject({ hasGoalkeeper: false, complete: false });
  });
  it("8. unavailable-player warning is surfaced non-blocking", () => {
    const items = readinessItems(fullSetup(), familiar, {
      blockingErrors: [],
      warnings: ["Maya Adhikari is injured.", "No recognised goalkeeper has been assigned."],
    });
    const warn = items.filter((i) => i.severity === "warning").map((i) => i.text);
    expect(warn).toContain("Maya Adhikari is injured.");
    expect(warn).toContain("No recognised goalkeeper has been assigned.");
  });
  it("9/10. severity + canonical familiarity preserved verbatim", () => {
    const items = readinessItems(fullSetup(), familiar, {
      blockingErrors: ["Starting XI must contain exactly 11 players."],
      warnings: ["One or more tactical slots are unfilled."],
    });
    expect(items.filter((i) => i.severity === "blocking").map((i) => i.text)).toEqual([
      "Starting XI must contain exactly 11 players.",
    ]);
    expect(items.filter((i) => i.severity === "warning").map((i) => i.text)).toEqual([
      "One or more tactical slots are unfilled.",
    ]);
    expect(items.some((i) => i.severity === "info" && i.text.includes("Tactical familiarity"))).toBe(true);
  });
});

describe("validation consolidation", () => {
  it("11/12. deduplicates while preserving blocking/warning separation", () => {
    expect(dedupeStrings(["a", "a", "b"])).toEqual(["a", "b"]);
    const c = consolidateValidation({ blockingErrors: ["dup", "dup", "x"], warnings: ["w", "w", "z"] });
    expect(c.blockingErrors).toEqual(["dup", "x"]);
    expect(c.warnings).toEqual(["w", "z"]);
  });
  it("13. produces no invented tactical-quality warnings", () => {
    const text = readinessItems(fullSetup(), familiar, { blockingErrors: [], warnings: [] })
      .map((i) => i.text)
      .join(" ");
    expect(text).not.toMatch(/creativity|too defensive|weak (left|right|side)|poor balance|dislike/i);
  });
});

describe("persistence / single-state audit", () => {
  it("14-18. readiness and XI helpers are pure (never mutate the canonical setup)", () => {
    const setup = fullSetup();
    const before = JSON.stringify(setup);
    readinessItems(setup, familiar, { blockingErrors: [], warnings: [] });
    startingXIStatus(setup);
    setPieceReadiness(setup.setPieces);
    expect(JSON.stringify(setup)).toBe(before);
  });
  it("19. set-piece readiness is factual, not a completeness grade", () => {
    expect(setPieceReadiness(mkSetup().setPieces)).toMatch(/0 takers assigned/);
    expect(setPieceReadiness({ penaltyTaker: eid("p1"), leftCornerTaker: eid("p2") })).toMatch(/2 takers assigned/);
  });
  it("20. readiness output exposes no hidden CA/PA or engine weights", () => {
    const text = readinessItems(fullSetup(), familiar, { blockingErrors: [], warnings: [] })
      .map((i) => i.text)
      .join(" ");
    expect(text).not.toMatch(/potential|currentAbility|hidden|attributeWeight|tacticalWeight/i);
  });
});