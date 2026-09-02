import type { EntityReference } from "./entity-reference.js";

/**
 * Real, honest post-match follow-up context for the Owner — never a
 * fabricated narrative. suggested/urgency/reason are derived only from the
 * real result and goal margin of the most recently played fixture.
 */
export type OwnerPostMatchSuggestion = {
  suggested: boolean;
  reason: string;
  result: "WIN" | "DRAW" | "DEFEAT";
  score: string;
  urgency: "MEDIUM" | "HIGH";
  topic: string;
  action: string;
  fixture: EntityReference;
  asOf: string;
};
