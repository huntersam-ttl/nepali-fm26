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
): OrganizationProfile => {
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
        : [];
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
    organizationContext: type === "INVESTOR" ? "NEPAL" : "NEPAL",
    provenanceStatus: entityReference.provenanceStatus,
    relationshipClues: [...clues].sort(),
    ...split,
    involvedEntities,
  };
};
