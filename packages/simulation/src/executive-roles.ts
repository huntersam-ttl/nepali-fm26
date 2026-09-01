import {
  ExecutiveRoleRepository,
  StaffMarketRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type EntityId,
  type ExecutiveAuthority,
  type ExecutiveCandidateInput,
  type ExecutiveCandidateRanking,
  type ExecutiveJobListing,
  type ExecutiveRole,
  type ExecutiveRoleAssignment,
  type ExecutiveRoleReadModel,
  type StaffAppointment,
  type StaffVacancy,
} from "@nepal-football-sim/shared-types";
import { isContextOnlyClub } from "./foreign-football-world.js";

import { executiveAuthorities } from "@nepal-football-sim/shared-types";
export { executiveAuthorities } from "@nepal-football-sim/shared-types";
const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

export const executiveRoleForStaffRole = (role: string): ExecutiveRole | undefined =>
  role === "SPORTING_DIRECTOR" ||
  role === "DIRECTOR_OF_FOOTBALL" ||
  role === "CEO" ||
  role === "GENERAL_SECRETARY"
    ? role
    : undefined;

export const rankExecutiveCandidate = (
  input: ExecutiveCandidateInput,
): ExecutiveCandidateRanking => {
  const fitScore = clamp(
    input.reputation * 0.2 +
      input.experience * 0.2 +
      input.clubVisionFit * 0.25 +
      input.relationshipFit * 0.15 +
      input.budgetDiscipline * 0.2,
  );
  const rationale = [
    input.clubVisionFit >= 65 ? "Club-vision fit is strong." : "Club-vision fit needs review.",
    input.budgetDiscipline >= 65
      ? "Budget discipline matches the club's control needs."
      : "Budget discipline is a concern.",
    input.relationshipFit >= 65
      ? "Existing relationships support cooperation."
      : "The working relationship may need building.",
  ];
  return { ...input, fitScore, rationale };
};

export const executiveJobListing = (
  vacancy: StaffVacancy,
  ranking: ExecutiveCandidateRanking,
): ExecutiveJobListing => ({
  vacancy,
  role: ranking.role,
  fitScore: ranking.fitScore,
  rationale: ranking.rationale,
});

export const canExecutiveAct = (request: {
  role: ExecutiveRole | "MANAGER" | "OWNER" | "CHAIRMAN";
  authority: ExecutiveAuthority;
  assignment?: ExecutiveRoleAssignment;
}): boolean => {
  if (request.role === "OWNER" || request.role === "CHAIRMAN") return true;
  if (request.role === "MANAGER") return request.authority === "SQUAD_PLANNING";
  return (
    executiveAuthorities[request.role].includes(request.authority) &&
    request.assignment?.status === "FILLED"
  );
};

export class ExecutiveRoleError extends Error {
  constructor(
    readonly code:
      | "CONTEXT_ONLY_CLUB"
      | "MAJORITY_CONTROL_REQUIRED"
      | "APPOINTMENT_INVALID"
      | "AUTHORITY_DENIED",
    message: string,
  ) {
    super(message);
  }
}

const hasMajorityControl = (db: GameDatabase, clubId: EntityId, ownerPersonId: EntityId): boolean =>
  Boolean(
    db
      .prepare(
        "SELECT 1 FROM club_ownership_stakes WHERE club_id=? AND holder_type='PERSON' AND holder_id=? AND status='ACTIVE' AND voting_percentage>=51 LIMIT 1",
      )
      .get(clubId, ownerPersonId),
  );

/** Owner/Chairman-only mutation. Existing staff appointments remain the source of truth for the person and employment. */
export const assignExecutiveRole = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    ownerPersonId: EntityId;
    role: ExecutiveRole;
    appointment?: StaffAppointment;
    date: string;
  },
): ExecutiveRoleAssignment => {
  if (isContextOnlyClub(db, input.clubId))
    throw new ExecutiveRoleError(
      "CONTEXT_ONLY_CLUB",
      "Context-only clubs cannot receive detailed executive staffing.",
    );
  if (!hasMajorityControl(db, input.clubId, input.ownerPersonId))
    throw new ExecutiveRoleError(
      "MAJORITY_CONTROL_REQUIRED",
      "Majority control is required to assign club executives.",
    );
  if (
    input.appointment &&
    (input.appointment.employmentStatus !== "ACTIVE" ||
      input.appointment.clubId !== input.clubId ||
      executiveRoleForStaffRole(input.appointment.role) !== input.role)
  )
    throw new ExecutiveRoleError(
      "APPOINTMENT_INVALID",
      "The appointment does not match this club executive role.",
    );
  const assignment: ExecutiveRoleAssignment = {
    id: createStableEntityId("executive-role", `${input.clubId}:${input.role}`),
    clubId: input.clubId,
    role: input.role,
    personId: input.appointment?.personId,
    appointmentId: input.appointment?.id,
    status: input.appointment ? "FILLED" : "VACANT",
    assignedOn: input.date,
    provenanceStatus: "SIMULATION_ONLY",
  };
  new ExecutiveRoleRepository(db).upsert(assignment);
  return assignment;
};

export const executiveRoleReadModel = (
  db: GameDatabase,
  clubId: EntityId,
  role: ExecutiveRole,
): ExecutiveRoleReadModel => {
  const assignment = new ExecutiveRoleRepository(db).role(clubId, role) ?? {
    id: createStableEntityId("executive-role", `${clubId}:${role}`),
    clubId,
    role,
    status: "VACANT" as const,
    assignedOn: "1970-01-01",
    provenanceStatus: "SIMULATION_ONLY" as const,
  };
  const appointment = assignment.appointmentId
    ? new StaffMarketRepository(db).appointmentById(assignment.appointmentId)
    : undefined;
  const person = appointment
    ? (db.prepare("SELECT full_name FROM persons WHERE id=?").get(appointment.personId) as
        { full_name?: string } | undefined)
    : undefined;
  return {
    ...assignment,
    authorities: executiveAuthorities[role],
    personName: person?.full_name,
    rationale:
      assignment.status === "FILLED"
        ? "A current staff appointment holds this executive role."
        : "This role is vacant; the club can operate with existing manager authority.",
  };
};
