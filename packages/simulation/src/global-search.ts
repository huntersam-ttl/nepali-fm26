import type { GameDatabase } from "@nepal-football-sim/database";
import type {
  EntityId,
  EntityReference,
  EntityReferenceType,
  GlobalSearchQuery,
  GlobalSearchResult,
} from "@nepal-football-sim/shared-types";

/**
 * Phase 1C — global football-world search.
 *
 * A bounded, case-insensitive, name-based lookup over entity tables that have a
 * real canonical Phase 1B destination. Results are LIGHTWEIGHT navigation
 * results only: an EntityReference (identity) plus a cheap public context
 * label. Search is deliberately shallow — it never reads hidden ability,
 * potential, wages, finances, injury detail, or scouting state. Deeper
 * permission/knowledge logic stays in the canonical destination read models
 * (getPlayerProfile, getClubProfile, getOrganizationProfile, …), which are
 * unchanged.
 *
 * Matching is a small deterministic rank: exact name, then prefix, then
 * substring; ties resolve by display name then id. Per-source SQL is bounded so
 * the full world is never shipped to the client, and results are built from
 * the matched rows directly (no N+1 profile fetches per result).
 */

type Row = Record<string, any>;

type Source = {
  type: EntityReferenceType;
  /** Returns rows with `id`, `label`, and optional `secondary`. Uses a single
   * `?` placeholder bound to `%<lowercased query>%`. */
  sql: string;
  destination: string;
};

const PLAYER_SQL = `
  SELECT p.id, p.full_name AS label, pa.primary_position AS secondary
  FROM persons p
  LEFT JOIN player_attributes pa ON pa.person_id = p.id
  WHERE lower(p.full_name) LIKE ?
    AND (EXISTS (SELECT 1 FROM player_attributes a WHERE a.person_id = p.id)
         OR EXISTS (SELECT 1 FROM player_factual_profiles f WHERE f.player_id = p.id))
  ORDER BY p.full_name LIMIT 40`;

const STAFF_SQL = `
  SELECT p.id, p.full_name AS label, sp.preferred_role AS secondary
  FROM persons p
  JOIN staff_profiles sp ON sp.person_id = p.id
  WHERE lower(p.full_name) LIKE ?
  ORDER BY p.full_name LIMIT 40`;

// Order matters only for grouping in the UI, not correctness.
const SOURCES: Source[] = [
  { type: "CLUB", sql: "SELECT id, name AS label FROM clubs WHERE lower(name) LIKE ? ORDER BY name LIMIT 40", destination: "club" },
  {
    type: "PLAYER",
    sql: PLAYER_SQL,
    destination: "player",
  },
  {
    type: "STAFF",
    sql: STAFF_SQL,
    destination: "staff",
  },
  {
    type: "COMPETITION",
    sql: "SELECT id, name AS label FROM competitions WHERE lower(name) LIKE ? ORDER BY name LIMIT 40",
    destination: "competition",
  },
  {
    type: "MEDIA_OUTLET",
    sql: "SELECT id, name AS label, scope AS secondary FROM media_outlets WHERE lower(name) LIKE ? ORDER BY name LIMIT 20",
    destination: "media-outlet",
  },
  {
    type: "JOURNALIST",
    sql: "SELECT id, name AS label, beat AS secondary FROM media_journalists WHERE lower(name) LIKE ? ORDER BY name LIMIT 20",
    destination: "journalist",
  },
  {
    type: "SPONSOR",
    sql: "SELECT id, name AS label, sector AS secondary FROM commercial_sponsor_profiles WHERE lower(name) LIKE ? ORDER BY name LIMIT 20",
    destination: "sponsor",
  },
  {
    type: "LENDER",
    sql: "SELECT id, name AS label FROM club_lenders WHERE lower(name) LIKE ? ORDER BY name LIMIT 20",
    destination: "lender",
  },
];

// 0 = exact name match, 1 = prefix, 2 = any substring; -1 = no match.
const rank = (labelLower: string, q: string): number =>
  labelLower === q ? 0 : labelLower.startsWith(q) ? 1 : labelLower.includes(q) ? 2 : -1;

const referenceFromRow = (
  type: EntityReferenceType,
  id: string,
  label: string,
  secondary: string | undefined,
  destination: string,
): EntityReference => ({
  entityType: type,
  id: id as EntityId,
  label,
  subtitle: secondary || undefined,
  destination,
  visible: true,
  allowedActions: ["OPEN_PROFILE"],
  provenanceStatus: "SIMULATION_ONLY",
});

export const searchFootballWorld = (
  db: GameDatabase,
  query: GlobalSearchQuery,
): GlobalSearchResult[] => {
  const q = (query.query ?? "").trim().toLowerCase();
  if (!q) return [];
  const limit = Math.max(1, Math.min(50, query.limit ?? 20));
  const likeArg = `%${q}%`;

  const matched: GlobalSearchResult[] = [];
  for (const source of SOURCES) {
    let rows: Row[];
    try {
      rows = (db.prepare(source.sql).all(likeArg) as Row[]) ?? [];
    } catch {
      continue; // a missing optional table must never break search
    }
    for (const row of rows) {
      const label = String(row.label ?? "");
      const labelLower = label.toLowerCase();
      const relevance = rank(labelLower, q);
      if (relevance < 0) continue;
      const displayName = label;
      matched.push({
        reference: referenceFromRow(source.type, String(row.id), displayName, row.secondary, source.destination),
        displayName,
        entityType: source.type,
        secondaryLabel: row.secondary ? String(row.secondary) : undefined,
      });
    }
  }

  matched.sort((a, b) => {
    const ra = rank(a.displayName.toLowerCase(), q);
    const rb = rank(b.displayName.toLowerCase(), q);
    if (ra !== rb) return ra - rb;
    const nameCompare = a.displayName.localeCompare(b.displayName);
    if (nameCompare !== 0) return nameCompare;
    return String(a.reference.id).localeCompare(String(b.reference.id));
  });

  return matched.slice(0, limit);
};