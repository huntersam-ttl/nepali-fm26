import type { CareerRole, EntityId, EntityReference, HistoricalEvent, StoryAction } from "@nepal-football-sim/shared-types";
import {
  ClubEconomyRepository,
  GovernmentRepository,
  OwnershipRepository,
  SquadDynamicsRepository,
  TransferMarketRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { buildEntityReference } from "./entity-reference.js";
import { executiveHasAuthority } from "./executive-roles.js";

const FACILITY_AUTHORITY_ROLES: readonly CareerRole[] = ["CHAIRMAN_OWNER", "CEO", "GENERAL_SECRETARY"];

/** Club executive roles whose canonical authority set (executiveAuthorities,
 * shared-types/src/executive-roles.ts) includes TRANSFER_NEGOTIATION. Holding
 * the role is never enough on its own — the appointment itself must still be
 * genuinely filled at the club the negotiation involves, which is exactly what
 * executiveHasAuthority checks. */
const TRANSFER_EXECUTIVE_ROLES: readonly CareerRole[] = ["SPORTING_DIRECTOR", "DIRECTOR_OF_FOOTBALL"];

/** True when this person really holds delegated transfer-negotiation authority
 * at one of the clubs actually involved in the offer — never by role name
 * alone, and never for a club the executive is not appointed to. */
const hasDelegatedTransferAuthority = (
  db: GameDatabase,
  role: CareerRole,
  personId: EntityId | undefined,
  clubIds: readonly (EntityId | undefined)[],
): boolean => {
  if (!personId || !TRANSFER_EXECUTIVE_ROLES.includes(role)) return false;
  return clubIds.some(
    (clubId) => clubId !== undefined && executiveHasAuthority(db, clubId, personId, "TRANSFER_NEGOTIATION"),
  );
};

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
  /** The acting career person, when the caller knows it. Required only for
   * branches whose authority is delegated per-appointment rather than implied
   * by the role itself (see hasDelegatedTransferAuthority) — omitting it can
   * only ever withhold an action, never grant one. */
  personId?: EntityId,
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

  // Transfer/loan negotiation — the manager's own workflow authority, plus
  // any club executive who genuinely holds delegated TRANSFER_NEGOTIATION
  // authority at a club in this negotiation (Sporting Director / Director of
  // Football). Never the owner's or president's. TransferNegotiationMeeting
  // itself already renders a settled offer read-only (no Accept/Counter), so
  // the SAME action reaches both an active and a terminal negotiation honestly.
  // The ownership exclusion matters: CLUB_OWNERSHIP_TRANSFERRED contains
  // "TRANSFERRED", so without it an ownership hand-over would be probed as a
  // player transfer (harmless today only because the offer id never resolves).
  if (
    /TRANSFER|LOAN|FREE_AGENT/.test(type) &&
    !/OWNERSHIP|INVESTOR|TAKEOVER/.test(type) &&
    typeof data?.offerId === "string" &&
    (role === "MANAGER" || TRANSFER_EXECUTIVE_ROLES.includes(role))
  ) {
    const offer = new TransferMarketRepository(db).transferOffers().find((item) => item.id === data.offerId);
    const authorized =
      role === "MANAGER" ||
      (offer !== undefined && hasDelegatedTransferAuthority(db, role, personId, [offer.buyingClubId, offer.sellingClubId]));
    if (offer && authorized) {
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

  // Player relationship — a concern escalating or a demand opening/being
  // rejected is exactly the moment a manager would want to sit down with
  // the player. Manager-only (the same authority holdSquadMeeting/
  // respondToConcern/respondToDemand already require); only offered while
  // the concern/demand still genuinely exists and hasn't already been
  // settled — never a dead button pointing at a resolved record.
  if (/CONCERN_ESCALATED|DEMAND_OPENED|DEMAND_REJECTED/.test(type) && role === "MANAGER") {
    const dynamics = new SquadDynamicsRepository(db);
    const concernId = typeof data?.concernId === "string" ? (data.concernId as EntityId) : undefined;
    const demandId = typeof data?.demandId === "string" ? (data.demandId as EntityId) : undefined;
    const concern = concernId ? dynamics.concernById(concernId) : undefined;
    const demand = demandId ? dynamics.demandById(demandId) : undefined;
    const personId = event.involvedEntities.find((entity) => entity.type === "person")?.id;
    const stillOpen =
      (concern && concern.status !== "RESOLVED") || (demand && demand.status === "OPEN");
    if (personId && stillOpen) {
      actions.push({
        id: `open-player-meeting:${event.id}`,
        label: "Open meeting",
        kind: "OPEN_PLAYER_MEETING",
        personId,
        concernId: concern && concern.status !== "RESOLVED" ? concern.id : undefined,
        demandId: demand && demand.status === "OPEN" ? demand.id : undefined,
      });
    }
  }

  // Captaincy reaction or a team meeting's result — both are dressing-room
  // matters. Manager-only, matching holdSquadMeeting/appointCaptaincy's own
  // authority; always offered when it applies since the Dressing Room
  // screen itself is always reachable (never a dead end even once the
  // underlying reaction/meeting has settled).
  if (/CAPTAINCY_REACTION|CAPTAINCY_CHANGE|TEAM_MEETING_RESULT/.test(type) && role === "MANAGER") {
    actions.push({
      id: `open-dressing-room:${event.id}`,
      label: "Open Dressing Room",
      kind: "OPEN_DRESSING_ROOM",
    });
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
