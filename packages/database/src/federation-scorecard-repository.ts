import type { GameDatabase } from "./connection.js";
import type { EntityId, NationDevelopmentSnapshot } from "@nepal-football-sim/shared-types";

/**
 * Annual Build-a-Nation development snapshots. One row per federation per
 * season — never one per tick — so history stays a readable trend line
 * instead of a snapshot explosion. UNIQUE(federation_id, season_label) is
 * the real dedupe guard (not just an app-level id check).
 */
export class FederationScorecardRepository {
  constructor(private readonly db: GameDatabase) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS federation_development_snapshots (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL,
        season_label TEXT NOT NULL,
        as_of_date TEXT NOT NULL,
        overall_score INTEGER NOT NULL,
        categories_json TEXT NOT NULL,
        provenance_status TEXT NOT NULL,
        UNIQUE(federation_id, season_label)
      );
      CREATE INDEX IF NOT EXISTS idx_federation_snapshots_federation
        ON federation_development_snapshots(federation_id, as_of_date);
    `);
  }

  upsertSnapshot(snapshot: NationDevelopmentSnapshot & { id: EntityId }): void {
    this.db
      .prepare(
        `INSERT INTO federation_development_snapshots
          (id, federation_id, season_label, as_of_date, overall_score, categories_json, provenance_status)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(federation_id, season_label) DO NOTHING`,
      )
      .run(
        snapshot.id,
        snapshot.federationId,
        snapshot.seasonLabel,
        snapshot.asOfDate,
        snapshot.overallScore,
        JSON.stringify(snapshot.categories),
        snapshot.provenanceStatus,
      );
  }

  snapshots(federationId: EntityId): NationDevelopmentSnapshot[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM federation_development_snapshots WHERE federation_id=? ORDER BY as_of_date",
      )
      .all(federationId) as Array<{
      federation_id: EntityId;
      season_label: string;
      as_of_date: string;
      overall_score: number;
      categories_json: string;
      provenance_status: "SIMULATION_ONLY";
    }>;
    return rows.map((row) => ({
      federationId: row.federation_id,
      seasonLabel: row.season_label,
      asOfDate: row.as_of_date,
      overallScore: row.overall_score,
      categories: JSON.parse(row.categories_json) as Record<string, number>,
      provenanceStatus: row.provenance_status,
    }));
  }
}
