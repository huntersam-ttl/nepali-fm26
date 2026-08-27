import type { EntityId } from "./ids.js";

export type SimulationDepth = "FULL" | "CONTEXT_ONLY";
export type ExternalClubFinancialBand = "LOW" | "MEDIUM" | "HIGH" | "ELITE";
export type ExternalScoutingInterest = "UNKNOWN" | "MONITORING" | "INTERESTED" | "ACTIVE_SCOUTING" | "TRIAL_INTEREST" | "TRANSFER_INTEREST";
export type ExternalPlayerCareerState = "ACTIVE" | "FREE_AGENT" | "RETIRED";

export type ExternalFederationContext = {
  federationId: EntityId;
  countryId: EntityId;
  confederation: "AFC" | "CAF" | "CONCACAF" | "CONMEBOL" | "OFC" | "UEFA";
  reputation: number;
  simulationDepth: "CONTEXT_ONLY";
  updatedOn: string;
};

export type ExternalLeagueContext = {
  leagueId: EntityId;
  federationId: EntityId;
  countryId: EntityId;
  tier: number;
  reputation: number;
  simulationDepth: "CONTEXT_ONLY";
  continentalQualification: boolean;
};

export type ExternalClubContext = {
  clubId: EntityId;
  leagueId: EntityId;
  federationId: EntityId;
  countryId: EntityId;
  reputation: number;
  financialBand: ExternalClubFinancialBand;
  academyStrength: number;
  scoutingReach: number;
  recruitmentRegions: string[];
  simulationDepth: "CONTEXT_ONLY";
};

export type ExternalLeagueSeason = {
  id: EntityId;
  leagueId: EntityId;
  seasonLabel: string;
  championClubId?: EntityId;
  continentalQualifierClubIds: EntityId[];
  relegatedClubIds: EntityId[];
  completedOn: string;
  status: "COMPLETED";
  provenanceStatus: "SIMULATION_ONLY";
};

export type ExternalPlayerContext = {
  playerId: EntityId;
  clubId?: EntityId;
  region: string;
  reputation: number;
  interestLevel: ExternalScoutingInterest;
  careerState: ExternalPlayerCareerState;
  availableOn?: string;
  updatedOn: string;
};

export type ForeignScoutingInterestRecord = {
  id: EntityId;
  externalClubId: EntityId;
  targetPlayerId: EntityId;
  level: ExternalScoutingInterest;
  score: number;
  firstObservedOn: string;
  lastObservedOn: string;
  provenanceStatus: "SIMULATION_ONLY";
};
