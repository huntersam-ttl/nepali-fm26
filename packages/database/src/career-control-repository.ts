import type { CareerRole, EntityId } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

export type BaseCareerRole = "MANAGER" | "CHAIRMAN_OWNER";
export type CareerControlContext = {
  personId: EntityId;
  activeRole: CareerRole;
  /**
   * The persistent career the player returns to after a temporary elected
   * federation presidency ends. Older saves may not have this value yet;
   * simulation code derives it safely from genuinely held roles.
   */
  baseRole?: BaseCareerRole;
};

export class CareerControlRepository {
  constructor(private readonly db: GameDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS career_control_context (
      person_id TEXT PRIMARY KEY REFERENCES persons(id),
      active_role TEXT NOT NULL,
      base_role TEXT
    )`);

    // career_control_context predates the base-career model and is created by
    // this repository rather than the global schema migration. Upgrade it in
    // place so existing saves remain readable without a destructive migration.
    const columns = this.db.prepare("PRAGMA table_info(career_control_context)").all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "base_role")) {
      this.db.exec("ALTER TABLE career_control_context ADD COLUMN base_role TEXT");
    }
  }

  get(personId: EntityId): CareerControlContext | undefined {
    const row = this.db
      .prepare(
        "SELECT person_id, active_role, base_role FROM career_control_context WHERE person_id = ?",
      )
      .get(personId) as
      | {
          person_id: EntityId;
          active_role: CareerRole;
          base_role?: BaseCareerRole | null;
        }
      | undefined;
    return row
      ? {
          personId: row.person_id,
          activeRole: row.active_role,
          baseRole: row.base_role ?? undefined,
        }
      : undefined;
  }

  upsert(value: CareerControlContext): void {
    this.db
      .prepare(`INSERT INTO career_control_context (person_id, active_role, base_role) VALUES (?, ?, ?)
        ON CONFLICT(person_id) DO UPDATE SET
          active_role = excluded.active_role,
          base_role = COALESCE(excluded.base_role, career_control_context.base_role)`)
      .run(value.personId, value.activeRole, value.baseRole ?? null);
  }
}
