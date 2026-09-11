import { MediaPhaseBRepository, MediaRepository } from "@nepal-football-sim/database";
import type { GameDatabase } from "@nepal-football-sim/database";
import type {
  EntityId,
  EntityReference,
  OrganizationCommercialDeal,
  OrganizationProfile,
  OrganizationProfileEntityType,
} from "@nepal-football-sim/shared-types";
import { buildEntityReference } from "./entity-reference.js";

type Row = Record<string, any>;

/** Cold/Wary/Neutral/Positive/Warm text band for a 0..1 journalist trust
 * score — never shown as a raw number, matching how relationship state reads
 * everywhere else in the game. */
const relationshipBand = (trust: number): "Cold" | "Wary" | "Neutral" | "Positive" | "Warm" =>
  trust < 0.2 ? "Cold" : trust < 0.4 ? "Wary" : trust < 0.6 ? "Neutral" : trust < 0.8 ? "Positive" : "Warm";

/** Journalist and Media Outlet profiles reuse the generic OrganizationProfile
 * shape (relationshipClues doubles as a small facts list; there are no
 * commercial deals) rather than a parallel profile type/panel — the existing
 * Organization Profile UI already renders this shape everywhere else. */
const buildMediaEntityProfile = (
  db: GameDatabase,
  type: "JOURNALIST" | "MEDIA_OUTLET",
  id: EntityId,
  role: Parameters<typeof buildEntityReference>[3],
  managerPersonId?: EntityId,
): OrganizationProfile => {
  const entityReference = buildEntityReference(db, type, id, role);
  if (!entityReference.visible) throw new Error("Organization not found");
  const mediaRepo = new MediaRepository(db);
  const phaseB = new MediaPhaseBRepository(db);
  const clues: string[] = [];
  let involvedEntities: EntityReference[] = [];

  if (type === "JOURNALIST") {
    const journalist = phaseB.journalists().find((item) => item.id === id);
    const outlet = journalist ? mediaRepo.outlets().find((item) => item.id === journalist.outletId) : undefined;
    if (journalist) {
      clues.push(`Beat: ${journalist.beat.replace(/_/g, " ").toLowerCase()}`);
      clues.push(`Style: ${journalist.temperament.replace(/_/g, " ").toLowerCase()}`);
      clues.push(
        journalist.reputation >= 70 ? "Widely read" : journalist.reputation >= 40 ? "Established voice" : "Local byline",
      );
      const relationship = managerPersonId
        ? phaseB.relationships(journalist.id).find((item) => item.managerPersonId === managerPersonId)
        : undefined;
      if (relationship) clues.push(`Relationship: ${relationshipBand(relationship.trust)}`);
      const interviewCount = phaseB.interviews().filter((item) => item.journalistId === journalist.id).length;
      if (interviewCount > 0) clues.push(`${interviewCount} interview${interviewCount === 1 ? "" : "s"} on record`);
    }
    involvedEntities = outlet ? [buildEntityReference(db, "MEDIA_OUTLET", outlet.id, role)] : [];
  } else {
    const outlet = mediaRepo.outlets().find((item) => item.id === id);
    if (outlet) {
      clues.push(`Scope: ${outlet.scope.replace(/_/g, " ").toLowerCase()}`);
      clues.push(
        outlet.reach >= 70 ? "Wide reach" : outlet.reach >= 40 ? "Regional reach" : "Local reach",
      );
      clues.push(
        outlet.reputation >= 70 ? "Highly regarded" : outlet.reputation >= 40 ? "Respected" : "Emerging outlet",
      );
      const interviewCount = phaseB.interviews().filter((item) => item.outletId === outlet.id).length;
      if (interviewCount > 0) clues.push(`${interviewCount} interview${interviewCount === 1 ? "" : "s"} on record`);
    }
    involvedEntities = phaseB
      .journalists(id)
      .map((journalist) => buildEntityReference(db, "JOURNALIST", journalist.id, role));
  }

  return {
    entityReference,
    // No separate sector badge here — the entityType badge already reads
    // "Journalist"/"Media Outlet"; a duplicate sector badge saying the same
    // word twice was the whole prior bug.
    sector: undefined,
    organizationContext: "NEPAL",
    provenanceStatus: entityReference.provenanceStatus,
    relationshipClues: clues,
    activeDeals: [],
    dealHistory: [],
    currentNegotiations: [],
    involvedEntities,
  };
};

const sponsorProfile = (db: GameDatabase, id: EntityId): Row | undefined =>
  (db.prepare("SELECT * FROM commercial_sponsor_profiles WHERE id=?").get(id) as Row | undefined) ??
  (db.prepare("SELECT * FROM sponsor_organisations WHERE id=?").get(id) as Row | undefined);

const labelFor = (db: GameDatabase, type: OrganizationProfileEntityType, id: EntityId): string => {
  if (type === "SPONSOR") return sponsorProfile(db, id)?.name ?? id;
  if (type === "LENDER")
    return (
      (db.prepare("SELECT name FROM club_lenders WHERE id=?").get(id) as Row | undefined)?.name ??
      id
    );
  return (
    (
      db
        .prepare("SELECT COALESCE(display_name, full_name) AS name FROM persons WHERE id=?")
        .get(id) as Row | undefined
    )?.name ?? id
  );
};

const investorDeals = (db: GameDatabase, organizationId: EntityId): OrganizationCommercialDeal[] => {
  const transactions = db
    .prepare("SELECT id,offer_id,club_id,amount,percentage,transaction_date,provenance_status FROM ownership_acquisition_transactions WHERE buyer_person_id=? ORDER BY transaction_date,id")
    .all(organizationId) as Row[];
  const transactionOfferIds = new Set(transactions.map((row) => row.offer_id as EntityId));
  const transactionDeals = transactions.map((row) => ({
    id: row.id,
    property: "OWNERSHIP_TRANSACTION",
    scope: "CLUB_OWNERSHIP",
    counterpartId: row.club_id,
    counterpartReference: buildEntityReference(db, "CLUB", row.club_id, "CHAIRMAN_OWNER"),
    startDate: row.transaction_date,
    annualValue: row.amount,
    status: "ACCEPTED",
    sourceEntityId: row.id,
    provenanceStatus: row.provenance_status ?? "SIMULATION_ONLY",
    termYears: undefined,
  }));
  const offers = db
    .prepare("SELECT id,club_id,offer_amount,counter_amount,percentage,status,created_on,decided_on,provenance_status FROM ownership_acquisition_offers WHERE buyer_person_id=? ORDER BY created_on,id")
    .all(organizationId) as Row[];
  const offerDeals = offers
    .filter((row) => !transactionOfferIds.has(row.id as EntityId))
    .map((row) => ({
      id: row.id,
      property: "OWNERSHIP_OFFER",
      scope: "CLUB_OWNERSHIP",
      counterpartId: row.club_id,
      counterpartReference: buildEntityReference(db, "CLUB", row.club_id, "CHAIRMAN_OWNER"),
      startDate: row.created_on,
      endDate: row.decided_on,
      annualValue: row.counter_amount ?? row.offer_amount,
      termYears: undefined,
      status: row.status,
      sourceEntityId: row.id,
      provenanceStatus: row.provenance_status ?? "SIMULATION_ONLY",
    }));
  const stakes = db
    .prepare("SELECT id,club_id,percentage,start_date,status,provenance_status FROM club_ownership_stakes WHERE holder_id=? AND status='ACTIVE' ORDER BY start_date,id")
    .all(organizationId) as Row[];
  const stakeDeals = stakes.map((row) => ({
    id: row.id,
    property: "ACTIVE_OWNERSHIP_STAKE",
    scope: "CLUB_OWNERSHIP",
    counterpartId: row.club_id,
    counterpartReference: buildEntityReference(db, "CLUB", row.club_id, "CHAIRMAN_OWNER"),
    startDate: row.start_date,
    status: "ACTIVE",
    sourceEntityId: row.id,
    provenanceStatus: row.provenance_status ?? "SIMULATION_ONLY",
  }));
  return [...transactionDeals, ...offerDeals, ...stakeDeals];
};

const organizationContext = (
  db: GameDatabase,
  type: OrganizationProfileEntityType,
  organizationId: EntityId,
  provenance: string,
): OrganizationProfile["organizationContext"] => {
  if (provenance === "CONTEXT_ONLY") return "CONTEXT_ONLY";
  const row = type === "LENDER"
    ? db.prepare("SELECT c.iso_code FROM club_lenders l LEFT JOIN countries c ON c.id=l.country_id WHERE l.id=?").get(organizationId) as Row | undefined
    : type === "SPONSOR"
      ? db.prepare("SELECT c.iso_code FROM sponsor_organisations s LEFT JOIN countries c ON c.id=s.country_id WHERE s.id=?").get(organizationId) as Row | undefined
      : db.prepare("SELECT c.iso_code FROM persons p LEFT JOIN countries c ON c.id=p.nationality_country_id WHERE p.id=?").get(organizationId) as Row | undefined;
  if (!row?.iso_code) return "UNKNOWN";
  return row.iso_code === "NP" ? "NEPAL" : "MULTINATIONAL";
};

const rightsDeals = (db: GameDatabase, organizationId: EntityId): OrganizationCommercialDeal[] => {
  const rows = db
    .prepare(
      `SELECT o.id, o.status, o.offered_on, o.start_date, o.end_date, o.annual_value,
              o.term_years, o.scope, p.name AS property
       FROM federation_commercial_rights_offers o
       JOIN federation_commercial_rights_packages p ON p.id=o.package_id
       WHERE o.sponsor_id=? ORDER BY o.offered_on,o.id`,
    )
    .all(organizationId) as Row[];
  return rows.map((row) => ({
    id: row.id,
    property: row.property,
    scope: row.scope,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    annualValue: row.annual_value,
    termYears: row.term_years,
    status: row.status,
    sourceEntityId: row.id,
    provenanceStatus: "SIMULATION_ONLY",
  }));
};

const clubDeals = (db: GameDatabase, organizationId: EntityId): OrganizationCommercialDeal[] => {
  const rows = db
    .prepare(
      `SELECT s.id, s.sponsorship_type, s.start_date, s.end_date, s.annual_value, s.status,
              c.id AS club_id, c.name AS club_name
       FROM sponsorship_contracts s JOIN clubs c ON c.id=s.club_id
       WHERE s.sponsor_id=? ORDER BY s.start_date,s.id`,
    )
    .all(organizationId) as Row[];
  return rows.map((row) => ({
    id: row.id,
    property: row.sponsorship_type,
    scope: "CLUB",
    counterpartId: row.club_id,
    counterpartLabel: row.club_name,
    counterpartReference: buildEntityReference(db, "CLUB", row.club_id, "CHAIRMAN_OWNER"),
    startDate: row.start_date,
    endDate: row.end_date,
    annualValue: row.annual_value,
    status: row.status,
    sourceEntityId: row.id,
    provenanceStatus: row.provenance_status ?? "SIMULATION_ONLY",
  }));
};

const federationDeals = (
  db: GameDatabase,
  organizationId: EntityId,
): OrganizationCommercialDeal[] => {
  const rows = db
    .prepare(
      `SELECT id, sponsorship_type, start_date, end_date, annual_value, status, provenance_status
       FROM federation_sponsorship_contracts WHERE sponsor_id=? ORDER BY start_date,id`,
    )
    .all(organizationId) as Row[];
  return rows.map((row) => ({
    id: row.id,
    property: row.sponsorship_type,
    scope: "FEDERATION",
    startDate: row.start_date,
    endDate: row.end_date,
    annualValue: row.annual_value,
    status: row.status,
    sourceEntityId: row.id,
    provenanceStatus: row.provenance_status ?? "SIMULATION_ONLY",
  }));
};

const nationalTeamDeals = (
  db: GameDatabase,
  organizationId: EntityId,
): OrganizationCommercialDeal[] => {
  const rows = db
    .prepare(
      `SELECT s.id, s.programme, s.commercial_property, s.amount, s.settled_on,
              o.start_date, o.end_date, o.term_years, o.status
       FROM national_team_commercial_settlements s
       JOIN federation_commercial_rights_offers o ON o.id=s.rights_offer_id
       WHERE s.source_organization_id=? ORDER BY s.settled_on,s.id`,
    )
    .all(organizationId) as Row[];
  return rows.map((row) => ({
    id: row.id,
    property: row.commercial_property,
    scope: row.programme,
    startDate: row.start_date ?? row.settled_on,
    endDate: row.end_date ?? undefined,
    annualValue: row.amount,
    termYears: row.term_years,
    status: row.status,
    sourceEntityId: row.rights_offer_id,
    provenanceStatus: "SIMULATION_ONLY",
  }));
};

const lenderDeals = (db: GameDatabase, organizationId: EntityId): OrganizationCommercialDeal[] => {
  const rows = db
    .prepare(
      `SELECT id, club_id, principal, start_date, maturity_date, status
       FROM club_debts WHERE lender_id=? ORDER BY start_date,id`,
    )
    .all(organizationId) as Row[];
  return rows.map((row) => ({
    id: row.id,
    property: "CLUB_LOAN",
    scope: "CLUB_FINANCE",
    counterpartId: row.club_id,
    counterpartReference: buildEntityReference(db, "CLUB", row.club_id, "CHAIRMAN_OWNER"),
    annualValue: row.principal,
    startDate: row.start_date,
    endDate: row.maturity_date,
    status: row.status,
    sourceEntityId: row.id,
    provenanceStatus: "SIMULATION_ONLY",
  }));
};

const splitDeals = (deals: OrganizationCommercialDeal[]) => ({
  activeDeals: deals.filter((deal) => deal.status === "ACTIVE"),
  currentNegotiations: deals.filter((deal) =>
    ["OFFERED", "COUNTERED", "NEGOTIATED", "PROPOSED"].includes(deal.status),
  ),
  dealHistory: deals.filter(
    (deal) => !["ACTIVE", "OFFERED", "COUNTERED", "NEGOTIATED", "PROPOSED"].includes(deal.status),
  ),
});

export const buildOrganizationProfile = (
  db: GameDatabase,
  type: OrganizationProfileEntityType,
  organizationId: EntityId,
  role: Parameters<typeof buildEntityReference>[3],
  managerPersonId?: EntityId,
): OrganizationProfile => {
  if (type === "JOURNALIST" || type === "MEDIA_OUTLET")
    return buildMediaEntityProfile(db, type, organizationId, role, managerPersonId);
  const entityReference = buildEntityReference(db, type, organizationId, role);
  if (!entityReference.visible) throw new Error("Organization not found");
  const sponsor = type === "SPONSOR" ? sponsorProfile(db, organizationId) : undefined;
  const lender =
    type === "LENDER"
      ? (db.prepare("SELECT * FROM club_lenders WHERE id=?").get(organizationId) as Row | undefined)
      : undefined;
  const deals =
    type === "SPONSOR"
      ? [
          ...rightsDeals(db, organizationId),
          ...clubDeals(db, organizationId),
          ...federationDeals(db, organizationId),
          ...nationalTeamDeals(db, organizationId),
        ]
      : type === "LENDER"
        ? lenderDeals(db, organizationId)
        : investorDeals(db, organizationId);
  const split = splitDeals(deals);
  const involvedEntities = deals
    .flatMap((deal) => (deal.counterpartReference ? [deal.counterpartReference] : []))
    .filter(
      (reference, index, references) =>
        references.findIndex(
          (candidate) =>
            candidate.entityType === reference.entityType && candidate.id === reference.id,
        ) === index,
    )
    .sort((left, right) => `${left.label}:${left.id}`.localeCompare(`${right.label}:${right.id}`));
  const clues = new Set<string>();
  if (split.activeDeals.length) clues.add("Established partner");
  if (split.currentNegotiations.length) clues.add("Negotiation in progress");
  if (split.dealHistory.some((deal) => deal.status === "EXPIRED"))
    clues.add("Deal recently expired");
  if (deals.length > 1) clues.add("Repeated partner");
  return {
    entityReference,
    sector: sponsor?.industry ?? sponsor?.sector ?? lender?.institution_type,
    organizationContext: organizationContext(db, type, organizationId, entityReference.provenanceStatus),
    provenanceStatus: entityReference.provenanceStatus,
    relationshipClues: [...clues].sort(),
    ...split,
    involvedEntities,
  };
};
