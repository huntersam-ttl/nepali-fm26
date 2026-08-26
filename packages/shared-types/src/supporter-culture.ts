import type { EntityId } from "./ids.js";
import type { ISODate } from "./domain.js";

/**
 * Supporter world Phase A. Everything here is generated gameplay state: no
 * value in this module is a claim about a real club's real supporters, so the
 * provenance marker is always SIMULATION_ONLY. Factual club identity/history
 * keeps living in the existing club/provenance models.
 */
export type SupporterProvenance = "SIMULATION_ONLY";

export type SupporterUnrestState = "CONTENT" | "CONCERNED" | "FRUSTRATED" | "ANGRY" | "PROTESTING";

export type SupporterAffinityBand = "FAN_FAVOURITE" | "RESPECTED" | "NEUTRAL" | "UNPOPULAR";

export type SupporterLegendTier = "NONE" | "CULT_HERO" | "CLUB_ICON" | "CLUB_LEGEND";

export type RivalryOrigin =
  "GEOGRAPHIC" | "HISTORIC" | "TITLE_COMPETITION" | "PROMOTION_BATTLE" | "CUP_FINAL" | "IDENTITY";

export type SupporterEventType =
  | "MATCH_RESULT"
  | "DERBY_RESULT"
  | "PROMOTION"
  | "RELEGATION"
  | "TROPHY"
  | "STAR_SIGNING"
  | "PLAYER_SALE"
  | "OWNERSHIP_DECISION"
  | "FINANCIAL_INSTABILITY"
  | "FACILITY_INVESTMENT"
  | "YOUTH_BREAKTHROUGH"
  | "MANAGER_BACKING"
  | "MANAGER_PRESSURE"
  | "PROTEST"
  | "ATTENDANCE_RECORD"
  | "RIVALRY_MILESTONE";

/**
 * Persistent supporter profile for one club team (men's and women's branches
 * develop their own support, so the profile is keyed by club + gender rather
 * than by club alone).
 *
 * Bounded dimensions are 0..100. Base sizes are non-negative integers and are
 * deliberately independent of stadium capacity.
 */
export type SupporterCultureProfile = {
  clubId: EntityId;
  gender: "men" | "women";
  teamId?: EntityId;
  /** Pyramid level: 1 = A Division, 2 = B, 3 = C or below. */
  tier: number;
  locationId?: EntityId;
  /** Bounded culture dimensions (0..100). */
  localIdentity: number;
  nationalReach: number;
  loyalty: number;
  passion: number;
  patience: number;
  volatility: number;
  matchgoingCulture: number;
  awaySupport: number;
  youthInterest: number;
  familyAttendance: number;
  commercialEngagement: number;
  socialReach: number;
  /** Supporter base sizes (people, not seats). */
  potentialReach: number;
  activeFanbase: number;
  matchgoingBase: number;
  seasonTicketBase: number;
  casualAudience: number;
  /** Bounded sentiment (0..100). */
  expectations: number;
  optimism: number;
  currentMood: number;
  baselineMood: number;
  trustInOwnership: number;
  trustInManager: number;
  unrest: SupporterUnrestState;
  lastEvaluatedOn: ISODate;
  provenanceStatus: SupporterProvenance;
};

export type ClubRivalry = {
  id: EntityId;
  clubId: EntityId;
  rivalClubId: EntityId;
  origin: RivalryOrigin;
  /** Current bounded intensity 0..100. */
  intensity: number;
  /** Sticky floor for genuine longstanding rivalries. */
  historicBaseline: number;
  meetings: number;
  lastMeetingOn?: ISODate;
  history: Array<{ date: ISODate; event: string; intensity: number }>;
  provenanceStatus: SupporterProvenance;
};

export type SupporterPlayerAffinity = {
  clubId: EntityId;
  playerId: EntityId;
  /** 0..100 affinity; band and legend tier are derived from it plus service. */
  affinity: number;
  band: SupporterAffinityBand;
  legendTier: SupporterLegendTier;
  appearances: number;
  goalContributions: number;
  academyGraduate: boolean;
  localBorn: boolean;
  seasonsAtClub: number;
  lastEvaluatedOn: ISODate;
  provenanceStatus: SupporterProvenance;
};

export type SupporterEvent = {
  id: EntityId;
  clubId: EntityId;
  gender: "men" | "women";
  date: ISODate;
  type: SupporterEventType;
  /** 0..100 significance, used by media/board hooks for prioritisation. */
  magnitude: number;
  moodDelta: number;
  summary: string;
  subjectIds: EntityId[];
  provenanceStatus: SupporterProvenance;
};

export type NationalTeamSupporterState = {
  nationalTeamId: EntityId;
  gender: "men" | "women";
  /** Bounded 0..100. National support is event driven, not a club fanbase. */
  support: number;
  mood: number;
  expectations: number;
  mediaAttention: number;
  federationTrust: number;
  rankingTrajectory: number;
  lastEvaluatedOn: ISODate;
  provenanceStatus: SupporterProvenance;
};

/** Debug/read-model breakdown of one fixture's attendance demand. */
export type AttendanceDemandBreakdown = {
  baselineLocalDemand: number;
  formModifier: number;
  positionModifier: number;
  opponentModifier: number;
  rivalryModifier: number;
  stakesModifier: number;
  competitionModifier: number;
  priceAffordabilityModifier: number;
  moodModifier: number;
  weatherModifier: number;
  macroModifier: number;
  homeDemand: number;
  awayDemand: number;
  awayAllocation: number;
  rawDemand: number;
  capacity: number;
  homeAttendance: number;
  awayAttendance: number;
  attendance: number;
  cappedByCapacity: boolean;
};

export type MatchAtmosphere = {
  attendance: number;
  capacity: number;
  occupancy: number;
  /** Bounded 0..100. */
  atmosphere: number;
  homePressure: number;
  refereePressure: number;
  mediaSignificance: number;
  rivalryIntensity: number;
};

export type SupporterReadModel = {
  clubId: EntityId;
  gender: "men" | "women";
  profile: SupporterCultureProfile;
  supporterBase: {
    potentialReach: number;
    activeFanbase: number;
    matchgoingBase: number;
    seasonTicketBase: number;
    casualAudience: number;
  };
  mood: number;
  expectations: number;
  managerApproval: number;
  ownershipTrust: number;
  unrest: SupporterUnrestState;
  commercialEngagementIndex: number;
  topRivalries: ClubRivalry[];
  fanFavourites: SupporterPlayerAffinity[];
  recentEvents: SupporterEvent[];
};
