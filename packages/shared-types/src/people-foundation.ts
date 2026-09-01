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

/** Derived coaching identity; source of truth remains ManagerProfile and people foundation. */
export type CoachingIdentity = {
  managerProfileId: EntityId;
  personId: EntityId;
  preferredStyle?: string;
  reputationProfile: string;
  reputation: number;
  archetype: PersonalityArchetype;
  strengths: string[];
  developmentFocus: string[];
  managerPlayerRelationships: number;
  averagePlayerTrust: number;
  averagePlayerTension: number;
  provenanceStatus: "SIMULATION_ONLY";
};

export type CoachingJobMarketListing = {
  vacancyId: EntityId;
  teamId: EntityId;
  boardExpectation: string;
  eligible: boolean;
  fitScore: number;
  rationale: string[];
};

export type PlayerLifestyleProfile = {
  personId: EntityId;
  professionalismHabits: "INCONSISTENT" | "STEADY" | "ELITE";
  trainingDiscipline: "LOW" | "NORMAL" | "HIGH";
  mediaActivity: "LOW" | "MODERATE" | "HIGH";
  offFieldFocus: "FOOTBALL_FIRST" | "BALANCED" | "DISTRACTED";
  adaptation: number;
  provenanceStatus: "SIMULATION_ONLY";
};

export type SquadSocialGroup = {
  type: "FRIENDSHIP" | "MENTORSHIP" | "RIVALRY" | "DISTRUST" | "INFLUENTIAL";
  personIds: EntityId[];
  clue: string;
};

/** Derived current board brief; policy, finance, and AI decisions remain authoritative. */
export type ClubVision = {
  clubId: EntityId;
  objective: string;
  identity?: string;
  priorities: Record<string, number>;
  financialHealth?: string;
  financialRiskTolerance?: string;
  transferPhilosophy?: string;
  ownershipInfluence: number;
  updatedOn: ISODate;
  provenanceStatus: "SIMULATION_ONLY";
};

/** Read model for board politics; the board-confidence row and people graph remain canonical. */
export type BoardPoliticsSnapshot = {
  clubId: EntityId;
  managerProfileId: EntityId;
  confidence: number;
  relationshipTrust: number;
  relationshipTension: number;
  activePromises: number;
  brokenPromises: number;
  pressure: "LOW" | "MEDIUM" | "HIGH";
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
