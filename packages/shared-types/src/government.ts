import type { EntityId } from "./ids.js";

export type GovernmentInstitutionType =
  | "NATIONAL_SPORTS_COUNCIL"
  | "SPORTS_MINISTRY"
  | "PROVINCIAL_GOVERNMENT"
  | "MUNICIPALITY";

export type GovernmentInstitutionProfile = {
  budgetCapacity: number;
  committedBudget: number;
  footballPriority: number;
  credibilityTowardFederation: number;
  infrastructurePriority: number;
  youthWomenPriority: number;
};

export type GovernmentInstitution = {
  id: EntityId;
  name: string;
  institutionType: GovernmentInstitutionType;
  locationId?: EntityId;
  profile: GovernmentInstitutionProfile;
  provenanceStatus: "SIMULATION_ONLY";
};

export type GovernmentFundingType =
  | "FEDERATION_OPERATIONS"
  | "NATIONAL_TEAM_PREPARATION"
  | "INFRASTRUCTURE"
  | "REGIONAL_GROUND"
  | "WOMENS_FOOTBALL"
  | "YOUTH_GRASSROOTS"
  | "MUNICIPAL_LAND_OR_VENUE";

export type GovernmentFundingApplicationStatus =
  | "PROPOSED"
  | "SUBMITTED"
  | "REVIEWED"
  | "CONDITIONAL"
  | "APPROVED"
  | "REJECTED"
  | "COMPLETED";

export type GovernmentFundingApplication = {
  id: EntityId;
  institutionId: EntityId;
  federationId?: EntityId;
  clubId?: EntityId;
  projectId?: EntityId;
  fundingType: GovernmentFundingType;
  requestedAmount: number;
  approvedAmount?: number;
  status: GovernmentFundingApplicationStatus;
  conditions: string[];
  proposedOn: string;
  decidedOn?: string;
  decisionReason?: string;
  provenanceStatus: "SIMULATION_ONLY";
};

export type GovernmentRelationship = {
  id: EntityId;
  institutionId: EntityId;
  entityId: EntityId;
  entityType: "FEDERATION" | "CLUB";
  trust: number;
  lastInteractionOn?: string;
  provenanceStatus: "SIMULATION_ONLY";
};
