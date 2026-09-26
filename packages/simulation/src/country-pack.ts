import type { ProcurementSupplier, ClubLender, FootballConfederation, FootballRegion, MediaJournalist, MediaOutlet, NationalTeamType } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "@nepal-football-sim/database";

/*
 * A country pack is the configuration that goes with a country's dataset: who the
 * country is, how its season runs, how its national teams are structured and how
 * people are named. The world data itself (clubs, competitions, players, locations)
 * lives in the dataset. A save is played in exactly one home country; the pack it was
 * created from is recorded in the save's home football context. See
 * docs/architecture/country-dataset-contract.md.
 */

/** Month-day (MM-DD) rules of the domestic football year. Only rules the engine actually uses. */
export type SeasonRules = {
  /** First day of the season, e.g. "08-01". */
  seasonStart: string;
  /** Last day of the season, e.g. "07-31". Also the day a season is closed and processed. */
  seasonEnd: string;
  /** The day the annual youth intake is held. */
  youthIntake: string;
};

export type NationalTeamDefinition = {
  /** Existing canonical vocabulary for a national team's category. */
  teamType: NationalTeamType;
  /** `teams.level` of the national team row. */
  level: string;
  gender: "men" | "women";
  /** Appended to the country name: "Nepal Senior Men". */
  label: string;
  /** Scales a country's senior strength/reputation/development for this team. */
  strengthMultiplier: number;
};

export type NamePool = {
  id: string;
  /** Names for an emergency-repair player, when a squad is short; absent, the ordinary male player names are used. */
  emergencyPlayers?: { first: readonly string[]; surnames: readonly string[] };
  /** ISO 639 codes stamped on generated managers and staff. */
  languageCodes: readonly string[];
  /** Language names stamped on generated players and officials. */
  languageNames: readonly string[];
  managerFullNames: readonly string[];
  staffFullNames: readonly string[];
  officials: {
    maleFirst: readonly string[];
    femaleFirst: readonly string[];
    surnames: readonly string[];
  };
  players: {
    maleFirst: readonly string[];
    femaleFirst: readonly string[];
    maleMiddle: readonly string[];
    femaleMiddle: readonly string[];
    surnames: readonly string[];
  };
};

/** A named administrative place in a pack's geography, with the places directly beneath it. Any depth; any kinds the location table uses. */
export type PackAdministrativeArea = {
  name: string;
  /** A `locations.kind`: "province", "district", "city", ... */
  kind: string;
  /** A place the territorial model treats as remote. */
  remote?: boolean;
  children?: readonly PackAdministrativeArea[];
};

/**
 * Administrative geography a country's own data may not fully carry. The `locations` table is the
 * source of truth; a pack lists the places a new save must have (they are added when missing)
 * and the places its territorial football is built from.
 */
export type PackGeography = {
  /** Namespace of the stable ids the pack's places and territorial units are given ("nepal" gives "nepal-province"). */
  idNamespace: string;
  /** Prefix of the places' canonical external ids ("NP" gives "NP-DIST-KASKI"). */
  codePrefix: string;
  areas: readonly PackAdministrativeArea[];
  /** Places a club with no recorded location can plausibly be shown in. */
  clubLocalityHubs?: readonly string[];
};

/** A sponsor identity a save starts with. Its country is always the home country; its reputation and budget tier are drawn by the economy. */
export type PackSponsor = {
  name: string;
  industry: string;
  sourceUrl?: string;
  identityProvenance: "VERIFIED" | "SIMULATION_ONLY";
};

/**
 * The country's commercial identities. Only who they are: the economy decides rates, limits,
 * contract values and which sponsor a club gets. An absent list means the country has none.
 */
export type PackCommercial = {
  /** Banks and other lenders clubs may borrow from. */
  lenders?: readonly Omit<ClubLender, "id" | "countryId">[];
  /** The sponsor pool clubs draw on. */
  sponsors?: readonly PackSponsor[];
  /** Sponsors of the national federation. */
  federationSponsors?: ReadonlyArray<{ name: string; industry: string }>;
  /** Suppliers clubs buy equipment and services from (Clubmart). */
  suppliers?: readonly Omit<ProcurementSupplier, "id">[];
};

/** The country's football media: outlets and the journalists who write for them (dealt to outlets in order). */
export type PackMedia = {
  outlets?: readonly Omit<MediaOutlet, "id">[];
  journalists?: readonly Omit<MediaJournalist, "id" | "outletId">[];
};

/**
 * How large football money is in the country, relative to the launch calibration (1 = Nepal's
 * magnitudes). Scale only; the pack's `currency` is a separate label and no exchange rate is implied.
 */
export type PackEconomy = {
  priceLevel: number;
  /** Player and staff wages; defaults to `priceLevel`. */
  wageLevel?: number;
  /** Match ticket prices; defaults to `priceLevel`. */
  ticketPriceLevel?: number;
};

export type CountryPack = {
  /** Stable identifier of the country dataset + configuration, e.g. "nepal-v1". Never a display name. */
  packId: string;
  countryName: string;
  /** Prefix of the national teams' canonical ids ("NEP" gives "NEP-NT-SENIOR-MEN"); defaults to the first ISO code. */
  nationalTeamCodePrefix?: string;
  /** The country's standing in the international registry, for a home country the registry does not list. */
  internationalProfile?: {
    confederation: FootballConfederation;
    region: FootballRegion;
    strength: number;
    reputation: number;
    development: number;
    homeAdvantage: number;
    populationTalentBase: number;
  };
  /** ISO codes the dataset may use for the country, canonical first (older saves used a second form). */
  isoCodes: readonly string[];
  currency: string;
  /** BCP 47 locale used to format money and dates. */
  locale: string;
  /** Short form of the national federation's name, used as a licence issuer and in headlines. */
  federationAbbreviation: string;
  seasonRules: SeasonRules;
  nationalTeams: readonly NationalTeamDefinition[];
  /** Display labels for pyramid tiers, top tier first. */
  tierLabels: readonly string[];
  namePool: NamePool;
  /** Optional: administrative places to guarantee and build territorial football from. Absent, the save's own locations are used. */
  geography?: PackGeography;
  /**
   * Whether the repository's canonical global dataset is applied when a save is created. That
   * dataset is authored around one playable country (Nepal), so only that country's pack opts in;
   * for any other pack it would add the launch country's league, federation and people to the world.
   */
  canonicalGlobalSeed?: boolean;
  /** Optional: money scale. Absent means neutral (1), never Nepal's. */
  economy?: PackEconomy;
  /** Optional: banks, sponsors. Absent, the country has none; nothing is inherited from another country. */
  commercial?: PackCommercial;
  /** Optional: media outlets and journalists. Absent, the country has none. */
  media?: PackMedia;
  /** Country-specific structures that must exist once the dataset is imported (geography, founder locations). */
  initialiseTerritory?: (db: GameDatabase, date: string) => void;
  /** Idempotent check that the territorial structure exists, for saves that predate it. */
  ensureTerritorialStructure?: (db: GameDatabase, date: string) => void;
};

/** The parts of a pack a save keeps for itself, so it stays playable if the pack later changes. */
export type StoredHomeConfig = {
  federationAbbreviation: string;
  seasonRules: SeasonRules;
  nationalTeams: readonly NationalTeamDefinition[];
  tierLabels: readonly string[];
};

const packs = new Map<string, CountryPack>();

export const registerCountryPack = (pack: CountryPack): CountryPack => {
  packs.set(pack.packId, pack);
  return pack;
};

export const countryPack = (packId: string): CountryPack => {
  const pack = packs.get(packId);
  if (!pack) throw new Error(`No country pack is registered for "${packId}".`);
  return pack;
};

export const registeredCountryPackIds = (): string[] => [...packs.keys()];
