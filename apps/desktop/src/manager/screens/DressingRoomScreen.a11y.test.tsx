// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import type { DressingRoomView, EntityId, SquadDynamicsView } from "@nepal-football-sim/shared-types";

const eid = (value: string): EntityId => value as unknown as EntityId;

/**
 * Accessibility coverage for the Dressing Room captaincy / relationship
 * surface. The screen reads two real bridge commands; both are mocked with
 * minimal fixtures so the render is deterministic. Asserts that every
 * captaincy control and every player reference is a real, named control
 * (never a clickable <span>/<div>), relationship standing is text not colour,
 * and there are no serious axe violations.
 */

const dynamics: SquadDynamicsView = {
  concerns: [],
  demands: [],
  promises: [],
  cohesion: {
    score: 67,
    level: "STABLE",
    captainPersonId: eid("captain-1"),
    captainName: "Pujan Uparkoti",
    viceCaptainPersonId: eid("vice-1"),
    viceCaptainName: "Ranjan Pun",
    captainInfluence: "NEUTRAL",
  },
  groups: [],
  disputes: [],
  meetings: [],
};

const room: DressingRoomView = {
  hierarchy: [
    { personId: eid("captain-1"), playerName: "Pujan Uparkoti", label: "TEAM_LEADER", groupType: "CORE_LEADERS" },
    { personId: eid("leader-2"), playerName: "Utsab Rai", label: "TEAM_LEADER", groupType: "CORE_LEADERS" },
    { personId: eid("fringe-1"), playerName: "Franck Anoh", label: "FRINGE", groupType: "PERIPHERAL" },
  ],
  socialGroups: [],
  lifestyle: [],
  managerSupport: [
    { personId: eid("captain-1"), playerName: "Pujan Uparkoti", support: "FULLY_ONSIDE" },
    { personId: eid("fringe-1"), playerName: "Franck Anoh", support: "AT_ODDS" },
  ],
  mentoring: [],
};

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

vi.mock("../managerBridge.js", () => ({
  managerBridge: {
    getSquadConcerns: vi.fn(() => ok(dynamics)),
    getDressingRoom: vi.fn(() => ok(room)),
    getTeamMeetingContext: vi.fn(() => ok(undefined)),
    holdSquadMeeting: vi.fn(() => ok({})),
    appointCaptaincy: vi.fn(() => ok({})),
    respondToConcern: vi.fn(() => ok({})),
    respondToDemand: vi.fn(() => ok({})),
  },
}));

let DressingRoomScreen: typeof import("./DressingRoomScreen.js").DressingRoomScreen;
beforeEach(async () => {
  ({ DressingRoomScreen } = await import("./DressingRoomScreen.js"));
});
afterEach(() => cleanup());

const renderScreen = () => render(<DressingRoomScreen onSelectPlayer={vi.fn()} />);

describe("Dressing Room captaincy surface — accessibility", () => {
  it("exposes the captaincy action as a real, named button", async () => {
    renderScreen();
    // A CORE_LEADERS team-leader who is not already the captain gets the control.
    expect(await screen.findByRole("button", { name: /make captain/i })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /make vice-captain/i }).length).toBeGreaterThan(0);
  });

  it("renders every player reference as a named button, never a bare span", async () => {
    const { container } = renderScreen();
    await screen.findByRole("button", { name: /make captain/i });
    expect(screen.getAllByRole("button", { name: "Utsab Rai" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Franck Anoh" }).length).toBeGreaterThan(0);
    for (const el of container.querySelectorAll("[role=button], [role=link]")) {
      expect(["BUTTON", "A"]).toContain(el.tagName);
    }
    expect(container.querySelectorAll("span[onclick], div[onclick]").length).toBe(0);
  });

  it("every button on the surface has an accessible name", async () => {
    const { container } = renderScreen();
    await screen.findByRole("button", { name: /make captain/i });
    for (const button of container.querySelectorAll("button")) {
      expect(((button.textContent || button.getAttribute("aria-label")) ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("shows relationship standing as words, not colour alone", async () => {
    renderScreen();
    await screen.findByRole("button", { name: /make captain/i });
    // managerSupport labels are humanised to readable text next to each player.
    expect(screen.getByText(/fully onside/i)).toBeTruthy();
    expect(screen.getByText(/at odds/i)).toBeTruthy();
  });

  it("has no serious or critical axe violations", async () => {
    const { container } = renderScreen();
    await screen.findByRole("button", { name: /make captain/i });
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
