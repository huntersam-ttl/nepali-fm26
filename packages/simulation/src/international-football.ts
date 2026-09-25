import {
  createStableEntityId,
  type EntityId,
  type Federation,
  type FootballConfederation,
  type FootballRegion,
  type InternationalCompetition,
  type InternationalCompetitionEdition,
  type InternationalCompetitionStage,
  type InternationalDrawRecord,
  type InternationalMatch,
  type InternationalMatchImportance,
  type InternationalTeamProfile,
  type InternationalTiebreaker,
  type NationalTeamAppearance,
  type NationalTeamCamp,
  type NationalTeamCohesion,
  type NationalTeamDuty,
  type NationalTeamFixture,
  type NationalTeamType,
  type PlayerAttributeSet,
  type PlayerPosition,
  type SimulationWorldRanking,
} from "@nepal-football-sim/shared-types";
import {
  EventRepository,
  FederationGovernanceRepository,
  InternationalFootballRepository,
  NationalTeamManagementRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  closeFederationFinancialSeason,
  initializeFederationGovernanceForSave,
  nationalTeamParticipationAllowed,
  postFederationTransaction,
  selectNationalTeamSquad,
} from "./federation-governance.js";
import { buildAiTacticalSetup, resolveTeamTacticalSetup } from "./ai-tactics.js";
import { simulateMatch } from "./match-engine.js";
import { ensureNationalTeamStaffStructure, recordNationalTeamEditionEntry } from "./national-team-management.js";
import { SeededRandom } from "./rng.js";
import { findHomeFootballContext, homeCountryId, homeCurrency, homeFederation, homeNationalTeams, seasonEndInYear } from "./home-context.js";
import { countryPack } from "./country-pack.js";

const simulationStatus = "SIMULATION_ONLY" as const;
const factualIdentityStatus = "VERIFIED" as const;

type RegistryTeam = {
  isoCode: string;
  countryName: string;
  confederation: FootballConfederation;
  region: FootballRegion;
  strength: number;
  reputation: number;
  development: number;
  homeAdvantage: number;
  populationTalentBase: number;
};

export type InternationalCompetitionKey =
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

const teamTypeForCompetitionKey = (key: InternationalCompetitionKey): NationalTeamType => {
  if (key === "SAFF_WOMEN" || key === "AFC_WOMENS_ASIAN_CUP_QUALIFICATION") {
    return "SENIOR_WOMEN";
  }
  if (key === "SAFF_U23") return "U23";
  if (key === "SAFF_U20") return "U20";
  if (key === "SAFF_U17") return "U17";
  return "SENIOR_MEN";
};

const isRegionalCompetition = (key: InternationalCompetitionKey): boolean =>
  key === "SAFF" || key.startsWith("SAFF_");


export type FastExternalMatchResult = {
  homeGoals: number;
  awayGoals: number;
  winnerTeamProfileId?: EntityId;
  extraTimePlayed: boolean;
  penaltiesPlayed: boolean;
  homePenaltyGoals?: number;
  awayPenaltyGoals?: number;
};

export type InternationalHistory = {
  matches: InternationalMatch[];
  rankings: SimulationWorldRanking[];
  capsLeaders: Array<{ playerId: EntityId; caps: number; goals: number }>;
  topScorers: Array<{ playerId: EntityId; caps: number; goals: number }>;
  records: {
    biggestWin?: InternationalMatch;
    biggestDefeat?: InternationalMatch;
    longestUnbeatenRun: number;
    rankingPeak?: SimulationWorldRanking;
  };
};

export type InternationalDiagnosticReport = {
  date: string;
  years: number;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  saffEditions: number;
  saffTitles: number;
  asianCupQualifications: number;
  worldCupQualifications: number;
  rankingStart: number;
  rankingEnd: number;
  rankingPeak: number;
  topScorers: InternationalHistory["topScorers"];
  capsLeaders: InternationalHistory["capsLeaders"];
  majorUpsets: number;
  federationIncome: number;
  federationCosts: number;
  externalOpponentsUsed: string[];
  editions: Array<{ name: string; status: string; nepalPlacement?: number }>;
};

const registry: RegistryTeam[] = [
  {
    isoCode: "NP",
    countryName: "Nepal",
    confederation: "AFC",
    region: "SAFF",
    strength: 28,
    reputation: 25,
    development: 24,
    homeAdvantage: 1.06,
    populationTalentBase: 28,
  },
  {
    isoCode: "IN",
    countryName: "India",
    confederation: "AFC",
    region: "SAFF",
    strength: 48,
    reputation: 49,
    development: 48,
    homeAdvantage: 1.08,
    populationTalentBase: 66,
  },
  {
    isoCode: "BD",
    countryName: "Bangladesh",
    confederation: "AFC",
    region: "SAFF",
    strength: 32,
    reputation: 31,
    development: 30,
    homeAdvantage: 1.06,
    populationTalentBase: 52,
  },
  {
    isoCode: "BT",
    countryName: "Bhutan",
    confederation: "AFC",
    region: "SAFF",
    strength: 22,
    reputation: 20,
    development: 20,
    homeAdvantage: 1.07,
    populationTalentBase: 18,
  },
  {
    isoCode: "MV",
    countryName: "Maldives",
    confederation: "AFC",
    region: "SAFF",
    strength: 36,
    reputation: 35,
    development: 32,
    homeAdvantage: 1.07,
    populationTalentBase: 20,
  },
  {
    isoCode: "PK",
    countryName: "Pakistan",
    confederation: "AFC",
    region: "SAFF",
    strength: 29,
    reputation: 28,
    development: 27,
    homeAdvantage: 1.06,
    populationTalentBase: 55,
  },
  {
    isoCode: "LK",
    countryName: "Sri Lanka",
    confederation: "AFC",
    region: "SAFF",
    strength: 27,
    reputation: 26,
    development: 25,
    homeAdvantage: 1.06,
    populationTalentBase: 30,
  },
  {
    isoCode: "AF",
    countryName: "Afghanistan",
    confederation: "AFC",
    region: "CAFA",
    strength: 37,
    reputation: 36,
    development: 33,
    homeAdvantage: 1.04,
    populationTalentBase: 36,
  },
  {
    isoCode: "IR",
    countryName: "Iran",
    confederation: "AFC",
    region: "CAFA",
    strength: 80,
    reputation: 82,
    development: 78,
    homeAdvantage: 1.1,
    populationTalentBase: 72,
  },
  {
    isoCode: "JP",
    countryName: "Japan",
    confederation: "AFC",
    region: "EAFF",
    strength: 86,
    reputation: 88,
    development: 88,
    homeAdvantage: 1.08,
    populationTalentBase: 78,
  },
  {
    isoCode: "KR",
    countryName: "South Korea",
    confederation: "AFC",
    region: "EAFF",
    strength: 84,
    reputation: 86,
    development: 84,
    homeAdvantage: 1.08,
    populationTalentBase: 72,
  },
  {
    isoCode: "CN",
    countryName: "China PR",
    confederation: "AFC",
    region: "EAFF",
    strength: 62,
    reputation: 64,
    development: 61,
    homeAdvantage: 1.08,
    populationTalentBase: 78,
  },
  {
    isoCode: "AU",
    countryName: "Australia",
    confederation: "AFC",
    region: "ASEAN_AFF",
    strength: 78,
    reputation: 80,
    development: 80,
    homeAdvantage: 1.07,
    populationTalentBase: 58,
  },
  {
    isoCode: "QA",
    countryName: "Qatar",
    confederation: "AFC",
    region: "WAFF",
    strength: 71,
    reputation: 73,
    development: 75,
    homeAdvantage: 1.08,
    populationTalentBase: 35,
  },
  {
    isoCode: "SA",
    countryName: "Saudi Arabia",
    confederation: "AFC",
    region: "WAFF",
    strength: 76,
    reputation: 78,
    development: 76,
    homeAdvantage: 1.09,
    populationTalentBase: 60,
  },
  {
    isoCode: "AE",
    countryName: "United Arab Emirates",
    confederation: "AFC",
    region: "WAFF",
    strength: 68,
    reputation: 70,
    development: 72,
    homeAdvantage: 1.08,
    populationTalentBase: 42,
  },
  {
    isoCode: "UZ",
    countryName: "Uzbekistan",
    confederation: "AFC",
    region: "CAFA",
    strength: 74,
    reputation: 73,
    development: 70,
    homeAdvantage: 1.08,
    populationTalentBase: 58,
  },
  {
    isoCode: "TH",
    countryName: "Thailand",
    confederation: "AFC",
    region: "ASEAN_AFF",
    strength: 60,
    reputation: 59,
    development: 58,
    homeAdvantage: 1.08,
    populationTalentBase: 55,
  },
  {
    isoCode: "VN",
    countryName: "Vietnam",
    confederation: "AFC",
    region: "ASEAN_AFF",
    strength: 64,
    reputation: 63,
    development: 61,
    homeAdvantage: 1.08,
    populationTalentBase: 62,
  },
  {
    isoCode: "ID",
    countryName: "Indonesia",
    confederation: "AFC",
    region: "ASEAN_AFF",
    strength: 57,
    reputation: 58,
    development: 56,
    homeAdvantage: 1.09,
    populationTalentBase: 70,
  },
  {
    isoCode: "MY",
    countryName: "Malaysia",
    confederation: "AFC",
    region: "ASEAN_AFF",
    strength: 53,
    reputation: 53,
    development: 54,
    homeAdvantage: 1.07,
    populationTalentBase: 50,
  },
  {
    isoCode: "PH",
    countryName: "Philippines",
    confederation: "AFC",
    region: "ASEAN_AFF",
    strength: 45,
    reputation: 45,
    development: 45,
    homeAdvantage: 1.05,
    populationTalentBase: 52,
  },
  {
    isoCode: "DE",
    countryName: "Germany",
    confederation: "UEFA",
    region: "EUROPE",
    strength: 89,
    reputation: 91,
    development: 90,
    homeAdvantage: 1.07,
    populationTalentBase: 76,
  },
  {
    isoCode: "BR",
    countryName: "Brazil",
    confederation: "CONMEBOL",
    region: "AMERICAS",
    strength: 90,
    reputation: 93,
    development: 88,
    homeAdvantage: 1.08,
    populationTalentBase: 86,
  },
  {
    isoCode: "US",
    countryName: "United States",
    confederation: "CONCACAF",
    region: "AMERICAS",
    strength: 78,
    reputation: 79,
    development: 80,
    homeAdvantage: 1.06,
    populationTalentBase: 80,
  },
  {
    isoCode: "NZ",
    countryName: "New Zealand",
    confederation: "OFC",
    region: "OCEANIA",
    strength: 65,
    reputation: 66,
    development: 68,
    homeAdvantage: 1.05,
    populationTalentBase: 34,
  },
  {
    isoCode: "EG",
    countryName: "Egypt",
    confederation: "CAF",
    region: "AFRICA",
    strength: 77,
    reputation: 79,
    development: 75,
    homeAdvantage: 1.08,
    populationTalentBase: 74,
  },
];

export const initializeInternationalFootballForSave = (input: {
  db: GameDatabase;
  worldDate: string;
  seed: string;
}): void => {
  initializeFederationGovernanceForSave(input);
  const repo = new InternationalFootballRepository(input.db);
  ensureExternalCountries(input.db);
  for (const item of registry) {
    const countryId = countryIdByIso(input.db, item.isoCode);
    for (const definition of homeNationalTeams(input.db)) {
      const teamType = definition.teamType;
      const multiplier = definition.strengthMultiplier;
      const profile: InternationalTeamProfile = {
        id: createStableEntityId("international-team-profile", `${item.isoCode}:${teamType}`),
        countryId,
        nationalTeamId:
          countryId === homeCountryId(input.db) ? nationalTeamIdForType(input.db, teamType) : undefined,
        name: `${item.countryName} ${definition.label}`,
        teamType,
        confederation: item.confederation,
        region: item.region,
        simulationReputation: Math.round(item.reputation * multiplier),
        simulationStrength: Math.round(item.strength * multiplier),
        homeAdvantageProfile: item.homeAdvantage,
        developmentLevel: Math.round(item.development * multiplier),
        formRating: 50,
        lastUpdated: input.worldDate,
        provenanceStatus: countryId === homeCountryId(input.db) ? factualIdentityStatus : simulationStatus,
      };
      repo.upsertTeamProfile(profile);
      if (profile.nationalTeamId) {
        ensureNationalTeamStaffStructure(input.db, {
          federationId: homeFederation(input.db).id,
          nationalTeamId: profile.nationalTeamId,
          date: input.worldDate,
        });
      }
    }
    repo.upsertDevelopmentProfile({
      id: createStableEntityId("international-development-profile", `${item.isoCode}:2026`),
      countryId,
      effectiveFrom: input.worldDate,
      footballDevelopment: item.development,
      youthPipeline: item.development * 0.92,
      coachQuality: item.development * 0.94,
      infrastructure: item.development * 0.9,
      domesticProfessionalism: item.development,
      populationTalentBase: item.populationTalentBase,
      provenanceStatus: simulationStatus,
    });
  }
  seedCompetitionShells(repo);
  calculateSimulationWorldRanking(input.db, input.worldDate);
};

export const createInternationalCompetitionEdition = (
  db: GameDatabase,
  input: {
    competitionKey: InternationalCompetitionKey;
    cycle: string;
    startDate: string;
    seed: string;
  },
): InternationalCompetitionEdition => {
  initializeInternationalFootballForSave({ db, worldDate: input.startDate, seed: input.seed });
  const repo = new InternationalFootballRepository(db);
  const competition = competitionByKey(repo, input.competitionKey);
  const endDate = addDays(input.startDate, isRegionalCompetition(input.competitionKey) ? 18 : 90);
  const edition: InternationalCompetitionEdition = {
    id: createStableEntityId("international-edition", `${competition.id}:${input.cycle}`),
    competitionId: competition.id,
    name: `${competition.name} ${input.cycle}`,
    cycle: input.cycle,
    startDate: input.startDate,
    endDate,
    status: "PLANNED",
    hostCountryIds: hostCountries(input.competitionKey),
    qualificationLinks: [],
    ruleProvenanceStatus: simulationStatus,
    ruleNotes:
      "Simplified edition-specific simulation rule set. Future researched formats can replace this data without code changes.",
  };
  repo.upsertEdition(edition);
  const stages = stageRules(edition, input.competitionKey);
  stages.forEach((stage) => repo.upsertStage(stage));
  seedParticipants(db, edition, input.competitionKey);
  return edition;
};

export const seedInternationalDraw = (
  db: GameDatabase,
  editionId: EntityId,
  stageId: EntityId,
  drawDate: string,
  seed: string,
): InternationalDrawRecord => {
  const repo = new InternationalFootballRepository(db);
  const stage = required(
    repo.stages().find((item) => item.id === stageId),
    `stage ${stageId}`,
  );
  const participants = repo
    .participants(editionId)
    .filter(
      (item) =>
        item.entryStatus === "ACTIVE" ||
        item.entryStatus === "HOST" ||
        item.entryStatus === "QUALIFIED",
    )
    .sort((a, b) => b.seedRating - a.seedRating);
  const potCount = Math.max(1, stage.groupSize);
  const pots = Array.from({ length: potCount }, (_, index) => ({
    pot: index + 1,
    teamProfileIds: participants
      .filter((_, participantIndex) => participantIndex % potCount === index)
      .map((item) => item.teamProfileId),
  }));
  const rng = new SeededRandom(`${seed}:draw:${editionId}:${stageId}`);
  const groups = Array.from({ length: Math.max(1, stage.groupCount) }, (_, index) => ({
    name: String.fromCharCode(65 + index),
    teamProfileIds: [] as EntityId[],
  }));
  for (const pot of pots) {
    const shuffled = shuffle([...pot.teamProfileIds], rng);
    for (const teamId of shuffled) {
      const orderedGroups = shuffle([...groups], rng).sort(
        (a, b) => a.teamProfileIds.length - b.teamProfileIds.length,
      );
      const group =
        orderedGroups.find((candidate) => candidate.teamProfileIds.length < stage.groupSize) ??
        orderedGroups[0]!;
      group.teamProfileIds.push(teamId);
      const participant = participants.find((item) => item.teamProfileId === teamId);
      if (participant) {
        repo.upsertParticipant({
          ...participant,
          pot: pot.pot,
          groupName: group.name,
        });
      }
    }
  }
  const draw: InternationalDrawRecord = {
    id: createStableEntityId("international-draw", `${editionId}:${stageId}`),
    editionId,
    stageId,
    drawDate,
    seedKey: seed,
    pots,
    groups,
    restrictions: { hostProtection: true, regionalRestrictions: "best-effort" },
    provenanceStatus: simulationStatus,
  };
  repo.upsertDraw(draw);
  markEdition(db, editionId, "DRAWN");
  return draw;
};

export const scheduleInternationalFixtures = (
  db: GameDatabase,
  editionId: EntityId,
  stageId: EntityId,
  seed: string,
): InternationalMatch[] => {
  const repo = new InternationalFootballRepository(db);
  const edition = required(
    repo.editions().find((item) => item.id === editionId),
    `edition ${editionId}`,
  );
  const draw = repo.draws(editionId).find((item) => item.stageId === stageId);
  const groups = draw?.groups ?? [
    { name: "A", teamProfileIds: repo.participants(editionId).map((item) => item.teamProfileId) },
  ];
  const matches: InternationalMatch[] = [];
  let offset = 0;
  for (const group of groups) {
    for (let i = 0; i < group.teamProfileIds.length; i += 1) {
      for (let j = i + 1; j < group.teamProfileIds.length; j += 1) {
        const homeFirst = new SeededRandom(`${seed}:${group.name}:${i}:${j}`).next() >= 0.5;
        const home = homeFirst ? group.teamProfileIds[i]! : group.teamProfileIds[j]!;
        const away = homeFirst ? group.teamProfileIds[j]! : group.teamProfileIds[i]!;
        const match: InternationalMatch = {
          id: createStableEntityId(
            "international-match",
            `${stageId}:${group.name}:${home}:${away}`,
          ),
          editionId,
          stageId,
          groupName: group.name,
          matchDate: addDays(edition.startDate, offset),
          homeTeamProfileId: home,
          awayTeamProfileId: away,
          neutralVenue: edition.hostCountryIds.length > 0,
          status: "SCHEDULED",
          extraTimePlayed: false,
          penaltiesPlayed: false,
          importance: importanceForEdition(edition),
          provenanceStatus: simulationStatus,
        };
        repo.upsertMatch(match);
        matches.push(match);
        offset += 3;
      }
    }
  }
  markEdition(db, editionId, "SCHEDULED");
  return matches;
};

export const simulateInternationalMatch = (
  db: GameDatabase,
  matchId: EntityId,
  seed: string,
): InternationalMatch => {
  const repo = new InternationalFootballRepository(db);
  const match = required(
    repo.matches().find((item) => item.id === matchId),
    `match ${matchId}`,
  );
  if (match.status === "PLAYED") return match;
  const home = required(repo.teamProfile(match.homeTeamProfileId), "home profile");
  const away = required(repo.teamProfile(match.awayTeamProfileId), "away profile");
  const nepalNationalTeamId = home.nationalTeamId ?? away.nationalTeamId;
  const result =
    nepalNationalTeamId
      ? simulateNepalInternationalMatch(db, match, home, away, seed)
      : fastExternalMatch(home, away, {
          seed,
          date: match.matchDate,
          importance: match.importance,
          // Only a knockout tie is settled by extra time and penalties; a group match can end level.
          knockout: Boolean(match.stageId) && !match.groupName,
        });
  const played: InternationalMatch = {
    ...match,
    status: "PLAYED",
    ...result,
  };
  repo.upsertMatch(played);
  updateTeamProfilesAfterMatch(db, played);
  if (nepalNationalTeamId && match.editionId) syncNationalTeamCampaign(db, match.editionId, nepalNationalTeamId);
  return played;
};

export const advanceInternationalCompetition = (
  db: GameDatabase,
  editionId: EntityId,
  seed: string,
): {
  edition: InternationalCompetitionEdition;
  matches: InternationalMatch[];
  champion?: InternationalTeamProfile;
} => {
  const repo = new InternationalFootballRepository(db);
  const edition = required(
    repo.editions().find((item) => item.id === editionId),
    `edition ${editionId}`,
  );
  const stages = repo.stages(editionId);
  if (stages.length === 0) throw new Error(`Edition ${editionId} has no stages`);
  const firstStage = stages[0]!;
  ensureNepalDutyForEdition(db, edition, seed);
  if (repo.draws(editionId).every((draw) => draw.stageId !== firstStage.id)) {
    seedInternationalDraw(db, editionId, firstStage.id, addDays(edition.startDate, -14), seed);
  }
  if (repo.matches(editionId).length === 0) {
    scheduleInternationalFixtures(db, editionId, firstStage.id, seed);
  }
  markEdition(db, editionId, "IN_PROGRESS");
  for (const match of repo.matches(editionId).filter((item) => item.status === "SCHEDULED")) {
    simulateInternationalMatch(db, match.id, `${seed}:match:${match.id}`);
  }
  const standings = groupStandings(repo, editionId, firstStage.id);
  let qualified: Array<{ teamProfileId: EntityId; points: number; goalDifference: number; goalsFor: number }> = standings.flatMap((group) =>
    group.rows.slice(0, Math.max(1, firstStage.teamsToAdvance)),
  );
  markEliminatedExcept(repo, editionId, qualified.map((team) => team.teamProfileId));
  syncNepalCampaign(db, editionId);
  for (const stage of stages.slice(1)) {
    const stageMatches = createKnockoutMatches(repo, edition, stage, qualified);
    for (const match of stageMatches) {
      simulateInternationalMatch(db, match.id, `${seed}:knockout:${match.id}`);
    }
    qualified = stageMatches
      .map(
        (match) =>
          required(
            repo.matches().find((item) => item.id === match.id),
            "played knockout",
          ).winnerTeamProfileId,
      )
      .filter((id): id is EntityId => Boolean(id))
      .map((teamProfileId) => ({ teamProfileId, points: 0, goalDifference: 0, goalsFor: 0 }));
    markEliminatedExcept(repo, editionId, qualified.map((team) => team.teamProfileId));
    syncNepalCampaign(db, editionId);
  }
  const played = repo.matches(editionId);
  const championId =
    played
      .filter((match) => match.winnerTeamProfileId)
      .sort((a, b) => b.matchDate.localeCompare(a.matchDate))[0]?.winnerTeamProfileId ??
    qualified[0]?.teamProfileId;
  // Only the champion has a placement the record can support: the format has no
  // final and no cross-group ranking, so nobody else gets an ordinal.
  for (const participant of repo.participants(editionId)) {
    repo.upsertParticipant({
      ...participant,
      entryStatus: participant.teamProfileId === championId ? "CHAMPION" : "ELIMINATED",
      finalPlacement: participant.teamProfileId === championId ? 1 : undefined,
    });
  }
  syncNepalCampaign(db, editionId);
  markEdition(db, editionId, "COMPLETED");
  calculateSimulationWorldRanking(db, edition.endDate);
  recordInternationalHistory(db, editionId);
  return {
    edition: required(
      repo.editions().find((item) => item.id === editionId),
      "completed edition",
    ),
    matches: played,
    champion: championId ? repo.teamProfile(championId) : undefined,
  };
};

/** The simulation picks and fixes an edition's squad this many days before the edition starts. */
const EDITION_SQUAD_LEAD_DAYS = 7;

/** Marks every still-alive participant that is not in `alive` as eliminated. */
const markEliminatedExcept = (
  repo: InternationalFootballRepository,
  editionId: EntityId,
  alive: EntityId[],
): void => {
  const stillIn = new Set(alive);
  for (const participant of repo.participants(editionId)) {
    if (stillIn.has(participant.teamProfileId)) continue;
    if (participant.entryStatus === "ELIMINATED" || participant.entryStatus === "CHAMPION") continue;
    repo.upsertParticipant({ ...participant, entryStatus: "ELIMINATED" });
  }
};

/**
 * Brings a national team's campaign record in line with the matches played in
 * the edition, from the team's own side (a match level on goals is a draw), and
 * with its participant status. Does nothing if the team has no campaign.
 */
const syncNationalTeamCampaign = (db: GameDatabase, editionId: EntityId, nationalTeamId: EntityId): void => {
  const management = new NationalTeamManagementRepository(db);
  const campaign = management.campaigns(nationalTeamId).find((item) => item.competitionEditionId === editionId);
  if (!campaign) return;
  const repo = new InternationalFootballRepository(db);
  const own = repo.teamProfiles().find((profile) => profile.nationalTeamId === nationalTeamId);
  if (!own) return;
  const participant = repo.participants(editionId).find((item) => item.teamProfileId === own.id);
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const match of repo.matches(editionId)) {
    const isHome = match.homeTeamProfileId === own.id;
    if (match.status !== "PLAYED" || (!isHome && match.awayTeamProfileId !== own.id)) continue;
    if (match.homeGoals === undefined || match.awayGoals === undefined) continue;
    const goalsFor = isHome ? match.homeGoals : match.awayGoals;
    const goalsAgainst = isHome ? match.awayGoals : match.homeGoals;
    if (goalsFor > goalsAgainst) wins += 1;
    else if (goalsFor < goalsAgainst) losses += 1;
    else draws += 1;
  }
  management.upsertCampaign({
    ...campaign,
    matchesPlayed: wins + draws + losses,
    wins,
    draws,
    losses,
    qualificationStatus:
      participant?.entryStatus === "ELIMINATED" ? "ELIMINATED" : participant?.entryStatus === "CHAMPION" ? "COMPLETED" : "ACTIVE",
  });
};

const syncNepalCampaign = (db: GameDatabase, editionId: EntityId): void => {
  const repo = new InternationalFootballRepository(db);
  const nepal = repo
    .participants(editionId)
    .map((participant) => repo.teamProfile(participant.teamProfileId))
    .find((profile): profile is InternationalTeamProfile => Boolean(profile?.nationalTeamId));
  if (nepal?.nationalTeamId) syncNationalTeamCampaign(db, editionId, nepal.nationalTeamId);
};

/**
 * Enters Nepal's team for the edition: the simulation chooses the squad (the
 * edition's final-squad size, fixed a week before the edition starts), records
 * that squad as the team's final registration, opens its campaign and puts the
 * players on duty. Safe to repeat: a registered squad is never replaced.
 */
export const ensureNepalDutyForEdition = (
  db: GameDatabase,
  edition: InternationalCompetitionEdition,
  seed: string,
): void => {
  const repo = new InternationalFootballRepository(db);
  const nepal = repo
    .participants(edition.id)
    .map((participant) => repo.teamProfile(participant.teamProfileId))
    .find((profile): profile is InternationalTeamProfile => Boolean(profile?.nationalTeamId));
  if (!nepal?.nationalTeamId) return;
  const federation = homeFederation(db);
  const nationalTeamId = nepal.nationalTeamId;
  if (!nationalTeamParticipationAllowed(db, federation.id)) return;
  const squadDate = addDays(edition.startDate, -EDITION_SQUAD_LEAD_DAYS);
  const firstStage = repo.stages(edition.id).sort((a, b) => a.stageOrder - b.stageOrder)[0];
  const selected = selectNationalTeamSquad(db, {
    federationId: federation.id,
    nationalTeamId,
    date: squadDate,
    programme: edition.name,
    seed: `${seed}:edition-squad:${edition.id}`,
    size: firstStage?.finalSquadSize ?? 26,
  });
  const callups = new FederationGovernanceRepository(db)
    .nationalTeamCallups(nationalTeamId)
    .filter((callup) => callup.callupDate <= edition.startDate && callup.status === "CALLED_UP");
  if (callups.length === 0) return;
  createDutyForCurrentCallups(db, nationalTeamId, edition, squadDate, addDays(edition.endDate, 3));
  recordNationalTeamEditionEntry(db, {
    federationId: federation.id,
    nationalTeamId,
    edition,
    squadPlayerIds: selected.filter((callup) => callup.status === "CALLED_UP").map((callup) => callup.playerId),
    registrationDeadline: squadDate,
  });
};

export const calculateSimulationWorldRanking = (
  db: GameDatabase,
  date: string,
): SimulationWorldRanking[] => {
  const repo = new InternationalFootballRepository(db);
  const rankings: SimulationWorldRanking[] = [];
  for (const { teamType } of homeNationalTeams(db)) {
    const points = repo
      .teamProfiles()
      .filter((profile) => profile.teamType === teamType)
      .map((profile) => ({
        profile,
        points:
          profile.simulationStrength * 9 +
          profile.simulationReputation * 4 +
          profile.formRating * 2 +
          profile.developmentLevel,
      }))
      .sort((a, b) => b.points - a.points || a.profile.name.localeCompare(b.profile.name));
    const confederationCounts = new Map<FootballConfederation, number>();
    for (const [index, item] of points.entries()) {
      const confederationRank = (confederationCounts.get(item.profile.confederation) ?? 0) + 1;
      confederationCounts.set(item.profile.confederation, confederationRank);
      const ranking: SimulationWorldRanking = {
        id: createStableEntityId("simulation-world-ranking", `${item.profile.id}:${date}`),
        teamProfileId: item.profile.id,
        rankingDate: date,
        rank: index + 1,
        points: round(item.points),
        confederationRank,
        reputation: round(item.profile.simulationReputation),
        provenanceStatus: simulationStatus,
      };
      repo.upsertRanking(ranking);
      rankings.push(ranking);
    }
  }
  return rankings;
};

export const runNationalTeamCamp = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    nationalTeamId: EntityId;
    startDate: string;
    endDate: string;
    focus: NationalTeamCamp["focus"];
    competitionEditionId?: EntityId;
    seed: string;
  },
): NationalTeamCamp => {
  const repo = new InternationalFootballRepository(db);
  const campId = createStableEntityId(
    "national-team-camp",
    `${input.nationalTeamId}:${input.startDate}:${input.focus}`,
  );
  const existing = repo.camps().find((camp) => camp.id === campId);
  if (existing) return existing;
  const rng = new SeededRandom(`${input.seed}:camp:${input.startDate}`);
  const camp: NationalTeamCamp = {
    id: campId,
    federationId: input.federationId,
    nationalTeamId: input.nationalTeamId,
    competitionEditionId: input.competitionEditionId,
    startDate: input.startDate,
    endDate: input.endDate,
    focus: input.focus,
    cost: Math.round(150000 + rng.next() * 140000),
    currency: homeCurrency(db),
    status: "COMPLETED",
    cohesionGain: round(1.5 + rng.next() * 2.5),
    provenanceStatus: simulationStatus,
  };
  repo.upsertCamp(camp);
  postFederationTransaction(db, {
    federationId: input.federationId,
    date: input.startDate,
    category: "NATIONAL_TEAM_COST",
    direction: "DEBIT",
    amount: camp.cost,
    description: `National team ${input.focus.toLowerCase()} camp`,
    relatedEntityId: camp.id,
    idempotencyKey: `camp:${camp.id}`,
  });
  const callups = new FederationGovernanceRepository(db)
    .nationalTeamCallups(input.nationalTeamId)
    .filter((callup) => callup.callupDate <= camp.startDate && callup.status === "CALLED_UP")
    .slice(-26);
  updateCohesion(
    db,
    input.nationalTeamId,
    callups.map((callup) => callup.playerId),
    camp.endDate,
    camp.cohesionGain,
  );
  const historyId = createStableEntityId("historical-event", `camp:${camp.id}`);
  if (!db.prepare("SELECT 1 FROM historical_events WHERE id = ?").get(historyId)) {
    new EventRepository(db).insertHistoricalEvent({
      id: historyId,
      occurredOn: camp.endDate,
      eventType: "NATIONAL_TEAM_CAMP_COMPLETED",
      involvedEntities: [
        { id: camp.federationId, type: "federation" },
        { id: camp.nationalTeamId, type: "team" },
      ],
      title: "National team camp completed",
      data: {
        startDate: camp.startDate,
        endDate: camp.endDate,
        focus: camp.focus,
        participantCount: callups.length,
        cohesionGain: camp.cohesionGain,
      },
      importance: "medium",
      scope: "federation",
    });
  }
  return camp;
};

export const getNationalTeamHistory = (
  db: GameDatabase,
  nationalTeamId = seniorMenNationalTeamId(db),
): InternationalHistory => {
  const repo = new InternationalFootballRepository(db);
  const nepal = required(
    repo.teamProfiles().find((profile) => profile.nationalTeamId === nationalTeamId),
    `national team profile ${nationalTeamId}`,
  );
  const matches = repo
    .matches()
    .filter((match) => match.homeTeamProfileId === nepal.id || match.awayTeamProfileId === nepal.id)
    .filter((match) => match.status === "PLAYED");
  const appearances = new FederationGovernanceRepository(db).nationalTeamAppearances(nationalTeamId);
  const byPlayer = new Map<EntityId, { playerId: EntityId; caps: number; goals: number }>();
  for (const appearance of appearances) {
    const current = byPlayer.get(appearance.playerId) ?? {
      playerId: appearance.playerId,
      caps: 0,
      goals: 0,
    };
    current.caps += appearance.minutes > 0 ? 1 : 0;
    current.goals += appearance.goals;
    byPlayer.set(appearance.playerId, current);
  }
  const rows = [...byPlayer.values()];
  const rankings = repo.rankings().filter((ranking) => ranking.teamProfileId === nepal.id);
  return {
    matches,
    rankings,
    capsLeaders: [...rows].sort((a, b) => b.caps - a.caps).slice(0, 10),
    topScorers: [...rows].sort((a, b) => b.goals - a.goals || b.caps - a.caps).slice(0, 10),
    records: {
      biggestWin: biggestMargin(matches, nepal.id, true),
      biggestDefeat: biggestMargin(matches, nepal.id, false),
      longestUnbeatenRun: longestUnbeatenRun(matches, nepal.id),
      rankingPeak: rankings.sort((a, b) => a.rank - b.rank)[0],
    },
  };
};

export const processInternationalForSeasonPeriod = (
  db: GameDatabase,
  input: { seasonEndDate: string; seed: string },
): void => {
  const endYear = Number(input.seasonEndDate.slice(0, 4));
  initializeInternationalFootballForSave({ db, worldDate: `${endYear}-01-01`, seed: input.seed });
  const plans: Array<Parameters<typeof createInternationalCompetitionEdition>[1]> = [];
  if (endYear % 2 === 0) {
    plans.push({
      competitionKey: "SAFF",
      cycle: String(endYear),
      startDate: `${endYear}-09-01`,
      seed: input.seed,
    });
    plans.push({
      competitionKey: "SAFF_WOMEN",
      cycle: String(endYear),
      startDate: `${endYear}-10-04`,
      seed: input.seed,
    });
    plans.push({
      competitionKey: "SAFF_U23",
      cycle: String(endYear),
      startDate: `${endYear}-07-07`,
      seed: input.seed,
    });
  }
  if (endYear % 2 === 1) {
    plans.push({
      competitionKey: "SAFF_U20",
      cycle: String(endYear),
      startDate: `${endYear}-07-07`,
      seed: input.seed,
    });
    plans.push({
      competitionKey: "SAFF_U17",
      cycle: String(endYear),
      startDate: `${endYear}-10-04`,
      seed: input.seed,
    });
  }
  if (endYear % 4 === 3) {
    plans.push({
      competitionKey: "ASIAN_CUP_QUALIFICATION",
      cycle: String(endYear + 1),
      startDate: `${endYear}-03-20`,
      seed: input.seed,
    });
    plans.push({
      competitionKey: "AFC_WOMENS_ASIAN_CUP_QUALIFICATION",
      cycle: String(endYear + 1),
      startDate: `${endYear}-05-20`,
      seed: input.seed,
    });
  }
  if (endYear % 4 === 0) {
    plans.push({
      competitionKey: "ASIAN_CUP",
      cycle: String(endYear),
      startDate: `${endYear}-06-10`,
      seed: input.seed,
    });
  }
  if (endYear % 4 === 1) {
    plans.push({
      competitionKey: "AFC_WORLD_CUP_QUALIFICATION",
      cycle: String(endYear + 1),
      startDate: `${endYear}-10-08`,
      seed: input.seed,
    });
  }
  for (const plan of plans) {
    const edition = createInternationalCompetitionEdition(db, plan);
    ensureNepalDutyForEdition(db, edition, `${input.seed}:squad:${edition.id}`);
    const nationalTeam = new InternationalFootballRepository(db)
      .participants(edition.id)
      .map((participant) =>
        new InternationalFootballRepository(db).teamProfile(participant.teamProfileId),
      )
      .find((profile): profile is InternationalTeamProfile => Boolean(profile?.nationalTeamId));
    if (nationalTeam?.nationalTeamId) {
      runNationalTeamCamp(db, {
        federationId: homeFederation(db).id,
        nationalTeamId: nationalTeam.nationalTeamId,
        competitionEditionId: edition.id,
        startDate: addDays(edition.startDate, -6),
        endDate: addDays(edition.startDate, -1),
        focus: "TACTICAL_FAMILIARITY",
        seed: input.seed,
      });
    }
    advanceInternationalCompetition(db, edition.id, `${input.seed}:edition:${edition.id}`);
  }
  calculateSimulationWorldRanking(db, input.seasonEndDate);
};

export const runInternationalDiagnostic = (input: {
  db: GameDatabase;
  startDate: string;
  years: number;
  seed: string;
}): InternationalDiagnosticReport => {
  initializeInternationalFootballForSave({
    db: input.db,
    worldDate: input.startDate,
    seed: input.seed,
  });
  const startRanking = nepalRanking(input.db, input.startDate)?.rank ?? 0;
  const startYear = Number(input.startDate.slice(0, 4));
  for (let yearOffset = 0; yearOffset < input.years; yearOffset += 1) {
    processInternationalForSeasonPeriod(input.db, {
      seasonEndDate: seasonEndInYear(input.db, startYear + yearOffset),
      seed: `${input.seed}:year:${yearOffset}`,
    });
    closeFederationFinancialSeason(input.db, {
      seasonLabel: String(startYear + yearOffset),
      date: seasonEndInYear(input.db, startYear + yearOffset),
    });
  }
  const history = getNationalTeamHistory(input.db);
  const repo = new InternationalFootballRepository(input.db);
  const nepal = homeProfile(input.db, repo);
  const matches = history.matches;
  const wins = matches.filter((match) => isWin(match, nepal.id)).length;
  const draws = matches.filter(
    (match) => !match.winnerTeamProfileId && match.homeGoals === match.awayGoals,
  ).length;
  const losses = matches.length - wins - draws;
  const latestRanking = nepalRanking(input.db, `${startYear + input.years - 1}-07-31`);
  const peak = history.records.rankingPeak?.rank ?? latestRanking?.rank ?? startRanking;
  const federationLedger = new FederationGovernanceRepository(input.db).ledgerEntries(
    homeFederation(input.db).id,
  );
  const income = federationLedger
    .filter((entry) => entry.category === "MATCH_REVENUE" && entry.direction === "CREDIT")
    .reduce((total, entry) => total + entry.amount, 0);
  const costs = federationLedger
    .filter((entry) => entry.category === "NATIONAL_TEAM_COST" && entry.direction === "DEBIT")
    .reduce((total, entry) => total + entry.amount, 0);
  const participants = repo.participants();
  return {
    date: `${startYear + input.years - 1}-07-31`,
    years: input.years,
    matches: matches.length,
    wins,
    draws,
    losses,
    goalsFor: matches.reduce((total, match) => total + goalsFor(match, nepal.id), 0),
    goalsAgainst: matches.reduce((total, match) => total + goalsAgainst(match, nepal.id), 0),
    saffEditions: repo.editions().filter((edition) => edition.name.includes("SAFF")).length,
    saffTitles: participants.filter(
      (item) =>
        item.teamProfileId === nepal.id &&
        item.entryStatus === "CHAMPION" &&
        editionName(repo, item.editionId).includes("SAFF"),
    ).length,
    asianCupQualifications: participants.filter(
      (item) =>
        item.teamProfileId === nepal.id &&
        item.entryStatus !== "ELIMINATED" &&
        editionName(repo, item.editionId).includes("Asian Cup "),
    ).length,
    worldCupQualifications: participants.filter(
      (item) =>
        item.teamProfileId === nepal.id &&
        item.entryStatus === "CHAMPION" &&
        editionName(repo, item.editionId).includes("World Cup"),
    ).length,
    rankingStart: startRanking,
    rankingEnd: latestRanking?.rank ?? 0,
    rankingPeak: peak,
    topScorers: history.topScorers.slice(0, 5),
    capsLeaders: history.capsLeaders.slice(0, 5),
    majorUpsets: matches.filter((match) => isMajorUpset(repo, match, nepal.id)).length,
    federationIncome: income,
    federationCosts: costs,
    externalOpponentsUsed: [
      ...new Set(
        matches.map((match) => repo.teamProfile(opponentId(match, nepal.id))?.name ?? "Unknown"),
      ),
    ].sort(),
    editions: repo.editions().map((edition) => ({
      name: edition.name,
      status: edition.status,
      nepalPlacement: repo
        .participants(edition.id)
        .find((participant) => participant.teamProfileId === nepal.id)?.finalPlacement,
    })),
  };
};

const seedCompetitionShells = (repo: InternationalFootballRepository): void => {
  const rows: InternationalCompetition[] = [
    {
      id: createStableEntityId("international-competition", "SAFF"),
      name: "SAFF Championship",
      competitionType: "REGIONAL_CHAMPIONSHIP",
      confederation: "AFC",
      region: "SAFF",
      cadenceYears: 2,
      provenanceStatus: factualIdentityStatus,
    },
    {
      id: createStableEntityId("international-competition", "ASIAN_CUP_QUALIFICATION"),
      name: "AFC Asian Cup Qualification",
      competitionType: "QUALIFIER",
      confederation: "AFC",
      region: "GLOBAL",
      cadenceYears: 4,
      provenanceStatus: simulationStatus,
    },
    {
      id: createStableEntityId("international-competition", "ASIAN_CUP"),
      name: "AFC Asian Cup",
      competitionType: "CONTINENTAL_CHAMPIONSHIP",
      confederation: "AFC",
      region: "GLOBAL",
      cadenceYears: 4,
      provenanceStatus: factualIdentityStatus,
    },
    {
      id: createStableEntityId("international-competition", "AFC_WORLD_CUP_QUALIFICATION"),
      name: "AFC World Cup Qualification",
      competitionType: "WORLD_QUALIFIER",
      confederation: "AFC",
      region: "GLOBAL",
      cadenceYears: 4,
      provenanceStatus: simulationStatus,
    },
    {
      id: createStableEntityId("international-competition", "WORLD_CUP"),
      name: "World Championship",
      competitionType: "WORLD_CHAMPIONSHIP",
      region: "GLOBAL",
      cadenceYears: 4,
      provenanceStatus: simulationStatus,
    },
    {
      id: createStableEntityId("international-competition", "SAFF_WOMEN"),
      name: "SAFF Women's Championship",
      competitionType: "REGIONAL_CHAMPIONSHIP",
      confederation: "AFC",
      region: "SAFF",
      cadenceYears: 2,
      provenanceStatus: simulationStatus,
    },
    {
      id: createStableEntityId("international-competition", "AFC_WOMENS_ASIAN_CUP_QUALIFICATION"),
      name: "AFC Women's Asian Cup Qualification",
      competitionType: "QUALIFIER",
      confederation: "AFC",
      region: "GLOBAL",
      cadenceYears: 4,
      provenanceStatus: simulationStatus,
    },
    ...(["U23", "U20", "U17"] as const).map((ageGroup) => ({
      id: createStableEntityId("international-competition", `SAFF_${ageGroup}`),
      name: `SAFF ${ageGroup} Championship`,
      competitionType: "REGIONAL_CHAMPIONSHIP" as const,
      confederation: "AFC" as const,
      region: "SAFF" as const,
      cadenceYears: 2,
      provenanceStatus: simulationStatus,
    })),
  ];
  rows.forEach((competition) => repo.upsertCompetition(competition));
};

const stageRules = (
  edition: InternationalCompetitionEdition,
  key: InternationalCompetitionKey,
): InternationalCompetitionStage[] => {
  const groupCount = isRegionalCompetition(key) ? 2 : key === "ASIAN_CUP" ? 4 : 3;
  const groupSize = 4;
  const teamsToAdvance = isRegionalCompetition(key) ? 2 : key.includes("QUALIFICATION") ? 1 : 2;
  const tiebreakers: InternationalTiebreaker[] = [
    "POINTS",
    "GOAL_DIFFERENCE",
    "GOALS_SCORED",
    "HEAD_TO_HEAD",
    "DISCIPLINE",
    "SEEDED_FALLBACK",
  ];
  const base = {
    editionId: edition.id,
    groupSize,
    matchdaySquadSize: 23,
    preliminarySquadSize: 30,
    finalSquadSize: 26,
    tiebreakers,
    provenanceStatus: simulationStatus,
  };
  return [
    {
      id: createStableEntityId("international-stage", `${edition.id}:group`),
      ...base,
      name: "Group Stage",
      stageOrder: 1,
      formatType: "GROUP_STAGE",
      groupCount,
      legs: key.includes("QUALIFICATION") ? 2 : 1,
      teamsToAdvance,
      allowExtraTime: false,
      allowPenalties: false,
      awayGoals: false,
    },
    {
      id: createStableEntityId("international-stage", `${edition.id}:knockout`),
      ...base,
      name: isRegionalCompetition(key) ? "Semi-Final and Final" : "Knockout Stage",
      stageOrder: 2,
      formatType: "SINGLE_ELIMINATION",
      groupCount: 1,
      legs: 1,
      teamsToAdvance: 1,
      allowExtraTime: true,
      allowPenalties: true,
      awayGoals: false,
    },
  ];
};

const seedParticipants = (
  db: GameDatabase,
  edition: InternationalCompetitionEdition,
  key: InternationalCompetitionKey,
): void => {
  const repo = new InternationalFootballRepository(db);
  const teamType = teamTypeForCompetitionKey(key);
  const federation = homeFederation(db);
  const profiles = repo
    .teamProfiles()
    .filter((profile) => {
      if (profile.teamType !== teamType) return false;
      if (isRegionalCompetition(key)) return profile.region === "SAFF";
      if (key === "WORLD_CUP") return profile.confederation !== undefined;
      return profile.confederation === "AFC";
    })
    .sort((a, b) => b.simulationReputation - a.simulationReputation);
  const limit = isRegionalCompetition(key) ? 7 : key === "ASIAN_CUP" ? 16 : key === "WORLD_CUP" ? 16 : 12;
  const selected = profiles
    .filter((profile) => profile.nationalTeamId === undefined || nationalTeamParticipationAllowed(db, federation.id))
    .slice(0, limit);
  const nepal = profiles.find((profile) => Boolean(profile.nationalTeamId));
  if (
    nepal &&
    nationalTeamParticipationAllowed(db, federation.id) &&
    !selected.some((profile) => profile.id === nepal.id)
  ) {
    selected[selected.length - 1] = nepal;
  }
  selected.forEach((profile) => {
    repo.upsertParticipant({
      id: createStableEntityId("international-participant", `${edition.id}:${profile.id}`),
      editionId: edition.id,
      teamProfileId: profile.id,
      entryStatus: edition.hostCountryIds.includes(profile.countryId) ? "HOST" : "ACTIVE",
      // Only what the simulation actually knows about the entry is recorded.
      qualificationSource: edition.hostCountryIds.includes(profile.countryId) ? "Host nation" : undefined,
      seedRating:
        profile.simulationReputation + profile.simulationStrength + profile.formRating * 0.2,
      provenanceStatus: simulationStatus,
    });
  });
};

const simulateNepalInternationalMatch = (
  db: GameDatabase,
  match: InternationalMatch,
  home: InternationalTeamProfile,
  away: InternationalTeamProfile,
  seed: string,
): FastExternalMatchResult => {
  const federation = homeFederation(db);
  const nationalTeamId = home.nationalTeamId ?? away.nationalTeamId;
  if (!nationalTeamId) throw new Error("Nepal international match is missing its national team");
  selectNationalTeamSquad(db, {
    federationId: federation.id,
    nationalTeamId,
    date: match.matchDate,
    programme: "International match",
    seed,
    size: 23,
  });
  const callups = new FederationGovernanceRepository(db)
    .nationalTeamCallups(nationalTeamId)
    .filter((callup) => callup.callupDate <= match.matchDate && callup.status === "CALLED_UP")
    .slice(-23);
  const latestCamp = new InternationalFootballRepository(db)
    .camps()
    .filter(
      (camp) =>
        camp.nationalTeamId === nationalTeamId &&
        camp.status === "COMPLETED" &&
        camp.endDate <= match.matchDate,
    )
    .sort((a, b) => b.endDate.localeCompare(a.endDate) || b.id.localeCompare(a.id))[0];
  const campTeamworkBoost = latestCamp ? Math.min(3, latestCamp.cohesionGain / 2) : 0;
  const nepalPlayers = playerAttributes(db)
    .filter((player) =>
    callups.some((callup) => callup.playerId === player.personId),
    )
    .map((player) =>
      campTeamworkBoost > 0
        ? {
            ...player,
            mental: {
              ...player.mental,
              teamwork: Math.min(100, player.mental.teamwork + campTeamworkBoost),
            },
          }
        : player,
    );
  const nepalIsHome = home.nationalTeamId === nationalTeamId;
  const opponentTeamId = nepalIsHome ? syntheticTeamId(away) : syntheticTeamId(home);
  const opponentPlayers = nepalIsHome ? syntheticPlayers(away, seed) : syntheticPlayers(home, seed);
  // The Nepal national team is a real teams row, so it gets the same
  // persisted, manager-aware resolver every club uses. The foreign opponent
  // has no real team row to persist a setup against, so it gets a
  // deterministic, unpersisted identity from the same AI tactics module
  // instead of no tactical context at all.
  const nepalTacticalSetup = resolveTeamTacticalSetup(db, nationalTeamId, nepalPlayers);
  const opponentTacticalSetup = buildAiTacticalSetup(opponentTeamId, opponentPlayers);
  const result = simulateMatch({
    fixture: {
      id: createStableEntityId("fixture", `international:${match.id}`),
      competitionSeasonId: undefined,
      homeTeamId: nepalIsHome ? nationalTeamId : opponentTeamId,
      awayTeamId: nepalIsHome ? opponentTeamId : nationalTeamId,
      scheduledDate: match.matchDate,
      status: "scheduled",
      round: 1,
    },
    homePlayers: nepalIsHome ? nepalPlayers : opponentPlayers,
    awayPlayers: nepalIsHome ? opponentPlayers : nepalPlayers,
    homeTacticalSetup: nepalIsHome ? nepalTacticalSetup : opponentTacticalSetup,
    awayTacticalSetup: nepalIsHome ? opponentTacticalSetup : nepalTacticalSetup,
    seed: `${seed}:nepal-match:${match.id}`,
  });
  const homeGoals = result.match.homeGoals ?? 0;
  const awayGoals = result.match.awayGoals ?? 0;
  const winnerTeamProfileId = resolveWinner(match, homeGoals, awayGoals, seed);
  persistNationalFixtureAndAppearances(
    db,
    federation,
    nationalTeamId,
    match,
    home,
    away,
    result.playerStates,
    result.events,
    homeGoals,
    awayGoals,
  );
  const travelCost = Math.round(nepalIsHome ? 230000 : 360000 + away.developmentLevel * 1800);
  const revenue = Math.round(nepalIsHome ? 1100000 + home.simulationReputation * 9000 : 620000);
  postFederationTransaction(db, {
    federationId: federation.id,
    date: match.matchDate,
    category: "MATCH_REVENUE",
    direction: "CREDIT",
    amount: revenue,
    description: `International match revenue: ${home.name} vs ${away.name}`,
    relatedEntityId: match.id,
    idempotencyKey: `international-revenue:${match.id}`,
  });
  postFederationTransaction(db, {
    federationId: federation.id,
    date: match.matchDate,
    category: "NATIONAL_TEAM_COST",
    direction: "DEBIT",
    amount: travelCost,
    description: `International match costs: ${home.name} vs ${away.name}`,
    relatedEntityId: match.id,
    idempotencyKey: `international-cost:${match.id}`,
  });
  updateCohesion(
    db,
    nationalTeamId,
    callups.map((callup) => callup.playerId),
    match.matchDate,
    1.2,
  );
  return {
    homeGoals,
    awayGoals,
    winnerTeamProfileId,
    extraTimePlayed: false,
    penaltiesPlayed: false,
  };
};

export const fastExternalMatch = (
  home: InternationalTeamProfile,
  away: InternationalTeamProfile,
  input: {
    seed: string;
    date: string;
    importance: InternationalMatchImportance;
    knockout?: boolean;
  },
): FastExternalMatchResult => {
  const rng = new SeededRandom(`${input.seed}:${input.date}:${home.id}:${away.id}`);
  const importance =
    input.importance === "FRIENDLY" ? 0.75 : input.importance === "WORLD" ? 1.15 : 1;
  const homePower = home.simulationStrength * home.homeAdvantageProfile + home.formRating * 0.12;
  const awayPower = away.simulationStrength + away.formRating * 0.12;
  const homeExpected = Math.max(0.15, 0.7 + (homePower - awayPower) / 38) * importance;
  const awayExpected = Math.max(0.12, 0.65 + (awayPower - homePower) / 42) * importance;
  let homeGoals = goalsFromExpectation(homeExpected, rng);
  let awayGoals = goalsFromExpectation(awayExpected, rng);
  let extraTimePlayed = false;
  let penaltiesPlayed = false;
  let homePenaltyGoals: number | undefined;
  let awayPenaltyGoals: number | undefined;
  let winnerTeamProfileId =
    homeGoals > awayGoals ? home.id : awayGoals > homeGoals ? away.id : undefined;
  if (!winnerTeamProfileId && input.knockout) {
    extraTimePlayed = true;
    if (rng.next() < (homePower + 2) / (homePower + awayPower + 4)) homeGoals += 1;
    else awayGoals += 1;
    winnerTeamProfileId = homeGoals > awayGoals ? home.id : away.id;
    if (rng.next() < 0.35) {
      homeGoals -= homeGoals > awayGoals ? 1 : 0;
      awayGoals -= awayGoals > homeGoals ? 1 : 0;
      penaltiesPlayed = true;
      homePenaltyGoals = rng.integer(3, 5);
      awayPenaltyGoals = rng.integer(3, 5);
      if (homePenaltyGoals === awayPenaltyGoals) {
        homePenaltyGoals += rng.next() < homePower / (homePower + awayPower) ? 1 : 0;
        awayPenaltyGoals += homePenaltyGoals === awayPenaltyGoals ? 1 : 0;
      }
      winnerTeamProfileId = homePenaltyGoals > awayPenaltyGoals ? home.id : away.id;
    }
  }
  return {
    homeGoals,
    awayGoals,
    winnerTeamProfileId,
    extraTimePlayed,
    penaltiesPlayed,
    homePenaltyGoals,
    awayPenaltyGoals,
  };
};

const createKnockoutMatches = (
  repo: InternationalFootballRepository,
  edition: InternationalCompetitionEdition,
  stage: InternationalCompetitionStage,
  qualified: Array<{
    teamProfileId: EntityId;
    points: number;
    goalDifference: number;
    goalsFor: number;
  }>,
): InternationalMatch[] => {
  const ordered = [...qualified].sort(
    (a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor,
  );
  const pairs = Math.floor(ordered.length / 2);
  const matches: InternationalMatch[] = [];
  for (let index = 0; index < pairs; index += 1) {
    const home = ordered[index]!.teamProfileId;
    const away = ordered[ordered.length - 1 - index]!.teamProfileId;
    const match: InternationalMatch = {
      id: createStableEntityId(
        "international-match",
        `${stage.id}:knockout:${index}:${home}:${away}`,
      ),
      editionId: edition.id,
      stageId: stage.id,
      matchDate: addDays(edition.startDate, 28 + index * 4),
      homeTeamProfileId: home,
      awayTeamProfileId: away,
      neutralVenue: true,
      status: "SCHEDULED",
      extraTimePlayed: false,
      penaltiesPlayed: false,
      importance: importanceForEdition(edition),
      provenanceStatus: simulationStatus,
    };
    repo.upsertMatch(match);
    matches.push(match);
  }
  if (matches.length === 1 && ordered.length === 2) return matches;
  return matches.length > 0 ? matches : [];
};

export type GroupStandingRow = {
  teamProfileId: EntityId;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  goalDifference: number;
  goalsFor: number;
  goalsAgainst: number;
};

/** Group tables, computed from played group-stage matches and ordered by points, goal difference, goals scored. */
export const groupStandings = (
  repo: InternationalFootballRepository,
  editionId: EntityId,
  stageId: EntityId,
): Array<{
  groupName: string;
  rows: GroupStandingRow[];
}> => {
  const teams = repo.participants(editionId);
  const byGroup = new Map<string, Map<EntityId, GroupStandingRow>>();
  for (const participant of teams) {
    const groupName = participant.groupName ?? "A";
    if (!byGroup.has(groupName)) byGroup.set(groupName, new Map());
    byGroup.get(groupName)!.set(participant.teamProfileId, {
      teamProfileId: participant.teamProfileId,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      points: 0,
      goalDifference: 0,
      goalsFor: 0,
      goalsAgainst: 0,
    });
  }
  for (const match of repo
    .matches(editionId)
    .filter((item) => item.stageId === stageId && item.status === "PLAYED")) {
    const group = byGroup.get(match.groupName ?? "A");
    if (!group) continue;
    const home = group.get(match.homeTeamProfileId);
    const away = group.get(match.awayTeamProfileId);
    if (!home || !away || match.homeGoals === undefined || match.awayGoals === undefined) continue;
    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeGoals;
    away.goalsFor += match.awayGoals;
    home.goalsAgainst += match.awayGoals;
    away.goalsAgainst += match.homeGoals;
    home.goalDifference += match.homeGoals - match.awayGoals;
    away.goalDifference += match.awayGoals - match.homeGoals;
    if (match.homeGoals > match.awayGoals) {
      home.points += 3;
      home.won += 1;
      away.lost += 1;
    } else if (match.awayGoals > match.homeGoals) {
      away.points += 3;
      away.won += 1;
      home.lost += 1;
    } else {
      home.points += 1;
      away.points += 1;
      home.drawn += 1;
      away.drawn += 1;
    }
  }
  return [...byGroup.entries()].map(([groupName, rows]) => ({
    groupName,
    rows: [...rows.values()].sort(
      (a, b) =>
        b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor,
    ),
  }));
};

const ensureExternalCountries = (db: GameDatabase): void => {
  for (const item of registry) {
    const home = findHomeFootballContext(db);
    if (home && countryPack(home.packId).isoCodes.includes(item.isoCode)) continue;
    db.prepare("INSERT OR IGNORE INTO countries (id, name, iso_code) VALUES (?, ?, ?)").run(
      createStableEntityId("country", item.isoCode),
      item.countryName,
      item.isoCode,
    );
  }
};

const createDutyForCurrentCallups = (
  db: GameDatabase,
  nationalTeamId: EntityId,
  edition: InternationalCompetitionEdition,
  departureDate: string,
  returnDate: string,
): void => {
  const federationRepo = new FederationGovernanceRepository(db);
  const repo = new InternationalFootballRepository(db);
  for (const callup of federationRepo.nationalTeamCallups(nationalTeamId).slice(-26)) {
    const duty: NationalTeamDuty = {
      id: createStableEntityId("national-team-duty", `${edition.id}:${callup.playerId}`),
      nationalTeamId,
      playerId: callup.playerId,
      competitionEditionId: edition.id,
      departureDate,
      returnDate,
      status: "ON_DUTY",
      fitnessEffect: -3,
      provenanceStatus: simulationStatus,
    };
    repo.upsertDuty(duty);
  }
};

const updateCohesion = (
  db: GameDatabase,
  nationalTeamId: EntityId,
  playerIds: EntityId[],
  date: string,
  gain: number,
): void => {
  const repo = new InternationalFootballRepository(db);
  const existing = new Map(repo.cohesion(nationalTeamId).map((item) => [item.playerId, item]));
  for (const playerId of playerIds) {
    const previous = existing.get(playerId);
    const cohesion: NationalTeamCohesion = {
      id: createStableEntityId("national-team-cohesion", `${nationalTeamId}:${playerId}`),
      nationalTeamId,
      playerId,
      familiarity: Math.min(100, (previous?.familiarity ?? 15) + gain),
      lastUpdated: date,
      provenanceStatus: simulationStatus,
    };
    repo.upsertCohesion(cohesion);
  }
};

/** Restricts a candidate list to IDs that exist as canonical persons. */
const canonicalPersonIds = (db: GameDatabase, personIds: readonly EntityId[]): Set<EntityId> => {
  if (personIds.length === 0) return new Set();
  const placeholders = personIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT id FROM persons WHERE id IN (${placeholders})`)
    .all(...personIds) as Array<{ id: EntityId }>;
  return new Set(rows.map((row) => row.id));
};

const persistNationalFixtureAndAppearances = (
  db: GameDatabase,
  federation: Federation,
  nationalTeamId: EntityId,
  match: InternationalMatch,
  home: InternationalTeamProfile,
  away: InternationalTeamProfile,
  states: Array<{ teamId: EntityId; personId: EntityId; minutesPlayed: number }>,
  events: Array<{ type: string; personId?: EntityId }>,
  homeGoals: number,
  awayGoals: number,
): void => {
  const opponent = home.nationalTeamId === nationalTeamId ? away : home;
  const fixture: NationalTeamFixture = {
    id: createStableEntityId("national-team-fixture", `international:${match.id}`),
    federationId: federation.id,
    nationalTeamId,
    opponentName: opponent.name,
    fixtureDate: match.matchDate,
    fixtureType: match.importance === "FRIENDLY" ? "FRIENDLY" : "QUALIFIER",
    status: "PLAYED",
    homeGoals,
    awayGoals,
    estimatedCost: 0,
    estimatedRevenue: 0,
    currency: homeCurrency(db),
    provenanceStatus: simulationStatus,
  };
  const repo = new FederationGovernanceRepository(db);
  repo.upsertNationalTeamFixture(fixture);
  // Match lineup repair may field transient replacement players when the squad is
  // short. Those IDs are deliberately absent from `persons`, so they must never
  // reach person-keyed national-team history.
  const selected = states.filter((item) => item.teamId === nationalTeamId);
  const canonical = canonicalPersonIds(
    db,
    selected.map((item) => item.personId),
  );
  for (const state of selected.filter((item) => canonical.has(item.personId))) {
    const appearance: NationalTeamAppearance = {
      id: createStableEntityId("national-team-appearance", `${match.id}:${state.personId}`),
      nationalTeamId,
      playerId: state.personId,
      matchDate: match.matchDate,
      opponentName: opponent.name,
      minutes: state.minutesPlayed,
      goals: events.filter((event) => event.type === "GOAL" && event.personId === state.personId)
        .length,
      status: simulationStatus,
    };
    repo.insertNationalTeamAppearance(appearance);
  }
};

const updateTeamProfilesAfterMatch = (db: GameDatabase, match: InternationalMatch): void => {
  const repo = new InternationalFootballRepository(db);
  const home = required(repo.teamProfile(match.homeTeamProfileId), "home profile");
  const away = required(repo.teamProfile(match.awayTeamProfileId), "away profile");
  const homeDelta = resultDelta(match, home.id, away);
  const awayDelta = resultDelta(match, away.id, home);
  repo.upsertTeamProfile(evolveProfile(home, homeDelta, match.matchDate));
  repo.upsertTeamProfile(evolveProfile(away, awayDelta, match.matchDate));
};

const evolveProfile = (
  profile: InternationalTeamProfile,
  delta: number,
  date: string,
): InternationalTeamProfile => ({
  ...profile,
  simulationStrength: round(
    clamp(
      profile.simulationStrength +
        delta * 0.18 +
        (profile.developmentLevel - profile.simulationStrength) * 0.01,
      10,
      92,
    ),
  ),
  simulationReputation: round(clamp(profile.simulationReputation + delta * 0.12, 10, 94)),
  formRating: round(clamp(profile.formRating * 0.82 + 50 * 0.08 + delta * 2.2, 20, 82)),
  lastUpdated: date,
});

const resultDelta = (
  match: InternationalMatch,
  teamId: EntityId,
  opponent: InternationalTeamProfile,
): number => {
  if (!match.winnerTeamProfileId && match.homeGoals === match.awayGoals) return 0.2;
  const won = match.winnerTeamProfileId === teamId;
  const upset = opponent.simulationStrength / 60;
  return won ? 1.2 * upset : -0.7 / Math.max(0.7, upset);
};

const playerAttributes = (db: GameDatabase): PlayerAttributeSet[] =>
  (
    db
      .prepare(
        `SELECT id, person_id, primary_position, secondary_positions_json, technical_json,
          mental_json, physical_json, goalkeeping_json FROM player_attributes`,
      )
      .all() as any[]
  ).map((row) => ({
    id: row.id,
    personId: row.person_id,
    primaryPosition: row.primary_position,
    secondaryPositions: JSON.parse(row.secondary_positions_json),
    technical: JSON.parse(row.technical_json),
    mental: JSON.parse(row.mental_json),
    physical: JSON.parse(row.physical_json),
    goalkeeping: JSON.parse(row.goalkeeping_json),
  }));

const syntheticPlayers = (
  profile: InternationalTeamProfile,
  seed: string,
): PlayerAttributeSet[] => {
  const rng = new SeededRandom(`${seed}:synthetic:${profile.id}`);
  const positions: PlayerPosition[] = [
    "GK",
    "RB",
    "LB",
    "CB",
    "CB",
    "CM",
    "CM",
    "RW",
    "LW",
    "AM",
    "ST",
    "GK",
    "RB",
    "LB",
    "CB",
    "DM",
    "CM",
    "RW",
    "LW",
    "ST",
    "ST",
    "CM",
    "CB",
  ];
  return positions.map((position, index) => {
    const base = clamp(profile.simulationStrength / 5 + rng.integer(-2, 2), 3, 19);
    return {
      id: createStableEntityId("external-attributes", `${profile.id}:${index}`),
      personId: createStableEntityId("external-person", `${profile.id}:${index}`),
      primaryPosition: position,
      secondaryPositions: [],
      technical: {
        firstTouch: base,
        passing: base,
        crossing: base,
        dribbling: base,
        finishing: base,
        heading: base,
        tackling: base,
        technique: base,
        longShots: base,
        setPieces: base,
      },
      mental: {
        decisions: base,
        vision: base,
        composure: base,
        positioning: base,
        anticipation: base,
        workRate: base,
        teamwork: base,
        leadership: base,
        aggression: base,
        determination: base,
        professionalism: base,
      },
      physical: {
        pace: base,
        acceleration: base,
        strength: base,
        stamina: base,
        agility: base,
        balance: base,
        jumping: base,
        naturalFitness: base,
      },
      goalkeeping: {
        handling: position === "GK" ? base : 2,
        reflexes: position === "GK" ? base : 2,
        oneOnOnes: position === "GK" ? base : 2,
        aerialReach: position === "GK" ? base : 2,
        kicking: position === "GK" ? base : 2,
        distribution: position === "GK" ? base : 2,
        commandOfArea: position === "GK" ? base : 2,
      },
    };
  });
};

const resolveWinner = (
  match: InternationalMatch,
  homeGoals: number,
  awayGoals: number,
  seed: string,
): EntityId | undefined => {
  if (homeGoals > awayGoals) return match.homeTeamProfileId;
  if (awayGoals > homeGoals) return match.awayTeamProfileId;
  // A group-stage match can end level; only a knockout tie needs a winner.
  if (!match.stageId || match.groupName) return undefined;
  const rng = new SeededRandom(`${seed}:penalties:${match.id}`);
  return rng.next() < 0.5 ? match.homeTeamProfileId : match.awayTeamProfileId;
};

const markEdition = (
  db: GameDatabase,
  editionId: EntityId,
  status: InternationalCompetitionEdition["status"],
): void => {
  const repo = new InternationalFootballRepository(db);
  const edition = required(
    repo.editions().find((item) => item.id === editionId),
    `edition ${editionId}`,
  );
  repo.upsertEdition({ ...edition, status });
};

const recordInternationalHistory = (db: GameDatabase, editionId: EntityId): void => {
  const repo = new InternationalFootballRepository(db);
  const edition = required(
    repo.editions().find((item) => item.id === editionId),
    "edition",
  );
  const participants = repo.participants(editionId);
  const nepal = participants
    .map((participant) => repo.teamProfile(participant.teamProfileId))
    .find((profile): profile is InternationalTeamProfile => Boolean(profile?.nationalTeamId));
  const nepalParticipant = nepal
    ? participants.find((item) => item.teamProfileId === nepal.id)
    : undefined;
  const eventId = createStableEntityId("historical-event", `international:${editionId}`);
  if (db.prepare("SELECT 1 FROM historical_events WHERE id = ?").get(eventId)) return;
  new EventRepository(db).insertHistoricalEvent({
    id: eventId,
    occurredOn: edition.endDate,
    eventType: "INTERNATIONAL_EDITION_COMPLETED",
    involvedEntities: nepal ? [{ type: "country", id: nepal.countryId }] : [],
    title: `${edition.name} completed`,
    data: {
      nepalPlacement: nepalParticipant?.finalPlacement,
      status: nepalParticipant?.entryStatus,
    },
    importance: nepalParticipant?.entryStatus === "CHAMPION" ? "historic" : "medium",
    scope: "country",
  });
};

/** The country row for a registry ISO code. The home country is found through the home context, so its alternative ISO forms all resolve to it. */
const countryIdByIso = (db: GameDatabase, isoCode: string): EntityId => {
  const home = findHomeFootballContext(db);
  if (home && countryPack(home.packId).isoCodes.includes(isoCode)) return home.countryId;
  const row = db.prepare("SELECT id FROM countries WHERE iso_code = ? LIMIT 1").get(isoCode) as { id: EntityId } | undefined;
  if (!row) throw new Error(`Country ${isoCode} missing`);
  return row.id;
};

const seniorMenNationalTeamId = (db: GameDatabase): EntityId => {
  const row = db
    .prepare(
      "SELECT id FROM teams WHERE federation_id = ? AND club_id IS NULL AND level = 'senior' AND gender = 'men' ORDER BY name LIMIT 1",
    )
    .get(homeFederation(db).id) as { id: EntityId } | undefined;
  if (!row) throw new Error("Senior men's national team missing");
  return row.id;
};

const nationalTeamIdForType = (db: GameDatabase, teamType: NationalTeamType): EntityId => {
  const definition = homeNationalTeams(db).find((item) => item.teamType === teamType);
  if (!definition) throw new Error(`${teamType} is not part of the home national-team structure`);
  const row = db
    .prepare(
      "SELECT id FROM teams WHERE federation_id = ? AND club_id IS NULL AND level = ? AND gender = ? ORDER BY name LIMIT 1",
    )
    .get(homeFederation(db).id, definition.level, definition.gender) as { id: EntityId } | undefined;
  if (!row) throw new Error(`${teamType} national team missing`);
  return row.id;
};

const homeProfile = (db: GameDatabase, repo: InternationalFootballRepository): InternationalTeamProfile =>
  required(
    repo.teamProfiles().find((profile) => profile.countryId === homeCountryId(db) && profile.teamType === "SENIOR_MEN"),
    "Home country profile",
  );

const nepalRanking = (db: GameDatabase, date: string): SimulationWorldRanking | undefined => {
  const repo = new InternationalFootballRepository(db);
  const nepal = homeProfile(db, repo);
  return repo.rankings(date).find((ranking) => ranking.teamProfileId === nepal.id);
};

const competitionByKey = (
  repo: InternationalFootballRepository,
  key: InternationalCompetitionKey,
): InternationalCompetition =>
  required(
    repo
      .competitions()
      .find(
        (competition) => competition.id === createStableEntityId("international-competition", key),
      ),
    key,
  );

const hostCountries = (
  key: InternationalCompetitionKey,
): EntityId[] => {
  if (isRegionalCompetition(key)) return [createStableEntityId("country", "NP")];
  if (key === "ASIAN_CUP") return [createStableEntityId("country", "QA")];
  if (key === "WORLD_CUP") return [createStableEntityId("country", "US")];
  return [];
};

const importanceForEdition = (
  edition: InternationalCompetitionEdition,
): InternationalMatchImportance => {
  if (edition.name.includes("World")) return "WORLD";
  if (edition.name.includes("Qualification")) return "QUALIFIER";
  if (edition.name.includes("Asian Cup")) return "CONTINENTAL";
  if (edition.name.includes("SAFF")) return "REGIONAL";
  return "FRIENDLY";
};

const goalsFromExpectation = (expected: number, rng: SeededRandom): number => {
  let goals = 0;
  for (let index = 0; index < 6; index += 1) {
    if (rng.next() < expected / (index + 1.8)) goals += 1;
  }
  return Math.min(7, goals);
};

const editionName = (repo: InternationalFootballRepository, editionId: EntityId): string =>
  repo.editions().find((edition) => edition.id === editionId)?.name ?? "";

const opponentId = (match: InternationalMatch, teamId: EntityId): EntityId =>
  match.homeTeamProfileId === teamId ? match.awayTeamProfileId : match.homeTeamProfileId;

const goalsFor = (match: InternationalMatch, teamId: EntityId): number =>
  match.homeTeamProfileId === teamId ? (match.homeGoals ?? 0) : (match.awayGoals ?? 0);

const goalsAgainst = (match: InternationalMatch, teamId: EntityId): number =>
  match.homeTeamProfileId === teamId ? (match.awayGoals ?? 0) : (match.homeGoals ?? 0);

const isWin = (match: InternationalMatch, teamId: EntityId): boolean =>
  match.winnerTeamProfileId === teamId || goalsFor(match, teamId) > goalsAgainst(match, teamId);

const isMajorUpset = (
  repo: InternationalFootballRepository,
  match: InternationalMatch,
  teamId: EntityId,
): boolean => {
  if (!isWin(match, teamId)) return false;
  const opponent = repo.teamProfile(opponentId(match, teamId));
  const nepal = repo.teamProfile(teamId);
  return Boolean(opponent && nepal && opponent.simulationStrength - nepal.simulationStrength > 18);
};

const biggestMargin = (
  matches: InternationalMatch[],
  teamId: EntityId,
  win: boolean,
): InternationalMatch | undefined =>
  matches
    .filter((match) =>
      win ? isWin(match, teamId) : !isWin(match, teamId) && match.homeGoals !== match.awayGoals,
    )
    .sort(
      (a, b) =>
        Math.abs(goalsFor(b, teamId) - goalsAgainst(b, teamId)) -
        Math.abs(goalsFor(a, teamId) - goalsAgainst(a, teamId)),
    )[0];

const longestUnbeatenRun = (matches: InternationalMatch[], teamId: EntityId): number => {
  let current = 0;
  let best = 0;
  for (const match of matches.sort((a, b) => a.matchDate.localeCompare(b.matchDate))) {
    if (isWin(match, teamId) || match.homeGoals === match.awayGoals) {
      current += 1;
      best = Math.max(best, current);
    } else current = 0;
  }
  return best;
};

const syntheticTeamId = (profile: InternationalTeamProfile): EntityId =>
  createStableEntityId("team", `external:${profile.id}`);

const shuffle = <T>(items: T[], rng: SeededRandom): T[] => {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = rng.integer(0, index);
    [items[index], items[other]] = [items[other]!, items[index]!];
  }
  return items;
};

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const round = (value: number): number => Math.round(value * 100) / 100;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const required = <T>(value: T | undefined, label: string): T => {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
};
