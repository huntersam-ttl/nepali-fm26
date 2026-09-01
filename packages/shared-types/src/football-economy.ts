import type { EntityId } from "./ids.js";

export type HostingBidStatus =
  | "EXPLORING"
  | "PREPARING"
  | "SUBMITTED"
  | "SHORTLISTED"
  | "WON"
  | "LOST"
  | "WITHDRAWN"
  | "HOSTING"
  | "COMPLETED";
export type HostingEventType = "DOMESTIC_FINAL" | "NATIONAL_TEAM_EVENT" | "INTERNATIONAL_EVENT";
export type BroadcastDistributionModel = "EQUAL_SHARE" | "MERIT_SHARE" | "MIXED_EQUAL_MERIT";
export type FootballEconomicTrend = "GROWING" | "STABLE" | "DECLINING" | "STRESSED";

export type HostingBid = {
  id: EntityId;
  federationId: EntityId;
  eventType: HostingEventType;
  eventName: string;
  hostScope: "VENUE" | "CITY" | "NATIONAL";
  venueId?: EntityId;
  readiness: number;
  fundingPlan: number;
  governmentSupport: number;
  federationContribution: number;
  projectedBenefit: number;
  status: HostingBidStatus;
  proposedOn: string;
  decisionDate?: string;
  provenanceStatus: "SIMULATION_ONLY";
};

export type FootballEconomySummary = {
  federationId: EntityId;
  trend: FootballEconomicTrend;
  drivers: string[];
  competitionReputationTrend: "RISING" | "STABLE" | "FALLING";
  asOf: string;
  provenanceStatus: "SIMULATION_ONLY";
};
