// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ManagerCareerHistoryView, ManagerDashboard, SupporterReadModel } from "@nepal-football-sim/shared-types";

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

// Extra fields simulate hidden simulation state that must never be rendered.
const history = {
  managerName: "Maya Adhikari",
  reputationProfile: "RISING_MANAGER",
  jobsHeld: 1,
  history: [],
  trophies: [],
  reputationDimensions: { sporting: 71, governance: 12 },
} as unknown as ManagerCareerHistoryView;

const dashboard = {
  boardConfidence: 64.4,
  boardExpectation: "TOP_HALF",
  relationshipTrust: 88,
  relationshipTension: 9,
} as unknown as ManagerDashboard;

const supporters = {
  managerApproval: 58.6,
  ownershipTrust: 41,
  unrest: "CONCERNED",
  mood: 55,
  journalistTrust: 77,
} as unknown as SupporterReadModel;

vi.mock("../managerBridge.js", () => ({
  managerBridge: {
    getCareerHistory: vi.fn(() => ok(history)),
    getManagerDashboard: vi.fn(() => ok(dashboard)),
    getSupporterOverview: vi.fn(() => ok(supporters)),
  },
}));

let mod: typeof import("./CareerReputationScreen.js");

beforeAll(async () => {
  mod = await import("./CareerReputationScreen.js");
});

afterEach(() => cleanup());

describe("Career Reputation (Phase 8B)", () => {
  it("humanizes the professional standing label", () => {
    expect(mod.professionalStanding(history)).toBe("Rising Manager");
    expect(mod.professionalStanding({ ...history, reputationProfile: "" } as ManagerCareerHistoryView)).toBe(
      "Not yet profiled",
    );
  });

  it("maps board confidence and expectation without inventing values", () => {
    expect(mod.boardConfidenceMetrics(dashboard)).toEqual([
      { label: "Board confidence", value: "64 / 100" },
      { label: "Board expects", value: "Top Half" },
    ]);
    expect(mod.boardConfidenceMetrics({})).toEqual([
      { label: "Board confidence", value: "—" },
      { label: "Board expects", value: "—" },
    ]);
  });

  it("renders three distinct measures with their own scope", async () => {
    render(<mod.CareerReputationScreen />);
    await screen.findByText("Rising Manager");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Professional standing/);
    expect(body).toMatch(/Board confidence/);
    expect(body).toMatch(/64 \/ 100/);
    expect(body).toMatch(/Supporter approval/);
    expect(body).toMatch(/59 \/ 100/);
    expect(body).toMatch(/concerned/i);
    expect(body).toMatch(/not combined into a single career score/i);
  });

  it("never renders a combined score or hidden simulation state", async () => {
    render(<mod.CareerReputationScreen />);
    await screen.findByText("Rising Manager");
    const body = (document.body.textContent ?? "").replace(/not combined into a single career score/i, "");
    expect(body).not.toMatch(/career score|overall reputation|total reputation/i);
    expect(body).not.toMatch(/trust|tension|hostility|sporting|governance|weight|threshold/i);
    expect(body).not.toMatch(/\b88\b|\b77\b|\b71\b|\b41\b/);
  });
});
