import { describe, expect, it } from "vitest";
import { humanizeEnum, humanizeToken, isRawEnumToken } from "./storyHumanizer.js";

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

/**
 * Single-token enum families (ACTIVE, ROTATION, BACKUP, …) evade any
 * SCREAMING_SNAKE-with-underscore search, so they leaked into the Player UI as
 * raw values. `humanizeEnum` fixes them at render time while leaving real
 * names and prose untouched.
 */
describe("single-token enum families", () => {
  it("relabels squad roles as a place in the squad, not a category name", () => {
    expect(humanizeEnum("ROTATION")).toBe("Squad rotation");
    expect(humanizeEnum("KEY_PLAYER")).toBe("Key player");
    expect(humanizeEnum("FIRST_TEAM")).toBe("First team");
    expect(humanizeEnum("BACKUP")).toBe("Backup");
    expect(humanizeEnum("PROSPECT")).toBe("Prospect");
    expect(humanizeEnum("YOUTH")).toBe("Youth");
  });

  it("relabels contract and availability states", () => {
    expect(humanizeEnum("ACTIVE")).toBe("Active");
    expect(humanizeEnum("EXPIRED")).toBe("Expired");
    expect(humanizeEnum("TERMINATED")).toBe("Terminated");
    expect(humanizeEnum("SUSPENDED")).toBe("Suspended");
    expect(humanizeEnum("INJURED")).toBe("Injured");
    expect(humanizeEnum("PENDING")).toBe("Pending");
  });

  it("never renders a bare SCREAMING_CASE token back to the UI", () => {
    for (const token of [
      "ACTIVE", "ROTATION", "BACKUP", "STARTER", "SUSPENDED", "EXPIRED",
      "INJURED", "PENDING", "LOANED_OUT", "SOME_FUTURE_STATE",
    ]) {
      expect(humanizeEnum(token)).not.toBe(token);
      expect(humanizeEnum(token)).not.toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it("leaves real names and prose completely untouched", () => {
    for (const name of [
      "Umesh Rai",
      "Church Boys United",
      "Martyr's Memorial A-Division League 2026",
      "Kathmandu",
      "No active contract",
      "MacDonald Bhandari",
      "FC Khumaltar",
    ]) {
      expect(humanizeEnum(name)).toBe(name);
    }
  });

  it("uses the caller's fallback for an absent value", () => {
    expect(humanizeEnum(undefined)).toBe("—");
    expect(humanizeEnum(null)).toBe("—");
    expect(humanizeEnum("")).toBe("—");
    expect(humanizeEnum("  ", "No active contract")).toBe("No active contract");
    expect(humanizeEnum(undefined, "Unknown")).toBe("Unknown");
  });

  it("recognises enum shape without matching names", () => {
    expect(isRawEnumToken("ACTIVE")).toBe(true);
    expect(isRawEnumToken("KEY_PLAYER")).toBe(true);
    expect(isRawEnumToken("senior_men")).toBe(true);
    expect(isRawEnumToken("Umesh Rai")).toBe(false);
    expect(isRawEnumToken("Church Boys United")).toBe(false);
    expect(isRawEnumToken("Kathmandu")).toBe(false);
  });
});
