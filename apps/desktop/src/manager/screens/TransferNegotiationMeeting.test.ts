import { describe, expect, it } from "vitest";
import { transferNegotiationImportance } from "./TransferNegotiationMeeting.js";

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
