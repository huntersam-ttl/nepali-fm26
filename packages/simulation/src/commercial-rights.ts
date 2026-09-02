import {
  createStableEntityId,
  type CommercialSponsorProfile,
  type EntityId,
  type FederationCommercialRightsOffer,
  type FederationCommercialRightsPackage,
} from "@nepal-football-sim/shared-types";
import {
  CompetitionCommercialRepository,
  CommercialRightsRepository,
  NationalTeamCommercialRepository,
  EventRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import type {
  CompetitionCommercialSponsorship,
  NationalTeamCommercialSettlement,
} from "@nepal-football-sim/shared-types";
import { postFederationTransaction } from "./federation-governance.js";

export type CommercialRightsEvidence = {
  federationReputation: number;
  competitionReputation: number;
  nationalTeamPerformance: number;
  audienceScale: number;
  mediaExposure: number;
  womenYouthGrowth: number;
  competitionTier?: "A" | "B" | "C";
};
const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
const addYears = (date: string, years: number): string => {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
};

export const calculateCommercialRightsOffer = (input: {
  rightsPackage: FederationCommercialRightsPackage;
  sponsor: CommercialSponsorProfile;
  evidence: CommercialRightsEvidence;
  offeredOn: string;
  termYears?: number;
}): FederationCommercialRightsOffer => {
  const relevantAudience =
    input.rightsPackage.scope === "NATIONAL_TEAM"
      ? input.sponsor.internationalReach
      : input.sponsor.domesticReach;
  const relevance =
    input.rightsPackage.scope === "WOMENS" || input.rightsPackage.scope === "YOUTH"
      ? input.evidence.womenYouthGrowth
      : input.evidence.competitionReputation;
  const strategicFit = clamp(
    input.sponsor.strategicValue * 0.25 +
      input.sponsor.reputation * 0.15 +
      relevantAudience * 0.2 +
      input.evidence.federationReputation * 0.15 +
      relevance * 0.15 +
      input.evidence.mediaExposure * 0.1,
  );
  const annualValue = Math.min(
    3500000,
    Math.max(
      20000,
      Math.round(
        (45000 +
          input.sponsor.financialStrength * 900 +
          strategicFit * 2600 +
          input.evidence.audienceScale * 12) *
          ({ A: 1, B: 0.72, C: 0.45 }[input.evidence.competitionTier ?? "A"] ?? 1),
      ),
    ),
  );
  const termYears = Math.max(1, Math.min(4, input.termYears ?? 2));
  return {
    id: createStableEntityId(
      "commercial-rights-offer",
      `${input.rightsPackage.id}:${input.sponsor.id}:${input.offeredOn}:${termYears}`,
    ),
    packageId: input.rightsPackage.id,
    federationId: input.rightsPackage.federationId,
    sponsorId: input.sponsor.id,
    termYears,
    annualValue,
    bonuses: { performance: Math.round(annualValue * 0.05), reach: Math.round(annualValue * 0.03) },
    reachScore: clamp(relevantAudience),
    strategicFit,
    relationshipValue: clamp(input.sponsor.reliability * 0.6 + input.sponsor.reputation * 0.4),
    exclusivity: Boolean(input.rightsPackage.exclusivityGroup),
    scope: input.rightsPackage.scope,
    status: "OFFERED",
    offeredOn: input.offeredOn,
    provenanceStatus: "SIMULATION_ONLY",
  };
};

export const createCommercialRightsPackage = (
  db: GameDatabase,
  input: Omit<FederationCommercialRightsPackage, "id" | "status" | "provenanceStatus">,
): FederationCommercialRightsPackage => {
  const value = {
    ...input,
    id: createStableEntityId(
      "commercial-rights-package",
      `${input.federationId}:${input.category}:${input.name}`,
    ),
    status: "AVAILABLE" as const,
    provenanceStatus: "SIMULATION_ONLY" as const,
  };
  new CommercialRightsRepository(db).upsertPackage(value);
  return value;
};

/** The first supported pilot: federation main partnership, settled to the
 * existing federation ledger. Other scopes remain unprovisioned until they
 * have a matching competition/team accounting consumer. */
export const ensureFederationMainPartnerPackage = (
  db: GameDatabase,
  federationId: EntityId,
  date: string,
): FederationCommercialRightsPackage => {
  const packageId = createStableEntityId(
    "commercial-rights-package",
    `${federationId}:FEDERATION_MAIN_PARTNER`,
  );
  const value: FederationCommercialRightsPackage = {
    id: packageId,
    federationId,
    name: "Federation Main Partner",
    category: "FEDERATION_MAIN_PARTNER",
    exclusivityGroup: "FEDERATION_MAIN_PARTNER",
    scope: "NATIONAL",
    availableFrom: date,
    availableTo: addYears(date, 5),
    status: "AVAILABLE",
    provenanceStatus: "SIMULATION_ONLY",
  };
  const repo = new CommercialRightsRepository(db);
  const existing = repo.packages(federationId).find((item) => item.id === packageId);
  if (!existing) repo.upsertPackage(value);
  return existing ?? value;
};

export const ensureSeniorNationalTeamMainPartnerPackage = (
  db: GameDatabase,
  federationId: EntityId,
  date: string,
): FederationCommercialRightsPackage => {
  const packageId = createStableEntityId(
    "commercial-rights-package",
    `${federationId}:SENIOR_MENS_MAIN_PARTNER`,
  );
  const value: FederationCommercialRightsPackage = {
    id: packageId,
    federationId,
    name: "Senior National Team Main Partner",
    category: "NATIONAL_TEAM_SPONSOR",
    exclusivityGroup: "SENIOR_MENS_MAIN_PARTNER",
    scope: "NATIONAL_TEAM",
    availableFrom: date,
    availableTo: addYears(date, 5),
    status: "AVAILABLE",
    provenanceStatus: "SIMULATION_ONLY",
  };
  const repo = new CommercialRightsRepository(db);
  const existing = repo.packages(federationId).find((item) => item.id === packageId);
  if (!existing) repo.upsertPackage(value);
  return existing ?? value;
};

export const ensureADivisionTitleSponsorPackage = (
  db: GameDatabase,
  federationId: EntityId,
  date: string,
): FederationCommercialRightsPackage => {
  const competition = db
    .prepare(
      "SELECT id, name FROM competitions WHERE federation_id=? AND scope='domestic' AND lower(name) LIKE '%a-division%' ORDER BY id LIMIT 1",
    )
    .get(federationId) as { id?: EntityId; name?: string } | undefined;
  if (!competition?.id || !competition.name)
    throw new Error("A Division title sponsorship requires a supported A Division competition");
  const packageId = createStableEntityId(
    "commercial-rights-package",
    `${federationId}:A_DIVISION_TITLE_SPONSOR`,
  );
  const value: FederationCommercialRightsPackage = {
    id: packageId,
    federationId,
    name: `${competition.name} Title Sponsor`,
    category: "LEAGUE_TITLE_SPONSOR",
    exclusivityGroup: "A_DIVISION_TITLE_SPONSOR",
    scope: "COMPETITION",
    availableFrom: date,
    availableTo: addYears(date, 1),
    status: "AVAILABLE",
    provenanceStatus: "SIMULATION_ONLY",
  };
  const repo = new CommercialRightsRepository(db);
  const existing = repo.packages(federationId).find((item) => item.id === packageId);
  if (!existing) repo.upsertPackage(value);
  return existing ?? value;
};

export const ensureDivisionTitleSponsorPackage = (
  db: GameDatabase,
  input: { federationId: EntityId; division: "A" | "B" | "C"; date: string },
): FederationCommercialRightsPackage => {
  const competition = db
    .prepare(
      "SELECT id, name FROM competitions WHERE federation_id=? AND scope='domestic' AND lower(name) LIKE ? ORDER BY id LIMIT 1",
    )
    .get(input.federationId, `%${input.division.toLowerCase()}-division%`) as
    { id?: EntityId; name?: string } | undefined;
  if (!competition?.id || !competition.name)
    throw new Error(
      `${input.division} Division title sponsorship requires a supported competition`,
    );
  const packageId = createStableEntityId(
    "commercial-rights-package",
    `${input.federationId}:${input.division}_DIVISION_TITLE_SPONSOR`,
  );
  const value: FederationCommercialRightsPackage = {
    id: packageId,
    federationId: input.federationId,
    name: `${competition.name} Title Sponsor`,
    category: "LEAGUE_TITLE_SPONSOR",
    exclusivityGroup: `${input.division}_DIVISION_TITLE_SPONSOR`,
    scope: "COMPETITION",
    availableFrom: input.date,
    availableTo: addYears(input.date, 1),
    status: "AVAILABLE",
    provenanceStatus: "SIMULATION_ONLY",
  };
  const repo = new CommercialRightsRepository(db);
  const existing = repo.packages(input.federationId).find((item) => item.id === packageId);
  if (!existing) repo.upsertPackage(value);
  return existing ?? value;
};

const activePresidentForFederation = (
  db: GameDatabase,
  federationId: EntityId,
  personId: EntityId,
): boolean => {
  const row = db
    .prepare(
      "SELECT 1 AS active FROM federation_leadership_tenures WHERE federation_id=? AND person_id=? AND role='FEDERATION_PRESIDENT' AND status IN ('ACTIVE','INTERIM') LIMIT 1",
    )
    .get(federationId, personId) as { active?: number } | undefined;
  return Boolean(row?.active);
};

export const awardCommercialRightsForPresident = (
  db: GameDatabase,
  input: {
    offerId: EntityId;
    federationId: EntityId;
    presidentPersonId: EntityId;
    date: string;
    startDate: string;
  },
): FederationCommercialRightsOffer => {
  if (!activePresidentForFederation(db, input.federationId, input.presidentPersonId))
    throw new Error("Only the active federation president may award federation commercial rights");
  return awardCommercialRights(db, input);
};

export const activateSeniorNationalTeamMainPartner = (
  db: GameDatabase,
  input: {
    offerId: EntityId;
    federationId: EntityId;
    presidentPersonId: EntityId;
    date: string;
    startDate: string;
  },
): NationalTeamCommercialSettlement => {
  if (!activePresidentForFederation(db, input.federationId, input.presidentPersonId))
    throw new Error(
      "Only the active federation president may activate national-team commercial rights",
    );
  const settlements = new NationalTeamCommercialRepository(db);
  const existing = settlements.byOffer(input.offerId);
  if (existing) return existing;
  const rightsRepo = new CommercialRightsRepository(db);
  const offer = rightsRepo.offers().find((item) => item.id === input.offerId);
  if (!offer || offer.federationId !== input.federationId || offer.scope !== "NATIONAL_TEAM")
    throw new Error("Offer is not a senior national-team commercial package");
  const rightsPackage = rightsRepo
    .packages(input.federationId)
    .find((item) => item.id === offer.packageId);
  if (!rightsPackage || rightsPackage.category !== "NATIONAL_TEAM_SPONSOR")
    throw new Error("Offer is not a national-team main-partner package");
  const activeSenior = settlements
    .byProgramme(input.federationId, "SENIOR_MENS")
    .some((settlement) =>
      rightsRepo
        .offers()
        .some(
          (candidate) => candidate.id === settlement.rightsOfferId && candidate.status === "ACTIVE",
        ),
    );
  if (activeSenior) throw new Error("A senior national-team main partner is already active");
  const active = offer.status === "ACTIVE" ? offer : awardCommercialRightsForPresident(db, input);
  if (!active.federationLedgerEntryId)
    throw new Error("National-team commercial settlement has no federation ledger entry");
  const settlement: NationalTeamCommercialSettlement = {
    id: createStableEntityId("national-team-commercial-settlement", input.offerId),
    federationId: input.federationId,
    programme: "SENIOR_MENS",
    commercialProperty: "MAIN_PARTNER",
    sourceOrganizationId: active.sponsorId,
    rightsOfferId: active.id,
    amount: active.annualValue,
    settledOn: input.date,
    federationLedgerEntryId: active.federationLedgerEntryId,
    restrictionTag: "NATIONAL_TEAM:SENIOR_MENS:MAIN_PARTNER",
    provenanceStatus: "SIMULATION_ONLY",
  };
  settlements.insert(settlement);
  return settlement;
};

export const nationalTeamCommercialReadModel = (db: GameDatabase, federationId: EntityId) => {
  const repo = new CommercialRightsRepository(db);
  const sponsors = new NationalTeamCommercialRepository(db).all(federationId);
  return sponsors.map((settlement) => ({
    ...settlement,
    sponsorName: repo.sponsor(settlement.sourceOrganizationId)?.name,
    settlementState: "SETTLED" as const,
  }));
};

export const expireNationalTeamCommercialSettlements = (
  db: GameDatabase,
  date: string,
): NationalTeamCommercialSettlement[] => {
  const rightsRepo = new CommercialRightsRepository(db);
  const settlements = new NationalTeamCommercialRepository(db);
  const expired = settlements.all().filter((settlement) => {
    const offer = rightsRepo
      .offers()
      .find((candidate) => candidate.id === settlement.rightsOfferId);
    return offer?.status === "ACTIVE" && offer.endDate !== undefined && offer.endDate < date;
  });
  for (const settlement of expired) {
    const offer = rightsRepo
      .offers()
      .find((candidate) => candidate.id === settlement.rightsOfferId);
    if (offer) rightsRepo.upsertOffer({ ...offer, status: "EXPIRED" });
  }
  return expired;
};

const aDivisionSeason = (
  db: GameDatabase,
  competitionSeasonId: EntityId,
  federationId: EntityId,
) => {
  const row = db
    .prepare(
      "SELECT cs.id, c.id AS competition_id, c.name, c.federation_id FROM competition_seasons cs JOIN competitions c ON c.id=cs.competition_id WHERE cs.id=? AND c.federation_id=? AND c.scope='domestic' AND lower(c.name) LIKE '%a-division%'",
    )
    .get(competitionSeasonId, federationId) as
    | { id?: EntityId; competition_id?: EntityId; name?: string; federation_id?: EntityId }
    | undefined;
  if (!row?.id || !row.name)
    throw new Error("A Division commercial sponsorship requires an A Division season");
  return row;
};

const divisionSeason = (
  db: GameDatabase,
  competitionSeasonId: EntityId,
  federationId: EntityId,
  division: "A" | "B" | "C",
) => {
  const row = db
    .prepare(
      "SELECT cs.id, c.name FROM competition_seasons cs JOIN competitions c ON c.id=cs.competition_id WHERE cs.id=? AND c.federation_id=? AND c.scope='domestic' AND lower(c.name) LIKE ?",
    )
    .get(competitionSeasonId, federationId, `%${division.toLowerCase()}-division%`) as
    { id?: EntityId; name?: string } | undefined;
  if (!row?.id || !row.name)
    throw new Error(`${division} Division commercial sponsorship requires a supported season`);
  return row;
};

export const linkDivisionTitleSponsor = (
  db: GameDatabase,
  input: { division: "A" | "B" | "C"; competitionSeasonId: EntityId; offerId: EntityId },
): CompetitionCommercialSponsorship => {
  const rightsRepo = new CommercialRightsRepository(db);
  const offer = rightsRepo.offers().find((item) => item.id === input.offerId);
  if (!offer || offer.status !== "ACTIVE")
    throw new Error("Only an active commercial-rights offer can title a division season");
  const season = divisionSeason(db, input.competitionSeasonId, offer.federationId, input.division);
  const rightsPackage = rightsRepo
    .packages(offer.federationId)
    .find((item) => item.id === offer.packageId);
  if (
    !rightsPackage ||
    rightsPackage.category !== "LEAGUE_TITLE_SPONSOR" ||
    rightsPackage.scope !== "COMPETITION"
  )
    throw new Error("Offer is not a division title-sponsor package");
  const commercialRepo = new CompetitionCommercialRepository(db);
  const existing = commercialRepo.bySeason(input.competitionSeasonId);
  if (existing) {
    if (existing.rightsOfferId !== offer.id)
      throw new Error("Division season already has a title sponsor");
    return existing;
  }
  const sponsorship: CompetitionCommercialSponsorship = {
    id: createStableEntityId(
      "competition-commercial-sponsorship",
      `${input.competitionSeasonId}:${offer.id}`,
    ),
    competitionSeasonId: input.competitionSeasonId,
    rightsOfferId: offer.id,
    sponsorId: offer.sponsorId,
    displayTitle: `${season.name} presented by ${rightsRepo.sponsor(offer.sponsorId)?.name ?? "Commercial Partner"}`,
    startDate: offer.startDate ?? "",
    endDate: offer.endDate ?? "",
    status: "ACTIVE",
    revenueDestination: "FEDERATION_LEDGER",
    provenanceStatus: "SIMULATION_ONLY",
  };
  if (!sponsorship.startDate || !sponsorship.endDate)
    throw new Error("Active commercial-rights offer has no contract dates");
  commercialRepo.upsert(sponsorship);
  return sponsorship;
};

export const activateDivisionTitleSponsorship = (
  db: GameDatabase,
  input: {
    division: "A" | "B" | "C";
    competitionSeasonId: EntityId;
    offerId: EntityId;
    presidentPersonId: EntityId;
    federationId: EntityId;
    date: string;
    startDate: string;
  },
): CompetitionCommercialSponsorship => {
  const existing = new CompetitionCommercialRepository(db).bySeason(input.competitionSeasonId);
  if (existing) return existing;
  const offer = new CommercialRightsRepository(db)
    .offers()
    .find((item) => item.id === input.offerId);
  if (!offer) throw new Error("Commercial-rights offer not found");
  if (offer.status !== "ACTIVE") awardCommercialRightsForPresident(db, input);
  return linkDivisionTitleSponsor(db, input);
};

export const linkADivisionTitleSponsor = (
  db: GameDatabase,
  input: { competitionSeasonId: EntityId; offerId: EntityId },
): CompetitionCommercialSponsorship => {
  const rightsRepo = new CommercialRightsRepository(db);
  const offer = rightsRepo.offers().find((item) => item.id === input.offerId);
  if (!offer || offer.status !== "ACTIVE")
    throw new Error("Only an active commercial-rights offer can title an A Division season");
  const season = aDivisionSeason(db, input.competitionSeasonId, offer.federationId);
  const rightsPackage = rightsRepo
    .packages(offer.federationId)
    .find((item) => item.id === offer.packageId);
  if (
    !rightsPackage ||
    rightsPackage.category !== "LEAGUE_TITLE_SPONSOR" ||
    rightsPackage.scope !== "COMPETITION"
  )
    throw new Error("Offer is not an A Division title-sponsor package");
  const commercialRepo = new CompetitionCommercialRepository(db);
  const existing = commercialRepo.bySeason(input.competitionSeasonId);
  if (existing) {
    if (existing.rightsOfferId !== offer.id)
      throw new Error("A Division season already has a title sponsor");
    return existing;
  }
  const sponsorship: CompetitionCommercialSponsorship = {
    id: createStableEntityId(
      "competition-commercial-sponsorship",
      `${input.competitionSeasonId}:${offer.id}`,
    ),
    competitionSeasonId: input.competitionSeasonId,
    rightsOfferId: offer.id,
    sponsorId: offer.sponsorId,
    displayTitle: `${season.name} presented by ${rightsRepo.sponsor(offer.sponsorId)?.name ?? "Commercial Partner"}`,
    startDate: offer.startDate ?? "",
    endDate: offer.endDate ?? "",
    status: "ACTIVE",
    revenueDestination: "FEDERATION_LEDGER",
    provenanceStatus: "SIMULATION_ONLY",
  };
  if (!sponsorship.startDate || !sponsorship.endDate)
    throw new Error("Active commercial-rights offer has no contract dates");
  commercialRepo.upsert(sponsorship);
  return sponsorship;
};

export const activateADivisionTitleSponsorship = (
  db: GameDatabase,
  input: {
    competitionSeasonId: EntityId;
    offerId: EntityId;
    presidentPersonId: EntityId;
    federationId: EntityId;
    date: string;
    startDate: string;
  },
): CompetitionCommercialSponsorship => {
  const existing = new CompetitionCommercialRepository(db).bySeason(input.competitionSeasonId);
  if (existing) return existing;
  const offer = new CommercialRightsRepository(db)
    .offers()
    .find((item) => item.id === input.offerId);
  if (!offer) throw new Error("Commercial-rights offer not found");
  if (offer.status !== "ACTIVE") awardCommercialRightsForPresident(db, input);
  return linkADivisionTitleSponsor(db, input);
};

export const expireADivisionTitleSponsorships = (
  db: GameDatabase,
  date: string,
): CompetitionCommercialSponsorship[] => {
  const commercialRepo = new CompetitionCommercialRepository(db);
  const rightsRepo = new CommercialRightsRepository(db);
  const expired = commercialRepo
    .all()
    .filter((item) => item.status === "ACTIVE" && item.endDate < date);
  for (const sponsorship of expired) {
    commercialRepo.upsert({ ...sponsorship, status: "EXPIRED" });
    const offer = rightsRepo.offers().find((item) => item.id === sponsorship.rightsOfferId);
    if (offer?.status === "ACTIVE") rightsRepo.upsertOffer({ ...offer, status: "EXPIRED" });
  }
  return expired.map((item) => ({ ...item, status: "EXPIRED" as const }));
};

export const aDivisionCommercialReadModel = (db: GameDatabase, competitionSeasonId: EntityId) => {
  const link = new CompetitionCommercialRepository(db).bySeason(competitionSeasonId);
  if (!link) return undefined;
  const sponsor = new CommercialRightsRepository(db).sponsor(link.sponsorId);
  const offer = new CommercialRightsRepository(db)
    .offers()
    .find((item) => item.id === link.rightsOfferId);
  return {
    ...link,
    canonicalCompetitionName: (
      db
        .prepare(
          "SELECT c.name FROM competition_seasons cs JOIN competitions c ON c.id=cs.competition_id WHERE cs.id=?",
        )
        .get(competitionSeasonId) as { name?: string } | undefined
    )?.name,
    sponsorName: sponsor?.name,
    annualValue: offer?.annualValue,
    negotiationStatus: offer?.status,
    settlementState: offer?.federationLedgerEntryId ? "SETTLED" : "PENDING",
  };
};

export const offerCommercialRights = (
  db: GameDatabase,
  input: {
    rightsPackage: FederationCommercialRightsPackage;
    sponsor: CommercialSponsorProfile;
    evidence: CommercialRightsEvidence;
    offeredOn: string;
    termYears?: number;
  },
): FederationCommercialRightsOffer => {
  if (!["AVAILABLE", "OFFERED"].includes(input.rightsPackage.status))
    throw new Error("Commercial-rights package is not available");
  const offer = calculateCommercialRightsOffer(input);
  const repo = new CommercialRightsRepository(db);
  repo.upsertOffer(offer);
  repo.upsertPackage({ ...input.rightsPackage, status: "OFFERED" });
  return offer;
};

export const negotiateCommercialRights = (
  db: GameDatabase,
  offerId: EntityId,
): FederationCommercialRightsOffer => {
  const repo = new CommercialRightsRepository(db);
  const offer = repo.offers().find((item) => item.id === offerId);
  if (!offer || offer.status !== "OFFERED")
    throw new Error("Commercial-rights offer is not negotiable");
  const negotiated = { ...offer, status: "NEGOTIATED" as const };
  repo.upsertOffer(negotiated);
  return negotiated;
};

/** The caller explicitly selects an offer; cash alone never awards a package. */
export const awardCommercialRights = (
  db: GameDatabase,
  input: { offerId: EntityId; date: string; startDate: string },
): FederationCommercialRightsOffer => {
  const repo = new CommercialRightsRepository(db);
  const offer = repo.offers().find((item) => item.id === input.offerId);
  if (!offer || !["OFFERED", "NEGOTIATED"].includes(offer.status))
    throw new Error("Commercial-rights offer is not awardable");
  const rightsPackage = repo
    .packages(offer.federationId)
    .find((item) => item.id === offer.packageId);
  const sponsor = repo.sponsor(offer.sponsorId);
  if (!rightsPackage || !sponsor)
    throw new Error("Commercial-rights package or sponsor is missing");
  if (offer.exclusivity && rightsPackage.exclusivityGroup) {
    const conflict = repo
      .packages(offer.federationId)
      .filter(
        (item) =>
          item.exclusivityGroup === rightsPackage.exclusivityGroup && item.id !== rightsPackage.id,
      )
      .some((item) =>
        repo
          .offers(item.id)
          .some(
            (candidate) => candidate.status === "ACTIVE" && candidate.sponsorId !== offer.sponsorId,
          ),
      );
    if (conflict) throw new Error("A sector exclusivity conflict is already active");
  }
  const endDate = addYears(input.startDate, offer.termYears);
  const ledger = postFederationTransaction(db, {
    federationId: offer.federationId,
    date: input.date,
    category: "SPONSORSHIP",
    direction: "CREDIT",
    amount: offer.annualValue,
    description: `Commercial rights awarded: ${rightsPackage.name}`,
    relatedEntityId: offer.id,
    idempotencyKey: `commercial-rights-award:${offer.id}`,
  });
  const active = {
    ...offer,
    status: "ACTIVE" as const,
    startDate: input.startDate,
    endDate,
    federationLedgerEntryId: ledger.id,
  };
  repo.upsertOffer(active);
  repo.upsertPackage({ ...rightsPackage, status: "ACTIVE" });
  new EventRepository(db).insertHistoricalEvent({
    id: createStableEntityId("history", `COMMERCIAL_RIGHTS_AWARDED:${offer.id}`),
    occurredOn: input.date,
    eventType: "FEDERATION_COMMERCIAL_RIGHTS_AWARDED",
    involvedEntities: [
      { id: offer.federationId, type: "federation" },
      { id: offer.id, type: "contract" },
    ],
    title: "Federation commercial rights awarded",
    data: {
      category: rightsPackage.category,
      sponsorId: sponsor.id,
      annualValue: offer.annualValue,
      termYears: offer.termYears,
    },
    importance: "high",
    scope: "federation",
  });
  return active;
};

export const rankCommercialRightsOffers = (
  offers: readonly FederationCommercialRightsOffer[],
): FederationCommercialRightsOffer[] =>
  [...offers].sort(
    (a, b) =>
      b.strategicFit * 0.45 +
        b.reachScore * 0.3 +
        b.relationshipValue * 0.25 -
        (a.strategicFit * 0.45 + a.reachScore * 0.3 + a.relationshipValue * 0.25) ||
      a.id.localeCompare(b.id),
  );
export const renewCommercialRights = (
  db: GameDatabase,
  offerId: EntityId,
  offeredOn: string,
): FederationCommercialRightsOffer => {
  const repo = new CommercialRightsRepository(db);
  const offer = repo.offers().find((item) => item.id === offerId);
  if (!offer || offer.status !== "ACTIVE") throw new Error("Only active rights can be renewed");
  const renewed = {
    ...offer,
    id: createStableEntityId("commercial-rights-renewal", `${offer.id}:${offeredOn}`),
    status: "RENEWED" as const,
    offeredOn,
    startDate: undefined,
    endDate: undefined,
    federationLedgerEntryId: undefined,
  };
  repo.upsertOffer(renewed);
  return renewed;
};
