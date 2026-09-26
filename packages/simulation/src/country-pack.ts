import type {
  FootballConfederation,
  FootballRegion,
  FounderLocationOption,
  NationalTeamType,
} from "@nepal-football-sim/shared-types";
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
  /** Founder-location choices exposed by the country pack, when the pack supports that career flow. */
  founderLocations?: readonly FounderLocationOption[] | (() => readonly FounderLocationOption[]);
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
