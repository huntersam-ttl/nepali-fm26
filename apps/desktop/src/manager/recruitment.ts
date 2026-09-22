import type {
  KnowledgeConfidence,
  KnowledgeRange,
  PlayerDiscoveryStatus,
  PlayerKnowledgeLevel,
  RecruitmentRow,
  ScoutingReportView,
} from "@nepal-football-sim/shared-types";

/**
 * Phase 5A — Recruitment presentation helpers.
 *
 * Knowledge-aware mapping only: exact/estimated/unknown values are derived
 * from the canonical recruitment read model. No hidden CA/PA, no fabricated
 * grades, interest, value or wage. Unknown is a real state, never an error.
 */

export const UNKNOWN = "Unknown";

export const knowledgeText = (knowledge: PlayerKnowledgeLevel): string => knowledge.toLowerCase();
export const discoveryText = (discovery: PlayerDiscoveryStatus): string => discovery.toLowerCase();

/** Tone for text chips — always accompanied by the text itself, never color-only. */
export const knowledgeTone = (knowledge: PlayerKnowledgeLevel): "ok" | "warn" | "info" =>
  knowledge === "GOOD" || knowledge === "EXTENSIVE" || knowledge === "COMPLETE"
    ? "ok"
    : knowledge === "BASIC" || knowledge === "MINIMAL"
      ? "warn"
      : "info";

export const confidenceTone = (confidence: KnowledgeConfidence): "ok" | "warn" | "info" =>
  confidence === "HIGH" ? "ok" : confidence === "MEDIUM" ? "warn" : "info";

export const rangeText = (range?: KnowledgeRange): string =>
  range ? `${range.min}–${range.max}` : UNKNOWN;

export const rowName = (row: RecruitmentRow): string => row.name ?? "Unknown player";
export const rowPosition = (row: RecruitmentRow): string => row.knownPosition ?? row.positionGroup ?? UNKNOWN;

export type RecruitmentSortKey = "name" | "position" | "knowledge" | "ability" | "club";

const KNOWLEDGE_ORDER: Record<PlayerKnowledgeLevel, number> = {
  NONE: 0,
  MINIMAL: 1,
  BASIC: 2,
  GOOD: 3,
  EXTENSIVE: 4,
  COMPLETE: 5,
};

const abilityScale = (range?: KnowledgeRange): number | undefined =>
  range ? range.min + range.max : undefined;

/**
 * Deterministic page-scoped sort. Unknown values sort LAST and transparently
 * (never inferred), so the ordering is stable regardless of hidden ability.
 */
export const sortRows = (
  rows: readonly RecruitmentRow[],
  key: RecruitmentSortKey,
): RecruitmentRow[] =>
  [...rows].sort((a, b) => {
    switch (key) {
      case "name":
        return rowName(a).localeCompare(rowName(b));
      case "position":
        return rowPosition(a).localeCompare(rowPosition(b));
      case "knowledge":
        return KNOWLEDGE_ORDER[a.knowledge] - KNOWLEDGE_ORDER[b.knowledge] || a.playerId.localeCompare(b.playerId);
      case "ability": {
        const av = abilityScale(a.estimatedAbility);
        const bv = abilityScale(b.estimatedAbility);
        if (av === undefined && bv === undefined) return a.playerId.localeCompare(b.playerId);
        if (av === undefined) return 1; // unknown last
        if (bv === undefined) return -1;
        return av - bv || a.playerId.localeCompare(b.playerId);
      }
      case "club":
        return (a.clubName ?? "").localeCompare(b.clubName ?? "") || a.playerId.localeCompare(b.playerId);
    }
  });

/** Filter the current (bounded) results by a knowledge minimum or exact state. */
export const filterByKnowledge = (
  rows: readonly RecruitmentRow[],
  knowledge: PlayerKnowledgeLevel | "ALL",
): RecruitmentRow[] =>
  knowledge === "ALL" ? [...rows] : rows.filter((row) => row.knowledge === knowledge);

/** Distinct position labels present in the current results (bounded filter). */
export const positionOptions = (rows: readonly RecruitmentRow[]): string[] => [
  ...new Set(rows.map(rowPosition).filter((position) => position !== UNKNOWN)),
].sort();

/**
 * Deterministic recommendation ordering from real state: newest report first,
 * then player name. No fabricated "strength" score.
 */
export const recommendationsOrdered = (reports: readonly ScoutingReportView[]): ScoutingReportView[] =>
  [...reports].sort(
    (a, b) =>
      b.generatedAt.localeCompare(a.generatedAt) ||
      (a.playerName ?? a.playerId).localeCompare(b.playerName ?? b.playerId),
  );

/** Report age as a factual day count — deliberately no invented "stale" band. */
export const reportAgeDays = (generatedAt: string, today: string): number =>
  Math.max(
    0,
    Math.round((new Date(today).getTime() - new Date(generatedAt).getTime()) / 86_400_000),
  );

/** Source label for a report/player — provenance, shown as text not colour. */
export const provenanceText = (discovery: PlayerDiscoveryStatus): string =>
  discovery === "UNDISCOVERED"
    ? "Not yet discovered"
    : discovery === "DISCOVERED"
      ? "Discovered"
      : discovery === "SCOUTED"
        ? "Scouted"
        : "Known";

/* ------------------------------------------------------------------
 * Phase 5B — Recruitment Focuses (scouting assignments) + uncertainty
 * ------------------------------------------------------------------ */

export const ASSIGNMENT_TYPE_LABELS: Record<string, string> = {
  PLAYER: "Player",
  CLUB: "Club",
  COMPETITION: "Competition",
  REGION: "Region",
  POSITION: "Position",
  SHORTLIST: "Shortlist",
};

/** Exact canonical scouting-assignment types, never fabricated. */
export const SUPPORTED_ASSIGNMENT_TYPES: readonly string[] = Object.keys(ASSIGNMENT_TYPE_LABELS);

export const assignmentTypeLabel = (type: string): string =>
  ASSIGNMENT_TYPE_LABELS[type] ?? type.toLowerCase();

export const assignmentStatusText = (status: string): string => status.toLowerCase();

const STATUS_ORDER: Record<string, number> = {
  ACTIVE: 0,
  QUEUED: 1,
  PLANNED: 2,
  COMPLETED: 3,
  CANCELLED: 4,
};

/** Deterministic lifecycle ordering: active first, then by start date desc. */
export const orderAssignments = <T extends { status: string; startedAt: string; id: string }>(
  assignments: readonly T[],
): T[] =>
  [...assignments].sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      b.startedAt.localeCompare(a.startedAt) ||
      a.id.localeCompare(b.id),
  );

/** The genuinely in-progress assignments (never completed/cancelled). */
export const activeAssignments = <T extends { status: string }>(assignments: readonly T[]): T[] =>
  assignments.filter((a) => a.status === "ACTIVE" || a.status === "QUEUED" || a.status === "PLANNED");

/* ------------------------------------------------------------------
 * Phase 5C — Shortlists + Squad Planner (derived view helpers)
 * ------------------------------------------------------------------ */

export type ShortlistSortKey = "player" | "added" | "knowledge" | "ability" | "club";

export const shortlistSortRows = <
  T extends {
    playerName?: string;
    knowledge: PlayerKnowledgeLevel;
    estimatedAbility?: KnowledgeRange;
    addedAt: string;
    clubName?: string;
  },
>(
  rows: readonly T[],
  key: ShortlistSortKey,
): T[] =>
  [...rows].sort((a, b) => {
    switch (key) {
      case "player":
        return (a.playerName ?? "").localeCompare(b.playerName ?? "");
      case "added":
        return b.addedAt.localeCompare(a.addedAt);
      case "knowledge":
        return KNOWLEDGE_ORDER[a.knowledge] - KNOWLEDGE_ORDER[b.knowledge] || a.addedAt.localeCompare(b.addedAt);
      case "ability": {
        const av = abilityScale(a.estimatedAbility);
        const bv = abilityScale(b.estimatedAbility);
        if (av === undefined && bv === undefined) return a.addedAt.localeCompare(b.addedAt);
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        return av - bv || a.addedAt.localeCompare(b.addedAt);
      }
      case "club":
        return (a.clubName ?? "").localeCompare(b.clubName ?? "") || a.addedAt.localeCompare(b.addedAt);
    }
  });

/** Position lanes derived ONLY from the canonical 10 PlayerPositions. */
export const positionGroupFor = (position: string): string =>
  position === "GK"
    ? "goalkeepers"
    : position === "RB" || position === "CB" || position === "LB"
      ? "defenders"
      : position === "DM" || position === "CM" || position === "AM"
        ? "midfielders"
        : position === "RW" || position === "LW" || position === "ST"
          ? "attackers"
          : "other";

export const POSITION_LANES: readonly { value: string; label: string }[] = [
  { value: "goalkeepers", label: "Goalkeepers" },
  { value: "defenders", label: "Defenders" },
  { value: "midfielders", label: "Midfielders" },
  { value: "attackers", label: "Attackers" },
];

export const HORIZONS: readonly { value: number; label: string }[] = [
  { value: 0, label: "Now" },
  { value: 180, label: "6 months ahead" },
  { value: 365, label: "12 months ahead" },
];

const addDays = (iso: string, days: number): string => {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Factual classification of a player's contract at a future horizon. An
 * expiring contract is stated as such — it is NEVER treated as a confirmed
 * departure while renewal remains possible.
 */
export const classifyHorizon = (
  player: { contractExpiry?: string },
  horizonDays: number,
  worldDate: string,
): { state: "CONTRACTED" | "CONTRACT_EXPIRES" | "NO_CONTRACT"; text: string } => {
  if (!player.contractExpiry) return { state: "NO_CONTRACT", text: "No contract expiry date recorded" };
  const horizon = horizonDays === 0 ? worldDate : addDays(worldDate, horizonDays);
  if (player.contractExpiry <= horizon) {
    return { state: "CONTRACT_EXPIRES", text: "Contract expires before this horizon" };
  }
  return { state: "CONTRACTED", text: "Contracted at this horizon" };
};