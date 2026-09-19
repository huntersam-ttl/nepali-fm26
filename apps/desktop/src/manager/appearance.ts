/**
 * Phase 2A — small, testable appearance helpers.
 *
 * These are pure functions the visual system uses so identity/provenance stays
 * safe and consistent:
 *  - statusTone maps a domain status string to a design tone (with a neutral
 *    fallback) so chips/badges share one vocabulary.
 *  - clubAccent returns the club's primary colour as an accent ONLY when it is
 *    verifiably readable against the shell background; otherwise it falls back
 *    (or lifts the colour for contrast). This keeps club identity influencing
 *    the UI subtly without ever making markers unreadable for bright/dark clubs.
 */

export type Tone = "ok" | "info" | "warn" | "bad" | "neutral";

/** Common statuses → design tone. Unknown statuses map to a neutral tone.
 * These are presentation hints only — they never carry game/domain meaning. */
const STATUS_TONES: Record<string, Tone> = {
  AVAILABLE: "ok",
  HEALTHY: "ok",
  CONFIRMED: "ok",
  ACTIVE: "ok",
  FULFILLED: "ok",
  READY: "ok",
  VERIFIED: "ok",
  COMPLETED: "ok",
  INJURED: "bad",
  SUSPENDED: "warn",
  STALE: "warn",
  PENDING: "warn",
  UNDER_REVIEW: "warn",
  UNFULFILLED: "bad",
  REJECTED: "bad",
  EXPIRED: "warn",
  INFORMATION: "info",
  REPORTED: "info",
  ESTIMATED: "info",
  MONITORING: "info",
  INTERESTED: "info",
  UNKNOWN: "neutral",
  SIMULATION_ONLY: "neutral",
};

export const statusTone = (status: string | undefined): Tone =>
  status ? (STATUS_TONES[status] ?? "neutral") : "neutral";

const isHexColor = (value: string): string | undefined => /^#([0-9a-f]{6})$/i.exec(value)?.[1];

const channel = (component: number): number => {
  const s = component / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** WCAG relative luminance of a #rrggbb colour. */
export const relativeLuminance = (hex: string): number => {
  const match = isHexColor(hex);
  if (!match) return 0;
  const n = parseInt(match, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

export const contrastRatio = (a: string, b: string): number => {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [light, dark] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
};

/** Mix a #rrggbb toward white by `amount` (0..1), keeping the hue readable on
 * dark surfaces when the raw club colour is too dark. */
const lighten = (hex: string, amount: number): string => {
  const match = isHexColor(hex);
  if (!match) return hex;
  const n = parseInt(match, 16);
  const mix = (value: number): number => Math.round(value + (255 - value) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
};

/**
 * Resolve a club accent that is readable against `onBackground`.
 *
 * Rules:
 *  - an invalid/empty club colour falls back to `fallback`;
 *  - a club colour already passing the `minContrast` floor is used as-is;
 *  - otherwise the colour is lifted toward white (hue preserved) until it
 *    passes the floor — so bright/dark clubs never produce unreadable markers,
 *    and we never fall back to a neutral accent while the club hue is usable.
 */
export const clubAccent = (
  primaryColour: string | undefined,
  fallback: string,
  onBackground: string,
  minContrast = 1.75,
): string => {
  if (!primaryColour || !isHexColor(primaryColour)) return fallback;
  if (contrastRatio(primaryColour, onBackground) >= minContrast) return primaryColour;
  for (let step = 0.1; step <= 1; step += 0.1) {
    const lifted = lighten(primaryColour, step);
    if (contrastRatio(lifted, onBackground) >= minContrast) return lifted;
  }
  return lighten(primaryColour, 1);
};