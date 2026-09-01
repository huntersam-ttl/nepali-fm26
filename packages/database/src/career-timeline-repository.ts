import type {
  CareerTimelineEvent,
  CareerTimelineFilter,
  EntityId,
} from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

export class CareerTimelineRepository {
  constructor(private readonly db: GameDatabase) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS career_timeline_events (
      id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES persons(id), occurred_on TEXT NOT NULL,
      role TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, importance TEXT NOT NULL,
      club_id TEXT, federation_id TEXT, source_entity_id TEXT, season_label TEXT, provenance_status TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_career_timeline_person_date ON career_timeline_events(person_id, occurred_on, id);`);
  }
  upsert(event: CareerTimelineEvent): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO career_timeline_events (id,person_id,occurred_on,role,category,title,importance,club_id,federation_id,source_entity_id,season_label,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        event.id,
        event.personId,
        event.occurredOn,
        event.role,
        event.category,
        event.title,
        event.importance,
        event.clubId ?? null,
        event.federationId ?? null,
        event.sourceEntityId ?? null,
        event.seasonLabel ?? null,
        event.provenanceStatus,
      );
  }
  events(filter: CareerTimelineFilter): CareerTimelineEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM career_timeline_events WHERE person_id=? AND (? IS NULL OR strftime('%Y',occurred_on)=?) AND (? IS NULL OR season_label=?) AND (? IS NULL OR role=?) AND (? IS NULL OR club_id=?) AND (? IS NULL OR federation_id=?) AND (? IS NULL OR category=?) ORDER BY occurred_on ASC,id ASC`,
      )
      .all(
        filter.personId,
        filter.year?.toString() ?? null,
        filter.year?.toString() ?? null,
        filter.seasonLabel ?? null,
        filter.seasonLabel ?? null,
        filter.role ?? null,
        filter.role ?? null,
        filter.clubId ?? null,
        filter.clubId ?? null,
        filter.federationId ?? null,
        filter.federationId ?? null,
        filter.category ?? null,
        filter.category ?? null,
      ) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as EntityId,
      personId: row.person_id as EntityId,
      occurredOn: String(row.occurred_on),
      role: String(row.role),
      category: row.category as CareerTimelineEvent["category"],
      title: String(row.title),
      importance: row.importance as CareerTimelineEvent["importance"],
      clubId: (row.club_id as EntityId | null) ?? undefined,
      federationId: (row.federation_id as EntityId | null) ?? undefined,
      sourceEntityId: (row.source_entity_id as EntityId | null) ?? undefined,
      seasonLabel: (row.season_label as string | null) ?? undefined,
      provenanceStatus: "SIMULATION_ONLY",
    }));
  }
}
