import type { EntityId } from "./ids.js";

export type FacilityProjectScope = "BASIC" | "STANDARD" | "EXPANDED" | "ELITE";
export type FacilityProjectMode = "UPGRADE_EXISTING" | "NEW_SITE";
export type FacilityFundingSource = "CLUB_CASH" | "DEBT" | "GOVERNMENT_GRANT" | "MIXED";
export type FacilitySiteArrangement = "LEASE" | "PURCHASE" | "CO_FUNDED";
export type FacilitySiteReadiness = "AVAILABLE" | "NEGOTIATION_REQUIRED" | "GOVERNMENT_REVIEW";

export type FacilitySiteOption = {
  id: EntityId;
  clubId: EntityId;
  districtId: EntityId;
  municipalityName: string;
  siteType: "EXISTING_GROUND" | "MUNICIPAL_LAND" | "REGIONAL_SITE" | "SHARED_CAMPUS";
  arrangement: FacilitySiteArrangement;
  costBand: "LOW" | "MODERATE" | "HIGH";
  accessibilityBand: "LIMITED" | "GOOD" | "STRONG";
  catchmentBand: "LOCAL" | "REGIONAL" | "WIDE";
  communityValueBand: "LOW" | "MEDIUM" | "HIGH";
  governmentConditions: string[];
  readiness: FacilitySiteReadiness;
  provenanceStatus: "SIMULATION_ONLY";
};

export type FacilityProjectPlan = {
  id: EntityId;
  projectId: EntityId;
  clubId: EntityId;
  projectType: string;
  mode: FacilityProjectMode;
  scope: FacilityProjectScope;
  components: string[];
  siteOptionId?: EntityId;
  fundingSource: FacilityFundingSource;
  governmentApplicationId?: EntityId;
  rationale: string;
  costBand: "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH";
  durationBand: "SHORT" | "MEDIUM" | "LONG" | "VERY_LONG";
  expectedImprovement: string[];
  createdOn: string;
  provenanceStatus: "SIMULATION_ONLY";
};
