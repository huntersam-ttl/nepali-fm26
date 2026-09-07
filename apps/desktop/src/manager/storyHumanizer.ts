/**
 * The single presentation-layer humanizer for raw SCREAMING_SNAKE_CASE/
 * snake_case enum and status tokens that reach a story surface (Inbox,
 * Threads, Story Detail, budget/sponsorship/debt status badges). Normalizes
 * on read/render only — never rewrites historical DB rows.
 */
const KNOWN_TOKEN_LABELS: Record<string, string> = {
  WOMENS: "Women & Girls",
  WOMENS_GIRLS: "Women & Girls",
  SENIOR_MEN: "Senior Men",
  SENIOR_MENS: "Senior Men",
  PLAYER_NEGOTIATING: "Player terms",
  GOVERNMENT_REVIEW: "Government review",
  TRANSFER_NEGOTIATION: "Transfer negotiation",
  INFRASTRUCTURE_PROJECT: "Infrastructure project",
};

/** Humanizes one raw enum/status token (e.g. "PLAYER_NEGOTIATING",
 * "senior_mens", "APPROVED") into short, natural, title-cased text. Known
 * tokens use their exact override; anything else falls back to a generic
 * word-split + title-case, so a future/unmapped enum value never renders as
 * a raw SCREAMING_SNAKE_CASE string. */
export const humanizeToken = (value: string): string => {
  const key = value.toUpperCase();
  if (KNOWN_TOKEN_LABELS[key]) return KNOWN_TOKEN_LABELS[key];
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};
