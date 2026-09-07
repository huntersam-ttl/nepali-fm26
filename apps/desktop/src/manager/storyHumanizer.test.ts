import { describe, expect, it } from "vitest";
import { humanizeToken } from "./storyHumanizer.js";

describe("story copy humanizer", () => {
  it("relabels known programme tokens to their natural names", () => {
    expect(humanizeToken("WOMENS")).toBe("Women & Girls");
    expect(humanizeToken("WOMENS_GIRLS")).toBe("Women & Girls");
    expect(humanizeToken("SENIOR_MEN")).toBe("Senior Men");
    expect(humanizeToken("SENIOR_MENS")).toBe("Senior Men");
  });

  it("relabels known workflow-stage tokens to natural phrases", () => {
    expect(humanizeToken("PLAYER_NEGOTIATING")).toBe("Player terms");
    expect(humanizeToken("GOVERNMENT_REVIEW")).toBe("Government review");
    expect(humanizeToken("TRANSFER_NEGOTIATION")).toBe("Transfer negotiation");
    expect(humanizeToken("INFRASTRUCTURE_PROJECT")).toBe("Infrastructure project");
  });

  it("is case-insensitive on the raw token but always returns title case", () => {
    expect(humanizeToken("womens")).toBe("Women & Girls");
    expect(humanizeToken("senior_men")).toBe("Senior Men");
  });

  it("falls back to a generic title-cased phrase for an unmapped SCREAMING_SNAKE_CASE token", () => {
    expect(humanizeToken("PENDING")).toBe("Pending");
    expect(humanizeToken("APPROVED")).toBe("Approved");
    expect(humanizeToken("ACTIVE")).toBe("Active");
    expect(humanizeToken("EXPIRED")).toBe("Expired");
  });

  it("falls back to a generic title-cased phrase for an unmapped multi-word token", () => {
    expect(humanizeToken("SOME_FUTURE_ENUM_VALUE")).toBe("Some Future Enum Value");
  });
});
