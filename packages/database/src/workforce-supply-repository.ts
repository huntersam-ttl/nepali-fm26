import type {
  EntityId,
  OfficialSimulationProfile,
  WorkforceDemandSnapshot,
  WorkforceIntakeEvent,
} from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const j = (value: unknown) => JSON.stringify(value);

const official = (r: any): OfficialSimulationProfile => ({
  ...JSON.parse(r.data_json),
  personId: r.person_id,
  role: r.role,
  level: r.level,
  status: r.status,
});
const intake = (r: any): WorkforceIntakeEvent => ({
  id: r.id,
  seasonLabel: r.season_label,
  kind: r.kind,
  contextKey: r.context_key,
  generatedOn: r.generated_on,
  generatedCount: r.generated_count,
  provenanceStatus: "SIMULATION_ONLY",
});

/**
 * Persistence for the workforce-supply layer: officiating career state, the
 * generation idempotency ledger, and archived demand snapshots.
 */
export class WorkforceSupplyRepository {
  constructor(private readonly db: GameDatabase) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS official_simulation_profiles (
        person_id TEXT PRIMARY KEY, role TEXT NOT NULL, level INTEGER NOT NULL,
        status TEXT NOT NULL, data_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workforce_intake_events (
        id TEXT PRIMARY KEY, season_label TEXT NOT NULL, kind TEXT NOT NULL,
        context_key TEXT NOT NULL, generated_on TEXT NOT NULL, generated_count INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workforce_intake_unique
        ON workforce_intake_events(season_label, kind, context_key);
      CREATE TABLE IF NOT EXISTS workforce_demand_snapshots (
        season_label TEXT NOT NULL, snapshot_date TEXT NOT NULL, data_json TEXT NOT NULL,
        PRIMARY KEY (season_label, snapshot_date));
    `);
  }

  upsertOfficial(value: OfficialSimulationProfile): void {
    this.db
      .prepare(
        `INSERT INTO official_simulation_profiles (person_id,role,level,status,data_json) VALUES (?,?,?,?,?)
         ON CONFLICT(person_id) DO UPDATE SET role=excluded.role,level=excluded.level,status=excluded.status,data_json=excluded.data_json`,
      )
      .run(value.personId, value.role, value.level, value.status, j(value));
  }

  official(personId: EntityId): OfficialSimulationProfile | undefined {
    const row = this.db
      .prepare("SELECT * FROM official_simulation_profiles WHERE person_id = ?")
      .get(personId) as any;
    return row ? official(row) : undefined;
  }

  officials(status?: OfficialSimulationProfile["status"]): OfficialSimulationProfile[] {
    const rows = (
      status
        ? this.db
            .prepare(
              "SELECT * FROM official_simulation_profiles WHERE status = ? ORDER BY person_id",
            )
            .all(status)
        : this.db.prepare("SELECT * FROM official_simulation_profiles ORDER BY person_id").all()
    ) as any[];
    return rows.map(official);
  }

  activeOfficials(role?: OfficialSimulationProfile["role"]): OfficialSimulationProfile[] {
    const rows = (
      role
        ? this.db
            .prepare(
              "SELECT * FROM official_simulation_profiles WHERE status = 'ACTIVE' AND role = ? ORDER BY person_id",
            )
            .all(role)
        : this.db
            .prepare(
              "SELECT * FROM official_simulation_profiles WHERE status = 'ACTIVE' ORDER BY person_id",
            )
            .all()
    ) as any[];
    return rows.map(official);
  }

  /** Returns false when this (season, kind, context) intake already happened. */
  claimIntake(value: WorkforceIntakeEvent): boolean {
    const existing = this.db
      .prepare(
        "SELECT id FROM workforce_intake_events WHERE season_label = ? AND kind = ? AND context_key = ?",
      )
      .get(value.seasonLabel, value.kind, value.contextKey) as { id?: string } | undefined;
    if (existing) return false;
    this.db
      .prepare(
        "INSERT INTO workforce_intake_events (id,season_label,kind,context_key,generated_on,generated_count) VALUES (?,?,?,?,?,?)",
      )
      .run(
        value.id,
        value.seasonLabel,
        value.kind,
        value.contextKey,
        value.generatedOn,
        value.generatedCount,
      );
    return true;
  }

  recordIntakeCount(id: EntityId, generatedCount: number): void {
    this.db
      .prepare("UPDATE workforce_intake_events SET generated_count = ? WHERE id = ?")
      .run(Math.max(0, Math.round(generatedCount)), id);
  }

  intakeEvents(seasonLabel?: string): WorkforceIntakeEvent[] {
    const rows = (
      seasonLabel
        ? this.db
            .prepare(
              "SELECT * FROM workforce_intake_events WHERE season_label = ? ORDER BY kind, context_key",
            )
            .all(seasonLabel)
        : this.db
            .prepare(
              "SELECT * FROM workforce_intake_events ORDER BY season_label, kind, context_key",
            )
            .all()
    ) as any[];
    return rows.map(intake);
  }

  upsertDemandSnapshot(value: WorkforceDemandSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO workforce_demand_snapshots (season_label,snapshot_date,data_json) VALUES (?,?,?)
         ON CONFLICT(season_label,snapshot_date) DO UPDATE SET data_json=excluded.data_json`,
      )
      .run(value.seasonLabel, value.date, j(value));
  }

  demandSnapshot(seasonLabel: string): WorkforceDemandSnapshot | undefined {
    const row = this.db
      .prepare(
        "SELECT data_json FROM workforce_demand_snapshots WHERE season_label = ? ORDER BY snapshot_date DESC LIMIT 1",
      )
      .get(seasonLabel) as { data_json?: string } | undefined;
    return row?.data_json ? (JSON.parse(row.data_json) as WorkforceDemandSnapshot) : undefined;
  }
}
