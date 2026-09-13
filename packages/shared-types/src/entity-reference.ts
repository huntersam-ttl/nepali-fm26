import type { EntityId } from "./ids.js";

export type EntityReferenceType =
  | "PLAYER"
  | "STAFF"
  | "CLUB"
  | "COMPETITION"
  | "FIXTURE"
  | "SPONSOR"
  | "LENDER"
  | "INVESTOR"
  | "GOVERNMENT_INSTITUTION"
  | "INFRASTRUCTURE_PROJECT"
  | "FEDERATION_PROJECT"
  | "NATIONAL_TEAM"
  | "JOURNALIST"
  | "MEDIA_OUTLET";

export type EntityReference = {
  entityType: EntityReferenceType;
  id: EntityId;
  label: string;
  subtitle?: string;
  destination: string;
  visible: boolean;
  allowedActions: string[];
  provenanceStatus: "SIMULATION_ONLY" | "REPORTED" | "VERIFIED" | "UNKNOWN";
};
