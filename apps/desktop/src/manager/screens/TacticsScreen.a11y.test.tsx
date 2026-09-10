// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import type { EntityId, TacticalSlot, TacticsView } from "@nepal-football-sim/shared-types";

const eid = (v: string): EntityId => v as unknown as EntityId;

/**
 * Accessibility coverage for the Manager Tactics screen. The screen reads one
 * bridge command, mocked with a compact but valid TacticsView. Asserts labelled
 * controls (formation / mentality / role selectors), keyboard-reachable slot
 * buttons, familiarity shown as text + number (not colour), a logical heading
 * outline, and no serious axe violations.
 */

const slot = (id: string, position: string, zone: string): TacticalSlot => ({
  id,
  label: id,
  position: position as TacticalSlot["position"],
  x: 50,
  y: 50,
  zone: zone as TacticalSlot["zone"],
});

const view: TacticsView = {
  setup: {
    id: eid("setup-1"),
    teamId: eid("team-1"),
    name: "First XI",
    formation: {
      id: "4-3-3",
      name: "4-3-3",
      kind: "PRESET",
      slots: [slot("GK", "GK", "goalkeeper"), slot("MC", "MC", "midfield"), slot("STC", "STC", "forward")],
    },
    style: "BALANCED",
    instructions: {
      mentality: "BALANCED",
      inPossession: {
        tempo: 50, passingLength: 50, width: 50, buildUpRisk: 50, playFromBack: false,
        workBallIntoBox: false, earlyCrosses: false, focusMiddle: false, focusLeft: false,
        focusRight: false, overlapLeft: false, overlapRight: false, underlapLeft: false, underlapRight: false,
      },
      transition: { counterPress: false, regroup: false, counter: false, holdShape: true, goalkeeperDistributionStyle: "MIXED" },
      outOfPossession: {
        pressingIntensity: 50, defensiveLine: 50, engagementLine: 50, tacklingIntensity: 50,
        pressGoalkeeper: false, stopShortDistribution: false, forceInside: false, forceOutside: false,
      },
    },
    familiarity: { formation: 88, style: 72, roles: 61, instructions: 44 },
    assignments: [
      { slotId: "GK", playerId: eid("p-gk"), roleId: "GOALKEEPER" },
      { slotId: "MC", playerId: eid("p-mc"), roleId: "CENTRAL_MIDFIELDER" },
      { slotId: "STC", playerId: eid("p-st"), roleId: "ADVANCED_FORWARD" },
    ],
    bench: [eid("p-b1")],
    setPieces: {},
    createdOn: "2026-08-01",
    updatedOn: "2026-08-01",
  },
  formations: [
    { id: "4-3-3", name: "4-3-3", slots: [slot("GK", "GK", "goalkeeper"), slot("MC", "MC", "midfield"), slot("STC", "STC", "forward")] },
    { id: "4-4-2", name: "4-4-2", slots: [slot("GK", "GK", "goalkeeper"), slot("MC", "MC", "midfield"), slot("STC", "STC", "forward")] },
  ],
  roles: [
    { id: "GOALKEEPER", name: "Goalkeeper", family: "GOALKEEPER", zones: ["goalkeeper"] },
    { id: "CENTRAL_MIDFIELDER", name: "Central Midfielder", family: "MIDFIELD", zones: ["midfield"] },
    { id: "ADVANCED_FORWARD", name: "Advanced Forward", family: "FORWARD", zones: ["forward"] },
  ],
  styles: ["BALANCED", "GEGENPRESS", "LOW_BLOCK"],
  mentalities: ["DEFENSIVE", "BALANCED", "ATTACKING"],
  familiarity: { formation: 88, style: 72, roles: 61, instructions: 44 },
  roleFits: [
    { slotId: "GK", playerId: eid("p-gk"), playerName: "Keeper One", roleId: "GOALKEEPER", overall: 82, label: "Good", positionFit: 90, attributeFit: 80, familiarity: 70 },
    { slotId: "MC", playerId: eid("p-mc"), playerName: "Mid One", roleId: "CENTRAL_MIDFIELDER", overall: 74, label: "Adequate", positionFit: 80, attributeFit: 70, familiarity: 65 },
    { slotId: "STC", playerId: eid("p-st"), playerName: "Striker One", roleId: "ADVANCED_FORWARD", overall: 68, label: "Weak", positionFit: 70, attributeFit: 62, familiarity: 60 },
  ],
  benchCandidates: [],
  validation: { isValid: true, blockingErrors: [], warnings: [] },
};

vi.mock("../managerBridge.js", () => ({
  managerBridge: {
    getTactics: vi.fn(() => Promise.resolve({ ok: true as const, data: view })),
    updateTactics: vi.fn(() => Promise.resolve({ ok: true as const, data: view })),
  },
}));

let TacticsScreen: typeof import("./TacticsScreen.js").TacticsScreen;
beforeEach(async () => {
  ({ TacticsScreen } = await import("./TacticsScreen.js"));
});
afterEach(() => cleanup());

describe("Tactics screen — accessibility", () => {
  it("labels the formation and mentality selectors", async () => {
    render(<TacticsScreen />);
    expect(await screen.findByRole("combobox", { name: /formation/i })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /mentality/i })).toBeTruthy();
  });

  it("exposes each pitch slot as a keyboard-reachable named button", async () => {
    render(<TacticsScreen />);
    await screen.findByRole("combobox", { name: /formation/i });
    const slotButton = screen.getByRole("button", { name: /GK/ });
    expect(slotButton.tagName).toBe("BUTTON");
    slotButton.focus();
    expect(document.activeElement).toBe(slotButton);
  });

  it("shows familiarity as text and number, not colour alone", async () => {
    render(<TacticsScreen />);
    await screen.findByRole("combobox", { name: /formation/i });
    const heading = screen.getByRole("heading", { name: /familiarity/i });
    const block = heading.closest("div") ?? heading.parentElement!;
    expect(block.textContent).toMatch(/Formation:\s*88%/);
    expect(block.textContent).toMatch(/learning from scratch|unfamiliar/); // instructions 44
    expect(block.textContent).toMatch(/radical change/i);
  });

  it("every control has an accessible name and no clickable span/div is introduced", async () => {
    const { container } = render(<TacticsScreen />);
    await screen.findByRole("combobox", { name: /formation/i });
    for (const el of container.querySelectorAll("button, [role=button], a, [role=link]")) {
      expect(((el.textContent || el.getAttribute("aria-label")) ?? "").trim().length).toBeGreaterThan(0);
    }
    for (const el of container.querySelectorAll("select")) {
      const id = el.getAttribute("id");
      const labelled =
        (id && container.querySelector(`label[for="${id}"]`)) ||
        el.getAttribute("aria-label") ||
        el.closest("label");
      expect(labelled).toBeTruthy();
    }
    expect(container.querySelectorAll("span[onclick], div[onclick]").length).toBe(0);
  });

  it("has a logical heading outline and no serious/critical axe violations", async () => {
    const { container } = render(<TacticsScreen />);
    await screen.findByRole("combobox", { name: /formation/i });
    const levels = [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => +h.tagName[1]);
    for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    const results = await axe.run(container, {
      rules: {
        region: { enabled: false },
        "page-has-heading-one": { enabled: false },
        "landmark-one-main": { enabled: false },
      },
    });
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id} (${v.impact})`),
    ).toEqual([]);
  });
});
