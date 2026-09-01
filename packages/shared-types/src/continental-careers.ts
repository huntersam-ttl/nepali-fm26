import type { EntityId } from "./ids.js";
import type { ISODate, JobApplicationStatus, StaffAppointment, StaffVacancy } from "./domain.js";
import type { PersonPersonalityProfile, PersonRelationship } from "./people-foundation.js";

export type ContinentalResult = {
  associationId: EntityId;
  clubId: EntityId;
  seasonLabel: string;
  resultPoints: number;
  matches: number;
  completedOn: ISODate;
  provenanceStatus: "SIMULATION_ONLY";
};

export type ContinentalCoefficientSnapshot = {
  id: EntityId;
  associationId: EntityId;
  seasonLabel: string;
  coefficient: number;
  resultPoints: number;
  participatingClubs: number;
  rollingWindow: number[];
  calculatedOn: ISODate;
  provenanceStatus: "SIMULATION_ONLY";
};

export type ManagerJobMarketStage =
  | "APPLICATION"
  | "INTERVIEW"
  | "SHORTLIST"
  | "OFFER"
  | "NEGOTIATION"
  | "ACCEPTED"
  | "REJECTED"
  | "WITHDRAWN";

export type ManagerJobMarketReadModel = {
  vacancyId: EntityId;
  managerProfileId: EntityId;
  stage: ManagerJobMarketStage;
  status: JobApplicationStatus;
  fitLabel: "STRONG" | "POSSIBLE" | "WEAK";
  rationale: string[];
  humanDecisionRequired: boolean;
};

export type StaffPersonalityClues = {
  professionalism: "LOW" | "STEADY" | "HIGH";
  ambition: "LOW" | "MODERATE" | "HIGH";
  loyalty: "LOW" | "STEADY" | "HIGH";
  adaptability: "LOW" | "STEADY" | "HIGH";
};

export type BackroomAtmosphere = "ALIGNED" | "NEUTRAL" | "STRAINED" | "CONFLICT";

export type BackroomSummary = {
  clubId: EntityId;
  atmosphere: BackroomAtmosphere;
  activeStaff: number;
  alignedRelationships: number;
  strainedRelationships: number;
  clue: string;
};

export type StaffJobCandidateInput = {
  personId: EntityId;
  vacancy: StaffVacancy;
  personality?: PersonPersonalityProfile;
  currentAppointment?: StaffAppointment;
  clubFit: number;
  offeredSalaryMinor: number;
  currentSalaryMinor?: number;
  jobSecurity: number;
};

export type StaffJobDecision = "ACCEPT" | "DECLINE" | "WAIT";
