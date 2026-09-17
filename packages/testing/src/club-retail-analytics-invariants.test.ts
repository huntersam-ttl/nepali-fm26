import { describe, expect, it } from "vitest";
import {
  KIT_SLOT_SHARES,
  SHIRT_REVENUE_SHARE,
  merchandiseUnitPrice,
  shirtSalesFromRevenue,
} from "@nepal-football-sim/simulation";

/**
 * Phase 1C invariants for the shirt-sales analytics layer.
 *
 * These are deliberately property-style rather than golden-value: the
 * analytics layer is pure and total, so the interesting claims are the
 * ones that must hold for *every* revenue/appeal pair the economy can
 * produce, not for one hand-picked triple. The layer derives units from
 * real MERCHANDISE ledger revenue — it never posts revenue itself — so
 * "shirts are a strict subset of merchandise" is a correctness property,
 * not a style preference.
 */

// Spans the realistic economy range: a newly founded club sits at
// merchandiseAppeal 0.5, a generated Nepal club starts in the single
// digits, and the RETAIL_STORE lever is capped at 100.
const APPEALS = [0, 0.5, 1, 6.4, 20, 47.5, 80, 99.9, 100] as const;
const REVENUES = [0, 1, 7, 137, 51_712, 250_000, 3_400_000, 91_000_000] as const;

describe("club retail analytics invariants", () => {
  it("never reports more shirt revenue than the merchandise revenue it is derived from", () => {
    for (const merchandiseRevenue of REVENUES) {
      for (const merchandiseAppeal of APPEALS) {
        const split = shirtSalesFromRevenue({ merchandiseRevenue, merchandiseAppeal });
        expect(split.shirtRevenue).toBeLessThanOrEqual(merchandiseRevenue);
      }
    }
    // Shirts are a bounded share, so general merchandise always retains a
    // real remainder — a club never sells "only shirts".
    expect(SHIRT_REVENUE_SHARE).toBeGreaterThan(0);
    expect(SHIRT_REVENUE_SHARE).toBeLessThan(1);
  });

  it("splits every total exactly across Home, Away and Third with no lost or invented unit", () => {
    for (const merchandiseRevenue of REVENUES) {
      for (const merchandiseAppeal of APPEALS) {
        const split = shirtSalesFromRevenue({ merchandiseRevenue, merchandiseAppeal });
        expect(
          split.homeShirtUnits + split.awayShirtUnits + split.thirdShirtUnits,
          `slots must sum to the total for revenue=${merchandiseRevenue} appeal=${merchandiseAppeal}`,
        ).toBe(split.shirtUnits);
      }
    }
  });

  it("keeps every reported figure finite and non-negative", () => {
    for (const merchandiseRevenue of REVENUES) {
      for (const merchandiseAppeal of APPEALS) {
        const split = shirtSalesFromRevenue({ merchandiseRevenue, merchandiseAppeal });
        for (const [field, value] of Object.entries(split)) {
          expect(Number.isFinite(value), `${field} must be finite`).toBe(true);
          expect(Number.isNaN(value), `${field} must not be NaN`).toBe(false);
          expect(value, `${field} must not be negative`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("reports clean zeros for a club that has never traded, rather than a fabricated baseline", () => {
    for (const merchandiseAppeal of APPEALS) {
      expect(shirtSalesFromRevenue({ merchandiseRevenue: 0, merchandiseAppeal })).toEqual({
        shirtRevenue: 0,
        shirtUnits: 0,
        homeShirtUnits: 0,
        awayShirtUnits: 0,
        thirdShirtUnits: 0,
      });
    }
  });

  it("treats a negative merchandise figure as no shirt trade instead of negative units", () => {
    // The canonical ledger posts merchandise as CREDIT, so a negative
    // total should not arise; if it ever does, the analytics must degrade
    // to zero rather than report negative shirts sold.
    const split = shirtSalesFromRevenue({ merchandiseRevenue: -50_000, merchandiseAppeal: 40 });
    expect(split.shirtUnits).toBe(0);
    expect(split.shirtRevenue).toBe(0);
  });

  it("sells Home most, then Away, then Third, for any club with real shirt trade", () => {
    for (const merchandiseRevenue of [51_712, 250_000, 3_400_000] as const) {
      for (const merchandiseAppeal of [1, 6.4, 47.5, 100] as const) {
        const split = shirtSalesFromRevenue({ merchandiseRevenue, merchandiseAppeal });
        if (split.shirtUnits < 3) continue; // too small to rank meaningfully
        expect(split.homeShirtUnits).toBeGreaterThanOrEqual(split.awayShirtUnits);
        expect(split.awayShirtUnits).toBeGreaterThanOrEqual(split.thirdShirtUnits);
      }
    }
    expect(KIT_SLOT_SHARES.home).toBeGreaterThan(KIT_SLOT_SHARES.away);
    expect(KIT_SLOT_SHARES.away).toBeGreaterThan(KIT_SLOT_SHARES.third);
    expect(KIT_SLOT_SHARES.home + KIT_SLOT_SHARES.away + KIT_SLOT_SHARES.third).toBeCloseTo(1, 10);
  });

  it("mirrors the canonical merchandise unit price rather than inventing a second pricing model", () => {
    // postMerchandiseRevenue computes amount as units * round(180 + appeal * 35).
    // The analytics layer must price replica shirts off that same figure,
    // or reported units would drift from the revenue they came from.
    for (const merchandiseAppeal of APPEALS) {
      expect(merchandiseUnitPrice(merchandiseAppeal)).toBe(Math.round(180 + merchandiseAppeal * 35));
    }
  });

  it("reports fewer units for the same revenue when shirts are more expensive", () => {
    const cheap = shirtSalesFromRevenue({ merchandiseRevenue: 3_400_000, merchandiseAppeal: 1 });
    const dear = shirtSalesFromRevenue({ merchandiseRevenue: 3_400_000, merchandiseAppeal: 100 });
    expect(dear.shirtUnits).toBeLessThan(cheap.shirtUnits);
    // ...but the money split is unaffected by price, since it is a share
    // of real posted revenue.
    expect(dear.shirtRevenue).toBe(cheap.shirtRevenue);
  });

  it("is deterministic — the same inputs always produce the same split", () => {
    for (const merchandiseRevenue of REVENUES) {
      const first = shirtSalesFromRevenue({ merchandiseRevenue, merchandiseAppeal: 6.4 });
      const second = shirtSalesFromRevenue({ merchandiseRevenue, merchandiseAppeal: 6.4 });
      expect(first).toEqual(second);
    }
  });
});
