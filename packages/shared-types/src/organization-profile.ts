import type { EntityId } from "./ids.js";
import type { EntityReference, EntityReferenceType } from "./entity-reference.js";

export type OrganizationProfile = {
  entityReference: EntityReference;
  sector?: string;
  organizationContext: "NEPAL" | "MULTINATIONAL" | "CONTEXT_ONLY";
  provenanceStatus: EntityReference["provenanceStatus"];
  relationshipClues: string[];
  activeDeals: OrganizationCommercialDeal[];
  dealHistory: OrganizationCommercialDeal[];
  currentNegotiations: OrganizationCommercialDeal[];
  involvedEntities: EntityReference[];
};

export type OrganizationCommercialDeal = {
  id: EntityId;
  property: string;
  scope: string;
  counterpartId?: EntityId;
  counterpartLabel?: string;
  startDate?: string;
  endDate?: string;
  annualValue?: number;
  termYears?: number;
  status: string;
  sourceEntityId: EntityId;
  provenanceStatus: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type OrganizationProfileEntityType = Extract<
  EntityReferenceType,
  "SPONSOR" | "LENDER" | "INVESTOR"
>;
