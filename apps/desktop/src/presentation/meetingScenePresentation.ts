import type { FacilityVisualTier } from "./clubScenePresentation.js";

/**
 * Derives a reusable off-pitch decision-room scene purely from real,
 * already-canonical meeting/negotiation state — the same "state -> visual
 * descriptor" pattern clubScenePresentation.ts and
 * federationScenePresentation.ts already use. This module is deliberately
 * generic across every off-pitch decision context (a boardroom, a
 * negotiation room, a press room) rather than one bespoke module per
 * workflow: the room shape, materials and importance banding are shared;
 * only the caller-supplied inputs differ.
 *
 * Renderer-agnostic and side-effect free, so scene correctness is
 * unit-testable without a GPU.
 */

export type MeetingContext = "BOARDROOM" | "NEGOTIATION" | "PRESS" | "SIGNING";

export type MeetingImportance = "ROUTINE" | "IMPORTANT" | "MAJOR";

export type MeetingSceneProfile = {
  context: MeetingContext;
  /** Reuses the club campus's own facility-tier bands, so a boardroom and a
   * training-ground building read on the same honest quality scale rather
   * than inventing a second one. */
  environmentTier: FacilityVisualTier;
  importance: MeetingImportance;
  organisationName: string;
  accentHue: number;
  seed: number;
  /** Every fact the scene depicts, in words. */
  summary: string[];
};

const stableSeed = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
};

const CONTEXT_LABEL: Record<MeetingContext, string> = {
  BOARDROOM: "Boardroom",
  NEGOTIATION: "Negotiation room",
  PRESS: "Press room",
  SIGNING: "Signing room",
};

const TIER_LABEL: Record<FacilityVisualTier, string> = {
  UNDEVELOPED: "No record of a dedicated room",
  BASIC: "Basic",
  MODEST: "Modest",
  PROFESSIONAL: "Professional",
  ADVANCED: "Advanced",
  ELITE: "Elite",
};

const IMPORTANCE_LABEL: Record<MeetingImportance, string> = {
  ROUTINE: "Routine",
  IMPORTANT: "Important",
  MAJOR: "Major",
};

/** For callers whose only real signal is a 0-100 score (board confidence, a
 * reputation figure, ...) rather than a club's own 0-20 facility quality —
 * the same band names as `FacilityVisualTier`, scaled for a 0-100 input so
 * a caller never has to misuse the 0-20 scale on a 0-100 number. */
export const meetingTierForScore100 = (score: number | undefined): FacilityVisualTier => {
  if (score === undefined || score <= 0) return "UNDEVELOPED";
  if (score >= 80) return "ELITE";
  if (score >= 60) return "ADVANCED";
  if (score >= 40) return "PROFESSIONAL";
  if (score >= 20) return "MODEST";
  return "BASIC";
};

/**
 * Builds a deterministic scene profile for any off-pitch decision context.
 * Every input is real, caller-supplied state — this module never invents an
 * environment tier or an importance level on its own; a caller that has no
 * real signal for either should pass a conservative default (`"MODEST"`,
 * `"ROUTINE"`) rather than this module guessing.
 */
export const buildMeetingSceneProfile = (input: {
  context: MeetingContext;
  environmentTier: FacilityVisualTier;
  importance: MeetingImportance;
  organisationId: string;
  organisationName: string;
}): MeetingSceneProfile => {
  const seed = stableSeed(`${input.context}:${input.organisationId}`);
  const summary = [
    `${CONTEXT_LABEL[input.context]} — ${TIER_LABEL[input.environmentTier].toLowerCase()}`,
    `${input.organisationName}`,
    `${IMPORTANCE_LABEL[input.importance]} occasion`,
  ];
  return {
    context: input.context,
    environmentTier: input.environmentTier,
    importance: input.importance,
    organisationName: input.organisationName,
    accentHue: seed % 360,
    seed,
    summary,
  };
};
