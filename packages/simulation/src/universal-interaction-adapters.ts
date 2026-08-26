import type { EntityId, InteractionAction, InteractionLinkedDomainType, UniversalInteraction } from "@nepal-football-sim/shared-types";
import { UniversalInteractionRepository, type GameDatabase, TransferMarketRepository } from "@nepal-football-sim/database";
import { completePermanentTransfer } from "./transfer-market.js";
import { openUniversalInteraction, submitUniversalInteractionAction } from "./universal-interactions.js";

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
  resolveLinkedEntity: (db: GameDatabase, reference: UniversalInteraction["linkedReference"]) => boolean;
  buildHistoryResult: (session: UniversalInteraction) => string;
};

const terminal = new Set(["ACCEPTED", "REJECTED", "WALKED_AWAY", "COMPLETED", "CANCELLED"]);
const exists = (db: GameDatabase, table: string, id: EntityId): boolean => {
  try { return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id=? LIMIT 1`).get(id)); } catch { return false; }
};

export const resolveLinkedDomainResult = (db: GameDatabase, reference: UniversalInteraction["linkedReference"]): boolean => {
  if (!reference) return false;
  if (reference.type === "TRANSFER_OFFER" || reference.type === "TRANSFER_DEAL") return new TransferMarketRepository(db).transferOffers().some((offer) => offer.id === reference.canonicalId);
  const tables: Partial<Record<InteractionLinkedDomainType, string>> = {
    CONTRACT: "player_contracts", CONTRACT_NEGOTIATION: "player_contracts", PLAYER_PROMISE: "manager_promises",
    PLAYER_CONCERN: "player_concerns", INFRASTRUCTURE_PROJECT: "infrastructure_projects", FEDERATION_GRANT: "federation_grants",
    COMMERCIAL_DEAL: "federation_commercial_contracts",
  };
  const table = tables[reference.type];
  return table ? exists(db, table, reference.canonicalId) : true;
};

const genericAdapter: UniversalInteractionAdapter = {
  type: "GENERIC",
  canOpen: (db, context) => resolveLinkedDomainResult(db, context.linkedReference),
  buildContext: (context) => context,
  availableActions: (session) => [...session.availableActions],
  validateAction: (session, action) => { if (terminal.has(session.stage) || !session.availableActions.includes(action)) throw new Error("Interaction action is not available"); },
  resolveLinkedEntity: resolveLinkedDomainResult,
  buildHistoryResult: (session) => session.outcome ?? "Interaction recorded",
};

const adapterFor = (type: string): UniversalInteractionAdapter => ({ ...genericAdapter, type, canOpen: (db, context) => {
  // Negotiations may be opened before a contract/deal exists; participants and
  // the domain-specific authority check are then the source of truth.
  if (type === "CONTRACT_NEGOTIATION" || type === "TRANSFER_NEGOTIATION") return Boolean(context.initiator.entityId && context.counterpart.entityId);
  return genericAdapter.canOpen(db, context);
} });

export const universalInteractionAdapters: Readonly<Record<string, UniversalInteractionAdapter>> = Object.freeze(Object.fromEntries([
  "CONTRACT_NEGOTIATION", "CONTRACT", "TRANSFER_NEGOTIATION", "TRANSFER_OFFER", "TRANSFER_DEAL", "PLAYER_CONCERN",
  "PLAYER_PROMISE", "BOARD_REQUEST", "INFRASTRUCTURE_PROJECT", "FEDERATION_GRANT", "FEDERATION_PROJECT",
  "FEDERATION_CORRECTIVE_ACTION", "COMMERCIAL_DEAL", "STAFF_CONTRACT", "JOB_SECURITY", "FACILITY_REQUEST",
  "FEDERATION_FUNDING", "GOVERNMENT_SUPPORT",
].map((type) => [type, adapterFor(type)])));

export const getAvailableInteractions = (db: GameDatabase, context: Pick<UniversalInteractionAdapterContext, "initiator" | "counterpart" | "organisationId">): UniversalInteractionDescriptor[] => {
  const sameOrganisation = Boolean(context.organisationId);
  return [
    { type: "CONTRACT_NEGOTIATION", subject: "Contract terms", canOpen: sameOrganisation || context.initiator.type === "CHAIRMAN", reason: sameOrganisation ? undefined : "No club authority" },
    { type: "TRANSFER_NEGOTIATION", subject: "Transfer proposal", canOpen: context.initiator.type === "MANAGER" || context.initiator.type === "CHAIRMAN", reason: "Requires club authority" },
    { type: "PLAYER_CONCERN", subject: "Player concern", canOpen: context.initiator.type === "MANAGER" && context.counterpart.type === "PLAYER", reason: "Requires manager-player relationship" },
    { type: "BOARD_REQUEST", subject: "Board request", canOpen: context.initiator.type === "MANAGER" && context.counterpart.type === "BOARD", reason: "Requires manager authority" },
    { type: "FEDERATION_FUNDING", subject: "Federation funding", canOpen: context.initiator.type === "FEDERATION_OFFICIAL" || context.initiator.type === "GOVERNMENT", reason: "Requires federation stakeholder authority" },
  ];
};

export const openInteraction = (db: GameDatabase, context: UniversalInteractionAdapterContext): UniversalInteraction => {
  const adapter = universalInteractionAdapters[context.interactionType] ?? genericAdapter;
  const authority: Record<string, (value: UniversalInteractionAdapterContext) => boolean> = {
    PLAYER_CONCERN: (value) => value.initiator.type === "MANAGER" && value.counterpart.type === "PLAYER" && Boolean(value.organisationId),
    BOARD_REQUEST: (value) => value.initiator.type === "MANAGER" && value.counterpart.type === "BOARD" && Boolean(value.organisationId),
    FACILITY_REQUEST: (value) => ["MANAGER", "CHAIRMAN"].includes(value.initiator.type) && value.counterpart.type === "BOARD" && Boolean(value.organisationId),
    STAFF_CONTRACT: (value) => ["MANAGER", "CHAIRMAN"].includes(value.initiator.type) && ["STAFF", "MANAGER"].includes(value.counterpart.type) && Boolean(value.organisationId),
    FEDERATION_FUNDING: (value) => ["FEDERATION_OFFICIAL", "GOVERNMENT"].includes(value.initiator.type),
    FEDERATION_PROJECT: (value) => value.initiator.type === "FEDERATION_OFFICIAL",
    FEDERATION_CORRECTIVE_ACTION: (value) => value.initiator.type === "FEDERATION_OFFICIAL",
  };
  if (authority[context.interactionType] && !authority[context.interactionType]!(context)) throw new Error("Interaction authority is not available for the current career role");
  if (!adapter.canOpen(db, context)) throw new Error("Interaction cannot be opened from the current domain state");
  const session = openUniversalInteraction(db, adapter.buildContext(context));
  if (!context.linkedReference) return session;
  const linked = { ...session, linkedReference: context.linkedReference, execution: { status: "PENDING" as const, idempotencyKey: `interaction:${session.id}:accepted` } };
  new UniversalInteractionRepository(db).upsert(linked);
  return linked;
};

export const getActiveInteractions = (db: GameDatabase): UniversalInteraction[] => new UniversalInteractionRepository(db).active();
export const getInteractionHistory = (db: GameDatabase): UniversalInteraction[] => new UniversalInteractionRepository(db).all();

export const submitInteractionAction = (db: GameDatabase, input: Parameters<typeof submitUniversalInteractionAction>[1]): UniversalInteraction => {
  const repo = new UniversalInteractionRepository(db);
  const current = repo.session(input.interactionId);
  if (!current) throw new Error("Interaction not found");
  if (current.execution?.status === "APPLIED") return current;
  if (current.execution?.status === "FAILED" && current.stage === "CANCELLED") return current;
  const next = submitUniversalInteractionAction(db, input);
  if (next.stage !== "ACCEPTED" || !current.linkedReference) return next;
  if (current.linkedReference.type !== "TRANSFER_OFFER" && current.linkedReference.type !== "TRANSFER_DEAL") return { ...next, execution: { status: "PENDING", idempotencyKey: `interaction:${next.id}:accepted` } };
  const offer = new TransferMarketRepository(db).transferOffers().find((item) => item.id === current.linkedReference?.canonicalId);
  if (!offer) return { ...next, stage: "CANCELLED", outcome: "Authoritative transfer offer no longer exists", execution: { status: "FAILED", idempotencyKey: `interaction:${next.id}:accepted`, error: "TRANSFER_OFFER_NOT_FOUND" } };
  try {
    completePermanentTransfer(db, offer, input.date, input.seed);
    const updated = new TransferMarketRepository(db).transferOffers().find((item) => item.id === offer.id);
    if (updated?.status !== "COMPLETED") throw new Error("Authoritative transfer operation did not complete");
    const applied = { ...next, linkedReference: { ...current.linkedReference, resultId: offer.id }, execution: { status: "APPLIED" as const, resultId: offer.id, idempotencyKey: `interaction:${next.id}:accepted` } };
    repo.upsert(applied); return applied;
  } catch (error) {
    const failed = { ...next, stage: "CANCELLED" as const, availableActions: [], outcome: "Authoritative transfer operation failed", execution: { status: "FAILED" as const, idempotencyKey: `interaction:${next.id}:accepted`, error: error instanceof Error ? error.message : String(error) } };
    repo.upsert(failed); return failed;
  }
};
