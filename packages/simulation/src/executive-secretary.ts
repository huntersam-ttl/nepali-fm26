import {
  ClubLicensingRepository,
  StaffMarketRepository,
  TransferMarketRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import type {
  EntityId,
  ExecutiveAuthority,
  SaveMetadata,
  SecretaryContractRow,
  SecretaryLicensingCase,
  SecretaryOperationsDesk,
  SecretaryRegistrationRow,
  SecretaryStaffRow,
} from "@nepal-football-sim/shared-types";
import { executiveHasAuthority } from "./executive-roles.js";

/**
 * The general secretary's operations desk.
 *
 * GENERAL_SECRETARY holds CONTRACT_ADMINISTRATION, LICENSING,
 * COMPETITION_REGISTRATION and STAFF_RECRUITMENT. Every one of those already
 * has a canonical command on the desktop service (closeExecutiveLicence,
 * registerExecutiveCompetitionPlayers, hireExecutiveStaff,
 * dismissExecutiveStaff) — what was missing was any surface showing the
 * secretary WHAT needs administering, so the role listed four powers with
 * nothing to point them at.
 *
 * This is a read model over the canonical licence cases, competition
 * registrations, player contracts and staff appointment/vacancy records. It
 * creates no licensing, registration or contract state of its own, and each
 * section is gated by the same `executiveHasAuthority` delegation check the
 * rest of the executive model uses — never by role name.
 */

const nameOf = (db: GameDatabase, personId: EntityId): string => {
  const row = db.prepare("SELECT display_name, full_name FROM persons WHERE id = ?").get(personId) as
    | { display_name?: string; full_name?: string }
    | undefined;
  return row?.display_name ?? row?.full_name ?? "Unnamed person";
};

const clubLabel = (db: GameDatabase, clubId: EntityId): string => {
  const row = db.prepare("SELECT name FROM clubs WHERE id = ?").get(clubId) as
    | { name?: string }
    | undefined;
  return row?.name ?? "Unlisted club";
};

const addDays = (date: string, days: number): string => {
  const next = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

export const buildSecretaryOperationsDesk = (
  db: GameDatabase,
  save: SaveMetadata,
  clubId: EntityId,
  personId: EntityId,
): SecretaryOperationsDesk => {
  const authorities: ExecutiveAuthority[] = (
    [
      "CONTRACT_ADMINISTRATION",
      "LICENSING",
      "COMPETITION_REGISTRATION",
      "STAFF_RECRUITMENT",
    ] as const
  ).filter((authority) => executiveHasAuthority(db, clubId, personId, authority));

  const base = {
    clubId,
    clubName: clubLabel(db, clubId),
    authorities,
    contracts: [] as SecretaryContractRow[],
    licensing: [] as SecretaryLicensingCase[],
    registrations: [] as SecretaryRegistrationRow[],
    staff: [] as SecretaryStaffRow[],
    openVacancies: 0,
  };
  if (authorities.length === 0) {
    return {
      ...base,
      blockedReason:
        "This role holds no club administration authority, so there is no operations desk to work from.",
    };
  }

  const market = new TransferMarketRepository(db);

  /**
   * Contract administration is paperwork, not recruitment: a contract that
   * runs out inside the window is the secretary's problem whether or not the
   * club intends to renew it.
   */
  const contracts = authorities.includes("CONTRACT_ADMINISTRATION")
    ? market
        .contractsExpiringBetween(save.worldDate, addDays(save.worldDate, 120))
        .filter((contract) => contract.clubId === clubId)
        .map((contract) => ({
          playerId: contract.playerId,
          playerName: nameOf(db, contract.playerId),
          endDate: contract.endDate,
          contractType: contract.contractType,
        }))
        .sort((a, b) => a.endDate.localeCompare(b.endDate))
    : [];

  const licensing = authorities.includes("LICENSING")
    ? new ClubLicensingRepository(db)
        .cases()
        .filter((item) => item.clubId === clubId)
        .map((item) => ({
          caseId: item.id,
          seasonLabel: item.seasonLabel,
          status: item.status,
          // Only outstanding requirements are the secretary's work.
          outstanding: item.remediation
            .filter((task) => !task.completed)
            .map((task) => ({ requirement: task.requirement, deadline: task.deadline })),
          sanctions: item.sanctions,
          // Closing a cycle is only meaningful while it is still open.
          canClose: item.status !== "RESOLVED" && item.status !== "PASSED",
        }))
        .sort((a, b) => b.seasonLabel.localeCompare(a.seasonLabel))
    : [];

  /**
   * Registration status per club team: how many of the team's players hold an
   * ACTIVE registration. A women's or youth team with players but no
   * registrations is exactly the gap the secretary's registration command
   * closes.
   */
  let registrations: SecretaryRegistrationRow[] = [];
  if (authorities.includes("COMPETITION_REGISTRATION")) {
    const active = new Set(
      market
        .competitionRegistrations()
        .filter((item) => item.clubId === clubId && item.status === "ACTIVE")
        .map((item) => `${item.playerId}`),
    );
    const teams = db
      .prepare("SELECT id, name, gender, level FROM teams WHERE club_id = ? ORDER BY name")
      .all(clubId) as Array<{ id: EntityId; name: string; gender: string; level: string }>;
    registrations = teams.map((team) => {
      const squad = db
        .prepare(
          `SELECT DISTINCT person_id AS id FROM team_person_assignments
           WHERE team_id = ? AND role = 'PLAYER' AND ended_on IS NULL`,
        )
        .all(team.id) as Array<{ id: EntityId }>;
      const registered = squad.filter((row) => active.has(row.id)).length;
      return {
        teamId: team.id,
        teamName: team.name,
        gender: team.gender,
        level: team.level,
        squadSize: squad.length,
        registeredPlayers: registered,
        // Registration is a women's/youth competition command; a senior men's
        // side is registered through the competition system, not here.
        registrable: squad.length > 0 && registered < squad.length && team.gender === "women",
      };
    });
  }

  const staffRepo = new StaffMarketRepository(db);
  const staff = authorities.includes("STAFF_RECRUITMENT")
    ? staffRepo
        .activeAppointmentsForClub(clubId)
        .map((appointment) => ({
          appointmentId: appointment.id,
          personId: appointment.personId,
          personName: nameOf(db, appointment.personId),
          role: appointment.role,
          startDate: appointment.startDate,
        }))
        .sort((a, b) => a.role.localeCompare(b.role) || a.personName.localeCompare(b.personName))
    : [];
  const openVacancies = authorities.includes("STAFF_RECRUITMENT")
    ? staffRepo.openVacanciesForClub(clubId).filter((item) => item.status === "VACANT").length
    : 0;

  return { ...base, contracts, licensing, registrations, staff, openVacancies };
};
