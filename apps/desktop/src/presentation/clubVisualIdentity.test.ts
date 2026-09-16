import { describe, expect, it } from "vitest";
import { buildClubBadgeDesign, buildClubColours, buildClubVisualIdentity } from "./clubVisualIdentity.js";

describe("buildClubColours / buildClubBadgeDesign / buildClubVisualIdentity — deterministic, never random at render time", () => {
  it("gives the exact same identity for the same club id every call", () => {
    const a = buildClubVisualIdentity("club-1", "Church Boys United");
    const b = buildClubVisualIdentity("club-1", "Church Boys United");
    expect(b).toEqual(a);
  });

  it("gives different clubs visibly different colours", () => {
    const a = buildClubColours("club-1");
    const b = buildClubColours("club-2");
    expect(a).not.toEqual(b);
  });

  it("gives different clubs visibly different badges", () => {
    const a = buildClubBadgeDesign("club-1", "Church Boys United");
    const b = buildClubBadgeDesign("club-2", "Friends Club");
    expect(a.shape !== b.shape || a.symbol !== b.symbol || a.primaryColour !== b.primaryColour).toBe(true);
  });

  it("derives real initials from the real club name, never a placeholder", () => {
    const badge = buildClubBadgeDesign("club-1", "Church Boys United");
    expect(badge.initials).toBe("CBU");
  });

  it("marks every generated design SIMULATION_ONLY — never claims verified real branding", () => {
    const identity = buildClubVisualIdentity("club-1", "Church Boys United");
    expect(identity.badge.provenanceStatus).toBe("SIMULATION_ONLY");
    expect(identity.home.provenanceStatus).toBe("SIMULATION_ONLY");
    expect(identity.away.provenanceStatus).toBe("SIMULATION_ONLY");
    expect(identity.third.provenanceStatus).toBe("SIMULATION_ONLY");
  });

  it("gives home, away, and third genuinely different kit combinations — never near-identical reskins", () => {
    const identity = buildClubVisualIdentity("club-1", "Church Boys United");
    const combos = [identity.home, identity.away, identity.third].map(
      (kit) => `${kit.baseColour}:${kit.secondaryColour}:${kit.pattern}`,
    );
    expect(new Set(combos).size).toBe(3);
  });

  it("keeps every kit slot tied to the club's own real colours, not an arbitrary palette", () => {
    const colours = buildClubColours("club-1");
    const identity = buildClubVisualIdentity("club-1", "Church Boys United");
    const paletteValues = new Set([colours.primaryColour, colours.secondaryColour, colours.accentColour]);
    expect(paletteValues.has(identity.home.baseColour)).toBe(true);
    expect(paletteValues.has(identity.away.baseColour)).toBe(true);
    expect(paletteValues.has(identity.third.baseColour)).toBe(true);
  });
});
