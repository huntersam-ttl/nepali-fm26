import {
  createStableEntityId,
  type AttendanceDemandBreakdown,
  type Club,
  type ClubAsset,
  type ClubBoardPolicy,
  type ClubBudget,
  type ClubBudgetCategory,
  type ClubEconomicType,
  type ClubFacilityProfile,
  type ClubFinancialAccount,
  type ClubFinancialHealth,
  type ClubFinancialStatement,
  type ClubLedgerCategory,
  type ClubLedgerDirection,
  type ClubLedgerEntry,
  type ClubOwnershipModel,
  type ClubOwnershipStake,
  type ClubSupporterProfile,
  type ClubCommercialProfile,
  type CompetitionMediaRights,
  type ClubSeasonMembership,
  type PreseasonCommercialCamp,
  type ClubValuation,
  type EntityId,
  type FixtureRecord,
  type InfrastructureProject,
  type InfrastructureProjectType,
  type OwnerInvestmentForm,
  type OwnerInvestmentTransaction,
  type Person,
  type PlayerLoanRecord,
  type SponsorMeetingOverview,
  type SponsorOrganisation,
  type SponsorshipContract,
  type SponsorshipType,
  type TransferOffer,
} from "@nepal-football-sim/shared-types";
import { executiveHasAuthority } from "./executive-roles.js";
import {
  ClubEconomyRepository,
  ClubNetworkRepository,
  EventRepository,
  GlobalFootballContextRepository,
  TransferMarketRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { SeededRandom } from "./rng.js";
import { adjustForMacro, macroEconomyForCountry } from "./macro-economy.js";
import {
  normalizeSupporterCultureMonth,
  supporterAttendanceForFixture,
} from "./supporter-culture.js";

export type ClubFinancialSummary = {
  account: ClubFinancialAccount;
  budgets: ClubBudget[];
  ownership: ClubOwnershipStake[];
  supporterProfile?: ClubSupporterProfile;
  facilityProfile?: ClubFacilityProfile;
  valuation?: ClubValuation;
  ledgerEntries: ClubLedgerEntry[];
};

export type EconomySimulationReport = {
  date: string;
  seasons: number;
  clubs: Array<{
    clubId: EntityId;
    clubName: string;
    openingCash: number;
    revenue: number;
    expenses: number;
    wages: number;
    transfers: number;
    sponsors: number;
    matchday: number;
    prizeMoney: number;
    profitLoss: number;
    closingCash: number;
    debt: number;
    financialHealth: ClubFinancialHealth;
  }>;
  richestClub?: string;
  mostProfitable?: string;
  mostDistressed?: string;
  largestWageBill?: string;
  highestSponsorship?: string;
  facilityProjects: number;
  healthDistribution: Record<ClubFinancialHealth, number>;
};

export type ChairmanDemoReport = {
  chairmanPersonId: EntityId;
  clubId: EntityId;
  before: ClubFinancialSummary;
  afterInvestment: ClubFinancialSummary;
  acceptedSponsorId: EntityId;
  projectId: EntityId;
  statement?: ClubFinancialStatement;
  permissions: string[];
};

const currency = "NPR";
const simulationStatus = "SIMULATION_ONLY" as const;

export const initializeClubEconomyForSave = (input: {
  db: GameDatabase;
  worldDate: string;
  seed: string;
}): void => {
  const economy = new ClubEconomyRepository(input.db);
  for (const club of allClubs(input.db)) {
    if (economy.financialAccount(club.id)) continue;
    const profile = generatedClubEconomy(club, input.seed);
    economy.upsertFinancialAccount({
      clubId: club.id,
      currency,
      cashBalance: profile.cash,
      restrictedCash: Math.round(profile.cash * profile.restrictedCashShare),
      receivables: 0,
      payables: 0,
      debtBalance: profile.debt,
      equityBalance: profile.equity,
      seasonRevenue: 0,
      seasonExpenses: 0,
      seasonProfitLoss: 0,
      financialHealth: financialHealth(profile.cash, profile.debt),
      lastUpdatedAt: input.worldDate,
      status: simulationStatus,
    });
    for (const budget of generatedBudgets(club, profile, input.worldDate)) {
      economy.upsertBudget(budget);
    }
    economy.upsertOwnershipStake(generatedOwnershipStake(club, input.worldDate));
    economy.upsertSupporterProfile(generatedSupporterProfile(club, profile, input.seed));
    economy.upsertCommercialProfile(
      generatedCommercialProfile(club, profile, input.seed, input.worldDate),
    );
    economy.upsertFacilityProfile(generatedFacilityProfile(club, profile, input.seed));
    economy.upsertBoardPolicy(generatedBoardPolicy(club, input.worldDate));
    economy.upsertValuation(calculateClubValuation(input.db, club.id, input.worldDate));
    if (profile.debt > 0) {
      economy.upsertDebt({
        id: createStableEntityId("club-debt", `${club.id}:starting`),
        clubId: club.id,
        lenderType: profile.economicType === "DEPARTMENTAL_CLUB" ? "OTHER" : "SHORT_TERM",
        principal: profile.debt,
        outstandingPrincipal: profile.debt,
        interestRate: profile.economicType === "DEPARTMENTAL_CLUB" ? 0.02 : 0.08,
        currency,
        startDate: input.worldDate,
        maturityDate: addYears(input.worldDate, 3),
        repaymentSchedule: "SEASONAL",
        status: "ACTIVE",
        provenanceStatus: simulationStatus,
      });
    }
  }
  seedSponsorPool(input.db, input.worldDate, input.seed);
  for (const club of allClubs(input.db)) {
    if (economy.sponsorships(club.id).some((contract) => contract.status === "ACTIVE")) continue;
    const offer = generateSponsorOffers(input.db, {
      clubId: club.id,
      date: input.worldDate,
      seed: input.seed,
      count: 1,
    })[0];
    if (offer) {
      acceptSponsorOffer(input.db, offer.id, input.worldDate, { silent: true });
    }
  }
};

export const getClubFinancialSummary = (
  db: GameDatabase,
  clubId: EntityId,
): ClubFinancialSummary => {
  const economy = new ClubEconomyRepository(db);
  const account = economy.financialAccount(clubId);
  if (!account) throw new Error(`Club economy is not initialized for club ${clubId}`);
  return {
    account,
    budgets: economy.budgets(clubId),
    ownership: economy.ownershipStakes(clubId),
    supporterProfile: economy.supporterProfile(clubId),
    facilityProfile: economy.facilityProfile(clubId),
    valuation: economy.valuation(clubId),
    ledgerEntries: economy.ledgerEntries(clubId),
  };
};

export const setClubTicketPrice = (
  db: GameDatabase,
  clubId: EntityId,
  price: number,
): ClubSupporterProfile => {
  const economy = new ClubEconomyRepository(db);
  const profile = economy.supporterProfile(clubId);
  if (!profile) throw new Error(`Supporter profile is not initialized for club ${clubId}`);
  const updated = { ...profile, standardTicketPrice: Math.max(1, Math.round(price)) };
  economy.upsertSupporterProfile(updated);
  return updated;
};

export const createSeasonMembership = (
  db: GameDatabase,
  input: { clubId: EntityId; seasonLabel: string; price: number },
): ClubSeasonMembership => {
  const economy = new ClubEconomyRepository(db);
  const support = economy.supporterProfile(input.clubId);
  if (!support) throw new Error("Supporter profile is not initialized");
  const memberCount = Math.max(
    1,
    Math.round(support.coreSupporters * 0.42 + support.familySupport * 0.2),
  );
  const membership: ClubSeasonMembership = {
    id: createStableEntityId("season-membership", `${input.clubId}:${input.seasonLabel}`),
    clubId: input.clubId,
    seasonLabel: input.seasonLabel,
    memberCount,
    price: Math.max(1, Math.round(input.price)),
    revenue: memberCount * Math.max(1, Math.round(input.price)),
    status: "ACTIVE",
  };
  economy.upsertSeasonMembership(membership);
  postClubTransaction(db, {
    clubId: input.clubId,
    date: `${input.seasonLabel}-08-01`,
    category: "MATCHDAY_REVENUE",
    direction: "CREDIT",
    amount: membership.revenue,
    description: "Season-ticket and membership revenue",
    relatedEntityId: membership.id,
    idempotencyKey: `season-membership:${membership.id}`,
  });
  economy.insertCommercialHistory({
    id: createStableEntityId("commercial-history", `${membership.id}:membership`),
    clubId: input.clubId,
    date: `${input.seasonLabel}-08-01`,
    eventType: "SEASON_MEMBERSHIP",
    amount: membership.revenue,
    audienceImpact: memberCount,
    description: "Season membership sales",
  });
  return membership;
};

export const postMerchandiseRevenue = (
  db: GameDatabase,
  input: { clubId: EntityId; date: string; seed: string },
): number => {
  const economy = new ClubEconomyRepository(db);
  const support = economy.supporterProfile(input.clubId);
  const commercial = economy.commercialProfile(input.clubId);
  if (!support || !commercial) return 0;
  const standing = db
    .prepare(
      "SELECT points FROM league_standings ls JOIN teams t ON t.id = ls.team_id WHERE t.club_id = ? ORDER BY points DESC LIMIT 1",
    )
    .get(input.clubId) as { points?: number } | undefined;
  const units = Math.max(
    1,
    Math.round(
      (support.coreSupporters + support.casualSupporters * 0.18 + support.diasporaSupport * 0.65) *
        (0.02 + commercial.merchandiseAppeal / 500) *
        (1 + Math.min(0.3, (standing?.points ?? 0) / 300)),
    ),
  );
  const amount = units * Math.round(180 + commercial.merchandiseAppeal * 35);
  postClubTransaction(db, {
    clubId: input.clubId,
    date: input.date,
    category: "MERCHANDISE",
    direction: "CREDIT",
    amount,
    description: `Merchandise sales across shirts, scarves and digital products (${units} units)`,
    idempotencyKey: `merchandise:${input.clubId}:${input.date}`,
  });
  economy.upsertSupporterProfile({
    ...support,
    casualSupporters: support.casualSupporters + Math.max(1, Math.round(units * 0.03)),
    diasporaSupport: support.diasporaSupport + Math.round(units * 0.01),
  });
  economy.insertCommercialHistory({
    id: createStableEntityId("commercial-history", `${input.clubId}:${input.date}:merchandise`),
    clubId: input.clubId,
    date: input.date,
    eventType: "MERCHANDISE",
    amount,
    audienceImpact: units,
    description: "Abstract merchandise sales",
  });
  return amount;
};

export type CommercialPartnershipSettlement = {
  amount: number;
  baseCommercialValue: number;
  partnershipCount: number;
};

export type PreseasonCommercialTourPlan = {
  partnershipId: EntityId;
  partnerClubId: EntityId;
  destination: string;
  candidateCount: number;
};

export const planPreseasonCommercialTour = (
  db: GameDatabase,
  input: { clubId: EntityId; date: string },
): PreseasonCommercialTourPlan | undefined => {
  const partnerships = new ClubNetworkRepository(db)
    .activeFriendlyTourPartnerships(input.clubId, input.date)
    .slice(0, 4);
  if (partnerships.length === 0) return undefined;
  const contexts = new Map(
    new GlobalFootballContextRepository(db).clubs().map((club) => [club.clubId, club.reputation]),
  );
  const economy = new ClubEconomyRepository(db);
  const ranked = partnerships
    .map((partnership) => {
      const partnerSupport = economy.supporterProfile(partnership.toClubId);
      const reputation =
        contexts.get(partnership.toClubId) ?? (partnerSupport?.footballReputation ?? 4) * 10;
      const country = db
        .prepare(
          "SELECT country.name AS name FROM clubs club JOIN countries country ON country.id = club.country_id WHERE club.id = ?",
        )
        .get(partnership.toClubId) as { name?: string } | undefined;
      return {
        partnership,
        reputation,
        destination: country?.name ?? "International partner market",
      };
    })
    .sort(
      (left, right) =>
        right.partnership.relationshipStrength - left.partnership.relationshipStrength ||
        right.reputation - left.reputation ||
        left.partnership.id.localeCompare(right.partnership.id),
    );
  const selected = ranked[0]!;
  return {
    partnershipId: selected.partnership.id,
    partnerClubId: selected.partnership.toClubId,
    destination: selected.destination,
    candidateCount: ranked.length,
  };
};

export const commercialPartnershipIncome = (
  db: GameDatabase,
  clubId: EntityId,
  simulationDate: string,
): CommercialPartnershipSettlement => {
  const economy = new ClubEconomyRepository(db);
  const commercial = economy.commercialProfile(clubId);
  const support = economy.supporterProfile(clubId);
  if (!commercial) return { amount: 0, baseCommercialValue: 0, partnershipCount: 0 };
  const partnerships = new ClubNetworkRepository(db)
    .activeCommercialPartnerships(clubId, simulationDate)
    .slice(0, 4);
  if (partnerships.length === 0) return { amount: 0, baseCommercialValue: 0, partnershipCount: 0 };
  const externalQuality = new Map(
    new GlobalFootballContextRepository(db)
      .clubs()
      .map((club) => [club.clubId, club.reputation / 100]),
  );
  const baseCommercialValue = Math.max(
    1000,
    Math.round(
      (commercial.digitalReach * 12000 +
        commercial.merchandiseAppeal * 8000 +
        commercial.brandStrength * 5000) *
        (1 + Math.min(0.25, (support?.diasporaSupport ?? 0) / 10000)),
    ),
  );
  const value = partnerships.reduce((total, partnership) => {
    const partnerSupport = economy.supporterProfile(partnership.toClubId);
    const quality = Math.max(
      0.25,
      Math.min(
        1,
        externalQuality.get(partnership.toClubId) ??
          (partnerSupport?.commercialReputation ?? 4) / 10,
      ),
    );
    const strength = Math.max(0, Math.min(100, partnership.relationshipStrength)) / 100;
    return total + baseCommercialValue * 0.08 * strength * (0.75 + quality * 0.5);
  }, 0);
  return {
    amount: Math.min(Math.round(baseCommercialValue * 0.08), Math.round(value)),
    baseCommercialValue,
    partnershipCount: partnerships.length,
  };
};

export const runPreseasonCommercialCamp = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    destination: string;
    startDate: string;
    endDate: string;
    seed: string;
  },
): PreseasonCommercialCamp => {
  const economy = new ClubEconomyRepository(db);
  const campId = createStableEntityId(
    "commercial-camp",
    `${input.clubId}:${input.startDate}:${input.destination}`,
  );
  const existing = economy.commercialCamps(input.clubId).find((camp) => camp.id === campId);
  if (existing) return existing;
  const commercial = economy.commercialProfile(input.clubId);
  const support = economy.supporterProfile(input.clubId);
  const reach = Math.round((commercial?.digitalReach ?? 2) + (support?.diasporaSupport ?? 0) / 500);
  const cost = Math.round(85000 + reach * 22000);
  const camp: PreseasonCommercialCamp = {
    id: campId,
    clubId: input.clubId,
    destination: input.destination,
    startDate: input.startDate,
    endDate: input.endDate,
    cost,
    commercialReach: reach,
    sportingImpact: -0.03,
    status: "COMPLETED",
  };
  economy.upsertCommercialCamp(camp);
  postClubTransaction(db, {
    clubId: input.clubId,
    date: input.startDate,
    category: "TRAVEL",
    direction: "DEBIT",
    amount: cost,
    description: `Preseason commercial camp in ${input.destination}`,
    relatedEntityId: camp.id,
    idempotencyKey: `commercial-camp:${camp.id}`,
  });
  const tourRevenue = Math.round(reach * 18000);
  if (tourRevenue > 0)
    postClubTransaction(db, {
      clubId: input.clubId,
      date: input.endDate,
      category: "MATCHDAY_REVENUE",
      direction: "CREDIT",
      amount: tourRevenue,
      description: `Preseason friendly/tour revenue from ${input.destination}`,
      relatedEntityId: camp.id,
      idempotencyKey: `commercial-tour-revenue:${camp.id}`,
    });
  if (support)
    economy.upsertSupporterProfile({
      ...support,
      diasporaSupport: support.diasporaSupport + Math.round(reach * 8),
      commercialReputation: Math.min(10, support.commercialReputation + 0.12),
    });
  economy.insertCommercialHistory({
    id: createStableEntityId("commercial-history", `${camp.id}:tour`),
    clubId: input.clubId,
    date: input.startDate,
    eventType: "TOUR",
    amount: tourRevenue - cost,
    audienceImpact: reach,
    description: `Commercial camp and tour in ${input.destination}`,
  });
  return camp;
};

export const postClubTransaction = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    date: string;
    category: ClubLedgerCategory;
    direction: ClubLedgerDirection;
    amount: number;
    description: string;
    relatedEntityId?: EntityId;
    idempotencyKey?: string;
  },
): ClubLedgerEntry => {
  const entry: ClubLedgerEntry = {
    id: createStableEntityId(
      "club-ledger-entry",
      `${input.clubId}:${input.date}:${input.category}:${input.direction}:${input.idempotencyKey ?? input.description}`,
    ),
    clubId: input.clubId,
    date: input.date,
    category: input.category,
    direction: input.direction,
    amount: Math.max(0, Math.round(input.amount)),
    currency,
    description: input.description,
    relatedEntityId: input.relatedEntityId,
    status: simulationStatus,
  };
  new ClubEconomyRepository(db).postLedgerEntry(entry);
  return entry;
};

export const setClubBudget = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    seasonLabel: string;
    category: ClubBudgetCategory;
    amount: number;
  },
): ClubBudget => {
  const budget: ClubBudget = {
    id: createStableEntityId(
      "club-budget",
      `${input.clubId}:${input.seasonLabel}:${input.category}`,
    ),
    clubId: input.clubId,
    seasonLabel: input.seasonLabel,
    category: input.category,
    amount: Math.round(input.amount),
    usedAmount:
      new ClubEconomyRepository(db)
        .budgets(input.clubId)
        .find((item) => item.seasonLabel === input.seasonLabel && item.category === input.category)
        ?.usedAmount ?? 0,
    currency,
    status: "ACTIVE",
    provenanceStatus: simulationStatus,
  };
  new ClubEconomyRepository(db).upsertBudget(budget);
  return budget;
};

/** Role-facing adapter for a controlling chairman's existing club budget action. */
export const setClubBudgetCommand = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    personId: EntityId;
    callerRole: "MANAGER" | "CHAIRMAN_OWNER" | "FEDERATION_PRESIDENT" | "CEO";
    seasonLabel: string;
    category: ClubBudgetCategory;
    amount: number;
  },
): ClubBudget => {
  if (input.callerRole !== "CHAIRMAN_OWNER" &&
      !(input.callerRole === "CEO" && executiveHasAuthority(db, input.clubId, input.personId, "BUDGET_ADMINISTRATION")))
    throw new Error("Only the active chairman/owner may set a club budget");
  const club = db
    .prepare(
      "SELECT c.id FROM clubs c JOIN countries co ON co.id=c.country_id WHERE c.id=? AND co.iso_code IN ('NP','NPL')",
    )
    .get(input.clubId) as { id?: EntityId } | undefined;
  if (!club) throw new Error("Club budget commands are unavailable for context-only clubs");
  const controllingStake = db
    .prepare(
      "SELECT 1 FROM club_ownership_stakes WHERE club_id=? AND holder_type='PERSON' AND holder_id=? AND status='ACTIVE' AND percentage>=51 LIMIT 1",
    )
    .get(input.clubId, input.personId);
  if (!controllingStake && input.callerRole !== "CEO") throw new Error("Only a controlling owner or assigned CEO may set this club budget");
  if (!Number.isFinite(input.amount) || input.amount < 0)
    throw new Error("Budget amount must be a non-negative number");
  return setClubBudget(db, input);
};

export const investPersonalFunds = (
  db: GameDatabase,
  input: {
    personId: EntityId;
    clubId: EntityId;
    date: string;
    amount: number;
    form: OwnerInvestmentForm;
  },
): OwnerInvestmentTransaction => {
  const economy = new ClubEconomyRepository(db);
  const personal = economy.personalFinancialProfile(input.personId);
  if (!personal) {
    throw new Error(`Personal financial profile missing for ${input.personId}`);
  }
  if (personal.cash < input.amount) {
    throw new Error("Personal cash is insufficient for owner investment");
  }
  const clubEntry = postClubTransaction(db, {
    clubId: input.clubId,
    date: input.date,
    category: input.form === "EQUITY" ? "EQUITY_INVESTMENT" : "OWNER_INVESTMENT",
    direction: "CREDIT",
    amount: input.amount,
    description: `Owner investment (${input.form})`,
    relatedEntityId: input.personId,
    idempotencyKey: `${input.personId}:${input.form}`,
  });
  economy.updatePersonalCash(input.personId, -input.amount, input.date);
  const transaction: OwnerInvestmentTransaction = {
    id: createStableEntityId(
      "owner-investment",
      `${input.personId}:${input.clubId}:${input.date}:${input.form}:${input.amount}`,
    ),
    personId: input.personId,
    clubId: input.clubId,
    date: input.date,
    amount: input.amount,
    currency,
    form: input.form,
    personalLedgerEntryId: createStableEntityId(
      "personal-ledger-placeholder",
      `${input.personId}:${input.clubId}:${input.date}:${input.form}`,
    ),
    clubLedgerEntryId: clubEntry.id,
    status: "POSTED",
    provenanceStatus: simulationStatus,
  };
  economy.insertOwnerInvestment(transaction);
  return transaction;
};

/**
 * Read model behind the sponsor-meeting UI. SponsorshipContract itself never
 * carries the sponsor's own name/industry/budget tier — the sponsorship
 * table couldn't previously say who a deal was even with — so this joins in
 * the real sponsor record for every contract, without inventing anything
 * about a company that isn't already in the sponsor registry.
 */
export const sponsorMeetingOverview = (db: GameDatabase, clubId: EntityId): SponsorMeetingOverview => {
  const economy = new ClubEconomyRepository(db);
  const club = db.prepare("SELECT name FROM clubs WHERE id=?").get(clubId) as { name?: string } | undefined;
  if (!club?.name) throw new Error(`Club not found: ${clubId}`);
  const sponsorsById = new Map(economy.sponsors().map((sponsor) => [sponsor.id, sponsor]));
  const enrich = (contract: SponsorshipContract): SponsorMeetingOverview["offers"][number] => {
    const sponsor: SponsorOrganisation | undefined = sponsorsById.get(contract.sponsorId);
    return {
      ...contract,
      sponsorName: sponsor?.name ?? "Unknown sponsor",
      sponsorIndustry: sponsor?.industry ?? "Unknown industry",
      sponsorBudgetTier: sponsor?.budgetTier ?? "LOCAL",
      sponsorIdentityProvenance: sponsor?.identityProvenance,
    };
  };
  const contracts = economy.sponsorships(clubId).map(enrich);
  return {
    clubId,
    clubName: club.name,
    offers: contracts.filter((item) => item.status === "OFFERED"),
    active: contracts.filter((item) => item.status === "ACTIVE"),
    history: contracts.filter((item) => item.status === "REJECTED" || item.status === "EXPIRED"),
  };
};

export const generateSponsorOffers = (
  db: GameDatabase,
  input: { clubId: EntityId; date: string; seed: string; count?: number },
): SponsorshipContract[] => {
  const economy = new ClubEconomyRepository(db);
  const sponsors = economy.sponsors();
  const supporter = economy.supporterProfile(input.clubId);
  const commercial = economy.commercialProfile(input.clubId);
  const clubCountry = db.prepare("SELECT country_id FROM clubs WHERE id = ?").get(input.clubId) as
    { country_id?: EntityId } | undefined;
  const macro = clubCountry?.country_id
    ? macroEconomyForCountry(db, clubCountry.country_id, Number(input.date.slice(0, 4)))
    : undefined;
  const team = db
    .prepare(
      `SELECT t.id FROM teams t WHERE t.club_id = ? AND t.level = 'senior' ORDER BY t.id LIMIT 1`,
    )
    .get(input.clubId) as { id: EntityId } | undefined;
  const standing = team
    ? (db
        .prepare(
          "SELECT points FROM league_standings WHERE team_id = ? ORDER BY points DESC LIMIT 1",
        )
        .get(team.id) as { points?: number } | undefined)
    : undefined;
  const rng = new SeededRandom(`${input.seed}:sponsor-offers:${input.clubId}:${input.date}`);
  const count = input.count ?? 3;
  /*
   * A club can hold up to four concurrent sponsors, one per exclusivity slot
   * (shirt main, official partner, sleeve, local partner) — `acceptSponsorOffer`
   * already refuses a second sponsor within the same slot. But every caller
   * of this function requests `count: 1`, and offers used to always fill
   * index 0 (SHIRT_MAIN) regardless of what the club already held. Once a
   * club's real shirt sponsor was in place, generating another SHIRT_MAIN
   * offer was pointless (rejected on accept) and every OTHER slot stayed
   * permanently empty — the commercial pipeline could never diversify beyond
   * the one baseline sponsor a club starts with. Offers are now built only
   * for slots the club doesn't currently hold.
   */
  const slotOrder: SponsorshipType[] = ["SHIRT_MAIN", "OFFICIAL_PARTNER", "SLEEVE", "LOCAL_PARTNER"];
  const heldSlots = new Set(
    economy
      .sponsorships(input.clubId)
      .filter((item) => item.status === "ACTIVE" && item.endDate >= input.date)
      .map((item) => item.type),
  );
  const openSlots = slotOrder.filter((type) => !heldSlots.has(type));
  /*
   * `economy.sponsors()` always returns the same sponsors in the same fixed
   * (alphabetical) order — every club's candidate slice therefore started
   * from the exact same sponsor organisation, so in a real multi-season
   * world nearly every club ended up sponsored by whichever single sponsor
   * happened to sort first. Rotating the candidate list by a deterministic,
   * club-seeded offset spreads different clubs across different sponsors
   * while staying fully reproducible for the same club/date.
   */
  const eligibleSponsors = sponsors.filter((sponsor) => sponsor.status !== "UNKNOWN");
  const rotation = eligibleSponsors.length > 0 ? rng.integer(0, eligibleSponsors.length - 1) : 0;
  const rotatedSponsors = eligibleSponsors.map(
    (_, index) => eligibleSponsors[(index + rotation) % eligibleSponsors.length]!,
  );
  return rotatedSponsors
    .slice(0, Math.max(count, 1) * 4)
    .slice(0, Math.min(count, openSlots.length))
    .map((sponsor, index) => {
      const audience =
        (supporter?.coreSupporters ?? 800) +
        (supporter?.casualSupporters ?? 1000) * 0.35 +
        (supporter?.diasporaSupport ?? 0) * 1.4;
      const resultsFactor = 1 + Math.min(0.18, (standing?.points ?? 0) / 500);
      const reputationFactor =
        (supporter?.footballReputation ?? 5) +
        (commercial?.brandStrength ?? 4) +
        (commercial?.digitalReach ?? 3);
      const tierFactor = { LOCAL: 0.65, REGIONAL: 1, NATIONAL: 1.35, PREMIUM: 1.8 }[
        sponsor.budgetTier
      ];
      const value = adjustForMacro(
        (160000 + audience * 110 + reputationFactor * 70000 + sponsor.reputation * 50000) *
          tierFactor *
          resultsFactor +
          rng.integer(0, 90000),
        macro,
        "sponsorMarketStrength",
      );
      const type = openSlots[index] ?? "LOCAL_PARTNER";
      const contract: SponsorshipContract = {
        // The id must be unique per SLOT, not just per club/sponsor/date: a
        // repeat call for the same club on the same date (e.g. a second slot
        // opened up the same day the first was filled) previously reused the
        // exact same id whenever it landed on the same sponsor organisation,
        // so `upsertSponsorship` silently overwrote the earlier contract
        // instead of creating a second one — the club ended up with only
        // one sponsorship row no matter how many slots were "filled".
        id: createStableEntityId(
          "sponsorship-contract",
          `${input.clubId}:${sponsor.id}:${input.date}:${type}`,
        ),
        clubId: input.clubId,
        sponsorId: sponsor.id,
        type,
        startDate: input.date,
        endDate: addYears(input.date, type === "SHIRT_MAIN" ? 2 : 1),
        annualValue: Math.round(value),
        bonuses: { champion: Math.round(value * 0.12), promotion: Math.round(value * 0.08) },
        currency,
        status: "OFFERED",
        exclusivityGroup: type === "LOCAL_PARTNER" ? "LOCAL_SERVICES" : type,
        expectations: {
          appearances: Math.round(4 + sponsor.reputation),
          socialReach: Math.round((commercial?.digitalReach ?? 3) * 10),
        },
        provenanceStatus: simulationStatus,
      };
      economy.upsertSponsorship(contract);
      return contract;
    });
};

export const acceptSponsorOffer = (
  db: GameDatabase,
  sponsorshipId: EntityId,
  date: string,
  /** True only for the one-off bulk baseline sponsorship every club is
   * seeded with at world creation — not a real in-game decision, so it
   * must never become a public story or trigger a follow-up reaction.
   * Every genuine gameplay acceptance (the default) still publishes. */
  options?: { silent?: boolean },
): SponsorshipContract => {
  const economy = new ClubEconomyRepository(db);
  const contract = economy.sponsorship(sponsorshipId);
  if (!contract) throw new Error(`Sponsorship offer ${sponsorshipId} not found`);
  if (contract.status !== "OFFERED" && contract.status !== "COUNTERED")
    throw new Error(`Sponsorship ${sponsorshipId} is not available`);
  const exclusiveConflict = economy
    .sponsorships(contract.clubId)
    .some(
      (item) =>
        item.id !== contract.id &&
        item.status === "ACTIVE" &&
        item.exclusivityGroup &&
        item.exclusivityGroup === contract.exclusivityGroup &&
        item.endDate >= date,
    );
  if (exclusiveConflict)
    throw new Error(`An active ${contract.exclusivityGroup} sponsorship already exists`);
  economy.updateSponsorshipStatus(sponsorshipId, "ACTIVE");
  postClubTransaction(db, {
    clubId: contract.clubId,
    date,
    category: "SPONSORSHIP",
    direction: "CREDIT",
    amount: Math.round(contract.annualValue / 2),
    description: "Initial sponsorship payment",
    relatedEntityId: sponsorshipId,
    idempotencyKey: `sponsor-initial:${sponsorshipId}`,
  });
  const eventId = createStableEntityId("history", `SPONSORSHIP_ACCEPTED:${sponsorshipId}`);
  if (!options?.silent && !db.prepare("SELECT 1 FROM historical_events WHERE id=?").get(eventId)) {
    const club_ = (db.prepare("SELECT name FROM clubs WHERE id=?").get(contract.clubId) as { name?: string } | undefined)?.name ?? "The club";
    const sponsor_ = (db.prepare("SELECT name FROM sponsor_organisations WHERE id=?").get(contract.sponsorId) as { name?: string } | undefined)?.name;
    new EventRepository(db).insertHistoricalEvent({
      id: eventId,
      occurredOn: date,
      eventType: "SPONSORSHIP_ACCEPTED",
      involvedEntities: [{ id: contract.clubId, type: "club" }],
      title: sponsor_ ? `${club_} agrees new partnership with ${sponsor_}` : `${club_} agrees a new sponsorship deal`,
      data: { sponsorshipId, dealId: sponsorshipId, annualValue: contract.annualValue, endDate: contract.endDate },
      importance: "high",
      scope: "club",
    });
  }
  return { ...contract, status: "ACTIVE" };
};

/** Role-facing adapter for a controlling chairman's existing sponsorship approval. */
export const acceptSponsorOfferCommand = (
  db: GameDatabase,
  input: {
    sponsorshipId: EntityId;
    clubId: EntityId;
    personId: EntityId;
    callerRole: "MANAGER" | "CHAIRMAN_OWNER" | "FEDERATION_PRESIDENT" | "CEO";
    date: string;
  },
): SponsorshipContract => {
  if (input.callerRole !== "CHAIRMAN_OWNER" &&
      !(input.callerRole === "CEO" && executiveHasAuthority(db, input.clubId, input.personId, "COMMERCIAL_OVERSIGHT")))
    throw new Error("Only the active chairman/owner may approve sponsorships");
  const club = db
    .prepare(
      "SELECT c.id FROM clubs c JOIN countries co ON co.id=c.country_id WHERE c.id=? AND co.iso_code IN ('NP','NPL')",
    )
    .get(input.clubId) as { id?: EntityId } | undefined;
  if (
    !club ||
    db
      .prepare(
        "SELECT 1 FROM external_club_context WHERE club_id=? AND simulation_depth='CONTEXT_ONLY' LIMIT 1",
      )
      .get(input.clubId)
  )
    throw new Error("Sponsorship commands are unavailable for context-only clubs");
  const controllingStake = db
    .prepare(
      "SELECT 1 FROM club_ownership_stakes WHERE club_id=? AND holder_type='PERSON' AND holder_id=? AND status='ACTIVE' AND percentage>=51 LIMIT 1",
    )
    .get(input.clubId, input.personId);
  if (!controllingStake && input.callerRole !== "CEO") throw new Error("Only a controlling owner or assigned CEO may approve this sponsorship");
  const offer = new ClubEconomyRepository(db)
    .sponsorships()
    .find((item) => item.id === input.sponsorshipId);
  if (!offer || offer.clubId !== input.clubId)
    throw new Error("Sponsorship offer does not belong to this club");
  return acceptSponsorOffer(db, input.sponsorshipId, input.date);
};

export const rejectSponsorOffer = (
  db: GameDatabase,
  sponsorshipId: EntityId,
): SponsorshipContract => {
  const economy = new ClubEconomyRepository(db);
  const contract = economy.sponsorships().find((item) => item.id === sponsorshipId);
  if (!contract) throw new Error(`Sponsorship offer ${sponsorshipId} not found`);
  // Idempotent on a rejection already recorded — a double-click or a replayed
  // command must not throw "not negotiable" on the offer it just rejected.
  if (contract.status === "REJECTED") return contract;
  if (contract.status !== "OFFERED" && contract.status !== "COUNTERED")
    throw new Error(`Sponsorship ${sponsorshipId} is not negotiable`);
  economy.updateSponsorshipStatus(sponsorshipId, "REJECTED");
  return { ...contract, status: "REJECTED" };
};

/** Role-facing adapter for a controlling chairman's existing sponsorship rejection. */
export const rejectSponsorOfferCommand = (
  db: GameDatabase,
  input: {
    sponsorshipId: EntityId;
    clubId: EntityId;
    personId: EntityId;
    callerRole: "MANAGER" | "CHAIRMAN_OWNER" | "FEDERATION_PRESIDENT" | "CEO";
  },
): SponsorshipContract => {
  if (input.callerRole !== "CHAIRMAN_OWNER" &&
      !(input.callerRole === "CEO" && executiveHasAuthority(db, input.clubId, input.personId, "COMMERCIAL_OVERSIGHT")))
    throw new Error("Only the active chairman/owner may reject sponsorships");
  const club = db
    .prepare(
      "SELECT c.id FROM clubs c JOIN countries co ON co.id=c.country_id WHERE c.id=? AND co.iso_code IN ('NP','NPL')",
    )
    .get(input.clubId) as { id?: EntityId } | undefined;
  if (
    !club ||
    db
      .prepare(
        "SELECT 1 FROM external_club_context WHERE club_id=? AND simulation_depth='CONTEXT_ONLY' LIMIT 1",
      )
      .get(input.clubId)
  )
    throw new Error("Sponsorship commands are unavailable for context-only clubs");
  const controllingStake = db
    .prepare(
      "SELECT 1 FROM club_ownership_stakes WHERE club_id=? AND holder_type='PERSON' AND holder_id=? AND status='ACTIVE' AND percentage>=51 LIMIT 1",
    )
    .get(input.clubId, input.personId);
  if (!controllingStake && input.callerRole !== "CEO") throw new Error("Only a controlling owner or assigned CEO may reject this sponsorship");
  const offer = new ClubEconomyRepository(db)
    .sponsorships()
    .find((item) => item.id === input.sponsorshipId);
  if (!offer || offer.clubId !== input.clubId)
    throw new Error("Sponsorship offer does not belong to this club");
  return rejectSponsorOffer(db, input.sponsorshipId);
};

export const counterSponsorOffer = (
  db: GameDatabase,
  input: {
    sponsorshipId: EntityId;
    annualValue: number;
    endDate?: string;
    date: string;
    seed: string;
  },
): SponsorshipContract => {
  const economy = new ClubEconomyRepository(db);
  const offer = economy.sponsorships().find((item) => item.id === input.sponsorshipId);
  if (!offer || (offer.status !== "OFFERED" && offer.status !== "COUNTERED"))
    throw new Error("That sponsorship offer is no longer available");
  const sponsor = economy.sponsors().find((item) => item.id === offer.sponsorId);
  const ceiling =
    offer.annualValue *
    { LOCAL: 1.08, REGIONAL: 1.14, NATIONAL: 1.2, PREMIUM: 1.26 }[sponsor?.budgetTier ?? "LOCAL"];
  if (!Number.isFinite(input.annualValue) || input.annualValue <= 0)
    return rejectSponsorOffer(db, offer.id);
  const round = offer.negotiationRound ?? 0;
  const maxRounds = offer.maxNegotiationRounds ?? 3;
  const requested = Math.max(1, Math.round(input.annualValue));
  if (requested > ceiling) {
    return rejectSponsorOffer(db, offer.id);
  }
  // A modest counter is accepted; stronger asks receive a deterministic sponsor
  // counter until the bounded negotiation window is exhausted.
  const sponsorAccepts = requested <= offer.annualValue * 1.03 || round >= maxRounds - 1;
  if (sponsorAccepts) {
    const revised = { ...offer, annualValue: requested, endDate: input.endDate ?? offer.endDate, negotiationRound: round + 1, maxNegotiationRounds: maxRounds, counterpartyResponse: "ACCEPTED" as const, negotiationNote: "Sponsor accepted the revised commercial terms" };
    economy.upsertSponsorship(revised);
    return acceptSponsorOffer(db, offer.id, input.date);
  }
  const sponsorCounter = Math.max(offer.annualValue, Math.round(requested * 0.96));
  const revised = { ...offer, annualValue: sponsorCounter, endDate: input.endDate ?? offer.endDate, status: "COUNTERED" as const, negotiationRound: round + 1, maxNegotiationRounds: maxRounds, counterpartyResponse: "COUNTERED" as const, negotiationNote: "Sponsor returned a bounded counter-offer" };
  economy.upsertSponsorship(revised);
  return revised;
};

export const renewSponsorship = (
  db: GameDatabase,
  input: { sponsorshipId: EntityId; date: string; seed: string },
): SponsorshipContract => {
  const economy = new ClubEconomyRepository(db);
  const previous = economy.sponsorships().find((item) => item.id === input.sponsorshipId);
  if (!previous || (previous.status !== "ACTIVE" && previous.status !== "EXPIRED"))
    throw new Error("That sponsorship cannot be renewed");
  const rng = new SeededRandom(`${input.seed}:sponsor-renewal:${previous.id}:${input.date}`);
  const value = Math.round(previous.annualValue * (0.9 + rng.next() * 0.25));
  const renewed: SponsorshipContract = {
    ...previous,
    id: createStableEntityId("sponsorship-contract-renewal", `${previous.id}:${input.date}`),
    startDate: input.date,
    endDate: addYears(input.date, 1),
    annualValue: value,
    status: "OFFERED",
  };
  economy.upsertSponsorship(renewed);
  return renewed;
};

export const expireSponsorships = (db: GameDatabase, date: string): SponsorshipContract[] => {
  const economy = new ClubEconomyRepository(db);
  const expired = economy
    .sponsorships()
    .filter((item) => item.status === "ACTIVE" && item.endDate < date);
  for (const contract of expired) {
    economy.updateSponsorshipStatus(contract.id, "EXPIRED");
    new EventRepository(db).insertHistoricalEvent({
      id: createStableEntityId("history", `SPONSORSHIP_EXPIRED:${contract.id}`),
      occurredOn: date,
      eventType: "SPONSORSHIP_EXPIRED",
      involvedEntities: [{ id: contract.clubId, type: "club" }],
      title: "Club sponsorship expired",
      data: { sponsorshipId: contract.id, endDate: contract.endDate },
      importance: "medium",
      scope: "club",
    });
  }
  return expired.map((contract) => ({ ...contract, status: "EXPIRED" }));
};

export const createInfrastructureProject = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    projectType: InfrastructureProjectType;
    date: string;
    seed: string;
    locationId?: EntityId;
    venueId?: EntityId;
    financing?: Record<string, number>;
    siteRights?: InfrastructureProject["siteRights"];
    /**
     * Runs the exact same cost/duration/prerequisite calculation without
     * writing the project, any linked debt, or any ledger transaction — used
     * by the facility planner's pre-commit summary so the "estimated cost
     * band"/"duration band" it shows come from this same canonical engine
     * instead of a duplicated frontend formula. Same seed + same date as the
     * later real create call reproduces identical figures, not just the
     * same band.
     */
    dryRun?: boolean;
  },
): InfrastructureProject => {
  const rng = new SeededRandom(
    `${input.seed}:project:${input.clubId}:${input.projectType}:${input.date}`,
  );
  const clubCountry = db.prepare("SELECT country_id FROM clubs WHERE id = ?").get(input.clubId) as
    { country_id?: EntityId } | undefined;
  const macro = clubCountry?.country_id
    ? macroEconomyForCountry(db, clubCountry.country_id, Number(input.date.slice(0, 4)))
    : undefined;
  const baseCost = adjustForMacro(
    projectBaseCost(input.projectType),
    macro,
    "constructionCostIndex",
  );
  const economy = new ClubEconomyRepository(db);
  const prerequisites = projectPrerequisites(input.projectType);
  const completedTypes = new Set(
    economy
      .infrastructureProjects(input.clubId)
      .filter((project) => project.status === "COMPLETED")
      .map((project) => project.projectType),
  );
  if (prerequisites.some((required) => !completedTypes.has(required)))
    throw new Error(`${input.projectType} requires completed ${prerequisites.join(" and ")}`);
  const financingJson = input.financing ?? { clubCash: 1 };
  const rawCommitted = Object.values(financingJson).reduce(
    (total, value) => total + Math.max(0, value),
    0,
  );
  const fundingCommitted =
    rawCommitted <= 1 ? Math.round(baseCost * rawCommitted) : Math.round(rawCommitted);
  const siteRights = input.siteRights ?? "OWNED";
  const project: InfrastructureProject = {
    id: createStableEntityId(
      "infrastructure-project",
      `${input.clubId}:${input.projectType}:${input.date}`,
    ),
    clubId: input.clubId,
    projectType: input.projectType,
    locationId: input.locationId,
    venueId: input.venueId,
    planningStart: input.date,
    expectedCompletion: addDays(input.date, 90 + rng.integer(0, 160)),
    capitalCost: Math.round(baseCost * (0.85 + rng.next() * 0.35)),
    ongoingCost: Math.round(baseCost * 0.015),
    currency,
    status: "PLANNING",
    financingJson,
    siteRights,
    fundingStatus:
      fundingCommitted >= baseCost
        ? "FUNDED"
        : fundingCommitted > 0
          ? "PARTIALLY_FUNDED"
          : "UNFUNDED",
    fundingCommitted,
    delayDays: 0,
    maintenanceStatus: "FUNDED",
    components: projectComponents(input.projectType),
    utilisationCapacity: projectCapacity(input.projectType),
    provenanceStatus: simulationStatus,
  };
  const debtAmount = Math.max(0, financingJson.debt ?? 0);
  if (debtAmount > 0 && !input.dryRun) {
    economy.upsertDebt({
      id: createStableEntityId("infrastructure-debt", project.id),
      clubId: input.clubId,
      lenderType: "BANK",
      principal: debtAmount,
      outstandingPrincipal: debtAmount,
      interestRate: 0.075,
      currency,
      startDate: input.date,
      maturityDate: addYears(input.date, 5),
      repaymentSchedule: "SEASONAL",
      status: "ACTIVE",
      provenanceStatus: simulationStatus,
    });
    postClubTransaction(db, {
      clubId: input.clubId,
      date: input.date,
      category: "OTHER",
      direction: "CREDIT",
      amount: debtAmount,
      description: `Infrastructure debt draw for ${input.projectType}`,
      relatedEntityId: project.id,
      idempotencyKey: `infrastructure-debt:${project.id}`,
    });
  }
  if (!input.dryRun) economy.upsertInfrastructureProject(project);
  return project;
};

/** Role-facing adapter for a controlling chairman's existing infrastructure action. */
export const createInfrastructureProjectCommand = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    personId: EntityId;
    callerRole: "MANAGER" | "CHAIRMAN_OWNER" | "FEDERATION_PRESIDENT" | "CEO";
    projectType: InfrastructureProjectType;
    date: string;
    seed: string;
    dryRun?: boolean;
  },
): InfrastructureProject => {
  if (input.callerRole !== "CHAIRMAN_OWNER" &&
      !(input.callerRole === "CEO" && executiveHasAuthority(db, input.clubId, input.personId, "FACILITY_OVERSIGHT")))
    throw new Error("Only the active chairman/owner may approve infrastructure projects");
  const club = db
    .prepare(
      "SELECT c.id FROM clubs c JOIN countries co ON co.id=c.country_id WHERE c.id=? AND co.iso_code IN ('NP','NPL')",
    )
    .get(input.clubId) as { id?: EntityId } | undefined;
  if (!club) throw new Error("Infrastructure commands are unavailable for context-only clubs");
  const contextOnly = db
    .prepare(
      "SELECT 1 FROM external_club_context WHERE club_id=? AND simulation_depth='CONTEXT_ONLY' LIMIT 1",
    )
    .get(input.clubId);
  if (contextOnly)
    throw new Error("Infrastructure commands are unavailable for context-only clubs");
  const controllingStake = db
    .prepare(
      "SELECT 1 FROM club_ownership_stakes WHERE club_id=? AND holder_type='PERSON' AND holder_id=? AND status='ACTIVE' AND percentage>=51 LIMIT 1",
    )
    .get(input.clubId, input.personId);
  if (!controllingStake && input.callerRole !== "CEO") throw new Error("Only a controlling owner or assigned CEO may approve this club project");
  return createInfrastructureProject(db, input);
};

/** Once-only historical-event insert — historical_events has no unique
 * constraint of its own, so every caller that might re-run for the same
 * project/milestone on a later tick must check before inserting, keyed by a
 * stable id that never includes the date. */
const recordHistoricalEventOnce = (
  db: GameDatabase,
  event: Parameters<InstanceType<typeof EventRepository>["insertHistoricalEvent"]>[0],
): void => {
  if (db.prepare("SELECT 1 FROM historical_events WHERE id=?").get(event.id)) return;
  new EventRepository(db).insertHistoricalEvent(event);
};

/** A short, human phrase for the physical thing a project type actually
 * builds — used only for story text, never for gameplay logic. */
const projectStoryPhrase = (type: InfrastructureProjectType): string => {
  switch (type) {
    case "STADIUM":
    case "STAND":
    case "FLOODLIGHTS":
    case "PITCH":
    case "DRAINAGE":
      return "stadium expansion";
    case "TRAINING_GROUND":
    case "GYM":
    case "ANALYSIS_ROOM":
      return "training-ground upgrade";
    case "ACADEMY":
      return "academy upgrade";
    case "MEDICAL_ROOM":
    case "RECOVERY_CENTRE":
      return "medical centre upgrade";
    case "OFFICE":
    case "SCOUTING_DEPARTMENT":
      return "club offices upgrade";
    case "REFURBISHMENT":
      return "facility refurbishment";
    case "RETAIL_STORE":
      return "club store investment";
    default:
      return "facility project";
  }
};

export const advanceInfrastructureProjects = (
  db: GameDatabase,
  input: { date: string; seed: string },
): InfrastructureProject[] => {
  const economy = new ClubEconomyRepository(db);
  const updated: InfrastructureProject[] = [];
  for (const project of economy.infrastructureProjects()) {
    if (project.status === "COMPLETED" || project.status === "CANCELLED") continue;
    let next = project;
    if (project.status === "PLANNING" && project.planningStart <= addDays(input.date, -30)) {
      if (project.fundingStatus !== "FUNDED") {
        next = { ...next, status: "FINANCING" };
        economy.upsertInfrastructureProject(next);
        updated.push(next);
        continue;
      }
      const rng = new SeededRandom(`${input.seed}:project-risk:${project.id}`);
      const delayDays = rng.integer(0, 45);
      const overrun = 1 + rng.next() * 0.12;
      next = {
        ...next,
        status: "CONSTRUCTION",
        constructionStart: input.date,
        delayDays,
        capitalCost: Math.round(project.capitalCost * overrun),
      };
      postClubTransaction(db, {
        clubId: project.clubId,
        date: input.date,
        category: "FACILITY_COST",
        direction: "DEBIT",
        amount: Math.round(next.capitalCost * 0.35),
        description: `${project.projectType} construction installment`,
        relatedEntityId: project.id,
        idempotencyKey: `project-start:${project.id}`,
      });
      recordHistoricalEventOnce(db, {
        id: createStableEntityId("history", `INFRASTRUCTURE_PROJECT_STARTED:${project.id}`),
        occurredOn: input.date,
        eventType: "INFRASTRUCTURE_PROJECT_STARTED",
        involvedEntities: [{ id: project.clubId, type: "club" }, { id: project.id, type: "infrastructureProject" }],
        title: `Construction has begun on the club's ${projectStoryPhrase(next.projectType)}.`,
        data: { projectId: project.id, projectType: project.projectType },
        importance: "medium",
        scope: "club",
      });
      if (delayDays > 0) {
        recordHistoricalEventOnce(db, {
          id: createStableEntityId("history", `INFRASTRUCTURE_PROJECT_DELAYED:${project.id}`),
          occurredOn: input.date,
          eventType: "INFRASTRUCTURE_PROJECT_DELAYED",
          involvedEntities: [{ id: project.clubId, type: "club" }, { id: project.id, type: "infrastructureProject" }],
          title: `The club's ${projectStoryPhrase(next.projectType)} is running ${delayDays} day(s) behind schedule.`,
          data: { projectId: project.id, projectType: project.projectType, delayDays },
          importance: "medium",
          scope: "club",
        });
      }
    }
    if (
      next.status === "CONSTRUCTION" &&
      next.constructionStart &&
      addDays(next.expectedCompletion, next.delayDays ?? 0) > input.date
    ) {
      const startMs = new Date(`${next.constructionStart}T00:00:00Z`).getTime();
      const endMs = new Date(`${addDays(next.expectedCompletion, next.delayDays ?? 0)}T00:00:00Z`).getTime();
      const nowMs = new Date(`${input.date}T00:00:00Z`).getTime();
      const elapsed = endMs > startMs ? (nowMs - startMs) / (endMs - startMs) : 0;
      if (elapsed >= 0.5) {
        recordHistoricalEventOnce(db, {
          id: createStableEntityId("history", `INFRASTRUCTURE_MILESTONE_REACHED:${project.id}`),
          occurredOn: input.date,
          eventType: "INFRASTRUCTURE_MILESTONE_REACHED",
          involvedEntities: [{ id: project.clubId, type: "club" }, { id: project.id, type: "infrastructureProject" }],
          title: `The ${projectStoryPhrase(next.projectType)} has reached its construction halfway milestone.`,
          data: { projectId: project.id, projectType: project.projectType },
          importance: "medium",
          scope: "club",
        });
      }
    }
    if (
      next.status === "CONSTRUCTION" &&
      addDays(next.expectedCompletion, next.delayDays ?? 0) <= input.date
    ) {
      next = { ...next, status: "COMPLETED", completedAt: input.date };
      postClubTransaction(db, {
        clubId: project.clubId,
        date: input.date,
        category: "FACILITY_COST",
        direction: "DEBIT",
        amount: Math.round(next.capitalCost * 0.65),
        description: `${project.projectType} completion installment`,
        relatedEntityId: project.id,
        idempotencyKey: `project-complete:${project.id}`,
      });
      economy.upsertAsset({
        id: createStableEntityId(
          "club-asset",
          `${project.clubId}:${project.projectType}:${project.id}`,
        ),
        clubId: project.clubId,
        assetType: assetTypeForProject(project.projectType),
        ownership:
          next.siteRights === "OWNED"
            ? "OWNED"
            : next.siteRights === "LEASED"
              ? "LEASED"
              : "USED_BY_PERMISSION",
        locationId: project.locationId,
        venueId: project.venueId,
        estimatedValue: Math.round(project.capitalCost * 0.8),
        currency,
        status: simulationStatus,
      });
      const facility = economy.facilityProfile(project.clubId);
      if (facility) {
        const quality =
          next.projectType === "TRAINING_GROUND"
            ? { trainingFacilityQuality: facility.trainingFacilityQuality + 1.2 }
            : next.projectType === "ACADEMY"
              ? {
                  youthFacilityQuality: facility.youthFacilityQuality + 1.2,
                  academyCapacity: facility.academyCapacity + 12,
                }
              : ["MEDICAL_ROOM", "RECOVERY_CENTRE", "GYM"].includes(next.projectType)
                ? { medicalFacilityQuality: facility.medicalFacilityQuality + 1 }
                : next.projectType === "REFURBISHMENT"
                  ? {
                      trainingFacilityQuality: facility.trainingFacilityQuality + 0.5,
                      youthFacilityQuality: facility.youthFacilityQuality + 0.5,
                      medicalFacilityQuality: facility.medicalFacilityQuality + 0.5,
                    }
                  : {};
        economy.upsertFacilityProfile({ ...facility, ...quality });
      }
      // A completed club store is a commercial asset, not a football
      // facility — it raises merchandiseAppeal (the input
      // postMerchandiseRevenue already reads every month), never
      // trainingFacilityQuality/etc. Bounded and additive rather than
      // multiplicative, same "no runaway" discipline as the quality
      // bumps above; capped at 100 to match this field's apparent 0-100
      // scale (see buildCommercialProfile's own derivation).
      if (next.projectType === "RETAIL_STORE") {
        const commercial = economy.commercialProfile(project.clubId);
        if (commercial) {
          economy.upsertCommercialProfile({
            ...commercial,
            merchandiseAppeal: Math.min(100, commercial.merchandiseAppeal + 6),
            updatedOn: input.date,
          });
        }
      }
      recordHistoricalEventOnce(db, {
        id: createStableEntityId("history", `FACILITY_PROJECT_COMPLETED:${project.id}`),
        occurredOn: input.date,
        eventType: "FACILITY_PROJECT_COMPLETED",
        involvedEntities: [{ id: project.clubId, type: "club" }, { id: project.id, type: "infrastructureProject" }],
        title: `The ${projectStoryPhrase(next.projectType)} has opened.`,
        data: { projectId: project.id, projectType: project.projectType },
        importance: "high",
        scope: "club",
      });
    }
    economy.upsertInfrastructureProject(next);
    updated.push(next);
  }
  return updated;
};

export const cancelInfrastructureProject = (
  db: GameDatabase,
  projectId: EntityId,
  date: string,
): InfrastructureProject => {
  const economy = new ClubEconomyRepository(db);
  const project = economy.infrastructureProjects().find((item) => item.id === projectId);
  if (!project || ["COMPLETED", "CANCELLED"].includes(project.status))
    throw new Error("That infrastructure project cannot be cancelled");
  const ledgerSunkCost = economy
    .ledgerEntries(project.clubId)
    .filter((entry) => entry.relatedEntityId === project.id && entry.category === "FACILITY_COST")
    .reduce((total, entry) => total + entry.amount, 0);
  // Funding already committed to a project remains sunk even when cancellation
  // happens before the first construction installment is posted (for example,
  // a debt-funded project cancelled while still in financing).
  const sunkCost = Math.max(ledgerSunkCost, project.fundingCommitted ?? 0);
  const cancelled = {
    ...project,
    status: "CANCELLED" as const,
    cancelledOn: date,
    sunkCost,
    recoveryPlan: "Review the site and resubmit only after financing is secured.",
  };
  economy.upsertInfrastructureProject(cancelled);
  return cancelled;
};

export const postponeInfrastructureProject = (
  db: GameDatabase,
  projectId: EntityId,
  date: string,
  recoveryPlan: string,
): InfrastructureProject => {
  const economy = new ClubEconomyRepository(db);
  const project = economy.infrastructureProjects().find((item) => item.id === projectId);
  if (!project || ["COMPLETED", "CANCELLED"].includes(project.status))
    throw new Error("That infrastructure project cannot be postponed");
  const postponed = {
    ...project,
    status: "FINANCING" as const,
    expectedCompletion: addDays(project.expectedCompletion, 60),
    recoveryPlan,
  };
  economy.upsertInfrastructureProject(postponed);
  return postponed;
};

export const createFacilityRefurbishment = (
  db: GameDatabase,
  input: { clubId: EntityId; date: string; seed: string; financing?: Record<string, number> },
): InfrastructureProject =>
  createInfrastructureProject(db, { ...input, projectType: "REFURBISHMENT" });

export const planAIInfrastructureProject = (
  db: GameDatabase,
  input: { clubId: EntityId; date: string; seed: string },
): InfrastructureProject | undefined => {
  const economy = new ClubEconomyRepository(db);
  const account = economy.financialAccount(input.clubId);
  if (!account || ["DISTRESSED", "INSOLVENT"].includes(account.financialHealth)) return undefined;
  const facility = economy.facilityProfile(input.clubId);
  const type: InfrastructureProjectType =
    (facility?.medicalFacilityQuality ?? 0) < 4
      ? "MEDICAL_ROOM"
      : (facility?.academyCapacity ?? 0) < 30
        ? "ACADEMY"
        : "TRAINING_GROUND";
  const cost = projectBaseCost(type);
  if (account.cashBalance < cost * 1.25) return undefined;
  return createInfrastructureProject(db, {
    clubId: input.clubId,
    projectType: type,
    date: input.date,
    seed: input.seed,
    financing: { clubCash: cost },
  });
};

export const calculateClubValuation = (
  db: GameDatabase,
  clubId: EntityId,
  date: string,
): ClubValuation => {
  const economy = new ClubEconomyRepository(db);
  const account = economy.financialAccount(clubId);
  const supporter = economy.supporterProfile(clubId);
  const assets = economy.assets(clubId).reduce((total, asset) => total + asset.estimatedValue, 0);
  const annualRevenue = Math.max(0, account?.seasonRevenue ?? 0);
  const reputation = supporter ? supporter.footballReputation + supporter.commercialReputation : 10;
  const valuation = Math.max(
    250000,
    Math.round(
      (account?.cashBalance ?? 0) +
        assets -
        (account?.debtBalance ?? 0) +
        annualRevenue * 2 +
        reputation * 300000,
    ),
  );
  const result: ClubValuation = {
    clubId,
    valuation,
    currency,
    calculatedAt: date,
    method: "SIMULATION_FOUNDATION",
    status: simulationStatus,
  };
  economy.upsertValuation(result);
  return result;
};

export const getOwnershipStructure = (db: GameDatabase, clubId: EntityId): ClubOwnershipStake[] =>
  new ClubEconomyRepository(db).ownershipStakes(clubId);

export const recordTransferEconomy = (
  db: GameDatabase,
  offer: TransferOffer,
  date: string,
): void => {
  const fee =
    offer.transferFee + offer.installments + offer.addOns + offer.agentFee + offer.signingFee;
  if (fee <= 0) return;
  const economy = new ClubEconomyRepository(db);
  postClubTransaction(db, {
    clubId: offer.buyingClubId,
    date,
    category: "TRANSFER_EXPENSE",
    direction: "DEBIT",
    amount: fee,
    description: "Transfer acquisition cost",
    relatedEntityId: offer.id,
    idempotencyKey: `transfer-buy:${offer.id}`,
  });
  economy.addBudgetUsage(offer.buyingClubId, seasonLabel(date), "TRANSFER_BUDGET", fee);
  if (offer.sellingClubId) {
    postClubTransaction(db, {
      clubId: offer.sellingClubId,
      date,
      category: "TRANSFER_INCOME",
      direction: "CREDIT",
      amount: offer.transferFee,
      description: "Transfer sale income",
      relatedEntityId: offer.id,
      idempotencyKey: `transfer-sell:${offer.id}`,
    });
  }
};

export const clubCanAffordTransfer = (
  db: GameDatabase,
  clubId: EntityId,
  amount: number,
  date: string,
): boolean => {
  const economy = new ClubEconomyRepository(db);
  const account = economy.financialAccount(clubId);
  const budget = economy
    .budgets(clubId)
    .find((item) => item.seasonLabel === seasonLabel(date) && item.category === "TRANSFER_BUDGET");
  if (!account || !budget) return true;
  return (
    account.cashBalance - amount > reserveFloor(account) &&
    budget.usedAmount + amount <= budget.amount
  );
};

export const clubCanAffordWage = (
  db: GameDatabase,
  clubId: EntityId,
  annualWage: number,
  date: string,
): boolean => {
  const economy = new ClubEconomyRepository(db);
  const budget = economy
    .budgets(clubId)
    .find((item) => item.seasonLabel === seasonLabel(date) && item.category === "WAGE_BUDGET");
  if (!budget) return true;
  const current = new TransferMarketRepository(db)
    .activeContractsForClub(clubId, date)
    .reduce((total, contract) => total + contract.salary, 0);
  return current + annualWage <= budget.amount * 1.08;
};

export type MatchdayEconomyResult = {
  attendance: number;
  capacity: number;
  ticketPrice: number;
  homeShare: number;
  /**
   * Supporter-demand breakdown, present when the club has a supporter culture
   * profile. Exposed for balancing and read models, not as player-facing truth.
   */
  attendanceBreakdown?: AttendanceDemandBreakdown;
};

export const postMatchdayEconomy = (
  db: GameDatabase,
  fixture: FixtureRecord,
  date: string,
  seed: string,
): MatchdayEconomyResult | undefined => {
  const homeClubId = clubIdForTeam(db, fixture.homeTeamId);
  const awayClubId = clubIdForTeam(db, fixture.awayTeamId);
  if (!homeClubId || !awayClubId) return undefined;
  const homeSupport = new ClubEconomyRepository(db).supporterProfile(homeClubId);
  const awaySupport = new ClubEconomyRepository(db).supporterProfile(awayClubId);
  const homeCommercial = new ClubEconomyRepository(db).commercialProfile(homeClubId);
  const awayCommercial = new ClubEconomyRepository(db).commercialProfile(awayClubId);
  const rng = new SeededRandom(`${seed}:matchday:${fixture.id}`);
  const capacity = venueCapacity(db, fixture.venueId) ?? 4000;
  const fixtureImportance = fixture.round <= 2 || fixture.round >= 20 ? 1.12 : 1;
  const reputationFactor =
    1 + ((homeSupport?.footballReputation ?? 5) + (awaySupport?.footballReputation ?? 5)) / 100;
  const audienceFactor =
    1 +
    ((homeSupport?.diasporaSupport ?? 0) / Math.max(1, homeSupport?.coreSupporters ?? 1)) * 0.08 +
    ((homeCommercial?.digitalReach ?? 0) + (awayCommercial?.digitalReach ?? 0)) / 100;
  const ticketPrice = homeSupport?.standardTicketPrice ?? 250;
  const sentimentFactor = {
    VERY_POSITIVE: 1.12,
    POSITIVE: 1.06,
    NEUTRAL: 1,
    NEGATIVE: 0.92,
    VERY_NEGATIVE: 0.82,
  }[homeSupport?.sentiment ?? "NEUTRAL"];
  const priceSensitivity = Math.max(
    0.55,
    Math.min(
      1.25,
      Math.pow(250 / Math.max(1, ticketPrice), homeCommercial?.ticketPriceElasticity ?? 1),
    ),
  );
  const baseDemand =
    (homeSupport?.coreSupporters ?? 800) * 0.18 +
    (homeSupport?.casualSupporters ?? 1000) * 0.04 +
    (awaySupport?.coreSupporters ?? 600) * 0.04;
  /* Supporter-aware demand replaces the flat formula wherever the supporter
   * world has a profile; saves without one keep the previous behaviour. */
  const demand = supporterAttendanceForFixture({
    db,
    homeClubId,
    awayClubId,
    capacity,
    ticketPrice,
    seed: `${seed}:${fixture.id}`,
    countryId: nepalCountryId(db),
    opponentReputation: awaySupport?.footballReputation,
    stakes: fixture.round >= 20 ? 60 : fixture.round <= 2 ? 25 : 35,
    competitionImportance: 55,
  });
  const attendance = demand
    ? Math.max(60, Math.min(capacity, demand.attendance))
    : Math.max(
        120,
        Math.min(
          capacity,
          Math.round(
            baseDemand *
              fixtureImportance *
              reputationFactor *
              audienceFactor *
              sentimentFactor *
              priceSensitivity *
              (0.8 + rng.next() * 0.4),
          ),
        ),
      );
  const gross = attendance * ticketPrice;
  const homeShare = Math.round(gross * 0.5);
  const organiserShare = Math.round(gross * 0.3);
  postClubTransaction(db, {
    clubId: homeClubId,
    date,
    category: "MATCHDAY_REVENUE",
    direction: "CREDIT",
    amount: homeShare,
    description: `Matchday ticket share, attendance ${attendance}`,
    relatedEntityId: fixture.id,
    idempotencyKey: `matchday-home:${fixture.id}`,
  });
  postClubTransaction(db, {
    clubId: homeClubId,
    date,
    category: "TRAVEL",
    direction: "DEBIT",
    amount: Math.round(organiserShare * 0.18),
    description: "Home match operations and venue share",
    relatedEntityId: fixture.id,
    idempotencyKey: `matchday-cost-home:${fixture.id}`,
  });
  postClubTransaction(db, {
    clubId: awayClubId,
    date,
    category: "TRAVEL",
    direction: "DEBIT",
    amount: Math.round(90000 + rng.next() * 60000),
    description: "Away match travel cost",
    relatedEntityId: fixture.id,
    idempotencyKey: `matchday-cost-away:${fixture.id}`,
  });
  return { attendance, capacity, ticketPrice, homeShare, attendanceBreakdown: demand };
};

export const processClubEconomyMonth = (
  db: GameDatabase,
  input: { date: string; seed: string },
): void => {
  normalizeSupporterCultureMonth(db, input.date);
  expireSponsorships(db, input.date);
  expireCompetitionMediaRights(db, input.date);
  const economy = new ClubEconomyRepository(db);
  const market = new TransferMarketRepository(db);
  const network = new ClubNetworkRepository(db);
  const externalClubs = new Map(
    new GlobalFootballContextRepository(db).clubs().map((club) => [club.clubId, club.reputation]),
  );
  const loanWages = activeLoanWageSettlements(market, input.date);
  const outboundLoanPlayers = new Set(loanWages.map((item) => item.loan.playerId));
  for (const account of economy.financialAccounts()) {
    const contracts = market
      .activeContractsForClub(account.clubId, input.date)
      .filter((contract) => !outboundLoanPlayers.has(contract.playerId));
    const monthlyWages = Math.round(
      contracts.reduce((total, contract) => total + contract.salary, 0) / 12,
    );
    if (monthlyWages > 0) {
      postClubTransaction(db, {
        clubId: account.clubId,
        date: input.date,
        category: "PLAYER_WAGES",
        direction: "DEBIT",
        amount: monthlyWages,
        description: "Monthly player payroll",
        idempotencyKey: `payroll:${input.date}`,
      });
      economy.addBudgetUsage(account.clubId, seasonLabel(input.date), "WAGE_BUDGET", monthlyWages);
    }
    const facility = economy.facilityProfile(account.clubId);
    if (facility && facility.monthlyOperatingCost > 0) {
      postClubTransaction(db, {
        clubId: account.clubId,
        date: input.date,
        category: "FACILITY_COST",
        direction: "DEBIT",
        amount: facility.monthlyOperatingCost,
        description: "Monthly facilities operating cost",
        idempotencyKey: `facility-opex:${input.date}`,
      });
    }
    const completedProjects = economy
      .infrastructureProjects(account.clubId)
      .filter((project) => project.status === "COMPLETED");
    const projectMaintenance = completedProjects.reduce(
      (total, project) => total + project.ongoingCost,
      0,
    );
    if (projectMaintenance > 0) {
      const available =
        (economy.financialAccount(account.clubId)?.cashBalance ?? 0) - reserveFloor(account);
      const funded = available >= projectMaintenance;
      postClubTransaction(db, {
        clubId: account.clubId,
        date: input.date,
        category: "FACILITY_COST",
        direction: "DEBIT",
        amount: projectMaintenance,
        description: "Infrastructure maintenance and operations",
        idempotencyKey: `project-maintenance:${input.date}`,
      });
      if (!funded && input.date.endsWith("-28")) {
        const current = economy.facilityProfile(account.clubId);
        if (current)
          economy.upsertFacilityProfile({
            ...current,
            trainingFacilityQuality: Math.max(0, current.trainingFacilityQuality - 0.08),
            youthFacilityQuality: Math.max(0, current.youthFacilityQuality - 0.08),
            medicalFacilityQuality: Math.max(0, current.medicalFacilityQuality - 0.08),
          });
        for (const project of completedProjects)
          economy.upsertInfrastructureProject({ ...project, maintenanceStatus: "DETERIORATING" });
      }
    }
    const activeSponsorships = economy
      .sponsorships(account.clubId)
      .filter(
        (item) =>
          item.status === "ACTIVE" && item.startDate <= input.date && item.endDate >= input.date,
      );
    /*
     * A club is never left with zero commercial pipeline activity — but this
     * runs for every club, including the human player's, and used to
     * silently `acceptSponsorOffer` the generated deal on the spot. That
     * skipped the negotiate/accept decision entirely: by the time the player
     * opened Sponsorship, the deal was already ACTIVE with nothing to
     * review. AI clubs get their own explicit accept in
     * runClubAiSeasonPlanning (they have no meeting screen to negotiate
     * through); this tick only needs to make sure a real, reviewable offer
     * exists — it must not decide it on the player's behalf.
     */
    const pendingSponsorOffers = economy
      .sponsorships(account.clubId)
      .filter((item) => item.status === "OFFERED" || item.status === "COUNTERED");
    // Never pile up a fresh offer every month on top of one already waiting
    // for a decision — the player (or an AI club not yet processed this
    // cycle) still has this one to act on.
    if (activeSponsorships.length < 4 && pendingSponsorOffers.length === 0) {
      generateSponsorOffers(db, {
        clubId: account.clubId,
        date: input.date,
        seed: input.seed,
        count: 1,
      });
    }
    for (const sponsorship of activeSponsorships) {
      postClubTransaction(db, {
        clubId: account.clubId,
        date: input.date,
        category: "SPONSORSHIP",
        direction: "CREDIT",
        amount: Math.round(sponsorship.annualValue / 12),
        description: "Monthly sponsorship payment",
        relatedEntityId: sponsorship.id,
        idempotencyKey: `sponsor-month:${sponsorship.id}:${input.date}`,
      });
    }
    const commercialPartnerships = network
      .activeCommercialPartnerships(account.clubId, input.date)
      .slice(0, 4);
    if (commercialPartnerships.length > 0) {
      const commercial = economy.commercialProfile(account.clubId);
      const support = economy.supporterProfile(account.clubId);
      const baseCommercialValue = commercial
        ? Math.max(
            1000,
            Math.round(
              (commercial.digitalReach * 12000 +
                commercial.merchandiseAppeal * 8000 +
                commercial.brandStrength * 5000) *
                (1 + Math.min(0.25, (support?.diasporaSupport ?? 0) / 10000)),
            ),
          )
        : 0;
      const settlement = commercialPartnerships.reduce((total, partnership) => {
        const partnerSupport = economy.supporterProfile(partnership.toClubId);
        const quality = Math.max(
          0.25,
          Math.min(
            1,
            (externalClubs.get(partnership.toClubId) ??
              (partnerSupport?.commercialReputation ?? 4) * 10) / 100,
          ),
        );
        return (
          total +
          baseCommercialValue *
            0.08 *
            (Math.max(0, Math.min(100, partnership.relationshipStrength)) / 100) *
            (0.75 + quality * 0.5)
        );
      }, 0);
      const amount = Math.min(Math.round(baseCommercialValue * 0.08), Math.round(settlement));
      if (amount > 0)
        postClubTransaction(db, {
          clubId: account.clubId,
          date: input.date,
          category: "COMMERCIAL_PARTNERSHIP_INCOME",
          direction: "CREDIT",
          amount,
          description: "Monthly commercial partnership opportunity settlement",
          relatedEntityId: commercialPartnerships[0]!.id,
          idempotencyKey: `commercial-partnership:${account.clubId}:${input.date}`,
        });
    }
    postMerchandiseRevenue(db, { clubId: account.clubId, date: input.date, seed: input.seed });
  }
  for (const item of loanWages) {
    const parentPaid = postLoanWageShare(db, {
      clubId: item.loan.parentClubId,
      date: input.date,
      amount: item.parentShare,
      description: "Loan parent wage share",
      relatedEntityId: item.loan.id,
      idempotencyKey: `loan-payroll-parent:${item.loan.id}:${input.date}`,
    });
    const destinationPaid = postLoanWageShare(db, {
      clubId: item.loan.loanClubId,
      date: input.date,
      amount: item.destinationShare,
      description: "Loan destination wage share",
      relatedEntityId: item.loan.id,
      idempotencyKey: `loan-payroll-destination:${item.loan.id}:${input.date}`,
    });
    if (parentPaid)
      economy.addBudgetUsage(
        item.loan.parentClubId,
        seasonLabel(input.date),
        "WAGE_BUDGET",
        item.parentShare,
      );
    if (destinationPaid)
      economy.addBudgetUsage(
        item.loan.loanClubId,
        seasonLabel(input.date),
        "WAGE_BUDGET",
        item.destinationShare,
      );
  }
  advanceInfrastructureProjects(db, input);
};

type LoanWageSettlement = {
  loan: PlayerLoanRecord;
  total: number;
  parentShare: number;
  destinationShare: number;
};

const activeLoanWageSettlements = (
  market: TransferMarketRepository,
  date: string,
): LoanWageSettlement[] =>
  market.activeLoans(date).map((loan) => {
    const percentage = loan.wageContributionPercent;
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      throw new Error("Loan wage contribution must be between 0 and 100");
    }
    const contract = market.activeContract(loan.playerId, date);
    if (!contract || contract.clubId !== loan.parentClubId) {
      throw new Error("Active loan is missing its parent-club contract for payroll");
    }
    const total = Math.round(contract.salary / 12);
    const destinationShare = Math.round((total * percentage) / 100);
    return {
      loan,
      total,
      destinationShare,
      parentShare: total - destinationShare,
    };
  });

const postLoanWageShare = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    date: string;
    amount: number;
    description: string;
    relatedEntityId: EntityId;
    idempotencyKey: string;
  },
): boolean => {
  const existing = db
    .prepare(
      `SELECT 1 FROM club_ledger_entries
       WHERE club_id = ? AND entry_date = ? AND category = 'PLAYER_WAGES'
         AND direction = 'DEBIT' AND related_entity_id = ? LIMIT 1`,
    )
    .get(input.clubId, input.date, input.relatedEntityId);
  postClubTransaction(db, {
    ...input,
    category: "PLAYER_WAGES",
    direction: "DEBIT",
  });
  return !existing;
};

export const generateCompetitionMediaRightsOffer = (
  db: GameDatabase,
  input: { competitionSeasonId: EntityId; date: string; seed: string },
): CompetitionMediaRights => {
  const economy = new ClubEconomyRepository(db);
  const existing = economy.mediaRights(input.competitionSeasonId)[0];
  if (existing) return existing;
  const season = db
    .prepare(
      `SELECT c.name FROM competition_seasons cs JOIN competitions c ON c.id = cs.competition_id WHERE cs.id = ?`,
    )
    .get(input.competitionSeasonId) as { name?: string } | undefined;
  const clubs = db
    .prepare(
      "SELECT club_id FROM club_memberships WHERE competition_season_id = ? AND status = 'ACTIVE'",
    )
    .all(input.competitionSeasonId) as Array<{ club_id: EntityId }>;
  const audience = clubs.reduce((total, row) => {
    const support = economy.supporterProfile(row.club_id);
    const commercial = economy.commercialProfile(row.club_id);
    return (
      total +
      (support?.coreSupporters ?? 0) +
      (support?.diasporaSupport ?? 0) * 1.4 +
      (commercial?.broadcastAppeal ?? 0) * 120
    );
  }, 0);
  const rng = new SeededRandom(`${input.seed}:media-offer:${input.competitionSeasonId}`);
  const firstClubCountry = clubs[0]
    ? (
        db.prepare("SELECT country_id FROM clubs WHERE id = ?").get(clubs[0].club_id) as
          { country_id?: EntityId } | undefined
      )?.country_id
    : undefined;
  const macro = firstClubCountry
    ? macroEconomyForCountry(db, firstClubCountry, Number(input.date.slice(0, 4)))
    : undefined;
  const annualValue = Math.min(
    4200000,
    adjustForMacro(
      280000 + audience * 90 + rng.integer(0, 180000),
      macro,
      "broadcastMarketStrength",
    ),
  );
  const rights: CompetitionMediaRights = {
    id: createStableEntityId("competition-media-rights", input.competitionSeasonId),
    competitionSeasonId: input.competitionSeasonId,
    rightsPartner: (season?.name ?? "Domestic competition").toLowerCase().includes("league")
      ? "Nepal Football Broadcast Network"
      : "Nepal Football Streaming Pool",
    annualValue,
    streamingShare: 0.35,
    currency,
    rightsType: (season?.name ?? "").toLowerCase().includes("league")
      ? "DOMESTIC_AND_STREAMING"
      : "STREAMING",
    startDate: input.date,
    endDate: addYears(input.date, 1),
    contractStatus: "OFFERED",
    exclusive: true,
    status: simulationStatus,
  };
  economy.upsertMediaRights(rights);
  return rights;
};

export const acceptCompetitionMediaRights = (
  db: GameDatabase,
  rightsId: EntityId,
  date: string,
): CompetitionMediaRights => {
  const economy = new ClubEconomyRepository(db);
  const rights = economy.mediaRights().find((item) => item.id === rightsId);
  if (!rights || rights.contractStatus !== "OFFERED")
    throw new Error("That media-rights offer is no longer available");
  const active = { ...rights, contractStatus: "ACTIVE" as const };
  economy.upsertMediaRights(active);
  const clubs = db
    .prepare(
      "SELECT club_id FROM club_memberships WHERE competition_season_id = ? AND status = 'ACTIVE' ORDER BY club_id",
    )
    .all(rights.competitionSeasonId) as Array<{ club_id: EntityId }>;
  const share = clubs.length ? Math.round(rights.annualValue / clubs.length) : 0;
  for (const club of clubs)
    postClubTransaction(db, {
      clubId: club.club_id,
      date,
      category: rights.rightsType === "STREAMING" ? "BROADCASTING" : "BROADCASTING",
      direction: "CREDIT",
      amount: share,
      description: `${rights.rightsPartner} media-rights distribution`,
      relatedEntityId: rights.id,
      idempotencyKey: `media-rights:${rights.id}:${club.club_id}`,
    });
  return active;
};

export const expireCompetitionMediaRights = (
  db: GameDatabase,
  date: string,
): CompetitionMediaRights[] => {
  const economy = new ClubEconomyRepository(db);
  const expired = economy
    .mediaRights()
    .filter(
      (rights) => rights.contractStatus === "ACTIVE" && rights.endDate && rights.endDate < date,
    );
  for (const rights of expired) economy.upsertMediaRights({ ...rights, contractStatus: "EXPIRED" });
  return expired.map((rights) => ({ ...rights, contractStatus: "EXPIRED" as const }));
};

export const postCompetitionMediaRights = (
  db: GameDatabase,
  input: { competitionSeasonId: EntityId; date: string; seed: string },
): CompetitionMediaRights => {
  const economy = new ClubEconomyRepository(db);
  const existing = economy.mediaRights(input.competitionSeasonId)[0];
  if (existing) return existing;
  const season = db
    .prepare(
      `SELECT c.name FROM competition_seasons cs JOIN competitions c ON c.id = cs.competition_id WHERE cs.id = ?`,
    )
    .get(input.competitionSeasonId) as { name?: string } | undefined;
  const name = season?.name ?? "Domestic competition";
  const annualValue = Math.round(
    (name.toLowerCase().includes("a") ? 1800000 : 900000) +
      new SeededRandom(`${input.seed}:media:${input.competitionSeasonId}`).integer(0, 400000),
  );
  const rights: CompetitionMediaRights = {
    id: createStableEntityId("competition-media-rights", input.competitionSeasonId),
    competitionSeasonId: input.competitionSeasonId,
    rightsPartner: name.toLowerCase().includes("league")
      ? "Nepal Football Broadcast Network"
      : "Nepal Football Streaming Pool",
    annualValue,
    streamingShare: 0.35,
    currency,
    rightsType: "DOMESTIC_AND_STREAMING",
    startDate: undefined,
    endDate: undefined,
    contractStatus: "ACTIVE",
    exclusive: true,
    status: simulationStatus,
  };
  economy.upsertMediaRights(rights);
  const clubs = db
    .prepare(
      "SELECT club_id FROM club_memberships WHERE competition_season_id = ? AND status = 'ACTIVE' ORDER BY club_id",
    )
    .all(input.competitionSeasonId) as Array<{ club_id: EntityId }>;
  const share = clubs.length ? Math.round(annualValue / clubs.length) : 0;
  for (const club of clubs) {
    const clubId = club.club_id;
    if (share <= 0) continue;
    postClubTransaction(db, {
      clubId,
      date: input.date,
      category: "BROADCASTING",
      direction: "CREDIT",
      amount: share,
      description: `${name} media-rights distribution`,
      relatedEntityId: rights.id,
      idempotencyKey: `media-rights:${rights.id}:${clubId}`,
    });
  }
  return rights;
};

export const postCompetitionPrizeMoney = (
  db: GameDatabase,
  input: { competitionSeasonId: EntityId; date: string },
): void => {
  const rows = db
    .prepare(
      `SELECT ranked.team_id, ranked.position, c.name AS competition_name
      FROM (
        SELECT ls.team_id,
          ROW_NUMBER() OVER (
            ORDER BY ls.points DESC, ls.goal_difference DESC, ls.goals_for DESC, ls.team_id
          ) AS position
        FROM league_standings ls
        WHERE ls.competition_season_id = ?
      ) ranked
      JOIN competition_seasons cs ON cs.id = ?
      JOIN competitions c ON c.id = cs.competition_id
      ORDER BY ranked.position`,
    )
    .all(input.competitionSeasonId, input.competitionSeasonId) as Array<{
    team_id: EntityId;
    position: number;
    competition_name: string;
  }>;
  for (const row of rows) {
    const clubId = clubIdForTeam(db, row.team_id);
    if (!clubId) continue;
    const amount = prizeAmount(row.competition_name, row.position);
    if (amount <= 0) continue;
    postClubTransaction(db, {
      clubId,
      date: input.date,
      category: "PRIZE_MONEY",
      direction: "CREDIT",
      amount,
      description: `${row.competition_name} position ${row.position} prize/distribution`,
      relatedEntityId: input.competitionSeasonId,
      idempotencyKey: `prize:${input.competitionSeasonId}:${row.position}`,
    });
  }
};

export const closeClubFinancialSeason = (
  db: GameDatabase,
  input: { seasonLabel: string; date: string },
): ClubFinancialStatement[] => {
  const economy = new ClubEconomyRepository(db);
  const statements: ClubFinancialStatement[] = [];
  for (const account of economy.financialAccounts()) {
    const entries = economy.ledgerEntries(account.clubId, input.seasonLabel);
    const revenue = categoryTotals(entries, "CREDIT");
    const expenses = categoryTotals(entries, "DEBIT");
    const revenueTotal = sumValues(revenue);
    const expenseTotal = sumValues(expenses);
    const transferProfitLoss = (revenue.TRANSFER_INCOME ?? 0) - (expenses.TRANSFER_EXPENSE ?? 0);
    const refreshed = economy.financialAccount(account.clubId) ?? account;
    const statement: ClubFinancialStatement = {
      id: createStableEntityId(
        "club-financial-statement",
        `${account.clubId}:${input.seasonLabel}`,
      ),
      clubId: account.clubId,
      seasonLabel: input.seasonLabel,
      openingCash: refreshed.cashBalance - revenueTotal + expenseTotal,
      revenueByCategory: revenue,
      expensesByCategory: expenses,
      operatingProfit: revenueTotal - expenseTotal - transferProfitLoss,
      transferProfitLoss,
      netProfitLoss: revenueTotal - expenseTotal,
      closingCash: refreshed.cashBalance,
      debt: refreshed.debtBalance,
      currency: refreshed.currency,
      closedAt: input.date,
      status: simulationStatus,
    };
    economy.upsertFinancialStatement(statement);
    economy.upsertValuation(calculateClubValuation(db, account.clubId, input.date));
    statements.push(statement);
  }
  return statements;
};

export const runEconomyDiagnostic = (input: {
  db: GameDatabase;
  seed: string;
  seasons: number;
  startDate: string;
}): EconomySimulationReport => {
  initializeClubEconomyForSave({
    db: input.db,
    worldDate: input.startDate,
    seed: input.seed,
  });
  for (let season = 0; season < input.seasons; season += 1) {
    const year = Number(input.startDate.slice(0, 4)) + season;
    for (const month of [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7]) {
      const monthYear = month >= 8 ? year : year + 1;
      processClubEconomyMonth(input.db, {
        date: `${monthYear}-${String(month).padStart(2, "0")}-28`,
        seed: `${input.seed}:diagnostic:${season}:${month}`,
      });
    }
    closeClubFinancialSeason(input.db, {
      seasonLabel: String(year + 1),
      date: `${year + 1}-07-31`,
    });
  }
  return economyReport(input.db, input.startDate, input.seasons);
};

export const runChairmanDemo = (input: {
  db: GameDatabase;
  seed: string;
  worldDate: string;
  clubId?: EntityId;
}): ChairmanDemoReport => {
  initializeClubEconomyForSave(input);
  const club = input.clubId ? clubById(input.db, input.clubId) : allClubs(input.db)[0];
  if (!club) throw new Error("No club available for chairman demo");
  if (isExternalContextClub(input.db, club.id)) {
    throw new Error("Context-only external clubs cannot be managed or owned by the player.");
  }
  const person = createDemoChairman(input.db, club, input.worldDate);
  const economy = new ClubEconomyRepository(input.db);
  economy.upsertPersonalFinancialProfile({
    personId: person.id,
    cash: 25000000,
    investments: 10000000,
    assets: 15000000,
    liabilities: 0,
    netWorth: 50000000,
    currency,
    lastUpdatedAt: input.worldDate,
    status: simulationStatus,
  });
  economy.upsertOwnershipStake({
    id: createStableEntityId("club-ownership-stake", `${club.id}:${person.id}:chairman`),
    clubId: club.id,
    holderType: "PERSON",
    holderId: person.id,
    holderName: person.displayName ?? person.fullName,
    role: "CHAIRMAN",
    percentage: ownershipModelForClub(club) === "BUYABLE" ? 51 : undefined,
    votingPercentage: ownershipModelForClub(club) === "BUYABLE" ? 51 : undefined,
    startDate: input.worldDate,
    status: "ACTIVE",
    ownershipModel: ownershipModelForClub(club),
    provenanceStatus: simulationStatus,
  });
  const before = getClubFinancialSummary(input.db, club.id);
  setClubBudget(input.db, {
    clubId: club.id,
    seasonLabel: seasonLabel(input.worldDate),
    category: "WAGE_BUDGET",
    amount: before.budgets.find((item) => item.category === "WAGE_BUDGET")?.amount ?? 5000000,
  });
  setClubBudget(input.db, {
    clubId: club.id,
    seasonLabel: seasonLabel(input.worldDate),
    category: "TRANSFER_BUDGET",
    amount: before.budgets.find((item) => item.category === "TRANSFER_BUDGET")?.amount ?? 1000000,
  });
  investPersonalFunds(input.db, {
    personId: person.id,
    clubId: club.id,
    date: input.worldDate,
    amount: 2500000,
    form: "CAPITAL_INJECTION",
  });
  const sponsor = acceptSponsorOffer(
    input.db,
    generateSponsorOffers(input.db, {
      clubId: club.id,
      date: input.worldDate,
      seed: input.seed,
      count: 1,
    })[0]!.id,
    input.worldDate,
  );
  const project = createInfrastructureProject(input.db, {
    clubId: club.id,
    projectType: "TRAINING_GROUND",
    date: input.worldDate,
    seed: input.seed,
  });
  processClubEconomyMonth(input.db, { date: addDays(input.worldDate, 31), seed: input.seed });
  const statements = closeClubFinancialSeason(input.db, {
    seasonLabel: seasonLabel(input.worldDate),
    date: addDays(input.worldDate, 330),
  });
  return {
    chairmanPersonId: person.id,
    clubId: club.id,
    before,
    afterInvestment: getClubFinancialSummary(input.db, club.id),
    acceptedSponsorId: sponsor.id,
    projectId: project.id,
    statement: statements.find((item) => item.clubId === club.id),
    permissions: chairmanPermissions(),
  };
};

const isExternalContextClub = (db: GameDatabase, clubId: EntityId): boolean =>
  Boolean(
    new GlobalFootballContextRepository(db)
      .clubs()
      .some((club) => club.clubId === clubId && club.simulationDepth === "CONTEXT_ONLY") ||
    (
      db.prepare("SELECT canonical_external_id AS value FROM clubs WHERE id = ?").get(clubId) as
        { value?: string } | undefined
    )?.value?.startsWith("SIM-FOREIGN-"),
  );

export const chairmanPermissions = (): string[] => [
  "FINANCE",
  "BUDGETS",
  "INFRASTRUCTURE",
  "EXECUTIVE_HIRING",
  "OWNERSHIP",
  "COMMERCIAL_STRATEGY",
];

const generatedClubEconomy = (
  club: Club,
  seed: string,
): {
  economicType: ClubEconomicType;
  cash: number;
  debt: number;
  equity: number;
  restrictedCashShare: number;
  scale: number;
} => {
  const rng = new SeededRandom(`${seed}:club-economy:${club.id}`);
  const economicType = economicTypeForClub(club);
  const scale =
    economicType === "DEPARTMENTAL_CLUB"
      ? 1.25
      : economicType === "FRANCHISE_CLUB"
        ? 1.45
        : economicType === "COMMUNITY_CLUB"
          ? 0.85
          : economicType === "MUNICIPALITY_BACKED"
            ? 0.95
            : 1;
  const cash = Math.round((2600000 + rng.next() * 6200000) * scale);
  const debt =
    economicType === "DEPARTMENTAL_CLUB"
      ? 0
      : rng.next() < 0.24
        ? Math.round((300000 + rng.next() * 1600000) * scale)
        : 0;
  return {
    economicType,
    cash,
    debt,
    equity: ownershipModelForClub(club) === "BUYABLE" ? Math.round(cash * (1.4 + rng.next())) : 0,
    restrictedCashShare: economicType === "DEPARTMENTAL_CLUB" ? 0.35 : 0.08 + rng.next() * 0.08,
    scale,
  };
};

const generatedBudgets = (
  club: Club,
  profile: ReturnType<typeof generatedClubEconomy>,
  worldDate: string,
): ClubBudget[] => {
  const season = seasonLabel(worldDate);
  const wage = Math.round(profile.cash * 0.95 + profile.scale * 2600000);
  const transfer = Math.round(
    profile.cash * (profile.economicType === "COMMUNITY_CLUB" ? 0.12 : 0.22),
  );
  const values: Record<ClubBudgetCategory, number> = {
    WAGE_BUDGET: wage,
    TRANSFER_BUDGET: transfer,
    STAFF_BUDGET: Math.round(wage * 0.16),
    ACADEMY_BUDGET: Math.round(wage * 0.12),
    FACILITY_BUDGET: Math.round(profile.cash * 0.16),
    SCOUTING_BUDGET: Math.round(wage * 0.06),
    MARKETING_BUDGET: Math.round(wage * 0.07),
  };
  return Object.entries(values).map(([category, amount]) => ({
    id: createStableEntityId("club-budget", `${club.id}:${season}:${category}`),
    clubId: club.id,
    seasonLabel: season,
    category: category as ClubBudgetCategory,
    amount,
    usedAmount: 0,
    currency,
    status: "ACTIVE",
    provenanceStatus: simulationStatus,
  }));
};

const generatedOwnershipStake = (club: Club, worldDate: string): ClubOwnershipStake => {
  const model = ownershipModelForClub(club);
  const holderType =
    model === "DEPARTMENTAL" || model === "STATE_CONTROLLED"
      ? "GOVERNMENT_BODY"
      : model === "COMMUNITY_CONTROLLED"
        ? "COMMUNITY"
        : club.organisationType === "FRANCHISE"
          ? "ORGANISATION"
          : "UNKNOWN";
  return {
    id: createStableEntityId("club-ownership-stake", `${club.id}:foundation`),
    clubId: club.id,
    holderType,
    holderName:
      holderType === "GOVERNMENT_BODY"
        ? (club.parentOrganisation ?? "Institutional parent")
        : holderType === "COMMUNITY"
          ? "Community members and committee"
          : holderType === "ORGANISATION"
            ? "Simulation franchise ownership group"
            : // No owner identity is on record for this club, and one must never
              // be invented. A conservative, generic SIMULATION_ONLY descriptor
              // reads naturally and claims nothing — unlike a bare "Unknown".
              "Private ownership group",
    role: holderType === "COMMUNITY" ? "PRESIDENT" : "OWNER",
    percentage: model === "BUYABLE" || model === "FRANCHISE" ? 100 : undefined,
    votingPercentage: model === "BUYABLE" || model === "FRANCHISE" ? 100 : undefined,
    startDate: worldDate,
    status: "ACTIVE",
    ownershipModel: model,
    provenanceStatus: simulationStatus,
  };
};

const generatedSupporterProfile = (
  club: Club,
  profile: ReturnType<typeof generatedClubEconomy>,
  seed: string,
): ClubSupporterProfile => {
  const rng = new SeededRandom(`${seed}:supporters:${club.id}`);
  const base = Math.round(700 + profile.scale * 850 + rng.next() * 1600);
  return {
    clubId: club.id,
    coreSupporters: base,
    casualSupporters: Math.round(base * (1.8 + rng.next() * 2.2)),
    regionalSupport: Math.round(base * (0.6 + rng.next() * 1.5)),
    diasporaSupport: Math.round(base * rng.next() * 0.45),
    activeSupport: Math.round(base * 0.12),
    familySupport: Math.round(base * 0.22),
    youthSupport: Math.round(base * 0.3),
    clubPopularity: round(3 + profile.scale * 2 + rng.next() * 3),
    footballReputation: round(3 + profile.scale * 2 + rng.next() * 3),
    commercialReputation: round(2.5 + profile.scale * 1.6 + rng.next() * 2.5),
    sentiment: "NEUTRAL",
    standardTicketPrice: Math.round((180 + rng.integer(0, 120)) * profile.scale),
    currency,
    status: simulationStatus,
  };
};

const generatedCommercialProfile = (
  club: Club,
  profile: ReturnType<typeof generatedClubEconomy>,
  seed: string,
  date: string,
): ClubCommercialProfile => {
  const rng = new SeededRandom(`${seed}:commercial:${club.id}`);
  const brandStrength = round(2.5 + profile.scale * 1.5 + rng.next() * 2.5);
  return {
    clubId: club.id,
    brandStrength,
    digitalReach: round(1.5 + brandStrength * 0.7 + rng.next() * 2),
    broadcastAppeal: round(1.5 + brandStrength * 0.6 + rng.next() * 2),
    merchandiseAppeal: round(1.5 + brandStrength * 0.65 + rng.next() * 2),
    ticketPriceElasticity: round(0.7 + rng.next() * 0.5),
    updatedOn: date,
    status: simulationStatus,
  };
};

const generatedFacilityProfile = (
  club: Club,
  profile: ReturnType<typeof generatedClubEconomy>,
  seed: string,
): ClubFacilityProfile => {
  const rng = new SeededRandom(`${seed}:facilities:${club.id}`);
  const quality = 2.5 + profile.scale * 1.4 + rng.next() * 2;
  return {
    clubId: club.id,
    trainingFacilityQuality: round(quality),
    youthFacilityQuality: round(quality - 0.2 + rng.next()),
    medicalFacilityQuality: round(quality - 0.5 + rng.next()),
    analyticsFacilityQuality: round(1.5 + profile.scale + rng.next() * 1.5),
    academyCapacity: Math.round(18 + profile.scale * 12 + rng.integer(0, 16)),
    monthlyOperatingCost: Math.round((32000 + quality * 11000) * profile.scale),
    currency,
    status: simulationStatus,
  };
};

export const generatedBoardPolicy = (club: Club, worldDate: string): ClubBoardPolicy => {
  const model = ownershipModelForClub(club);
  return {
    clubId: club.id,
    financialRiskTolerance:
      model === "DEPARTMENTAL" ? "LOW" : model === "BUYABLE" ? "BALANCED" : "LOW",
    transferPhilosophy: model === "BUYABLE" || model === "FRANCHISE" ? "BALANCED" : "CONSERVATIVE",
    youthPriority: model === "COMMUNITY_CONTROLLED" ? 0.75 : 0.55,
    commercialPriority: model === "FRANCHISE" ? 0.8 : 0.5,
    infrastructurePriority: model === "DEPARTMENTAL" ? 0.45 : 0.55,
    strategicObjective: model === "FRANCHISE" ? "COMMERCIAL_GROWTH" : "FINANCIAL_STABILITY",
    updatedAt: worldDate,
    status: simulationStatus,
  };
};

const seedSponsorPool = (db: GameDatabase, date: string, seed: string): void => {
  const economy = new ClubEconomyRepository(db);
  const names: Array<[string, string, string | undefined, "VERIFIED" | "SIMULATION_ONLY"]> = [
    ["Nabil Bank Limited", "Banking", "https://www.nabilbank.com/aboutus", "VERIFIED"],
    [
      "Nepal Telecom",
      "Telecommunications",
      "https://www.ntc.net.np/about-us/nepal-telecom-in-brief",
      "VERIFIED",
    ],
    [
      "Ncell Axiata Limited",
      "Telecommunications",
      "https://www.ncell.com.np/en/about/company-profile",
      "VERIFIED",
    ],
    [
      "Nepal Airlines Corporation",
      "Airlines",
      "https://www.nepalairlines.com.np/about",
      "VERIFIED",
    ],
    [
      "Chaudhary Group",
      "FMCG and diversified industry",
      "https://www.chaudharygroup.com/",
      "VERIFIED",
    ],
    ["Himal Local Partner", "Local services", undefined, "SIMULATION_ONLY"],
    ["Bagmati Community Foods", "Food and beverage", undefined, "SIMULATION_ONLY"],
    ["Koshi Digital", "Technology", undefined, "SIMULATION_ONLY"],
    ["Lumbini Travel Cooperative", "Travel", undefined, "SIMULATION_ONLY"],
    ["Annapurna Training Supplies", "Sports equipment", undefined, "SIMULATION_ONLY"],
    ["Kathmandu Youth Education", "Education", undefined, "SIMULATION_ONLY"],
    ["Terai Agro Markets", "Agriculture", undefined, "SIMULATION_ONLY"],
    ["Everest Health Clinics", "Healthcare", undefined, "SIMULATION_ONLY"],
  ];
  const rng = new SeededRandom(`${seed}:sponsor-pool:${date}`);
  const nepalId = nepalCountryId(db);
  for (const [name, industry, sourceUrl, identityProvenance] of names) {
    economy.upsertSponsor({
      id: createStableEntityId("sponsor-organisation", name),
      name,
      industry,
      countryId: nepalId,
      reputation: round(2.5 + rng.next() * 5.5),
      budgetTier: rng.next() > 0.78 ? "NATIONAL" : rng.next() > 0.45 ? "REGIONAL" : "LOCAL",
      status: identityProvenance,
      sourceUrl,
      identityProvenance,
    });
  }
};

const createDemoChairman = (db: GameDatabase, club: Club, date: string): Person => {
  const person: Person = {
    id: createStableEntityId("person", `chairman-demo:${club.id}`),
    fullName: `${club.shortName ?? club.name} Chairman`,
    displayName: "Chairman Demo",
    dateOfBirth: "1980-01-01",
    nationalityCountryId: club.countryId,
    genderPresentation: "unknown",
    languages: ["Nepali"],
  };
  const world = new WorldRepository(db);
  if (!world.getPerson(person.id)) {
    world.insertPerson(person);
    world.insertPersonRole({
      id: createStableEntityId("person-role", `${person.id}:CHAIRMAN`),
      personId: person.id,
      role: "CHAIRMAN",
      activeFrom: date,
    });
  }
  return person;
};

const economyReport = (
  db: GameDatabase,
  date: string,
  seasons: number,
): EconomySimulationReport => {
  const economy = new ClubEconomyRepository(db);
  const clubsById = new Map(allClubs(db).map((club) => [club.id, club]));
  const clubs = economy.financialAccounts().map((account) => {
    const entries = economy.ledgerEntries(account.clubId);
    const revenue = entries.filter((entry) => entry.direction === "CREDIT");
    const expenses = entries.filter((entry) => entry.direction === "DEBIT");
    return {
      clubId: account.clubId,
      clubName: clubsById.get(account.clubId)?.name ?? account.clubId,
      openingCash:
        account.cashBalance -
        revenue.reduce((total, entry) => total + entry.amount, 0) +
        expenses.reduce((total, entry) => total + entry.amount, 0),
      revenue: revenue.reduce((total, entry) => total + entry.amount, 0),
      expenses: expenses.reduce((total, entry) => total + entry.amount, 0),
      wages: expenses
        .filter((entry) => entry.category === "PLAYER_WAGES" || entry.category === "STAFF_WAGES")
        .reduce((total, entry) => total + entry.amount, 0),
      transfers:
        revenue
          .filter((entry) => entry.category === "TRANSFER_INCOME")
          .reduce((total, entry) => total + entry.amount, 0) -
        expenses
          .filter((entry) => entry.category === "TRANSFER_EXPENSE")
          .reduce((total, entry) => total + entry.amount, 0),
      sponsors: revenue
        .filter((entry) => entry.category === "SPONSORSHIP")
        .reduce((total, entry) => total + entry.amount, 0),
      matchday: revenue
        .filter((entry) => entry.category === "MATCHDAY_REVENUE")
        .reduce((total, entry) => total + entry.amount, 0),
      prizeMoney: revenue
        .filter((entry) => entry.category === "PRIZE_MONEY")
        .reduce((total, entry) => total + entry.amount, 0),
      profitLoss: account.seasonProfitLoss,
      closingCash: account.cashBalance,
      debt: account.debtBalance,
      financialHealth: account.financialHealth,
    };
  });
  const healthDistribution = Object.fromEntries(
    (["EXCELLENT", "HEALTHY", "STABLE", "TIGHT", "DISTRESSED", "INSOLVENT"] as const).map(
      (health) => [health, clubs.filter((club) => club.financialHealth === health).length],
    ),
  ) as Record<ClubFinancialHealth, number>;
  return {
    date,
    seasons,
    clubs,
    richestClub: [...clubs].sort((a, b) => b.closingCash - a.closingCash)[0]?.clubName,
    mostProfitable: [...clubs].sort((a, b) => b.profitLoss - a.profitLoss)[0]?.clubName,
    mostDistressed: [...clubs].sort((a, b) => a.closingCash - b.closingCash)[0]?.clubName,
    largestWageBill: [...clubs].sort((a, b) => b.wages - a.wages)[0]?.clubName,
    highestSponsorship: [...clubs].sort((a, b) => b.sponsors - a.sponsors)[0]?.clubName,
    facilityProjects: economy.infrastructureProjects().length,
    healthDistribution,
  };
};

/**
 * Every real Nepal club — deliberately excludes CONTEXT_ONLY foreign clubs
 * (external_club_context). The whole Nepal club-economy simulation
 * (financial accounts, facilities, sponsorships, board policy, valuations)
 * only ever makes sense for a club this game actually simulates in depth;
 * a foreign club is real-world context data, not a club whose finances this
 * engine models — generating NPR-currency financial/facility/sponsorship
 * rows for one would be fabricating facts about a real foreign club.
 */
const allClubs = (db: GameDatabase): Club[] =>
  db
    .prepare(
      "SELECT c.* FROM clubs c WHERE NOT EXISTS (SELECT 1 FROM external_club_context ecc WHERE ecc.club_id = c.id) ORDER BY c.name",
    )
    .all()
    .map(mapClub);

const clubById = (db: GameDatabase, clubId: EntityId): Club | undefined => {
  const row = db.prepare("SELECT * FROM clubs WHERE id = ?").get(clubId) as any;
  return row ? mapClub(row) : undefined;
};

const mapClub = (row: any): Club => ({
  id: row.id,
  name: row.name,
  officialName: row.official_name ?? undefined,
  shortName: row.short_name ?? undefined,
  nepaliName: row.nepali_name ?? undefined,
  canonicalExternalId: row.canonical_external_id ?? undefined,
  countryId: row.country_id,
  locationId: row.location_id ?? undefined,
  ownershipType: row.ownership_type,
  organisationType: row.organisation_type ?? undefined,
  parentOrganisation: row.parent_organisation ?? undefined,
  foundedYear: row.founded_year ?? undefined,
});

const clubIdForTeam = (db: GameDatabase, teamId: EntityId): EntityId | undefined =>
  (
    db.prepare("SELECT club_id FROM teams WHERE id = ?").get(teamId) as
      { club_id?: EntityId } | undefined
  )?.club_id;

const venueCapacity = (db: GameDatabase, venueId?: EntityId): number | undefined => {
  if (!venueId) return undefined;
  const row = db.prepare("SELECT capacity FROM venues WHERE id = ?").get(venueId) as any;
  return row?.capacity ?? undefined;
};

const nepalCountryId = (db: GameDatabase): EntityId | undefined =>
  (db.prepare("SELECT id FROM countries WHERE iso_code = 'NPL' LIMIT 1").get() as any)?.id;

const economicTypeForClub = (club: Club): ClubEconomicType => {
  const key = club.canonicalExternalId ?? "";
  if (club.ownershipType === "DEPARTMENTAL" || key.includes("DEP")) return "DEPARTMENTAL_CLUB";
  if (club.organisationType === "FRANCHISE" || key.startsWith("NEP-NSL")) return "FRANCHISE_CLUB";
  if (club.organisationType === "ACADEMY") return "ACADEMY_CLUB";
  if (club.ownershipType === "MUNICIPALITY_BACKED") return "MUNICIPALITY_BACKED";
  if (club.ownershipType === "PRIVATE" || club.ownershipType === "CORPORATE") return "PRIVATE_CLUB";
  if (club.ownershipType === "COMMUNITY" || club.ownershipType === "MEMBER_OWNED") {
    return "COMMUNITY_CLUB";
  }
  return "UNKNOWN";
};

const ownershipModelForClub = (club: Club): ClubOwnershipModel => {
  const type = economicTypeForClub(club);
  if (type === "DEPARTMENTAL_CLUB") return "DEPARTMENTAL";
  if (type === "FRANCHISE_CLUB") return "FRANCHISE";
  if (type === "COMMUNITY_CLUB" || type === "NON_PROFIT") return "COMMUNITY_CONTROLLED";
  if (type === "MUNICIPALITY_BACKED") return "STATE_CONTROLLED";
  if (type === "PRIVATE_CLUB") return "BUYABLE";
  return "UNKNOWN";
};

const financialHealth = (cash: number, debt: number): ClubFinancialHealth => {
  const net = cash - debt;
  if (net < 0) return "INSOLVENT";
  if (net < 500000) return "DISTRESSED";
  if (net < 1500000) return "TIGHT";
  if (net < 6000000) return "STABLE";
  if (net < 15000000) return "HEALTHY";
  return "EXCELLENT";
};

const reserveFloor = (account: ClubFinancialAccount): number =>
  account.financialHealth === "DISTRESSED" || account.financialHealth === "INSOLVENT" ? 0 : 250000;

const prizeAmount = (competitionName: string, position: number): number => {
  const base = competitionName === "ANFA National League" ? 900000 : 450000;
  if (position === 1) return base;
  if (position === 2) return Math.round(base * 0.55);
  if (position === 3) return Math.round(base * 0.3);
  return Math.round(base * 0.08);
};

const projectBaseCost = (type: InfrastructureProjectType): number => {
  switch (type) {
    case "REFURBISHMENT":
      return 2400000;
    case "STADIUM":
    case "STAND":
      return 18000000;
    case "TRAINING_GROUND":
    case "ACADEMY":
      return 5200000;
    case "MEDICAL_ROOM":
    case "RECOVERY_CENTRE":
    case "GYM":
      return 1800000;
    case "RETAIL_STORE":
      return 900000;
    default:
      return 1200000;
  }
};

const projectPrerequisites = (type: InfrastructureProjectType): InfrastructureProjectType[] => {
  if (["RECOVERY_CENTRE", "GYM"].includes(type)) return ["TRAINING_GROUND"];
  if (type === "ANALYSIS_ROOM" || type === "SCOUTING_DEPARTMENT") return ["OFFICE"];
  return [];
};

const projectComponents = (type: InfrastructureProjectType): string[] => {
  switch (type) {
    case "TRAINING_GROUND":
      return ["two_pitches", "floodlights", "changing_rooms"];
    case "ACADEMY":
      return ["youth_pitches", "classrooms", "residence"];
    case "MEDICAL_ROOM":
      return ["treatment_room", "diagnostics_suite"];
    case "RECOVERY_CENTRE":
      return ["hydrotherapy", "recovery_gym", "physio_rooms"];
    case "GYM":
      return ["strength_area", "conditioning_area"];
    case "STADIUM":
    case "STAND":
      return ["seating", "turnstiles", "safety_systems"];
    case "OFFICE":
      return ["administration", "commercial_suite"];
    case "SCOUTING_DEPARTMENT":
      return ["recruitment_workspace", "data_room"];
    case "ANALYSIS_ROOM":
      return ["video_suite", "analyst_workspace"];
    case "REFURBISHMENT":
      return ["renewed_core_components"];
    case "RETAIL_STORE":
      return ["shop_floor", "till_and_fulfilment"];
    default:
      return [type.toLowerCase()];
  }
};

const projectCapacity = (type: InfrastructureProjectType): number =>
  type === "STADIUM"
    ? 8000
    : type === "STAND"
      ? 2500
      : type === "ACADEMY"
        ? 36
        : type === "TRAINING_GROUND"
          ? 4
          : 1;

const assetTypeForProject = (type: InfrastructureProjectType): ClubAsset["assetType"] =>
  type === "STADIUM" || type === "STAND"
    ? "VENUE"
    : type === "TRAINING_GROUND" || type === "ACADEMY"
      ? "TRAINING_GROUND"
      : type === "OFFICE" || type === "RETAIL_STORE"
        ? "BUILDING"
        : "EQUIPMENT";

const categoryTotals = (
  entries: readonly ClubLedgerEntry[],
  direction: ClubLedgerDirection,
): Record<string, number> => {
  const totals: Record<string, number> = {};
  for (const entry of entries.filter((item) => item.direction === direction)) {
    totals[entry.category] = (totals[entry.category] ?? 0) + entry.amount;
  }
  return totals;
};

const sumValues = (values: Record<string, number>): number =>
  Object.values(values).reduce((total, value) => total + value, 0);

const seasonLabel = (date: string): string => date.slice(0, 4);

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const addYears = (date: string, years: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + years);
  return parsed.toISOString().slice(0, 10);
};

const round = (value: number): number => Math.round(value * 100) / 100;
