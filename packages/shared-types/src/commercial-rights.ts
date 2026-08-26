import type { EntityId } from "./ids.js";

export type FederationCommercialRightsCategory = "NATIONAL_TEAM_SPONSOR" | "LEAGUE_TITLE_SPONSOR" | "WOMENS_LEAGUE_SPONSOR" | "YOUTH_COMPETITION_SPONSOR" | "OFFICIAL_BANK" | "OFFICIAL_TELECOM" | "OFFICIAL_AIRLINE" | "OFFICIAL_INSURANCE" | "OFFICIAL_MEDICAL" | "OFFICIAL_TECHNOLOGY" | "OFFICIAL_DATA" | "TICKETING_RIGHTS" | "STREAMING_RIGHTS" | "DIGITAL_RIGHTS" | "ARCHIVE_RIGHTS" | "COMPETITION_NAMING_RIGHTS";
export type FederationCommercialRightsStatus = "AVAILABLE" | "OFFERED" | "NEGOTIATED" | "AWARDED" | "ACTIVE" | "EXPIRED" | "RENEWED";

export type CommercialSponsorProfile = {
  id: EntityId;
  name: string;
  sector: string;
  financialStrength: number;
  strategicValue: number;
  reputation: number;
  domesticReach: number;
  internationalReach: number;
  reliability: number;
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationCommercialRightsPackage = {
  id: EntityId;
  federationId: EntityId;
  name: string;
  category: FederationCommercialRightsCategory;
  exclusivityGroup?: string;
  scope: "NATIONAL" | "COMPETITION" | "NATIONAL_TEAM" | "WOMENS" | "YOUTH";
  availableFrom: string;
  availableTo: string;
  status: FederationCommercialRightsStatus;
  bundledWith?: EntityId[];
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationCommercialRightsOffer = {
  id: EntityId;
  packageId: EntityId;
  federationId: EntityId;
  sponsorId: EntityId;
  termYears: number;
  annualValue: number;
  bonuses: Record<string, number>;
  reachScore: number;
  strategicFit: number;
  relationshipValue: number;
  exclusivity: boolean;
  scope: FederationCommercialRightsPackage["scope"];
  status: FederationCommercialRightsStatus;
  offeredOn: string;
  startDate?: string;
  endDate?: string;
  federationLedgerEntryId?: EntityId;
  provenanceStatus: "SIMULATION_ONLY";
};
