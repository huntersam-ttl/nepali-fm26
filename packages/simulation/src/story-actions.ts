import type { CareerRole, EntityId, EntityReference, HistoricalEvent, StoryAction } from "@nepal-football-sim/shared-types";
import {
  ClubEconomyRepository,
  GovernmentRepository,
  OwnershipRepository,
  TransferMarketRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { buildEntityReference } from "./entity-reference.js";

const FACILITY_AUTHORITY_ROLES: readonly CareerRole[] = ["CHAIRMAN_OWNER", "CEO", "GENERAL_SECRETARY"];

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
      const terminal = ["COMPLETED", "REJECTED", "WITHDRAWN"].includes(offer.status);
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

  // Government support application — buildGovernmentSupportMeeting already
  // resolves the club's current/most-recent application from clubId alone
  // (siteOptionId/projectId are optional enrichment, not required), so the
  // real, still-queryable application id is enough to route here safely.
  // Only the club's own facility authority — never the Manager or President
  // — can act on it; the President's own government view is a separate,
  // federation-wide screen (getGovernmentOverview), not this club meeting.
  if (/GOVERNMENT/.test(type) && typeof data?.applicationId === "string" && FACILITY_AUTHORITY_ROLES.includes(role)) {
    const application = new GovernmentRepository(db).applications().find((item) => item.id === data.applicationId);
    if (application?.clubId) {
      const terminal = ["APPROVED", "REJECTED", "COMPLETED"].includes(application.status);
      actions.push({
        id: `open-government-support:${application.id}`,
        label: terminal ? "View government decision" : "Review government request",
        kind: "OPEN_GOVERNMENT_SUPPORT",
        clubId: application.clubId,
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

  // Competition outcome (promotion/relegation/championship/expansion) — a
  // real, permanent Competition entity, so this reuses the existing
  // entity-open mechanism (like the facility branch above) rather than
  // inventing a second navigation path. Every role may view a competition,
  // so there is no role gate here — visibility/mutation authority within
  // the profile itself is handled by buildEntityReference's own role actions.
  if (/CLUB_PROMOTED|CLUB_RELEGATED|COMPETITION_CHAMPION_DECLARED|COMPETITION_EXPANDED|CLUB_QUALIFIED/.test(type)) {
    const competitionId = (data?.competitionId ?? data?.toCompetitionId ?? data?.fromCompetitionId) as
      | string
      | undefined;
    if (typeof competitionId === "string") {
      const competition = buildEntityReference(db, "COMPETITION", competitionId as EntityId, role);
      if (competition?.visible) {
        actions.push({
          id: `open-entity:${competition.entityType}:${competition.id}`,
          label: "View competition",
          kind: "OPEN_ENTITY",
          entity: competition,
        });
      }
    }
  }

  // Club sponsorship — the SPONSOR entity type resolves the sponsor
  // ORGANIZATION profile (commercial_sponsor_profiles/sponsor_organisations),
  // not the contract row itself, so the contract must be looked up first to
  // find its real, still-queryable sponsorId before reusing the existing
  // entity-open mechanism.
  if (/SPONSORSHIP/.test(type) && typeof data?.sponsorshipId === "string") {
    const contract = new ClubEconomyRepository(db).sponsorship(data.sponsorshipId as EntityId);
    const sponsorship = contract ? buildEntityReference(db, "SPONSOR", contract.sponsorId, role) : undefined;
    if (sponsorship?.visible) {
      actions.push({
        id: `open-entity:${sponsorship.entityType}:${sponsorship.id}`,
        label: "View sponsorship",
        kind: "OPEN_ENTITY",
        entity: sponsorship,
      });
    }
  }

  // Federation commercial rights — the President's own federation-wide
  // commercial portfolio; only real once the awarded offer still resolves.
  if (/FEDERATION_COMMERCIAL/.test(type) && typeof data?.offerId === "string" && role === "FEDERATION_PRESIDENT") {
    if (db.prepare("SELECT 1 FROM federation_commercial_rights_offers WHERE id=?").get(data.offerId)) {
      actions.push({
        id: `open-commercial:${data.offerId}`,
        label: "Open commercial portfolio",
        kind: "OPEN_COMMERCIAL",
        offerId: data.offerId as EntityId,
      });
    }
  }

  // National-team call-up — President-only (the federation's own football
  // authority, not a club role); the team id is real and always resolvable
  // (national teams are permanent fixtures, never deleted).
  if (/NATIONAL_TEAM/.test(type) && typeof data?.teamId === "string" && role === "FEDERATION_PRESIDENT") {
    if (db.prepare("SELECT 1 FROM teams WHERE id=?").get(data.teamId)) {
      actions.push({
        id: `open-national-team:${data.teamId}`,
        label: "Open national team",
        kind: "OPEN_NATIONAL_TEAM",
        teamId: data.teamId as EntityId,
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
