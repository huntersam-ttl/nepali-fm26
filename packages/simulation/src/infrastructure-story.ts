import type { GameDatabase } from "@nepal-football-sim/database";
import { EventRepository } from "@nepal-football-sim/database";
import type { CareerRole, EntityId, EntityReference, EntityReferenceType, HistoricalEvent, InfrastructureStoryEntry, InfrastructureStoryTone } from "@nepal-football-sim/shared-types";
import { buildEntityReference } from "./entity-reference.js";

/** Only the event types this sprint's infrastructure/government story
 * pipeline actually emits — anything else is a different feature's news and
 * has no place on the club's infrastructure card/history. */
const INFRASTRUCTURE_EVENT_TYPES = new Set([
  "GOVERNMENT_SUPPORT_REQUESTED",
  "GOVERNMENT_SUPPORT_APPROVED",
  "GOVERNMENT_SUPPORT_REJECTED",
  "INFRASTRUCTURE_PROJECT_STARTED",
  "INFRASTRUCTURE_PROJECT_DELAYED",
  "INFRASTRUCTURE_MILESTONE_REACHED",
  "FACILITY_PROJECT_COMPLETED",
]);

const TONE_FOR_EVENT_TYPE: Record<string, InfrastructureStoryTone> = {
  GOVERNMENT_SUPPORT_REQUESTED: "info",
  GOVERNMENT_SUPPORT_APPROVED: "ok",
  GOVERNMENT_SUPPORT_REJECTED: "bad",
  INFRASTRUCTURE_PROJECT_STARTED: "info",
  INFRASTRUCTURE_PROJECT_DELAYED: "warn",
  INFRASTRUCTURE_MILESTONE_REACHED: "info",
  FACILITY_PROJECT_COMPLETED: "ok",
};

/** The only EntityRef kinds this story pipeline ever attaches — anything
 * else on the event is silently skipped rather than guessed at. */
const REFERENCE_TYPE_FOR_REF_TYPE: Partial<Record<HistoricalEvent["involvedEntities"][number]["type"], EntityReferenceType>> = {
  club: "CLUB",
  governmentInstitution: "GOVERNMENT_INSTITUTION",
  infrastructureProject: "INFRASTRUCTURE_PROJECT",
};

const buildStoryEntry = (db: GameDatabase, event: HistoricalEvent, role: CareerRole): InfrastructureStoryEntry => ({
  headline: event.title,
  occurredOn: event.occurredOn,
  tone: TONE_FOR_EVENT_TYPE[event.eventType] ?? "info",
  entities: event.involvedEntities
    .map((ref) => {
      const type = REFERENCE_TYPE_FOR_REF_TYPE[ref.type];
      return type ? buildEntityReference(db, type, ref.id, role) : undefined;
    })
    .filter((ref): ref is EntityReference => Boolean(ref)),
});

const clubInfrastructureEvents = (db: GameDatabase, clubId: EntityId): HistoricalEvent[] =>
  new EventRepository(db)
    .historicalEvents()
    .filter(
      (event) =>
        INFRASTRUCTURE_EVENT_TYPES.has(event.eventType) &&
        event.involvedEntities.some((ref) => ref.type === "club" && ref.id === clubId),
    )
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id));

/** The single most relevant infrastructure/government story for this club
 * right now — drives Owner Home's one-card "Infrastructure update", never a
 * feed. Undefined, honestly, when nothing has happened yet. */
export const latestInfrastructureUpdate = (
  db: GameDatabase,
  clubId: EntityId,
  role: CareerRole,
): InfrastructureStoryEntry | undefined => {
  const [latest] = clubInfrastructureEvents(db, clubId);
  return latest ? buildStoryEntry(db, latest, role) : undefined;
};

/** A short recent-history list for Club Profile 2.0 — reads the same
 * canonical historical_events records as the Owner Home card, never a
 * duplicate local history model. */
export const recentInfrastructureHistory = (
  db: GameDatabase,
  clubId: EntityId,
  role: CareerRole,
  limit = 5,
): InfrastructureStoryEntry[] =>
  clubInfrastructureEvents(db, clubId)
    .slice(0, limit)
    .map((event) => buildStoryEntry(db, event, role));

/** The single most relevant national-level story for President Home's
 * "latest story" card — any historical event genuinely scoped to this
 * federation, richest one first (highest importance, then most recent).
 * Undefined, honestly, when nothing has happened yet. */
export const latestFederationStory = (
  db: GameDatabase,
  federationId: EntityId,
  role: CareerRole,
): InfrastructureStoryEntry | undefined => {
  const importanceRank: Record<string, number> = { historic: 3, high: 2, medium: 1, low: 0 };
  const [latest] = new EventRepository(db)
    .historicalEvents()
    .filter(
      (event) =>
        event.scope === "federation" ||
        event.scope === "country" ||
        event.involvedEntities.some((ref) => ref.type === "federation" && ref.id === federationId) ||
        event.data?.federationId === federationId,
    )
    .sort(
      (a, b) =>
        (importanceRank[b.importance] ?? 0) - (importanceRank[a.importance] ?? 0) ||
        b.occurredOn.localeCompare(a.occurredOn) ||
        b.id.localeCompare(a.id),
    );
  return latest ? buildStoryEntry(db, latest, role) : undefined;
};
