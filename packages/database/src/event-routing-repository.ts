import type { EntityId, HistoricalEvent } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

export type PublicEventRole = "MANAGER" | "OWNER" | "PRESIDENT";

export type EventInboxDelivery = {
  id: EntityId;
  eventId: EntityId;
  role: PublicEventRole;
  personId: EntityId;
  clubId?: EntityId;
  federationId?: EntityId;
  createdOn: string;
};

export class EventRoutingRepository {
  constructor(private readonly db: GameDatabase) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS event_inbox_deliveries (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        role TEXT NOT NULL,
        person_id TEXT NOT NULL,
        club_id TEXT,
        federation_id TEXT,
        created_on TEXT NOT NULL,
        UNIQUE(event_id, role, person_id)
      );
      CREATE INDEX IF NOT EXISTS idx_event_inbox_deliveries_person
        ON event_inbox_deliveries(person_id, created_on DESC);
    `);
  }

  insert(delivery: EventInboxDelivery): void {
    this.db
      .prepare(
        `INSERT INTO event_inbox_deliveries
          (id,event_id,role,person_id,club_id,federation_id,created_on)
         VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        delivery.id,
        delivery.eventId,
        delivery.role,
        delivery.personId,
        delivery.clubId ?? null,
        delivery.federationId ?? null,
        delivery.createdOn,
      );
  }

  deliveries(personId?: EntityId, role?: PublicEventRole): EventInboxDelivery[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (personId) {
      clauses.push("person_id = ?");
      values.push(personId);
    }
    if (role) {
      clauses.push("role = ?");
      values.push(role);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return (
      this.db
        .prepare(`SELECT * FROM event_inbox_deliveries ${where} ORDER BY created_on DESC, id DESC`)
        .all(...values) as any[]
    ).map((row) => ({
      id: row.id,
      eventId: row.event_id,
      role: row.role,
      personId: row.person_id,
      clubId: row.club_id ?? undefined,
      federationId: row.federation_id ?? undefined,
      createdOn: row.created_on,
    }));
  }

  has(eventId: EntityId, role: PublicEventRole, personId: EntityId): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM event_inbox_deliveries WHERE event_id=? AND role=? AND person_id=?")
        .get(eventId, role, personId),
    );
  }
}

export type RoutedPublicEvent = {
  delivery: EventInboxDelivery;
  event: HistoricalEvent;
};
