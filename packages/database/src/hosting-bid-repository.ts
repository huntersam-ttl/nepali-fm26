import type { EntityId, HostingBid, HostingEvent } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

export class HostingBidRepository {
  constructor(private readonly db: GameDatabase) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS federation_hosting_events (
      id TEXT PRIMARY KEY, bid_id TEXT NOT NULL UNIQUE REFERENCES federation_hosting_bids(id),
      federation_id TEXT NOT NULL, competition_key TEXT NOT NULL, edition_id TEXT NOT NULL UNIQUE,
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, venue_ids_json TEXT NOT NULL,
      status TEXT NOT NULL, completed_on TEXT, provenance_status TEXT NOT NULL
    );`);
  }
  upsert(value: HostingBid): void {
    this.db
      .prepare(
        `INSERT INTO federation_hosting_bids (id,federation_id,event_type,event_name,host_scope,venue_id,readiness,funding_plan,government_support,federation_contribution,projected_benefit,status,proposed_on,decision_date,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET readiness=excluded.readiness,funding_plan=excluded.funding_plan,government_support=excluded.government_support,federation_contribution=excluded.federation_contribution,projected_benefit=excluded.projected_benefit,status=excluded.status,decision_date=excluded.decision_date`,
      )
      .run(
        value.id,
        value.federationId,
        value.eventType,
        value.eventName,
        value.hostScope,
        value.venueId ?? null,
        value.readiness,
        value.fundingPlan,
        value.governmentSupport,
        value.federationContribution,
        value.projectedBenefit,
        value.status,
        value.proposedOn,
        value.decisionDate ?? null,
        value.provenanceStatus,
      );
  }
  bids(federationId?: EntityId): HostingBid[] {
    const rows = (
      federationId
        ? this.db
            .prepare(
              "SELECT * FROM federation_hosting_bids WHERE federation_id=? ORDER BY proposed_on,id",
            )
            .all(federationId)
        : this.db
            .prepare("SELECT * FROM federation_hosting_bids ORDER BY federation_id,proposed_on,id")
            .all()
    ) as any[];
    return rows.map((r) => ({
      id: r.id,
      federationId: r.federation_id,
      eventType: r.event_type,
      eventName: r.event_name,
      hostScope: r.host_scope,
      venueId: r.venue_id ?? undefined,
      readiness: r.readiness,
      fundingPlan: r.funding_plan,
      governmentSupport: r.government_support,
      federationContribution: r.federation_contribution,
      projectedBenefit: r.projected_benefit,
      status: r.status,
      proposedOn: r.proposed_on,
      decisionDate: r.decision_date ?? undefined,
      provenanceStatus: r.provenance_status,
    }));
  }

  upsertEvent(value: HostingEvent): void {
    this.db.prepare(`INSERT INTO federation_hosting_events
      (id,bid_id,federation_id,competition_key,edition_id,start_date,end_date,venue_ids_json,status,completed_on,provenance_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status,completed_on=excluded.completed_on`).run(
      value.id,
      value.bidId,
      value.federationId,
      value.competitionKey,
      value.editionId,
      value.startDate,
      value.endDate,
      JSON.stringify(value.venueIds),
      value.status,
      value.completedOn ?? null,
      value.provenanceStatus,
    );
  }

  eventByBid(bidId: EntityId): HostingEvent | undefined {
    const row = this.db.prepare("SELECT * FROM federation_hosting_events WHERE bid_id=?").get(bidId) as any;
    return row ? this.mapEvent(row) : undefined;
  }

  event(id: EntityId): HostingEvent | undefined {
    const row = this.db.prepare("SELECT * FROM federation_hosting_events WHERE id=?").get(id) as any;
    return row ? this.mapEvent(row) : undefined;
  }

  events(federationId?: EntityId): HostingEvent[] {
    const rows = (federationId
      ? this.db.prepare("SELECT * FROM federation_hosting_events WHERE federation_id=? ORDER BY start_date,id").all(federationId)
      : this.db.prepare("SELECT * FROM federation_hosting_events ORDER BY start_date,id").all()) as any[];
    return rows.map((row) => this.mapEvent(row));
  }

  private mapEvent(row: any): HostingEvent {
    return {
      id: row.id,
      bidId: row.bid_id,
      federationId: row.federation_id,
      competitionKey: row.competition_key,
      editionId: row.edition_id,
      startDate: row.start_date,
      endDate: row.end_date,
      venueIds: JSON.parse(row.venue_ids_json) as EntityId[],
      status: row.status,
      completedOn: row.completed_on ?? undefined,
      provenanceStatus: row.provenance_status,
    };
  }
}
