import type { GameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * The football country a save is played in: its country, federation, currency
 * and number formatting. There is one place that decides this, so systems ask
 * for the home context instead of each looking up Nepal or ANFA themselves.
 */
export type HomeFootballContext = {
  countryId: EntityId;
  countryIso: string;
  countryName: string;
  federationId: EntityId;
  federationName: string;
  currency: string;
  locale: string;
};

/**
 * ISO codes of the home country, most specific first. The launch dataset is
 * Nepal (`NPL` in the imported world, `NP` in older saves); a future country
 * pack supplies its own code here.
 */
const HOME_COUNTRY_ISO_CODES = ["NPL", "NP"] as const;

const HOME_CURRENCY = "NPR";
const HOME_LOCALE = "en-IN";

const isoRank = (column: string): string =>
  `CASE ${column} ${HOME_COUNTRY_ISO_CODES.map((iso, index) => `WHEN '${iso}' THEN ${index}`).join(" ")} ELSE ${HOME_COUNTRY_ISO_CODES.length} END`;

const isoList = HOME_COUNTRY_ISO_CODES.map((iso) => `'${iso}'`).join(", ");

/** The home country id alone, for callers that run before a federation exists. */
export const homeCountryId = (db: GameDatabase): EntityId | undefined =>
  (
    db
      .prepare(`SELECT id FROM countries WHERE iso_code IN (${isoList}) ORDER BY ${isoRank("iso_code")} LIMIT 1`)
      .get() as { id: EntityId } | undefined
  )?.id;

/** The home context, or undefined for a save that has no home federation yet. */
export const findHomeFootballContext = (db: GameDatabase): HomeFootballContext | undefined => {
  const row = db
    .prepare(
      `SELECT c.id AS country_id, c.iso_code, c.name AS country_name, f.id AS federation_id, f.name AS federation_name
       FROM countries c JOIN federations f ON f.country_id = c.id
       WHERE c.iso_code IN (${isoList})
       ORDER BY ${isoRank("c.iso_code")}, f.name LIMIT 1`,
    )
    .get() as
    | { country_id: EntityId; iso_code: string; country_name: string; federation_id: EntityId; federation_name: string }
    | undefined;
  if (!row) return undefined;
  return {
    countryId: row.country_id,
    countryIso: row.iso_code,
    countryName: row.country_name,
    federationId: row.federation_id,
    federationName: row.federation_name,
    currency: HOME_CURRENCY,
    locale: HOME_LOCALE,
  };
};

export const homeFootballContext = (db: GameDatabase): HomeFootballContext => {
  const context = findHomeFootballContext(db);
  if (!context) throw new Error("The save has no home football federation.");
  return context;
};
