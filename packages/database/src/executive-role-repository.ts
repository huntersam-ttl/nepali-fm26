import type { EntityId } from "@nepal-football-sim/shared-types";
import type { ExecutiveRole, ExecutiveRoleAssignment } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

export class ExecutiveRoleRepository {
  constructor(private readonly db: GameDatabase) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS club_executive_roles (
      id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id), role TEXT NOT NULL,
      person_id TEXT REFERENCES persons(id), appointment_id TEXT REFERENCES staff_appointments(id),
      status TEXT NOT NULL, assigned_on TEXT NOT NULL, provenance_status TEXT NOT NULL,
      UNIQUE(club_id, role)
    );`);
  }

  upsert(value: ExecutiveRoleAssignment): void {
    this.db
      .prepare(
        `INSERT INTO club_executive_roles (id,club_id,role,person_id,appointment_id,status,assigned_on,provenance_status)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(club_id,role) DO UPDATE SET person_id=excluded.person_id,
      appointment_id=excluded.appointment_id,status=excluded.status,assigned_on=excluded.assigned_on`,
      )
      .run(
        value.id,
        value.clubId,
        value.role,
        value.personId ?? null,
        value.appointmentId ?? null,
        value.status,
        value.assignedOn,
        value.provenanceStatus,
      );
  }

  role(clubId: EntityId, role: ExecutiveRole): ExecutiveRoleAssignment | undefined {
    const row = this.db
      .prepare("SELECT * FROM club_executive_roles WHERE club_id=? AND role=?")
      .get(clubId, role) as Record<string, unknown> | undefined;
    return row ? this.map(row) : undefined;
  }

  rolesForClub(clubId: EntityId): ExecutiveRoleAssignment[] {
    return (
      this.db
        .prepare("SELECT * FROM club_executive_roles WHERE club_id=? ORDER BY role")
        .all(clubId) as Array<Record<string, unknown>>
    ).map((row) => this.map(row));
  }

  private map(row: Record<string, unknown>): ExecutiveRoleAssignment {
    return {
      id: row.id as EntityId,
      clubId: row.club_id as EntityId,
      role: row.role as ExecutiveRole,
      personId: (row.person_id as EntityId | null) ?? undefined,
      appointmentId: (row.appointment_id as EntityId | null) ?? undefined,
      status: row.status as ExecutiveRoleAssignment["status"],
      assignedOn: String(row.assigned_on),
      provenanceStatus: "SIMULATION_ONLY",
    };
  }
}
