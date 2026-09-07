import type { CareerRole, EntityId, EntityStoryline, HistoricalEvent } from "@nepal-football-sim/shared-types";
import { EventRepository, type GameDatabase } from "@nepal-football-sim/database";
import { districtIdForLocation } from "./federation-map.js";
import { categoryFor, deriveStoryThreadsFromEvents } from "./story-threads.js";
import { storyImportanceBand } from "./story-entities.js";

export type StoryTerritory = {
  districtId: EntityId;
  provinceId?: EntityId;
};

/**
 * Resolves the real geography a story canonically belongs to — walking the
 * SAME club/project/application → location → district relationships the Map
 * screen already uses (districtIdForLocation), never a fabricated district
 * id stamped onto the event itself. An event with no resolvable geography
 * (a national-team call-up, a federation-wide commercial award) correctly
 * returns undefined rather than being force-fit into a district.
 */
export const resolveStoryTerritory = (db: GameDatabase, event: HistoricalEvent): StoryTerritory | undefined => {
  const data = event.data;

  const clubId =
    (typeof data?.clubId === "string" ? (data.clubId as EntityId) : undefined) ??
    event.involvedEntities.find((ref) => ref.type === "club")?.id ??
    resolveClubIdFromApplication(db, data?.applicationId) ??
    resolveClubIdFromProject(db, data?.projectId);

  const projectLocationId = resolveProjectLocationId(db, data?.projectId);
  if (projectLocationId) {
    const districtId = districtIdForLocation(db, projectLocationId);
    if (districtId) return { districtId, provinceId: provinceIdForDistrict(db, districtId) };
  }

  if (clubId) {
    const club = db.prepare("SELECT location_id FROM clubs WHERE id=?").get(clubId) as
      | { location_id?: EntityId }
      | undefined;
    const districtId = districtIdForLocation(db, club?.location_id);
    if (districtId) return { districtId, provinceId: provinceIdForDistrict(db, districtId) };
  }

  const institutionId = typeof data?.institutionId === "string" ? (data.institutionId as EntityId) : undefined;
  if (institutionId) {
    const institution = db.prepare("SELECT location_id FROM government_institutions WHERE id=?").get(institutionId) as
      | { location_id?: EntityId }
      | undefined;
    const districtId = districtIdForLocation(db, institution?.location_id);
    if (districtId) return { districtId, provinceId: provinceIdForDistrict(db, districtId) };
  }

  return undefined;
};

const resolveClubIdFromApplication = (db: GameDatabase, applicationId: unknown): EntityId | undefined => {
  if (typeof applicationId !== "string") return undefined;
  const application = db.prepare("SELECT club_id FROM government_funding_applications WHERE id=?").get(applicationId) as
    | { club_id?: EntityId }
    | undefined;
  return application?.club_id ?? undefined;
};

const resolveClubIdFromProject = (db: GameDatabase, projectId: unknown): EntityId | undefined => {
  if (typeof projectId !== "string") return undefined;
  const project = db.prepare("SELECT club_id FROM infrastructure_projects WHERE id=?").get(projectId) as
    | { club_id?: EntityId }
    | undefined;
  return project?.club_id ?? undefined;
};

/** A club-facility project's OWN location, when it has one, takes priority
 * over its club's registered location — a training ground can be built
 * somewhere other than the club's home district. */
const resolveProjectLocationId = (db: GameDatabase, projectId: unknown): EntityId | undefined => {
  if (typeof projectId !== "string") return undefined;
  const project = db.prepare("SELECT location_id FROM infrastructure_projects WHERE id=?").get(projectId) as
    | { location_id?: EntityId }
    | undefined;
  return project?.location_id ?? undefined;
};

const provinceIdForDistrict = (db: GameDatabase, districtId: EntityId): EntityId | undefined =>
  (db.prepare("SELECT province_id FROM territorial_districts WHERE id=?").get(districtId) as { province_id?: EntityId } | undefined)
    ?.province_id ?? undefined;

/**
 * A district's real storyline — events that canonically resolve into this
 * exact geography via resolveStoryTerritory, never the federation-wide feed
 * shown elsewhere under a misleading "district story" label. Shares the same
 * EntityStoryline shape as an entity's own storyline so the desktop app can
 * reuse ONE presentation component for both.
 */
export const buildDistrictStoryline = (db: GameDatabase, districtId: EntityId, role: CareerRole, limit = 8): EntityStoryline => {
  const events = new EventRepository(db)
    .historicalEvents()
    .filter((event) => resolveStoryTerritory(db, event)?.districtId === districtId);
  const entries = events
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id))
    .slice(0, limit)
    .map((event) => ({
      date: event.occurredOn,
      headline: event.title,
      importanceBand: storyImportanceBand(event.importance),
      category: categoryFor(event),
      eventId: event.id,
    }));
  const threads = deriveStoryThreadsFromEvents(db, events, role);
  const currentStory = [...threads].sort((a, b) => b.latestEvent.occurredOn.localeCompare(a.latestEvent.occurredOn))[0];
  return { entries, currentStory };
};
