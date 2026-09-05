import type {
  EntityId,
  InteractionAction,
  InteractionLinkedDomainType,
  UniversalInteraction,
} from "@nepal-football-sim/shared-types";
import {
  CareerWorldRepository,
  ClubEconomyRepository,
  CommercialRightsRepository,
  FederationComplianceRepository,
  FederationGovernanceRepository,
  GovernmentRepository,
  ManagerRepository,
  SquadDynamicsRepository,
  StaffMarketRepository,
  UniversalInteractionRepository,
  type GameDatabase,
  TransferMarketRepository,
} from "@nepal-football-sim/database";
import {
  approveFederationGrant,
  completeCorrectiveAction,
  disburseFederationGrant,
} from "./federation-compliance.js";
import { createInfrastructureProject, setClubBudget } from "./club-economy.js";
import { loadSave } from "@nepal-football-sim/database";
import { completePermanentTransfer, createTransferOffer } from "./transfer-market.js";
import { hireStaff, offerStaffRenewal } from "./staff-market.js";
import { respondToConcern } from "./squad-dynamics.js";
import { reviewGovernmentFunding, submitGovernmentFunding } from "./government.js";
import { createFederationProject } from "./federation-governance.js";
import { awardCommercialRightsForPresident } from "./commercial-rights.js";
import {
  openUniversalInteraction,
  submitUniversalInteractionAction,
} from "./universal-interactions.js";
import { createStructuredCommitment } from "./commitments.js";
import { upsertPersonRelationship } from "./people-foundation.js";

/** A deliberately small boundary: authoritative domain services remain the writers. */
export type UniversalInteractionAdapterContext = {
  interactionType: string;
  initiator: UniversalInteraction["initiator"];
  counterpart: UniversalInteraction["counterpart"];
  organisationId?: EntityId;
  subject: string;
  worldDate: string;
  deadline?: string;
  demands?: UniversalInteraction["demands"];
  offers?: UniversalInteraction["offers"];
  linkedReference?: { type: InteractionLinkedDomainType; canonicalId: EntityId; stage?: string };
  relationshipState?: number;
  leverage?: number;
  trust?: number;
};

export type UniversalInteractionDescriptor = {
  type: string;
  subject: string;
  linkedType?: InteractionLinkedDomainType;
  canOpen: boolean;
  reason?: string;
};

export type UniversalInteractionAdapter = {
  type: string;
  canOpen: (db: GameDatabase, context: UniversalInteractionAdapterContext) => boolean;
  buildContext: (context: UniversalInteractionAdapterContext) => UniversalInteractionAdapterContext;
  availableActions: (session: UniversalInteraction) => InteractionAction[];
  validateAction: (session: UniversalInteraction, action: InteractionAction) => void;
  resolveLinkedEntity: (
    db: GameDatabase,
    reference: UniversalInteraction["linkedReference"],
  ) => boolean;
  buildHistoryResult: (session: UniversalInteraction) => string;
};

const terminal = new Set(["ACCEPTED", "REJECTED", "WALKED_AWAY", "COMPLETED", "CANCELLED"]);
const exists = (db: GameDatabase, table: string, id: EntityId): boolean => {
  try {
    return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id=? LIMIT 1`).get(id));
  } catch {
    return false;
  }
};

export const resolveLinkedDomainResult = (
  db: GameDatabase,
  reference: UniversalInteraction["linkedReference"],
): boolean => {
  if (!reference) return false;
  if (reference.type === "TRANSFER_OFFER" || reference.type === "TRANSFER_DEAL")
    return new TransferMarketRepository(db)
      .transferOffers()
      .some((offer) => offer.id === reference.canonicalId);
  const tables: Partial<Record<InteractionLinkedDomainType, string>> = {
    CONTRACT: "player_contracts",
    CONTRACT_NEGOTIATION: "player_contracts",
    PLAYER_PROMISE: "manager_promises",
    PLAYER_CONCERN: "player_concerns",
    INFRASTRUCTURE_PROJECT: "infrastructure_projects",
    FACILITY_REQUEST: "infrastructure_projects",
    STAFF_CONTRACT: "staff_employment_contracts",
    FEDERATION_GRANT: "federation_grants",
    FEDERATION_CORRECTIVE_ACTION: "federation_corrective_actions",
    GOVERNMENT_SUPPORT: "government_funding_applications",
    COMMERCIAL_DEAL: "federation_commercial_rights_offers",
    MANAGER_INTERVIEW: "manager_job_vacancies",
  };
  const table = tables[reference.type];
  return table ? exists(db, table, reference.canonicalId) : true;
};

const genericAdapter: UniversalInteractionAdapter = {
  type: "GENERIC",
  canOpen: (db, context) => resolveLinkedDomainResult(db, context.linkedReference),
  buildContext: (context) => context,
  availableActions: (session) => [...session.availableActions],
  validateAction: (session, action) => {
    if (terminal.has(session.stage) || !session.availableActions.includes(action))
      throw new Error("Interaction action is not available");
  },
  resolveLinkedEntity: resolveLinkedDomainResult,
  buildHistoryResult: (session) => session.outcome ?? "Interaction recorded",
};

const adapterFor = (type: string): UniversalInteractionAdapter => ({
  ...genericAdapter,
  type,
  canOpen: (db, context) => {
    // Negotiations may be opened before a contract/deal exists; participants and
    // the domain-specific authority check are then the source of truth.
    if (
      [
        "CONTRACT_NEGOTIATION",
        "TRANSFER_NEGOTIATION",
        "STAFF_CONTRACT",
        "FACILITY_REQUEST",
        "BOARD_REQUEST",
        "FEDERATION_PROJECT",
        "GOVERNMENT_SUPPORT",
      ].includes(type)
    )
      return Boolean(context.initiator.entityId && context.counterpart.entityId);
    return genericAdapter.canOpen(db, context);
  },
});

export const universalInteractionAdapters: Readonly<Record<string, UniversalInteractionAdapter>> =
  Object.freeze(
    Object.fromEntries(
      [
        "CONTRACT_NEGOTIATION",
        "CONTRACT",
        "TRANSFER_NEGOTIATION",
        "TRANSFER_OFFER",
        "TRANSFER_DEAL",
        "PLAYER_CONCERN",
        "PLAYER_PROMISE",
        "BOARD_REQUEST",
        "OWNER_MANAGER_MEETING",
        "INFRASTRUCTURE_PROJECT",
        "FEDERATION_GRANT",
        "FEDERATION_PROJECT",
        "FEDERATION_CORRECTIVE_ACTION",
        "COMMERCIAL_DEAL",
        "STAFF_CONTRACT",
        "JOB_SECURITY",
        "MANAGER_INTERVIEW",
        "FACILITY_REQUEST",
        "FEDERATION_FUNDING",
        "GOVERNMENT_SUPPORT",
      ].map((type) => [type, adapterFor(type)]),
    ),
  );

export const getAvailableInteractions = (
  db: GameDatabase,
  context: Pick<UniversalInteractionAdapterContext, "initiator" | "counterpart" | "organisationId">,
): UniversalInteractionDescriptor[] => {
  const sameOrganisation = Boolean(context.organisationId);
  return [
    {
      type: "CONTRACT_NEGOTIATION",
      subject: "Contract terms",
      canOpen: sameOrganisation || context.initiator.type === "CHAIRMAN",
      reason: sameOrganisation ? undefined : "No club authority",
    },
    {
      type: "TRANSFER_NEGOTIATION",
      subject: "Transfer proposal",
      canOpen: context.initiator.type === "MANAGER" || context.initiator.type === "CHAIRMAN",
      reason: "Requires club authority",
    },
    {
      type: "PLAYER_CONCERN",
      subject: "Player concern",
      canOpen: context.initiator.type === "MANAGER" && context.counterpart.type === "PLAYER",
      reason: "Requires manager-player relationship",
    },
    {
      type: "BOARD_REQUEST",
      subject: "Board request",
      canOpen: context.initiator.type === "MANAGER" && context.counterpart.type === "BOARD",
      reason: "Requires manager authority",
    },
    {
      type: "FEDERATION_FUNDING",
      subject: "Federation funding",
      canOpen:
        context.initiator.type === "FEDERATION_OFFICIAL" || context.initiator.type === "GOVERNMENT",
      reason: "Requires federation stakeholder authority",
    },
  ];
};

export const openInteraction = (
  db: GameDatabase,
  context: UniversalInteractionAdapterContext,
): UniversalInteraction => {
  const adapter = universalInteractionAdapters[context.interactionType] ?? genericAdapter;
  const authority: Record<string, (value: UniversalInteractionAdapterContext) => boolean> = {
    PLAYER_CONCERN: (value) =>
      value.initiator.type === "MANAGER" &&
      value.counterpart.type === "PLAYER" &&
      Boolean(value.organisationId),
    BOARD_REQUEST: (value) =>
      value.initiator.type === "MANAGER" &&
      value.counterpart.type === "BOARD" &&
      Boolean(value.organisationId),
    OWNER_MANAGER_MEETING: (value) =>
      value.initiator.type === "CHAIRMAN" &&
      value.counterpart.type === "MANAGER" &&
      Boolean(value.organisationId),
    FACILITY_REQUEST: (value) =>
      ["MANAGER", "CHAIRMAN"].includes(value.initiator.type) &&
      value.counterpart.type === "BOARD" &&
      Boolean(value.organisationId),
    STAFF_CONTRACT: (value) =>
      ["MANAGER", "CHAIRMAN"].includes(value.initiator.type) &&
      ["STAFF", "MANAGER"].includes(value.counterpart.type) &&
      Boolean(value.organisationId),
    FEDERATION_FUNDING: (value) =>
      ["FEDERATION_OFFICIAL", "GOVERNMENT"].includes(value.initiator.type),
    FEDERATION_PROJECT: (value) => value.initiator.type === "FEDERATION_OFFICIAL",
    FEDERATION_CORRECTIVE_ACTION: (value) => value.initiator.type === "FEDERATION_OFFICIAL",
  };
  if (authority[context.interactionType] && !authority[context.interactionType]!(context))
    throw new Error("Interaction authority is not available for the current career role");
  if (!adapter.canOpen(db, context))
    throw new Error("Interaction cannot be opened from the current domain state");
  const session = openUniversalInteraction(db, adapter.buildContext(context));
  if (!context.linkedReference) return session;
  const linked = {
    ...session,
    linkedReference: context.linkedReference,
    execution: { status: "PENDING" as const, idempotencyKey: `interaction:${session.id}:accepted` },
  };
  new UniversalInteractionRepository(db).upsert(linked);
  return linked;
};

export const getActiveInteractions = (db: GameDatabase): UniversalInteraction[] =>
  new UniversalInteractionRepository(db).active();
export const getInteractionHistory = (db: GameDatabase): UniversalInteraction[] =>
  new UniversalInteractionRepository(db).all();

export const submitInteractionAction = (
  db: GameDatabase,
  input: Parameters<typeof submitUniversalInteractionAction>[1],
): UniversalInteraction => {
  const repo = new UniversalInteractionRepository(db);
  const current = repo.session(input.interactionId);
  if (!current) throw new Error("Interaction not found");
  if (current.execution?.status === "APPLIED" || current.execution?.status === "ALREADY_APPLIED")
    return current;
  if (current.execution?.status === "FAILED" && current.stage === "CANCELLED") return current;
  const next =
    current.stage === "ACCEPTED" && current.execution?.status === "PENDING"
      ? current
      : submitUniversalInteractionAction(db, input);
  if (next.stage !== "ACCEPTED") return next;
  if (next.execution?.status === "APPLIED" || next.execution?.status === "ALREADY_APPLIED")
    return next;
  if (!next.linkedReference) return markPending(repo, next);
  db.exec("SAVEPOINT universal_interaction_execution;");
  try {
    const result = executeAcceptedInteraction(db, next, input.date, input.seed);
    db.exec("RELEASE SAVEPOINT universal_interaction_execution;");
    const applied = {
      ...next,
      linkedReference: { ...next.linkedReference, resultId: result.id },
      promiseIds: result.promiseId
        ? [...new Set([...next.promiseIds, result.promiseId])]
        : next.promiseIds,
      execution: {
        status: result.already ? ("ALREADY_APPLIED" as const) : ("APPLIED" as const),
        resultId: result.id,
        idempotencyKey: `interaction:${next.id}:accepted`,
      },
      outcome: result.note ?? next.outcome,
    };
    repo.upsert(applied);
    return applied;
  } catch (error) {
    db.exec("ROLLBACK TO SAVEPOINT universal_interaction_execution;");
    db.exec("RELEASE SAVEPOINT universal_interaction_execution;");
    const failed = {
      ...next,
      stage: "CANCELLED" as const,
      availableActions: [],
      outcome: "Authoritative domain operation failed",
      execution: {
        status: "FAILED" as const,
        idempotencyKey: `interaction:${next.id}:accepted`,
        error: error instanceof Error ? error.message : String(error),
      },
    };
    repo.upsert(failed);
    return failed;
  }
};

const markPending = (
  repo: UniversalInteractionRepository,
  session: UniversalInteraction,
): UniversalInteraction => {
  const pending = {
    ...session,
    execution: { status: "PENDING" as const, idempotencyKey: `interaction:${session.id}:accepted` },
  };
  repo.upsert(pending);
  return pending;
};

type ExecutionResult = { id: EntityId; already?: boolean; promiseId?: EntityId; note?: string };
const offerNumber = (session: UniversalInteraction, ...keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = session.offers[key] ?? session.demands[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
};
const offerText = (session: UniversalInteraction, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = session.offers[key] ?? session.demands[key];
    if (typeof value === "string") return value;
  }
  return undefined;
};
const managerHasAuthority = (
  db: GameDatabase,
  personId: EntityId,
  clubId: EntityId,
  date: string,
): boolean =>
  Boolean(
    db
      .prepare(
        `SELECT 1 FROM manager_contracts mc JOIN manager_profiles mp ON mp.id=mc.manager_profile_id WHERE mp.person_id=? AND mc.club_id=? AND mc.status='ACTIVE' AND mc.contract_start<=? AND (mc.contract_end IS NULL OR mc.contract_end>=?) LIMIT 1`,
      )
      .get(personId, clubId, date, date),
  );
const saveFor = (db: GameDatabase, session: UniversalInteraction) => loadSave(db, session.saveId);

const executeAcceptedInteraction = (
  db: GameDatabase,
  session: UniversalInteraction,
  date: string,
  seed: string,
): ExecutionResult => {
  const reference = session.linkedReference!;
  if (reference.type === "TRANSFER_OFFER" || reference.type === "TRANSFER_DEAL") {
    const offer = new TransferMarketRepository(db)
      .transferOffers()
      .find((item) => item.id === reference.canonicalId);
    if (!offer) throw new Error("TRANSFER_OFFER_NOT_FOUND");
    if (offer.status === "COMPLETED") return { id: offer.id, already: true };
    completePermanentTransfer(db, offer, date, seed);
    const updated = new TransferMarketRepository(db)
      .transferOffers()
      .find((item) => item.id === offer.id);
    if (updated?.status !== "COMPLETED") throw new Error("TRANSFER_OPERATION_NOT_COMPLETED");
    return { id: offer.id };
  }
  if (reference.type === "CONTRACT_NEGOTIATION") {
    const clubId = session.organisationId;
    if (!clubId) throw new Error("CONTRACT_CLUB_NOT_FOUND");
    if (
      session.initiator.type === "MANAGER" &&
      !managerHasAuthority(db, session.initiator.entityId, clubId, date)
    )
      throw new Error("STALE_MANAGER_AUTHORITY");
    const market = new TransferMarketRepository(db);
    const existing = market.activeContract(reference.canonicalId, date);
    if (existing?.clubId === clubId && session.initiator.type === "PLAYER")
      return { id: existing.id, already: true };
    const offer = createTransferOffer(db, {
      buyingClubId: clubId,
      sellingClubId: existing?.clubId,
      playerId: reference.canonicalId,
      submittedAt: date,
      fee: offerNumber(session, "transferFee", "fee"),
    });
    completePermanentTransfer(db, offer, date, seed);
    const contract = market.activeContract(reference.canonicalId, date);
    if (!contract || contract.clubId !== clubId)
      throw new Error("CONTRACT_OPERATION_NOT_COMPLETED");
    return { id: contract.id };
  }
  if (reference.type === "CONTRACT") {
    const contract = new TransferMarketRepository(db)
      .allPlayerContracts()
      .find((item) => item.id === reference.canonicalId && item.status === "ACTIVE");
    if (!contract) throw new Error("CONTRACT_NOT_ACTIONABLE");
    return { id: contract.id, already: true };
  }
  if (reference.type === "STAFF_CONTRACT") {
    const clubId = session.organisationId;
    if (!clubId) throw new Error("STAFF_CLUB_NOT_FOUND");
    if (
      session.initiator.type === "MANAGER" &&
      !managerHasAuthority(db, session.initiator.entityId, clubId, date)
    )
      throw new Error("STALE_MANAGER_AUTHORITY");
    const market = new StaffMarketRepository(db);
    const appointment =
      market.appointmentById(reference.canonicalId) ??
      market.activeAppointment(reference.canonicalId);
    const save = saveFor(db, session);
    if (appointment?.clubId === clubId && appointment.contractId) {
      const offer = offerStaffRenewal(
        db,
        save,
        appointment.id,
        Math.max(
          0,
          offerNumber(session, "salary", "wage") ??
            market.employmentContractById(appointment.contractId)?.salaryAmountMinor ??
            0,
        ),
        Math.max(1, Math.round(offerNumber(session, "contractMonths", "months") ?? 24)),
      );
      if (offer.status !== "ACCEPTED") throw new Error(`STAFF_RENEWAL_${offer.status}`);
      return { id: appointment.contractId };
    }
    const role = (offerText(session, "role") ?? "ASSISTANT_COACH") as Parameters<
      typeof hireStaff
    >[5];
    const hired = hireStaff(
      db,
      save,
      clubId,
      undefined,
      reference.canonicalId,
      role,
      Math.max(0, offerNumber(session, "salary", "wage") ?? 0),
      Math.max(1, Math.round(offerNumber(session, "contractMonths", "months") ?? 24)),
    );
    if (!hired.contractId) throw new Error("STAFF_CONTRACT_NOT_CREATED");
    return { id: hired.contractId };
  }
  if (reference.type === "PLAYER_CONCERN" || reference.type === "PLAYER_PROMISE") {
    const concernId = reference.canonicalId;
    const dynamics = new SquadDynamicsRepository(db);
    if (reference.type === "PLAYER_PROMISE") {
      const promise = dynamics.promiseById(reference.canonicalId);
      if (promise) return { id: promise.id, already: true };
    }
    const concern = dynamics.concernById(concernId);
    if (!concern) throw new Error("PLAYER_CONCERN_NOT_FOUND");
    const response = dynamics
      .responsesForConcern(concernId)
      .find(
        (item) =>
          item.managerProfileId ===
            new ManagerRepository(db).getProfileByPerson(session.initiator.entityId)?.id &&
          item.occurredOn === date,
      );
    if (response) return { id: response.id, already: true, promiseId: response.promiseId };
    const profile = new ManagerRepository(db).getProfileByPerson(session.initiator.entityId);
    if (!profile) throw new Error("MANAGER_PROFILE_NOT_FOUND");
    if (
      session.initiator.type === "MANAGER" &&
      session.organisationId &&
      !managerHasAuthority(db, session.initiator.entityId, session.organisationId, date)
    )
      throw new Error("STALE_MANAGER_AUTHORITY");
    const action = (offerText(session, "responseAction", "action") ?? "REASSURE") as Parameters<
      typeof respondToConcern
    >[4];
    const result = respondToConcern(db, saveFor(db, session), profile.id, concernId, action);
    return { id: result.id, promiseId: result.promiseId };
  }
  if (reference.type === "FACILITY_REQUEST" || reference.type === "INFRASTRUCTURE_PROJECT") {
    const clubId = session.organisationId;
    if (!clubId) throw new Error("FACILITY_CLUB_NOT_FOUND");
    const existing = new ClubEconomyRepository(db)
      .infrastructureProjects(clubId)
      .find((project) => project.id === reference.canonicalId);
    if (existing) return { id: existing.id, already: true };
    const project = createInfrastructureProject(db, {
      clubId,
      projectType: (offerText(session, "projectType") ?? "REFURBISHMENT") as Parameters<
        typeof createInfrastructureProject
      >[1]["projectType"],
      date,
      seed,
      financing: { clubCash: 1 },
    });
    return { id: project.id };
  }
  if (reference.type === "BOARD_REQUEST") {
    const clubId = session.organisationId;
    if (!clubId || !managerHasAuthority(db, session.initiator.entityId, clubId, date))
      throw new Error("STALE_MANAGER_AUTHORITY");
    const category = (offerText(session, "category") ??
      (session.subject.toLowerCase().includes("wage")
        ? "WAGE_BUDGET"
        : "TRANSFER_BUDGET")) as Parameters<typeof setClubBudget>[1]["category"];
    const economy = new ClubEconomyRepository(db);
    const current = economy
      .budgets(clubId)
      .find((budget) => budget.category === category && budget.status === "ACTIVE");
    if (!current) throw new Error("CLUB_BUDGET_NOT_FOUND");
    const target = offerNumber(
      session,
      "amount",
      "budget",
      category === "WAGE_BUDGET" ? "wageBudget" : "transferBudget",
    );
    if (target === undefined || target < current.usedAmount)
      throw new Error("INVALID_BUDGET_REQUEST");
    const budget = setClubBudget(db, {
      clubId,
      seasonLabel: current.seasonLabel,
      category,
      amount: target,
    });
    return { id: budget.id };
  }
  if (reference.type === "OWNER_MANAGER_MEETING") {
    const clubId = session.organisationId;
    if (!clubId || session.initiator.type !== "CHAIRMAN" || session.counterpart.type !== "MANAGER")
      throw new Error("OWNER_MANAGER_MEETING_AUTHORITY");
    const policy = new ClubEconomyRepository(db).boardPolicy(clubId);
    if (!policy?.chairmanPersonId || policy.chairmanPersonId !== session.initiator.entityId)
      throw new Error("OWNER_MANAGER_MEETING_CHAIRMAN_MISMATCH");
    const contract = new ManagerRepository(db)
      .allActiveContracts()
      .find((item) => item.clubId === clubId && item.managerProfileId);
    const profile = contract
      ? new ManagerRepository(db).getProfile(contract.managerProfileId)
      : undefined;
    if (!contract || !profile || profile.personId !== session.counterpart.entityId)
      throw new Error("OWNER_MANAGER_MEETING_MANAGER_MISMATCH");
    const stance = offerText(session, "stance") ?? "SUPPORT";
    const confidence = new CareerWorldRepository(db).boardConfidence(clubId);
    if (!confidence) throw new Error("BOARD_CONFIDENCE_NOT_FOUND");
    const confidenceDelta = stance === "CONCERN" ? -2 : stance === "REQUEST" ? 1 : 3;
    new CareerWorldRepository(db).upsertBoardConfidence({
      ...confidence,
      confidence: Math.max(0, Math.min(100, confidence.confidence + confidenceDelta)),
      lastEvaluatedOn: date,
    });
    upsertPersonRelationship({
      db,
      fromPersonId: profile.personId,
      toPersonId: policy.chairmanPersonId,
      kind: "MANAGER_BOARD",
      affinity: Math.max(
        0,
        Math.min(100, session.relationshipState + (stance === "CONCERN" ? -2 : 2)),
      ),
      trust: Math.max(0, Math.min(100, session.trust + (stance === "CONCERN" ? -2 : 2))),
      respect: Math.max(0, Math.min(100, session.leverage)),
      tension: Math.max(0, Math.min(100, session.pressure + (stance === "CONCERN" ? 5 : 0))),
      date,
    });
    const commitmentType = offerText(session, "commitmentType");
    const promise =
      commitmentType && contract.teamId
        ? createStructuredCommitment(db, date, {
            source: "BOARD_INTERVIEW",
            managerProfileId: profile.id,
            managerPersonId: profile.personId,
            teamId: contract.teamId,
            type: commitmentType as Parameters<typeof createStructuredCommitment>[2]["type"],
            targetCriteria: offerText(session, "targetCriteria") ?? "",
            dueOn: offerText(session, "commitmentDueOn") ?? session.deadline ?? date,
            description:
              offerText(session, "commitmentDescription") ?? `Board commitment: ${commitmentType}`,
            originEventId: session.id,
            importance: offerNumber(session, "importance"),
            recipientType: "BOARD",
          })
        : undefined;
    // A concise, canonical-stance-driven label for the history badge — not
    // an internal description of the mechanism that applied it. The
    // mechanism itself (board confidence, relationship state) is real, but
    // it belongs in supporting detail text, not the one-line outcome shown
    // in the meeting history list.
    const outcomeLabel =
      promise
        ? "Commitment agreed"
        : stance === "CONCERN"
          ? "Concern raised"
          : stance === "REQUEST"
            ? "Improvement requested"
            : "Support extended";
    return {
      id: clubId,
      promiseId: promise?.id,
      note: outcomeLabel,
    };
  }
  if (reference.type === "FEDERATION_GRANT" || reference.type === "FEDERATION_FUNDING") {
    const grant = new FederationComplianceRepository(db).grant(reference.canonicalId);
    if (!grant) throw new Error("FEDERATION_GRANT_NOT_FOUND");
    if (["ACTIVE", "PARTIALLY_DISBURSED"].includes(grant.status) && grant.remainingAmount <= 0)
      return { id: grant.id, already: true };
    if (
      offerNumber(session, "disbursement", "amount") !== undefined &&
      ["APPROVED", "PARTIALLY_DISBURSED", "ACTIVE", "REPORTING_DUE"].includes(grant.status)
    )
      return {
        id: disburseFederationGrant(db, grant.id, {
          date,
          amount: offerNumber(session, "disbursement", "amount")!,
        }).id,
      };
    return {
      id: approveFederationGrant(db, grant.id, {
        date,
        approvedAmount: offerNumber(session, "approvedAmount", "amount") ?? grant.approvedAmount,
      }).id,
    };
  }
  if (reference.type === "FEDERATION_CORRECTIVE_ACTION")
    return {
      id: completeCorrectiveAction(db, reference.canonicalId, {
        date,
        evidence: offerText(session, "evidence") ?? session.subject,
      }).id,
    };
  if (reference.type === "FEDERATION_PROJECT") {
    const federationId = session.organisationId;
    if (!federationId) throw new Error("FEDERATION_NOT_FOUND");
    const existing = new FederationGovernanceRepository(db)
      .projects(federationId)
      .find((project) => project.id === reference.canonicalId);
    if (existing) return { id: existing.id, already: true };
    const project = createFederationProject(db, {
      federationId,
      projectType: (offerText(session, "projectType") ?? "TECHNICAL_CENTRE") as Parameters<
        typeof createFederationProject
      >[1]["projectType"],
      name: offerText(session, "name") ?? session.subject,
      date,
      seed,
    });
    return { id: project.id };
  }
  if (reference.type === "GOVERNMENT_SUPPORT") {
    const repo = new GovernmentRepository(db);
    const application = repo.applications().find((item) => item.id === reference.canonicalId);
    if (!application) throw new Error("GOVERNMENT_APPLICATION_NOT_FOUND");
    if (application.status === "COMPLETED" || application.status === "APPROVED")
      return { id: application.id, already: true };
    if (application.status === "PROPOSED")
      return { id: submitGovernmentFunding(db, application.id).id };
    return {
      id: reviewGovernmentFunding(db, {
        applicationId: application.id,
        reviewedOn: date,
        evidence: {
          federationCredibility: session.trust,
          projectQuality: session.leverage,
          footballPerformance: session.relationshipState,
          existingCommitments: session.pressure,
        },
      }).id,
    };
  }
  if (reference.type === "JOB_SECURITY") {
    const clubId = session.organisationId;
    const confidence = clubId ? new CareerWorldRepository(db).boardConfidence(clubId) : undefined;
    if (!clubId || !confidence) throw new Error("BOARD_CONFIDENCE_NOT_FOUND");
    const updated = {
      ...confidence,
      confidence: Math.max(
        0,
        Math.min(
          100,
          confidence.confidence + Math.round(offerNumber(session, "confidenceDelta") ?? 2),
        ),
      ),
      lastEvaluatedOn: date,
    };
    new CareerWorldRepository(db).upsertBoardConfidence(updated);
    return { id: clubId };
  }
  if (reference.type === "COMMERCIAL_DEAL") {
    const offer = new CommercialRightsRepository(db)
      .offers()
      .find((item) => item.id === reference.canonicalId);
    if (!offer) throw new Error("COMMERCIAL_OFFER_NOT_FOUND");
    if (offer.status === "ACTIVE") return { id: offer.id, already: true };
    return {
      id: awardCommercialRightsForPresident(db, {
        offerId: offer.id,
        federationId: offer.federationId,
        presidentPersonId: session.initiator.entityId,
        date,
        startDate: date,
      }).id,
    };
  }
  throw new Error(`NO_AUTHORITATIVE_HANDLER_${reference.type}`);
};
