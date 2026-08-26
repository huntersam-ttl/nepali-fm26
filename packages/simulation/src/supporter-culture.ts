import {
  createStableEntityId,
  type AttendanceDemandBreakdown,
  type ClubRivalry,
  type EntityId,
  type MatchAtmosphere,
  type NationalTeamSupporterState,
  type RivalryOrigin,
  type SupporterAffinityBand,
  type SupporterCultureProfile,
  type SupporterEvent,
  type SupporterEventType,
  type SupporterLegendTier,
  type SupporterPlayerAffinity,
  type SupporterReadModel,
  type SupporterUnrestState,
} from "@nepal-football-sim/shared-types";
import {
  ClubEconomyRepository,
  MacroEconomyRepository,
  SupporterCultureRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { SeededRandom } from "./rng.js";

/*
 * Supporter world, club culture, attendance, rivalries and fan sentiment.
 *
 * Everything below is deterministic: progression depends only on persisted
 * state plus the world seed, never on wall-clock time or unseeded randomness.
 * The module owns no money, no reputation and no media text - it produces
 * bounded supporter state plus contextual inputs that the existing finance,
 * commercial, media and board systems consume.
 */

const round2 = (value: number): number => Math.round(value * 100) / 100;
/** Every bounded supporter dimension lives on the same 0..100 scale. */
export const clampSupporterScore = (value: number): number =>
  Number.isFinite(value) ? round2(Math.max(0, Math.min(100, value))) : 0;
const count = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
const clampRange = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? round2(Math.max(min, Math.min(max, value))) : min;
/** No single event may redefine a supporter base; per-update deltas are capped. */
const limitedDelta = (delta: number, limit: number): number =>
  Math.max(-limit, Math.min(limit, Number.isFinite(delta) ? delta : 0));

const MAX_MOOD_STEP = 9;
const MAX_TRUST_STEP = 6;
const MAX_APPROVAL_STEP = 7;
const MAX_SEASON_BASE_GROWTH = 0.14;
const MAX_SEASON_BASE_DECLINE = 0.12;

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

export type SupporterCultureInitInput = {
  clubId: EntityId;
  gender?: "men" | "women";
  teamId?: EntityId;
  /** 1 = A Division, 2 = B Division, 3 = C Division and below. */
  tier: number;
  locationId?: EntityId;
  seed: string;
  date: string;
  /** Existing club football reputation, 0..10. */
  reputation?: number;
  /** Existing commercial reputation, 0..10. */
  commercialReputation?: number;
  /** Bounded 0..100 stature drawn from existing club history. */
  historicStature?: number;
  /** Bounded 0..100 local population context from geography. */
  populationContext?: number;
  /** Existing generated supporter counts, when the economy layer produced them. */
  existingSupport?: {
    coreSupporters: number;
    casualSupporters: number;
    regionalSupport: number;
    diasporaSupport: number;
    activeSupport: number;
    familySupport: number;
    youthSupport: number;
  };
};

/**
 * Builds the persistent profile. Sizes come from club stature, tier and
 * geography - never from stadium capacity, which is a seating constraint and
 * not a measure of how many people support a club.
 */
export const initialSupporterCultureProfile = (
  input: SupporterCultureInitInput,
): SupporterCultureProfile => {
  const gender = input.gender ?? "men";
  const tier = Math.max(1, Math.min(4, Math.round(input.tier)));
  const rng = new SeededRandom(`supporter-culture:${input.seed}:${input.clubId}:${gender}`);
  const reputation = clampRange(input.reputation ?? 4, 0, 10);
  const stature = clampSupporterScore(input.historicStature ?? reputation * 8);
  const population = clampSupporterScore(input.populationContext ?? 45);
  const tierScale = tier === 1 ? 1 : tier === 2 ? 0.42 : tier === 3 ? 0.18 : 0.08;
  /* Women's football support develops on its own pathway rather than
   * inheriting the men's fanbase. */
  const genderScale = gender === "women" ? 0.16 + (population / 100) * 0.1 : 1;

  const core =
    input.existingSupport?.coreSupporters !== undefined
      ? count(input.existingSupport.coreSupporters * tierScale * genderScale)
      : count(
          (450 + reputation * 260 + population * 12 + rng.next() * 500) * tierScale * genderScale,
        );
  const casual =
    input.existingSupport?.casualSupporters !== undefined
      ? count(input.existingSupport.casualSupporters * tierScale * genderScale)
      : count(core * (1.7 + rng.next() * 1.6));
  const regional = count(input.existingSupport?.regionalSupport ?? core * (0.5 + rng.next() * 1.1));
  const diaspora = count(
    (input.existingSupport?.diasporaSupport ?? core * rng.next() * 0.3) * genderScale,
  );

  const localIdentity = clampSupporterScore(
    48 + population * 0.22 + (tier >= 2 ? 12 : 0) + rng.next() * 10,
  );
  const matchgoingCulture = clampSupporterScore(
    34 + reputation * 3.2 + population * 0.12 + rng.next() * 12,
  );
  const loyalty = clampSupporterScore(46 + localIdentity * 0.22 + rng.next() * 14);
  const passion = clampSupporterScore(
    44 + reputation * 2.4 + localIdentity * 0.16 + rng.next() * 12,
  );

  const potentialReach = count((core + casual + regional + diaspora) * (2.2 + population / 60));
  const activeFanbase = count(core + casual * 0.55);
  const matchgoingBase = count(activeFanbase * (matchgoingCulture / 100) * 0.55);
  const seasonTicketBase = count(matchgoingBase * (loyalty / 100) * 0.3);

  return {
    clubId: input.clubId,
    gender,
    teamId: input.teamId,
    tier,
    locationId: input.locationId,
    localIdentity,
    nationalReach: clampSupporterScore(
      12 + reputation * 5 + (tier === 1 ? 14 : 0) + rng.next() * 8,
    ),
    loyalty,
    passion,
    patience: clampSupporterScore(64 - reputation * 2.2 + rng.next() * 14),
    volatility: clampSupporterScore(30 + passion * 0.24 + rng.next() * 14),
    matchgoingCulture,
    awaySupport: clampSupporterScore(18 + passion * 0.2 + (tier === 1 ? 10 : 0) + rng.next() * 10),
    youthInterest: clampSupporterScore(38 + population * 0.16 + rng.next() * 14),
    familyAttendance: clampSupporterScore(30 + population * 0.14 + rng.next() * 12),
    commercialEngagement: clampSupporterScore(
      14 + clampRange(input.commercialReputation ?? reputation * 0.8, 0, 10) * 4.5 + rng.next() * 8,
    ),
    socialReach: clampSupporterScore(
      10 + reputation * 4 + (diaspora > 0 ? 8 : 0) + rng.next() * 10,
    ),
    potentialReach,
    activeFanbase,
    matchgoingBase,
    seasonTicketBase,
    casualAudience: count(casual + regional * 0.4),
    expectations: expectationsForContext({
      tier,
      reputation,
      historicStature: stature,
      previousFinishShare: 0.5,
      boardAmbition: 50,
      squadStrength: reputation * 10,
      financialHealth: 50,
    }),
    optimism: 55,
    currentMood: 55,
    baselineMood: 55,
    trustInOwnership: clampSupporterScore(52 + rng.next() * 12),
    trustInManager: 55,
    unrest: "CONTENT",
    lastEvaluatedOn: input.date,
    provenanceStatus: "SIMULATION_ONLY",
  };
};

/**
 * Contextual expectations. A promoted C-to-B club is judged on consolidation;
 * a historically strong A Division club is judged far more harshly.
 */
export const expectationsForContext = (input: {
  tier: number;
  reputation: number;
  historicStature: number;
  /** 0 = champions, 1 = bottom of the table, from the previous season. */
  previousFinishShare: number;
  boardAmbition: number;
  squadStrength: number;
  financialHealth: number;
  justPromoted?: boolean;
  justRelegated?: boolean;
}): number => {
  const tierBase = input.tier === 1 ? 52 : input.tier === 2 ? 44 : 36;
  const raw =
    tierBase +
    clampRange(input.reputation, 0, 10) * 2.2 +
    clampSupporterScore(input.historicStature) * 0.16 +
    (0.5 - clampRange(input.previousFinishShare, 0, 1)) * 22 +
    (clampSupporterScore(input.boardAmbition) - 50) * 0.16 +
    (clampSupporterScore(input.squadStrength) - 50) * 0.14 +
    (clampSupporterScore(input.financialHealth) - 50) * 0.06 +
    (input.justPromoted ? -12 : 0) +
    (input.justRelegated ? -6 : 0);
  return clampSupporterScore(raw);
};

// ---------------------------------------------------------------------------
// Attendance demand
// ---------------------------------------------------------------------------

export type AttendanceDemandInput = {
  /** Home club's regular match-going base. */
  matchgoingBase: number;
  seasonTicketBase: number;
  passion: number;
  loyalty: number;
  matchgoingCulture: number;
  familyAttendance: number;
  homeMood: number;
  /** Points from the last five league matches, 0..15. */
  recentFormPoints?: number;
  /** 0 = league leaders, 1 = bottom. */
  leaguePositionShare?: number;
  /** Away club figures. */
  awayMatchgoingBase?: number;
  awaySupport?: number;
  /** Opponent football reputation, 0..10. */
  opponentReputation?: number;
  rivalryIntensity?: number;
  /** Title/promotion/relegation stakes, 0..100. */
  stakes?: number;
  /** Competition importance, 0..100. */
  competitionImportance?: number;
  /** Historic significance/novelty of the fixture, 0..100. */
  novelty?: number;
  leagueReputation?: number;
  ticketPrice: number;
  referenceTicketPrice?: number;
  /** Macroeconomic affordability: 1 = neutral, >1 = harder to afford. */
  affordabilityIndex?: number;
  travelDistanceKm?: number;
  /** Share of capacity reserved for away supporters, 0..1. */
  awayAllocationShare?: number;
  /** 0 = no weather suppression, 1 = severe. */
  weatherPenalty?: number;
  capacity: number;
  /** Optional seed for a small bounded, reproducible fixture variation. */
  seed?: string;
};

/**
 * Supporter-aware attendance demand. Every modifier is individually bounded so
 * the product cannot explode, and the result is always capped by the venue.
 */
export const computeAttendanceDemand = (
  input: AttendanceDemandInput,
): AttendanceDemandBreakdown => {
  const capacity = Math.max(0, Math.round(input.capacity));
  const matchgoingBase = count(input.matchgoingBase);
  const seasonTickets = Math.min(count(input.seasonTicketBase), matchgoingBase);

  const cultureLift =
    0.68 +
    (clampSupporterScore(input.matchgoingCulture) / 100) * 0.32 +
    (clampSupporterScore(input.passion) / 100) * 0.18 +
    (clampSupporterScore(input.loyalty) / 100) * 0.1 +
    (clampSupporterScore(input.familyAttendance) / 100) * 0.06;
  const baselineLocalDemand = round2(matchgoingBase * cultureLift);

  const formModifier = clampRange(0.9 + ((input.recentFormPoints ?? 7.5) / 15) * 0.24, 0.86, 1.16);
  const positionModifier = clampRange(
    1.1 - clampRange(input.leaguePositionShare ?? 0.5, 0, 1) * 0.22,
    0.86,
    1.12,
  );
  const opponentModifier = clampRange(
    0.94 + clampRange(input.opponentReputation ?? 5, 0, 10) * 0.018,
    0.94,
    1.14,
  );
  const rivalryModifier = clampRange(
    1 + (clampSupporterScore(input.rivalryIntensity ?? 0) / 100) * 0.32,
    1,
    1.32,
  );
  const stakesModifier = clampRange(
    1 + (clampSupporterScore(input.stakes ?? 0) / 100) * 0.2,
    1,
    1.2,
  );
  const competitionModifier = clampRange(
    0.9 + (clampSupporterScore(input.competitionImportance ?? 50) / 100) * 0.28,
    0.9,
    1.18,
  );
  const noveltyModifier = clampRange(
    1 + (clampSupporterScore(input.novelty ?? 0) / 100) * 0.1,
    1,
    1.1,
  );
  const leagueModifier = clampRange(
    0.94 + clampRange(input.leagueReputation ?? 5, 0, 10) * 0.012,
    0.94,
    1.06,
  );
  const moodModifier = clampRange(
    0.82 + (clampSupporterScore(input.homeMood) / 100) * 0.32,
    0.82,
    1.14,
  );
  const weatherModifier = clampRange(
    1 - clampRange(input.weatherPenalty ?? 0, 0, 1) * 0.25,
    0.75,
    1,
  );

  const reference = Math.max(1, input.referenceTicketPrice ?? 250);
  const affordability = clampRange(input.affordabilityIndex ?? 1, 0.5, 2.5);
  const effectivePrice = Math.max(1, input.ticketPrice) * affordability;
  const priceAffordabilityModifier = clampRange(
    Math.pow(reference / effectivePrice, 0.35),
    0.6,
    1.2,
  );
  const macroModifier = clampRange(1 - (affordability - 1) * 0.12, 0.82, 1.06);

  const jitter = input.seed
    ? clampRange(
        0.97 + new SeededRandom(`supporter-attendance:${input.seed}`).next() * 0.06,
        0.97,
        1.03,
      )
    : 1;

  const homeDemand = round2(
    baselineLocalDemand *
      formModifier *
      positionModifier *
      opponentModifier *
      rivalryModifier *
      stakesModifier *
      competitionModifier *
      noveltyModifier *
      leagueModifier *
      moodModifier *
      priceAffordabilityModifier *
      macroModifier *
      weatherModifier *
      jitter,
  );

  /* Away demand is a genuinely different, much smaller market: most Nepal
   * lower-league fixtures travel with almost nobody. */
  const travelKm = Math.max(0, input.travelDistanceKm ?? 120);
  const travelModifier = clampRange(1 / (1 + travelKm / 220), 0.15, 1);
  const awayDemand = round2(
    count(input.awayMatchgoingBase ?? 0) *
      (clampSupporterScore(input.awaySupport ?? 20) / 100) *
      0.45 *
      travelModifier *
      rivalryModifier *
      stakesModifier *
      competitionModifier *
      macroModifier *
      clampRange(priceAffordabilityModifier, 0.6, 1.1),
  );

  const awayAllocation = Math.floor(
    capacity * clampRange(input.awayAllocationShare ?? 0.12, 0, 0.4),
  );
  const awayAttendance = Math.min(Math.round(awayDemand), awayAllocation);
  const homeAttendance = Math.min(
    Math.round(Math.max(homeDemand, seasonTickets * 0.85)),
    Math.max(0, capacity - awayAttendance),
  );
  const rawDemand = round2(homeDemand + awayDemand);
  const attendance = Math.max(0, homeAttendance + awayAttendance);

  return {
    baselineLocalDemand,
    formModifier,
    positionModifier,
    opponentModifier,
    rivalryModifier,
    stakesModifier,
    competitionModifier,
    priceAffordabilityModifier,
    moodModifier,
    weatherModifier,
    macroModifier,
    homeDemand,
    awayDemand,
    awayAllocation,
    rawDemand,
    capacity,
    homeAttendance,
    awayAttendance,
    attendance,
    cappedByCapacity: rawDemand > capacity,
  };
};

/**
 * Bounded atmosphere. The match engine stays authoritative: these outputs are
 * context (pressure, media significance), never a stat buff.
 */
export const computeMatchAtmosphere = (input: {
  attendance: number;
  capacity: number;
  passion: number;
  rivalryIntensity?: number;
  stakes?: number;
  momentum?: number;
  awayAttendance?: number;
}): MatchAtmosphere => {
  const capacity = Math.max(1, Math.round(input.capacity));
  const attendance = Math.max(0, Math.min(capacity, Math.round(input.attendance)));
  const occupancy = round2(attendance / capacity);
  const awayShare = clampRange((input.awayAttendance ?? 0) / Math.max(1, attendance), 0, 0.5);
  const rivalryIntensity = clampSupporterScore(input.rivalryIntensity ?? 0);
  const atmosphere = clampSupporterScore(
    occupancy * 46 +
      (clampSupporterScore(input.passion) / 100) * 22 +
      (rivalryIntensity / 100) * 16 +
      (clampSupporterScore(input.stakes ?? 0) / 100) * 10 +
      (clampSupporterScore(input.momentum ?? 50) / 100) * 6 +
      awayShare * 12 +
      Math.min(6, Math.log10(attendance + 1) * 2),
  );
  return {
    attendance,
    capacity,
    occupancy,
    atmosphere,
    /* Deliberately small: context for existing pressure models only. */
    homePressure: clampRange(atmosphere * 0.06, 0, 6),
    refereePressure: clampRange(atmosphere * 0.04 + rivalryIntensity * 0.01, 0, 5),
    mediaSignificance: clampSupporterScore(
      atmosphere * 0.5 + rivalryIntensity * 0.35 + (input.stakes ?? 0) * 0.2,
    ),
    rivalryIntensity,
  };
};

// ---------------------------------------------------------------------------
// Mood, trust and approval
// ---------------------------------------------------------------------------

export type SupporterMoodInput = {
  /** Positive when the club outperformed supporter expectations. */
  performanceVsExpectation: number;
  derbyResult?: -1 | 0 | 1;
  trophy?: boolean;
  promotion?: boolean;
  relegation?: boolean;
  youthBreakthrough?: boolean;
  respectedSignings?: number;
  facilityImprovement?: boolean;
  brokenPromise?: boolean;
  financialInstability?: boolean;
  soldKeyPlayerUnreplaced?: boolean;
  objectiveFailed?: boolean;
};

/**
 * Supporter mood evolves from real events and always regresses toward the
 * longer-term baseline, so no single match can permanently redefine sentiment.
 */
export const nextSupporterMood = (
  profile: SupporterCultureProfile,
  input: SupporterMoodInput,
): { currentMood: number; baselineMood: number; optimism: number; moodDelta: number } => {
  const reactivity = 0.6 + (clampSupporterScore(profile.volatility) / 100) * 0.8;
  const tolerance = 1 - (clampSupporterScore(profile.patience) / 100) * 0.35;
  const raw =
    clampRange(input.performanceVsExpectation, -40, 40) * 0.16 +
    (input.derbyResult ?? 0) * 4.5 +
    (input.trophy ? 9 : 0) +
    (input.promotion ? 8 : 0) +
    (input.relegation ? -10 : 0) +
    (input.youthBreakthrough ? 2 : 0) +
    (input.respectedSignings ?? 0) * 1.5 +
    (input.facilityImprovement ? 2 : 0) +
    (input.brokenPromise ? -5 : 0) +
    (input.financialInstability ? -6 : 0) +
    (input.soldKeyPlayerUnreplaced ? -5 : 0) +
    (input.objectiveFailed ? -6 : 0);
  const eventDelta = limitedDelta(raw * reactivity * tolerance, MAX_MOOD_STEP);
  /* Regression toward the baseline keeps long runs from drifting to an
   * extreme and makes recovery gradual rather than instant. */
  const pull = (profile.baselineMood - profile.currentMood) * 0.12;
  const currentMood = clampSupporterScore(profile.currentMood + eventDelta + pull);
  const baselineMood = clampSupporterScore(
    profile.baselineMood + (currentMood - profile.baselineMood) * 0.06,
  );
  const optimism = clampSupporterScore(profile.optimism + limitedDelta(eventDelta * 0.6, 5));
  return {
    currentMood,
    baselineMood,
    optimism,
    moodDelta: round2(currentMood - profile.currentMood),
  };
};

/**
 * Supporter attitude toward the manager, tracked separately from board
 * confidence. It never sacks anyone: it is contextual pressure only.
 */
export const nextManagerApproval = (
  profile: SupporterCultureProfile,
  input: {
    performanceVsExpectation: number;
    derbyResult?: -1 | 0 | 1;
    trophy?: boolean;
    youthUsage?: number;
    soldFanFavourite?: boolean;
    importantSignings?: number;
    tenureDays?: number;
    managerReputation?: number;
    priorSuccess?: number;
  },
): number => {
  const tenureBuffer = Math.min(6, (input.tenureDays ?? 0) / 220);
  const raw =
    clampRange(input.performanceVsExpectation, -40, 40) * 0.2 +
    (input.derbyResult ?? 0) * 4 +
    (input.trophy ? 8 : 0) +
    clampRange(input.youthUsage ?? 0, 0, 100) * 0.02 +
    (input.soldFanFavourite ? -5 : 0) +
    (input.importantSignings ?? 0) * 1.2 +
    clampRange(input.managerReputation ?? 0, 0, 100) * 0.01 +
    clampRange(input.priorSuccess ?? 0, 0, 100) * 0.01;
  const buffered = raw >= 0 ? raw : raw + Math.min(tenureBuffer, -raw * 0.4);
  return clampSupporterScore(profile.trustInManager + limitedDelta(buffered, MAX_APPROVAL_STEP));
};

export const nextOwnershipTrust = (
  profile: SupporterCultureProfile,
  input: {
    squadInvestment?: number;
    facilityInvestment?: number;
    ticketPriceChangeShare?: number;
    financialStability?: number;
    clubPerformance?: number;
    promisesKept?: number;
    promisesBroken?: number;
    repeatedMajorSales?: number;
    identityDecisionImpact?: number;
  },
): number => {
  const raw =
    clampRange(input.squadInvestment ?? 0, -20, 20) * 0.2 +
    clampRange(input.facilityInvestment ?? 0, 0, 20) * 0.2 +
    -clampRange(input.ticketPriceChangeShare ?? 0, -1, 2) * 8 +
    (clampRange(input.financialStability ?? 50, 0, 100) - 50) * 0.06 +
    (clampRange(input.clubPerformance ?? 50, 0, 100) - 50) * 0.05 +
    (input.promisesKept ?? 0) * 2.5 +
    (input.promisesBroken ?? 0) * -4 +
    (input.repeatedMajorSales ?? 0) * -2.5 +
    clampRange(input.identityDecisionImpact ?? 0, -10, 10);
  return clampSupporterScore(profile.trustInOwnership + limitedDelta(raw, MAX_TRUST_STEP));
};

/**
 * Unrest is derived from sustained conditions - the gap between current mood
 * and the slow-moving baseline plus ownership distrust - never from one result.
 */
export const supporterUnrestState = (profile: SupporterCultureProfile): SupporterUnrestState => {
  const mood = clampSupporterScore(profile.currentMood);
  const trust = clampSupporterScore(profile.trustInOwnership);
  const sustained = mood < profile.baselineMood - 4;
  const score = mood * 0.6 + trust * 0.4;
  if (score >= 55) return "CONTENT";
  if (score >= 44) return "CONCERNED";
  if (score >= 32) return sustained ? "FRUSTRATED" : "CONCERNED";
  if (score >= 20) return sustained ? "ANGRY" : "FRUSTRATED";
  return sustained && trust < 25 ? "PROTESTING" : "ANGRY";
};

// ---------------------------------------------------------------------------
// Rivalries
// ---------------------------------------------------------------------------

export const createRivalry = (input: {
  clubId: EntityId;
  rivalClubId: EntityId;
  origin: RivalryOrigin;
  historicBaseline?: number;
  date: string;
}): ClubRivalry => ({
  id: createStableEntityId("club-rivalry", `${input.clubId}:${input.rivalClubId}`),
  clubId: input.clubId,
  rivalClubId: input.rivalClubId,
  origin: input.origin,
  intensity: clampSupporterScore(input.historicBaseline ?? 20),
  historicBaseline: clampSupporterScore(input.historicBaseline ?? 20),
  meetings: 0,
  history: [
    {
      date: input.date,
      event: `Rivalry recognised (${input.origin})`,
      intensity: clampSupporterScore(input.historicBaseline ?? 20),
    },
  ],
  provenanceStatus: "SIMULATION_ONLY",
});

export type RivalryEventInput = {
  date: string;
  /** Meaningful shared context: title race, promotion battle, cup final. */
  titleBattle?: boolean;
  promotionBattle?: boolean;
  relegationBattle?: boolean;
  cupFinal?: boolean;
  controversialMatch?: boolean;
  /** Months since the clubs last met, for decay when they stop meeting. */
  monthsSinceLastMeeting?: number;
  met?: boolean;
};

/**
 * Intensity rises only from repeated meaningful events, decays slowly when the
 * clubs stop meeting, and never falls below the historic baseline for genuine
 * longstanding rivalries.
 */
export const nextRivalryIntensity = (
  rivalry: ClubRivalry,
  input: RivalryEventInput,
): ClubRivalry => {
  const met = input.met ?? true;
  const rise = met
    ? 1.2 +
      (input.titleBattle ? 2.6 : 0) +
      (input.promotionBattle ? 2 : 0) +
      (input.relegationBattle ? 1.4 : 0) +
      (input.cupFinal ? 3 : 0) +
      (input.controversialMatch ? 2.2 : 0)
    : 0;
  const decay = met ? 0 : Math.min(4, 0.35 * Math.max(0, input.monthsSinceLastMeeting ?? 1));
  /* A single random fixture can move intensity by only a couple of points. */
  const intensity = Math.max(
    rivalry.historicBaseline,
    clampSupporterScore(rivalry.intensity + limitedDelta(rise - decay, 4)),
  );
  const milestone = met && intensity - rivalry.intensity >= 3;
  return {
    ...rivalry,
    intensity,
    meetings: rivalry.meetings + (met ? 1 : 0),
    lastMeetingOn: met ? input.date : rivalry.lastMeetingOn,
    historicBaseline: clampSupporterScore(Math.max(rivalry.historicBaseline, intensity * 0.55)),
    history: milestone
      ? [...rivalry.history, { date: input.date, event: "Rivalry intensified", intensity }].slice(
          -40,
        )
      : rivalry.history,
  };
};

// ---------------------------------------------------------------------------
// Structural supporter events
// ---------------------------------------------------------------------------

export const buildSupporterEvent = (input: {
  clubId: EntityId;
  gender: "men" | "women";
  date: string;
  type: SupporterEventType;
  magnitude: number;
  moodDelta: number;
  summary: string;
  subjectIds?: EntityId[];
  key?: string;
}): SupporterEvent => ({
  id: createStableEntityId(
    "supporter-event",
    `${input.clubId}:${input.gender}:${input.date}:${input.type}:${input.key ?? ""}`,
  ),
  clubId: input.clubId,
  gender: input.gender,
  date: input.date,
  type: input.type,
  magnitude: clampSupporterScore(input.magnitude),
  moodDelta: round2(input.moodDelta),
  summary: input.summary,
  subjectIds: input.subjectIds ?? [],
  provenanceStatus: "SIMULATION_ONLY",
});

/** Promotion lifts interest over several seasons rather than all at once. */
export const applyPromotionEffect = (
  profile: SupporterCultureProfile,
  input: { newTier: number; date: string },
): SupporterCultureProfile => {
  const lift = input.newTier === 1 ? 0.1 : 0.075;
  return {
    ...profile,
    tier: Math.max(1, Math.round(input.newTier)),
    optimism: clampSupporterScore(profile.optimism + 8),
    currentMood: clampSupporterScore(profile.currentMood + 7),
    baselineMood: clampSupporterScore(profile.baselineMood + 3),
    expectations: clampSupporterScore(profile.expectations + 5),
    casualAudience: count(profile.casualAudience * (1 + lift * 1.4)),
    activeFanbase: count(profile.activeFanbase * (1 + lift)),
    matchgoingBase: count(profile.matchgoingBase * (1 + lift * 0.8)),
    potentialReach: count(profile.potentialReach * (1 + lift * 0.6)),
    commercialEngagement: clampSupporterScore(profile.commercialEngagement + 4),
    nationalReach: clampSupporterScore(profile.nationalReach + 4),
    lastEvaluatedOn: input.date,
  };
};

/** Casual interest falls away far faster than the loyal core. */
export const applyRelegationEffect = (
  profile: SupporterCultureProfile,
  input: { newTier: number; date: string },
): SupporterCultureProfile => {
  const loyaltyShield = 1 - (clampSupporterScore(profile.loyalty) / 100) * 0.55;
  return {
    ...profile,
    tier: Math.max(1, Math.round(input.newTier)),
    optimism: clampSupporterScore(profile.optimism - 10),
    currentMood: clampSupporterScore(profile.currentMood - 9),
    baselineMood: clampSupporterScore(profile.baselineMood - 4),
    expectations: clampSupporterScore(profile.expectations - 8),
    casualAudience: count(profile.casualAudience * (1 - 0.16 * loyaltyShield)),
    activeFanbase: count(profile.activeFanbase * (1 - 0.09 * loyaltyShield)),
    matchgoingBase: count(profile.matchgoingBase * (1 - 0.07 * loyaltyShield)),
    seasonTicketBase: count(profile.seasonTicketBase * (1 - 0.05 * loyaltyShield)),
    commercialEngagement: clampSupporterScore(profile.commercialEngagement - 5),
    lastEvaluatedOn: input.date,
  };
};

/** Trophy effect scales with how unexpected the success was. */
export const applyTrophyEffect = (
  profile: SupporterCultureProfile,
  input: { competitionImportance: number; expectedShare?: number; date: string },
): SupporterCultureProfile => {
  const importance = clampSupporterScore(input.competitionImportance) / 100;
  const surprise = 1 - clampRange(input.expectedShare ?? 0.5, 0, 1) * 0.5;
  const lift = 0.03 + importance * 0.05 * surprise;
  return {
    ...profile,
    optimism: clampSupporterScore(profile.optimism + 10 * importance),
    currentMood: clampSupporterScore(profile.currentMood + 9 * importance),
    baselineMood: clampSupporterScore(profile.baselineMood + 3 * importance),
    expectations: clampSupporterScore(profile.expectations + 6 * importance),
    activeFanbase: count(profile.activeFanbase * (1 + lift)),
    casualAudience: count(profile.casualAudience * (1 + lift * 1.5)),
    nationalReach: clampSupporterScore(profile.nationalReach + 5 * importance),
    commercialEngagement: clampSupporterScore(profile.commercialEngagement + 4 * importance),
    lastEvaluatedOn: input.date,
  };
};

/**
 * Star signings create short-term excitement, not a permanently larger club.
 * The casual bump decays through the normal monthly normalisation unless
 * results follow.
 */
export const applyStarSigningEffect = (
  profile: SupporterCultureProfile,
  input: { playerReputation: number; transferValueShareOfClub?: number; date: string },
): SupporterCultureProfile => {
  const impact = clampRange(input.playerReputation, 0, 100) / 100;
  const scale = impact * (0.6 + clampRange(input.transferValueShareOfClub ?? 0.2, 0, 1) * 0.4);
  return {
    ...profile,
    optimism: clampSupporterScore(profile.optimism + 6 * scale),
    currentMood: clampSupporterScore(profile.currentMood + 4 * scale),
    expectations: clampSupporterScore(profile.expectations + 4 * scale),
    casualAudience: count(profile.casualAudience * (1 + 0.03 * scale)),
    socialReach: clampSupporterScore(profile.socialReach + 4 * scale),
    commercialEngagement: clampSupporterScore(profile.commercialEngagement + 2 * scale),
    lastEvaluatedOn: input.date,
  };
};

/**
 * Selling a popular player. A strong fee taken while the club is in financial
 * distress reads very differently from selling cheaply for no reason.
 */
export const applyPlayerSaleEffect = (
  profile: SupporterCultureProfile,
  input: {
    playerAffinity: number;
    feeQuality: number;
    financialDistress?: number;
    replacementQuality?: number;
    playerWantedToLeave?: boolean;
    date: string;
  },
): SupporterCultureProfile => {
  const affinity = clampSupporterScore(input.playerAffinity) / 100;
  const mitigation =
    (clampRange(input.feeQuality, 0, 100) / 100) * 0.45 +
    (clampRange(input.financialDistress ?? 0, 0, 100) / 100) * 0.3 +
    (clampRange(input.replacementQuality ?? 0, 0, 100) / 100) * 0.3 +
    (input.playerWantedToLeave ? 0.25 : 0);
  const damage = clampRange(affinity * 9 * (1 - Math.min(0.9, mitigation)), 0, 9);
  return {
    ...profile,
    currentMood: clampSupporterScore(profile.currentMood - damage),
    optimism: clampSupporterScore(profile.optimism - damage * 0.7),
    trustInOwnership: clampSupporterScore(profile.trustInOwnership - damage * 0.5),
    trustInManager: clampSupporterScore(profile.trustInManager - damage * 0.3),
    lastEvaluatedOn: input.date,
  };
};

// ---------------------------------------------------------------------------
// Player affinity and legend hooks
// ---------------------------------------------------------------------------

export const supporterAffinityBand = (affinity: number): SupporterAffinityBand => {
  const value = clampSupporterScore(affinity);
  if (value >= 78) return "FAN_FAVOURITE";
  if (value >= 58) return "RESPECTED";
  if (value >= 32) return "NEUTRAL";
  return "UNPOPULAR";
};

/**
 * Hook into whatever module owns club history/legends: this only derives the
 * tier supporters would grant, from long-term service and achievement.
 */
export const supporterLegendTier = (input: {
  affinity: number;
  seasonsAtClub: number;
  appearances: number;
  trophies?: number;
  academyGraduate?: boolean;
}): SupporterLegendTier => {
  const affinity = clampSupporterScore(input.affinity);
  const service = input.seasonsAtClub + (input.academyGraduate ? 1 : 0);
  if (affinity >= 88 && service >= 8 && input.appearances >= 180) return "CLUB_LEGEND";
  if (affinity >= 80 && service >= 5 && input.appearances >= 100) return "CLUB_ICON";
  if (affinity >= 72 && input.appearances >= 40) return "CULT_HERO";
  return "NONE";
};

/** Notable-player threshold: obscure squad members carry no persisted affinity. */
export const isNotableForSupporters = (input: {
  appearances: number;
  goalContributions: number;
  captain?: boolean;
  academyGraduate?: boolean;
}): boolean =>
  input.appearances >= 20 ||
  input.goalContributions >= 8 ||
  input.captain === true ||
  (input.academyGraduate === true && input.appearances >= 10);

export const nextPlayerAffinity = (
  affinity: SupporterPlayerAffinity,
  input: {
    appearances?: number;
    goalContributions?: number;
    derbyContribution?: number;
    trophies?: number;
    captain?: boolean;
    loyaltyShown?: boolean;
    date: string;
  },
): SupporterPlayerAffinity => {
  const appearances = affinity.appearances + Math.max(0, input.appearances ?? 0);
  const goals = affinity.goalContributions + Math.max(0, input.goalContributions ?? 0);
  const raw =
    (input.appearances ?? 0) * 0.15 +
    (input.goalContributions ?? 0) * 1.2 +
    clampRange(input.derbyContribution ?? 0, 0, 10) * 1.4 +
    (input.trophies ?? 0) * 4 +
    (input.captain ? 1.5 : 0) +
    (input.loyaltyShown ? 2.5 : 0) +
    (affinity.academyGraduate ? 0.6 : 0) +
    (affinity.localBorn ? 0.4 : 0);
  const value = clampSupporterScore(affinity.affinity + limitedDelta(raw, 8));
  return {
    ...affinity,
    affinity: value,
    band: supporterAffinityBand(value),
    legendTier: supporterLegendTier({
      affinity: value,
      seasonsAtClub: affinity.seasonsAtClub,
      appearances,
      trophies: input.trophies,
      academyGraduate: affinity.academyGraduate,
    }),
    appearances,
    goalContributions: goals,
    lastEvaluatedOn: input.date,
  };
};

// ---------------------------------------------------------------------------
// Cadence: monthly normalisation and seasonal base evolution
// ---------------------------------------------------------------------------

/** Monthly sentiment normalisation. Cheap, aggregate, no per-fan entities. */
export const normalizeSupporterSentiment = (
  profile: SupporterCultureProfile,
  date: string,
): SupporterCultureProfile => {
  const currentMood = clampSupporterScore(
    profile.currentMood + (profile.baselineMood - profile.currentMood) * 0.18,
  );
  const optimism = clampSupporterScore(profile.optimism + (55 - profile.optimism) * 0.08);
  const next: SupporterCultureProfile = {
    ...profile,
    currentMood,
    optimism,
    trustInManager: clampSupporterScore(
      profile.trustInManager + (55 - profile.trustInManager) * 0.05,
    ),
    trustInOwnership: clampSupporterScore(
      profile.trustInOwnership + (55 - profile.trustInOwnership) * 0.03,
    ),
    lastEvaluatedOn: date,
  };
  return { ...next, unrest: supporterUnrestState(next) };
};

export type SupporterSeasonInput = {
  date: string;
  tier: number;
  /** 0 = champions, 1 = bottom. */
  finishShare: number;
  trophies?: number;
  promoted?: boolean;
  relegated?: boolean;
  continentalExposure?: number;
  starPlayers?: number;
  nationalTeamPlayers?: number;
  youthProduction?: number;
  facilityQuality?: number;
  reputation?: number;
  /** Macroeconomic affordability; >1 makes growth harder. */
  affordabilityIndex?: number;
  boardAmbition?: number;
  squadStrength?: number;
  financialHealth?: number;
  historicStature?: number;
};

/**
 * Seasonal supporter-base evolution. Growth and decline are both rate-limited,
 * so a small club can genuinely become large over decades of sustained success
 * without any single season multiplying its fanbase.
 */
export const evolveSupporterBaseSeason = (
  profile: SupporterCultureProfile,
  input: SupporterSeasonInput,
): SupporterCultureProfile => {
  const performance = (0.5 - clampRange(input.finishShare, 0, 1)) * 2;
  const macroDrag = (clampRange(input.affordabilityIndex ?? 1, 0.5, 2.5) - 1) * 0.03;
  const growth = clampRange(
    performance * 0.05 +
      (input.trophies ?? 0) * 0.03 +
      (input.promoted ? 0.05 : 0) +
      (input.relegated ? -0.06 : 0) +
      clampRange(input.continentalExposure ?? 0, 0, 100) * 0.0006 +
      clampRange(input.starPlayers ?? 0, 0, 10) * 0.004 +
      clampRange(input.nationalTeamPlayers ?? 0, 0, 15) * 0.003 +
      clampRange(input.youthProduction ?? 0, 0, 100) * 0.0003 +
      clampRange(input.facilityQuality ?? 0, 0, 100) * 0.0002 +
      (clampRange(input.reputation ?? 5, 0, 10) - 5) * 0.004 -
      macroDrag,
    -MAX_SEASON_BASE_DECLINE,
    MAX_SEASON_BASE_GROWTH,
  );

  /* Core/loyal identity is sticky in both directions; casual interest is the
   * volatile half of the fanbase. */
  const coreFactor = 1 + growth * 0.4;
  const casualFactor = 1 + growth * 1.35;
  const potentialFactor = 1 + growth * 0.3;

  const activeFanbase = count(Math.max(40, profile.activeFanbase * coreFactor));
  const casualAudience = count(Math.max(20, profile.casualAudience * casualFactor));
  const matchgoingBase = count(
    Math.max(25, Math.min(activeFanbase, profile.matchgoingBase * (1 + growth * 0.6))),
  );

  const next: SupporterCultureProfile = {
    ...profile,
    tier: Math.max(1, Math.round(input.tier)),
    potentialReach: count(
      Math.max(activeFanbase + casualAudience, profile.potentialReach * potentialFactor),
    ),
    activeFanbase,
    casualAudience,
    matchgoingBase,
    seasonTicketBase: count(
      Math.min(matchgoingBase, profile.seasonTicketBase * (1 + growth * 0.5)),
    ),
    nationalReach: clampSupporterScore(profile.nationalReach + growth * 40),
    socialReach: clampSupporterScore(profile.socialReach + growth * 45),
    commercialEngagement: clampSupporterScore(profile.commercialEngagement + growth * 35),
    matchgoingCulture: clampSupporterScore(profile.matchgoingCulture + growth * 18),
    youthInterest: clampSupporterScore(profile.youthInterest + growth * 22),
    loyalty: clampSupporterScore(profile.loyalty + growth * 6),
    expectations: expectationsForContext({
      tier: input.tier,
      reputation: input.reputation ?? 5,
      historicStature: input.historicStature ?? profile.nationalReach,
      previousFinishShare: input.finishShare,
      boardAmbition: input.boardAmbition ?? 50,
      squadStrength: input.squadStrength ?? 50,
      financialHealth: input.financialHealth ?? 50,
      justPromoted: input.promoted,
      justRelegated: input.relegated,
    }),
    lastEvaluatedOn: input.date,
  };
  return { ...next, unrest: supporterUnrestState(next) };
};

// ---------------------------------------------------------------------------
// Outputs consumed by existing engines
// ---------------------------------------------------------------------------

/**
 * Commercial input only. The commercial engine stays authoritative and decides
 * what, if anything, this is worth - this system never mints money.
 */
export const supporterCommercialEngagementIndex = (profile: SupporterCultureProfile): number =>
  clampRange(
    0.6 +
      (profile.activeFanbase / 20000) * 0.4 +
      (clampSupporterScore(profile.commercialEngagement) / 100) * 0.4 +
      (clampSupporterScore(profile.nationalReach) / 100) * 0.25 +
      (clampSupporterScore(profile.socialReach) / 100) * 0.15 +
      (clampSupporterScore(profile.currentMood) - 55) / 500,
    0.5,
    1.9,
  );

/**
 * One contextual factor for the existing board/chairman confidence model.
 * Deliberately small: finances and objectives remain authoritative.
 */
export const supporterBoardPressureModifier = (profile: SupporterCultureProfile): number => {
  const backing = (clampSupporterScore(profile.trustInManager) - 50) * 0.06;
  const unrestPenalty =
    profile.unrest === "PROTESTING"
      ? -4
      : profile.unrest === "ANGRY"
        ? -2.5
        : profile.unrest === "FRUSTRATED"
          ? -1.2
          : 0;
  return clampRange(backing + unrestPenalty, -6, 4);
};

/** Structured media context only - no article text is produced here. */
export const supporterMediaHooks = (
  profile: SupporterCultureProfile,
  events: readonly SupporterEvent[],
): Array<{
  clubId: EntityId;
  type: SupporterEventType;
  importance: number;
  date: string;
  summary: string;
  subjectIds: EntityId[];
}> =>
  events
    .filter((event) => event.magnitude >= 25)
    .map((event) => ({
      clubId: profile.clubId,
      type: event.type,
      importance: clampSupporterScore(event.magnitude * 0.7 + Math.abs(event.moodDelta) * 3),
      date: event.date,
      summary: event.summary,
      subjectIds: event.subjectIds,
    }));

// ---------------------------------------------------------------------------
// National team support
// ---------------------------------------------------------------------------

export const initialNationalTeamSupporterState = (input: {
  nationalTeamId: EntityId;
  gender?: "men" | "women";
  date: string;
  federationReputation?: number;
}): NationalTeamSupporterState => ({
  nationalTeamId: input.nationalTeamId,
  gender: input.gender ?? "men",
  support: clampSupporterScore(input.gender === "women" ? 34 : 58),
  mood: 55,
  expectations: clampSupporterScore(
    40 + clampRange(input.federationReputation ?? 40, 0, 100) * 0.2,
  ),
  mediaAttention: clampSupporterScore(input.gender === "women" ? 30 : 55),
  federationTrust: 50,
  rankingTrajectory: 50,
  lastEvaluatedOn: input.date,
  provenanceStatus: "SIMULATION_ONLY",
});

/**
 * National-team support is event driven: it spikes for qualification and big
 * opponents and fades between tournaments, unlike a club fanbase.
 */
export const nextNationalTeamSupporterState = (
  state: NationalTeamSupporterState,
  input: {
    date: string;
    recentResultScore?: number;
    qualified?: boolean;
    eliminated?: boolean;
    opponentSignificance?: number;
    rankingChange?: number;
    starPlayers?: number;
    federationReputationChange?: number;
    competitionImportance?: number;
  },
): NationalTeamSupporterState => {
  const importance = clampSupporterScore(input.competitionImportance ?? 50) / 100;
  const results = clampRange(input.recentResultScore ?? 0, -10, 10);
  const supportDelta = limitedDelta(
    results * 0.6 * (0.5 + importance) +
      (input.qualified ? 8 : 0) +
      (input.eliminated ? -5 : 0) +
      clampRange(input.starPlayers ?? 0, 0, 10) * 0.3 +
      clampRange(input.rankingChange ?? 0, -20, 20) * 0.15,
    8,
  );
  const support = clampSupporterScore(state.support + supportDelta - 0.4);
  const next: NationalTeamSupporterState = {
    ...state,
    support,
    mood: clampSupporterScore(
      state.mood +
        limitedDelta(results * 1.1 + (input.qualified ? 7 : 0) + (input.eliminated ? -7 : 0), 9),
    ),
    expectations: clampSupporterScore(state.expectations + limitedDelta(supportDelta * 0.4, 4)),
    mediaAttention: clampSupporterScore(
      state.mediaAttention * 0.9 +
        importance * 30 +
        clampSupporterScore(input.opponentSignificance ?? 40) * 0.15,
    ),
    federationTrust: clampSupporterScore(
      state.federationTrust +
        limitedDelta((input.federationReputationChange ?? 0) + results * 0.3, 5),
    ),
    rankingTrajectory: clampSupporterScore(
      state.rankingTrajectory + limitedDelta(input.rankingChange ?? 0, 8),
    ),
    lastEvaluatedOn: input.date,
  };
  return next;
};

/**
 * Light Phase A hook for district/province representative fixtures: local
 * interest for a one-off event, not a permanent professional fanbase.
 */
export const territorialEventInterest = (input: {
  districtDevelopmentReputation?: number;
  provinceStrength?: number;
  populationContext?: number;
  competitionImportance?: number;
  venueCapacity?: number;
}): { localInterest: number; expectedAttendance: number; scoutingVisibility: number } => {
  const localInterest = clampSupporterScore(
    18 +
      clampRange(input.districtDevelopmentReputation ?? 30, 0, 100) * 0.3 +
      clampRange(input.provinceStrength ?? 40, 0, 100) * 0.2 +
      clampRange(input.populationContext ?? 40, 0, 100) * 0.16 +
      clampRange(input.competitionImportance ?? 40, 0, 100) * 0.16,
  );
  const capacity = Math.max(0, Math.round(input.venueCapacity ?? 2000));
  return {
    localInterest,
    expectedAttendance: Math.min(capacity, Math.round(capacity * (localInterest / 100) * 0.7)),
    scoutingVisibility: clampSupporterScore(localInterest * 0.6),
  };
};

// ---------------------------------------------------------------------------
// Database-facing services
// ---------------------------------------------------------------------------

const tierForClub = (db: GameDatabase, clubId: EntityId): number => {
  const row = db
    .prepare(
      `SELECT c.name AS name FROM club_memberships m
       JOIN competition_seasons s ON s.id = m.competition_season_id
       JOIN competitions c ON c.id = s.competition_id
       WHERE m.club_id = ? ORDER BY c.name LIMIT 1`,
    )
    .get(clubId) as { name?: string } | undefined;
  const name = row?.name ?? "";
  if (name.includes("A-Division") || name.includes("A Division")) return 1;
  if (name.includes("B-Division") || name.includes("B Division")) return 2;
  return 3;
};

const clubLocationId = (db: GameDatabase, clubId: EntityId): EntityId | undefined =>
  (
    db.prepare("SELECT location_id FROM clubs WHERE id = ?").get(clubId) as
      { location_id?: EntityId } | undefined
  )?.location_id ?? undefined;

/** Road distance from the existing geography model, when it is populated. */
export const supporterTravelDistanceKm = (
  db: GameDatabase,
  fromLocationId?: EntityId,
  toLocationId?: EntityId,
): number | undefined => {
  if (!fromLocationId || !toLocationId) return undefined;
  if (fromLocationId === toLocationId) return 0;
  const row = db
    .prepare(
      `SELECT road_distance_km AS km FROM location_travel_contexts
       WHERE (from_location_id = ? AND to_location_id = ?) OR (from_location_id = ? AND to_location_id = ?)
       LIMIT 1`,
    )
    .get(fromLocationId, toLocationId, toLocationId, fromLocationId) as { km?: number } | undefined;
  return row?.km ?? undefined;
};

/**
 * Initialises supporter culture for every club that already has a generated
 * economy supporter profile. Idempotent: existing profiles are left alone so a
 * re-run never resets a live save.
 */
export const initializeSupporterCultureForSave = (input: {
  db: GameDatabase;
  worldDate: string;
  seed: string;
}): SupporterCultureProfile[] => {
  const repository = new SupporterCultureRepository(input.db);
  const economy = new ClubEconomyRepository(input.db);
  const created: SupporterCultureProfile[] = [];
  for (const support of economy.supporterProfiles()) {
    if (repository.profile(support.clubId, "men")) continue;
    const profile = initialSupporterCultureProfile({
      clubId: support.clubId,
      gender: "men",
      tier: tierForClub(input.db, support.clubId),
      locationId: clubLocationId(input.db, support.clubId),
      seed: input.seed,
      date: input.worldDate,
      reputation: support.footballReputation,
      commercialReputation: support.commercialReputation,
      historicStature: clampSupporterScore(support.clubPopularity * 9),
      populationContext: clampSupporterScore(40 + support.regionalSupport / 60),
      existingSupport: {
        coreSupporters: support.coreSupporters,
        casualSupporters: support.casualSupporters,
        regionalSupport: support.regionalSupport,
        diasporaSupport: support.diasporaSupport,
        activeSupport: support.activeSupport,
        familySupport: support.familySupport,
        youthSupport: support.youthSupport,
      },
    });
    repository.upsertProfile(profile);
    created.push(profile);
  }
  return created;
};

/**
 * Supporter-aware attendance for one fixture. Returns undefined when no
 * supporter culture profile exists, so callers can keep their previous
 * behaviour on saves that predate this system.
 */
export const supporterAttendanceForFixture = (input: {
  db: GameDatabase;
  homeClubId: EntityId;
  awayClubId: EntityId;
  capacity: number;
  ticketPrice: number;
  seed?: string;
  countryId?: EntityId;
  recentFormPoints?: number;
  leaguePositionShare?: number;
  opponentReputation?: number;
  stakes?: number;
  competitionImportance?: number;
  novelty?: number;
  weatherPenalty?: number;
  awayAllocationShare?: number;
}): AttendanceDemandBreakdown | undefined => {
  const repository = new SupporterCultureRepository(input.db);
  const home = repository.profile(input.homeClubId, "men");
  if (!home) return undefined;
  const away = repository.profile(input.awayClubId, "men");
  const rivalry = repository.rivalry(input.homeClubId, input.awayClubId);
  const macro = input.countryId
    ? new MacroEconomyRepository(input.db).state(input.countryId)
    : undefined;
  return computeAttendanceDemand({
    matchgoingBase: home.matchgoingBase,
    seasonTicketBase: home.seasonTicketBase,
    passion: home.passion,
    loyalty: home.loyalty,
    matchgoingCulture: home.matchgoingCulture,
    familyAttendance: home.familyAttendance,
    homeMood: home.currentMood,
    recentFormPoints: input.recentFormPoints,
    leaguePositionShare: input.leaguePositionShare,
    awayMatchgoingBase: away?.matchgoingBase ?? 0,
    awaySupport: away?.awaySupport ?? 15,
    opponentReputation: input.opponentReputation,
    rivalryIntensity: rivalry?.intensity ?? 0,
    stakes: input.stakes,
    competitionImportance: input.competitionImportance,
    novelty: input.novelty,
    ticketPrice: input.ticketPrice,
    affordabilityIndex: macro?.inflationIndex,
    travelDistanceKm: supporterTravelDistanceKm(
      input.db,
      clubLocationId(input.db, input.awayClubId),
      clubLocationId(input.db, input.homeClubId),
    ),
    awayAllocationShare: input.awayAllocationShare,
    weatherPenalty: input.weatherPenalty,
    capacity: input.capacity,
    seed: input.seed,
  });
};

/**
 * Per-match supporter consequences: mood, manager approval, rivalry intensity
 * and a structured event for the media/board hooks.
 */
export const applyMatchSupporterOutcome = (input: {
  db: GameDatabase;
  clubId: EntityId;
  gender?: "men" | "women";
  opponentClubId?: EntityId;
  date: string;
  performanceVsExpectation: number;
  derbyResult?: -1 | 0 | 1;
  rivalryEvent?: RivalryEventInput;
  attendance?: number;
  capacity?: number;
}): SupporterCultureProfile | undefined => {
  const repository = new SupporterCultureRepository(input.db);
  const gender = input.gender ?? "men";
  const profile = repository.profile(input.clubId, gender);
  if (!profile) return undefined;
  const mood = nextSupporterMood(profile, {
    performanceVsExpectation: input.performanceVsExpectation,
    derbyResult: input.derbyResult,
  });
  const updated: SupporterCultureProfile = {
    ...profile,
    currentMood: mood.currentMood,
    baselineMood: mood.baselineMood,
    optimism: mood.optimism,
    trustInManager: nextManagerApproval(profile, {
      performanceVsExpectation: input.performanceVsExpectation,
      derbyResult: input.derbyResult,
    }),
    lastEvaluatedOn: input.date,
  };
  const next = { ...updated, unrest: supporterUnrestState(updated) };
  repository.upsertProfile(next);

  if (input.opponentClubId && input.rivalryEvent) {
    const existing =
      repository.rivalry(input.clubId, input.opponentClubId) ??
      createRivalry({
        clubId: input.clubId,
        rivalClubId: input.opponentClubId,
        origin: input.rivalryEvent.titleBattle
          ? "TITLE_COMPETITION"
          : input.rivalryEvent.promotionBattle
            ? "PROMOTION_BATTLE"
            : input.rivalryEvent.cupFinal
              ? "CUP_FINAL"
              : "HISTORIC",
        date: input.date,
      });
    repository.upsertRivalry(nextRivalryIntensity(existing, input.rivalryEvent));
  }

  repository.recordEvent(
    buildSupporterEvent({
      clubId: input.clubId,
      gender,
      date: input.date,
      type:
        input.derbyResult !== undefined && input.derbyResult !== 0
          ? "DERBY_RESULT"
          : "MATCH_RESULT",
      magnitude: clampSupporterScore(30 + Math.abs(mood.moodDelta) * 6),
      moodDelta: mood.moodDelta,
      summary: `Supporter reaction to match result (mood ${mood.currentMood})`,
      subjectIds: input.opponentClubId ? [input.opponentClubId] : [],
      key: input.opponentClubId ?? "",
    }),
  );
  return next;
};

/** Monthly cadence entry point. */
export const normalizeSupporterCultureMonth = (
  db: GameDatabase,
  date: string,
): SupporterCultureProfile[] => {
  const repository = new SupporterCultureRepository(db);
  const updated = repository
    .profiles()
    .map((profile) => normalizeSupporterSentiment(profile, date));
  for (const profile of updated) repository.upsertProfile(profile);
  return updated;
};

/** Seasonal cadence entry point for one club. */
export const evolveSupporterCultureSeason = (
  db: GameDatabase,
  clubId: EntityId,
  input: SupporterSeasonInput & { gender?: "men" | "women" },
): SupporterCultureProfile | undefined => {
  const repository = new SupporterCultureRepository(db);
  const gender = input.gender ?? "men";
  const profile = repository.profile(clubId, gender);
  if (!profile) return undefined;
  const base = input.promoted
    ? applyPromotionEffect(profile, { newTier: input.tier, date: input.date })
    : input.relegated
      ? applyRelegationEffect(profile, { newTier: input.tier, date: input.date })
      : profile;
  const next = evolveSupporterBaseSeason(base, input);
  repository.upsertProfile(next);
  if (input.promoted || input.relegated) {
    repository.recordEvent(
      buildSupporterEvent({
        clubId,
        gender,
        date: input.date,
        type: input.promoted ? "PROMOTION" : "RELEGATION",
        magnitude: input.promoted ? 78 : 82,
        moodDelta: round2(next.currentMood - profile.currentMood),
        summary: input.promoted
          ? "Supporters celebrate promotion"
          : "Supporters react to relegation",
      }),
    );
  }
  return next;
};

/** Clean read model for future UI. Derived values are computed, not stored. */
export const supporterReadModel = (
  db: GameDatabase,
  clubId: EntityId,
  gender: "men" | "women" = "men",
): SupporterReadModel | undefined => {
  const repository = new SupporterCultureRepository(db);
  const profile = repository.profile(clubId, gender);
  if (!profile) return undefined;
  return {
    clubId,
    gender,
    profile,
    supporterBase: {
      potentialReach: profile.potentialReach,
      activeFanbase: profile.activeFanbase,
      matchgoingBase: profile.matchgoingBase,
      seasonTicketBase: profile.seasonTicketBase,
      casualAudience: profile.casualAudience,
    },
    mood: profile.currentMood,
    expectations: profile.expectations,
    managerApproval: profile.trustInManager,
    ownershipTrust: profile.trustInOwnership,
    unrest: profile.unrest,
    commercialEngagementIndex: supporterCommercialEngagementIndex(profile),
    topRivalries: repository.rivalries(clubId).slice(0, 5),
    fanFavourites: repository
      .affinities(clubId)
      .filter((item) => item.band === "FAN_FAVOURITE")
      .slice(0, 10),
    recentEvents: repository.events(clubId, 10),
  };
};
