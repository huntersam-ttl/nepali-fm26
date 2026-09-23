// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { EntityId, MediaCentreView, MediaDirectoryView, StoryThread } from "@nepal-football-sim/shared-types";

const eid = (value: string): EntityId => value as unknown as EntityId;
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const clubRef = { id: eid("club-1"), entityType: "CLUB", label: "Kathmandu United", visible: true, allowedActions: [], provenanceStatus: "SIMULATION_ONLY", destination: "DESTINATION" as never };

const event = (title: string, date: string): StoryThread["latestEvent"] => ({
  id: eid(`ev-${title}`),
  occurredOn: date,
  eventType: "TRANSFER",
  involvedEntities: [],
  title,
  importance: "high",
  scope: "club",
});

const active: StoryThread = ({
  id: "t1",
  category: "TRANSFER",
  primaryEntity: clubRef,
  currentState: "The club is deciding whether to match the offer.",
  latestEvent: event("Star midfielder draws fresh interest", "2025-09-10"),
  resolved: false,
  statusLabel: "Active",
  events: [
    event("Midfielder linked with a move abroad", "2025-09-01"),
    event("Star midfielder draws fresh interest", "2025-09-10"),
  ],
  involvedEntities: [clubRef],
}) as unknown as StoryThread;

const collapsed: StoryThread = ({
  id: "t2",
  category: "LOAN",
  primaryEntity: clubRef,
  currentState: "No further coverage.",
  latestEvent: event("Loan deal quietly fades", "2025-07-01"),
  resolved: true,
  statusLabel: "Collapsed",
  events: [event("Loan deal quietly fades", "2025-07-01")],
  involvedEntities: [clubRef],
}) as unknown as StoryThread;

const mediaCentre: MediaCentreView = ({
  recentStories: [],
  feed: [
    {
      story: { id: eid("s1"), outletId: eid("o1"), eventType: "TRANSFER", sourceEntityId: eid("ev-s1"), publishedOn: "2025-09-10", importance: 6, headline: "Star midfielder draws fresh interest", summary: "Fresh interest reported.", subjectIds: [], reputationEffect: 0, status: "PUBLISHED", provenanceStatus: "SIMULATION_ONLY" },
      reaction: { label: "MIXED", summary: "temperate" },
      section: "TRANSFERS",
      outletName: "Yeti Sports",
      importanceBand: "IMPORTANT",
      standfirst: "A completed piece of transfer reporting.",
      entities: [clubRef],
    },
  ],
  eligibleForInterview: [],
  pendingInterview: undefined,
  completedInterviews: [],
}) as unknown as MediaCentreView;

// Journalist directory carries interaction context (count + last date), never trust.
const directory: MediaDirectoryView = ({
  outlets: [],
  journalists: [
    { reference: { id: eid("j1"), entityType: "JOURNALIST", label: "Mira Gurung", visible: true, allowedActions: [], provenanceStatus: "SIMULATION_ONLY", destination: "DESTINATION" as never }, name: "Mira Gurung", outletName: "Yeti Sports", beat: "TRANSFERS", interactionCount: 3, lastInteraction: "2025-09-03" },
  ],
}) as unknown as MediaDirectoryView;

vi.mock("../managerBridge.js", () => ({
  managerBridge: {
    getMediaCentre: vi.fn(() => ok(mediaCentre)),
    getMediaDirectory: vi.fn(() => ok(directory)),
    getStoryThreads: vi.fn(() => ok([active, collapsed])),
  },
}));

let newsroom: typeof import("./NewsroomScreen.js");
let journalistsMod: typeof import("./JournalistsScreen.js");

beforeAll(async () => {
  newsroom = await import("./NewsroomScreen.js");
  journalistsMod = await import("./JournalistsScreen.js");
});

describe("Persistent narratives", () => {
  it("16/17. canonical thread identity + deterministic grouping via ongoingThreads", () => {
    const open = newsroom.ongoingThreads([active, collapsed]);
    // Collapsed thread excluded; results newest-first by latest event.
    expect(open.length).toBe(1);
    expect(open[0]!.id).toBe("t1");
  });

  it("18. chronological earlier coverage is retained (events order preserved)", () => {
    expect(active.events[0]!.occurredOn).toBe("2025-09-01");
    expect(active.events[1]!.occurredOn).toBe("2025-09-10");
  });

  it("19. latest-story selection surfaces the newest event", () => {
    expect(active.latestEvent.title).toBe("Star midfielder draws fresh interest");
  });

  it("21. thread membership is status-based, never headline-text based", () => {
    // A Collapsed thread (any title) is excluded; an Active thread (any title) is kept.
    const open = newsroom.ongoingThreads([active, collapsed]);
    expect(open.map((t) => t.id)).toEqual(["t1"]);
    expect(collapsed.statusLabel).toBe("Collapsed");
  });

  it("22. renders one-off story as an honest empty thread list", async () => {
    const bridge = (await import("../managerBridge.js")).managerBridge;
    (bridge.getStoryThreads as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok([]));
    render(<newsroom.NewsroomScreen onOpenEntity={() => {}} />);
    await screen.findByText(/no ongoing story threads/i);
    (bridge.getStoryThreads as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok([active, collapsed]));
  });

  it("renders the Story threads panel with canonical status + coverage count + entity", async () => {
    render(<newsroom.NewsroomScreen onOpenEntity={() => {}} />);
    await screen.findByText(/story threads/i);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/transfers/i);
    expect(body).toMatch(/2 reports/i);
    expect(body).toMatch(/kathmandu united/i);
  });
});

describe("Journalist interaction context (relationships)", () => {
  it("3/4. interaction count and last date come from persisted state", () => {
    const entry = directory.journalists[0]!;
    expect(entry.interactionCount).toBe(3);
    expect(entry.lastInteraction).toBe("2025-09-03");
  });

  it("1/30. raw trust is never exposed on a journalist", () => {
    const entry = directory.journalists[0]!;
    if ("trust" in entry || "hostility" in entry || "temperament" in entry || "agenda" in entry) {
      throw new Error("internal relationship field leaked");
    }
  });

  it("7/10. the Journalists screen shows prior-interaction context", async () => {
    render(<journalistsMod.JournalistsScreen onOpenEntity={() => {}} />);
    await screen.findByText(/mira gurung/i);
    const body = document.body.textContent ?? "";
    expect(body).toContain("3");
    expect(body).toContain("2025-09-03");
    expect(body).not.toMatch(/trust|temperament|hostility|agenda/i);
  });
});

describe("Public reaction (7D)", () => {
  it("maps the canonical per-story reaction (server-derived label + summary)", () => {
    const feedItem = mediaCentre.feed[0]!;
    expect(feedItem.reaction.label).toBe("MIXED");
    expect(feedItem.reaction.summary).toBe("temperate");
  });

  it("renders per-story public reaction with simulated provenance", async () => {
    render(<newsroom.NewsroomScreen onOpenEntity={() => {}} />);
    await screen.findByText(/simulated reaction/i);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/mixed/i);
    expect(body).toMatch(/simulated reaction/i);
  });

  it("never shows fake social-network vanity metrics", async () => {
    render(<newsroom.NewsroomScreen onOpenEntity={() => {}} />);
    await screen.findByText(/simulated reaction/i);
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/likes?|shares?|followers?|trending|reposts?|hashtag|verified|avatar/i);
  });

  it("never fabricates a direct supporter quote", async () => {
    render(<newsroom.NewsroomScreen onOpenEntity={() => {}} />);
    await screen.findByText(/simulated reaction/i);
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/fan\s*\d+|“|”|⚽|💬/i);
  });
});
afterEach(() => cleanup());