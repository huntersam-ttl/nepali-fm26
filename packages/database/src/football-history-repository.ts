import type { EntityId } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

export type FootballRecord = {
  recordType: string;
  scopeId: EntityId;
  holderId: EntityId;
  value: number;
  achievedOn: string;
  sourceId: EntityId;
  provenanceStatus: "SIMULATION_ONLY";
};

export class FootballHistoryRepository {
  constructor(private readonly db: GameDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS football_records (
      record_type TEXT NOT NULL, scope_id TEXT NOT NULL, holder_id TEXT NOT NULL,
      value REAL NOT NULL, achieved_on TEXT NOT NULL, source_id TEXT NOT NULL,
      provenance_status TEXT NOT NULL, PRIMARY KEY (record_type, scope_id)
    );
    CREATE TABLE IF NOT EXISTS football_record_history (
      id TEXT PRIMARY KEY, record_type TEXT NOT NULL, scope_id TEXT NOT NULL,
      holder_id TEXT NOT NULL, value REAL NOT NULL, achieved_on TEXT NOT NULL,
      source_id TEXT NOT NULL, provenance_status TEXT NOT NULL
    );`);
  }

  record(record: FootballRecord): boolean {
    const current = this.db
      .prepare("SELECT value FROM football_records WHERE record_type=? AND scope_id=?")
      .get(record.recordType, record.scopeId) as { value?: number } | undefined;
    if (current && current.value !== undefined && current.value >= record.value) return false;
    const id = `${record.recordType}:${record.scopeId}:${record.sourceId}`;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO football_record_history
        (id,record_type,scope_id,holder_id,value,achieved_on,source_id,provenance_status)
        VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        record.recordType,
        record.scopeId,
        record.holderId,
        record.value,
        record.achievedOn,
        record.sourceId,
        record.provenanceStatus,
      );
    this.db
      .prepare(
        `INSERT INTO football_records
        (record_type,scope_id,holder_id,value,achieved_on,source_id,provenance_status)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(record_type,scope_id) DO UPDATE SET
        holder_id=excluded.holder_id,value=excluded.value,achieved_on=excluded.achieved_on,
        source_id=excluded.source_id,provenance_status=excluded.provenance_status`,
      )
      .run(
        record.recordType,
        record.scopeId,
        record.holderId,
        record.value,
        record.achievedOn,
        record.sourceId,
        record.provenanceStatus,
      );
    return true;
  }

  records(recordType?: string): FootballRecord[] {
    const rows = (
      recordType
        ? this.db
            .prepare("SELECT * FROM football_records WHERE record_type=? ORDER BY scope_id")
            .all(recordType)
        : this.db.prepare("SELECT * FROM football_records ORDER BY record_type,scope_id").all()
    ) as any[];
    return rows.map((row) => ({
      recordType: row.record_type,
      scopeId: row.scope_id,
      holderId: row.holder_id,
      value: row.value,
      achievedOn: row.achieved_on,
      sourceId: row.source_id,
      provenanceStatus: row.provenance_status,
    }));
  }

  recordHistory(recordType?: string): FootballRecord[] {
    const rows = (
      recordType
        ? this.db
            .prepare(
              "SELECT * FROM football_record_history WHERE record_type=? ORDER BY achieved_on,id",
            )
            .all(recordType)
        : this.db.prepare("SELECT * FROM football_record_history ORDER BY achieved_on,id").all()
    ) as any[];
    return rows.map((row) => ({
      recordType: row.record_type,
      scopeId: row.scope_id,
      holderId: row.holder_id,
      value: row.value,
      achievedOn: row.achieved_on,
      sourceId: row.source_id,
      provenanceStatus: row.provenance_status,
    }));
  }
}
