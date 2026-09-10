// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import type { EntityReference, StoryDetail } from "@nepal-football-sim/shared-types";
import { EntityRefLink, StoryDetailPanel } from "./RoleDetailScreen.js";

/**
 * Accessibility coverage for the Story Detail action/entity surface — the
 * relationship UI's third keyboard-critical area. Rather than stand up a full
 * app harness, this exercises the two reusable pieces every relationship
 * screen renders entity references and story actions through: EntityRefLink
 * and StoryDetailPanel. Asserts semantic controls only (real <button>s with
 * accessible names, never a clickable <span>/<div>), humanised status text,
 * and an axe pass.
 */

afterEach(() => cleanup());

const ref = (over: Partial<EntityReference> = {}): EntityReference => ({
  entityType: "PLAYER",
  id: "p1" as EntityReference["id"],
  label: "Franck Anoh",
  destination: "player/p1",
  visible: true,
  allowedActions: [],
  provenanceStatus: "SIMULATION_ONLY",
  ...over,
});

const storyDetail = (): StoryDetail => ({
  header: {
    importance: "medium",
    importanceBand: "IMPORTANT",
    category: "General",
    date: "2026-08-10",
    headline: "New club captain appointed",
  },
  body: {
    narrative: "The manager has named a new club captain.",
    whyItMatters: "This event affects the wider football world around this save.",
    immediateConsequence: "This is still developing and may produce further events.",
    currentState: "Captaincy change",
  },
  contextRail: {
    entities: [
      ref({ id: "new-cap" as EntityReference["id"], label: "Pujan Uparkoti" }),
      ref({ entityType: "CLUB", id: "club-1" as EntityReference["id"], label: "Machhindra FC", destination: "club/club-1" }),
      ref({ id: "old-cap" as EntityReference["id"], label: "Franck Anoh" }),
    ],
    additionalFacts: [{ label: "Player", value: "Pujan Uparkoti" }],
    priorEvents: [],
  },
  actions: [
    { id: "open-dressing-room", kind: "OPEN_DRESSING_ROOM", label: "Open Dressing Room" },
  ],
});

const fakeBridge = (detail: StoryDetail) => ({
  getStoryDetail: vi.fn().mockResolvedValue({ ok: true as const, data: detail }),
});

const seriousAxe = async (container: HTMLElement): Promise<string[]> => {
  const results = await axe.run(container, {
    rules: {
      region: { enabled: false },
      "page-has-heading-one": { enabled: false },
      "landmark-one-main": { enabled: false },
    },
  });
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact})`);
};

describe("EntityRefLink — accessibility", () => {
  it("renders an openable reference as a real button named by its label", () => {
    const onOpen = vi.fn();
    render(<EntityRefLink reference={ref()} onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: "Franck Anoh" });
    button.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders a non-openable but visible reference as plain text — never a fake control", () => {
    const { container } = render(
      <EntityRefLink reference={ref({ entityType: "FIXTURE", destination: "" })} onOpen={vi.fn()} />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.textContent).toBe("Franck Anoh");
  });

  it("renders an invisible reference as 'Unknown entity', with no control", () => {
    render(<EntityRefLink reference={ref({ visible: false })} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Unknown entity")).toBeTruthy();
  });
});

describe("StoryDetailPanel — accessibility", () => {
  const renderPanel = () => {
    const bridge = fakeBridge(storyDetail());
    const utils = render(
      <StoryDetailPanel
        bridge={bridge as never}
        eventId={"evt-1" as never}
        onClose={vi.fn()}
        onOpenReference={vi.fn()}
        onOpenDressingRoom={vi.fn()}
      />,
    );
    return { ...utils, bridge };
  };

  it("renders the headline as a heading and the current state as text", async () => {
    renderPanel();
    expect(await screen.findByRole("heading", { name: /new club captain appointed/i })).toBeTruthy();
    // Status is conveyed as words, not a colour class.
    expect(screen.getByText(/Current state:/i).closest("p")?.textContent).toMatch(/Captaincy change/i);
    expect(screen.getByText(/Consequence:/i)).toBeTruthy();
  });

  it("renders every entity reference and every action as a named button", async () => {
    renderPanel();
    await screen.findByRole("heading", { name: /new club captain appointed/i });
    expect(screen.getByRole("button", { name: "Pujan Uparkoti" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Franck Anoh" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Machhindra FC" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /open dressing room/i })).toBeTruthy();
  });

  it("has no button, link or menuitem without an accessible name", async () => {
    const { container } = renderPanel();
    await screen.findByRole("heading", { name: /new club captain appointed/i });
    for (const el of container.querySelectorAll("button, a, [role=button], [role=link]")) {
      expect(((el.textContent || el.getAttribute("aria-label")) ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("introduces no clickable non-semantic span or div", async () => {
    const { container } = renderPanel();
    await screen.findByRole("heading", { name: /new club captain appointed/i });
    expect(container.querySelectorAll("span[onclick], div[onclick]").length).toBe(0);
    // React onClick is a prop, not an attribute — assert on the rendered role
    // surface instead: nothing outside <button>/<a> carries an interactive role.
    for (const el of container.querySelectorAll("[role=button], [role=link]")) {
      expect(["BUTTON", "A"]).toContain(el.tagName);
    }
  });

  it("has no serious or critical axe violations", async () => {
    const { container } = renderPanel();
    await screen.findByRole("heading", { name: /new club captain appointed/i });
    expect(await seriousAxe(container)).toEqual([]);
  });
});
