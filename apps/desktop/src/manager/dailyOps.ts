import type {
  CalendarEntry,
  InboxItem,
  StoryThread,
} from "@nepal-football-sim/shared-types";

/**
 * Phase 2C — Daily Operations: small pure helpers for Inbox / News / Calendar.
 * Deterministic and bounded; nothing invented. Priority selection and role
 * module availability stay truthful to real data.
 */

export type InboxKind = "info" | "actionable" | "warning" | "resolved";

/** Classify a message so the Inbox can visually separate informational,
 * actionable, warning, and resolved items (distinct from application errors). */
export const inboxClassification = (item: InboxItem): InboxKind => {
  if (item.type === "INJURY" || item.type === "SUSPENSION") return "warning";
  if (item.entityReferences && item.entityReferences.length > 0) return "actionable";
  if (item.read) return "resolved";
  return "info";
};

const threadId = (thread: StoryThread): string => thread.id;

/** Deterministic, bounded News ordering: active unresolved stories lead, then
 * by id for a stable order (recency is not reliably ranked by the write model,
 * so we keep a deterministic recent list and never invent importance). */
export const orderNews = (
  threads: StoryThread[],
  leadLimit = 5,
): { lead?: StoryThread; recent: StoryThread[] } => {
  const sorted = [...threads].sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    return threadId(a).localeCompare(threadId(b));
  });
  const [lead, ...rest] = sorted;
  return { lead, recent: rest.slice(0, Math.max(0, leadLimit)) };
};

export type CalendarDay = {
  date: string;
  entries: CalendarEntry[];
};

/** Group calendar entries by date, newest entries within a day last (stable),
 * dates ascending. Optionally marks the current world date. */
export const calendarByDate = (entries: CalendarEntry[]): CalendarDay[] => {
  const byDate = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.date) ?? [];
    list.push(entry);
    byDate.set(entry.date, list);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayEntries]) => ({ date, entries: dayEntries }));
};

export type DailyOpsModule = "inbox" | "news" | "calendar" | "fixtures" | "competition";

/** Truthful module availability per role: Owner/President never inherit
 * manager-only modules; all roles at least get inbox/news/calendar. */
export const dailyOpsModules = (role: string): DailyOpsModule[] => {
  const base: DailyOpsModule[] = ["inbox", "news", "calendar"];
  if (role === "MANAGER") return [...base, "fixtures", "competition"];
  return base;
};