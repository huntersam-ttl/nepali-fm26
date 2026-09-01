import type { EntityId } from "./ids.js";

export type RefereeGovernanceSummary = {
  federationId: EntityId;
  appointmentConfidence: "LIMITED" | "WORKING" | "STRONG";
  developmentPriority: "POOL_DEPTH" | "EXPERIENCE" | "CONSISTENCY" | "MAINTENANCE";
  stakeholderTrust: "LIMITED" | "WORKING" | "STRONG";
  recentAssignments: number;
  recentMatchEvents: { cards: number; fouls: number; varReviews: number };
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
