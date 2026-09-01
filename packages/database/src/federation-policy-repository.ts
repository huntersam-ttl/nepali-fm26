import type {
  EntityId,
  FederationCampaign,
  FederationEndorsement,
  FederationPolicy,
} from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

export class FederationPolicyRepository {
  constructor(private readonly db: GameDatabase) {}
  upsertCampaign(value: FederationCampaign): void {
    this.db
      .prepare(
        `INSERT INTO federation_campaigns (id,cycle_id,federation_id,candidate_id,platform_json,campaign_events_json,support_estimate,status,updated_on,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET platform_json=excluded.platform_json,campaign_events_json=excluded.campaign_events_json,support_estimate=excluded.support_estimate,status=excluded.status,updated_on=excluded.updated_on`,
      )
      .run(
        value.id,
        value.cycleId,
        value.federationId,
        value.candidateId,
        JSON.stringify(value.platform),
        JSON.stringify(value.campaignEvents),
        value.supportEstimate,
        value.status,
        value.updatedOn,
        value.provenanceStatus,
      );
  }
  campaigns(cycleId?: EntityId): FederationCampaign[] {
    const rows = (
      cycleId
        ? this.db
            .prepare("SELECT * FROM federation_campaigns WHERE cycle_id=? ORDER BY candidate_id")
            .all(cycleId)
        : this.db.prepare("SELECT * FROM federation_campaigns ORDER BY cycle_id,candidate_id").all()
    ) as any[];
    return rows.map((r) => ({
      id: r.id,
      cycleId: r.cycle_id,
      federationId: r.federation_id,
      candidateId: r.candidate_id,
      platform: JSON.parse(r.platform_json),
      campaignEvents: JSON.parse(r.campaign_events_json),
      supportEstimate: r.support_estimate,
      status: r.status,
      updatedOn: r.updated_on,
      provenanceStatus: r.provenance_status,
    }));
  }
  upsertEndorsement(value: FederationEndorsement): void {
    this.db
      .prepare(
        `INSERT INTO federation_endorsements (id,campaign_id,candidate_id,stakeholder_type,stakeholder_id,support,reason,endorsed_on,provenance_status) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(campaign_id,stakeholder_type,stakeholder_id) DO UPDATE SET support=excluded.support,reason=excluded.reason,endorsed_on=excluded.endorsed_on`,
      )
      .run(
        value.id,
        value.campaignId,
        value.candidateId,
        value.stakeholderType,
        value.stakeholderId ?? null,
        value.support,
        value.reason,
        value.endorsedOn,
        value.provenanceStatus,
      );
  }
  endorsements(campaignId?: EntityId): FederationEndorsement[] {
    const rows = (
      campaignId
        ? this.db
            .prepare(
              "SELECT * FROM federation_endorsements WHERE campaign_id=? ORDER BY stakeholder_type,stakeholder_id",
            )
            .all(campaignId)
        : this.db
            .prepare(
              "SELECT * FROM federation_endorsements ORDER BY campaign_id,stakeholder_type,stakeholder_id",
            )
            .all()
    ) as any[];
    return rows.map((r) => ({
      id: r.id,
      campaignId: r.campaign_id,
      candidateId: r.candidate_id,
      stakeholderType: r.stakeholder_type,
      stakeholderId: r.stakeholder_id ?? undefined,
      support: r.support,
      reason: r.reason,
      endorsedOn: r.endorsed_on,
      provenanceStatus: r.provenance_status,
    }));
  }
  upsertPolicy(value: FederationPolicy): void {
    this.db
      .prepare(
        `INSERT INTO federation_policies (id,federation_id,category,title,status,start_date,end_date,funding_committed,implementation_progress,target_value,effects_json,source_commitment_id,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,end_date=excluded.end_date,funding_committed=excluded.funding_committed,implementation_progress=excluded.implementation_progress,effects_json=excluded.effects_json`,
      )
      .run(
        value.id,
        value.federationId,
        value.category,
        value.title,
        value.status,
        value.startDate,
        value.endDate ?? null,
        value.fundingCommitted,
        value.implementationProgress,
        value.targetValue,
        JSON.stringify(value.effects),
        value.sourceCommitmentId ?? null,
        value.provenanceStatus,
      );
  }
  policies(federationId?: EntityId): FederationPolicy[] {
    const rows = (
      federationId
        ? this.db
            .prepare(
              "SELECT * FROM federation_policies WHERE federation_id=? ORDER BY start_date,id",
            )
            .all(federationId)
        : this.db
            .prepare("SELECT * FROM federation_policies ORDER BY federation_id,start_date,id")
            .all()
    ) as any[];
    return rows.map((r) => ({
      id: r.id,
      federationId: r.federation_id,
      category: r.category,
      title: r.title,
      status: r.status,
      startDate: r.start_date,
      endDate: r.end_date ?? undefined,
      fundingCommitted: r.funding_committed,
      implementationProgress: r.implementation_progress,
      targetValue: r.target_value,
      effects: JSON.parse(r.effects_json),
      sourceCommitmentId: r.source_commitment_id ?? undefined,
      provenanceStatus: r.provenance_status,
    }));
  }
}
