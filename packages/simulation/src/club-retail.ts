/**
 * Club retail analytics — a presentation/analytics layer over the club's
 * REAL merchandise revenue, never a second revenue engine.
 *
 * The canonical money is already posted by `postMerchandiseRevenue`
 * (club-economy.ts) into the `MERCHANDISE` ledger category every month,
 * via the canonical monthly `processClubEconomyMonth` tick. Nothing in
 * this module posts, mutates, or re-derives a single rupee: it takes
 * revenue that has already happened and answers "roughly how many
 * replica shirts does that represent, and how do they split across
 * Home/Away/Third?" so the Owner's commercial dashboard can show
 * something more concrete than one undifferentiated revenue number.
 *
 * Every constant here is SIMULATION_ONLY. None of it is a real-world
 * merchandise statistic, and none of it is presented to the player as a
 * verified fact about any real club.
 */

/**
 * The share of total merchandise revenue attributed to replica shirts.
 *
 * `postMerchandiseRevenue`'s own description is explicit that its figure
 * covers "shirts, scarves and digital products" — so treating all of it
 * as shirts would misrepresent the canonical model. 0.55 keeps replica
 * shirts the single largest line without pretending the rest of the
 * range doesn't exist.
 */
export const SHIRT_REVENUE_SHARE = 0.55;

/**
 * A replica shirt is a premium item relative to the *average*
 * merchandise unit priced by `merchandiseUnitPrice` (which averages
 * shirts together with cheaper scarves/digital items). This lifts the
 * shirt's assumed price above that blended average so the derived unit
 * count isn't inflated by pricing shirts as if they were keyrings.
 */
export const SHIRT_PRICE_PREMIUM = 1.6;

/**
 * Deterministic Home/Away/Third split. Home is the default replica a
 * supporter buys first, Away is the common second shirt, Third is a
 * minority purchase. Fixed rather than derived: the alternative would
 * be scoring kits on appearance, which this project deliberately does
 * not do (no aesthetic/visual rating of a player's own kit designs).
 */
export const KIT_SLOT_SHARES = { home: 0.58, away: 0.27, third: 0.15 } as const;

/**
 * The canonical average price of one merchandise unit, mirroring
 * `postMerchandiseRevenue`'s own `180 + merchandiseAppeal * 35`
 * exactly. Duplicated here (rather than imported) for the same reason
 * the deterministic colour maths is duplicated between the browser
 * bundle and the Node package: both copies must stay numerically
 * identical, and this one exists purely to *invert* the canonical
 * revenue figure back into an approximate unit count.
 */
export const merchandiseUnitPrice = (merchandiseAppeal: number): number =>
  Math.round(180 + merchandiseAppeal * 35);

/**
 * Recovers the merchandise appeal a *past* posting was actually earned at,
 * from canonical data the game already stores.
 *
 * `postMerchandiseRevenue` records every merchandise posting twice: the
 * money into the `MERCHANDISE` ledger, and a `CommercialHistoryEvent`
 * carrying the same `amount` plus `audienceImpact` — the real unit count
 * sold at that moment. Because the canonical price is
 * `amount = units * round(180 + appeal * 35)`, dividing the stored amount
 * by the stored units recovers that posting's unit price, and inverting
 * the formula recovers the appeal behind it — exactly, with no new
 * storage, no snapshot column, and no duplicated finance history.
 *
 * Returns `undefined` when the pairing can't be trusted (no units, no
 * money, or a non-finite result), so callers fall back to the club's
 * present-day appeal — which is what a genuine pre-feature save, with
 * ledger rows but no commercial-history rows, will do.
 */
export const appealFromMerchandiseTrade = (input: {
  amount: number;
  units: number;
}): number | undefined => {
  if (!(input.units > 0) || !(input.amount > 0)) return undefined;
  const unitPrice = input.amount / input.units;
  const appeal = (unitPrice - 180) / 35;
  if (!Number.isFinite(appeal)) return undefined;
  return Math.min(100, Math.max(0, appeal));
};

export type ShirtSalesSplit = {
  /** Revenue attributed to replica shirts, out of total merchandise revenue. */
  shirtRevenue: number;
  /** Approximate replica shirts sold — always equals home + away + third. */
  shirtUnits: number;
  homeShirtUnits: number;
  awayShirtUnits: number;
  thirdShirtUnits: number;
};

/**
 * Splits a real, already-earned merchandise revenue figure into an
 * approximate replica-shirt breakdown.
 *
 * The three slot counts are guaranteed to sum to `shirtUnits` exactly —
 * proportional rounding would otherwise drift by a unit or two and make
 * the dashboard's own subtotals disagree with its total, which reads as
 * a bug to a player even though the underlying money is correct.
 */
export const shirtSalesFromRevenue = (input: {
  merchandiseRevenue: number;
  merchandiseAppeal: number;
}): ShirtSalesSplit => {
  if (input.merchandiseRevenue <= 0) {
    return { shirtRevenue: 0, shirtUnits: 0, homeShirtUnits: 0, awayShirtUnits: 0, thirdShirtUnits: 0 };
  }
  const shirtRevenue = Math.round(input.merchandiseRevenue * SHIRT_REVENUE_SHARE);
  const unitPrice = Math.max(1, Math.round(merchandiseUnitPrice(input.merchandiseAppeal) * SHIRT_PRICE_PREMIUM));
  const shirtUnits = Math.max(0, Math.round(shirtRevenue / unitPrice));
  // Home absorbs the rounding remainder so the parts always sum to the
  // whole, rather than each slot rounding independently.
  const awayShirtUnits = Math.round(shirtUnits * KIT_SLOT_SHARES.away);
  const thirdShirtUnits = Math.round(shirtUnits * KIT_SLOT_SHARES.third);
  const homeShirtUnits = Math.max(0, shirtUnits - awayShirtUnits - thirdShirtUnits);
  return { shirtRevenue, shirtUnits, homeShirtUnits, awayShirtUnits, thirdShirtUnits };
};
