import type {
  EntityId,
  FederationCorrectiveAction,
  FederationComplianceProfile,
  FederationGrant,
  FederationGrantExpenditure,
  FederationSanction,
} from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const mapGrant = (row: any): FederationGrant => ({
  id: row.id,
  federationId: row.federation_id,
  sourceInstitution: row.source_institution,
  currency: row.currency,
  approvedAmount: row.approved_amount,
  receivedAmount: row.received_amount,
  remainingAmount: row.remaining_amount,
  approvalDate: row.approval_date ?? undefined,
  fundingPeriodStart: row.funding_period_start,
  fundingPeriodEnd: row.funding_period_end,
  purpose: row.purpose,
  restrictionType: row.restriction_type,
  status: row.status,
  reportingRequirements: JSON.parse(row.reporting_requirements_json),
  auditRequired: row.audit_required === 1,
  milestones: JSON.parse(row.milestones_json),
  history: JSON.parse(row.history_json),
  conditions: JSON.parse(row.conditions_json),
  provenanceStatus: row.provenance_status,
});

const mapExpenditure = (row: any): FederationGrantExpenditure => ({
  id: row.id,
  grantId: row.grant_id,
  federationId: row.federation_id,
  date: row.expenditure_date,
  amount: row.amount,
  purpose: row.purpose,
  description: row.description,
  ledgerEntryId: row.ledger_entry_id,
  status: row.status,
});

const mapComplianceProfile = (row: any): FederationComplianceProfile => ({
  federationId: row.federation_id,
  status: row.status,
  dimensions: JSON.parse(row.dimensions_json),
  lastReviewedOn: row.last_reviewed_on,
  history: JSON.parse(row.history_json),
  provenanceStatus: row.provenance_status,
});

const mapSanction = (row: any): FederationSanction => ({
  id: row.id,
  federationId: row.federation_id,
  authority: row.authority,
  reason: row.reason,
  category: row.category,
  startDate: row.start_date,
  requirementsForResolution: JSON.parse(row.requirements_json),
  affectedProgrammes: JSON.parse(row.affected_programmes_json),
  consequences: JSON.parse(row.consequences_json),
  reviewState: row.review_state,
  resolvedOn: row.resolved_on ?? undefined,
  history: JSON.parse(row.history_json),
  provenanceStatus: row.provenance_status,
});

const mapCorrectiveAction = (row: any): FederationCorrectiveAction => ({
  id: row.id,
  federationId: row.federation_id,
  sanctionId: row.sanction_id ?? undefined,
  description: row.description,
  category: row.category,
  startedOn: row.started_on,
  targetCompletionOn: row.target_completion_on,
  completedOn: row.completed_on ?? undefined,
  status: row.status,
  evidence: row.evidence ?? undefined,
  provenanceStatus: row.provenance_status,
});

export class FederationComplianceRepository {
  constructor(private readonly db: GameDatabase) {}

  // ---------------------------------------------------------------------
  // Grants
  // ---------------------------------------------------------------------

  upsertGrant(grant: FederationGrant): void {
    this.db
      .prepare(
        `INSERT INTO federation_grants
        (id, federation_id, source_institution, currency, approved_amount, received_amount, remaining_amount,
          approval_date, funding_period_start, funding_period_end, purpose, restriction_type, status,
          reporting_requirements_json, audit_required, milestones_json, history_json, conditions_json, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          approved_amount = excluded.approved_amount,
          received_amount = excluded.received_amount,
          remaining_amount = excluded.remaining_amount,
          approval_date = excluded.approval_date,
          status = excluded.status,
          reporting_requirements_json = excluded.reporting_requirements_json,
          milestones_json = excluded.milestones_json,
          history_json = excluded.history_json,
          conditions_json = excluded.conditions_json`,
      )
      .run(
        grant.id,
        grant.federationId,
        grant.sourceInstitution,
        grant.currency,
        grant.approvedAmount,
        grant.receivedAmount,
        grant.remainingAmount,
        grant.approvalDate ?? null,
        grant.fundingPeriodStart,
        grant.fundingPeriodEnd,
        grant.purpose,
        grant.restrictionType,
        grant.status,
        JSON.stringify(grant.reportingRequirements),
        grant.auditRequired ? 1 : 0,
        JSON.stringify(grant.milestones),
        JSON.stringify(grant.history),
        JSON.stringify(grant.conditions),
        grant.provenanceStatus,
      );
  }

  grant(id: EntityId): FederationGrant | undefined {
    const row = this.db.prepare("SELECT * FROM federation_grants WHERE id = ?").get(id) as any;
    return row ? mapGrant(row) : undefined;
  }

  grantsForFederation(federationId: EntityId): FederationGrant[] {
    return (
      this.db.prepare("SELECT * FROM federation_grants WHERE federation_id = ? ORDER BY id").all(federationId) as any[]
    ).map(mapGrant);
  }

  // ---------------------------------------------------------------------
  // Grant expenditures
  // ---------------------------------------------------------------------

  insertExpenditure(expenditure: FederationGrantExpenditure): void {
    this.db
      .prepare(
        `INSERT INTO federation_grant_expenditures
        (id, grant_id, federation_id, expenditure_date, amount, purpose, description, ledger_entry_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        expenditure.id,
        expenditure.grantId,
        expenditure.federationId,
        expenditure.date,
        expenditure.amount,
        expenditure.purpose,
        expenditure.description,
        expenditure.ledgerEntryId,
        expenditure.status,
      );
  }

  expendituresForGrant(grantId: EntityId): FederationGrantExpenditure[] {
    return (
      this.db
        .prepare("SELECT * FROM federation_grant_expenditures WHERE grant_id = ? ORDER BY expenditure_date, id")
        .all(grantId) as any[]
    ).map(mapExpenditure);
  }

  // ---------------------------------------------------------------------
  // Compliance profile
  // ---------------------------------------------------------------------

  upsertComplianceProfile(profile: FederationComplianceProfile): void {
    this.db
      .prepare(
        `INSERT INTO federation_compliance_profiles
        (federation_id, status, dimensions_json, last_reviewed_on, history_json, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(federation_id) DO UPDATE SET
          status = excluded.status,
          dimensions_json = excluded.dimensions_json,
          last_reviewed_on = excluded.last_reviewed_on,
          history_json = excluded.history_json`,
      )
      .run(
        profile.federationId,
        profile.status,
        JSON.stringify(profile.dimensions),
        profile.lastReviewedOn,
        JSON.stringify(profile.history),
        profile.provenanceStatus,
      );
  }

  complianceProfile(federationId: EntityId): FederationComplianceProfile | undefined {
    const row = this.db
      .prepare("SELECT * FROM federation_compliance_profiles WHERE federation_id = ?")
      .get(federationId) as any;
    return row ? mapComplianceProfile(row) : undefined;
  }

  // ---------------------------------------------------------------------
  // Sanctions
  // ---------------------------------------------------------------------

  upsertSanction(sanction: FederationSanction): void {
    this.db
      .prepare(
        `INSERT INTO federation_sanctions
        (id, federation_id, authority, reason, category, start_date, requirements_json, affected_programmes_json,
          consequences_json, review_state, resolved_on, history_json, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          review_state = excluded.review_state,
          resolved_on = excluded.resolved_on,
          history_json = excluded.history_json,
          consequences_json = excluded.consequences_json`,
      )
      .run(
        sanction.id,
        sanction.federationId,
        sanction.authority,
        sanction.reason,
        sanction.category,
        sanction.startDate,
        JSON.stringify(sanction.requirementsForResolution),
        JSON.stringify(sanction.affectedProgrammes),
        JSON.stringify(sanction.consequences),
        sanction.reviewState,
        sanction.resolvedOn ?? null,
        JSON.stringify(sanction.history),
        sanction.provenanceStatus,
      );
  }

  sanction(id: EntityId): FederationSanction | undefined {
    const row = this.db.prepare("SELECT * FROM federation_sanctions WHERE id = ?").get(id) as any;
    return row ? mapSanction(row) : undefined;
  }

  sanctionsForFederation(federationId: EntityId): FederationSanction[] {
    return (
      this.db
        .prepare("SELECT * FROM federation_sanctions WHERE federation_id = ? ORDER BY start_date, id")
        .all(federationId) as any[]
    ).map(mapSanction);
  }

  /** Sanctions still in force — the review/reinstatement pipeline has not resolved them. */
  activeSanctionsForFederation(federationId: EntityId): FederationSanction[] {
    return this.sanctionsForFederation(federationId).filter((sanction) => sanction.reviewState !== "RESOLVED");
  }

  // ---------------------------------------------------------------------
  // Corrective actions
  // ---------------------------------------------------------------------

  upsertCorrectiveAction(action: FederationCorrectiveAction): void {
    this.db
      .prepare(
        `INSERT INTO federation_corrective_actions
        (id, federation_id, sanction_id, description, category, started_on, target_completion_on, completed_on,
          status, evidence, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          completed_on = excluded.completed_on,
          status = excluded.status,
          evidence = excluded.evidence`,
      )
      .run(
        action.id,
        action.federationId,
        action.sanctionId ?? null,
        action.description,
        action.category,
        action.startedOn,
        action.targetCompletionOn,
        action.completedOn ?? null,
        action.status,
        action.evidence ?? null,
        action.provenanceStatus,
      );
  }

  correctiveActionsForFederation(federationId: EntityId): FederationCorrectiveAction[] {
    return (
      this.db
        .prepare("SELECT * FROM federation_corrective_actions WHERE federation_id = ? ORDER BY started_on, id")
        .all(federationId) as any[]
    ).map(mapCorrectiveAction);
  }

  correctiveActionsForSanction(sanctionId: EntityId): FederationCorrectiveAction[] {
    return (
      this.db
        .prepare("SELECT * FROM federation_corrective_actions WHERE sanction_id = ? ORDER BY started_on, id")
        .all(sanctionId) as any[]
    ).map(mapCorrectiveAction);
  }
}
