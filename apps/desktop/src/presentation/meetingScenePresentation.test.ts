import { describe, expect, it } from "vitest";
import { buildMeetingSceneProfile, meetingTierForScore100 } from "./meetingScenePresentation.js";

describe("meeting tier from a 0-100 score (distinct from a club's 0-20 facility scale)", () => {
  it("treats missing/zero as undeveloped", () => {
    expect(meetingTierForScore100(undefined)).toBe("UNDEVELOPED");
    expect(meetingTierForScore100(0)).toBe("UNDEVELOPED");
  });

  it("maps the real 0-100 scale across the bands", () => {
    expect(meetingTierForScore100(10)).toBe("BASIC");
    expect(meetingTierForScore100(25)).toBe("MODEST");
    expect(meetingTierForScore100(45)).toBe("PROFESSIONAL");
    expect(meetingTierForScore100(65)).toBe("ADVANCED");
    expect(meetingTierForScore100(85)).toBe("ELITE");
  });
});

describe("meeting scene profile — caller-supplied real state only", () => {
  it("never invents an environment tier or importance — both are exactly what the caller passed", () => {
    const scene = buildMeetingSceneProfile({
      context: "BOARDROOM",
      environmentTier: "PROFESSIONAL",
      importance: "MAJOR",
      organisationId: "club-1",
      organisationName: "Test FC",
    });
    expect(scene.environmentTier).toBe("PROFESSIONAL");
    expect(scene.importance).toBe("MAJOR");
    expect(scene.context).toBe("BOARDROOM");
  });

  it("is deterministic: the same context and organisation id always produce the same seed and accent", () => {
    const a = buildMeetingSceneProfile({
      context: "BOARDROOM",
      environmentTier: "MODEST",
      importance: "ROUTINE",
      organisationId: "club-1",
      organisationName: "Test FC",
    });
    const b = buildMeetingSceneProfile({
      context: "BOARDROOM",
      environmentTier: "MODEST",
      importance: "ROUTINE",
      organisationId: "club-1",
      organisationName: "Test FC",
    });
    expect(b.seed).toBe(a.seed);
    expect(b.accentHue).toBe(a.accentHue);
  });

  it("gives a different seed for a different context on the same organisation — a boardroom and a press room for the same club never share a layout seed", () => {
    const boardroom = buildMeetingSceneProfile({
      context: "BOARDROOM",
      environmentTier: "MODEST",
      importance: "ROUTINE",
      organisationId: "club-1",
      organisationName: "Test FC",
    });
    const press = buildMeetingSceneProfile({
      context: "PRESS",
      environmentTier: "MODEST",
      importance: "ROUTINE",
      organisationId: "club-1",
      organisationName: "Test FC",
    });
    expect(press.seed).not.toBe(boardroom.seed);
  });

  it("states the context, organisation and importance in the text summary", () => {
    const scene = buildMeetingSceneProfile({
      context: "PRESS",
      environmentTier: "ELITE",
      importance: "MAJOR",
      organisationId: "fed-1",
      organisationName: "All Nepal Football Association",
    });
    const text = scene.summary.join(" ");
    expect(text).toContain("Press room");
    expect(text).toContain("All Nepal Football Association");
    expect(text).toContain("Major");
  });
});
