import { describe, expect, it } from "vitest";
import {
  calendarByDate,
  dailyOpsModules,
  inboxClassification,
  orderNews,
} from "./dailyOps.js";
import type { CalendarEntry, InboxItem, StoryThread } from "@nepal-football-sim/shared-types";

const inbox = (over: Partial<InboxItem>): InboxItem =>
  ({
    id: "i1",
    createdOn: "2026-08-01",
    type: "PRESS_INTERVIEW",
    title: "Title",
    body: "Body",
    read: false,
    ...over,
  }) as InboxItem;

describe("inbox classification", () => {
  it("3. classifies informational vs actionable vs warning vs resolved", () => {
    expect(inboxClassification(inbox({}))).toBe("info");
    expect(inboxClassification(inbox({ entityReferences: [{ entityType: "CLUB", id: "c1", label: "C" } as never] }))).toBe("actionable");
    expect(inboxClassification(inbox({ type: "INJURY" }))).toBe("warning");
    expect(inboxClassification(inbox({ read: true }))).toBe("resolved");
  });
});

describe("news ordering", () => {
  const thread = (id: string, resolved: boolean): StoryThread =>
    ({ id, resolved, currentState: "S", category: "COMPETITION", primaryEntity: {} }) as unknown as StoryThread;

  it("5. leads active unresolved stories, then deterministic (bounded)", () => {
    const ordered = orderNews([thread("a", true), thread("b", false), thread("c", false)], 2);
    expect(ordered.lead?.id).toBe("b");
    expect(ordered.recent.map((t) => t.id)).toEqual(["c", "a"]);
  });

  it("6. empty news is an empty state", () => {
    expect(orderNews([])).toEqual({ lead: undefined, recent: [] });
  });
});

describe("calendar grouping", () => {
  const entry = (date: string, title: string): CalendarEntry => ({ date, type: "FIXTURE", title });

  it("8. groups events by date, dates ascending", () => {
    const days = calendarByDate([entry("2026-08-08", "A"), entry("2026-08-01", "B"), entry("2026-08-08", "C")]);
    expect(days.map((d) => d.date)).toEqual(["2026-08-01", "2026-08-08"]);
    expect(days[1].entries.map((e) => e.title)).toEqual(["A", "C"]);
  });

  it("11. no fabricated events: empty input yields empty calendar", () => {
    expect(calendarByDate([])).toEqual([]);
  });
});

describe("role module availability", () => {
  it("17. Owner/President never inherit manager-only modules; all get daily base", () => {
    expect(dailyOpsModules("MANAGER")).toEqual(["inbox", "news", "calendar", "fixtures", "competition"]);
    expect(dailyOpsModules("CHAIRMAN_OWNER")).toEqual(["inbox", "news", "calendar"]);
    expect(dailyOpsModules("FEDERATION_PRESIDENT")).toEqual(["inbox", "news", "calendar"]);
  });
});