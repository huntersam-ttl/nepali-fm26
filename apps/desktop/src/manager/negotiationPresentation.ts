import type { TransferOfferView } from "@nepal-football-sim/shared-types";
import type { MeetingOption, MeetingOutcomeEntry, MeetingTone } from "./meetings.js";

/**
 * The single source of truth for "what stage is this negotiation actually
 * in" — derived from the real persisted status/pendingDecisionBy pair, never
 * a separate tracked value. TransferOfferStatus alone is not enough: a club
 * that has agreed a fee stays status "ACCEPTED" while personal terms are
 * pending (pendingDecisionBy "PLAYER"), so that combination is its own
 * distinct, real stage — not "in progress" or, worse, "accepted" read as
 * completed.
 */
export const negotiationStage = (
  offer: TransferOfferView,
): { label: string; tone: MeetingTone } => {
  if (offer.status === "COMPLETED") return { label: "Completed", tone: "ok" };
  if (offer.status === "REJECTED") return { label: "Rejected", tone: "bad" };
  if (offer.status === "WITHDRAWN") return { label: "Withdrawn", tone: "bad" };
  if (offer.status === "ACCEPTED" && offer.pendingDecisionBy === "PLAYER") {
    return { label: "Club agreed — discussing personal terms", tone: "warn" };
  }
  if (offer.status === "ACCEPTED") return { label: "Accepted", tone: "ok" };
  if (offer.status === "COUNTERED" && offer.loanTerms) {
    return { label: "Parent club countered — your move", tone: "warn" };
  }
  if (offer.status === "COUNTERED") return { label: "Countered — awaiting response", tone: "warn" };
  if (offer.status === "SUBMITTED" && offer.pendingDecisionBy === "CLUB") {
    return { label: "Awaiting club response", tone: "info" };
  }
  return { label: "In progress", tone: "info" };
};

/** Days remaining until the next scheduled AI decision, or undefined when
 * nothing is currently pending (terminal state, or it's the manager's own
 * move to make right now). */
export const daysUntilResponse = (worldDate: string, respondBy?: string): number | undefined => {
  if (!respondBy) return undefined;
  const days = Math.round(
    (new Date(`${respondBy}T00:00:00Z`).getTime() - new Date(`${worldDate}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  return Math.max(0, days);
};

/**
 * Short narrative lines describing the negotiation, built strictly from the
 * real offer fields (status, loanTerms, askingRange, respondBy) — never a
 * fabricated story that could contradict what actually happened.
 */
export const negotiationNarrative = (
  offer: TransferOfferView,
  worldDate: string,
): string[] => {
  const lines: string[] = [];
  const isLoan = Boolean(offer.loanTerms);
  const isOurBid = offer.direction === "INCOMING";

  if (offer.status === "SUBMITTED" && offer.pendingDecisionBy === "CLUB") {
    const days = daysUntilResponse(worldDate, offer.respondBy);
    lines.push(
      isOurBid
        ? `Waiting on ${offer.otherClub?.label ?? offer.otherClubName ?? "the other club"} to review ${isLoan ? "the loan proposal" : "the offer"}${days !== undefined ? ` — expected in ${days} day${days === 1 ? "" : "s"}` : ""}.`
        : `You are reviewing this ${isLoan ? "loan enquiry" : "offer"} — a response is expected from you.`,
    );
    if (!isLoan && offer.askingRange) {
      const withinRange = offer.transferFee >= offer.askingRange.min;
      lines.push(
        withinRange
          ? "Your offer sits within their known asking range."
          : "The selling club considers your offer below their preferred range.",
      );
    }
  }

  if (offer.status === "COUNTERED" && isLoan) {
    lines.push(
      isOurBid
        ? `The parent club wants a higher wage contribution — ${offer.loanTerms!.wageContributionPercent}% instead of what you proposed.`
        : "You have countered the loan terms — waiting on the other club to respond.",
    );
  } else if (offer.status === "COUNTERED") {
    lines.push(
      isOurBid
        ? "The selling club has countered your offer."
        : "You have countered — waiting on the buying club to respond.",
    );
  }

  if (offer.status === "ACCEPTED" && offer.pendingDecisionBy === "PLAYER") {
    lines.push(
      "The selling club has agreed a fee. The player is open to the move but personal terms — wages, contract length and squad role — are still being discussed with the player and their representation.",
    );
  }

  if (offer.status === "ACCEPTED" && !offer.pendingDecisionBy && !isLoan) {
    lines.push("The club has agreed personal terms — the move is finalising.");
  }

  if (offer.status === "COMPLETED") {
    lines.push(isLoan ? "The loan is agreed and the player has moved." : "The transfer is complete.");
  }

  if (offer.status === "REJECTED") {
    lines.push(
      isLoan
        ? "The parent club declined the loan proposal."
        : "The offer was rejected.",
    );
  }

  if (offer.status === "WITHDRAWN") {
    lines.push(isOurBid ? "You withdrew this proposal." : "The buying club withdrew its offer.");
  }

  if (offer.playerExchanges.length > 0) {
    lines.push(`${offer.playerExchanges.length} player exchange clause(s) are part of the package.`);
  }
  if (offer.conditionals.length > 0) {
    lines.push(`${offer.conditionals.length} conditional bonus clause(s) attached.`);
  }

  return lines;
};

/**
 * Which meeting actions are real, given the real persisted state — never a
 * fixed per-type list. A terminal offer (completed/rejected/withdrawn) is
 * always read-only. A permanent transfer's AI club-side decision never
 * counters (only accepts/rejects — see evaluateTransferOffer), so an
 * incoming bid never gets a "counter" option; only the selling club (an
 * outgoing bid, fresh and unanswered) can counter, improve the ask, accept
 * or reject. A loan the manager proposed only gets a manager-side response
 * once the parent club has actually countered.
 */
export const negotiationOptions = (offer: TransferOfferView): MeetingOption[] => {
  const isLoan = Boolean(offer.loanTerms);
  const isOurBid = offer.direction === "INCOMING";
  const isTerminal =
    offer.status === "COMPLETED" || offer.status === "REJECTED" || offer.status === "WITHDRAWN";
  if (isTerminal) return [];

  if (isLoan) {
    if (!isOurBid) return []; // The parent club's decision is an AI move, not a manager action.
    if (offer.status === "COUNTERED") {
      return [
        {
          id: "accept-counter",
          label: `Accept ${offer.loanTerms!.wageContributionPercent}% wage contribution`,
          tone: "primary",
        },
        { id: "counter", label: "Revise proposal", tone: "neutral" },
        { id: "withdraw", label: "Withdraw enquiry", tone: "risk" },
      ];
    }
    return [{ id: "withdraw", label: "Withdraw enquiry", tone: "risk" }];
  }

  if (isOurBid) {
    const canWithdraw =
      offer.status === "SUBMITTED" || (offer.status === "ACCEPTED" && offer.pendingDecisionBy === "PLAYER");
    return canWithdraw ? [{ id: "withdraw", label: "Withdraw offer", tone: "risk" }] : [];
  }

  if (offer.status === "SUBMITTED") {
    return [
      { id: "accept", label: "Accept", tone: "primary" },
      { id: "counter", label: "Counter (raise ask)", tone: "neutral" },
      { id: "reject", label: "Reject", tone: "risk" },
    ];
  }
  return [];
};

const HISTORY_ACTION_LABEL: Record<string, string> = {
  SUBMIT: "Submitted",
  OFFER: "Submitted",
  ACCEPT: "Accepted",
  REJECT: "Rejected",
  COUNTER: "Countered",
  DEMAND: "Terms proposed",
  WALK_AWAY: "Withdrawn",
};

const HISTORY_ACTION_TONE: Record<string, MeetingTone> = {
  ACCEPT: "ok",
  REJECT: "bad",
  COUNTER: "warn",
  DEMAND: "info",
  SUBMIT: "info",
  OFFER: "info",
  WALK_AWAY: "bad",
};

/** Maps the real persisted negotiation-round log onto the Meeting
 * framework's chronological history entries — human-readable labels only,
 * no raw enum values. */
export const negotiationHistoryEntries = (
  offer: TransferOfferView,
): MeetingOutcomeEntry[] =>
  offer.negotiation.map((round) => ({
    date: offer.submittedAt,
    label: HISTORY_ACTION_LABEL[round.action] ?? round.action.replace(/_/g, " ").toLowerCase(),
    tone: HISTORY_ACTION_TONE[round.action] ?? "info",
    detail: `${round.actor.replace(/_/g, " ").toLowerCase()}${round.message ? ` — ${round.message}` : ""}`,
  }));
