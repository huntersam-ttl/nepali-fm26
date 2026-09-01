import type { EntityId, HostingBid } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

export class HostingBidRepository {
  constructor(private readonly db: GameDatabase) {}
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
}
