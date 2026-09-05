import type { OwnershipAcquisitionOffer, OwnershipInvestorBidView } from "@nepal-football-sim/shared-types";
import type { MeetingOption, MeetingOutcomeEntry, MeetingTone } from "./meetings.js";

type Offer = OwnershipAcquisitionOffer;

/** The single source of truth for "what stage is this ownership negotiation
 * actually in" — derived from the real persisted status/pendingDecisionBy
 * pair, never a separate tracked value. */
export const ownershipStage = (offer: Offer): { label: string; tone: MeetingTone } => {
  if (offer.status === "COMPLETED") return { label: "Deal completed", tone: "ok" };
  if (offer.status === "REJECTED") return { label: "Rejected", tone: "bad" };
  if (offer.status === "WITHDRAWN") return { label: "Withdrawn", tone: "bad" };
  if (offer.status === "ACCEPTED") return { label: "Accepted — finalising", tone: "ok" };
  if (offer.status === "FINAL_TERMS") return { label: "Final terms — closing", tone: "warn" };
  if (offer.status === "BOARD_REVIEW") return { label: "Board review", tone: "warn" };
  if (offer.status === "DUE_DILIGENCE") return { label: "Due diligence", tone: "warn" };
  if (offer.status === "COUNTER" && offer.pendingDecisionBy === "INVESTOR") {
    return { label: "Countered — investor reviewing", tone: "info" };
  }
  if (offer.status === "COUNTER") return { label: "Countered — your move", tone: "warn" };
  return { label: "Awaiting your response", tone: "info" };
};

export const daysUntilOwnershipResponse = (worldDate: string, respondBy?: string): number | undefined => {
  if (!respondBy) return undefined;
  const days = Math.round(
    (new Date(`${respondBy}T00:00:00Z`).getTime() - new Date(`${worldDate}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  return Math.max(0, days);
};

/** Which meeting actions are real, given the real persisted state. The
 * owner's turn only exists at OFFER/COUNTER (before due diligence commits
 * both sides) and again once WITHDRAWN is still possible through every
 * non-terminal stage. */
export const ownershipOptions = (offer: Offer): MeetingOption[] => {
  const isTerminal =
    offer.status === "COMPLETED" || offer.status === "REJECTED" || offer.status === "WITHDRAWN";
  if (isTerminal) return [];
  const isOwnerTurn = offer.status === "OFFER" || (offer.status === "COUNTER" && offer.pendingDecisionBy === "OWNER");
  const options: MeetingOption[] = [];
  if (isOwnerTurn) {
    options.push(
      { id: "accept", label: "Accept", tone: "primary" },
      { id: "counter", label: "Counter valuation", tone: "neutral" },
      { id: "reject", label: "Reject", tone: "risk" },
    );
  }
  options.push({ id: "withdraw", label: "Withdraw", tone: "risk" });
  return options;
};

const narrativeForDealStructure = (offer: Offer): string =>
  offer.dealStructure === "PRIMARY_CAPITAL_INJECTION"
    ? `This is fresh capital into the club — ${(offer.capitalInjectionAmount ?? offer.offerAmount).toLocaleString()} NPR reaches club cash, and existing holders (including you) are diluted. No cash reaches you personally.`
    : offer.dealStructure === "MIXED"
      ? "This deal splits proceeds between you personally and fresh club capital."
      : `This pays you personally — ${(offer.ownerProceedsAmount ?? offer.counterAmount ?? offer.offerAmount).toLocaleString()} NPR reaches your own account, not the club's.`;

export const ownershipNarrative = (offer: Offer, worldDate: string): string[] => {
  const lines: string[] = [];
  const days = daysUntilOwnershipResponse(worldDate, offer.respondBy);

  if (offer.status === "OFFER") {
    lines.push("An investor has proposed terms for this stake.");
  }
  if (offer.status === "COUNTER" && offer.pendingDecisionBy === "INVESTOR") {
    lines.push(
      `Waiting on the investor to review your counter${days !== undefined ? ` — expected in ${days} day${days === 1 ? "" : "s"}` : ""}.`,
    );
  }
  if (offer.status === "COUNTER" && offer.pendingDecisionBy === "OWNER") {
    lines.push("The investor has revised their price — it's your move.");
  }
  if (offer.status === "DUE_DILIGENCE") {
    lines.push(
      `The investor is reviewing the club's finances and operations${days !== undefined ? ` — expected in ${days} day${days === 1 ? "" : "s"}` : ""}.`,
    );
  }
  if (offer.dueDiligenceFindings && offer.dueDiligenceFindings.length > 0 && offer.status !== "DUE_DILIGENCE") {
    lines.push(`Due diligence found: ${offer.dueDiligenceFindings.join(" ")}`);
  }
  if (offer.status === "BOARD_REVIEW") {
    lines.push("The deal is with the board for review.");
  }
  if (offer.boardStance) {
    lines.push(offer.boardStance);
  }
  if (offer.status === "FINAL_TERMS") {
    lines.push("Final terms are being drawn up ahead of completion.");
  }
  if (offer.status === "COMPLETED") {
    lines.push("This deal has been completed.");
  }
  if (offer.status === "REJECTED") {
    lines.push(offer.rationale ?? "This negotiation was rejected.");
  }
  if (offer.status === "WITHDRAWN") {
    lines.push("This negotiation was withdrawn.");
  }
  lines.push(narrativeForDealStructure(offer));
  return lines;
};

const HISTORY_ACTION_LABEL: Record<string, string> = {
  OFFER: "Proposed",
  ACCEPT: "Accepted",
  REJECT: "Rejected",
  COUNTER: "Countered",
  WITHDRAW: "Withdrawn",
  DUE_DILIGENCE: "Due diligence",
  BOARD_REVIEW: "Board review",
};

const HISTORY_ACTION_TONE: Record<string, MeetingTone> = {
  OFFER: "info",
  ACCEPT: "ok",
  REJECT: "bad",
  COUNTER: "warn",
  WITHDRAW: "bad",
  DUE_DILIGENCE: "warn",
  BOARD_REVIEW: "warn",
};

const ACTOR_LABEL: Record<string, string> = {
  OWNER: "you",
  INVESTOR: "the investor",
  BOARD: "the board",
  SYSTEM: "the deal",
};

/** Minority / significant-minority / blocking / controlling — the real
 * governance consequence of a stake size, given the club's own majority
 * threshold. Mirrors the backend's describeOwnershipControl exactly so the
 * label shown here can never drift from what the backend would say. */
export const describeOwnershipControl = (
  percentage: number,
  majorityThreshold = 51,
): { label: string; detail: string } => {
  if (percentage >= majorityThreshold) {
    return { label: "Controlling stake", detail: "Would take majority control of the club." };
  }
  if (percentage >= 25) {
    return {
      label: "Significant minority",
      detail: "Large enough to influence major decisions without controlling them.",
    };
  }
  if (percentage >= 10) {
    return { label: "Minority investor", detail: "A meaningful stake, but no special influence." };
  }
  return { label: "Small minority", detail: "A limited financial interest with no real influence." };
};

export const ownershipHistoryEntries = (bid: OwnershipInvestorBidView): MeetingOutcomeEntry[] =>
  bid.negotiation.map((round) => ({
    date: round.createdAt,
    label: HISTORY_ACTION_LABEL[round.action] ?? round.action.replace(/_/g, " ").toLowerCase(),
    tone: HISTORY_ACTION_TONE[round.action] ?? "info",
    detail: `${ACTOR_LABEL[round.actor] ?? round.actor.toLowerCase()} — ${round.message}`,
  }));
