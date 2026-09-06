import type { CareerRole, EntityId, EntityReference, HistoricalEvent, StoryAction } from "@nepal-football-sim/shared-types";
import { OwnershipRepository, TransferMarketRepository, type GameDatabase } from "@nepal-football-sim/database";
import { buildEntityReference } from "./entity-reference.js";

/**
 * The single, central place that decides what a Story Detail can actually
 * DO — never per-screen ad hoc routing. An action only ever appears when a
 * stable, still-queryable workflow id exists on the event itself; there is
 * no name/text matching and no fabricated button for a workflow that can no
 * longer be found. Role authority is enforced here once, so a Manager can
 * never receive an Owner-only investor action and vice versa.
 */
export const buildStoryActions = (
  db: GameDatabase,
  event: HistoricalEvent,
  role: CareerRole,
): StoryAction[] => {
  const actions: StoryAction[] = [];
  const data = event.data;
  const type = event.eventType.toUpperCase();

  // Ownership/investor negotiation — only the controlling owner has any
  // authority over this workflow, and only while the offer itself still
  // exists (it always does; offers are never deleted, only decided).
  if (/OWNERSHIP|INVESTOR/.test(type) && typeof data?.offerId === "string" && role === "CHAIRMAN_OWNER") {
    const offer = new OwnershipRepository(db).offer(data.offerId as EntityId);
    if (offer) {
      const terminal = ["ACCEPTED", "REJECTED", "WITHDRAWN", "EXPIRED"].includes(offer.status);
      actions.push({
        id: `open-investor-meeting:${offer.id}`,
        label: terminal ? "View investor talks (settled)" : "View investor talks",
        kind: "OPEN_INVESTOR_MEETING",
        offerId: offer.id,
      });
    }
  }

  // Transfer/loan negotiation — the manager's own workflow authority, not
  // the owner's or president's. TransferNegotiationMeeting itself already
  // renders a settled offer read-only (no Accept/Counter), so the SAME
  // action reaches both an active and a terminal negotiation honestly.
  if (/TRANSFER|LOAN|FREE_AGENT/.test(type) && typeof data?.offerId === "string" && role === "MANAGER") {
    const offer = new TransferMarketRepository(db).transferOffers().find((item) => item.id === data.offerId);
    if (offer) {
      const terminal = ["COMPLETED", "REJECTED", "WITHDRAWN", "EXPIRED"].includes(offer.status);
      actions.push({
        id: `open-transfer-negotiation:${offer.id}`,
        label: terminal ? "View negotiation history" : "Open negotiation",
        kind: "OPEN_TRANSFER_NEGOTIATION",
        offerId: offer.id,
      });
    }
  }

  // Facility/infrastructure project — a real, still-resolvable profile
  // entity, so this reuses the existing entity-open mechanism rather than
  // inventing a second navigation path.
  if (/FACILITY|INFRASTRUCTURE/.test(type) && typeof data?.projectId === "string") {
    const project = buildEntityReference(db, "INFRASTRUCTURE_PROJECT", data.projectId as EntityId, role);
    if (project?.visible) {
      actions.push({
        id: `open-entity:${project.entityType}:${project.id}`,
        label: "Open project",
        kind: "OPEN_ENTITY",
        entity: project,
      });
    }
  }

  return actions;
};

export const dedupeEntityReferences = (entities: EntityReference[]): EntityReference[] => {
  const seen = new Set<string>();
  const result: EntityReference[] = [];
  for (const entity of entities) {
    const key = `${entity.entityType}:${entity.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entity);
  }
  return result;
};
