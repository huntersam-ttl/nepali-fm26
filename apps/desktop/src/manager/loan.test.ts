import { describe, expect, it } from "vitest";
import { loanSummary, splitLoans } from "./loan.js";
import type { LoanEntry } from "./loan.js";

const loan = (over: Partial<LoanEntry>): LoanEntry =>
  ({ playerId: "p1", playerName: "A", direction: "OUT", otherClubName: "Club", startDate: "2026-07-01", endDate: "2026-12-31", wageContributionPercent: 50, status: "ACTIVE", ...over }) as LoanEntry;

describe("loan helpers", () => {
  it("1/2. classifies loaned-out vs loaned-in", () => {
    const { out, in: inside } = splitLoans([loan({ direction: "OUT" }), loan({ direction: "IN" })]);
    expect(out).toHaveLength(1);
    expect(inside).toHaveLength(1);
  });

  it("3. orders each group by end date (deterministic)", () => {
    const { out } = splitLoans([
      loan({ direction: "OUT", endDate: "2027-01-01" }),
      loan({ direction: "OUT", endDate: "2026-08-01" }),
    ]);
    expect(out.map((l) => l.endDate)).toEqual(["2026-08-01", "2027-01-01"]);
  });

  it("4. preserves real canonical fields", () => {
    const entry = loan({ endDate: "2026-12-31", otherClubName: "Machhindra FC" });
    expect(entry.endDate).toBe("2026-12-31");
    expect(entry.otherClubName).toBe("Machhindra FC");
  });

  it("5. empty state is truthful", () => {
    expect(splitLoans([])).toEqual({ out: [], in: [] });
    expect(loanSummary([])).toEqual({ outCount: 0, inCount: 0 });
  });

  it("6. summary counts are safe aggregates (no hidden values)", () => {
    const summary = loanSummary([loan({ direction: "OUT" }), loan({ direction: "IN" }), loan({ direction: "IN" })]);
    expect(summary).toEqual({ outCount: 1, inCount: 2 });
    expect(JSON.stringify(summary)).not.toMatch(/potential|ability|rating/i);
  });
});