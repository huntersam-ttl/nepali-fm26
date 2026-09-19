import { describe, expect, it } from "vitest";
import { clubAccent, contrastRatio, relativeLuminance, statusTone } from "./appearance.js";

describe("statusTone", () => {
  it("maps known statuses to tones", () => {
    expect(statusTone("AVAILABLE")).toBe("ok");
    expect(statusTone("HEALTHY")).toBe("ok");
    expect(statusTone("VERIFIED")).toBe("ok");
    expect(statusTone("INJURED")).toBe("bad");
    expect(statusTone("SUSPENDED")).toBe("warn");
    expect(statusTone("REPORTED")).toBe("info");
    expect(statusTone("SIMULATION_ONLY")).toBe("neutral");
  });

  it("maps unknown/provenance values to neutral, never an error tone", () => {
    expect(statusTone("UNKNOWN")).toBe("neutral");
    expect(statusTone(undefined)).toBe("neutral");
    expect(statusTone("SOMETHING_ELSE")).toBe("neutral");
  });
});

describe("clubAccent (identity contrast fallback)", () => {
  it("returns the fallback for an empty/invalid club colour", () => {
    expect(clubAccent(undefined, "#d9ceff", "#151d34")).toBe("#d9ceff");
    expect(clubAccent("not-a-colour", "#d9ceff", "#151d34")).toBe("#d9ceff");
  });

  it("keeps a club colour that is already readable on the background", () => {
    // Light cyan reads well on a dark shell.
    expect(clubAccent("#5ad1c8", "#d9ceff", "#151d34")).toBe("#5ad1c8");
  });

  it("lifts a too-dark club colour so it stays readable (hue preserved)", () => {
    const result = clubAccent("#0d1b2a", "#d9ceff", "#151d34");
    // Still a valid hex, and now clearly lighter than the near-black input.
    expect(result).toMatch(/^#[0-9a-f]{6}$/i);
    expect(relativeLuminance(result)).toBeGreaterThan(relativeLuminance("#0d1b2a"));
    expect(contrastRatio(result, "#151d34")).toBeGreaterThanOrEqual(1.75);
  });

  it("relative luminance is 0..1 and contrast of identical colours is 1", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 1);
    expect(contrastRatio("#333333", "#333333")).toBeCloseTo(1, 5);
  });
});