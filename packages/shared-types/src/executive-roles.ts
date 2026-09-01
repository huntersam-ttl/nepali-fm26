import type { EntityId } from "./ids.js";
import type { ISODate, StaffAppointment, StaffVacancy } from "./domain.js";

export type ExecutiveRole =
  "SPORTING_DIRECTOR" | "DIRECTOR_OF_FOOTBALL" | "CEO" | "GENERAL_SECRETARY";
export type ExecutiveAuthority =
  | "RECRUITMENT_STRATEGY"
  | "SCOUTING_OVERSIGHT"
  | "TRANSFER_NEGOTIATION"
  | "PLAYER_CONTRACTS"
  | "STAFF_RECRUITMENT"
  | "LOAN_STRATEGY"
  | "SQUAD_PLANNING"
  | "CONTRACT_ADMINISTRATION"
  | "COMMERCIAL_OVERSIGHT"
  | "LICENSING"
  | "COMPETITION_REGISTRATION";

export type ExecutiveRoleAssignment = {
  id: EntityId;
  clubId: EntityId;
  role: ExecutiveRole;
  personId?: EntityId;
  appointmentId?: EntityId;
  status: "FILLED" | "VACANT";
  assignedOn: ISODate;
  provenanceStatus: "SIMULATION_ONLY";
};

export type ExecutiveRoleReadModel = ExecutiveRoleAssignment & {
  authorities: ExecutiveAuthority[];
  personName?: string;
  rationale: string;
};

export type ExecutiveCandidateInput = {
  personId: EntityId;
  role: ExecutiveRole;
  reputation: number;
  experience: number;
  clubVisionFit: number;
  relationshipFit: number;
  budgetDiscipline: number;
};

export type ExecutiveCandidateRanking = ExecutiveCandidateInput & {
  fitScore: number;
  rationale: string[];
};

export type ExecutiveAuthorityRequest = {
  role: ExecutiveRole | "MANAGER" | "OWNER" | "CHAIRMAN";
  authority: ExecutiveAuthority;
  assignment?: ExecutiveRoleAssignment;
};

export type ExecutiveJobListing = {
  vacancy: StaffVacancy;
  role: ExecutiveRole;
  fitScore: number;
  rationale: string[];
};

export const executiveAuthorities: Record<ExecutiveRole, ExecutiveAuthority[]> = {
  SPORTING_DIRECTOR: [
    "RECRUITMENT_STRATEGY",
    "SCOUTING_OVERSIGHT",
    "TRANSFER_NEGOTIATION",
    "PLAYER_CONTRACTS",
    "STAFF_RECRUITMENT",
    "LOAN_STRATEGY",
    "SQUAD_PLANNING",
  ],
  DIRECTOR_OF_FOOTBALL: [
    "RECRUITMENT_STRATEGY",
    "SCOUTING_OVERSIGHT",
    "TRANSFER_NEGOTIATION",
    "PLAYER_CONTRACTS",
    "STAFF_RECRUITMENT",
    "LOAN_STRATEGY",
    "SQUAD_PLANNING",
  ],
  CEO: [
    "CONTRACT_ADMINISTRATION",
    "COMMERCIAL_OVERSIGHT",
    "LICENSING",
    "COMPETITION_REGISTRATION",
    "STAFF_RECRUITMENT",
  ],
  GENERAL_SECRETARY: [
    "CONTRACT_ADMINISTRATION",
    "LICENSING",
    "COMPETITION_REGISTRATION",
    "STAFF_RECRUITMENT",
  ],
};
