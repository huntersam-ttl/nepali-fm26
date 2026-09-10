// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import type {
  SquadDemandView,
  TeamMeetingContext,
} from "@nepal-football-sim/shared-types";
import { PlayerMeetingPanel } from "./PlayerMeetingPanel.js";
import { TeamMeetingPanel } from "./TeamMeetingPanel.js";

/**
 * The minimal accessibility harness for the relationship UI's two modal
 * dialogs. Covers dialog semantics, accessible names on every control, the
 * focus-management contract added in f0ec40f (focus in on open, Tab trap,
 * Escape to close, focus restored on close), humanised status text, and an
 * axe pass. No pixel/style assertions.
 */

afterEach(() => cleanup());

const demandFixture = (): SquadDemandView => ({
  id: "demand-1" as SquadDemandView["id"],
  personId: "player-1" as SquadDemandView["personId"],
  playerName: "Franck Anoh",
  type: "CAPTAINCY_CONCERN",
  status: "OPEN",
  severity: 7,
  openedOn: "2026-08-10",
  reviewOn: "2026-08-31",
  trigger: "Lost the captaincy despite a strong standing in the squad.",
  requestedOutcome: "Recognition of their standing in the leadership group.",
});

const teamContextFixture = (): TeamMeetingContext => ({
  type: "RELEGATION_PRESSURE",
  urgency: 8,
  evidence: ["14th of 14 — inside the relegation zone."],
  messages: [
    { id: "RALLY_TOGETHER", label: "Rally together", description: "We fight this as one squad.", fit: "GOOD" },
    { id: "BE_DIRECT", label: "Be direct about the danger", description: "Make the stakes clear.", fit: "NEUTRAL" },
    { id: "ONE_MATCH_AT_A_TIME", label: "One match at a time", description: "Narrow the focus.", fit: "NEUTRAL" },
  ],
});

const axeViolations = async (container: HTMLElement): Promise<string[]> => {
  const results = await axe.run(container, {
    // Isolated component render has no <main>/<h1>/landmarks — those rules are
    // page-level and not meaningful for a mounted dialog fragment.
    rules: {
      region: { enabled: false },
      "page-has-heading-one": { enabled: false },
      "landmark-one-main": { enabled: false },
    },
  });
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
};

describe("Player Meeting dialog — accessibility", () => {
  const renderPanel = (onClose = vi.fn()) => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open meeting";
    document.body.appendChild(trigger);
    trigger.focus();
    const utils = render(
      <PlayerMeetingPanel
        playerName="Franck Anoh"
        managerName="You"
        demand={demandFixture()}
        onClose={onClose}
        onUpdate={vi.fn()}
      />,
    );
    return { ...utils, trigger, onClose };
  };

  it("is a modal dialog with an accessible name", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label") || "").toMatch(/meeting/i);
  });

  it("gives every actionable option and the Close control an accessible name", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog");
    for (const button of within(dialog).getAllByRole("button")) {
      expect((button.textContent || button.getAttribute("aria-label") || "").trim().length).toBeGreaterThan(0);
    }
    expect(within(dialog).getByRole("button", { name: /close/i })).toBeTruthy();
    // The real demand-response options are offered by name, not colour.
    expect(within(dialog).getByRole("button", { name: /accept/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /reject/i })).toBeTruthy();
  });

  it("shows humanised request/severity text, not a colour-only signal", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Captaincy Concern/i)).toBeTruthy();
    expect(within(dialog).getByText(/7\s*\/\s*10/)).toBeTruthy();
  });

  it("moves focus into the dialog on open", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("keeps Tab and Shift+Tab within the dialog", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog");
    const focusables = within(dialog).getAllByRole("button");
    focusables[focusables.length - 1].focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    focusables[0].focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape and restores focus to the trigger", () => {
    const { trigger, onClose, rerender } = renderPanel();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    // The parent owns visibility; simulate the unmount its onClose would cause.
    rerender(<></>);
    expect(document.activeElement).toBe(trigger);
  });

  it("has no serious or critical axe violations", async () => {
    const { container } = renderPanel();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("Team Meeting dialog — accessibility", () => {
  const renderPanel = (onClose = vi.fn()) => {
    const trigger = document.createElement("button");
    trigger.textContent = "Hold team meeting";
    document.body.appendChild(trigger);
    trigger.focus();
    const utils = render(
      <TeamMeetingPanel
        managerName="You"
        teamName="Machhindra FC"
        context={teamContextFixture()}
        onClose={onClose}
        onUpdate={vi.fn()}
      />,
    );
    return { ...utils, trigger, onClose };
  };

  it("is a modal dialog with an accessible name", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label") || "").toMatch(/meeting/i);
  });

  it("offers every message option by name and a named Close control", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog");
    for (const button of within(dialog).getAllByRole("button")) {
      expect((button.textContent || button.getAttribute("aria-label") || "").trim().length).toBeGreaterThan(0);
    }
    expect(within(dialog).getByRole("button", { name: /rally together/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /one match at a time/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /close/i })).toBeTruthy();
  });

  it("surfaces the situation as text (humanised context + urgency)", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText(/relegation pressure/i).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/8\s*\/\s*10/)).toBeTruthy();
  });

  it("moves focus in on open and closes on Escape", () => {
    const { onClose } = renderPanel();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab within the dialog", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog");
    const focusables = within(dialog).getAllByRole("button");
    focusables[focusables.length - 1].focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("has no serious or critical axe violations", async () => {
    const { container } = renderPanel();
    expect(await axeViolations(container)).toEqual([]);
  });
});
