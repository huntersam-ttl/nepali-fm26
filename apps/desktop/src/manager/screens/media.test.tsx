// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { EntityReference, EntityId, MediaCentreView, MediaDirectoryView, MediaFeedItem, MediaStory } from "@nepal-football-sim/shared-types";

const eid = (value: string): EntityId => value as unknown as EntityId;
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const playerRef: EntityReference = { id: eid("p1"), entityType: "PLAYER", label: "Aayush Thapa", visible: true, allowedActions: [], provenanceStatus: "SIMULATION_ONLY", destination: "DESTINATION" as never };

const emptyEntities: EntityReference[] = [];

const story = (id: string, headline: string, date: string): MediaStory => ({
  id: eid(id),
  outletId: eid("o1"),
  eventType: "TRANSFER",
  sourceEntityId: eid(`ev-${id}`),
  publishedOn: date,
  importance: 6,
  headline,
  summary: `${headline} summary`,
  subjectIds: [eid("p1")],
  reputationEffect: 0,
  status: "PUBLISHED",
  provenanceStatus: "SIMULATION_ONLY",
});

const item = (id: string, headline: string, date: string, section: string, withEntities = true): MediaFeedItem => ({
  story: story(id, headline, date),
  reaction: { label: "MIXED", summary: "temperate response" },
  section: section as MediaFeedItem["section"],
  outletName: "Yeti Sports",
  importanceBand: "IMPORTANT",
  standfirst: "A completed move with public reaction.",
  entities: withEntities ? [playerRef] : emptyEntities,
});

const feed: MediaFeedItem[] = [
  item("s2", "Ayush completes move to Kathmandu United", "2025-09-02", "TRANSFERS"),
  item("s1", "League title race tightens", "2025-09-01", "TOP_STORIES"),
];

const mediaCentre: MediaCentreView = ({
  recentStories: feed,
  feed,
  eligibleForInterview: [],
}) as unknown as MediaCentreView;

const emptyMediaCentre: MediaCentreView = ({ ...mediaCentre, feed: [], recentStories: [] }) as unknown as MediaCentreView;

const directory: MediaDirectoryView = ({
  outlets: [
    { reference: { id: eid("o1"), entityType: "MEDIA_OUTLET", label: "Yeti Sports", visible: true, allowedActions: [], provenanceStatus: "SIMULATION_ONLY", destination: "DESTINATION" as never }, name: "Yeti Sports", scope: "NATIONAL", storyCount: 2 },
  ],
  journalists: [
    { reference: { id: eid("j1"), entityType: "JOURNALIST", label: "Mira Gurung", visible: true, allowedActions: [], provenanceStatus: "SIMULATION_ONLY", destination: "DESTINATION" as never }, name: "Mira Gurung", outletName: "Yeti Sports", beat: "TRANSFERS" },
  ],
}) as unknown as MediaDirectoryView;

const emptyDirectory: MediaDirectoryView = ({ outlets: [], journalists: [] }) as unknown as MediaDirectoryView;

vi.mock("../managerBridge.js", () => ({
  managerBridge: {
    getMediaCentre: vi.fn(() => ok(mediaCentre)),
    getMediaDirectory: vi.fn(() => ok(directory)),
  },
}));

let newsroom: typeof import("./NewsroomScreen.js");
let outletsMod: typeof import("./MediaOutletsScreen.js");
let journalistsMod: typeof import("./JournalistsScreen.js");

beforeAll(async () => {
  newsroom = await import("./NewsroomScreen.js");
  outletsMod = await import("./MediaOutletsScreen.js");
  journalistsMod = await import("./JournalistsScreen.js");
});

describe("Newsroom", () => {
  it("1. maps the canonical feed and picks the lead (most recent) story", () => {
    expect(newsroom.leadStory(feed)?.story.id).toBe(eid("s2"));
    expect(newsroom.leadStory([])).toBeUndefined();
  });

  it("2. preserves the deterministic newest-first ordering through filtering", () => {
    const filtered = newsroom.filterFeed(feed, "TOP_STORIES");
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.story.headline).toContain("title race");
    expect(newsroom.filterFeed(feed, undefined).map((i) => i.story.id)).toEqual([eid("s2"), eid("s1")]);
  });

  it("3. exposes the canonical section taxonomy", () => {
    expect(newsroom.MEDIA_SECTIONS).toContain("TOP_STORIES");
    expect(newsroom.MEDIA_SECTIONS).toContain("TRANSFERS");
    expect(newsroom.humanizeSection("NATIONAL_TEAM")).toBe("national team");
  });

  it("4/5. story cards show date, source/outlet and simulated provenance", async () => {
    render(<newsroom.NewsroomScreen onOpenEntity={() => {}} />);
    await screen.findByText(/ayush completes move/i);
    const page = document.body.textContent ?? "";
    expect(page).toMatch(/yeti sports/i);
    expect(page).toContain("2025-09-02");
    expect(page).toMatch(/simulated world media/i);
  });

  it("6. renders canonical linked entities as navigation", async () => {
    render(<newsroom.NewsroomScreen onOpenEntity={() => {}} />);
    await screen.findByText(/ayush completes move/i);
    expect(document.querySelectorAll("button.link").length).toBeGreaterThan(0);
  });

  it("7. shows an honest empty stream when there is no feed", async () => {
    const bridge = (await import("../managerBridge.js")).managerBridge;
    (bridge.getMediaCentre as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(emptyMediaCentre));
    render(<newsroom.NewsroomScreen onOpenEntity={() => {}} />);
    await screen.findByText(/no published stories/i);
    (bridge.getMediaCentre as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(mediaCentre));
  });

  it("8. never fabricates quotes, sources or sensational headlines", async () => {
    render(<newsroom.NewsroomScreen onOpenEntity={() => {}} />);
    await screen.findByText(/ayush completes move/i);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/said|according to sources|"\S{2,}"/i);
  });

  it("9. does not leak private transfer/inbox detail through news", async () => {
    render(<newsroom.NewsroomScreen onOpenEntity={() => {}} />);
    await screen.findByText(/ayush completes move/i);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/offer|negotiation|bid|secret|private/i);
  });
});

describe("Media Outlets", () => {
  it("10. maps the canonical outlet directory with story counts", () => {
    expect(outletsMod.outlets(directory).map((o) => o.name)).toEqual(["Yeti Sports"]);
    expect(outletsMod.outlets(directory)[0]!.storyCount).toBe(2);
  });

  it("12. does not fabricate outlet metadata", () => {
    const entry = outletsMod.outlets(directory)[0]!;
    expect(entry.name).toBe("Yeti Sports");
    expect(entry.scope).toBe("NATIONAL");
    // neither reach/bias/reputation is exposed
    if ("reach" in entry || "bias" in entry || "reputation" in entry) throw new Error("internal outlet field leaked");
  });

  it("13. shows an honest empty state with no outlets", async () => {
    const bridge = (await import("../managerBridge.js")).managerBridge;
    (bridge.getMediaDirectory as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(emptyDirectory));
    render(<outletsMod.MediaOutletsScreen onOpenEntity={() => {}} />);
    await screen.findByText(/no media outlets/i);
    (bridge.getMediaDirectory as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(directory));
  });
});

describe("Journalists", () => {
  it("14/15. maps canonical journalists with their outlet association", () => {
    const list = journalistsMod.journalists(directory);
    expect(list.map((j) => j.name)).toEqual(["Mira Gurung"]);
    expect(list[0]!.outletName).toBe("Yeti Sports");
    expect(list[0]!.beat).toBe("TRANSFERS");
  });

  it("17. never fabricates personality/agenda/trust", () => {
    const entry = journalistsMod.journalists(directory)[0]!;
    if ("trust" in entry || "temperament" in entry || "agenda" in entry || "hostile" in entry) {
      throw new Error("internal journalist field leaked");
    }
  });

  it("18. shows an honest empty state with no journalists", async () => {
    const bridge = (await import("../managerBridge.js")).managerBridge;
    (bridge.getMediaDirectory as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(emptyDirectory));
    render(<journalistsMod.JournalistsScreen onOpenEntity={() => {}} />);
    await screen.findByText(/no journalists are on record/i);
    (bridge.getMediaDirectory as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(directory));
  });
});
afterEach(() => cleanup());