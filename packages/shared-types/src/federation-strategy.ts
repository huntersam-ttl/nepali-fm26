import type { EntityId } from "./ids.js";
import type { ISODate } from "./domain.js";

export type RefereeGovernanceSummary = {
  federationId: EntityId;
  appointmentConfidence: "LIMITED" | "WORKING" | "STRONG";
  developmentPriority: "POOL_DEPTH" | "EXPERIENCE" | "CONSISTENCY" | "MAINTENANCE";
  stakeholderTrust: "LIMITED" | "WORKING" | "STRONG";
  controversyPressure?: "LOW" | "MODERATE" | "HIGH";
  recentAssignments: number;
  recentMatchEvents: { cards: number; fouls: number; varReviews: number };
  provenanceStatus: "SIMULATION_ONLY";
};

export type RefereeGovernanceReview = {
  id: EntityId;
  federationId: EntityId;
  reviewDate: ISODate;
  assignments: number;
  matchEvents: { cards: number; fouls: number; varReviews: number };
  appointmentConfidence: "LIMITED" | "WORKING" | "STRONG";
  controversyPressure: "LOW" | "MODERATE" | "HIGH";
  developmentPriority: "POOL_DEPTH" | "EXPERIENCE" | "CONSISTENCY" | "MAINTENANCE";
  stakeholderTrust: "LIMITED" | "WORKING" | "STRONG";
  status: "OPEN" | "REVIEWED" | "ACTIONED";
  provenanceStatus: "SIMULATION_ONLY";
};

export type InfrastructurePriority = {
  projectType: string;
  targetDistrictId?: EntityId;
  targetProvinceId?: EntityId;
  priorityLabel: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  rationale: string[];
  fundingPath: "FEDERATION" | "GOVERNMENT_SUPPORT" | "JOINT_FUNDING";
  provenanceStatus: "SIMULATION_ONLY";
};

export type FixtureIntegritySummary = {
  valid: boolean;
  teamCount: number;
  expectedMatches: number;
  actualMatches: number;
  duplicatePairings: number;
  missingPairings: number;
  reversedHomeAway: boolean;
};
