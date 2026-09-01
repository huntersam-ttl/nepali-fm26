import type { EntityId } from "./ids.js";

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
