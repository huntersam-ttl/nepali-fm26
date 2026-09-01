import type { EntityId } from "./ids.js";
import type { ISODate } from "./domain.js";

export type TalentHotspotLabel = "EMERGING" | "DEVELOPING" | "ESTABLISHED" | "PRIORITY";
export type AcademyRecruitmentReach = "LOCAL" | "REGIONAL" | "NATIONAL";

/** Simulation-only, explainable geography summary. Values are intentionally not raw multipliers. */
export type TalentHotspotSnapshot = {
  districtId: EntityId;
  provinceId: EntityId;
  asOf: ISODate;
  label: TalentHotspotLabel;
  momentum: "RISING" | "STABLE" | "STAGNATING";
  contributingFactors: string[];
  provenance: "SIMULATION_ONLY";
};

export type SchoolFootballDevelopmentSummary = {
  districtId: EntityId;
  programmeLabel: "LIMITED" | "DEVELOPING" | "ACTIVE" | "STRONG";
  participationLabel: "LOW" | "STEADY" | "WIDESPREAD";
  academyConnection: "NONE_RECORDED" | "LOCAL_PATHWAY" | "REGIONAL_PATHWAY";
  competitionExposure: "LIMITED" | "REGULAR";
  provenance: "SIMULATION_ONLY";
};

export type AcademyCatchmentSummary = {
  academyId?: EntityId;
  clubId?: EntityId;
  homeDistrictId?: EntityId;
  reach: AcademyRecruitmentReach;
  catchmentLabel: "LOCAL" | "WIDER_REGION" | "NATIONWIDE";
  pathwayLinks: string[];
  provenance: "SIMULATION_ONLY";
};

export type YouthGeographyReadModel = {
  playerId: EntityId;
  birthDistrictId?: EntityId;
  developmentDistrictId?: EntityId;
  provinceId?: EntityId;
  schoolProgramme?: string;
  academyOriginId?: EntityId;
  recruitmentPathway:
    "SCHOOL" | "LOCAL_ACADEMY" | "REGIONAL_ACADEMY" | "NATIONAL_ACADEMY" | "OTHER";
  provenance: "SIMULATION_ONLY";
};
