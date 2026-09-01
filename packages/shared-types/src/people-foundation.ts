import type { EntityId } from "./ids.js";
import type { ISODate } from "./domain.js";

export type PersonalityArchetype =
  "LEADER" | "PROFESSIONAL" | "DRIVEN" | "ADAPTABLE" | "SOCIABLE" | "STEADY" | "UNDEFINED";

export type PersonalityTraits = {
  professionalism: number;
  ambition: number;
  loyalty: number;
  sociability: number;
  adaptability: number;
  pressureHandling: number;
  determination: number;
};

/** Normalized simulation personality shared by players, staff, managers and agents. */
export type PersonPersonalityProfile = {
  personId: EntityId;
  traits: PersonalityTraits;
  archetype: PersonalityArchetype;
  updatedOn: ISODate;
  provenanceStatus: "SIMULATION_ONLY";
};

export type PersonRelationshipKind =
  | "TEAMMATE"
  | "MANAGER_PLAYER"
  | "STAFF_PLAYER"
  | "STAFF_MANAGER"
  | "PLAYER_AGENT"
  | "MANAGER_BOARD"
  | "OTHER";

/** Directed relationship state; future systems may interpret, but do not own, these values. */
export type PersonRelationship = {
  id: EntityId;
  fromPersonId: EntityId;
  toPersonId: EntityId;
  kind: PersonRelationshipKind;
  affinity: number;
  trust: number;
  respect: number;
  tension: number;
  updatedOn: ISODate;
  provenanceStatus: "SIMULATION_ONLY";
};

export type MentoringFocus = "TECHNICAL" | "TACTICAL" | "PROFESSIONALISM" | "LEADERSHIP";
export type MentoringStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

export type MentoringAssignment = {
  id: EntityId;
  mentorPersonId: EntityId;
  menteePersonId: EntityId;
  teamId: EntityId;
  focus: MentoringFocus;
  startDate: ISODate;
  endDate?: ISODate;
  progress: number;
  status: MentoringStatus;
  updatedOn: ISODate;
  provenanceStatus: "SIMULATION_ONLY";
};
