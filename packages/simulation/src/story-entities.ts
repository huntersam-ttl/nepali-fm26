import type { EntityId, EntityReference, EntityReferenceType, HistoricalEvent, CareerRole, StoryImportanceBand } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "@nepal-football-sim/database";
import { buildEntityReference } from "./entity-reference.js";

/** The EntityRef kinds this resolver knows how to turn into a real,
 * clickable EntityReference — anything else is silently skipped rather
 * than guessed at, so a story never shows a broken or fake link. */
const REF_TYPE_MAP: Partial<Record<HistoricalEvent["involvedEntities"][number]["type"], EntityReferenceType>> = {
  club: "CLUB",
  competition: "COMPETITION",
  fixture: "FIXTURE",
  governmentInstitution: "GOVERNMENT_INSTITUTION",
  infrastructureProject: "INFRASTRUCTURE_PROJECT",
};

/**
 * Resolves one raw EntityRef (id + generic lowercase type) into a real,
 * clickable EntityReference — used to enrich stories/inbox items that only
 * ever carried the raw ref before. "person" is ambiguous between a player
 * and a staff member, so it's disambiguated by checking for a real
 * player-attributes row rather than guessing.
 */
export const resolveStoryEntityReference = (
  db: GameDatabase,
  ref: { id: EntityId; type: string },
  role: CareerRole,
): EntityReference | undefined => {
  const mapped = REF_TYPE_MAP[ref.type as keyof typeof REF_TYPE_MAP];
  if (mapped) return buildEntityReference(db, mapped, ref.id, role);
  if (ref.type === "person") {
    const isPlayer = db.prepare("SELECT 1 FROM player_attributes WHERE person_id=?").get(ref.id);
    return buildEntityReference(db, isPlayer ? "PLAYER" : "STAFF", ref.id, role);
  }
  return undefined;
};

/**
 * A presentation-only importance band derived from the real, already-
 * computed HistoricalEvent.importance — never an invented drama signal.
 * "historic" events are always BREAKING; everything else maps directly
 * across (high -> MAJOR, medium -> IMPORTANT, low -> ROUTINE).
 */
export const storyImportanceBand = (importance: HistoricalEvent["importance"]): StoryImportanceBand =>
  importance === "historic" ? "BREAKING" : importance === "high" ? "MAJOR" : importance === "medium" ? "IMPORTANT" : "ROUTINE";
