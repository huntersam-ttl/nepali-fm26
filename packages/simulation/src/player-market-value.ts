import { PlayerRepository, TransferMarketRepository, type GameDatabase } from "@nepal-football-sim/database";
import { createStableEntityId, type EntityId, type PlayerMarketValueView } from "@nepal-football-sim/shared-types";
import { calculateTransferValuation } from "./transfer-market.js";
import { homeCurrency } from "./home-context.js";

export type { PlayerMarketValueView };

const monthsBetween = (from: string, to: string): number => {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (30.44 * 86_400_000)));
};

const CLUB_STANCE_LABEL: Record<string, string> = {
  NOT_FOR_SALE: "Not actively for sale",
  AVAILABLE: "Open to offers",
  TRANSFER_LISTED: "Transfer-listed",
  LOAN_LISTED: "Available for loan",
  FREE_AGENT: "Free agent",
  CONTRACT_EXPIRING: "Contract expiring — leverage shifting to the player",
  INTERESTED_IN_MOVE: "Player has indicated interest in a move",
  UNSETTLED: "Squad status unsettled",
};

const interestSummary = (count: number): string => {
  if (count === 0) return "No active bids on record";
  if (count === 1) return "1 club showing concrete interest";
  return `${count} clubs showing concrete interest`;
};

/**
 * Reuses the canonical calculateTransferValuation factor engine (already
 * used for real offer negotiation) as a general, no-counterparty market-value
 * read — this is deliberately not a second valuation model, just a different
 * consumer of the same one. Always SIMULATION_ONLY: there is no factual
 * player market-value source for this dataset.
 */
export const computePlayerMarketValue = (
  db: GameDatabase,
  playerId: EntityId,
  worldDate: string,
): Omit<PlayerMarketValueView, "history"> => {
  const valuation = calculateTransferValuation(db, { playerId, worldDate });
  const market = new TransferMarketRepository(db);
  const status = market.transferStatus(playerId);
  const contract = market.activeContract(playerId, worldDate);
  const activeOfferCount = market
    .transferOffers()
    .filter(
      (offer) =>
        offer.playerId === playerId &&
        ["SUBMITTED", "NEGOTIATING", "COUNTERED", "PLAYER_NEGOTIATING"].includes(offer.status),
    ).length;
  return {
    playerId,
    currency: homeCurrency(db),
    currentValue: Math.round((valuation.internalValue.min + valuation.internalValue.max) / 2),
    valuationMin: valuation.internalValue.min,
    valuationMax: valuation.internalValue.max,
    askingMin: valuation.askingRange.min,
    askingMax: valuation.askingRange.max,
    clubStance: status ? (CLUB_STANCE_LABEL[status.status] ?? "Squad status unsettled") : "Not actively for sale",
    contractLeverageMonths: contract ? monthsBetween(worldDate, contract.endDate) : undefined,
    activeOfferCount,
    interestSummary: interestSummary(activeOfferCount),
    provenanceStatus: "SIMULATION_ONLY",
  };
};

/**
 * Records a valuation snapshot for the history graph, once per (player, day)
 * — the table's own UNIQUE constraint makes this idempotent, so calling it
 * on every profile view never floods the history with duplicate points.
 * Real history growth instead comes from viewing the profile on different
 * days, or from the explicit event-driven calls at season start, transfer-
 * window open, contract signing, and transfer completion.
 */
export const recordPlayerValuationSnapshot = (
  db: GameDatabase,
  playerId: EntityId,
  worldDate: string,
  reason: string,
): void => {
  const value = computePlayerMarketValue(db, playerId, worldDate);
  new PlayerRepository(db).insertPlayerValuationSnapshot({
    id: createStableEntityId("player-valuation", `${playerId}:${worldDate}`),
    playerId,
    occurredOn: worldDate,
    reason,
    currency: value.currency,
    internalMin: value.valuationMin,
    internalMax: value.valuationMax,
    askingMin: value.askingMin,
    askingMax: value.askingMax,
    provenanceStatus: "SIMULATION_ONLY",
  });
};

export const playerMarketValueView = (
  db: GameDatabase,
  playerId: EntityId,
  worldDate: string,
): PlayerMarketValueView => {
  recordPlayerValuationSnapshot(db, playerId, worldDate, "PROFILE_VIEW");
  const current = computePlayerMarketValue(db, playerId, worldDate);
  const history = new PlayerRepository(db).playerValuationHistory(playerId).reverse();
  return { ...current, history };
};
