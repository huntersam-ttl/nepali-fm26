import { CountryCodeError, CountryCodeRepository, type GameDatabase } from "@nepal-football-sim/database";
import { createStableEntityId, type EntityId } from "@nepal-football-sim/shared-types";

/*
 * The one path by which the engine turns "a country the engine itself names" (the international
 * registry, the foreign-market bootstrap) into a `countries` row. Those sources use ISO alpha-2
 * codes; the global import and older saves may already hold the same country under another code
 * (India as "IND"), so the lookup tries every known form before a row is created.
 */

/**
 * ISO 3166-1 alpha-3 for every country the engine names by alpha-2: the international registry,
 * the foreign-market bootstrap and the market regions. The one place the two forms are paired.
 * Facts, not guesses; extend when the engine names a new country.
 */
export const ISO_ALPHA3_BY_ALPHA2: Readonly<Record<string, string>> = {
  AE: "ARE", AF: "AFG", AO: "AGO", AR: "ARG", AT: "AUT", AU: "AUS", BD: "BGD", BE: "BEL", BG: "BGR", BH: "BHR",
  BO: "BOL", BR: "BRA", BT: "BTN", CA: "CAN", CD: "COD", CG: "COG", CH: "CHE", CI: "CIV", CL: "CHL", CM: "CMR",
  CN: "CHN", CO: "COL", CR: "CRI", CZ: "CZE", DE: "DEU", DK: "DNK", DZ: "DZA", EC: "ECU", EG: "EGY", ES: "ESP",
  ET: "ETH", FI: "FIN", FJ: "FJI", FR: "FRA", GB: "GBR", GH: "GHA", GR: "GRC", GT: "GTM", HK: "HKG", HN: "HND",
  HR: "HRV", HT: "HTI", HU: "HUN", ID: "IDN", IE: "IRL", IL: "ISR", IN: "IND", IQ: "IRQ", IR: "IRN", IS: "ISL",
  IT: "ITA", JM: "JAM", JO: "JOR", JP: "JPN", KE: "KEN", KP: "PRK", KR: "KOR", KW: "KWT", LK: "LKA", MA: "MAR",
  MN: "MNG", MO: "MAC", MV: "MDV", MX: "MEX", MY: "MYS", MZ: "MOZ", NG: "NGA", NL: "NLD", NO: "NOR", NP: "NPL",
  NZ: "NZL", OM: "OMN", PA: "PAN", PE: "PER", PG: "PNG", PH: "PHL", PK: "PAK", PL: "POL", PT: "PRT", PY: "PRY",
  QA: "QAT", RO: "ROU", RS: "SRB", RW: "RWA", SA: "SAU", SB: "SLB", SE: "SWE", SK: "SVK", SN: "SEN", SV: "SLV",
  TH: "THA", TN: "TUN", TO: "TON", TR: "TUR", TW: "TPE", TZ: "TZA", UA: "UKR", UG: "UGA", US: "USA", UY: "URY",
  UZ: "UZB", VE: "VEN", VN: "VNM", VU: "VUT", WS: "WSM", YE: "YEM", ZA: "ZAF", ZM: "ZMB", ZW: "ZWE",
};

const ISO_ALPHA2_BY_ALPHA3: ReadonlyMap<string, string> = new Map(Object.entries(ISO_ALPHA3_BY_ALPHA2).map(([alpha2, alpha3]) => [alpha3, alpha2]));

/** The ISO alpha-2 form of a code the engine knows (either form, any case), or undefined for a code it does not pair. */
export const isoAlpha2Of = (code: string | undefined): string | undefined => {
  const normalized = code?.trim().toUpperCase();
  if (!normalized) return undefined;
  if (ISO_ALPHA3_BY_ALPHA2[normalized]) return normalized;
  return ISO_ALPHA2_BY_ALPHA3.get(normalized);
};

/** Every code a country row is known by: its stored code and its registered aliases, upper-cased. */
export const countryCodesOf = (db: GameDatabase, countryId: EntityId): string[] => {
  const rows = db
    .prepare("SELECT iso_code AS code FROM countries WHERE id = ? UNION SELECT code FROM country_codes WHERE country_id = ? ORDER BY code")
    .all(countryId, countryId) as Array<{ code: string }>;
  return rows.map((row) => row.code.toUpperCase());
};

/** Every code the engine knows for a country it names by ISO alpha-2, alpha-2 first. */
export const engineCountryCodes = (isoAlpha2: string): string[] => {
  const alpha3 = ISO_ALPHA3_BY_ALPHA2[isoAlpha2];
  return alpha3 ? [isoAlpha2, alpha3] : [isoAlpha2];
};

/** The existing country for an alpha-2 code (or its known alpha-3), if the save has one. */
export const findEngineCountry = (db: GameDatabase, isoAlpha2: string): EntityId | undefined =>
  new CountryCodeRepository(db).resolveByAnyCode(engineCountryCodes(isoAlpha2));

/**
 * Last resort: a dataset that names a country but gives it a generated code ("X-EGYPT") has no
 * code the engine can match, so an exact, unique name match stands in. An ambiguous name matches nothing.
 */
const uniqueCountryNamed = (db: GameDatabase, name: string): EntityId | undefined => {
  try {
    return new CountryCodeRepository(db).resolveByExactName(name);
  } catch (error) {
    if (error instanceof CountryCodeError) return undefined;
    throw error;
  }
};

/**
 * The country row for an engine-named country: an existing one under any of its codes, or a new
 * one created with the alpha-2 code. The codes are recorded as aliases, so calling this again
 * changes nothing.
 */
export const ensureEngineCountry = (db: GameDatabase, input: { isoAlpha2: string; name: string }): EntityId => {
  const codes = new CountryCodeRepository(db);
  let id = findEngineCountry(db, input.isoAlpha2) ?? uniqueCountryNamed(db, input.name);
  if (!id) {
    id = createStableEntityId("country", input.isoAlpha2);
    db.prepare("INSERT OR IGNORE INTO countries (id, name, iso_code) VALUES (?, ?, ?)").run(id, input.name, input.isoAlpha2);
  }
  codes.addAliasIfFree({ countryId: id, code: input.isoAlpha2, system: "ISO_ALPHA2", source: "engine" });
  const alpha3 = ISO_ALPHA3_BY_ALPHA2[input.isoAlpha2];
  if (alpha3) codes.addAliasIfFree({ countryId: id, code: alpha3, system: "ISO_ALPHA3", source: "engine" });
  return id;
};
