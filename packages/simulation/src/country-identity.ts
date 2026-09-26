import { CountryCodeError, CountryCodeRepository, type GameDatabase } from "@nepal-football-sim/database";
import { createStableEntityId, type EntityId } from "@nepal-football-sim/shared-types";

/*
 * The one path by which the engine turns "a country the engine itself names" (the international
 * registry, the foreign-market bootstrap) into a `countries` row. Those sources use ISO alpha-2
 * codes; the global import and older saves may already hold the same country under another code
 * (India as "IND"), so the lookup tries every known form before a row is created.
 */

/** ISO 3166-1 alpha-3 for every country the engine references by alpha-2. Facts, not guesses; extend when the engine names a new country. */
export const ISO_ALPHA3_BY_ALPHA2: Readonly<Record<string, string>> = {
  NP: "NPL", IN: "IND", BD: "BGD", BT: "BTN", MV: "MDV", PK: "PAK", LK: "LKA", AF: "AFG", IR: "IRN", JP: "JPN",
  KR: "KOR", CN: "CHN", AU: "AUS", QA: "QAT", SA: "SAU", AE: "ARE", UZ: "UZB", TH: "THA", VN: "VNM", ID: "IDN",
  MY: "MYS", PH: "PHL", DE: "DEU", BR: "BRA", US: "USA", NZ: "NZL", EG: "EGY", NG: "NGA", GH: "GHA",
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
