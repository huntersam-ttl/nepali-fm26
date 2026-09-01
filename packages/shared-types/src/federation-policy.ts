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
export type FederationDevelopmentSummary = {
  federationId: EntityId;
  band: FederationDevelopmentBand;
  strengths: string[];
  priorities: string[];
  governmentRelationship: "LIMITED" | "WORKING" | "STRONG";
  asOf: string;
  provenanceStatus: "SIMULATION_ONLY";
};
