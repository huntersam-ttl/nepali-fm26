import type { EntityId } from "./ids.js";

export type GrassrootsProgrammeType =
  | "SCHOOL_LEAGUE"
  | "DISTRICT_COMPETITION"
  | "PROVINCIAL_COMPETITION"
  | "NATIONAL_SCHOOL_FINALS"
  | "UNIVERSITY_FOOTBALL"
  | "COMMUNITY_FOOTBALL"
  | "GIRLS_FOOTBALL_DEVELOPMENT";

export type GrassrootsProgrammeStatus = "PLANNED" | "ACTIVE" | "SUSPENDED" | "COMPLETED";

export type GrassrootsProgramme = {
  id: EntityId;
  name: string;
  programmeType: GrassrootsProgrammeType;
  locationId: EntityId;
  locationKind: "MUNICIPALITY" | "DISTRICT" | "PROVINCE";
  federationId?: EntityId;
  fundingApplicationId?: EntityId;
  annualFunding: number;
  coachingAccess: number;
  facilityAccess: number;
  regionalParticipation: number;
  localFootballPriority: number;
  yearsActive: number;
  status: GrassrootsProgrammeStatus;
  provenanceStatus: "SIMULATION_ONLY";
};

export type GrassrootsProgrammeHistory = {
  id: EntityId;
  programmeId: EntityId;
  date: string;
  eventType: "CREATED" | "ADVANCED" | "SUSPENDED" | "REVIVED" | "COMPLETED";
  quality: number;
  delayedImpact: number;
  provenanceStatus: "SIMULATION_ONLY";
};
