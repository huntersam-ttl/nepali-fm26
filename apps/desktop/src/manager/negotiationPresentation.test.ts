import { describe, expect, it } from "vitest";
import type { EntityId, TransferOfferView } from "@nepal-football-sim/shared-types";
import {
  negotiationHistoryEntries,
  negotiationNarrative,
  negotiationOptions,
  negotiationStage,
} from "./negotiationPresentation.js";

const baseOffer: TransferOfferView = {
  id: "offer-1" as EntityId,
  playerId: "player-1" as EntityId,
  playerName: "Test Player",
  direction: "INCOMING",
  otherClubName: "Rival FC",
  offerType: "PERMANENT",
  transferFee: 100_000,
  installments: 0,
  addOns: 0,
  sellOnPercentage: 0,
  agentFee: 0,
  signingFee: 0,
  agentContact: "SELF_REPRESENTED",
  conditionals: [],
  playerExchanges: [],
  currency: "NPR",
  status: "SUBMITTED",
  submittedAt: "2026-08-01",
  expiresAt: "2026-09-01",
  negotiation: [],
};

const offer = (overrides: Partial<TransferOfferView>): TransferOfferView => ({
  ...baseOffer,
  ...overrides,
});

const loanTerms = {
  durationMonths: 6,
  wageContributionPercent: 40,
  playingTimeExpectation: "ROTATION",
  recallOption: false,
};

describe("negotiationStage", () => {
  it("labels a fresh incoming bid as awaiting club response", () => {
    const stage = negotiationStage(
      offer({ status: "SUBMITTED", pendingDecisionBy: "CLUB", respondBy: "2026-08-03" }),
    );
    expect(stage.label).toBe("Awaiting club response");
  });

  it("distinguishes the club-agreed / personal-terms-pending phase from a plain accept", () => {
    const clubAgreed = negotiationStage(
      offer({ status: "ACCEPTED", pendingDecisionBy: "PLAYER", respondBy: "2026-08-05" }),
    );
    expect(clubAgreed.label).toMatch(/personal terms/i);
    expect(clubAgreed.label).not.toBe("Accepted");

    const plainAccepted = negotiationStage(offer({ status: "ACCEPTED", pendingDecisionBy: undefined }));
    expect(plainAccepted.label).toBe("Accepted");
  });

  it("gives a loan counter a distinct label from a permanent-transfer counter", () => {
    const loanCounter = negotiationStage(offer({ status: "COUNTERED", loanTerms }));
    const permanentCounter = negotiationStage(offer({ status: "COUNTERED", loanTerms: undefined }));
    expect(loanCounter.label).not.toBe(permanentCounter.label);
    expect(loanCounter.label).toMatch(/your move/i);
  });

  it("marks terminal states with the matching tone", () => {
    expect(negotiationStage(offer({ status: "COMPLETED" })).tone).toBe("ok");
    expect(negotiationStage(offer({ status: "REJECTED" })).tone).toBe("bad");
    expect(negotiationStage(offer({ status: "WITHDRAWN" })).tone).toBe("bad");
  });
});

describe("negotiationOptions", () => {
  it("offers only Withdraw for our own pending permanent bid", () => {
    const options = negotiationOptions(
      offer({ direction: "INCOMING", status: "SUBMITTED", pendingDecisionBy: "CLUB" }),
    );
    expect(options.map((option) => option.id)).toEqual(["withdraw"]);
  });

  it("still allows Withdraw while personal terms are pending, but nothing else", () => {
    const options = negotiationOptions(
      offer({ direction: "INCOMING", status: "ACCEPTED", pendingDecisionBy: "PLAYER" }),
    );
    expect(options.map((option) => option.id)).toEqual(["withdraw"]);
  });

  it("gives the selling club Accept/Counter/Reject only while the bid is fresh", () => {
    const fresh = negotiationOptions(offer({ direction: "OUTGOING", status: "SUBMITTED" }));
    expect(fresh.map((option) => option.id).sort()).toEqual(["accept", "counter", "reject"]);

    const alreadyCountered = negotiationOptions(offer({ direction: "OUTGOING", status: "COUNTERED" }));
    expect(alreadyCountered).toEqual([]);
  });

  it("gives the buying club Accept-counter/Revise/Withdraw once a loan is countered", () => {
    const options = negotiationOptions(
      offer({ direction: "INCOMING", status: "COUNTERED", loanTerms }),
    );
    expect(options.map((option) => option.id).sort()).toEqual(["accept-counter", "counter", "withdraw"]);
  });

  it("gives the parent club (not us) no manager action on its own pending loan decision", () => {
    const options = negotiationOptions(
      offer({ direction: "OUTGOING", status: "SUBMITTED", loanTerms }),
    );
    expect(options).toEqual([]);
  });

  it("is read-only for every terminal state, loan or permanent", () => {
    for (const status of ["COMPLETED", "REJECTED", "WITHDRAWN"] as const) {
      expect(negotiationOptions(offer({ status }))).toEqual([]);
      expect(negotiationOptions(offer({ status, loanTerms }))).toEqual([]);
    }
  });
});

describe("negotiationNarrative", () => {
  it("flags an offer below the known asking range without fabricating a number outside it", () => {
    const lines = negotiationNarrative(
      offer({
        status: "SUBMITTED",
        pendingDecisionBy: "CLUB",
        transferFee: 50,
        askingRange: { min: 100, max: 200 },
      }),
      "2026-08-01",
    );
    expect(lines.some((line) => /below their preferred range/i.test(line))).toBe(true);
  });

  it("names the actual wage percentage a loan counter demands", () => {
    const lines = negotiationNarrative(
      offer({ status: "COUNTERED", loanTerms: { ...loanTerms, wageContributionPercent: 65 } }),
      "2026-08-01",
    );
    expect(lines.some((line) => line.includes("65%"))).toBe(true);
  });

  it("describes the personal-terms phase without inventing wage/duration figures that aren't persisted", () => {
    const lines = negotiationNarrative(
      offer({ status: "ACCEPTED", pendingDecisionBy: "PLAYER" }),
      "2026-08-01",
    );
    expect(lines.some((line) => /personal terms/i.test(line))).toBe(true);
    expect(lines.join(" ")).not.toMatch(/\d+\s*(NPR|npr)/);
  });
});

describe("negotiationHistoryEntries", () => {
  it("maps raw negotiation-round actions onto human-readable labels only", () => {
    const entries = negotiationHistoryEntries(
      offer({
        negotiation: [
          { round: 1, actor: "BUYING_CLUB", action: "OFFER", message: "Opening offer" },
          { round: 2, actor: "SELLING_CLUB", action: "COUNTER", message: "Wants more" },
          { round: 3, actor: "SELLING_CLUB", action: "ACCEPT", message: "Deal done" },
        ],
      }),
    );
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      // No raw enum text (all-caps with underscores) should leak into the label.
      expect(entry.label).not.toMatch(/^[A-Z_]+$/);
    }
    expect(entries[1]!.label).toBe("Countered");
    expect(entries[2]!.label).toBe("Accepted");
  });
});
