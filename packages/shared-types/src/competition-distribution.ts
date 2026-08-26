import type { EntityId } from "./ids.js";

export type CompetitionDistributionPolicy = {
  id: EntityId;
  federationId: EntityId;
  competitionSeasonId: EntityId;
  version: number;
  poolAmount: number;
  championPrize: number;
  runnerUpPrize: number;
  placementPrizes: number;
  participationPayments: number;
  equalSharePayments: number;
  performanceSharePayments: number;
  audienceShare: number;
  youthDevelopmentIncentives: number;
  womensFootballIncentives: number;
  infrastructureGrants: number;
  status: "PROPOSED" | "APPROVED" | "APPLIED";
  provenanceStatus: "SIMULATION_ONLY";
};

export type CompetitionDistributionPayment = {
  id: EntityId;
  policyId: EntityId;
  competitionSeasonId: EntityId;
  federationId: EntityId;
  clubId: EntityId;
  amount: number;
  reason: string;
  paidOn: string;
  federationLedgerEntryId: EntityId;
  clubLedgerEntryId: EntityId;
  provenanceStatus: "SIMULATION_ONLY";
};
