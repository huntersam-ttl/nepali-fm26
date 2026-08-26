import {
  createStableEntityId,
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
  type ClubValuation,
  type EntityId,
  type FixtureRecord,
  type InfrastructureProject,
  type InfrastructureProjectType,
  type OwnerInvestmentForm,
  type OwnerInvestmentTransaction,
  type Person,
  type SponsorshipContract,
  type SponsorshipType,
  type TransferOffer,
} from "@nepal-football-sim/shared-types";
import {
  ClubEconomyRepository,
  TransferMarketRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { SeededRandom } from "./rng.js";

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
    economy.upsertCommercialProfile(generatedCommercialProfile(club, profile, input.seed, input.worldDate));
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
      acceptSponsorOffer(input.db, offer.id, input.worldDate);
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

export const setClubTicketPrice = (db: GameDatabase, clubId: EntityId, price: number): ClubSupporterProfile => {
  const economy = new ClubEconomyRepository(db);
  const profile = economy.supporterProfile(clubId);
  if (!profile) throw new Error(`Supporter profile is not initialized for club ${clubId}`);
  const updated = { ...profile, standardTicketPrice: Math.max(1, Math.round(price)) };
  economy.upsertSupporterProfile(updated);
  return updated;
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

export const generateSponsorOffers = (
  db: GameDatabase,
  input: { clubId: EntityId; date: string; seed: string; count?: number },
): SponsorshipContract[] => {
  const economy = new ClubEconomyRepository(db);
  const sponsors = economy.sponsors();
  const supporter = economy.supporterProfile(input.clubId);
  const rng = new SeededRandom(`${input.seed}:sponsor-offers:${input.clubId}:${input.date}`);
  const count = input.count ?? 3;
  return sponsors
    .slice(0, Math.max(count, 1) * 3)
    .slice(0, count)
    .map((sponsor, index) => {
      const value =
        420000 +
        (supporter?.commercialReputation ?? 5) * 85000 +
        sponsor.reputation * 65000 +
        rng.integer(0, 180000);
      const contract: SponsorshipContract = {
        id: createStableEntityId(
          "sponsorship-contract",
          `${input.clubId}:${sponsor.id}:${input.date}`,
        ),
        clubId: input.clubId,
        sponsorId: sponsor.id,
        type: (index === 0
          ? "SHIRT_MAIN"
          : index === 1
            ? "OFFICIAL_PARTNER"
            : "LOCAL_PARTNER") as SponsorshipType,
        startDate: input.date,
        endDate: addYears(input.date, 1),
        annualValue: Math.round(value),
        bonuses: { champion: Math.round(value * 0.12), promotion: Math.round(value * 0.08) },
        currency,
        status: "OFFERED",
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
): SponsorshipContract => {
  const economy = new ClubEconomyRepository(db);
  const contract = economy.sponsorships().find((item) => item.id === sponsorshipId);
  if (!contract) throw new Error(`Sponsorship offer ${sponsorshipId} not found`);
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
  return { ...contract, status: "ACTIVE" };
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
  },
): InfrastructureProject => {
  const rng = new SeededRandom(
    `${input.seed}:project:${input.clubId}:${input.projectType}:${input.date}`,
  );
  const baseCost = projectBaseCost(input.projectType);
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
    financingJson: input.financing ?? { clubCash: 1 },
    provenanceStatus: simulationStatus,
  };
  new ClubEconomyRepository(db).upsertInfrastructureProject(project);
  return project;
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
      next = { ...next, status: "CONSTRUCTION", constructionStart: input.date };
      postClubTransaction(db, {
        clubId: project.clubId,
        date: input.date,
        category: "FACILITY_COST",
        direction: "DEBIT",
        amount: Math.round(project.capitalCost * 0.35),
        description: `${project.projectType} construction installment`,
        relatedEntityId: project.id,
        idempotencyKey: `project-start:${project.id}`,
      });
    }
    if (next.status === "CONSTRUCTION" && next.expectedCompletion <= input.date) {
      next = { ...next, status: "COMPLETED", completedAt: input.date };
      postClubTransaction(db, {
        clubId: project.clubId,
        date: input.date,
        category: "FACILITY_COST",
        direction: "DEBIT",
        amount: Math.round(project.capitalCost * 0.65),
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
        ownership: "OWNED",
        locationId: project.locationId,
        venueId: project.venueId,
        estimatedValue: Math.round(project.capitalCost * 0.8),
        currency,
        status: simulationStatus,
      });
    }
    economy.upsertInfrastructureProject(next);
    updated.push(next);
  }
  return updated;
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
  const reputationFactor = 1 + ((homeSupport?.footballReputation ?? 5) + (awaySupport?.footballReputation ?? 5)) / 100;
  const audienceFactor = 1 + ((homeSupport?.diasporaSupport ?? 0) / Math.max(1, homeSupport?.coreSupporters ?? 1)) * 0.08 + ((homeCommercial?.digitalReach ?? 0) + (awayCommercial?.digitalReach ?? 0)) / 100;
  const baseDemand =
    (homeSupport?.coreSupporters ?? 800) * 0.18 +
    (homeSupport?.casualSupporters ?? 1000) * 0.04 +
    (awaySupport?.coreSupporters ?? 600) * 0.04;
  const attendance = Math.max(
    120,
    Math.min(capacity, Math.round(baseDemand * fixtureImportance * reputationFactor * audienceFactor * (0.8 + rng.next() * 0.4))),
  );
  const ticketPrice = homeSupport?.standardTicketPrice ?? 250;
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
  return { attendance, capacity, ticketPrice, homeShare };
};

export const processClubEconomyMonth = (
  db: GameDatabase,
  input: { date: string; seed: string },
): void => {
  const economy = new ClubEconomyRepository(db);
  for (const account of economy.financialAccounts()) {
    const contracts = new TransferMarketRepository(db).activeContractsForClub(
      account.clubId,
      input.date,
    );
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
    const activeSponsorships = economy
      .sponsorships(account.clubId)
      .filter(
        (item) =>
          item.status === "ACTIVE" && item.startDate <= input.date && item.endDate >= input.date,
      );
    if (activeSponsorships.length === 0) {
      const offer = generateSponsorOffers(db, {
        clubId: account.clubId,
        date: input.date,
        seed: input.seed,
        count: 1,
      })[0];
      if (offer) {
        activeSponsorships.push(acceptSponsorOffer(db, offer.id, input.date));
      }
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
  }
  advanceInfrastructureProjects(db, input);
};

export const postCompetitionMediaRights = (
  db: GameDatabase,
  input: { competitionSeasonId: EntityId; date: string; seed: string },
): CompetitionMediaRights => {
  const economy = new ClubEconomyRepository(db);
  const existing = economy.mediaRights(input.competitionSeasonId)[0];
  if (existing) return existing;
  const season = db.prepare(`SELECT c.name FROM competition_seasons cs JOIN competitions c ON c.id = cs.competition_id WHERE cs.id = ?`).get(input.competitionSeasonId) as { name?: string } | undefined;
  const name = season?.name ?? "Domestic competition";
  const annualValue = Math.round((name.toLowerCase().includes("a") ? 1800000 : 900000) + new SeededRandom(`${input.seed}:media:${input.competitionSeasonId}`).integer(0, 400000));
  const rights: CompetitionMediaRights = {
    id: createStableEntityId("competition-media-rights", input.competitionSeasonId),
    competitionSeasonId: input.competitionSeasonId,
    rightsPartner: name.toLowerCase().includes("league") ? "Nepal Football Broadcast Network" : "Nepal Football Streaming Pool",
    annualValue,
    streamingShare: 0.35,
    currency,
    status: simulationStatus,
  };
  economy.upsertMediaRights(rights);
  const clubs = db.prepare("SELECT club_id FROM club_memberships WHERE competition_season_id = ? AND status = 'ACTIVE' ORDER BY club_id").all(input.competitionSeasonId) as Array<{ club_id: EntityId }>;
  const share = clubs.length ? Math.round(annualValue / clubs.length) : 0;
  for (const club of clubs) {
    const clubId = club.club_id;
    if (share <= 0) continue;
    postClubTransaction(db, { clubId, date: input.date, category: "BROADCASTING", direction: "CREDIT", amount: share, description: `${name} media-rights distribution`, relatedEntityId: rights.id, idempotencyKey: `media-rights:${rights.id}:${clubId}` });
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
    const entries = economy
      .ledgerEntries(account.clubId)
      .filter((entry) => entry.date.startsWith(input.seasonLabel));
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
            : "Unknown ownership group",
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

const generatedBoardPolicy = (club: Club, worldDate: string): ClubBoardPolicy => {
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
  if (economy.sponsors().length > 0) return;
  const names = [
    ["Himal Local Partner", "Local services"],
    ["Bagmati Community Foods", "Food and beverage"],
    ["Koshi Digital", "Technology"],
    ["Lumbini Travel Cooperative", "Travel"],
    ["Annapurna Training Supplies", "Sports equipment"],
    ["Kathmandu Youth Education", "Education"],
    ["Terai Agro Markets", "Agriculture"],
    ["Everest Health Clinics", "Healthcare"],
  ];
  const rng = new SeededRandom(`${seed}:sponsor-pool:${date}`);
  const nepalId = nepalCountryId(db);
  for (const [name, industry] of names) {
    economy.upsertSponsor({
      id: createStableEntityId("sponsor-organisation", name),
      name,
      industry,
      countryId: nepalId,
      reputation: round(2.5 + rng.next() * 5.5),
      budgetTier: rng.next() > 0.78 ? "NATIONAL" : rng.next() > 0.45 ? "REGIONAL" : "LOCAL",
      status: simulationStatus,
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

const allClubs = (db: GameDatabase): Club[] =>
  db.prepare("SELECT * FROM clubs ORDER BY name").all().map(mapClub);

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
    default:
      return 1200000;
  }
};

const assetTypeForProject = (type: InfrastructureProjectType): ClubAsset["assetType"] =>
  type === "STADIUM" || type === "STAND"
    ? "VENUE"
    : type === "TRAINING_GROUND" || type === "ACADEMY"
      ? "TRAINING_GROUND"
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
