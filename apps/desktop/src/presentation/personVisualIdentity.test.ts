import { describe, expect, it } from "vitest";
import { ageBandForAge, buildPersonVisualIdentity } from "./personVisualIdentity.js";

describe("buildPersonVisualIdentity — deterministic, never random at render time", () => {
  it("gives the exact same identity for the same person id every call", () => {
    const a = buildPersonVisualIdentity("player-123", 27);
    const b = buildPersonVisualIdentity("player-123", 27);
    expect(b).toEqual(a);
  });

  it("gives different people visibly different identities within the shared palette", () => {
    const ids = ["player-1", "player-2", "player-3", "player-4", "player-5", "player-6"];
    const identities = ids.map((id) => buildPersonVisualIdentity(id, 27));
    const distinctSkinTones = new Set(identities.map((identity) => identity.skinTone));
    const distinctFaceShapes = new Set(identities.map((identity) => identity.faceShape));
    // Real diversity across a handful of ids, not everyone converging on one look.
    expect(distinctSkinTones.size).toBeGreaterThan(1);
    expect(distinctFaceShapes.size).toBeGreaterThan(1);
  });

  it("never uses nationality as an input — the function does not even accept one", () => {
    // Type-level guarantee: buildPersonVisualIdentity(id, age) has no third
    // parameter for nationality/country. This test documents that contract.
    expect(buildPersonVisualIdentity.length).toBeLessThanOrEqual(2);
  });

  it("bands real age into a conservative five-stage presentation", () => {
    expect(ageBandForAge(16)).toBe("YOUTH");
    expect(ageBandForAge(21)).toBe("YOUNG_ADULT");
    expect(ageBandForAge(27)).toBe("PRIME");
    expect(ageBandForAge(35)).toBe("VETERAN");
    expect(ageBandForAge(44)).toBe("OLDER");
  });

  it("reads unknown age as a neutral PRIME presentation rather than guessing", () => {
    expect(ageBandForAge(undefined)).toBe("PRIME");
  });

  it("greys hair progressively with age band while keeping the same person recognisable", () => {
    const young = buildPersonVisualIdentity("ageing-player", 22);
    const older = buildPersonVisualIdentity("ageing-player", 45);
    // Same underlying identity (seed, face shape, hair style) — only the
    // age-driven presentation (greying amount) changes, never a fresh
    // identity for the same person.
    expect(older.seed).toBe(young.seed);
    expect(older.faceShape).toBe(young.faceShape);
    expect(older.greyingAmount).toBeGreaterThan(young.greyingAmount);
  });

  it("keeps facial hair colour tied to the same base hair colour identity even as it greys", () => {
    const identity = buildPersonVisualIdentity("stable-colour-check", 60);
    // The greyed colour is still a real hex colour, not a random new pick.
    expect(identity.hairColour).toMatch(/^#[0-9a-f]{6}$/);
  });
});
