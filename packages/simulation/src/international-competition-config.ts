import type {
  DataProvenanceStatus,
  FootballConfederation,
  FootballRegion,
  InternationalCompetitionType,
  InternationalMatchImportance,
  NationalTeamType,
} from "@nepal-football-sim/shared-types";

/*
 * The international calendar as data. The engine (international-football.ts) reads these
 * definitions; it never asks which country it is running for. A competition applies to the home
 * country when the home country's own international profile is in the competition's scope (its
 * region for a regional championship, its confederation for a continental one, everyone for a
 * world event) and the competition is for a national-team type the home structure has and the
 * simulation can play. Nepal is in SAFF and AFC because its registry profile says so; a country
 * in another region gets the competitions of its own regions and none of SAFF's.
 */

/** The keys of the competitions the built-in calendar defines. The key is also the seed of the competition's stored id, so it never changes. */
export type KnownInternationalCompetitionKey =
  | "SAFF"
  | "ASIAN_CUP_QUALIFICATION"
  | "ASIAN_CUP"
  | "AFC_WORLD_CUP_QUALIFICATION"
  | "WORLD_CUP"
  | "SAFF_WOMEN"
  | "AFC_WOMENS_ASIAN_CUP_QUALIFICATION"
  | "SAFF_U23"
  | "SAFF_U20"
  | "SAFF_U17";

/** A competition key. The built-in keys autocomplete; a calendar may define others, which the engine looks up in its configuration and rejects if it has none. */
export type InternationalCompetitionKey = KnownInternationalCompetitionKey | (string & {});

export type CompetitionEntryScope = "REGION" | "CONFEDERATION" | "WORLD";

export type CompetitionHostPolicy =
  | { kind: "HOME_COUNTRY" }
  /** A fixed host, named by ISO alpha-2 and resolved through country identity; no host when the save has no such country. */
  | { kind: "COUNTRY"; isoAlpha2: string }
  | { kind: "NONE" };

export type CompetitionSchedule = {
  /** The competition runs in seasons whose end year has this remainder modulo `everyYears`. */
  everyYears: number;
  remainder: number;
  /** Start date within the season-end year, MM-DD. */
  startMonthDay: string;
  /** The edition's cycle label is the season-end year plus this. */
  cycleOffsetYears: number;
};

export type InternationalCompetitionConfig = {
  key: InternationalCompetitionKey;
  name: string;
  competitionType: InternationalCompetitionType;
  confederation?: FootballConfederation;
  /** Stored on the competition; "GLOBAL" for a competition that is not regional. */
  region: FootballRegion;
  cadenceYears: number;
  provenanceStatus: DataProvenanceStatus;
  /** The national-team category that plays it. */
  teamType: NationalTeamType;
  /** Who may enter: teams from `region`, from `confederation`, or any team. */
  entry: CompetitionEntryScope;
  participantLimit: number;
  host: CompetitionHostPolicy;
  durationDays: number;
  groupCount: number;
  teamsToAdvance: number;
  groupLegs: 1 | 2;
  knockoutName: string;
  importance: InternationalMatchImportance;
  /** Whether a federation may win a hosting bid for it. */
  hostable: boolean;
  /** Absent for a competition that is only created on request. */
  schedule?: CompetitionSchedule;
};

const regional = (
  key: string,
  name: string,
  teamType: NationalTeamType,
  provenanceStatus: DataProvenanceStatus,
  schedule: CompetitionSchedule,
): InternationalCompetitionConfig => ({
  key,
  name,
  competitionType: "REGIONAL_CHAMPIONSHIP",
  confederation: "AFC",
  region: "SAFF",
  cadenceYears: 2,
  provenanceStatus,
  teamType,
  entry: "REGION",
  participantLimit: 7,
  host: { kind: "HOME_COUNTRY" },
  durationDays: 18,
  groupCount: 2,
  teamsToAdvance: 2,
  groupLegs: 1,
  knockoutName: "Semi-Final and Final",
  importance: "REGIONAL",
  hostable: true,
  schedule,
});

const qualifier = (
  key: string,
  name: string,
  competitionType: InternationalCompetitionType,
  teamType: NationalTeamType,
  importance: InternationalMatchImportance,
  schedule: CompetitionSchedule,
): InternationalCompetitionConfig => ({
  key,
  name,
  competitionType,
  confederation: "AFC",
  region: "GLOBAL",
  cadenceYears: 4,
  provenanceStatus: "SIMULATION_ONLY",
  teamType,
  entry: "CONFEDERATION",
  participantLimit: 12,
  host: { kind: "NONE" },
  durationDays: 90,
  groupCount: 3,
  teamsToAdvance: 1,
  groupLegs: 2,
  knockoutName: "Knockout Stage",
  importance,
  hostable: true,
  schedule,
});

const evenYears = (startMonthDay: string): CompetitionSchedule => ({ everyYears: 2, remainder: 0, startMonthDay, cycleOffsetYears: 0 });
const oddYears = (startMonthDay: string): CompetitionSchedule => ({ everyYears: 2, remainder: 1, startMonthDay, cycleOffsetYears: 0 });

/** The built-in calendar, in the order editions are created within a season. */
export const INTERNATIONAL_COMPETITION_CONFIGS: readonly InternationalCompetitionConfig[] = [
  regional("SAFF", "SAFF Championship", "SENIOR_MEN", "VERIFIED", evenYears("09-01")),
  regional("SAFF_WOMEN", "SAFF Women's Championship", "SENIOR_WOMEN", "SIMULATION_ONLY", evenYears("10-04")),
  regional("SAFF_U23", "SAFF U23 Championship", "U23", "SIMULATION_ONLY", evenYears("07-07")),
  regional("SAFF_U20", "SAFF U20 Championship", "U20", "SIMULATION_ONLY", oddYears("07-07")),
  regional("SAFF_U17", "SAFF U17 Championship", "U17", "SIMULATION_ONLY", oddYears("10-04")),
  qualifier("ASIAN_CUP_QUALIFICATION", "AFC Asian Cup Qualification", "QUALIFIER", "SENIOR_MEN", "QUALIFIER", { everyYears: 4, remainder: 3, startMonthDay: "03-20", cycleOffsetYears: 1 }),
  qualifier("AFC_WOMENS_ASIAN_CUP_QUALIFICATION", "AFC Women's Asian Cup Qualification", "QUALIFIER", "SENIOR_WOMEN", "QUALIFIER", { everyYears: 4, remainder: 3, startMonthDay: "05-20", cycleOffsetYears: 1 }),
  {
    key: "ASIAN_CUP",
    name: "AFC Asian Cup",
    competitionType: "CONTINENTAL_CHAMPIONSHIP",
    confederation: "AFC",
    region: "GLOBAL",
    cadenceYears: 4,
    provenanceStatus: "VERIFIED",
    teamType: "SENIOR_MEN",
    entry: "CONFEDERATION",
    participantLimit: 16,
    host: { kind: "COUNTRY", isoAlpha2: "QA" },
    durationDays: 90,
    groupCount: 4,
    teamsToAdvance: 2,
    groupLegs: 1,
    knockoutName: "Knockout Stage",
    importance: "CONTINENTAL",
    hostable: true,
    schedule: { everyYears: 4, remainder: 0, startMonthDay: "06-10", cycleOffsetYears: 0 },
  },
  // The stored name contains "World", which the match-importance rules have always read as a world event.
  qualifier("AFC_WORLD_CUP_QUALIFICATION", "AFC World Cup Qualification", "WORLD_QUALIFIER", "SENIOR_MEN", "WORLD", { everyYears: 4, remainder: 1, startMonthDay: "10-08", cycleOffsetYears: 1 }),
  {
    key: "WORLD_CUP",
    name: "World Championship",
    competitionType: "WORLD_CHAMPIONSHIP",
    region: "GLOBAL",
    cadenceYears: 4,
    provenanceStatus: "SIMULATION_ONLY",
    teamType: "SENIOR_MEN",
    entry: "WORLD",
    participantLimit: 16,
    host: { kind: "COUNTRY", isoAlpha2: "US" },
    durationDays: 90,
    groupCount: 3,
    teamsToAdvance: 2,
    groupLegs: 1,
    knockoutName: "Knockout Stage",
    importance: "WORLD",
    hostable: false,
  },
];

export const internationalCompetitionConfig = (key: InternationalCompetitionKey): InternationalCompetitionConfig => {
  const config = INTERNATIONAL_COMPETITION_CONFIGS.find((item) => item.key === key);
  if (!config) throw new Error(`No international competition is configured for "${key}".`);
  return config;
};

export const isHostableCompetitionKey = (key: string): boolean =>
  INTERNATIONAL_COMPETITION_CONFIGS.some((item) => item.key === key && item.hostable);

/** The configured season-end years' editions: which competitions start in the season ending in `endYear`, in creation order. */
export const scheduledCompetitions = (endYear: number): Array<{ config: InternationalCompetitionConfig; cycle: string; startDate: string }> =>
  INTERNATIONAL_COMPETITION_CONFIGS.flatMap((config) =>
    config.schedule && endYear % config.schedule.everyYears === config.schedule.remainder
      ? [{ config, cycle: String(endYear + config.schedule.cycleOffsetYears), startDate: `${endYear}-${config.schedule.startMonthDay}` }]
      : [],
  );
