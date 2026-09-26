import { CountryCodeRepository, type GameDatabase } from "@nepal-football-sim/database";
import type { EntityId, Federation } from "@nepal-football-sim/shared-types";
import {
  countryPack,
  type CountryPack,
  type NamePool,
  type NationalTeamDefinition,
  type SeasonRules,
  type StoredHomeConfig,
} from "./country-pack.js";
import { NEPAL_PACK_ID } from "./country-packs/nepal.js";

/**
 * The football country a save is played in. There is one place that decides this, and it
 * is stored in the save (`home_football_contexts`), so systems ask for the home context
 * instead of each looking a country or federation up themselves.
 *
 * Saves made before the context existed are inferred once, by the migration, from the
 * canonical country and its federation; a database that has never had one established
 * (a hand-built test world) is inferred the same way on first use.
 */
export type HomeFootballContext = {
  packId: string;
  countryId: EntityId;
  countryIso: string;
  countryName: string;
  /** Undefined only for a bare world that has a country but no federation. */
  federationId: EntityId | undefined;
  federationName: string | undefined;
  currency: string;
  locale: string;
  federationAbbreviation: string;
  seasonRules: SeasonRules;
  nationalTeams: readonly NationalTeamDefinition[];
  tierLabels: readonly string[];
};

/** SQL for the home country id, for raw queries: `WHERE c.country_id = ${HOME_COUNTRY_SQL}`. */
export const HOME_COUNTRY_SQL = "(SELECT country_id FROM home_football_country LIMIT 1)";

type ContextRow = {
  pack_id: string;
  country_id: EntityId;
  federation_id: EntityId | null;
  currency: string;
  locale: string;
  config_json: string | null;
  iso_code: string;
  country_name: string;
  federation_name: string | null;
};

const SELECT_CONTEXT = `
  SELECT h.pack_id, h.country_id, h.federation_id, h.currency, h.locale, h.config_json,
         c.iso_code, c.name AS country_name, f.name AS federation_name
  FROM home_football_contexts h
  JOIN countries c ON c.id = h.country_id
  LEFT JOIN federations f ON f.id = h.federation_id
  WHERE h.id = 1`;

const cache = new WeakMap<GameDatabase, HomeFootballContext>();

const contextFromRow = (row: ContextRow): HomeFootballContext => {
  const pack = countryPack(row.pack_id);
  const stored = row.config_json ? (JSON.parse(row.config_json) as StoredHomeConfig) : undefined;
  return {
    packId: row.pack_id,
    countryId: row.country_id,
    countryIso: row.iso_code,
    countryName: row.country_name,
    federationId: row.federation_id ?? undefined,
    federationName: row.federation_name ?? undefined,
    currency: row.currency,
    locale: row.locale,
    federationAbbreviation: stored?.federationAbbreviation ?? pack.federationAbbreviation,
    seasonRules: stored?.seasonRules ?? pack.seasonRules,
    nationalTeams: stored?.nationalTeams ?? pack.nationalTeams,
    tierLabels: stored?.tierLabels ?? pack.tierLabels,
  };
};

/**
 * Records the home country of a save from a country pack: the pack's country (found by ISO
 * code) and that country's federation. Called once, when a save is created from a dataset.
 */
export const establishHomeFootballContext = (
  db: GameDatabase,
  pack: CountryPack,
  date: string,
  options: { federationOptional?: boolean } = {},
): HomeFootballContext => {
  const marks = pack.isoCodes.map(() => "?").join(", ");
  const order = pack.isoCodes.map((_, index) => `WHEN ? THEN ${index}`).join(" ");
  const row = db
    .prepare(
      `SELECT c.id AS country_id, f.id AS federation_id
       FROM countries c ${options.federationOptional ? "LEFT" : ""} JOIN federations f ON f.country_id = c.id
       WHERE c.iso_code IN (${marks})
       ORDER BY CASE c.iso_code ${order} ELSE ${pack.isoCodes.length} END, f.name LIMIT 1`,
    )
    .get(...pack.isoCodes, ...pack.isoCodes) as { country_id: EntityId; federation_id: EntityId | null } | undefined;
  if (!row) throw new Error(`The dataset has no country and federation for pack "${pack.packId}".`);
  const codes = new CountryCodeRepository(db);
  for (const code of pack.isoCodes) codes.addAliasIfFree({ countryId: row.country_id, code, system: "LEGACY", source: pack.packId });
  const config: StoredHomeConfig = {
    federationAbbreviation: pack.federationAbbreviation,
    seasonRules: pack.seasonRules,
    nationalTeams: pack.nationalTeams,
    tierLabels: pack.tierLabels,
  };
  db.prepare(
    `INSERT INTO home_football_contexts (id, pack_id, country_id, federation_id, currency, locale, config_json, established_on)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET pack_id = excluded.pack_id, country_id = excluded.country_id,
       federation_id = excluded.federation_id, currency = excluded.currency, locale = excluded.locale,
       config_json = excluded.config_json`,
  ).run(pack.packId, row.country_id, row.federation_id, pack.currency, pack.locale, JSON.stringify(config), date);
  cache.delete(db);
  return homeFootballContext(db);
};

/** The home context, or undefined for a database with no home country and federation yet. */
export const findHomeFootballContext = (db: GameDatabase): HomeFootballContext | undefined => {
  const cached = cache.get(db);
  if (cached) return cached;
  let row = db.prepare(SELECT_CONTEXT).get() as ContextRow | undefined;
  if (!row) {
    // A hand-built database that never had a context: infer the legacy country the way the
    // migration does, and record it so it is not inferred again.
    const legacy = countryPack(NEPAL_PACK_ID);
    const inferred = db
      .prepare(`SELECT 1 AS present FROM countries WHERE iso_code IN (${legacy.isoCodes.map(() => "?").join(", ")}) LIMIT 1`)
      .get(...legacy.isoCodes);
    if (!inferred) return undefined;
    establishHomeFootballContext(db, legacy, (db.prepare("SELECT world_date AS d FROM saves LIMIT 1").get() as { d: string } | undefined)?.d ?? "2026-08-01", { federationOptional: true });
    row = db.prepare(SELECT_CONTEXT).get() as ContextRow | undefined;
    if (!row) return undefined;
  }
  const context = contextFromRow(row);
  cache.set(db, context);
  return context;
};

export const homeFootballContext = (db: GameDatabase): HomeFootballContext => {
  const context = findHomeFootballContext(db);
  if (!context) throw new Error("The save has no home football country.");
  return context;
};

/**
 * The home country id alone, for callers that run before a federation exists (a bare
 * world, or a dataset being imported). Resolves through the same view raw SQL uses.
 */
export const homeCountryId = (db: GameDatabase): EntityId | undefined =>
  (db.prepare("SELECT country_id AS id FROM home_football_country LIMIT 1").get() as { id: EntityId } | undefined)?.id;

/** The home country id, or an error for a world with no countries at all. */
export const requireHomeCountryId = (db: GameDatabase): EntityId => {
  const id = homeCountryId(db);
  if (!id) throw new Error("The world has no home country.");
  return id;
};

export const isHomeCountry = (db: GameDatabase, countryId: EntityId | undefined): boolean =>
  countryId !== undefined && countryId === homeCountryId(db);

export const homeFederationId = (db: GameDatabase): EntityId => {
  const id = homeFootballContext(db).federationId;
  if (!id) throw new Error("The save has no home football federation.");
  return id;
};

/** The home federation, found by the id the context stores, never by name. */
export const homeFederation = (db: GameDatabase): Federation => {
  const row = db.prepare("SELECT * FROM federations WHERE id = ?").get(homeFederationId(db)) as
    | { id: EntityId; country_id: EntityId; name: string; founded_year: number | null }
    | undefined;
  if (!row) throw new Error("The home federation is missing from the save.");
  return { id: row.id, countryId: row.country_id, name: row.name, foundedYear: row.founded_year ?? undefined };
};

/** Whether a federation belongs to the home country. */
export const isHomeFederation = (db: GameDatabase, federationId: EntityId): boolean =>
  Boolean(
    db
      .prepare(`SELECT 1 AS present FROM federations WHERE id = ? AND country_id = ${HOME_COUNTRY_SQL}`)
      .get(federationId),
  );

/**
 * The country-level configuration (money, calendar, national teams, names). A world that has no
 * home country at all (a hand-built fixture; never a real save) uses the launch pack's defaults.
 */
const homeConfig = (db: GameDatabase): Pick<HomeFootballContext, "packId" | "currency" | "locale" | "federationAbbreviation" | "seasonRules" | "nationalTeams" | "tierLabels"> => {
  const context = findHomeFootballContext(db);
  if (context) return context;
  const pack = countryPack(NEPAL_PACK_ID);
  return { packId: pack.packId, currency: pack.currency, locale: pack.locale, federationAbbreviation: pack.federationAbbreviation, seasonRules: pack.seasonRules, nationalTeams: pack.nationalTeams, tierLabels: pack.tierLabels };
};

/**
 * The country pack of the save's home country. A hand-built world with no home country at all (a
 * test fixture, never a real save) uses the launch pack, as the other home settings do.
 */
export const homeCountryPack = (db: GameDatabase): CountryPack => countryPack(homeConfig(db).packId);

export const homeCurrency = (db: GameDatabase): string => homeConfig(db).currency;

export const homeLocale = (db: GameDatabase): string => homeConfig(db).locale;

export const homeFederationAbbreviation = (db: GameDatabase): string => homeConfig(db).federationAbbreviation;

export const homeSeasonRules = (db: GameDatabase): SeasonRules => homeConfig(db).seasonRules;

/** First day of the season that starts in `year`, e.g. 2026 -> "2026-08-01". */
export const seasonStartDate = (db: GameDatabase, year: number): string => `${year}-${homeSeasonRules(db).seasonStart}`;

/** Last day of the season that starts in `startYear`, e.g. 2026 -> "2027-07-31". */
export const seasonEndDate = (db: GameDatabase, startYear: number): string => {
  const rules = homeSeasonRules(db);
  return `${rules.seasonEnd < rules.seasonStart ? startYear + 1 : startYear}-${rules.seasonEnd}`;
};

/** The month ("MM") a season closes in. */
export const seasonEndMonth = (db: GameDatabase): string => homeSeasonRules(db).seasonEnd.slice(0, 2);

/** The calendar month (1-12) a season starts in. */
export const seasonStartMonthNumber = (db: GameDatabase): number => Number(homeSeasonRules(db).seasonStart.slice(0, 2));

/** The calendar month (1-12) halfway through the season, where the second half begins. */
export const midSeasonMonthNumber = (db: GameDatabase): number => ((seasonStartMonthNumber(db) + 4) % 12) + 1;

/** The date the season ends on in calendar year `year`, e.g. 2027 -> "2027-07-31". */
export const seasonEndInYear = (db: GameDatabase, year: number): string => `${year}-${homeSeasonRules(db).seasonEnd}`;

/** The months ("YYYY-MM") of the season that ends in `endYear`, in processing order. */
export const seasonPeriodMonthsFor = (db: GameDatabase, endYear: number): string[] => {
  const start = seasonStartMonthNumber(db);
  const end = Number(seasonEndMonth(db));
  const rules = homeSeasonRules(db);
  const startYear = rules.seasonEnd < rules.seasonStart ? endYear - 1 : endYear;
  const months: string[] = [];
  let year = startYear;
  let month = start;
  for (let guard = 0; guard < 12; guard += 1) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    if (month === end) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
};

/** Every ISO code the home country's data may carry (older saves used a second form). */
export const homeIsoCodes = (db: GameDatabase): readonly string[] => countryPack(homeConfig(db).packId).isoCodes;

export const isHomeIso = (db: GameDatabase, isoCode: string | undefined): boolean => isoCode !== undefined && homeIsoCodes(db).includes(isoCode);

export const homeNationalTeams = (db: GameDatabase): readonly NationalTeamDefinition[] => homeConfig(db).nationalTeams;

export const homeNamePool = (db: GameDatabase): NamePool => countryPack(homeConfig(db).packId).namePool;
