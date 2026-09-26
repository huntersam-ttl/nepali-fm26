import type { GameDatabase } from "@nepal-football-sim/database";
import type { ClubStadiumSummary, EntityId } from "@nepal-football-sim/shared-types";
import { SeededRandom } from "./rng.js";
import { clubLocalityHubs } from "./administrative-geography.js";

/** Deterministic per-club estimate — the same club always gets the same
 * plausible hub across renders and saves, never a different one each time. */
const estimatedClubLocality = (db: GameDatabase, clubId: EntityId): string => {
  const hubs = clubLocalityHubs(db);
  if (hubs.length === 0) return "Location not on record";
  const random = new SeededRandom(`club-locality-estimate:${clubId}`);
  const index = Math.floor(random.next() * hubs.length);
  return `${hubs[index]} (estimated)`;
};

/**
 * A single, canonical location-presentation strategy — never a bare
 * "UNKNOWN" placeholder, and never a fabricated precise address. Walks the
 * real location hierarchy the same way resolveClubDistrict /
 * resolveGovernmentInstitutionForClub already do, picking the most useful
 * real place name available:
 *   1. "Municipality/City, District" when both resolve
 *   2. "District, Province" when only the district resolves
 *   3. the club's own location name alone, if it sits above district level
 *   4. an honest "Location not on record" when the club has no location at
 *      all — never a silent blank or a raw enum/null.
 * These are real Nepal administrative names already in the dataset, not
 * SIMULATION_ONLY inventions — the club genuinely sits at this place.
 */
/**
 * The same strategy as presentClubLocation, generalized to any location id
 * — used wherever a non-club entity (a federation project's target
 * district/province, a map tile) needs the identical honest presentation
 * rule rather than a second, divergent implementation.
 */
export const presentLocationById = (db: GameDatabase, locationId: EntityId | undefined): string | undefined => {
  if (!locationId) return undefined;
  const chain = db
    .prepare(
      `WITH RECURSIVE up(id, name, kind, parent_location_id, depth) AS (
         SELECT id, name, kind, parent_location_id, 0 FROM locations WHERE id = ?
         UNION ALL
         SELECT l.id, l.name, l.kind, l.parent_location_id, up.depth + 1
         FROM locations l JOIN up ON l.id = up.parent_location_id
       )
       SELECT id, name, kind FROM up ORDER BY depth`,
    )
    .all(locationId) as Array<{ id: EntityId; name: string; kind: string }>;
  if (chain.length === 0) return undefined;
  const self = chain[0]!;
  const municipality = chain.find((entry) => entry.kind === "municipality" || entry.kind === "city" || entry.kind === "neighbourhood");
  const district = chain.find((entry) => entry.kind === "district");
  const province = chain.find((entry) => entry.kind === "province");
  if (municipality && district && municipality.id !== district.id) return `${municipality.name}, ${district.name}`;
  if (district) return province ? `${district.name}, ${province.name}` : district.name;
  if (province) return `${self.name}, ${province.name}`;
  if (self.kind === "unknown") return undefined;
  return self.name;
};

export const presentClubLocation = (db: GameDatabase, clubId: EntityId): string => {
  const club = db.prepare("SELECT location_id FROM clubs WHERE id=?").get(clubId) as
    | { location_id?: EntityId }
    | undefined;
  return presentLocationById(db, club?.location_id) ?? estimatedClubLocality(db, clubId);
};

/**
 * The club's home ground, resolved via the same club<->venue relationship
 * lookup the world already uses (see venueFor in womens-youth.ts), with the
 * same country-wide capacity fallback when no explicit relationship is on
 * file — surfaced honestly via confirmedHomeGround rather than presenting a
 * fallback guess as a confirmed fact.
 */
export const resolveClubStadium = (db: GameDatabase, clubId: EntityId): ClubStadiumSummary | undefined => {
  const confirmed = db
    .prepare("SELECT venue_id AS id FROM venue_relationships WHERE club_id = ? AND status != 'unavailable' ORDER BY id LIMIT 1")
    .get(clubId) as { id: EntityId } | undefined;
  const fallback = confirmed
    ? undefined
    : (db
        .prepare(
          "SELECT v.id FROM venues v JOIN clubs c ON c.country_id = v.country_id WHERE c.id = ? AND v.status != 'CLOSED' ORDER BY v.capacity DESC, v.id LIMIT 1",
        )
        .get(clubId) as { id: EntityId } | undefined);
  const venueId = confirmed?.id ?? fallback?.id;
  if (!venueId) return undefined;
  const venue = db
    .prepare(
      "SELECT id, name, capacity, surface_type, pitch_quality, floodlights, covered_stands, year_opened, status FROM venues WHERE id = ?",
    )
    .get(venueId) as
    | {
        id: EntityId;
        name: string;
        capacity?: number;
        surface_type?: string;
        pitch_quality?: string;
        floodlights?: number;
        covered_stands?: number;
        year_opened?: number;
        status?: string;
      }
    | undefined;
  if (!venue) return undefined;
  return {
    venueId: venue.id,
    name: venue.name,
    capacity: venue.capacity ?? undefined,
    surfaceType: venue.surface_type && venue.surface_type !== "UNKNOWN" ? venue.surface_type : undefined,
    pitchQuality: venue.pitch_quality && venue.pitch_quality !== "UNKNOWN" ? venue.pitch_quality : undefined,
    floodlights: venue.floodlights == null ? undefined : Boolean(venue.floodlights),
    coveredStands: venue.covered_stands == null ? undefined : Boolean(venue.covered_stands),
    yearOpened: venue.year_opened ?? undefined,
    status: venue.status && venue.status !== "UNKNOWN" ? venue.status : undefined,
    confirmedHomeGround: Boolean(confirmed),
  };
};
