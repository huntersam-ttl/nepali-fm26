import { effectiveMotion, prefersReducedMotion, readScenePreferences, type SceneMotion } from "./scenePreferences.js";

/**
 * Shared UI motion tokens for the non-3D interface.
 *
 * Deliberately CSS-only: the motion this game needs is entrances, tab changes
 * and value updates, all of which CSS transitions express directly. Adding an
 * animation runtime (Motion/Framer) would mean a second animation system and a
 * meaningful bundle cost for effects the platform already does well, so the
 * dependency is not justified yet.
 *
 * Durations and easings live in one place so screens cannot drift into their
 * own inconsistent motion, and every one of them collapses to zero under the
 * player's Reduced/Off setting or a system reduced-motion request.
 */

export type MotionSpeed = "FAST" | "NORMAL" | "SLOW";

/** Milliseconds. FAST for hover/press feedback, NORMAL for entrances and tab
 * changes, SLOW reserved for a full-panel or hero transition. */
export const MOTION_DURATION: Record<MotionSpeed, number> = {
  FAST: 120,
  NORMAL: 220,
  SLOW: 360,
};

/** Standard curves: things entering decelerate, things leaving accelerate,
 * and a change that wants to be noticed gets a slight overshoot. */
export const MOTION_EASING = {
  enter: "cubic-bezier(0.16, 0.84, 0.44, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
  emphasis: "cubic-bezier(0.34, 1.32, 0.64, 1)",
} as const;

export type MotionEasing = keyof typeof MOTION_EASING;

/**
 * The motion level the UI should actually use right now, combining the
 * player's stored preference with the system request. Shared with the 3D
 * layer so scenes and UI never disagree about whether motion is wanted.
 */
export const currentUiMotion = (): SceneMotion =>
  effectiveMotion(readScenePreferences().motion, prefersReducedMotion());

/**
 * A ready-to-apply CSS transition value, or "none" when motion is not wanted.
 *
 * REDUCED keeps motion but takes the shortest duration: a tab change or a
 * value update still reads as a change rather than a jump-cut, without the
 * drawn-out movement that causes discomfort. OFF removes transitions entirely.
 */
export const motionTransition = (
  properties: string,
  speed: MotionSpeed = "NORMAL",
  easing: MotionEasing = "enter",
  motion: SceneMotion = currentUiMotion(),
): string => {
  if (motion === "OFF") return "none";
  const duration = motion === "REDUCED" ? MOTION_DURATION.FAST : MOTION_DURATION[speed];
  return properties
    .split(",")
    .map((property) => `${property.trim()} ${duration}ms ${MOTION_EASING[easing]}`)
    .join(", ");
};

/**
 * Whether a purely decorative entrance should play at all. An entrance
 * animation carries no information, so Reduced skips it outright rather than
 * playing a shorter version of it.
 */
export const shouldPlayEntrance = (motion: SceneMotion = currentUiMotion()): boolean => motion === "FULL";

export type ValueChangeDirection = "UP" | "DOWN" | "NONE";

/**
 * Direction of a numeric change, for the shared data-change indicator.
 * Equal values (and a first-ever value with nothing to compare against)
 * report NONE, so nothing animates when nothing actually changed.
 */
export const valueChangeDirection = (previous: number | undefined, next: number): ValueChangeDirection => {
  if (previous === undefined || previous === next) return "NONE";
  return next > previous ? "UP" : "DOWN";
};
