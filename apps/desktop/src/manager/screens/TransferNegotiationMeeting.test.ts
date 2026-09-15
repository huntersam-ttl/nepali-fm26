import { describe, expect, it } from "vitest";
import { isQualifyingSigningOffer, transferNegotiationImportance } from "./TransferNegotiationMeeting.js";

describe("transferNegotiationImportance — real, bounded, never a fabricated record claim", () => {
  it("is always ROUTINE for a loan, regardless of fee", () => {
    expect(transferNegotiationImportance(5_000_000, 1_000_000, true)).toBe("ROUTINE");
  });

  it("is always ROUTINE for a free transfer (no fee)", () => {
    expect(transferNegotiationImportance(0, 1_000_000, false)).toBe("ROUTINE");
  });

  it("is MAJOR when the fee would exhaust or exceed the real remaining transfer budget", () => {
    expect(transferNegotiationImportance(1_000_000, 1_000_000, false)).toBe("MAJOR");
    expect(transferNegotiationImportance(1_500_000, 1_000_000, false)).toBe("MAJOR");
  });

  it("is MAJOR when there is no budget left at all", () => {
    expect(transferNegotiationImportance(100, 0, false)).toBe("MAJOR");
  });

  it("is IMPORTANT when the fee uses up at least half the remaining budget", () => {
    expect(transferNegotiationImportance(500_000, 1_000_000, false)).toBe("IMPORTANT");
    expect(transferNegotiationImportance(600_000, 1_000_000, false)).toBe("IMPORTANT");
  });

  it("is ROUTINE for a modest fee relative to the budget", () => {
    expect(transferNegotiationImportance(100_000, 1_000_000, false)).toBe("ROUTINE");
  });
});

describe("isQualifyingSigningOffer — only a genuinely completed, important incoming permanent transfer", () => {
  it("qualifies a completed, incoming, important permanent transfer", () => {
    expect(isQualifyingSigningOffer("COMPLETED", true, false, "IMPORTANT")).toBe(true);
    expect(isQualifyingSigningOffer("COMPLETED", true, false, "MAJOR")).toBe(true);
  });

  it("never qualifies a still-in-progress offer, however important", () => {
    expect(isQualifyingSigningOffer("SUBMITTED", true, false, "MAJOR")).toBe(false);
    expect(isQualifyingSigningOffer("ACCEPTED", true, false, "MAJOR")).toBe(false);
    expect(isQualifyingSigningOffer("COUNTERED", true, false, "MAJOR")).toBe(false);
  });

  it("never qualifies a routine completed transfer", () => {
    expect(isQualifyingSigningOffer("COMPLETED", true, false, "ROUTINE")).toBe(false);
  });

  it("never qualifies an outgoing sale — that is the buying club's signing, not this one", () => {
    expect(isQualifyingSigningOffer("COMPLETED", false, false, "MAJOR")).toBe(false);
  });

  it("never qualifies a loan, even a completed important-reading one", () => {
    expect(isQualifyingSigningOffer("COMPLETED", true, true, "MAJOR")).toBe(false);
  });

  it("never qualifies a rejected or withdrawn offer", () => {
    expect(isQualifyingSigningOffer("REJECTED", true, false, "MAJOR")).toBe(false);
    expect(isQualifyingSigningOffer("WITHDRAWN", true, false, "MAJOR")).toBe(false);
  });
});
