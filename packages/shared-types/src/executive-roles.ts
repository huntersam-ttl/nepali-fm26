import type { EntityId } from "./ids.js";
import type { CareerRole } from "./desktop-contract.js";
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
  | "COMPETITION_REGISTRATION"
  | "FACILITY_OVERSIGHT"
  | "BUDGET_ADMINISTRATION";

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

export type ExecutiveAuthorityDesktopView = {
  actorPersonId: EntityId;
  actorRole: CareerRole;
  clubId: EntityId;
  assignment: ExecutiveRoleReadModel;
  permittedActions: ExecutiveAuthority[];
  blockedReason?: string;
};

/**
 * The recruitment desk a SPORTING_DIRECTOR / DIRECTOR_OF_FOOTBALL actually
 * works from. It is a read model over the canonical transfer, loan and
 * contract records — never a second transfer engine — so the desk shows the
 * same offers the manager's Transfer Centre shows, from the club's side.
 */
export type ExecutiveRecruitmentRow = {
  offerId: EntityId;
  playerId: EntityId;
  playerName: string;
  direction: "IN" | "OUT";
  otherClubName: string;
  fee: number;
  status: string;
  expiresAt: ISODate;
  /** True when this executive may open the negotiation, not merely read it. */
  canNegotiate: boolean;
};

export type ExecutiveLoanRow = {
  playerId: EntityId;
  playerName: string;
  direction: "IN" | "OUT";
  otherClubName: string;
  endDate: ISODate;
};

export type ExecutiveContractRow = {
  playerId: EntityId;
  playerName: string;
  endDate: ISODate;
  /** Monthly wage — the unit `player_contracts.salary` is expressed in. */
  monthlyWage: number;
};

export type ExecutiveRecruitmentDesk = {
  clubId: EntityId;
  clubName: string;
  /** Authorities that actually back the surfaces on this desk. */
  authorities: ExecutiveAuthority[];
  negotiations: ExecutiveRecruitmentRow[];
  loans: ExecutiveLoanRow[];
  expiringContracts: ExecutiveContractRow[];
  squadSize: number;
  blockedReason?: string;
};

/**
 * The general secretary's operations desk — the administrative counterpart to
 * the recruitment desk. Every row is a canonical licence case, competition
 * registration, player contract or staff appointment.
 */
export type SecretaryContractRow = {
  playerId: EntityId;
  playerName: string;
  endDate: ISODate;
  contractType: string;
};

export type SecretaryLicensingCase = {
  caseId: EntityId;
  seasonLabel: string;
  status: string;
  outstanding: { requirement: string; deadline: ISODate }[];
  sanctions: string[];
  /** True while the licence cycle is still open and can be closed. */
  canClose: boolean;
};

export type SecretaryRegistrationRow = {
  teamId: EntityId;
  teamName: string;
  gender: string;
  level: string;
  squadSize: number;
  registeredPlayers: number;
  /** True when the secretary's registration command applies to this team. */
  registrable: boolean;
};

export type SecretaryStaffRow = {
  appointmentId: EntityId;
  personId: EntityId;
  personName: string;
  role: string;
  startDate?: ISODate;
};

export type SecretaryOperationsDesk = {
  clubId: EntityId;
  clubName: string;
  authorities: ExecutiveAuthority[];
  contracts: SecretaryContractRow[];
  licensing: SecretaryLicensingCase[];
  registrations: SecretaryRegistrationRow[];
  staff: SecretaryStaffRow[];
  openVacancies: number;
  blockedReason?: string;
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
    "BUDGET_ADMINISTRATION",
    "COMMERCIAL_OVERSIGHT",
    "LICENSING",
    "COMPETITION_REGISTRATION",
    "FACILITY_OVERSIGHT",
    "STAFF_RECRUITMENT",
  ],
  GENERAL_SECRETARY: [
    "CONTRACT_ADMINISTRATION",
    "LICENSING",
    "COMPETITION_REGISTRATION",
    "STAFF_RECRUITMENT",
  ],
};
