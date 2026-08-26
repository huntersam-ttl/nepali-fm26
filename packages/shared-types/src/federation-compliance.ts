import type { EntityId } from "./ids.js";

/** Real institutions only — never abstract points/coins. */
export type FederationFundingSource =
  | "FIFA_DEVELOPMENT"
  | "FIFA_OPERATIONAL"
  | "AFC_DEVELOPMENT"
  | "AFC_TECHNICAL_SUPPORT"
  | "GOVERNMENT_NSC_GRANT"
  | "OTHER_EXTERNAL_GRANT";

export type FederationRestrictionPurpose =
  | "UNRESTRICTED"
  | "PITCH_PROJECT"
  | "TECHNICAL_CENTRE"
  | "DISTRICT_DEVELOPMENT"
  | "WOMENS_FOOTBALL"
  | "YOUTH"
  | "GRASSROOTS"
  | "REFEREE_DEVELOPMENT"
  | "COACH_EDUCATION"
  | "NATIONAL_TEAM_SUPPORT";

export type FederationGrantStatus =
  | "PROPOSED"
  | "APPLIED"
  | "UNDER_REVIEW"
  | "CONDITIONALLY_APPROVED"
  | "APPROVED"
  | "PARTIALLY_DISBURSED"
  | "ACTIVE"
  | "REPORTING_DUE"
  | "COMPLETED"
  | "REJECTED"
  | "DELAYED"
  | "FROZEN"
  | "SUSPENDED"
  | "RECOVERY_REQUIRED"
  | "CANCELLED";

export type FederationProvenanceStatus = "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN" | "SIMULATION_ONLY";

export type FederationGrantHistoryEvent = {
  date: string;
  action: string;
  note: string;
};

export type FederationGrantMilestone = {
  key: string;
  description: string;
  dueDate: string;
  completed: boolean;
  completedOn?: string;
};

export type FederationGrant = {
  id: EntityId;
  federationId: EntityId;
  sourceInstitution: FederationFundingSource;
  currency: string;
  approvedAmount: number;
  receivedAmount: number;
  remainingAmount: number;
  approvalDate?: string;
  fundingPeriodStart: string;
  fundingPeriodEnd: string;
  purpose: string;
  restrictionType: FederationRestrictionPurpose;
  status: FederationGrantStatus;
  reportingRequirements: string[];
  auditRequired: boolean;
  milestones: FederationGrantMilestone[];
  history: FederationGrantHistoryEvent[];
  conditions: string[];
  provenanceStatus: FederationProvenanceStatus;
};

export type FederationGrantExpenditure = {
  id: EntityId;
  grantId: EntityId;
  federationId: EntityId;
  date: string;
  amount: number;
  purpose: FederationRestrictionPurpose;
  description: string;
  ledgerEntryId: EntityId;
  status: "SIMULATION_ONLY";
};

export type FederationComplianceStatus =
  | "NORMAL"
  | "WARNING"
  | "FORMAL_REVIEW"
  | "FUNDING_RESTRICTED"
  | "COMPETITION_RESTRICTED"
  | "SUSPENDED"
  | "REINSTATEMENT_REVIEW";

/** Bounded 0-100 dimensions. Never a criminal-accusation model — governance quality only. */
export type FederationComplianceDimensions = {
  autonomy: number;
  statutoryCompliance: number;
  electionLegitimacy: number;
  financialControls: number;
  auditQuality: number;
  transparencyReporting: number;
  safeguarding: number;
  projectDelivery: number;
};

export type FederationComplianceHistoryEvent = {
  date: string;
  action: string;
  note: string;
  status: FederationComplianceStatus;
};

export type FederationComplianceProfile = {
  federationId: EntityId;
  status: FederationComplianceStatus;
  dimensions: FederationComplianceDimensions;
  lastReviewedOn: string;
  history: FederationComplianceHistoryEvent[];
  provenanceStatus: FederationProvenanceStatus;
};

export type FederationSanctionAuthority = "FIFA" | "AFC" | "DOMESTIC";

export type FederationSanctionConsequence =
  | "FUNDING_FROZEN"
  | "NEW_GRANTS_BLOCKED"
  | "NATIONAL_TEAM_PARTICIPATION_BLOCKED"
  | "CLUB_CONTINENTAL_PARTICIPATION_BLOCKED"
  | "DEVELOPMENT_PROGRAMMES_UNAVAILABLE"
  | "REPUTATION_DAMAGE";

export type FederationSanctionReviewState = "ACTIVE" | "UNDER_REVIEW" | "RESOLVED";

export type FederationSanctionHistoryEvent = { date: string; action: string; note: string };

export type FederationSanction = {
  id: EntityId;
  federationId: EntityId;
  authority: FederationSanctionAuthority;
  reason: string;
  category: string;
  startDate: string;
  requirementsForResolution: string[];
  affectedProgrammes: string[];
  consequences: FederationSanctionConsequence[];
  reviewState: FederationSanctionReviewState;
  resolvedOn?: string;
  history: FederationSanctionHistoryEvent[];
  provenanceStatus: FederationProvenanceStatus;
};

export type FederationCorrectiveActionStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "VERIFIED" | "FAILED";

export type FederationCorrectiveAction = {
  id: EntityId;
  federationId: EntityId;
  sanctionId?: EntityId;
  description: string;
  category: string;
  startedOn: string;
  targetCompletionOn: string;
  completedOn?: string;
  status: FederationCorrectiveActionStatus;
  evidence?: string;
  provenanceStatus: "SIMULATION_ONLY";
};

/** Data-driven starting snapshot hook — see requirement 8. Never hardcode an unverified claim. */
export type FederationComplianceSnapshotSeed = {
  federationKey: string;
  status: FederationComplianceStatus;
  dimensions?: Partial<FederationComplianceDimensions>;
  effectiveDate: string;
  provenanceStatus: FederationProvenanceStatus;
  sanctions?: Array<{
    authority: FederationSanctionAuthority;
    reason: string;
    category: string;
    startDate: string;
    requirementsForResolution: string[];
    affectedProgrammes: string[];
    consequences: FederationSanctionConsequence[];
    provenanceStatus: FederationProvenanceStatus;
  }>;
};
