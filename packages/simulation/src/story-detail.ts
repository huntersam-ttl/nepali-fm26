import type { CareerRole, EntityId, HistoricalEvent, StoryDetail, StoryThread, StoryThreadCategory } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "@nepal-football-sim/database";
import { resolveStoryEntityReference, storyImportanceBand } from "./story-entities.js";
import { humanizeEventType } from "./story-threads.js";
import { buildStoryActions } from "./story-actions.js";
import { resolveStoryHeadlineNames, storyHeadline } from "./story-headline.js";
import { computePlayerMarketValue } from "./player-market-value.js";

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

/** Money formatted the one way every story fact formats it — never a second
 * currency prefix, never a raw number. */
const money = (amount: number, currency = "NPR"): string =>
  `${currency} ${Math.round(amount).toLocaleString("en-US")}`;

/** Human label for a SCREAMING_SNAKE token; already-human text is untouched. */
const label = (value: string): string =>
  /^[A-Z][A-Z0-9_]*$/.test(value) ? humanizeEventType(value) : value;

/**
 * A short, bounded, per-family list of known-safe extra facts — never a blind
 * dump of `event.data`, only fields this reader explicitly recognizes, plus
 * canonical names resolved from the event's OWN involved ids (a handful of
 * single-row lookups; never a world scan).
 *
 * Where a gameplay-useful number is genuinely absent, a conservative
 * SIMULATION_ONLY estimate may be derived from an existing canonical model
 * (player valuation) and is always labelled as an estimate — never presented
 * as a reported fact.
 */
const additionalFactsFrom = (
  db: GameDatabase,
  event: HistoricalEvent,
): { label: string; value: string }[] => {
  const data = event.data;
  const facts: { label: string; value: string }[] = [];
  const push = (name: string, value: string | undefined): void => {
    if (value !== undefined && value !== "" && !facts.some((fact) => fact.label === name))
      facts.push({ label: name, value });
  };
  const names = resolveStoryHeadlineNames(db, event);
  const type = event.eventType.toUpperCase();
  const num = (field: string): number | undefined =>
    typeof data?.[field] === "number" ? (data[field] as number) : undefined;
  const str = (field: string): string | undefined =>
    typeof data?.[field] === "string" && (data[field] as string).length > 0 ? (data[field] as string) : undefined;
  const currency = str("currency") ?? "NPR";

  // ---- TRANSFER / LOAN --------------------------------------------------
  // Ownership is excluded: CLUB_OWNERSHIP_TRANSFERRED contains "TRANSFERRED",
  // and an investor is not a player — without this, an ownership hand-over
  // showed the buyer's "market value" as if they were a transfer target.
  if (/TRANSFER|LOAN|FREE_AGENT/.test(type) && !/OWNERSHIP|INVESTOR|TAKEOVER/.test(type)) {
    push("Player", names.player);
    const fee = num("transferFee") ?? num("fee");
    if (fee !== undefined) push("Fee", money(fee, currency));
    const wage = num("wageShare") ?? num("wageContributionPercent");
    if (wage !== undefined) push("Wage contribution", `${wage}%`);
    const months = num("loanMonths") ?? num("durationMonths");
    if (months !== undefined) push("Loan duration", `${months} month${months === 1 ? "" : "s"}`);
    const respondBy = str("respondBy");
    if (respondBy) push("Respond by", respondBy);
    // Market value is a gameplay-useful number the event itself never carries.
    // Derived from the canonical valuation model as of the story's own date,
    // and always shown as an estimate (SIMULATION_ONLY), never as a fact.
    const playerId = str("playerId") ?? event.involvedEntities.find((ref) => ref.type === "person")?.id;
    if (playerId) {
      try {
        const valuation = computePlayerMarketValue(db, playerId as EntityId, event.occurredOn);
        if (valuation.currentValue > 0)
          push("Market value (estimated)", money(valuation.currentValue, valuation.currency));
      } catch {
        // A player whose valuation cannot be computed simply contributes no
        // fact — never a placeholder, never a fabricated number.
      }
    }
  }

  // ---- OWNERSHIP --------------------------------------------------------
  if (/OWNERSHIP|INVESTOR|TAKEOVER/.test(type)) {
    push("Club", names.club);
    const stake = num("percentage");
    if (stake !== undefined) push("Stake", `${stake}%`);
    const valuation = num("impliedValuation");
    if (valuation !== undefined) push("Implied valuation", money(valuation, currency));
    const proceeds = num("ownerProceedsAmount");
    if (proceeds !== undefined) push("Owner proceeds", money(proceeds, currency));
    const injection = num("capitalInjectionAmount");
    if (injection !== undefined) push("Capital injection", money(injection, currency));
    const structure = str("dealStructure");
    if (structure) push("Control consequence", label(structure));
    // `stance` is already a full human sentence at the producer — verbatim.
    push("Investor stance", str("stance"));
    const tier = str("tier");
    if (tier) push("Board position", label(tier));
    if (Array.isArray(data?.findings) && data.findings.every((item): item is string => typeof item === "string") && data.findings.length > 0)
      push("Due diligence findings", data.findings.join("; "));
  }

  // ---- FACILITY ---------------------------------------------------------
  if (/FACILITY|INFRASTRUCTURE/.test(type)) {
    const projectType = str("projectType");
    if (projectType) push("Project type", label(projectType));
    const progress = num("progress") ?? num("percentComplete");
    if (progress !== undefined) push("Project progress", `${Math.round(progress)}%`);
    const cost = num("capitalCost") ?? num("cost");
    if (cost !== undefined) push("Total cost", money(cost, currency));
    const completion = str("expectedCompletion");
    if (completion) push("Expected completion", completion);
    const funding = str("fundingSource") ?? str("fundingStatus");
    if (funding) push("Funding source", label(funding));
    const delay = num("delayDays");
    if (delay !== undefined) push("Delay", `${delay} day${delay === 1 ? "" : "s"}`);
  }

  // ---- GOVERNMENT -------------------------------------------------------
  if (/GOVERNMENT/.test(type)) {
    push("Institution", names.institution);
    push("Club", names.club);
    const requested = num("requestedAmount");
    if (requested !== undefined) push("Requested support", money(requested, currency));
    const approved = num("approvedAmount");
    if (approved !== undefined) push("Approved support", money(approved, currency));
    const contribution = num("governmentContribution");
    if (contribution !== undefined) push("Government contribution", money(contribution, currency));
    push("Site", str("municipalityName"));
  }

  // ---- COMPETITION ------------------------------------------------------
  if (/COMPETITION|CHAMPION|PROMOT|RELEGAT|QUALIFIED|SEASON/.test(type)) {
    push("Competition", names.competition);
    push("Season", names.season);
    push("Club", names.club);
    const outcome = /CHAMPION/.test(type)
      ? "Champions"
      : /PROMOT/.test(type)
        ? "Promoted"
        : /RELEGAT/.test(type)
          ? "Relegated"
          : /QUALIFIED/.test(type)
            ? "Qualified"
            : undefined;
    push("Outcome", outcome);
    const movement = str("movementType");
    if (movement) push("Tier movement", label(movement));
  }

  // ---- NATIONAL TEAM ----------------------------------------------------
  if (/NATIONAL_TEAM|CALLUP|CALL_UP/.test(type)) {
    push("Programme", names.programme ?? str("programme"));
    push("Player", names.player);
    push("Opponent", str("opponent"));
    push("Result", str("result") ?? str("scoreline"));
  }

  // ---- COMMERCIAL -------------------------------------------------------
  if (/SPONSOR|COMMERCIAL/.test(type)) {
    push("Partner", names.sponsor ?? str("sponsorName"));
    push("Club", names.club);
    const category = str("category");
    if (category) push("Property", label(category));
    push("Programme", str("programme"));
    const scope = str("scope");
    if (scope) push("Scope", label(scope));
    const annual = num("annualValue");
    if (annual !== undefined) push("Deal value", `${money(annual, currency)} / year`);
    const term = num("termYears") ?? num("term");
    if (term !== undefined) push("Duration", `${term} year${term === 1 ? "" : "s"}`);
    push("Runs until", str("endDate"));
  }

  // ---- SHARED -----------------------------------------------------------
  const status = str("status");
  if (status) push("Status", label(status));
  push("Reason", str("reason"));
  push("Deadline", str("deadline") ?? str("dueDate"));
  return facts;
};

export const buildStoryDetail = (
  db: GameDatabase,
  event: HistoricalEvent,
  role: CareerRole,
  thread?: StoryThread,
  /** Passed through to buildStoryActions for delegated-authority branches. */
  personId?: EntityId,
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
      headline: storyHeadline(db, event),
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
      additionalFacts: additionalFactsFrom(db, event),
      priorEvents,
    },
    actions: buildStoryActions(db, event, role, personId),
  };
};
