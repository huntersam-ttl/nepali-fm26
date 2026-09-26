import type { GameDatabase } from "@nepal-football-sim/database";
import type { EntityId, ExternalFootballRegion } from "@nepal-football-sim/shared-types";
import { countryCodesOf, isoAlpha2Of } from "./country-identity.js";
import { findHomeFootballContext } from "./home-context.js";

/*
 * Football market regions: which market a country's clubs and players belong to when a club is
 * scouting or recruiting abroad. A country is placed by ISO alpha-2 code; the alpha-3 form and any
 * registered alias reach the same placement through country identity, so no country is listed twice.
 * A country not listed here is UNCLASSIFIED: it has no market region and is never taken to be the
 * home country's. The home country's own region is whichever region lists it.
 */

export const MARKET_REGION_COUNTRIES: Readonly<Record<ExternalFootballRegion, readonly string[]>> = {
  SOUTH_ASIA: ["NP", "IN", "BD", "MV", "BT", "PK", "LK", "AF"],
  WIDER_ASIA: ["CN", "HK", "MO", "MN", "KP", "KR", "TW", "JP"],
  MIDDLE_EAST: ["AE", "SA", "QA", "IR", "IQ", "IL", "JO", "KW", "OM", "BH", "YE"],
  AUSTRALIA: ["AU", "NZ", "FJ", "PG"],
  EUROPE: ["GB", "IE", "FR", "DE", "ES", "IT", "PT", "NL", "BE", "CH", "AT", "SE", "NO", "DK", "FI", "IS", "PL", "CZ", "SK", "HU", "RO", "BG", "GR", "HR", "RS", "UA", "TR"],
  AFRICA: ["NG", "GH", "CM", "SN", "CI", "ZA", "KE", "TZ", "UG", "ET", "MA", "DZ", "TN", "EG", "ZM", "ZW", "MZ", "AO", "CD", "CG", "RW"],
  SOUTH_AMERICA: ["BR", "AR", "UY", "CL", "CO", "PE", "EC", "BO", "PY", "VE"],
  NORTH_CENTRAL_AMERICA: ["US", "CA", "MX", "CR", "PA", "HN", "GT", "SV", "JM", "HT"],
  OCEANIA: ["WS", "TO", "VU", "SB"],
};

export const MARKET_REGIONS = Object.keys(MARKET_REGION_COUNTRIES) as ExternalFootballRegion[];

const REGION_BY_ALPHA2: ReadonlyMap<string, ExternalFootballRegion> = new Map(
  MARKET_REGIONS.flatMap((region) => MARKET_REGION_COUNTRIES[region].map((alpha2) => [alpha2, region] as const)),
);

/** The market region of a country code in either ISO form; undefined for an unclassified country. */
export const marketRegionForCode = (code: string | undefined): ExternalFootballRegion | undefined => {
  const alpha2 = isoAlpha2Of(code);
  return alpha2 ? REGION_BY_ALPHA2.get(alpha2) : undefined;
};

const regionOfCodes = (codes: readonly string[]): ExternalFootballRegion | undefined => {
  for (const code of codes) {
    const region = marketRegionForCode(code);
    if (region) return region;
  }
  return undefined;
};

/** The market region of a country row, through its stored code and every alias it has. */
export const marketRegionForCountry = (db: GameDatabase, countryId: EntityId | null | undefined): ExternalFootballRegion | undefined =>
  countryId ? regionOfCodes(countryCodesOf(db, countryId)) : undefined;

/** Every classified country row's market region, in one pass, for callers that classify many rows. */
export const marketRegionsByCountry = (db: GameDatabase): ReadonlyMap<EntityId, ExternalFootballRegion> => {
  const codes = new Map<EntityId, string[]>();
  const rows = db
    .prepare("SELECT id AS country_id, iso_code AS code FROM countries UNION ALL SELECT country_id, code FROM country_codes ORDER BY country_id, code")
    .all() as Array<{ country_id: EntityId; code: string }>;
  for (const row of rows) codes.set(row.country_id, [...(codes.get(row.country_id) ?? []), row.code]);
  const regions = new Map<EntityId, ExternalFootballRegion>();
  for (const [countryId, list] of codes) {
    const region = regionOfCodes(list);
    if (region) regions.set(countryId, region);
  }
  return regions;
};

/** The market region the save's home country belongs to, if it is classified. */
export const homeMarketRegion = (db: GameDatabase): ExternalFootballRegion | undefined => {
  const home = findHomeFootballContext(db);
  return home ? marketRegionForCountry(db, home.countryId) : undefined;
};

/** Whether two country rows are the same country: the same row, or rows that share a code once both ISO forms are treated as one. */
export const sameCountryIdentity = (db: GameDatabase, a: EntityId, b: EntityId): boolean => {
  if (a === b) return true;
  const canonical = (id: EntityId): Set<string> => new Set(countryCodesOf(db, id).map((code) => isoAlpha2Of(code) ?? code));
  const left = canonical(a);
  return [...canonical(b)].some((code) => left.has(code));
};

/** "SOUTH_ASIA" -> "South Asia". */
export const marketRegionLabel = (region: ExternalFootballRegion): string =>
  region
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
