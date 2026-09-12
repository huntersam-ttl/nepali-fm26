// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  MOTION_DURATION,
  currentUiMotion,
  motionTransition,
  shouldPlayEntrance,
  valueChangeDirection,
} from "./motion.js";
import { writeScenePreferences } from "./scenePreferences.js";

/**
 * The motion preference has to be genuinely obeyed, not merely offered. These
 * cover the gate itself: every visual effect in the UI derives its timing from
 * these functions, so if the gate holds here it holds everywhere.
 */

beforeEach(() => {
  globalThis.localStorage?.clear();
});

describe("motion preference gating", () => {
  it("emits no transition at all when the player turns animation off", () => {
    expect(motionTransition("opacity", "NORMAL", "enter", "OFF")).toBe("none");
  });

  it("shortens rather than removes transitions under Reduced", () => {
    const reduced = motionTransition("opacity", "SLOW", "enter", "REDUCED");
    expect(reduced).toContain(`${MOTION_DURATION.FAST}ms`);
    expect(reduced).not.toContain(`${MOTION_DURATION.SLOW}ms`);
  });

  it("uses the requested duration only at Full", () => {
    expect(motionTransition("opacity", "SLOW", "enter", "FULL")).toContain(`${MOTION_DURATION.SLOW}ms`);
  });

  it("gives every listed property its own timing", () => {
    expect(motionTransition("opacity, transform", "FAST", "enter", "FULL")).toBe(
      `opacity ${MOTION_DURATION.FAST}ms cubic-bezier(0.16, 0.84, 0.44, 1), transform ${MOTION_DURATION.FAST}ms cubic-bezier(0.16, 0.84, 0.44, 1)`,
    );
  });

  it("skips decorative entrances outright below Full — Reduced does not want a faster entrance, it wants none", () => {
    expect(shouldPlayEntrance("FULL")).toBe(true);
    expect(shouldPlayEntrance("REDUCED")).toBe(false);
    expect(shouldPlayEntrance("OFF")).toBe(false);
  });
});

describe("current UI motion follows the stored preference", () => {
  it("reports what the player chose", () => {
    writeScenePreferences({ enabled3d: true, quality: "HIGH", motion: "REDUCED" });
    expect(currentUiMotion()).toBe("REDUCED");
    writeScenePreferences({ enabled3d: true, quality: "HIGH", motion: "OFF" });
    expect(currentUiMotion()).toBe("OFF");
  });

  it("turning 3D off does not silently turn UI motion off too — they are separate choices", () => {
    writeScenePreferences({ enabled3d: false, quality: "LOW", motion: "FULL" });
    expect(currentUiMotion()).toBe("FULL");
  });
});

describe("value change direction", () => {
  it("reports nothing for a first value, with nothing to compare against", () => {
    expect(valueChangeDirection(undefined, 40)).toBe("NONE");
  });

  it("reports nothing when the value did not actually change", () => {
    expect(valueChangeDirection(40, 40)).toBe("NONE");
  });

  it("reports the real direction", () => {
    expect(valueChangeDirection(40, 41)).toBe("UP");
    expect(valueChangeDirection(40, 39)).toBe("DOWN");
  });
});
