import { describe, expect, it } from "vitest";
import type { EntityId, OwnershipAcquisitionOffer, OwnershipInvestorBidView } from "@nepal-football-sim/shared-types";
import {
  MAX_NEGOTIATION_ROUNDS,
  daysUntilOwnershipResponse,
  investorStanceLabel,
  ownershipHistoryEntries,
  ownershipNarrative,
  ownershipOptions,
  ownershipStage,
} from "./ownershipNegotiationPresentation.js";

const baseOffer: OwnershipAcquisitionOffer = {
  id: "offer-1" as EntityId,
  clubId: "club-1" as EntityId,
  buyerPersonId: "buyer-1" as EntityId,
  sellerHolderId: "seller-1" as EntityId,
  percentage: 20,
  offerAmount: 1_000_000,
  status: "OFFER",
  createdOn: "2026-08-01",
  provenanceStatus: "SIMULATION_ONLY",
};

const offer = (overrides: Partial<OwnershipAcquisitionOffer>): OwnershipAcquisitionOffer => ({
  ...baseOffer,
  ...overrides,
});

describe("ownershipStage", () => {
  it("distinguishes an owner counter awaiting the investor from an investor counter awaiting the owner", () => {
    const awaitingInvestor = ownershipStage(offer({ status: "COUNTER", pendingDecisionBy: "INVESTOR" }));
    const awaitingOwner = ownershipStage(offer({ status: "COUNTER", pendingDecisionBy: "OWNER" }));
    expect(awaitingInvestor.label).not.toBe(awaitingOwner.label);
    expect(awaitingInvestor.label).toMatch(/investor reviewing/i);
    expect(awaitingOwner.label).toMatch(/your move/i);
  });

  it("gives due diligence, board review, and final terms each a distinct label", () => {
    const labels = new Set(
      (["DUE_DILIGENCE", "BOARD_REVIEW", "FINAL_TERMS"] as const).map(
        (status) => ownershipStage(offer({ status })).label,
      ),
    );
    expect(labels.size).toBe(3);
  });

  it("marks terminal states with the matching tone", () => {
    expect(ownershipStage(offer({ status: "COMPLETED" })).tone).toBe("ok");
    expect(ownershipStage(offer({ status: "REJECTED" })).tone).toBe("bad");
    expect(ownershipStage(offer({ status: "WITHDRAWN" })).tone).toBe("bad");
  });
});

describe("ownershipOptions", () => {
  it("offers Accept/Counter/Reject/Withdraw on a fresh offer", () => {
    const options = ownershipOptions(offer({ status: "OFFER" }));
    expect(options.map((option) => option.id).sort()).toEqual(["accept", "counter", "reject", "withdraw"]);
  });

  it("is read-only except Withdraw while the investor is reviewing", () => {
    const options = ownershipOptions(offer({ status: "COUNTER", pendingDecisionBy: "INVESTOR" }));
    expect(options.map((option) => option.id)).toEqual(["withdraw"]);
  });

  it("is read-only except Withdraw during due diligence, board review, and final terms", () => {
    for (const status of ["DUE_DILIGENCE", "BOARD_REVIEW", "FINAL_TERMS"] as const) {
      expect(ownershipOptions(offer({ status })).map((option) => option.id)).toEqual(["withdraw"]);
    }
  });

  it("is fully read-only once terminal", () => {
    for (const status of ["COMPLETED", "REJECTED", "WITHDRAWN"] as const) {
      expect(ownershipOptions(offer({ status }))).toEqual([]);
    }
  });

  it("disables Counter once the round limit is reached, but Accept/Reject/Withdraw remain", () => {
    const options = ownershipOptions(offer({ status: "OFFER", negotiationRoundCount: MAX_NEGOTIATION_ROUNDS }));
    const counter = options.find((option) => option.id === "counter");
    expect(counter?.disabled).toBe(true);
    expect(options.map((option) => option.id).sort()).toEqual(["accept", "counter", "reject", "withdraw"]);
  });

  it("only offers proceed-despite-opposition or withdraw when the board has opposed a final-terms deal", () => {
    const options = ownershipOptions(offer({ status: "FINAL_TERMS", pendingDecisionBy: "OWNER" }));
    expect(options.map((option) => option.id).sort()).toEqual(["acknowledge-board-opposition", "withdraw"]);
  });
});

describe("investorStanceLabel", () => {
  it("maps every stance to a distinct, human-readable label", () => {
    const stances = ["GROWTH", "CONTROL_SEEKING", "CONSERVATIVE", "INFRASTRUCTURE_FOCUSED", "TURNAROUND"];
    const labels = new Set(stances.map((stance) => investorStanceLabel(stance)));
    expect(labels.size).toBe(stances.length);
    for (const label of labels) expect(label).not.toMatch(/^[A-Z_]+$/);
  });
});

describe("ownershipNarrative", () => {
  it("explains a primary capital injection sends money to the club, not the owner", () => {
    const lines = ownershipNarrative(
      offer({ dealStructure: "PRIMARY_CAPITAL_INJECTION", capitalInjectionAmount: 2_000_000 }),
      "2026-08-01",
    );
    const text = lines.join(" ");
    expect(text).toMatch(/club cash/i);
    expect(text).toMatch(/2,000,000/);
    expect(text).not.toMatch(/reaches your own account/i);
  });

  it("explains a secondary sale pays the owner personally", () => {
    const lines = ownershipNarrative(
      offer({ dealStructure: "SECONDARY_STAKE_SALE", ownerProceedsAmount: 1_500_000 }),
      "2026-08-01",
    );
    const text = lines.join(" ");
    expect(text).toMatch(/reaches your own account/i);
    expect(text).toMatch(/1,500,000/);
  });

  it("surfaces real due-diligence findings without fabricating numbers", () => {
    const lines = ownershipNarrative(
      offer({ status: "BOARD_REVIEW", dueDiligenceFindings: ["Club debt is high relative to cash reserves."] }),
      "2026-08-01",
    );
    expect(lines.some((line) => line.includes("Club debt is high"))).toBe(true);
  });

  it("names the investor's stance and how many negotiation rounds remain", () => {
    const lines = ownershipNarrative(
      offer({ investorStance: "CONTROL_SEEKING", negotiationRoundCount: 2 }),
      "2026-08-01",
    );
    const text = lines.join(" ");
    expect(text).toMatch(/control-seeking/i);
    expect(text).toMatch(/round 2 of/i);
  });

  it("flags a board seat request and a board-opposed final-terms gate distinctly", () => {
    const requested = ownershipNarrative(offer({ boardSeatRequested: true }), "2026-08-01").join(" ");
    expect(requested).toMatch(/board seat/i);
    const opposed = ownershipNarrative(offer({ status: "FINAL_TERMS", pendingDecisionBy: "OWNER" }), "2026-08-01").join(" ");
    expect(opposed).toMatch(/will not proceed unless you explicitly confirm/i);
  });
});

describe("daysUntilOwnershipResponse", () => {
  it("computes whole days remaining", () => {
    expect(daysUntilOwnershipResponse("2026-08-01", "2026-08-04")).toBe(3);
  });
  it("returns undefined when nothing is pending", () => {
    expect(daysUntilOwnershipResponse("2026-08-01", undefined)).toBeUndefined();
  });
});

describe("ownershipHistoryEntries", () => {
  it("maps raw negotiation-round actions onto human-readable labels only", () => {
    const bid: OwnershipInvestorBidView = {
      offer: baseOffer,
      investorName: "Test Investor",
      investorType: "LOCAL_BUSINESS",
      impliedValuation: 5_000_000,
      negotiation: [
        { id: "r1" as EntityId, offerId: baseOffer.id, roundNumber: 1, actor: "INVESTOR", action: "OFFER", message: "Opening proposal", createdAt: "2026-08-01" },
        { id: "r2" as EntityId, offerId: baseOffer.id, roundNumber: 2, actor: "OWNER", action: "COUNTER", message: "Wants more", createdAt: "2026-08-02" },
      ],
      simulationOnly: true,
    };
    const entries = ownershipHistoryEntries(bid);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.label).not.toMatch(/^[A-Z_]+$/);
    }
    expect(entries[1]!.label).toBe("Countered");
  });
});
