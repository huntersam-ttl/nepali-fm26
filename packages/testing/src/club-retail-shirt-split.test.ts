import { describe, expect, it } from "vitest";
import {
  KIT_SLOT_SHARES,
  SHIRT_REVENUE_SHARE,
  merchandiseUnitPrice,
  shirtSalesFromRevenue,
} from "@nepal-football-sim/simulation";

/**
 * The shirt-sales split is an analytics layer over revenue the canonical
 * economy has already earned and posted to the MERCHANDISE ledger — it
 * never invents money. These are pure-function tests (no save, no DB),
 * so they run in milliseconds rather than the ~15s a real world-creation
 * test costs.
 */

describe("club retail — replica shirt split over real merchandise revenue", () => {
  it("never claims all merchandise revenue is shirts", () => {
    expect(SHIRT_REVENUE_SHARE).toBeGreaterThan(0);
    expect(SHIRT_REVENUE_SHARE).toBeLessThan(1);
    const split = shirtSalesFromRevenue({ merchandiseRevenue: 1_000_000, merchandiseAppeal: 40 });
    expect(split.shirtRevenue).toBeLessThan(1_000_000);
    expect(split.shirtRevenue).toBe(Math.round(1_000_000 * SHIRT_REVENUE_SHARE));
  });

  it("always splits into slot counts that sum to the total exactly, across a wide range of revenue", () => {
    // Proportional rounding drifts unless the remainder is absorbed
    // deliberately — a dashboard whose subtotals don't add up to its own
    // total reads as a bug even when the underlying money is right.
    for (const revenue of [1, 999, 5_000, 123_457, 1_000_000, 7_654_321]) {
      for (const appeal of [0, 3, 27.5, 60, 100]) {
        const split = shirtSalesFromRevenue({ merchandiseRevenue: revenue, merchandiseAppeal: appeal });
        expect(
          split.homeShirtUnits + split.awayShirtUnits + split.thirdShirtUnits,
          `revenue ${revenue} / appeal ${appeal} must sum exactly`,
        ).toBe(split.shirtUnits);
        expect(split.homeShirtUnits).toBeGreaterThanOrEqual(0);
        expect(split.awayShirtUnits).toBeGreaterThanOrEqual(0);
        expect(split.thirdShirtUnits).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("sells more Home than Away, and more Away than Third, at meaningful volume", () => {
    const split = shirtSalesFromRevenue({ merchandiseRevenue: 5_000_000, merchandiseAppeal: 30 });
    expect(split.shirtUnits).toBeGreaterThan(50);
    expect(split.homeShirtUnits).toBeGreaterThan(split.awayShirtUnits);
    expect(split.awayShirtUnits).toBeGreaterThan(split.thirdShirtUnits);
    expect(KIT_SLOT_SHARES.home).toBeGreaterThan(KIT_SLOT_SHARES.away);
    expect(KIT_SLOT_SHARES.away).toBeGreaterThan(KIT_SLOT_SHARES.third);
  });

  it("mirrors the canonical merchandise unit price exactly, so units invert real revenue rather than a parallel price model", () => {
    // postMerchandiseRevenue prices a unit at `180 + merchandiseAppeal * 35`.
    expect(merchandiseUnitPrice(0)).toBe(180);
    expect(merchandiseUnitPrice(40)).toBe(180 + 40 * 35);
  });

  it("derives fewer, pricier shirts as appeal rises, for identical revenue", () => {
    const cheap = shirtSalesFromRevenue({ merchandiseRevenue: 2_000_000, merchandiseAppeal: 5 });
    const premium = shirtSalesFromRevenue({ merchandiseRevenue: 2_000_000, merchandiseAppeal: 80 });
    expect(cheap.shirtRevenue).toBe(premium.shirtRevenue);
    expect(premium.shirtUnits).toBeLessThan(cheap.shirtUnits);
  });

  it("returns a clean zero rather than NaN or negative units for a club with no merchandise trade", () => {
    for (const revenue of [0, -1]) {
      const split = shirtSalesFromRevenue({ merchandiseRevenue: revenue, merchandiseAppeal: 20 });
      expect(split).toEqual({
        shirtRevenue: 0,
        shirtUnits: 0,
        homeShirtUnits: 0,
        awayShirtUnits: 0,
        thirdShirtUnits: 0,
      });
    }
  });

  it("is deterministic — the same revenue and appeal always produce the same split", () => {
    const a = shirtSalesFromRevenue({ merchandiseRevenue: 812_345, merchandiseAppeal: 33 });
    const b = shirtSalesFromRevenue({ merchandiseRevenue: 812_345, merchandiseAppeal: 33 });
    expect(a).toEqual(b);
  });
});
