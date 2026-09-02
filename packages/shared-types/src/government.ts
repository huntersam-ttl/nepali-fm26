import type { EntityId } from "./ids.js";
import type { EntityReference } from "./entity-reference.js";

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

/**
 * UI-safe bands over the institution's internal disposition scores — the raw
 * 0-100 numbers are simulation-only AI weighting, not something a federation
 * president would ever see quoted as a figure.
 */
export type GovernmentPriorityBand = "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH";

/** "NOT_ESTABLISHED" is honest, not a fabricated neutral default: no relationship row exists until an interaction records one. */
export type GovernmentRelationshipBand =
  | "NOT_ESTABLISHED"
  | "STRAINED"
  | "CAUTIOUS"
  | "COOPERATIVE"
  | "STRONG";

export type GovernmentOverviewInstitution = {
  id: EntityId;
  name: string;
  institutionType: GovernmentInstitutionType;
  locationId?: EntityId;
  relationshipBand: GovernmentRelationshipBand;
  infrastructurePriorityBand: GovernmentPriorityBand;
  youthWomenPriorityBand: GovernmentPriorityBand;
  /** budgetCapacity - committedBudget: a real currency estimate, not a hidden score. */
  estimatedAvailableFunding: number;
};

/** Read model behind the federation's government-relations / funding-request UI. */
export type GovernmentOverview = {
  institutions: GovernmentOverviewInstitution[];
  applications: GovernmentFundingApplication[];
};

export type ClubInfrastructureGovernmentContext = {
  projectId: EntityId;
  project?: EntityReference;
  siteId?: EntityId;
  siteReadiness?: string;
  clubId: EntityId;
  governmentInstitution?: EntityReference;
  requestType?: GovernmentFundingType;
  applicationId?: EntityId;
  status: GovernmentFundingApplicationStatus | "NOT_REQUESTED" | "STALE";
  submittedOn?: string;
  reviewedOn?: string;
  requestedAmount?: number;
  approvedAmount?: number;
  conditions: string[];
  fundingSettled: boolean;
  settlementReference?: EntityId;
  nextAction: "OPEN_REQUEST" | "WAIT_FOR_REVIEW" | "START_PROJECT" | "NONE";
  blockedReason?: string;
};
