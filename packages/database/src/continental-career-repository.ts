import type { ContinentalCoefficientSnapshot } from "@nepal-football-sim/shared-types";
import type { EntityId } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

export class ContinentalCareerRepository {
  constructor(private readonly db: GameDatabase) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS continental_coefficient_snapshots (
      id TEXT PRIMARY KEY, association_id TEXT NOT NULL, season_label TEXT NOT NULL,
      coefficient REAL NOT NULL, result_points REAL NOT NULL, participating_clubs INTEGER NOT NULL,
      rolling_window_json TEXT NOT NULL, club_contributions_json TEXT NOT NULL DEFAULT '{}', calculated_on TEXT NOT NULL, provenance_status TEXT NOT NULL,
      UNIQUE(association_id, season_label)
    ); CREATE INDEX IF NOT EXISTS idx_continental_coefficients_association
      ON continental_coefficient_snapshots(association_id, season_label);`);
  }

  upsert(snapshot: ContinentalCoefficientSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO continental_coefficient_snapshots
      (id, association_id, season_label, coefficient, result_points, participating_clubs, rolling_window_json, club_contributions_json, calculated_on, provenance_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(association_id, season_label) DO UPDATE SET coefficient=excluded.coefficient,
      result_points=excluded.result_points, participating_clubs=excluded.participating_clubs,
      rolling_window_json=excluded.rolling_window_json, calculated_on=excluded.calculated_on`,
      )
      .run(
        snapshot.id,
        snapshot.associationId,
        snapshot.seasonLabel,
        snapshot.coefficient,
        snapshot.resultPoints,
        snapshot.participatingClubs,
        JSON.stringify(snapshot.rollingWindow),
        JSON.stringify(snapshot.clubContributions),
        snapshot.calculatedOn,
        snapshot.provenanceStatus,
      );
  }

  snapshots(associationId: EntityId): ContinentalCoefficientSnapshot[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM continental_coefficient_snapshots WHERE association_id = ? ORDER BY season_label",
        )
        .all(associationId) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: row.id as EntityId,
      associationId: row.association_id as EntityId,
      seasonLabel: String(row.season_label),
      coefficient: Number(row.coefficient),
      resultPoints: Number(row.result_points),
      participatingClubs: Number(row.participating_clubs),
      clubContributions: JSON.parse(String(row.club_contributions_json ?? "{}")) as Record<
        EntityId,
        number
      >,
      rollingWindow: JSON.parse(String(row.rolling_window_json)) as number[],
      calculatedOn: String(row.calculated_on),
      provenanceStatus: "SIMULATION_ONLY",
    }));
  }
}
