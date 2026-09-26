import type { GameDatabase } from "@nepal-football-sim/database";
import { createStableEntityId, type EntityId, type FounderLocationOption } from "@nepal-football-sim/shared-types";
import { countryPack, type PackAdministrativeArea, type PackGeography } from "./country-pack.js";
import { findHomeFootballContext, homeCountryId } from "./home-context.js";
import { NEPAL_PACK_ID } from "./country-packs/nepal.js";

/*
 * Administrative geography of the home country. The `locations` table is the source of truth: a
 * place is found by its country and its parent chain, never by a name the code knows. A country's
 * pack may add a `geography` (places a new save must have, the places its territorial football
 * is built from); nothing here assumes a hierarchy of any particular depth or naming.
 */

export type LocationNode = { id: EntityId; name: string; kind: string; parentId?: EntityId; countryId: EntityId };

type LocationRow = { id: EntityId; name: string; kind: string; parent_location_id: EntityId | null; country_id: EntityId };

const toNode = (row: LocationRow): LocationNode => ({ id: row.id, name: row.name, kind: row.kind, parentId: row.parent_location_id ?? undefined, countryId: row.country_id });

/** A location and its ancestors, nearest first. Stops at a missing parent or a repeated place, so a broken or cyclic hierarchy is safe. */
export const locationAncestry = (db: GameDatabase, locationId: EntityId | undefined): LocationNode[] => {
  const chain: LocationNode[] = [];
  const seen = new Set<EntityId>();
  let cursor = locationId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const row = db.prepare("SELECT id, name, kind, parent_location_id, country_id FROM locations WHERE id = ?").get(cursor) as LocationRow | undefined;
    if (!row) break;
    chain.push(toNode(row));
    cursor = row.parent_location_id ?? undefined;
  }
  return chain;
};

/** The nearest place of one of `kinds` in an ancestry (the location itself counts). */
export const nearestOfKind = (chain: readonly LocationNode[], ...kinds: string[]): LocationNode | undefined => chain.find((node) => kinds.includes(node.kind));

/** The country a location belongs to. */
export const owningCountryOf = (db: GameDatabase, locationId: EntityId | undefined): EntityId | undefined => locationAncestry(db, locationId)[0]?.countryId;

/** Every home-country place of the given kinds, in a stable order. */
export const homeLocationsOfKind = (db: GameDatabase, ...kinds: string[]): LocationNode[] => {
  const country = homeCountryId(db);
  if (!country || kinds.length === 0) return [];
  return (db
    .prepare(`SELECT id, name, kind, parent_location_id, country_id FROM locations WHERE country_id = ? AND kind IN (${kinds.map(() => "?").join(", ")}) ORDER BY name, id`)
    .all(country, ...kinds) as LocationRow[]).map(toNode);
};

/** The geography of the save's home country's pack, or the launch pack's for a hand-built world with no home country. */
export const homeGeography = (db: GameDatabase): PackGeography | undefined => {
  const packId = findHomeFootballContext(db)?.packId ?? NEPAL_PACK_ID;
  return countryPack(packId).geography;
};

export const cleanPlaceName = (value: string): string => value.toLowerCase().replace(/ district| province|\s+/g, "");

const walk = (areas: readonly PackAdministrativeArea[], visit: (area: PackAdministrativeArea, parent: PackAdministrativeArea | undefined) => void, parent?: PackAdministrativeArea): void => {
  for (const area of areas) {
    visit(area, parent);
    walk(area.children ?? [], visit, area);
  }
};

const kindCode = (kind: string): string => (kind === "province" ? "PROV" : kind === "district" ? "DIST" : kind.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4));

/**
 * Adds the places of the home pack's geography that the save does not have, under the places they
 * belong to. A place already present (same country, kind and name) is left as it is, so this is
 * safe to run again.
 */
export const seedGeographyLocations = (db: GameDatabase, geography: PackGeography | undefined = homeGeography(db)): void => {
  const country = homeCountryId(db);
  if (!country || !geography) return;
  const insert = db.prepare(
    "INSERT INTO locations (id, canonical_external_id, country_id, name, kind, parent_location_id) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const find = db.prepare("SELECT id FROM locations WHERE country_id = ? AND kind = ? AND lower(name) = lower(?) LIMIT 1");
  const place = (area: PackAdministrativeArea, parentId: EntityId | undefined): EntityId => {
    const existing = find.get(country, area.kind, area.name) as { id?: EntityId } | undefined;
    if (existing?.id) return existing.id;
    const id = createStableEntityId(`${geography.idNamespace}-founder-${area.kind}`, area.name);
    insert.run(id, `${geography.codePrefix}-${kindCode(area.kind)}-${cleanPlaceName(area.name).toUpperCase()}`, country, area.name, area.kind, parentId ?? null);
    return id;
  };
  const seed = (areas: readonly PackAdministrativeArea[], parentId: EntityId | undefined): void => {
    for (const area of areas) seed(area.children ?? [], place(area, parentId));
  };
  seed(geography.areas, undefined);
};

/**
 * The places a founder may put a new club in, before any save exists: the pack's own district list
 * (its order is the chooser's order), else the districts its dataset carries, else the dataset's
 * municipalities and cities when it has no district layer. The "province" shown is the nearest
 * larger area, or the country.
 */
export const founderLocationOptions = (input: {
  geography?: PackGeography;
  countryName: string;
  datasetLocations?: ReadonlyArray<{ key: string; name: string; kind: string; parentKey?: string }>;
}): FounderLocationOption[] => {
  const listed: Array<{ name: string; parent: string }> = [];
  if (input.geography) {
    walk(input.geography.areas, (area, parent) => {
      if (area.kind === "district") listed.push({ name: area.name, parent: parent?.name ?? "" });
    });
  }
  if (listed.length > 0) {
    return listed.map((item) => ({
      id: createStableEntityId("location", item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
      province: item.parent,
      district: item.name,
      locality: item.name,
      provenanceStatus: "REPORTED" as const,
    }));
  }
  const locations = input.datasetLocations ?? [];
  const byKey = new Map(locations.map((location) => [location.key, location] as const));
  const districts = locations.filter((location) => location.kind === "district");
  const places = districts.length > 0 ? districts : locations.filter((location) => location.kind === "municipality" || location.kind === "city");
  return [...places]
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
    .map((place) => ({
      id: createStableEntityId("location", place.key),
      province: (place.parentKey ? byKey.get(place.parentKey)?.name : undefined) ?? input.countryName,
      district: place.name,
      locality: place.name,
      provenanceStatus: "REPORTED" as const,
    }));
};

/** Places a club with no recorded location can plausibly be shown in: the pack's hubs, else the home country's own districts or cities. */
export const clubLocalityHubs = (db: GameDatabase): string[] => {
  const hubs = homeGeography(db)?.clubLocalityHubs;
  if (hubs && hubs.length > 0) return [...hubs];
  const places = homeLocationsOfKind(db, "district");
  return (places.length > 0 ? places : homeLocationsOfKind(db, "municipality", "city")).map((place) => place.name);
};
