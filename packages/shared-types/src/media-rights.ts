import type { EntityId } from "./ids.js";

export type FederationRightsCategory = "DOMESTIC_TV" | "DOMESTIC_STREAMING" | "INTERNATIONAL_STREAMING" | "HIGHLIGHTS" | "ARCHIVE" | "COMPETITION" | "NATIONAL_TEAM";
export type FederationRightsContractStatus = "AVAILABLE" | "OFFERED" | "NEGOTIATED" | "AWARDED" | "ACTIVE" | "EXPIRED" | "RENEWED";

export type BroadcasterProfile = {
  id: EntityId;
  name: string;
  marketReach: number;
  reliability: number;
  financialStrength: number;
  productionCapability: number;
  domesticReach: number;
  internationalReach: number;
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationMediaRightsPackage = {
  id: EntityId;
  federationId: EntityId;
  name: string;
  category: FederationRightsCategory;
  competitionId?: EntityId;
  nationalTeamId?: EntityId;
  availableFrom: string;
  availableTo: string;
  status: FederationRightsContractStatus;
  retainedByFederation: boolean;
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationMediaRightsOffer = {
  id: EntityId;
  packageId: EntityId;
  federationId: EntityId;
  broadcasterId: EntityId;
  value: number;
  reachScore: number;
  strategicControl: number;
  productionQuality: number;
  status: FederationRightsContractStatus;
  offeredOn: string;
  startDate?: string;
  endDate?: string;
  federationLedgerEntryId?: EntityId;
  provenanceStatus: "SIMULATION_ONLY";
};
