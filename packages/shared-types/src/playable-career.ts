import type { CareerRole } from "./desktop-contract.js";

/** The two persistent careers the human player can build a lifetime around. */
export type BaseCareerRole = "MANAGER" | "CHAIRMAN_OWNER";

/**
 * Human-playable career states. Federation President is an elected temporary
 * office layered over a persistent Manager or Chairman/Owner base career.
 */
export type PlayableCareerRole = BaseCareerRole | "FEDERATION_PRESIDENT";

export const PLAYABLE_BASE_CAREER_ROLES = ["MANAGER", "CHAIRMAN_OWNER"] as const;
export const PLAYABLE_CAREER_ROLES = [
  "MANAGER",
  "CHAIRMAN_OWNER",
  "FEDERATION_PRESIDENT",
] as const;

export const isBaseCareerRole = (role: CareerRole | undefined): role is BaseCareerRole =>
  role === "MANAGER" || role === "CHAIRMAN_OWNER";

export const isPlayableCareerRole = (
  role: CareerRole | undefined,
): role is PlayableCareerRole =>
  role === "MANAGER" || role === "CHAIRMAN_OWNER" || role === "FEDERATION_PRESIDENT";
