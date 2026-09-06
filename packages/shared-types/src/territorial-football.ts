import type { EntityId } from "./ids.js";
import type { EntityReference } from "./entity-reference.js";
import type { InfrastructureStoryEntry } from "./desktop-contract.js";

export type TerritorialProvenance = "VERIFIED" | "UNKNOWN" | "SIMULATION_ONLY";

/** A schematic Nepal-region map read model — grouped by real province and
 * district data the territorial-football system already tracks, never
 * fabricated GPS geometry. */
export type MapRegionTone = "ok" | "warn" | "bad" | "info";

export type MapDistrictSummary = {
  id: EntityId;
  name: string;
  locationLabel?: string;
  developmentReputation: number;
  registeredClubCount: number;
  girlsParticipation: number;
  youthParticipation: number;
  coachSupply: number;
  refereeSupply: number;
  activeProjectCount: number;
  tone: MapRegionTone;
};

export type MapProvinceSummary = {
  id: EntityId;
  name: string;
  districts: MapDistrictSummary[];
};

export type FederationMap = {
  provinces: MapProvinceSummary[];
  provenanceStatus: "SIMULATION_ONLY";
};

export type DistrictDetail = {
  district: MapDistrictSummary;
  provinceName: string;
  clubs: EntityReference[];
  federationProjects: Array<{ id: EntityId; name: string; projectType: string; status: string }>;
  districtProjects: Array<{ id: EntityId; projectType: string; status: string; reportingStatus: string }>;
  latestStory?: InfrastructureStoryEntry;
};
export type DistrictFootballUnit = { id: EntityId; name: string; provinceId: EntityId; locationId?: EntityId; remoteness: number; developmentStatus: "DEVELOPING" | "ESTABLISHED"; affiliationStatus: "VERIFIED" | "UNKNOWN" | "DEVELOPING"; developmentReputation: number; registeredClubCount: number; schoolParticipation: number; girlsParticipation: number; youthParticipation: number; coachSupply: number; refereeSupply: number; groundAvailability: number; scoutingVisibility: number; governanceCompliance: number; history: Array<{ date: string; event: string; indicators: Record<string, number> }>; provenanceStatus: TerritorialProvenance };
export type ProvinceFootballUnit = { id: EntityId; name: string; districtIds: EntityId[]; footballStrength: number; infrastructure: number; playerProduction: number; competitionPerformance: number; fundingReceived: number; fundingSpent: number; representativeTeamId?: EntityId; history: Array<{ date: string; event: string }>; provenanceStatus: TerritorialProvenance };
export type DistrictDevelopmentProjectStatus = "PROPOSED" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "FUNDED" | "ACTIVE" | "REPORTING_DUE" | "COMPLETED" | "REJECTED" | "DELAYED" | "FROZEN" | "CANCELLED";
export type DistrictDevelopmentProject = { id: EntityId; districtId: EntityId; provinceId: EntityId; projectType: string; requestedBudget: number; districtContribution: number; provinceContribution: number; municipalityContribution: number; federationContribution: number; restrictedGrantId?: EntityId; durationMonths: number; milestones: string[]; conditions: string[]; reportingStatus: "NOT_DUE" | "DUE" | "ACCEPTED" | "FAILED"; outcome?: string; status: DistrictDevelopmentProjectStatus; createdOn: string; provenanceStatus: "SIMULATION_ONLY" };
export type TerritorialRepresentativeTeam = { id: EntityId; name: string; territoryType: "DISTRICT" | "PROVINCE"; territoryId: EntityId; playerIds: EntityId[]; competitionId?: EntityId; competitionCycleId?: EntityId; status: "SIMULATION_ONLY"; history: Array<{ date: string; event: string; playerIds: EntityId[] }> };
export type TerritorialCompetitionLevel = "DISTRICT" | "PROVINCIAL" | "NATIONAL";
export type TerritorialCompetitionFormat = "LEAGUE" | "KNOCKOUT";
export type TerritorialParticipantType = "DISTRICT" | "PROVINCE";
export type TerritorialEligibilityRule = { birthplace?: boolean; residence?: boolean; developmentRegistration?: boolean; localClubAffiliation?: boolean; ageMaximum?: number };
export type TerritorialCompetitionConfig = { id: EntityId; name: string; level: TerritorialCompetitionLevel; participantType: TerritorialParticipantType; provinceId?: EntityId; format: TerritorialCompetitionFormat; participantsPerProvince?: number; qualifierCount?: number; seasonStartDate: string; seasonEndDate: string; roundSpacingDays: number; winnerRequired: boolean; eligibility: TerritorialEligibilityRule; ageCategory?: "SENIOR" | "YOUTH" | "WOMEN"; provenanceStatus: "SIMULATION_ONLY" };
export type TerritorialCompetitionSeason = { id: EntityId; competitionId: EntityId; seasonLabel: string; config: TerritorialCompetitionConfig; participantTeamIds: EntityId[]; qualifiedTeamIds: EntityId[]; status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED"; championTeamId?: EntityId; history: Array<{ date: string; event: string; teamIds?: EntityId[] }>; provenanceStatus: "SIMULATION_ONLY" };
