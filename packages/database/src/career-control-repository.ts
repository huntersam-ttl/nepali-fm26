import type { CareerRole, EntityId } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

export type CareerControlContext = { personId: EntityId; activeRole: CareerRole };

export class CareerControlRepository {
  constructor(private readonly db: GameDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS career_control_context (
      person_id TEXT PRIMARY KEY REFERENCES persons(id), active_role TEXT NOT NULL
    )`);
  }
  get(personId: EntityId): CareerControlContext | undefined {
    const row = this.db.prepare("SELECT person_id, active_role FROM career_control_context WHERE person_id = ?").get(personId) as { person_id: EntityId; active_role: CareerRole } | undefined;
    return row ? { personId: row.person_id, activeRole: row.active_role } : undefined;
  }
  upsert(value: CareerControlContext): void {
    this.db.prepare(`INSERT INTO career_control_context (person_id, active_role) VALUES (?, ?)
      ON CONFLICT(person_id) DO UPDATE SET active_role = excluded.active_role`).run(value.personId, value.activeRole);
  }
}
