import type { CareerRole, HistoricalEvent, StoryDetail, StoryThread, StoryThreadCategory } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "@nepal-football-sim/database";
import { resolveStoryEntityReference, storyImportanceBand } from "./story-entities.js";
import { humanizeEventType } from "./story-threads.js";

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

export const buildStoryDetail = (
  db: GameDatabase,
  event: HistoricalEvent,
  role: CareerRole,
  thread?: StoryThread,
): StoryDetail => {
  const entities = event.involvedEntities
    .map((ref) => resolveStoryEntityReference(db, ref, role))
    .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref));
  const resolved = thread ? thread.resolved : false;
  const category = thread?.category;
  const priorEvents = thread
    ? thread.events
        .filter((candidate) => candidate.id !== event.id)
        .map((candidate) => ({ date: candidate.occurredOn, headline: candidate.title }))
    : [];
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
      immediateConsequence: resolved
        ? "This is now settled and reflected in the current save state."
        : "This is still developing and may produce further events.",
      currentState: humanizeEventType(event.eventType),
    },
    contextRail: {
      entities,
      financialImpact: financialImpactFrom(event.data),
      priorEvents,
    },
  };
};
