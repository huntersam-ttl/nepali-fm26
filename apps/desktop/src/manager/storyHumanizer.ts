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
  // Manager reputation profiles read as standing, not as a category name.
  LOCAL_UNKNOWN: "Unknown locally",
  LOCAL_RESPECTED: "Respected locally",
  FORMER_PLAYER: "Former player",
  EDUCATED_COACH: "Qualified coach",
  // Squad roles read as a place in the squad, not as a category name.
  KEY_PLAYER: "Key player",
  FIRST_TEAM: "First team",
  ROTATION: "Squad rotation",
  BACKUP: "Backup",
  PROSPECT: "Prospect",
  YOUTH: "Youth",
  // Contract / availability states.
  ACTIVE: "Active",
  EXPIRED: "Expired",
  TERMINATED: "Terminated",
  SUSPENDED: "Suspended",
  INJURED: "Injured",
  PENDING: "Pending",
};

/**
 * Matches a value that is unambiguously a raw enum token: ALL-CAPS words
 * (with digits or underscores), or lowercase snake_case. A real person, club
 * or competition name never takes this shape, so `humanizeEnum` can be used
 * on mixed fields without mangling names.
 */
const RAW_ENUM_SHAPE = /^(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)$/;

/** True when `value` looks like a raw enum token rather than prose or a name. */
export const isRawEnumToken = (value: string): boolean => RAW_ENUM_SHAPE.test(value.trim());

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

/**
 * Humanizes a value ONLY when it is shaped like a raw enum token, returning
 * anything else untouched. Use this at render sites whose value may be either
 * an enum or a real name/prose (a squad role, a status, a free-text note), so
 * a genuine name is never title-cased or reworded.
 */
export const humanizeEnum = (value: string | undefined | null, fallback = "—"): string => {
  const text = (value ?? "").trim();
  if (!text) return fallback;
  return isRawEnumToken(text) ? humanizeToken(text) : text;
};
