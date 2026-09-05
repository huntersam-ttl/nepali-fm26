import type { OwnershipInvestorStance } from "@nepal-football-sim/shared-types";

const STANCES: OwnershipInvestorStance[] = [
  "GROWTH",
  "CONTROL_SEEKING",
  "CONSERVATIVE",
  "INFRASTRUCTURE_FOCUSED",
  "TURNAROUND",
];

/**
 * A deterministic, SIMULATION_ONLY negotiating personality for a generated
 * investor bid — a hash of a stable key (the offer id), never randomness or
 * any claim about a real company/person. The same offer always gets the
 * same stance across reloads.
 */
export const investorStanceFor = (seedKey: string): OwnershipInvestorStance => {
  let hash = 0;
  for (let i = 0; i < seedKey.length; i += 1) {
    hash = (hash * 31 + seedKey.charCodeAt(i)) >>> 0;
  }
  return STANCES[hash % STANCES.length]!;
};

export type InvestorStanceProfile = {
  /** How far above their own initial offer this investor will ultimately
   * stretch, as a fraction (0.15 = 15% above their own first number). */
  valuationToleranceAboveOwnOffer: number;
  /** Multiplier applied to how much a due-diligence finding actually moves
   * this investor's valuation/patience — a turnaround investor expects
   * distress and is barely moved by it; a conservative investor is not. */
  dueDiligenceSensitivity: number;
  /** Whether fresh capital into the club appeals to this investor more than
   * paying an existing owner directly. */
  prefersCapitalInjection: boolean;
  /** Extra counter-rounds this investor is willing to sit through before
   * walking away, independent of the hard MAX_NEGOTIATION_ROUNDS cap. */
  counterPersistence: number;
  /** Whether this investor is likely to ask for a board seat as part of
   * their own terms. */
  boardSeatLikely: boolean;
  /** A short, human description used in narrative text — never presented
   * as fact about a real company. */
  description: string;
};

export const stanceProfile = (stance: OwnershipInvestorStance): InvestorStanceProfile => {
  switch (stance) {
    case "GROWTH":
      return {
        valuationToleranceAboveOwnOffer: 0.16,
        dueDiligenceSensitivity: 0.9,
        prefersCapitalInjection: false,
        counterPersistence: 2,
        boardSeatLikely: false,
        description: "focused on growth potential",
      };
    case "CONTROL_SEEKING":
      return {
        valuationToleranceAboveOwnOffer: 0.22,
        dueDiligenceSensitivity: 1.0,
        prefersCapitalInjection: false,
        counterPersistence: 3,
        boardSeatLikely: true,
        description: "seeking real control of the club",
      };
    case "CONSERVATIVE":
      return {
        valuationToleranceAboveOwnOffer: 0.08,
        dueDiligenceSensitivity: 1.4,
        prefersCapitalInjection: false,
        counterPersistence: 1,
        boardSeatLikely: false,
        description: "cautious and risk-averse",
      };
    case "INFRASTRUCTURE_FOCUSED":
      return {
        valuationToleranceAboveOwnOffer: 0.18,
        dueDiligenceSensitivity: 0.9,
        prefersCapitalInjection: true,
        counterPersistence: 2,
        boardSeatLikely: false,
        description: "interested in facilities and infrastructure growth",
      };
    case "TURNAROUND":
      return {
        valuationToleranceAboveOwnOffer: 0.28,
        dueDiligenceSensitivity: 0.5,
        prefersCapitalInjection: true,
        counterPersistence: 3,
        boardSeatLikely: false,
        description: "looking for a turnaround opportunity, undeterred by financial distress",
      };
  }
};

/** Never more than this many owner<->investor counter rounds — beyond this
 * the investor must accept, reject, or the owner must withdraw. Keeps
 * multi-round haggling genuinely bounded rather than endless. */
export const MAX_NEGOTIATION_ROUNDS = 4;

export type InvestorCounterEvaluation =
  | { decision: "ACCEPT" }
  | { decision: "COUNTER"; amount: number }
  | { decision: "WALK"; reason: string };

/**
 * The investor's response to the owner's latest counter — genuinely
 * bounded multi-round haggling: the investor stretches partway toward the
 * owner's ask each round, tightening as rounds pass (deadline pressure /
 * diminishing willingness to move), until either side's number is
 * acceptable or the round/persistence limit is hit.
 */
export const evaluateInvestorCounter = (input: {
  initialOfferAmount: number;
  ownerAsk: number;
  profile: InvestorStanceProfile;
  roundCount: number;
}): InvestorCounterEvaluation => {
  const { initialOfferAmount, ownerAsk, profile, roundCount } = input;
  const tightening = Math.min(0.9, roundCount * 0.04);
  const maxStretch = initialOfferAmount * (1 + Math.max(0.02, profile.valuationToleranceAboveOwnOffer - tightening));
  if (ownerAsk <= maxStretch) return { decision: "ACCEPT" };
  if (roundCount >= MAX_NEGOTIATION_ROUNDS || roundCount >= profile.counterPersistence + 1) {
    return { decision: "WALK", reason: "the gap between offers never closed" };
  }
  const revised = Math.round(Math.min(maxStretch, (initialOfferAmount + ownerAsk) / 2));
  return { decision: "COUNTER", amount: Math.max(revised, initialOfferAmount) };
};
