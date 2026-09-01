import type { EntityId } from "./ids.js";
import type { ISODate, AgentProfile, AgentClient } from "./domain.js";

export type AgentCareerProfile = {
  agent: AgentProfile;
  personId: EntityId;
  careerRole: "AGENT";
  reputationLabel: "EMERGING" | "ESTABLISHED" | "RESPECTED";
  activeClients: number;
  provenanceStatus: "SIMULATION_ONLY";
};

export type AgentPortfolioReadModel = {
  profile: AgentCareerProfile;
  clients: AgentClient[];
  activeNegotiationCount: number;
  relationshipClues: string[];
};

export type CareerTimelineRole =
  | "MANAGER"
  | "OWNER"
  | "PRESIDENT"
  | "SPORTING_DIRECTOR"
  | "DIRECTOR_OF_FOOTBALL"
  | "CEO"
  | "SECRETARY"
  | "AGENT"
  | "PLAYER"
  | "STAFF"
  | string;
export type CareerTimelineCategory =
  | "APPOINTMENT"
  | "DEPARTURE"
  | "TRANSFER"
  | "CONTRACT"
  | "RESULT"
  | "GOVERNANCE"
  | "MEDIA"
  | "REPRESENTATION"
  | "MILESTONE"
  | "PROJECT"
  | "OTHER";
export type CareerTimelineEvent = {
  id: EntityId;
  personId: EntityId;
  occurredOn: ISODate;
  role: CareerTimelineRole;
  category: CareerTimelineCategory;
  title: string;
  importance: "LOW" | "MEDIUM" | "HIGH";
  clubId?: EntityId;
  federationId?: EntityId;
  sourceEntityId?: EntityId;
  seasonLabel?: string;
  provenanceStatus: "SIMULATION_ONLY";
};

export type CareerTimelineFilter = {
  personId: EntityId;
  year?: number;
  seasonLabel?: string;
  role?: CareerTimelineRole;
  clubId?: EntityId;
  federationId?: EntityId;
  category?: CareerTimelineCategory;
};

export type AgentReputationOutcome = {
  successfulTransfers: number;
  strongContracts: number;
  clientProgressions: number;
  failedNegotiations: number;
  relationshipQuality: number;
};
