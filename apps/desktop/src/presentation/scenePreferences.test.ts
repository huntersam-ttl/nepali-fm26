// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SCENE_PREFERENCES,
  effectiveMotion,
  qualitySettings,
  readScenePreferences,
  resetWebglSupportCache,
  shouldRender3d,
  supportsWebgl,
  writeScenePreferences,
} from "./scenePreferences.js";

afterEach(() => {
  globalThis.localStorage?.clear();
  resetWebglSupportCache();
  vi.restoreAllMocks();
});

describe("scene preferences storage", () => {
  it("falls back to defaults when nothing is stored", () => {
    expect(readScenePreferences()).toEqual(DEFAULT_SCENE_PREFERENCES);
  });

  it("round-trips a real choice", () => {
    writeScenePreferences({ enabled3d: false, quality: "LOW", motion: "REDUCED" });
    expect(readScenePreferences()).toEqual({ enabled3d: false, quality: "LOW", motion: "REDUCED" });
  });

  it("ignores a corrupt or hostile stored value instead of throwing", () => {
    globalThis.localStorage.setItem("nepal.presentation.preferences.v1", "{not json");
    expect(readScenePreferences()).toEqual(DEFAULT_SCENE_PREFERENCES);

    globalThis.localStorage.setItem(
      "nepal.presentation.preferences.v1",
      JSON.stringify({ enabled3d: "yes", quality: "ULTRA_MAX", motion: 7 }),
    );
    expect(readScenePreferences()).toEqual(DEFAULT_SCENE_PREFERENCES);
  });
});

describe("effective motion", () => {
  it("lets a system reduced-motion request lower motion but never raise it", () => {
    expect(effectiveMotion("FULL", true)).toBe("REDUCED");
    expect(effectiveMotion("REDUCED", true)).toBe("REDUCED");
    // An explicit "off" is a stronger choice than the system's "reduce".
    expect(effectiveMotion("OFF", true)).toBe("OFF");
  });

  it("honours the player's own choice when the system has no preference", () => {
    expect(effectiveMotion("FULL", false)).toBe("FULL");
    expect(effectiveMotion("REDUCED", false)).toBe("REDUCED");
    expect(effectiveMotion("OFF", false)).toBe("OFF");
  });
});

describe("quality settings", () => {
  it("actually reduces GPU cost at LOW rather than only renaming the tier", () => {
    const low = qualitySettings("LOW");
    const high = qualitySettings("HIGH");
    expect(low.pixelRatio).toBeLessThan(high.pixelRatio);
    expect(low.shadows).toBe(false);
    expect(low.ambientProps).toBe(false);
    expect(low.segments).toBeLessThan(high.segments);
    expect(low.antialias).toBe(false);
  });

  it("keeps MEDIUM between the two", () => {
    const medium = qualitySettings("MEDIUM");
    expect(medium.pixelRatio).toBeGreaterThan(qualitySettings("LOW").pixelRatio);
    expect(medium.pixelRatio).toBeLessThan(qualitySettings("HIGH").pixelRatio);
  });
});

describe("WebGL capability gate", () => {
  it("reports no support when the runtime refuses a context, and stays on the fallback", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(supportsWebgl()).toBe(false);
    expect(shouldRender3d({ enabled3d: true, quality: "HIGH", motion: "FULL" })).toBe(false);
  });

  it("never renders 3D when the player has turned it off, even on a capable machine", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      getExtension: () => null,
    } as unknown as RenderingContext);
    expect(supportsWebgl()).toBe(true);
    expect(shouldRender3d({ enabled3d: false, quality: "HIGH", motion: "FULL" })).toBe(false);
    expect(shouldRender3d({ enabled3d: true, quality: "HIGH", motion: "FULL" })).toBe(true);
  });

  it("probes the context only once rather than on every scene mount", () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ getExtension: () => null } as unknown as RenderingContext);
    supportsWebgl();
    supportsWebgl();
    supportsWebgl();
    expect(getContext).toHaveBeenCalledTimes(1);
  });
});
