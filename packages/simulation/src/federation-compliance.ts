import { createStableEntityId, type EntityId, type FederationComplianceDimensions, type FederationComplianceProfile, type FederationComplianceSnapshotSeed, type FederationCorrectiveAction, type FederationGrant, type FederationGrantExpenditure, type FederationGrantHistoryEvent, type FederationGrantStatus, type FederationRestrictionPurpose, type FederationSanction } from "@nepal-football-sim/shared-types";
import { FederationComplianceRepository, FederationGovernanceRepository, type GameDatabase } from "@nepal-football-sim/database";
import { postFederationTransaction } from "./federation-governance.js";

const simulationStatus = "SIMULATION_ONLY" as const;
const currency = "NPR";
const restrictedPurposes = new Set<FederationRestrictionPurpose>(["PITCH_PROJECT", "TECHNICAL_CENTRE", "DISTRICT_DEVELOPMENT", "WOMENS_FOOTBALL", "YOUTH", "GRASSROOTS", "REFEREE_DEVELOPMENT", "COACH_EDUCATION", "NATIONAL_TEAM_SUPPORT"]);
const ledgerCategoryFor = (purpose: FederationRestrictionPurpose): "INFRASTRUCTURE" | "YOUTH_DEVELOPMENT" | "GRASSROOTS" | "COACH_EDUCATION" | "REFEREE_DEVELOPMENT" | "NATIONAL_TEAM_COST" | "OTHER" => purpose === "PITCH_PROJECT" || purpose === "TECHNICAL_CENTRE" ? "INFRASTRUCTURE" : purpose === "WOMENS_FOOTBALL" || purpose === "YOUTH" ? "YOUTH_DEVELOPMENT" : purpose === "GRASSROOTS" || purpose === "DISTRICT_DEVELOPMENT" ? "GRASSROOTS" : purpose === "COACH_EDUCATION" ? "COACH_EDUCATION" : purpose === "REFEREE_DEVELOPMENT" ? "REFEREE_DEVELOPMENT" : purpose === "NATIONAL_TEAM_SUPPORT" ? "NATIONAL_TEAM_COST" : "OTHER";
const addHistory = (grant: FederationGrant, date: string, action: string, note: string): FederationGrantHistoryEvent[] => [...grant.history, { date, action, note }];

export const createFederationGrant = (db: GameDatabase, input: Omit<FederationGrant, "id" | "receivedAmount" | "remainingAmount" | "status" | "history" | "provenanceStatus"> & { seed?: string }): FederationGrant => {
  const grant: FederationGrant = { ...input, id: createStableEntityId("federation-external-grant", `${input.federationId}:${input.sourceInstitution}:${input.fundingPeriodStart}:${input.purpose}:${input.seed ?? ""}`), receivedAmount: 0, remainingAmount: 0, status: "PROPOSED", history: [{ date: input.fundingPeriodStart, action: "PROPOSED", note: "External funding request created from federation state" }], provenanceStatus: simulationStatus };
  new FederationComplianceRepository(db).upsertGrant(grant);
  return grant;
};

export const transitionFederationGrant = (db: GameDatabase, grantId: EntityId, status: FederationGrantStatus, date: string, note: string): FederationGrant => {
  const repo = new FederationComplianceRepository(db); const grant = repo.grant(grantId); if (!grant) throw new Error(`Federation grant ${grantId} not found`);
  const next = { ...grant, status, history: addHistory(grant, date, status, note) }; repo.upsertGrant(next); return next;
};

export const approveFederationGrant = (db: GameDatabase, grantId: EntityId, input: { date: string; approvedAmount: number }): FederationGrant => {
  const repo = new FederationComplianceRepository(db); const grant = repo.grant(grantId); if (!grant) throw new Error(`Federation grant ${grantId} not found`);
  const profile = repo.complianceProfile(grant.federationId); const restricted = profile && ["FUNDING_RESTRICTED", "COMPETITION_RESTRICTED", "SUSPENDED"].includes(profile.status);
  if (restricted) return transitionFederationGrant(db, grantId, "DELAYED", input.date, "External funding review delayed by persisted compliance restrictions");
  const approvedAmount = Math.max(0, Math.min(input.approvedAmount, grant.approvedAmount));
  const next = { ...grant, approvedAmount, remainingAmount: approvedAmount, approvalDate: input.date, status: "APPROVED" as const, history: addHistory(grant, input.date, "APPROVED", "Funding approved after compliance eligibility review") }; repo.upsertGrant(next); return next;
};

export const disburseFederationGrant = (db: GameDatabase, grantId: EntityId, input: { date: string; amount: number }): FederationGrant => {
  const repo = new FederationComplianceRepository(db); const grant = repo.grant(grantId); if (!grant) throw new Error(`Federation grant ${grantId} not found`);
  if (!["APPROVED", "PARTIALLY_DISBURSED", "ACTIVE", "REPORTING_DUE"].includes(grant.status)) throw new Error("Grant is not eligible for disbursement");
  const amount = Math.max(0, Math.min(input.amount, grant.remainingAmount)); if (amount <= 0) throw new Error("No grant balance remains");
  const category = grant.sourceInstitution.startsWith("FIFA") ? "FIFA_GRANT" : grant.sourceInstitution.startsWith("AFC") ? "AFC_GRANT" : "GOVERNMENT_GRANT";
  postFederationTransaction(db, { federationId: grant.federationId, date: input.date, category, direction: "CREDIT", amount, description: `${grant.sourceInstitution} disbursement for ${grant.purpose}`, relatedEntityId: grant.id, restrictionTag: grant.restrictionType === "UNRESTRICTED" ? undefined : grant.restrictionType, idempotencyKey: `grant-disbursement:${grant.id}:${grant.receivedAmount + amount}` });
  if (grant.restrictionType !== "UNRESTRICTED") {
    const account = new FederationGovernanceRepository(db).financialAccount(grant.federationId);
    if (account) new FederationGovernanceRepository(db).upsertFinancialAccount({ ...account, restrictedFunds: account.restrictedFunds + amount, lastUpdatedAt: input.date });
  }
  const receivedAmount = grant.receivedAmount + amount; const next = { ...grant, receivedAmount, remainingAmount: grant.remainingAmount - amount, status: receivedAmount >= grant.approvedAmount ? "ACTIVE" as const : "PARTIALLY_DISBURSED" as const, history: addHistory(grant, input.date, "DISBURSED", `${amount} ${grant.currency} received`) }; repo.upsertGrant(next); return next;
};

export const spendRestrictedFederationGrant = (db: GameDatabase, grantId: EntityId, input: { federationId: EntityId; date: string; amount: number; purpose: FederationRestrictionPurpose; description: string }): FederationGrantExpenditure => {
  const repo = new FederationComplianceRepository(db); const grant = repo.grant(grantId); if (!grant || grant.federationId !== input.federationId) throw new Error("Grant does not belong to this federation");
  if (grant.restrictionType !== "UNRESTRICTED" && grant.restrictionType !== input.purpose) throw new Error(`Restricted grant cannot fund ${input.purpose}`);
  const spent = repo.expendituresForGrant(grantId).reduce((sum, item) => sum + item.amount, 0); const available = grant.receivedAmount - spent; if (input.amount <= 0 || input.amount > available) throw new Error("Insufficient restricted grant balance");
  const id = createStableEntityId("federation-grant-expenditure", `${grantId}:${input.date}:${input.purpose}:${input.amount}:${input.description}`); const existing = repo.expendituresForGrant(grantId).find((item) => item.id === id); if (existing) return existing;
  const ledgerEntry = postFederationTransaction(db, { federationId: input.federationId, date: input.date, category: ledgerCategoryFor(input.purpose), direction: "DEBIT", amount: input.amount, description: input.description, relatedEntityId: grantId, restrictionTag: grant.restrictionType === "UNRESTRICTED" ? undefined : grant.restrictionType, idempotencyKey: `grant-expenditure:${id}` });
  if (grant.restrictionType !== "UNRESTRICTED") {
    const account = new FederationGovernanceRepository(db).financialAccount(input.federationId);
    if (account) new FederationGovernanceRepository(db).upsertFinancialAccount({ ...account, restrictedFunds: Math.max(0, account.restrictedFunds - input.amount), lastUpdatedAt: input.date });
  }
  const expenditure: FederationGrantExpenditure = { id, grantId, federationId: input.federationId, date: input.date, amount: input.amount, purpose: input.purpose, description: input.description, ledgerEntryId: ledgerEntry.id, status: simulationStatus }; repo.insertExpenditure(expenditure); return expenditure;
};

export const recordFederationGrantReport = (db: GameDatabase, grantId: EntityId, input: { date: string; accepted: boolean; note: string }): FederationGrant => transitionFederationGrant(db, grantId, input.accepted ? "ACTIVE" : "FROZEN", input.date, input.accepted ? input.note : `Reporting failure: ${input.note}`);

const deriveComplianceStatus = (dimensions: FederationComplianceDimensions): FederationComplianceProfile["status"] => {
  const minimum = Math.min(...Object.values(dimensions)); return minimum < 30 ? "SUSPENDED" : minimum < 45 ? "COMPETITION_RESTRICTED" : minimum < 58 ? "FUNDING_RESTRICTED" : minimum < 72 ? "WARNING" : "NORMAL";
};

export const reviewFederationCompliance = (db: GameDatabase, input: { federationId: EntityId; date: string; dimensions: FederationComplianceDimensions; provenanceStatus?: FederationComplianceProfile["provenanceStatus"] }): FederationComplianceProfile => {
  const repo = new FederationComplianceRepository(db); const status = deriveComplianceStatus(input.dimensions); const prior = repo.complianceProfile(input.federationId); const profile: FederationComplianceProfile = { federationId: input.federationId, status, dimensions: input.dimensions, lastReviewedOn: input.date, history: [...(prior?.history ?? []), { date: input.date, action: "REVIEWED", note: `Compliance review resulted in ${status}`, status }], provenanceStatus: input.provenanceStatus ?? simulationStatus }; repo.upsertComplianceProfile(profile); return profile;
};

export const issueComplianceSanction = (db: GameDatabase, input: { federationId: EntityId; date: string; authority: FederationSanction["authority"]; category: string; reason: string; requirementsForResolution: string[]; affectedProgrammes: string[]; consequences: FederationSanction["consequences"]; provenanceStatus?: FederationSanction["provenanceStatus"] }): FederationSanction => {
  const repo = new FederationComplianceRepository(db); const existing = repo.sanctionsForFederation(input.federationId).find((item) => item.reviewState !== "RESOLVED" && item.category === input.category); if (existing) return existing;
  const sanction: FederationSanction = { id: createStableEntityId("federation-sanction", `${input.federationId}:${input.authority}:${input.category}:${input.date}`), federationId: input.federationId, authority: input.authority, reason: input.reason, category: input.category, startDate: input.date, requirementsForResolution: input.requirementsForResolution, affectedProgrammes: input.affectedProgrammes, consequences: input.consequences, reviewState: "ACTIVE", history: [{ date: input.date, action: "ISSUED", note: input.reason }], provenanceStatus: input.provenanceStatus ?? simulationStatus }; repo.upsertSanction(sanction); return sanction;
};

export const createFederationCorrectiveAction = (db: GameDatabase, input: Omit<FederationCorrectiveAction, "id" | "status" | "provenanceStatus">): FederationCorrectiveAction => { const action: FederationCorrectiveAction = { ...input, id: createStableEntityId("federation-corrective-action", `${input.federationId}:${input.sanctionId ?? "none"}:${input.category}:${input.startedOn}`), status: "PLANNED", provenanceStatus: simulationStatus }; new FederationComplianceRepository(db).upsertCorrectiveAction(action); return action; };

export const completeCorrectiveAction = (db: GameDatabase, actionId: EntityId, input: { date: string; evidence: string }): FederationCorrectiveAction => {
  const repo = new FederationComplianceRepository(db); const current = repo.correctiveActionsForFederation((db.prepare("SELECT federation_id FROM federation_corrective_actions WHERE id=?").get(actionId) as { federation_id: EntityId } | undefined)?.federation_id ?? ("" as EntityId)).find((item) => item.id === actionId); if (!current) throw new Error(`Corrective action ${actionId} not found`); const next = { ...current, status: "COMPLETED" as const, completedOn: input.date, evidence: input.evidence }; repo.upsertCorrectiveAction(next); return next;
};

export const reviewFederationReinstatement = (db: GameDatabase, sanctionId: EntityId, input: { date: string; dimensions: FederationComplianceDimensions; evidence: string }): FederationSanction => {
  const repo = new FederationComplianceRepository(db); const sanction = repo.sanction(sanctionId); if (!sanction) throw new Error(`Sanction ${sanctionId} not found`); const actions = repo.correctiveActionsForSanction(sanctionId); const eligible = actions.length > 0 && actions.every((action) => action.status === "COMPLETED" || action.status === "VERIFIED") && Math.min(...Object.values(input.dimensions)) >= 72; if (!eligible) { const next = { ...sanction, reviewState: "UNDER_REVIEW" as const, history: [...sanction.history, { date: input.date, action: "REINSTATEMENT_REVIEW", note: `Evidence reviewed: ${input.evidence}` }] }; repo.upsertSanction(next); return next; } const next = { ...sanction, reviewState: "RESOLVED" as const, resolvedOn: input.date, history: [...sanction.history, { date: input.date, action: "REINSTATED", note: `External review accepted: ${input.evidence}` }] }; repo.upsertSanction(next); return next;
};

export const federationFundingAvailable = (db: GameDatabase, federationId: EntityId, grant: FederationGrant, purpose: FederationRestrictionPurpose): boolean => {
  const profile = new FederationComplianceRepository(db).complianceProfile(federationId); if (profile && ["FUNDING_RESTRICTED", "SUSPENDED"].includes(profile.status) && grant.restrictionType !== "UNRESTRICTED") return false; return grant.restrictionType === "UNRESTRICTED" || grant.restrictionType === purpose || !restrictedPurposes.has(grant.restrictionType);
};

export const federationAccessAllowed = (db: GameDatabase, federationId: EntityId, consequence: FederationSanction["consequences"][number]): boolean => !new FederationComplianceRepository(db).activeSanctionsForFederation(federationId).some((sanction) => sanction.consequences.includes(consequence));

export const reviewComplianceAndIssueSanction = (db: GameDatabase, input: Parameters<typeof reviewFederationCompliance>[1] & { authority: FederationSanction["authority"] }): { profile: FederationComplianceProfile; sanction?: FederationSanction } => {
  const profile = reviewFederationCompliance(db, input); if (profile.status === "NORMAL" || profile.status === "WARNING") return { profile };
  const consequence: FederationSanction["consequences"] = profile.status === "SUSPENDED" ? ["FUNDING_FROZEN", "NEW_GRANTS_BLOCKED", "NATIONAL_TEAM_PARTICIPATION_BLOCKED", "CLUB_CONTINENTAL_PARTICIPATION_BLOCKED", "DEVELOPMENT_PROGRAMMES_UNAVAILABLE", "REPUTATION_DAMAGE"] : profile.status === "COMPETITION_RESTRICTED" ? ["NATIONAL_TEAM_PARTICIPATION_BLOCKED", "CLUB_CONTINENTAL_PARTICIPATION_BLOCKED", "REPUTATION_DAMAGE"] : ["FUNDING_FROZEN", "NEW_GRANTS_BLOCKED"];
  return { profile, sanction: issueComplianceSanction(db, { federationId: input.federationId, date: input.date, authority: input.authority, category: profile.status, reason: `Persisted compliance review reached ${profile.status}`, requirementsForResolution: ["Complete corrective actions", "Submit evidence and reporting", "Pass external review"], affectedProgrammes: ["FEDERATION_OPERATIONS"], consequences: consequence }) };
};

const DEFAULT_COMPLIANCE_DIMENSIONS: FederationComplianceDimensions = { autonomy: 70, statutoryCompliance: 70, electionLegitimacy: 70, financialControls: 65, auditQuality: 60, transparencyReporting: 65, safeguarding: 70, projectDelivery: 65 };

/** Creates a default (unverified) compliance profile for any federation that does not yet have one — save-init foundation, never overwrites an existing profile. */
export const initializeFederationComplianceForSave = (db: GameDatabase, worldDate: string): void => {
  const repo = new FederationComplianceRepository(db);
  const federationIds = (db.prepare("SELECT id FROM federations ORDER BY id").all() as Array<{ id: EntityId }>).map((row) => row.id);
  for (const federationId of federationIds) {
    if (repo.complianceProfile(federationId)) continue;
    repo.upsertComplianceProfile({
      federationId,
      status: "NORMAL",
      dimensions: { ...DEFAULT_COMPLIANCE_DIMENSIONS },
      lastReviewedOn: worldDate,
      history: [{ date: worldDate, action: "INITIALIZED", note: "Default compliance profile created; no verified starting compliance data was supplied.", status: "NORMAL" }],
      provenanceStatus: "UNKNOWN",
    });
  }
};

/**
 * Nepal 2026 starting-state hook (requirement 8): seeds a real,
 * provenance-tagged compliance snapshot (and any verified sanctions) for one
 * federation, from data the import dataset actually supplies. Never called
 * with an invented status — see FederationComplianceSnapshotSeed.
 */
export const applyFederationComplianceSnapshot = (
  db: GameDatabase,
  federationId: EntityId,
  snapshot: FederationComplianceSnapshotSeed,
): void => {
  const repo = new FederationComplianceRepository(db);
  repo.upsertComplianceProfile({
    federationId,
    status: snapshot.status,
    dimensions: { ...DEFAULT_COMPLIANCE_DIMENSIONS, ...snapshot.dimensions },
    lastReviewedOn: snapshot.effectiveDate,
    history: [{ date: snapshot.effectiveDate, action: "SEEDED_FROM_DATA", note: `Starting compliance status seeded from ${snapshot.provenanceStatus} data.`, status: snapshot.status }],
    provenanceStatus: snapshot.provenanceStatus,
  });
  for (const sanctionSeed of snapshot.sanctions ?? []) {
    issueComplianceSanction(db, {
      federationId,
      date: sanctionSeed.startDate,
      authority: sanctionSeed.authority,
      category: sanctionSeed.category,
      reason: sanctionSeed.reason,
      requirementsForResolution: sanctionSeed.requirementsForResolution,
      affectedProgrammes: sanctionSeed.affectedProgrammes,
      consequences: sanctionSeed.consequences,
      provenanceStatus: sanctionSeed.provenanceStatus,
    });
  }
};

/**
 * Bounded, deterministic AI federation behaviour (requirement 10): advances
 * pending grants, applies for a new one when unrestricted cash is thin,
 * and starts corrective action under any active sanction. Every step
 * reuses the lifecycle functions above — no separate AI-only logic path.
 */
export const runFederationComplianceAiForAllFederations = (
  db: GameDatabase,
  date: string,
  /** Federations a human presides over: the AI does not run their grants and reports. */
  excludeFederationIds: readonly EntityId[] = [],
): void => {
  const repo = new FederationComplianceRepository(db);
  const financeRepo = new FederationGovernanceRepository(db);
  const federationIds = (db.prepare("SELECT id FROM federations ORDER BY id").all() as Array<{ id: EntityId }>)
    .map((row) => row.id)
    .filter((id) => !excludeFederationIds.includes(id));

  for (const federationId of federationIds) {
    for (const grant of repo.grantsForFederation(federationId)) {
      if (grant.status === "PROPOSED") {
        approveFederationGrant(db, grant.id, { date, approvedAmount: grant.approvedAmount });
      } else if ((grant.status === "ACTIVE" || grant.status === "PARTIALLY_DISBURSED") && date >= grant.fundingPeriodEnd) {
        transitionFederationGrant(db, grant.id, "REPORTING_DUE", date, "Periodic report is due.");
      } else if (grant.status === "REPORTING_DUE") {
        recordFederationGrantReport(db, grant.id, { date, accepted: true, note: "Routine report submitted on schedule." });
      }
    }

    const account = financeRepo.financialAccount(federationId);
    if (
      account &&
      (account.financialHealth === "TIGHT" || account.financialHealth === "DISTRESSED") &&
      federationAccessAllowed(db, federationId, "NEW_GRANTS_BLOCKED")
    ) {
      const pending = repo
        .grantsForFederation(federationId)
        .some((grant) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(grant.status));
      if (!pending) {
        createFederationGrant(db, {
          federationId,
          sourceInstitution: "AFC_DEVELOPMENT",
          currency: "NPR",
          approvedAmount: 500000,
          fundingPeriodStart: date,
          fundingPeriodEnd: date,
          purpose: "Grassroots development",
          restrictionType: "GRASSROOTS",
          reportingRequirements: ["annual report"],
          auditRequired: false,
          milestones: [],
          conditions: [],
          seed: date,
        });
      }
    }

    for (const sanction of repo.sanctionsForFederation(federationId).filter((s) => s.reviewState !== "RESOLVED")) {
      if (repo.correctiveActionsForSanction(sanction.id).length === 0) {
        createFederationCorrectiveAction(db, {
          federationId,
          sanctionId: sanction.id,
          description: `Address ${sanction.category}`,
          category: sanction.category,
          startedOn: date,
          targetCompletionOn: date,
        });
      }
    }
  }
};
