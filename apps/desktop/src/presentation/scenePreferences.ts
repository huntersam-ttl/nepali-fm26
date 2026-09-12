/**
 * Presentation preferences and runtime capability detection for the 3D layer.
 *
 * These are deliberately *not* part of the football save: a save records the
 * world, not how this machine chooses to draw it, so quality/motion settings
 * live in browser storage and an old save renders correctly on any machine.
 */

export type SceneQuality = "LOW" | "MEDIUM" | "HIGH";
export type SceneMotion = "FULL" | "REDUCED" | "OFF";

export type ScenePreferences = {
  /** Master switch. Off renders the 2D fallback everywhere, by choice. */
  enabled3d: boolean;
  quality: SceneQuality;
  motion: SceneMotion;
};

export const DEFAULT_SCENE_PREFERENCES: ScenePreferences = {
  enabled3d: true,
  quality: "MEDIUM",
  motion: "FULL",
};

const STORAGE_KEY = "nepal.presentation.preferences.v1";

const isQuality = (value: unknown): value is SceneQuality =>
  value === "LOW" || value === "MEDIUM" || value === "HIGH";

const isMotion = (value: unknown): value is SceneMotion =>
  value === "FULL" || value === "REDUCED" || value === "OFF";

/** Reads stored preferences, ignoring anything malformed rather than throwing
 * — a corrupt settings entry must never stop the game from rendering. */
export const readScenePreferences = (): ScenePreferences => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SCENE_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<ScenePreferences>;
    return {
      enabled3d: typeof parsed.enabled3d === "boolean" ? parsed.enabled3d : DEFAULT_SCENE_PREFERENCES.enabled3d,
      quality: isQuality(parsed.quality) ? parsed.quality : DEFAULT_SCENE_PREFERENCES.quality,
      motion: isMotion(parsed.motion) ? parsed.motion : DEFAULT_SCENE_PREFERENCES.motion,
    };
  } catch {
    return DEFAULT_SCENE_PREFERENCES;
  }
};

export const writeScenePreferences = (preferences: ScenePreferences): void => {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage being unavailable is not a reason to break the screen.
  }
};

/** True when the OS/browser asks for reduced motion. */
export const prefersReducedMotion = (): boolean => {
  try {
    return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
};

/**
 * The motion level actually applied: a system reduced-motion request can only
 * ever reduce motion, never raise it above what the player chose.
 */
export const effectiveMotion = (preference: SceneMotion, systemReducedMotion: boolean): SceneMotion => {
  if (preference === "OFF") return "OFF";
  if (systemReducedMotion) return "REDUCED";
  return preference;
};

export type SceneQualitySettings = {
  /** Renderer pixel ratio cap — the single biggest GPU cost lever. */
  pixelRatio: number;
  shadows: boolean;
  /** Extra environment props (trees, cars, clutter) beyond the real buildings. */
  ambientProps: boolean;
  /** Geometry subdivision for curved shapes. */
  segments: number;
  antialias: boolean;
};

export const qualitySettings = (quality: SceneQuality): SceneQualitySettings => {
  if (quality === "LOW") {
    return { pixelRatio: 1, shadows: false, ambientProps: false, segments: 8, antialias: false };
  }
  if (quality === "HIGH") {
    return { pixelRatio: 2, shadows: true, ambientProps: true, segments: 32, antialias: true };
  }
  return { pixelRatio: 1.5, shadows: false, ambientProps: true, segments: 16, antialias: true };
};

/**
 * Whether this runtime can actually present a WebGL scene. Probed once with a
 * throwaway context: a machine without WebGL, a locked-down WebView, or a
 * driver that refuses the context all land on the 2D fallback instead of a
 * blank canvas.
 */
let cachedWebglSupport: boolean | undefined;

export const supportsWebgl = (): boolean => {
  if (cachedWebglSupport !== undefined) return cachedWebglSupport;
  try {
    const canvas = globalThis.document?.createElement("canvas");
    if (!canvas) {
      cachedWebglSupport = false;
      return cachedWebglSupport;
    }
    const context =
      canvas.getContext("webgl2") ?? canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
    cachedWebglSupport = Boolean(context);
    // Release the probe context immediately rather than holding a GPU slot.
    const lose = (context as WebGLRenderingContext | null)?.getExtension?.("WEBGL_lose_context");
    lose?.loseContext?.();
  } catch {
    cachedWebglSupport = false;
  }
  return cachedWebglSupport;
};

/** Test seam — lets a test reset the one-shot capability probe. */
export const resetWebglSupportCache = (): void => {
  cachedWebglSupport = undefined;
};

/** The single decision every scene host asks: do we draw 3D at all? */
export const shouldRender3d = (preferences: ScenePreferences): boolean =>
  preferences.enabled3d && supportsWebgl();
