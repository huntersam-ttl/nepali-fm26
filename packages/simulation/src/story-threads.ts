import type {
  CareerRole,
  EntityId,
  EntityReference,
  HistoricalEvent,
  StoryThread,
  StoryThreadCategory,
  StorylineEntry,
} from "@nepal-football-sim/shared-types";
import { EventRepository, type GameDatabase, type PublicEventRole } from "@nepal-football-sim/database";
import { resolveStoryEntityReference, storyImportanceBand } from "./story-entities.js";
import { roleInboxEvents } from "./media.js";

export type { StoryThread, StoryThreadCategory } from "@nepal-football-sim/shared-types";

/**
 * A story thread is never stored — it is derived, on every read, from the
 * same canonical historical-event stream the Inbox and Media already use.
 * There is deliberately no second event/thread table: membership is a pure
 * function of stable event metadata (the involved player/club/competition),
 * so a thread always reflects exactly what the event stream contains.
 */

/** Event types matching this are a settled end-state, not an open thread. */
const RESOLVED_EVENT = /(COMPLETED|TRANSFERRED|AGREED|DECLARED|ENDED|SETTLED|WALKED_AWAY|COLLAPSED|REJECTED|WITHDRAWN|EXPIRED|PAID|PROMOTED|DEAL_COMPLETED)/;

/** Turns a raw SNAKE_CASE event type into readable copy — never shown as an enum. */
export const humanizeEventType = (eventType: string): string =>
  eventType
    .toLowerCase()
    .split("_")
    .join(" ")
    .replace(/^./, (char) => char.toUpperCase());

const categoryFor = (event: HistoricalEvent): StoryThreadCategory | undefined => {
  const type = event.eventType.toUpperCase();
  if (/LOAN/.test(type)) return "LOAN";
  if (/TRANSFER|FREE_AGENT/.test(type)) return "TRANSFER";
  if (/OWNERSHIP|INVESTOR|TAKEOVER/.test(type)) return "OWNERSHIP";
  if (/FACILITY|INFRASTRUCTURE|GOVERNMENT_SUPPORT/.test(type)) return "FACILITY";
  if (/INJURY/.test(type)) return "INJURY";
  if (/CONTRACT/.test(type)) return "CONTRACT";
  if (/NATIONAL_TEAM|CALLUP|CALL_UP|NATIONAL.*CAMP/.test(type)) return "NATIONAL_PATHWAY";
  if (/SPONSOR|COMMERCIAL/.test(type)) return "COMMERCIAL";
  if (/COMPETITION|CHAMPION|PROMOTION|RELEGATION|SEASON/.test(type)) return "COMPETITION";
  return undefined;
};

const PRIMARY_REF_TYPE: Record<StoryThreadCategory, string> = {
  TRANSFER: "person",
  LOAN: "person",
  INJURY: "person",
  CONTRACT: "person",
  NATIONAL_PATHWAY: "person",
  OWNERSHIP: "club",
  FACILITY: "club",
  COMMERCIAL: "club",
  COMPETITION: "competition",
};

const primaryRefFor = (
  category: StoryThreadCategory,
  event: HistoricalEvent,
): HistoricalEvent["involvedEntities"][number] | undefined => {
  const wanted = PRIMARY_REF_TYPE[category];
  return event.involvedEntities.find((ref) => ref.type === wanted) ?? event.involvedEntities[0];
};

/**
 * Pure, deterministic grouping: same input events always produce the same
 * threads in the same order, regardless of call order or Map iteration.
 */
export const deriveStoryThreadsFromEvents = (
  db: GameDatabase,
  events: HistoricalEvent[],
  role: CareerRole,
): StoryThread[] => {
  const groups = new Map<string, { category: StoryThreadCategory; primaryRef: HistoricalEvent["involvedEntities"][number]; events: HistoricalEvent[] }>();
  for (const event of events) {
    const category = categoryFor(event);
    if (!category) continue;
    const primaryRef = primaryRefFor(category, event);
    if (!primaryRef) continue;
    const key = `${category}:${primaryRef.id}`;
    const existing = groups.get(key);
    if (existing) existing.events.push(event);
    else groups.set(key, { category, primaryRef, events: [event] });
  }
  const threads: StoryThread[] = [];
  for (const [key, group] of groups) {
    const ordered = [...group.events].sort(
      (a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id),
    );
    const latestEvent = ordered[ordered.length - 1]!;
    const primaryEntity = resolveStoryEntityReference(db, group.primaryRef, role);
    if (!primaryEntity) continue;
    const seen = new Set<string>();
    const involvedEntities: EntityReference[] = [];
    for (const event of ordered) {
      for (const ref of event.involvedEntities) {
        const resolved = resolveStoryEntityReference(db, ref, role);
        if (!resolved) continue;
        const dedupeKey = `${resolved.entityType}:${resolved.id}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        involvedEntities.push(resolved);
      }
    }
    threads.push({
      id: key,
      category: group.category,
      primaryEntity,
      currentState: humanizeEventType(latestEvent.eventType),
      latestEvent,
      resolved: RESOLVED_EVENT.test(latestEvent.eventType.toUpperCase()),
      events: ordered,
      involvedEntities,
    });
  }
  return threads.sort(
    (a, b) => b.latestEvent.occurredOn.localeCompare(a.latestEvent.occurredOn) || a.id.localeCompare(b.id),
  );
};

const careerRoleForPublicRole = (role: PublicEventRole): CareerRole =>
  role === "OWNER" ? "CHAIRMAN_OWNER" : role === "PRESIDENT" ? "FEDERATION_PRESIDENT" : "MANAGER";

/** Threads built from exactly the events already routed to this person/role
 * — inherits the routing pipeline's exact-once and role-scoping guarantees
 * rather than re-deriving visibility rules a second time. */
export const roleStoryThreads = (
  db: GameDatabase,
  input: { personId: EntityId; role: PublicEventRole },
): StoryThread[] => {
  const events = roleInboxEvents(db, input.personId, input.role).map((delivery) => delivery.event);
  return deriveStoryThreadsFromEvents(db, events, careerRoleForPublicRole(input.role));
};

export const findThreadForEvent = (threads: StoryThread[], eventId: EntityId): StoryThread | undefined =>
  threads.find((thread) => thread.events.some((event) => event.id === eventId));

export type { StorylineEntry } from "@nepal-football-sim/shared-types";

/**
 * A Player or Club Profile's recent-story section — the same canonical
 * historical events the Inbox reads, filtered to ones involving this one
 * entity and ranked by recency. Never a separate fake biography record.
 */
export const buildEntityStoryline = (
  db: GameDatabase,
  entityId: EntityId,
  limit = 8,
): StorylineEntry[] =>
  new EventRepository(db)
    .historicalEvents()
    .filter((event) => event.involvedEntities.some((ref) => ref.id === entityId))
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id))
    .slice(0, limit)
    .map((event) => ({
      date: event.occurredOn,
      headline: event.title,
      importanceBand: storyImportanceBand(event.importance),
      category: categoryFor(event),
      eventId: event.id,
    }));

/** The single most relevant ongoing (or, failing that, most recent) thread
 * for this entity — used as a Profile's "current active story" card. */
export const currentEntityThread = (
  db: GameDatabase,
  entityId: EntityId,
  role: CareerRole,
): StoryThread | undefined => {
  const events = new EventRepository(db)
    .historicalEvents()
    .filter((event) => event.involvedEntities.some((ref) => ref.id === entityId));
  const threads = deriveStoryThreadsFromEvents(db, events, role).filter(
    (thread) => thread.primaryEntity.id === entityId,
  );
  return threads.find((thread) => !thread.resolved) ?? threads[0];
};
