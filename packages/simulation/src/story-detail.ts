import type { CareerRole, HistoricalEvent, StoryDetail, StoryThread, StoryThreadCategory } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "@nepal-football-sim/database";
import { resolveStoryEntityReference, storyImportanceBand } from "./story-entities.js";
import { humanizeEventType } from "./story-threads.js";
import { buildStoryActions } from "./story-actions.js";

export type { StoryDetail } from "@nepal-football-sim/shared-types";

/** Short, category-level context — deliberately generic rather than
 * fabricating specifics the current save state doesn't actually contain. */
const WHY_IT_MATTERS: Record<StoryThreadCategory | "GENERAL", string> = {
  TRANSFER: "Transfers reshape squad strength, wage bills, and boardroom expectations.",
  LOAN: "Loan moves affect first-team depth at both the parent club and the host club.",
  OWNERSHIP: "Ownership changes affect who controls transfer, wage, and facility spending.",
  FACILITY: "Facility investment shapes the club's training, academy, and matchday standards long-term.",
  INJURY: "Player fitness directly affects squad availability and team selection.",
  CONTRACT: "Contract status affects a player's future at the club and their value as an asset.",
  NATIONAL_PATHWAY: "International recognition reflects on both the player and the clubs that developed them.",
  COMMERCIAL: "Commercial income underpins the club's budgets across every department.",
  COMPETITION: "Competition results decide promotion, relegation, and continental qualification.",
  GENERAL: "This event affects the wider football world around this save.",
};

const FINANCIAL_FIELDS = ["transferFee", "annualValue", "amount", "fee", "value"] as const;

const financialImpactFrom = (
  data: Record<string, unknown> | undefined,
): { amount: number; currency: string } | undefined => {
  if (!data) return undefined;
  for (const field of FINANCIAL_FIELDS) {
    const value = data[field];
    if (typeof value === "number") {
      const currency = typeof data.currency === "string" ? data.currency : "NPR";
      return { amount: value, currency };
    }
  }
  return undefined;
};

/** A short, bounded list of known-safe extra facts — never a blind dump of
 * `event.data`, only fields this reader explicitly recognizes. */
const additionalFactsFrom = (data: Record<string, unknown> | undefined): { label: string; value: string }[] => {
  if (!data) return [];
  const facts: { label: string; value: string }[] = [];
  if (typeof data.percentage === "number") facts.push({ label: "Stake", value: `${data.percentage}%` });
  const progress = data.progress ?? data.percentComplete;
  if (typeof progress === "number") facts.push({ label: "Project progress", value: `${Math.round(progress)}%` });
  if (typeof data.governmentContribution === "number")
    facts.push({ label: "Government contribution", value: `NPR ${Math.round(data.governmentContribution).toLocaleString("en-US")}` });
  const deadline = data.deadline ?? data.dueDate;
  if (typeof deadline === "string") facts.push({ label: "Deadline", value: deadline });
  if (typeof data.wageShare === "number") facts.push({ label: "Wage share", value: `${data.wageShare}%` });
  if (typeof data.impliedValuation === "number")
    facts.push({ label: "Implied valuation", value: `NPR ${Math.round(data.impliedValuation).toLocaleString("en-US")}` });
  if (typeof data.term === "number") facts.push({ label: "Term", value: `${data.term} year${data.term === 1 ? "" : "s"}` });
  return facts;
};

export const buildStoryDetail = (
  db: GameDatabase,
  event: HistoricalEvent,
  role: CareerRole,
  thread?: StoryThread,
): StoryDetail => {
  const entities = event.involvedEntities
    .map((ref) => resolveStoryEntityReference(db, ref, role))
    .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref));
  const category = thread?.category;
  const statusLabel = thread?.statusLabel ?? "Active";
  const priorEvents = thread
    ? thread.events
        .filter((candidate) => candidate.id !== event.id)
        .map((candidate) => ({ date: candidate.occurredOn, headline: candidate.title }))
    : [];
  const CONSEQUENCE_BY_STATUS: Record<typeof statusLabel, string> = {
    Resolved: "This is now settled and reflected in the current save state.",
    Collapsed: "This fell through and will not proceed further.",
    Waiting: "This is waiting on a decision before it can move forward.",
    Active: "This is still developing and may produce further events.",
  };
  return {
    header: {
      importance: event.importance,
      importanceBand: storyImportanceBand(event.importance),
      category: category ? humanizeEventType(category) : "General",
      date: event.occurredOn,
      headline: event.title,
    },
    body: {
      narrative: event.title,
      whyItMatters: WHY_IT_MATTERS[category ?? "GENERAL"],
      immediateConsequence: CONSEQUENCE_BY_STATUS[statusLabel],
      currentState: humanizeEventType(event.eventType),
    },
    contextRail: {
      entities,
      financialImpact: financialImpactFrom(event.data),
      additionalFacts: additionalFactsFrom(event.data),
      priorEvents,
    },
    actions: buildStoryActions(db, event, role),
  };
};
