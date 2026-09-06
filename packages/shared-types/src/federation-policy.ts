import type { EntityId } from "./ids.js";
import type { ISODate } from "./domain.js";

export type FederationStakeholderType =
  "CLUBS" | "REGIONS" | "REFEREES" | "YOUTH" | "NATIONAL_TEAMS" | "GOVERNMENT";
export type FederationPolicyCategory =
  | "YOUTH_DEVELOPMENT"
  | "WOMENS_DEVELOPMENT"
  | "REFEREE_DEVELOPMENT"
  | "COACHING_EDUCATION"
  | "INFRASTRUCTURE"
  | "REGIONAL_DEVELOPMENT"
  | "NATIONAL_TEAM_INVESTMENT"
  | "LEAGUE_STRUCTURE";
export type FederationCampaignStatus = "PLANNED" | "ACTIVE" | "COMPLETED" | "CANCELLED";

export type FederationCampaign = {
  id: EntityId;
  cycleId: EntityId;
  federationId: EntityId;
  candidateId: EntityId;
  platform: Record<FederationPolicyCategory, number>;
  campaignEvents: Array<{
    date: string;
    type: "MEETING" | "DEBATE" | "ENDORSEMENT" | "POLICY_PLEDGE";
    summary: string;
  }>;
  supportEstimate: number;
  status: FederationCampaignStatus;
  updatedOn: string;
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationEndorsement = {
  id: EntityId;
  campaignId: EntityId;
  candidateId: EntityId;
  stakeholderType: FederationStakeholderType;
  stakeholderId?: EntityId;
  support: number;
  reason: string;
  endorsedOn: string;
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationPolicy = {
  id: EntityId;
  federationId: EntityId;
  category: FederationPolicyCategory;
  title: string;
  status: "PROPOSED" | "FUNDED" | "IMPLEMENTING" | "COMPLETED" | "SUSPENDED";
  startDate: string;
  endDate?: string;
  fundingCommitted: number;
  implementationProgress: number;
  targetValue: number;
  effects: Record<string, number>;
  sourceCommitmentId?: EntityId;
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationDevelopmentBand = "FOUNDATION" | "BUILDING" | "PROGRESSING" | "ESTABLISHED";
export type FederationOutcomeSummary = {
  senior: { fixtures: number; wins: number; draws: number; losses: number };
  youth: { fixtures: number; wins: number; draws: number; losses: number };
  women: { fixtures: number; wins: number; draws: number; losses: number };
  pathway: {
    academyPlayers: number;
    firstTeamDebuts: number;
    regularFirstTeamPlayers: number;
    youthNationalPlayers: number;
    seniorNationalPlayers: number;
  };
  academyConversionBySeason: Array<{
    seasonLabel: string;
    intakeCount: number;
    academyGraduates: number;
    firstTeamDebuts: number;
    regularFirstTeamPlayers: number;
    youthNationalCallups: number;
    seniorNationalCallups: number;
    meaningfulExternalTransfers: number;
    sampleSize: number;
    confidence: "LOW" | "MEDIUM" | "HIGH";
  }>;
  womenProgramme: {
    participationBand: "LIMITED" | "BUILDING" | "PROGRESSING" | "ESTABLISHED";
    intakeCount: number;
    academyProgression: number;
    youthNationalProgression: number;
    seniorNationalProgression: number;
    coachingInfrastructureSupport: "LIMITED" | "PRESENT";
  };
  girlsDevelopment: "LIMITED" | "BUILDING" | "PROGRESSING" | "ESTABLISHED";
  strongestPathwayStage: string;
  weakestPathwayStage: string;
};
export type FederationDevelopmentSummary = {
  federationId: EntityId;
  band: FederationDevelopmentBand;
  dimensions: Record<string, FederationDevelopmentBand>;
  trend: "IMPROVING" | "STABLE" | "DECLINING";
  strengths: string[];
  priorities: string[];
  impactSummaries: string[];
  outcomes: FederationOutcomeSummary;
  governmentRelationship: "LIMITED" | "WORKING" | "STRONG";
  asOf: string;
  provenanceStatus: "SIMULATION_ONLY";
};

/**
 * "Build-a-Nation" development scorecard — a 0-100 rollup of the
 * FederationSimulationProfile dimensions the game already tracks (never a
 * fabricated FIFA-style rating). One category per already-computed
 * dimension so every score is directly traceable to real game state.
 */
export type NationDevelopmentCategory = {
  key: string;
  label: string;
  score: number;
};

export type NationDevelopmentScorecard = {
  federationId: EntityId;
  asOfDate: ISODate;
  overallScore: number;
  categories: NationDevelopmentCategory[];
  strongest: NationDevelopmentCategory;
  weakest: NationDevelopmentCategory;
  keyDrivers: string[];
  nextOpportunities: string[];
  trend?: "IMPROVING" | "STABLE" | "DECLINING";
  history: NationDevelopmentSnapshot[];
  provenanceStatus: "SIMULATION_ONLY";
};

/** One persisted annual snapshot behind the scorecard's trend line. */
export type NationDevelopmentSnapshot = {
  federationId: EntityId;
  seasonLabel: string;
  asOfDate: ISODate;
  overallScore: number;
  categories: Record<string, number>;
  provenanceStatus: "SIMULATION_ONLY";
};
