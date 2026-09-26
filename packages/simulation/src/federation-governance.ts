import {
  createStableEntityId,
  type AcademySimulationProfile,
  type Club,
  type ClubLicensingAssessment,
  type CoachEducationProgramme,
  type CompetitionReformProposal,
  type CountryDevelopmentProfile,
  type EntityId,
  type Federation,
  type FederationBudget,
  type FederationAiDecision,
  type FederationBudgetCategory,
  type FederationCommitteeType,
  type FederationFinancialAccount,
  type FederationFinancialHealth,
  type FederationFinancialStatement,
  type FederationGrantDistribution,
  type FederationKPI,
  type FederationLedgerCategory,
  type FederationLedgerDirection,
  type FederationLedgerEntry,
  type FederationProject,
  type FederationProjectType,
  type FederationSimulationProfile,
  type FederationStrategicPriority,
  type NationalTeamAppearance,
  type NationalTeamCallup,
  type NationalTeamFixture,
  type Person,
  type PlayerAttributeSet,
  type RefereeDevelopmentProgramme,
  type FederationCommercialOverview,
  type PresidentCommercialPropertyView,
  type PresidentCommercialHistoryEntry,
  type EntityReference,
  type SponsorOrganisation,
  type Team,
} from "@nepal-football-sim/shared-types";
import { isSeniorTeamLevel, teamLevelAgeCap, teamLevelLabel } from "@nepal-football-sim/shared-types";
import {
  ClubEconomyRepository,
  CompetitionRepository,
  EventRepository,
  FederationComplianceRepository,
  FederationGovernanceRepository,
  MediaRightsRepository,
  WorkforceSupplyRepository,
  WorldRepository,
  CommercialRightsRepository,
  CompetitionCommercialRepository,
  NationalTeamCommercialRepository,
  YouthRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { postClubTransaction } from "./club-economy.js";
import { buildAiTacticalSetup, resolveTeamTacticalSetup } from "./ai-tactics.js";
import { simulateMatch } from "./match-engine.js";
import { PLAYABLE_CLUB_PREDICATE } from "./playable-world.js";
import { SeededRandom } from "./rng.js";
import { buildEntityReference } from "./entity-reference.js";
import { nationalTeamOutcomes } from "./national-team-workspace.js";
import { homeCountryPack, homeCurrency, homeFederation, homeFederationAbbreviation, homeFootballContext, homeNamePool, seasonEndDate } from "./home-context.js";
import { countryEconomicProfile, scaleAmount, scalePrice } from "./economic-profile.js";
import { ensureNationalTeamRows } from "./national-team-identity.js";
import { recordFederationDevelopmentSnapshot } from "./federation-scorecard.js";

const simulationStatus = "SIMULATION_ONLY" as const;

export type FederationOverview = {
  federation: Federation;
  profile: FederationSimulationProfile;
  account: FederationFinancialAccount;
  budgets: FederationBudget[];
  committees: ReturnType<FederationGovernanceRepository["committees"]>;
  strategy: ReturnType<FederationGovernanceRepository["strategyPriorities"]>;
  projects: FederationProject[];
  kpis: FederationKPI[];
};

export type FederationDiagnosticReport = {
  date: string;
  seasons: number;
  federationName: string;
  cashBalance: number;
  financialHealth: FederationFinancialHealth;
  ledgerEntries: number;
  statements: number;
  projects: number;
  completedProjects: number;
  clubGrants: number;
  nationalTeamFixtures: number;
  nationalTeamWins: number;
  callups: number;
  coachGraduates: number;
  refereesAdvanced: number;
  reforms: number;
  licensingAssessments: number;
  youthEnvironment: CountryDevelopmentProfile | undefined;
  kpis: FederationKPI[];
};

export type PresidentDemoReport = {
  presidentPersonId: EntityId;
  federationId: EntityId;
  beforeCash: number;
  afterCash: number;
  projectId: EntityId;
  reformId: EntityId;
  nationalTeamCoachId: EntityId;
  friendlyId: EntityId;
  callups: number;
  kpis: FederationKPI[];
  permissions: string[];
};

export const initializeFederationGovernanceForSave = (input: {
  db: GameDatabase;
  worldDate: string;
  seed: string;
}): void => {
  seedFederationSponsors(input.db, input.worldDate, input.seed);
  const repo = new FederationGovernanceRepository(input.db);
  for (const federation of allFederations(input.db)) {
    if (!repo.profile(federation.id)) {
      const profile = generatedFederationProfile(federation, input.worldDate, input.seed);
      repo.upsertProfile(profile);
      const cash = scalePrice(input.db, Math.round(12500000 + seeded(input.seed, federation.id).next() * 5500000));
      repo.upsertFinancialAccount({
        federationId: federation.id,
        currency: homeCurrency(input.db),
        cashBalance: cash,
        restrictedFunds: Math.round(cash * 0.32),
        receivables: 0,
        payables: 0,
        debt: 0,
        seasonRevenue: 0,
        seasonExpenses: 0,
        seasonProfitLoss: 0,
        financialHealth: federationFinancialHealth(cash, 0, countryEconomicProfile(input.db).priceLevel),
        lastUpdatedAt: input.worldDate,
        status: simulationStatus,
      });
    }
    ensureNationalTeamRows(input.db, federation.id);
    ensureFederationBudgets(input.db, federation.id, input.worldDate);
    ensureCommittees(input.db, federation.id);
    ensureStrategy(input.db, federation.id, input.worldDate);
    ensureRelationships(input.db, federation.id, input.worldDate);
    ensureObjectives(input.db, federation.id, input.worldDate);
    ensureFederationSponsorship(input.db, federation.id, input.worldDate, input.seed);
    applyDevelopmentEnvironmentFromFederation(input.db, federation.id, input.worldDate, input.seed);
  }
};

export const getFederationOverview = (
  db: GameDatabase,
  federationId = homeFederation(db).id,
): FederationOverview => {
  const repo = new FederationGovernanceRepository(db);
  const federation = federationById(db, federationId);
  const profile = repo.profile(federationId);
  const account = repo.financialAccount(federationId);
  if (!profile || !account) {
    throw new Error(`Federation governance is not initialized for ${federationId}`);
  }
  return {
    federation,
    profile,
    account,
    budgets: repo.budgets(federationId),
    committees: repo.committees(federationId),
    strategy: repo.strategyPriorities(federationId),
    projects: repo.projects(federationId),
    kpis: repo.kpis(federationId),
  };
};

export const getFederationFinances = (
  db: GameDatabase,
  federationId = homeFederation(db).id,
): {
  account: FederationFinancialAccount;
  ledgerEntries: FederationLedgerEntry[];
  budgets: FederationBudget[];
  statements: FederationFinancialStatement[];
} => {
  const repo = new FederationGovernanceRepository(db);
  const account = repo.financialAccount(federationId);
  if (!account) throw new Error(`Federation account missing for ${federationId}`);
  return {
    account,
    ledgerEntries: repo.ledgerEntries(federationId),
    budgets: repo.budgets(federationId),
    statements: repo.financialStatements(federationId),
  };
};

export const postFederationTransaction = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    date: string;
    category: FederationLedgerCategory;
    direction: FederationLedgerDirection;
    amount: number;
    description: string;
    relatedEntityId?: EntityId;
    restrictionTag?: string;
    idempotencyKey?: string;
  },
): FederationLedgerEntry => {
  const entry: FederationLedgerEntry = {
    id: createStableEntityId(
      "federation-ledger-entry",
      `${input.federationId}:${input.date}:${input.category}:${input.direction}:${input.idempotencyKey ?? input.description}`,
    ),
    federationId: input.federationId,
    date: input.date,
    category: input.category,
    direction: input.direction,
    amount: Math.max(0, Math.round(input.amount)),
    currency: homeCurrency(db),
    description: input.description,
    relatedEntityId: input.relatedEntityId,
    restrictionTag: input.restrictionTag,
    status: simulationStatus,
  };
  new FederationGovernanceRepository(db).postLedgerEntry(entry);
  return entry;
};

export const setFederationBudget = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    seasonLabel: string;
    category: FederationBudgetCategory;
    amount: number;
  },
): FederationBudget => {
  const repo = new FederationGovernanceRepository(db);
  const previous = repo
    .budgets(input.federationId)
    .find(
      (budget) => budget.seasonLabel === input.seasonLabel && budget.category === input.category,
    );
  const budget: FederationBudget = {
    id: createStableEntityId(
      "federation-budget",
      `${input.federationId}:${input.seasonLabel}:${input.category}`,
    ),
    federationId: input.federationId,
    seasonLabel: input.seasonLabel,
    category: input.category,
    amount: Math.round(input.amount),
    usedAmount: previous?.usedAmount ?? 0,
    currency: homeCurrency(db),
    status: "ACTIVE",
    provenanceStatus: simulationStatus,
  };
  repo.upsertBudget(budget);
  return budget;
};

export const receiveFederationGrant = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    date: string;
    source: "FIFA_GRANT" | "AFC_GRANT" | "GOVERNMENT_GRANT";
    amount: number;
    restrictionTag?: string;
  },
): FederationLedgerEntry =>
  postFederationTransaction(db, {
    federationId: input.federationId,
    date: input.date,
    category: input.source,
    direction: "CREDIT",
    amount: input.amount,
    description: `${input.source.replaceAll("_", " ").toLowerCase()} received`,
    restrictionTag: input.restrictionTag,
    idempotencyKey: `${input.source}:${input.restrictionTag ?? "unrestricted"}`,
  });

export const distributeClubGrant = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    clubId: EntityId;
    date: string;
    amount: number;
    grantType: FederationGrantDistribution["grantType"];
  },
): FederationGrantDistribution => {
  const repository = new FederationGovernanceRepository(db);
  const grantId = createStableEntityId(
    "federation-grant-distribution",
    `${input.federationId}:${input.clubId}:${input.date}:${input.grantType}`,
  );
  const existing = repository
    .grantDistributions(input.federationId)
    .find((grant) => grant.id === grantId);
  if (existing) return existing;
  const account = repository.financialAccount(input.federationId);
  if (!account) throw new Error(`Federation account missing for ${input.federationId}`);
  if (account.cashBalance - input.amount < reserveFloor(account)) {
    throw new Error("Federation cannot distribute a club grant beyond available cash reserve");
  }
  const fedEntry = postFederationTransaction(db, {
    federationId: input.federationId,
    date: input.date,
    category: "CLUB_GRANTS",
    direction: "DEBIT",
    amount: input.amount,
    description: `${input.grantType} paid to club`,
    relatedEntityId: input.clubId,
    idempotencyKey: `${input.clubId}:${input.date}:${input.grantType}`,
  });
  const clubEntry = postClubTransaction(db, {
    clubId: input.clubId,
    date: input.date,
    category: "GRANT",
    direction: "CREDIT",
    amount: input.amount,
    description: `${input.grantType} from federation`,
    relatedEntityId: input.federationId,
    idempotencyKey: `${input.federationId}:${input.clubId}:${input.date}:${input.grantType}`,
  });
  repository.addBudgetUsage(
    input.federationId,
    seasonLabel(input.date),
    "CLUB_SUPPORT",
    input.amount,
  );
  const grant: FederationGrantDistribution = {
    id: grantId,
    federationId: input.federationId,
    clubId: input.clubId,
    date: input.date,
    grantType: input.grantType,
    amount: Math.round(input.amount),
    currency: homeCurrency(db),
    federationLedgerEntryId: fedEntry.id,
    clubLedgerEntryId: clubEntry.id,
    status: "POSTED",
    provenanceStatus: simulationStatus,
  };
  repository.insertGrantDistribution(grant);
  return grant;
};

/** Pays a bounded annual support round to playable, active domestic clubs. */
export const distributeEligibleClubGrants = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    date: string;
    amount: number;
    grantType: FederationGrantDistribution["grantType"];
    maxRecipients?: number;
  },
): FederationGrantDistribution[] => {
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    throw new Error("Club grant amount must be positive");
  const limit = Math.max(1, Math.floor(input.maxRecipients ?? 4));
  const candidates = db
    .prepare(
      `SELECT c.id
       FROM clubs c
       WHERE ${PLAYABLE_CLUB_PREDICATE}
         AND EXISTS (SELECT 1 FROM club_memberships cm WHERE cm.club_id = c.id AND cm.status = 'ACTIVE')
         AND EXISTS (SELECT 1 FROM club_financial_accounts cfa WHERE cfa.club_id = c.id)
       ORDER BY c.id
       LIMIT ?`,
    )
    .all(limit) as Array<{ id: EntityId }>;
  const account = new FederationGovernanceRepository(db).financialAccount(input.federationId);
  const available = account
    ? Math.max(
        0,
        Math.floor((account.cashBalance - reserveFloor(account)) / Math.round(input.amount)),
      )
    : 0;
  return candidates
    .slice(0, available)
    .map((candidate) => distributeClubGrant(db, { ...input, clubId: candidate.id }));
};

export const createFederationProject = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    projectType: FederationProjectType;
    name: string;
    date: string;
    seed: string;
    locationId?: EntityId;
    targetProvinceId?: EntityId;
    targetDistrictId?: EntityId;
    academyId?: EntityId;
    ownership?: FederationProject["ownership"];
    siteRights?: FederationProject["siteRights"];
    funding?: Record<string, number>;
  },
): FederationProject => {
  const rng = seeded(input.seed, `${input.federationId}:${input.projectType}:${input.date}`);
  const capitalCost = projectCost(input.projectType, rng);
  const fundingJson = input.funding ?? { federationCash: 0.7, restrictedGrant: 0.3 };
  const fundingTotal = Object.values(fundingJson).reduce((total, value) => total + Math.max(0, value), 0);
  const ownership = input.ownership ?? (input.projectType === "REGIONAL_CENTRE" ? "SHARED" : "FEDERATION");
  const siteRights = input.siteRights ?? (ownership === "STATE" || ownership === "SHARED" ? "LEASED" : "OWNED");
  const project: FederationProject = {
    id: createStableEntityId(
      "federation-project",
      `${input.federationId}:${input.projectType}:${input.date}:${input.name}`,
    ),
    federationId: input.federationId,
    projectType: input.projectType,
    name: input.name,
    locationId: input.locationId,
    targetProvinceId: input.targetProvinceId,
    targetDistrictId: input.targetDistrictId,
    academyId: input.academyId,
    startDate: input.date,
    expectedCompletion: addDays(input.date, 180 + rng.integer(0, 240)),
    capitalCost,
    annualOperatingCost: Math.round(capitalCost * 0.035),
    currency: homeCurrency(db),
    status: "PLANNING",
    impactJson: projectImpact(input.projectType),
    fundingJson,
    ownership,
    siteRights,
    components: federationProjectComponents(input.projectType),
    utilisationJson: federationProjectUtilisation(input.projectType),
    maintenanceStatus: "FUNDED",
    delayDays: 0,
    fundingStatus: fundingTotal >= 1 ? "FUNDED" : fundingTotal > 0 ? "PARTIALLY_FUNDED" : "UNFUNDED",
    provenanceStatus: simulationStatus,
  };
  new FederationGovernanceRepository(db).upsertProject(project);
  return project;
};

export const advanceFederationProjects = (
  db: GameDatabase,
  input: { federationId?: EntityId; date: string; seed: string },
): FederationProject[] => {
  const repo = new FederationGovernanceRepository(db);
  const updated: FederationProject[] = [];
  for (const project of repo.projects(input.federationId)) {
    if (project.status === "COMPLETED" || project.status === "CANCELLED") continue;
    let next = project;
    if (project.status === "PLANNING" && project.startDate <= addDays(input.date, -45)) {
      next = { ...next, status: "FINANCING" };
      postFederationTransaction(db, {
        federationId: project.federationId,
        date: input.date,
        category: "INFRASTRUCTURE",
        direction: "DEBIT",
        amount: Math.round(project.capitalCost * 0.2),
        description: `${project.name} planning and financing installment`,
        relatedEntityId: project.id,
        idempotencyKey: `project-financing:${project.id}`,
      });
      repo.addBudgetUsage(
        project.federationId,
        seasonLabel(input.date),
        "INFRASTRUCTURE",
        Math.round(project.capitalCost * 0.2),
      );
    } else if (project.status === "FINANCING" && project.startDate <= addDays(input.date, -120)) {
      if (project.fundingStatus !== "FUNDED") {
        repo.upsertProject({ ...project, status: "FINANCING", maintenanceStatus: "UNDERFUNDED" });
        updated.push({ ...project, status: "FINANCING", maintenanceStatus: "UNDERFUNDED" });
        continue;
      }
      const risk = seeded(input.seed, `${project.id}:construction-risk`);
      const delayDays = risk.integer(0, project.projectType === "NATIONAL_TRAINING_CENTRE" ? 120 : 60);
      next = {
        ...next,
        status:
          project.projectType === "NATIONAL_TRAINING_CENTRE" ? "CONSTRUCTION" : "IMPLEMENTATION",
        expectedCompletion: addDays(project.expectedCompletion, delayDays),
        delayDays,
        capitalCost: Math.round(project.capitalCost * (1 + risk.next() * 0.15)),
      };
      postFederationTransaction(db, {
        federationId: project.federationId,
        date: input.date,
        category:
          project.projectType === "NATIONAL_TRAINING_CENTRE"
            ? "INFRASTRUCTURE"
            : projectLedgerCategory(project.projectType),
        direction: "DEBIT",
        amount: Math.round(project.capitalCost * 0.45),
        description: `${project.name} implementation installment`,
        relatedEntityId: project.id,
        idempotencyKey: `project-implement:${project.id}`,
      });
    } else if (
      (project.status === "CONSTRUCTION" || project.status === "IMPLEMENTATION") &&
      project.expectedCompletion <= input.date
    ) {
      next = { ...next, status: "COMPLETED", completedAt: input.date };
      postFederationTransaction(db, {
        federationId: project.federationId,
        date: input.date,
        category: projectLedgerCategory(project.projectType),
        direction: "DEBIT",
        amount: Math.round(project.capitalCost * 0.35),
        description: `${project.name} completion installment`,
        relatedEntityId: project.id,
        idempotencyKey: `project-complete:${project.id}`,
      });
      repo.upsertAsset({
        id: createStableEntityId("federation-asset", `${project.federationId}:${project.id}`),
        federationId: project.federationId,
        assetType:
          project.projectType === "NATIONAL_TRAINING_CENTRE" ||
          project.projectType === "REGIONAL_CENTRE"
            ? "TRAINING_CENTRE"
            : project.projectType === "ACADEMY_EXPANSION"
              ? "ACADEMY_FACILITY"
              : "EQUIPMENT",
        ownership: project.ownership === "STATE" ? "OPERATED" : project.ownership === "SHARED" ? "OPERATED" : "OWNED",
        locationId: project.locationId,
        academyId: project.academyId,
        estimatedValue: Math.round(project.capitalCost * 0.8),
        currency: homeCurrency(db),
        status: simulationStatus,
      });
      applyProjectImpact(db, next, input.date);
    }
    repo.upsertProject(next);
    updated.push(next);
  }
  return updated;
};

export const fundFederationProject = (
  db: GameDatabase,
  input: { projectId: EntityId; date: string; source: string; amount: number },
): FederationProject => {
  const repo = new FederationGovernanceRepository(db);
  const project = repo.projects().find((item) => item.id === input.projectId);
  if (!project) throw new Error(`Federation project ${input.projectId} not found`);
  if (project.status === "COMPLETED" || project.status === "CANCELLED") {
    throw new Error(`Federation project ${input.projectId} is not fundable`);
  }
  const amount = Math.max(0, Math.round(input.amount));
  if (amount > 0 && input.source !== "federationCash") {
    const category: FederationLedgerCategory = input.source === "FIFA_GRANT" ? "FIFA_GRANT" : input.source === "AFC_GRANT" ? "AFC_GRANT" : "GOVERNMENT_GRANT";
    postFederationTransaction(db, {
      federationId: project.federationId, date: input.date, category, direction: "CREDIT", amount,
      description: `${input.source} funding for ${project.name}`, relatedEntityId: project.id,
      idempotencyKey: `project-funding:${project.id}:${input.source}:${input.date}`,
    });
  }
  const fundingJson = { ...project.fundingJson, [input.source]: (project.fundingJson[input.source] ?? 0) + amount };
  const committed = sumValues(fundingJson);
  const fundingStatus: FederationProject["fundingStatus"] = committed >= project.capitalCost ? "FUNDED" : committed > 0 ? "PARTIALLY_FUNDED" : "UNFUNDED";
  const next = { ...project, fundingJson, fundingStatus };
  repo.upsertProject(next);
  return next;
};

export const proposeCompetitionReform = (
  db: GameDatabase,
  input: Omit<CompetitionReformProposal, "id" | "status" | "provenanceStatus"> & {
    status?: CompetitionReformProposal["status"];
  },
): CompetitionReformProposal => {
  const reform: CompetitionReformProposal = {
    ...input,
    id: createStableEntityId(
      "competition-reform",
      `${input.federationId}:${input.competitionId}:${input.effectiveSeason}:${JSON.stringify(input.changes)}`,
    ),
    status: input.status ?? "PROPOSED",
    provenanceStatus: simulationStatus,
  };
  new FederationGovernanceRepository(db).upsertCompetitionReform(reform);
  return reform;
};

export const applyCompetitionReform = (
  db: GameDatabase,
  proposalId: EntityId,
  decidedAt: string,
): CompetitionReformProposal => {
  const repo = new FederationGovernanceRepository(db);
  const proposal = repo.competitionReforms().find((item) => item.id === proposalId);
  if (!proposal) throw new Error(`Competition reform ${proposalId} not found`);
  const seasons = db
    .prepare(
      `SELECT * FROM competition_seasons
      WHERE competition_id = ? AND substr(start_date, 1, 4) >= ?
      ORDER BY start_date`,
    )
    .all(proposal.competitionId, proposal.effectiveSeason) as Array<any>;
  const competitions = new CompetitionRepository(db);
  for (const season of seasons) {
    if (seasonHasHistoricalMatches(db, season.id)) continue;
    // Rule sets are immutable once a season has started; apply only at a future boundary.
    if (season.start_date <= decidedAt) continue;
    const rule = competitions.getRuleSet(season.id);
    if (!rule) continue;
    competitions.insertRuleSet({
      ...rule,
      id: rule.id,
      competitionType: proposal.changes.format ?? rule.competitionType,
      numberOfRounds: proposal.changes.rounds ?? rule.numberOfRounds,
      promotionSlots: proposal.changes.promotionSlots ?? rule.promotionSlots,
      relegationSlots: proposal.changes.relegationSlots ?? rule.relegationSlots,
      seasonStartDate: proposal.changes.calendar?.startDate ?? rule.seasonStartDate,
      seasonEndDate: proposal.changes.calendar?.endDate ?? rule.seasonEndDate,
      specialRules: {
        ...(rule.specialRules ?? {}),
        temporaryExpandedLeague: proposal.changes.teamCount
          ? proposal.changes.teamCount > currentMembershipCount(db, season.id)
          : rule.specialRules?.temporaryExpandedLeague,
      },
    });
  }
  const applied: CompetitionReformProposal = {
    ...proposal,
    status: "IMPLEMENTED",
    decidedAt,
  };
  repo.upsertCompetitionReform(applied);
  return applied;
};

export const assessClubLicensing = (
  db: GameDatabase,
  input: { federationId: EntityId; seasonLabel: string; date: string },
): ClubLicensingAssessment[] => {
  const repo = new FederationGovernanceRepository(db);
  const assessments = allClubs(db).map((club) => {
    const economy = new ClubEconomyRepository(db).financialAccount(club.id);
    const financial =
      !economy || economy.financialHealth === "INSOLVENT"
        ? "CONDITIONAL"
        : economy.financialHealth === "DISTRESSED"
          ? "CONDITIONAL"
          : "LICENSED";
    const youth = club.organisationType === "ACADEMY" ? "EXEMPT" : "CONDITIONAL";
    const overall = financial === "LICENSED" ? "CONDITIONAL" : financial;
    const assessment: ClubLicensingAssessment = {
      id: createStableEntityId(
        "club-licensing",
        `${input.federationId}:${club.id}:${input.seasonLabel}`,
      ),
      federationId: input.federationId,
      clubId: club.id,
      seasonLabel: input.seasonLabel,
      financial,
      stadium: "UNKNOWN",
      youth,
      medical: "UNKNOWN",
      administrative: "CONDITIONAL",
      coaching: "CONDITIONAL",
      legal: "UNKNOWN",
      overall,
      assessedAt: input.date,
      status: simulationStatus,
    };
    repo.upsertClubLicensingAssessment(assessment);
    return assessment;
  });
  return assessments;
};

export const appointNationalTeamStaff = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    nationalTeamId: EntityId;
    personId?: EntityId;
    date: string;
    seed: string;
  },
): Person => {
  const world = new WorldRepository(db);
  const federation = federationById(db, input.federationId);
  const countryId = federation.countryId;
  const person: Person =
    input.personId && world.getPerson(input.personId)
      ? world.getPerson(input.personId)!
      : {
          id: createStableEntityId(
            "person",
            `national-team-coach:${input.federationId}:${input.date}`,
          ),
          fullName: "Simulation National Team Head Coach",
          displayName: "National Coach",
          dateOfBirth: "1978-01-01",
          nationalityCountryId: countryId,
          genderPresentation: "unknown",
          languages: [...homeNamePool(db).languageNames],
        };
  if (!world.getPerson(person.id)) {
    world.insertPerson(person);
    world.insertPersonRole({
      id: createStableEntityId("person-role", `${person.id}:STAFF`),
      personId: person.id,
      role: "STAFF",
      activeFrom: input.date,
    });
  }
  world.insertStaffAppointment({
    id: createStableEntityId(
      "staff-appointment",
      `${person.id}:${input.nationalTeamId}:head-coach:${input.date}`,
    ),
    personId: person.id,
    organisationType: "NATIONAL_TEAM",
    teamId: input.nationalTeamId,
    federationId: input.federationId,
    role: "NATIONAL_TEAM_HEAD_COACH",
    startDate: input.date,
    employmentStatus: "ACTIVE",
  });
  return person;
};

export const selectNationalTeamSquad = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    nationalTeamId?: EntityId;
    date: string;
    programme: string;
    seed: string;
    size?: number;
  },
): NationalTeamCallup[] => {
  const team = input.nationalTeamId
    ? teamById(db, input.nationalTeamId)
    : seniorMenNationalTeam(db, input.federationId);
  if (!nationalTeamParticipationAllowed(db, input.federationId)) return [];
  const federation = federationById(db, input.federationId);
  const players = eligiblePlayerAttributes(
    db,
    federation.countryId,
    input.federationId,
    input.date,
    team,
  );
  const selected = balancedSelection(players, input.size ?? 23);
  const repo = new FederationGovernanceRepository(db);
  const alreadyCappedPlayerIds = new Set(
    repo.nationalTeamCallups(team.id).map((existing) => existing.playerId),
  );
  const programmeLabel =
    team.gender === "women" ? "Women & Girls" : isSeniorTeamLevel(team.level) ? "Senior Men" : teamLevelLabel(team.level);
  const callups = selected.map((player) => {
    const callup: NationalTeamCallup = {
      id: createStableEntityId(
        "national-team-callup",
        `${team.id}:${player.personId}:${input.date}:${input.programme}`,
      ),
      nationalTeamId: team.id,
      playerId: player.personId,
      callupDate: input.date,
      programme: input.programme,
      squadType: "FINAL",
      status: "CALLED_UP",
      provenanceStatus: simulationStatus,
    };
    repo.upsertNationalTeamCallup(callup);
    // A story only for a player's first-ever call-up to this team — every
    // subsequent monthly re-selection is routine squad news, not a headline.
    if (!alreadyCappedPlayerIds.has(player.personId)) {
      alreadyCappedPlayerIds.add(player.personId);
      const eventId = createStableEntityId("history", `NATIONAL_TEAM_CALLUP:${team.id}:${player.personId}`);
      if (!db.prepare("SELECT 1 FROM historical_events WHERE id=?").get(eventId)) {
        const playerName =
          (db.prepare("SELECT full_name FROM persons WHERE id=?").get(player.personId) as { full_name?: string } | undefined)
            ?.full_name ?? "A player";
        new EventRepository(db).insertHistoricalEvent({
          id: eventId,
          occurredOn: input.date,
          eventType: "NATIONAL_TEAM_CALLUP",
          // The federation itself has to be an involved entity: event routing
          // delivers a federation-scope story to the President by matching a
          // federation id, so without this a call-up was published but never
          // reached anyone's inbox.
          involvedEntities: [
            ...(team.federationId ? [{ id: team.federationId, type: "federation" as const }] : []),
            { id: team.id, type: "team" },
            { id: player.personId, type: "person" },
          ],
          title: `${homeFootballContext(db).countryName} call up ${playerName} for ${programmeLabel}`,
          data: { teamId: team.id, playerId: player.personId, programme: programmeLabel, federationId: team.federationId },
          importance: "medium",
          scope: "federation",
        });
      }
    }
    return callup;
  });
  return callups;
};

/** A federation-wide participation sanction applies to every national-team category. */
export const nationalTeamParticipationAllowed = (
  db: GameDatabase,
  federationId: EntityId,
): boolean =>
  !new FederationComplianceRepository(db)
    .activeSanctionsForFederation(federationId)
    .some((sanction) => sanction.consequences.includes("NATIONAL_TEAM_PARTICIPATION_BLOCKED"));

export const scheduleFriendly = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    nationalTeamId?: EntityId;
    opponentName: string;
    date: string;
    seed: string;
  },
): NationalTeamFixture => {
  const team = input.nationalTeamId
    ? teamById(db, input.nationalTeamId)
    : seniorMenNationalTeam(db, input.federationId);
  const rng = seeded(input.seed, `${input.opponentName}:${input.date}`);
  const participationAllowed = nationalTeamParticipationAllowed(db, input.federationId);
  const fixture: NationalTeamFixture = {
    id: createStableEntityId(
      "national-team-fixture",
      `${team.id}:${input.opponentName}:${input.date}`,
    ),
    federationId: input.federationId,
    nationalTeamId: team.id,
    opponentName: input.opponentName,
    fixtureDate: input.date,
    fixtureType: "FRIENDLY",
    status: participationAllowed ? "SCHEDULED" : "CANCELLED",
    estimatedCost: Math.round(850000 + rng.next() * 350000),
    estimatedRevenue: Math.round(550000 + rng.next() * 500000),
    currency: homeCurrency(db),
    provenanceStatus: simulationStatus,
  };
  new FederationGovernanceRepository(db).upsertNationalTeamFixture(fixture);
  return fixture;
};

export const playNationalTeamFixture = (
  db: GameDatabase,
  fixtureId: EntityId,
  seed: string,
): NationalTeamFixture => {
  const repo = new FederationGovernanceRepository(db);
  const fixture = repo.nationalTeamFixtures().find((item) => item.id === fixtureId);
  if (!fixture) throw new Error(`National team fixture ${fixtureId} not found`);
  if (fixture.status === "PLAYED" || fixture.status === "CANCELLED") return fixture;
  if (!nationalTeamParticipationAllowed(db, fixture.federationId)) {
    const cancelled = { ...fixture, status: "CANCELLED" as const };
    repo.upsertNationalTeamFixture(cancelled);
    return cancelled;
  }
  const callups = repo
    .nationalTeamCallups(fixture.nationalTeamId)
    .filter((item) => item.callupDate <= fixture.fixtureDate && item.status === "CALLED_UP")
    .slice(-23);
  const players = allPlayerAttributes(db).filter((player) =>
    callups.some((callup) => callup.playerId === player.personId),
  );
  const opponent = generatedOpponentPlayers(fixture, seed);
  const opponentTeamId = createStableEntityId("team", `opponent:${fixture.opponentName}`);
  // National teams are real `teams` rows (national_team_id references teams),
  // so the home side gets the same persisted, manager-aware tactical resolver
  // every club uses. The generated opponent has no real team row to persist
  // against, so it gets a deterministic, unpersisted identity from the same
  // AI tactics module instead of a fixed default — never tactics-blind.
  const homeTacticalSetup = resolveTeamTacticalSetup(db, fixture.nationalTeamId, players);
  const awayTacticalSetup = buildAiTacticalSetup(opponentTeamId, opponent);
  const result = simulateMatch({
    fixture: {
      id: createStableEntityId("fixture", `national:${fixture.id}`),
      competitionSeasonId: undefined,
      homeTeamId: fixture.nationalTeamId,
      awayTeamId: opponentTeamId,
      scheduledDate: fixture.fixtureDate,
      status: "scheduled",
      round: 1,
    },
    homePlayers: players,
    awayPlayers: opponent,
    homeTacticalSetup,
    awayTacticalSetup,
    seed: `${seed}:national-match:${fixture.id}`,
  });
  const played: NationalTeamFixture = {
    ...fixture,
    status: "PLAYED",
    homeGoals: result.match.homeGoals ?? 0,
    awayGoals: result.match.awayGoals ?? 0,
  };
  repo.upsertNationalTeamFixture(played);
  postFederationTransaction(db, {
    federationId: fixture.federationId,
    date: fixture.fixtureDate,
    category: "MATCH_REVENUE",
    direction: "CREDIT",
    amount: fixture.estimatedRevenue,
    description: `National team friendly revenue vs ${fixture.opponentName}`,
    relatedEntityId: fixture.id,
    idempotencyKey: `national-revenue:${fixture.id}`,
  });
  postFederationTransaction(db, {
    federationId: fixture.federationId,
    date: fixture.fixtureDate,
    category: "NATIONAL_TEAM_COST",
    direction: "DEBIT",
    amount: fixture.estimatedCost,
    description: `National team friendly costs vs ${fixture.opponentName}`,
    relatedEntityId: fixture.id,
    idempotencyKey: `national-cost:${fixture.id}`,
  });
  const canonicalPersonIds = new Set(
    (db.prepare("SELECT id FROM persons").all() as Array<{ id: EntityId }>).map((row) => row.id),
  );
  for (const state of result.playerStates.filter(
    (state) => state.teamId === fixture.nationalTeamId && canonicalPersonIds.has(state.personId),
  )) {
    const appearance: NationalTeamAppearance = {
      id: createStableEntityId("national-team-appearance", `${fixture.id}:${state.personId}`),
      nationalTeamId: fixture.nationalTeamId,
      playerId: state.personId,
      matchDate: fixture.fixtureDate,
      opponentName: fixture.opponentName,
      minutes: state.minutesPlayed,
      goals: result.events.filter(
        (event) => event.type === "GOAL" && event.personId === state.personId,
      ).length,
      status: simulationStatus,
    };
    repo.insertNationalTeamAppearance(appearance);
  }
  adjustReputationAfterResult(db, fixture.federationId, played, fixture.fixtureDate);
  return played;
};

export const runCoachEducationProgramme = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    licenceLevel: CoachEducationProgramme["licenceLevel"];
    startDate: string;
    seed: string;
    capacity?: number;
  },
): CoachEducationProgramme => {
  const rng = seeded(input.seed, `${input.federationId}:coach:${input.startDate}`);
  const capacity = input.capacity ?? 18;
  const cost =
    capacity *
    (input.licenceLevel === "AFC Pro"
      ? 95000
      : input.licenceLevel === "AFC A"
        ? 65000
        : input.licenceLevel === "AFC B"
          ? 42000
          : 26000);
  const programme: CoachEducationProgramme = {
    id: createStableEntityId(
      "coach-education-programme",
      `${input.federationId}:${input.licenceLevel}:${input.startDate}`,
    ),
    federationId: input.federationId,
    licenceLevel: input.licenceLevel,
    startDate: input.startDate,
    endDate: addDays(input.startDate, 75),
    capacity,
    cost,
    graduates: Math.round(capacity * (0.72 + rng.next() * 0.2)),
    currency: homeCurrency(db),
    status: "COMPLETED",
    provenanceStatus: simulationStatus,
  };
  new FederationGovernanceRepository(db).upsertCoachEducationProgramme(programme);
  postFederationTransaction(db, {
    federationId: input.federationId,
    date: programme.endDate,
    category: "COACH_EDUCATION",
    direction: "DEBIT",
    amount: cost,
    description: `${input.licenceLevel} coach education cohort`,
    relatedEntityId: programme.id,
    idempotencyKey: `coach-course:${programme.id}`,
  });
  return programme;
};

export const runRefereeProgramme = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    programmeType: RefereeDevelopmentProgramme["programmeType"];
    startDate: string;
    seed: string;
    capacity?: number;
  },
): RefereeDevelopmentProgramme => {
  const rng = seeded(input.seed, `${input.federationId}:referee:${input.startDate}`);
  const capacity = input.capacity ?? 24;
  const cost = capacity * 22000;
  const programme: RefereeDevelopmentProgramme = {
    id: createStableEntityId(
      "referee-development-programme",
      `${input.federationId}:${input.programmeType}:${input.startDate}`,
    ),
    federationId: input.federationId,
    programmeType: input.programmeType,
    startDate: input.startDate,
    endDate: addDays(input.startDate, 45),
    capacity,
    cost,
    refereesAdvanced: Math.round(capacity * (0.62 + rng.next() * 0.22)),
    currency: homeCurrency(db),
    status: "COMPLETED",
    provenanceStatus: simulationStatus,
  };
  new FederationGovernanceRepository(db).upsertRefereeDevelopmentProgramme(programme);
  postFederationTransaction(db, {
    federationId: input.federationId,
    date: programme.endDate,
    category: "REFEREE_DEVELOPMENT",
    direction: "DEBIT",
    amount: cost,
    description: `${input.programmeType} referee programme`,
    relatedEntityId: programme.id,
    idempotencyKey: `referee-programme:${programme.id}`,
  });
  return programme;
};

/** Annual bounded development for active domestic officials. */
const runFederationRefereeDevelopment = (
  db: GameDatabase,
  federation: Federation,
  date: string,
  seed: string,
): void => {
  if (!date.endsWith("-09-28")) return;
  if (federation.id !== homeFederation(db).id) return;
  const governance = new FederationGovernanceRepository(db);
  const existing = governance
    .refereeDevelopmentProgrammes(federation.id)
    .find((programme) => programme.programmeType === "TRAINING" && programme.startDate === date);
  if (existing) return;

  const workforce = new WorkforceSupplyRepository(db);
  const participants = workforce
    .activeOfficials("REFEREE")
    .filter((official) => official.countryId === federation.countryId)
    .sort(
      (a, b) =>
        a.quality - b.quality ||
        b.potential - a.potential ||
        a.personId.localeCompare(b.personId),
    )
    .slice(0, 4);
  if (participants.length === 0) return;

  const account = governance.financialAccount(federation.id);
  const cost = participants.length * 22000;
  if (!account || account.cashBalance - cost < reserveFloor(account)) return;

  const programme = runRefereeProgramme(db, {
    federationId: federation.id,
    programmeType: "TRAINING",
    startDate: date,
    seed,
    capacity: participants.length,
  });
  governance.upsertRefereeDevelopmentProgramme({
    ...programme,
    refereesAdvanced: participants.length,
  });

  for (const official of participants) {
    const qualityGain = Math.min(0.8, Math.max(0.2, (official.potential - official.quality) * 0.04));
    workforce.upsertOfficial({
      ...official,
      quality: Math.min(100, Number((official.quality + qualityGain).toFixed(2))),
      fitness: Math.min(100, Number((official.fitness + 0.5).toFixed(2))),
      experience: Math.min(100, Number((official.experience + 0.35).toFixed(2))),
    });
    new WorldRepository(db).insertStaffHistoryEvent({
      id: createStableEntityId(
        "staff-history",
        `${official.personId}:referee-development:${programme.id}`,
      ),
      personId: official.personId,
      eventType: "REFEREE_DEVELOPMENT_COMPLETED",
      occurredOn: programme.endDate,
      federationId: federation.id,
      description: `Completed bounded federation referee development (${programme.programmeType}).`,
    });
  }
};

export const getFederationKPIs = (
  db: GameDatabase,
  federationId = homeFederation(db).id,
): FederationKPI[] => new FederationGovernanceRepository(db).kpis(federationId);

export const runFederationAiSeasonPlanning = (
  db: GameDatabase,
  input: { date: string; seed: string },
): FederationAiDecision[] => {
  if (!input.date.endsWith("-08-28")) return [];
  const repo = new FederationGovernanceRepository(db);
  const economy = new ClubEconomyRepository(db);
  const decisions: FederationAiDecision[] = [];
  for (const federation of allFederations(db)) {
    const profile = repo.profile(federation.id);
    const account = repo.financialAccount(federation.id);
    if (!profile || !account) continue;
    const clubAccounts = economy.financialAccounts();
    const clubSupporters = clubAccounts.map((item) => economy.supporterProfile(item.clubId)).filter(Boolean);
    const averageCommercial = clubSupporters.length === 0 ? 0 : clubSupporters.reduce((total, item) => total + (item?.commercialReputation ?? 0), 0) / clubSupporters.length;
    const financiallyWeak = clubAccounts.filter((item) => ["DISTRESSED", "INSOLVENT"].includes(item.financialHealth)).length;
    const latestWins = repo.kpis(federation.id).filter((item) => item.metric === "INTERNATIONAL_WINS").sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0]?.value ?? 0;
    const priorities: Record<string, number> = {
      clubs: Number(Math.min(1, 0.25 + financiallyWeak / Math.max(1, clubAccounts.length)).toFixed(3)),
      infrastructure: Number((profile.infrastructureLevel < 1 ? 0.9 : 0.35).toFixed(3)),
      youth: Number((profile.youthDevelopment < 1 ? 0.85 : 0.45).toFixed(3)),
      nationalTeam: Number((latestWins < 2 || profile.reputation < 5 ? 0.8 : 0.45).toFixed(3)),
      commercial: Number((averageCommercial < 5 ? 0.7 : 0.45).toFixed(3)),
    };
    const actions: string[] = [];
    if (account.financialHealth === "DISTRESSED" || account.financialHealth === "INSOLVENT") actions.push("PROTECT_CORE_PROGRAMMES");
    if (priorities.infrastructure >= 0.8) actions.push("PRIORITISE_NATIONAL_CENTRE");
    if (priorities.clubs >= 0.6) actions.push("TARGET_GRANTS_AT_WEAK_CLUBS");
    if (priorities.youth >= 0.7) actions.push("EXPAND_YOUTH_AND_REGIONAL_COVERAGE");
    if (priorities.nationalTeam >= 0.7) actions.push("INVEST_IN_NATIONAL_TEAM_PREPARATION");
    if (priorities.commercial >= 0.65) actions.push("DEVELOP_COMPETITION_COMMERCIAL_REACH");
    if (actions.length === 0) actions.push("BALANCE_DEVELOPMENT_AND_COMPETITIVE_INVESTMENT");
    const decision: FederationAiDecision = {
      id: createStableEntityId("federation-ai-decision", `${federation.id}:${input.date}`),
      federationId: federation.id,
      date: input.date,
      seasonLabel: seasonLabel(input.date),
      priorities,
      actions,
      context: { financialHealth: account.financialHealth, cash: account.cashBalance, financiallyWeakClubs: financiallyWeak, averageCommercial, internationalWins: latestWins, infrastructure: profile.infrastructureLevel, youth: profile.youthDevelopment },
      status: simulationStatus,
    };
    repo.upsertAiDecision(decision);
    decisions.push(decision);
  }
  return decisions;
};

export const processFederationMonth = (
  db: GameDatabase,
  input: { date: string; seed: string; aiEnabled?: boolean },
): void => {
  initializeFederationGovernanceForSave({ db, worldDate: input.date, seed: input.seed });
  const repo = new FederationGovernanceRepository(db);
  if (input.aiEnabled !== false) {
    runFederationAiSeasonPlanning(db, { date: input.date, seed: input.seed });
  }
  for (const federation of allFederations(db)) {
    recordFederationDevelopmentSnapshot(db, federation.id, input.date);
    runFederationRefereeDevelopment(db, federation, input.date, input.seed);
    const activeSponsorships = repo
      .federationSponsorships(federation.id)
      .filter(
        (sponsorship) =>
          sponsorship.status === "ACTIVE" &&
          sponsorship.startDate <= input.date &&
          sponsorship.endDate >= input.date,
      );
    for (const sponsorship of activeSponsorships) {
      postFederationTransaction(db, {
        federationId: federation.id,
        date: input.date,
        category: sponsorship.type === "BROADCAST_PARTNER" ? "BROADCASTING" : "SPONSORSHIP",
        direction: "CREDIT",
        amount: Math.round(sponsorship.annualValue / 12),
        description: "Monthly federation commercial income",
        relatedEntityId: sponsorship.id,
        idempotencyKey: `federation-sponsor:${sponsorship.id}:${input.date}`,
      });
    }
    // A sanction that blocks funding (new grants / funding frozen) must
    // actually stop this recurring inflow, not just exist on paper.
    const fundingBlocked = new FederationComplianceRepository(db)
      .activeSanctionsForFederation(federation.id)
      .some((sanction) => sanction.consequences.includes("FUNDING_FROZEN") || sanction.consequences.includes("NEW_GRANTS_BLOCKED"));
    if (!fundingBlocked && input.date.endsWith("-02-28")) {
      receiveFederationGrant(db, {
        federationId: federation.id,
        date: input.date,
        source: "FIFA_GRANT",
        amount: 1150000,
        restrictionTag: "development",
      });
    }
    if (!fundingBlocked && input.date.endsWith("-05-28")) {
      receiveFederationGrant(db, {
        federationId: federation.id,
        date: input.date,
        source: "AFC_GRANT",
        amount: 850000,
        restrictionTag: "technical",
      });
    }
    if (input.date.endsWith("-03-28")) {
      investInDevelopmentEnvironment(db, federation.id, input.date);
    }
    if (input.aiEnabled !== false) {
      runFederationAiMonth(db, federation.id, input.date, input.seed);
    }
    for (const project of repo.projects(federation.id).filter((item) => item.status === "COMPLETED")) {
      const maintenance = Math.max(1, Math.round(project.annualOperatingCost / 12));
      const account = repo.financialAccount(federation.id);
      if (!account) continue;
      const underfunded = account.cashBalance - maintenance < reserveFloor(account);
      if (!underfunded) {
        postFederationTransaction(db, {
          federationId: federation.id, date: input.date, category: "INFRASTRUCTURE", direction: "DEBIT",
          amount: maintenance, description: `${project.name} operating and maintenance cost`, relatedEntityId: project.id,
          idempotencyKey: `federation-project-maintenance:${project.id}:${input.date}`,
        });
      }
      const maintenanceStatus = underfunded ? "DETERIORATING" : "FUNDED";
      if (project.maintenanceStatus !== maintenanceStatus) repo.upsertProject({ ...project, maintenanceStatus });
    }
  }
  advanceFederationProjects(db, { date: input.date, seed: input.seed });
};

export const closeFederationFinancialSeason = (
  db: GameDatabase,
  input: { seasonLabel: string; date: string },
): FederationFinancialStatement[] => {
  const repo = new FederationGovernanceRepository(db);
  const statements: FederationFinancialStatement[] = [];
  for (const account of repo.financialAccounts()) {
    const entries = repo
      .ledgerEntries(account.federationId)
      .filter((entry) => entry.date.startsWith(input.seasonLabel));
    const revenue = categoryTotals(entries, "CREDIT");
    const expenses = categoryTotals(entries, "DEBIT");
    const revenueTotal = sumValues(revenue);
    const expenseTotal = sumValues(expenses);
    const refreshed = repo.financialAccount(account.federationId) ?? account;
    const statement: FederationFinancialStatement = {
      id: createStableEntityId(
        "federation-financial-statement",
        `${account.federationId}:${input.seasonLabel}`,
      ),
      federationId: account.federationId,
      seasonLabel: input.seasonLabel,
      openingCash: refreshed.cashBalance - revenueTotal + expenseTotal,
      revenueByCategory: revenue,
      expensesByCategory: expenses,
      programmeSpending:
        (expenses.YOUTH_DEVELOPMENT ?? 0) +
        (expenses.GRASSROOTS ?? 0) +
        (expenses.COACH_EDUCATION ?? 0) +
        (expenses.REFEREE_DEVELOPMENT ?? 0),
      nationalTeamSpending:
        (expenses.NATIONAL_TEAM_COST ?? 0) +
        (expenses.TRAVEL ?? 0) +
        (expenses.PLAYER_ALLOWANCES ?? 0),
      competitionSpending: (expenses.PRIZE_DISTRIBUTION ?? 0) + (expenses.CLUB_GRANTS ?? 0),
      infrastructureSpending: expenses.INFRASTRUCTURE ?? 0,
      netProfitLoss: revenueTotal - expenseTotal,
      closingCash: refreshed.cashBalance,
      debt: refreshed.debt,
      currency: refreshed.currency,
      closedAt: input.date,
      status: simulationStatus,
    };
    repo.upsertFinancialStatement(statement);
    updateFederationKpis(db, account.federationId, input.seasonLabel, input.date);
    statements.push(statement);
  }
  return statements;
};

export const runFederationDiagnostic = (input: {
  db: GameDatabase;
  seed: string;
  seasons: number;
  startDate: string;
  youthInvestment?: "LOW" | "HIGH" | "AI";
}): FederationDiagnosticReport => {
  initializeFederationGovernanceForSave({
    db: input.db,
    worldDate: input.startDate,
    seed: input.seed,
  });
  const federation = homeFederation(input.db);
  if (input.youthInvestment === "HIGH") {
    setFederationBudget(input.db, {
      federationId: federation.id,
      seasonLabel: seasonLabel(input.startDate),
      category: "YOUTH_DEVELOPMENT",
      amount: 5500000,
    });
  }
  if (input.youthInvestment === "LOW") {
    setFederationBudget(input.db, {
      federationId: federation.id,
      seasonLabel: seasonLabel(input.startDate),
      category: "YOUTH_DEVELOPMENT",
      amount: 450000,
    });
  }
  for (let season = 0; season < input.seasons; season += 1) {
    const year = Number(input.startDate.slice(0, 4)) + season;
    const activeSeason = String(year + 1);
    ensureFederationBudgets(input.db, federation.id, `${year}-08-01`);
    if (input.youthInvestment === "HIGH") {
      setFederationBudget(input.db, {
        federationId: federation.id,
        seasonLabel: activeSeason,
        category: "YOUTH_DEVELOPMENT",
        amount: 5500000,
      });
    }
    if (input.youthInvestment === "LOW") {
      setFederationBudget(input.db, {
        federationId: federation.id,
        seasonLabel: activeSeason,
        category: "YOUTH_DEVELOPMENT",
        amount: 450000,
      });
    }
    runCoachEducationProgramme(input.db, {
      federationId: federation.id,
      licenceLevel: season % 3 === 0 ? "AFC B" : "AFC C",
      startDate: `${year}-09-15`,
      seed: `${input.seed}:coach:${season}`,
    });
    runRefereeProgramme(input.db, {
      federationId: federation.id,
      programmeType: season % 2 === 0 ? "TRAINING" : "FITNESS",
      startDate: `${year}-10-10`,
      seed: `${input.seed}:referee:${season}`,
    });
    if (season === 0) {
      createFederationProject(input.db, {
        federationId: federation.id,
        projectType: "GRASSROOTS_PROGRAMME",
        name: "Regional Grassroots Expansion",
        date: `${year}-09-01`,
        seed: input.seed,
      });
    }
    const team = seniorMenNationalTeam(input.db, federation.id);
    selectNationalTeamSquad(input.db, {
      federationId: federation.id,
      nationalTeamId: team.id,
      date: `${year}-11-01`,
      programme: `Friendly window ${year}`,
      seed: `${input.seed}:squad:${season}`,
    });
    const friendly = scheduleFriendly(input.db, {
      federationId: federation.id,
      nationalTeamId: team.id,
      opponentName: `Simulation Association ${season + 1}`,
      date: `${year}-11-15`,
      seed: `${input.seed}:friendly:${season}`,
    });
    playNationalTeamFixture(input.db, friendly.id, `${input.seed}:friendly:${season}`);
    assessClubLicensing(input.db, {
      federationId: federation.id,
      seasonLabel: activeSeason,
      date: `${year}-12-15`,
    });
    for (const month of [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7]) {
      const monthYear = month >= 8 ? year : year + 1;
      processFederationMonth(input.db, {
        date: `${monthYear}-${String(month).padStart(2, "0")}-28`,
        seed: `${input.seed}:diagnostic:${season}:${month}`,
      });
    }
    closeFederationFinancialSeason(input.db, {
      seasonLabel: activeSeason,
      date: seasonEndDate(input.db, year),
    });
  }
  return federationReport(input.db, federation.id, input.startDate, input.seasons);
};

export const runFederationPresidentDemo = (input: {
  db: GameDatabase;
  seed: string;
  worldDate: string;
}): PresidentDemoReport => {
  initializeFederationGovernanceForSave(input);
  const federation = homeFederation(input.db);
  const president = createDemoPresident(input.db, federation, input.worldDate);
  const team = seniorMenNationalTeam(input.db, federation.id);
  const before = getFederationFinances(input.db, federation.id).account.cashBalance;
  for (const item of [
    ["YOUTH_DEVELOPMENT", 3500000],
    ["COACH_EDUCATION", 1400000],
    ["REFEREE_DEVELOPMENT", 900000],
    ["INFRASTRUCTURE", 4500000],
  ] as const) {
    setFederationBudget(input.db, {
      federationId: federation.id,
      seasonLabel: seasonLabel(input.worldDate),
      category: item[0],
      amount: item[1],
    });
  }
  const project = createFederationProject(input.db, {
    federationId: federation.id,
    projectType: "NATIONAL_TRAINING_CENTRE",
    name: "National Football Centre",
    date: input.worldDate,
    seed: input.seed,
  });
  const aDivision = competitionByName(input.db, "Martyr's Memorial A-Division League");
  const reform = proposeCompetitionReform(input.db, {
    federationId: federation.id,
    competitionId: aDivision.id,
    effectiveSeason: "2032",
    changes: { teamCount: 16, rounds: 2, promotionSlots: 2, relegationSlots: 2 },
    proposedAt: input.worldDate,
    decidedAt: input.worldDate,
    status: "APPROVED",
  });
  const applied = applyCompetitionReform(input.db, reform.id, input.worldDate);
  const coach = appointNationalTeamStaff(input.db, {
    federationId: federation.id,
    nationalTeamId: team.id,
    date: input.worldDate,
    seed: input.seed,
  });
  const callups = selectNationalTeamSquad(input.db, {
    federationId: federation.id,
    nationalTeamId: team.id,
    date: input.worldDate,
    programme: "President demo friendly",
    seed: input.seed,
  });
  const friendly = scheduleFriendly(input.db, {
    federationId: federation.id,
    nationalTeamId: team.id,
    opponentName: "Simulation Friendly Opponent",
    date: addDays(input.worldDate, 30),
    seed: input.seed,
  });
  playNationalTeamFixture(input.db, friendly.id, input.seed);
  runCoachEducationProgramme(input.db, {
    federationId: federation.id,
    licenceLevel: "AFC C",
    startDate: addDays(input.worldDate, 45),
    seed: input.seed,
  });
  runRefereeProgramme(input.db, {
    federationId: federation.id,
    programmeType: "TRAINING",
    startDate: addDays(input.worldDate, 50),
    seed: input.seed,
  });
  processFederationMonth(input.db, { date: addDays(input.worldDate, 60), seed: input.seed });
  closeFederationFinancialSeason(input.db, {
    seasonLabel: seasonLabel(input.worldDate),
    date: addDays(input.worldDate, 330),
  });
  return {
    presidentPersonId: president.id,
    federationId: federation.id,
    beforeCash: before,
    afterCash: getFederationFinances(input.db, federation.id).account.cashBalance,
    projectId: project.id,
    reformId: applied.id,
    nationalTeamCoachId: coach.id,
    friendlyId: friendly.id,
    callups: callups.length,
    kpis: getFederationKPIs(input.db, federation.id),
    permissions: federationPresidentPermissions(),
  };
};

export const federationPresidentPermissions = (): string[] => [
  "FEDERATION_BUDGETS",
  "COMPETITION_POLICY",
  "NATIONAL_DEVELOPMENT_STRATEGY",
  "SENIOR_APPOINTMENTS",
  "INFRASTRUCTURE_STRATEGY",
  "INTERNATIONAL_STRATEGY",
  "CLUB_SUPPORT_AND_LICENSING",
];

const generatedFederationProfile = (
  federation: Federation,
  date: string,
  seed: string,
): FederationSimulationProfile => {
  const rng = seeded(seed, federation.id);
  const base = 4.6 + rng.next() * 1.1;
  return {
    federationId: federation.id,
    countryId: federation.countryId,
    reputation: round(base + 0.4),
    financialHealth: "STABLE",
    grassrootsDevelopment: round(base),
    youthDevelopment: round(base + 0.2),
    coachEducation: round(base - 0.1),
    refereeDevelopment: round(base - 0.2),
    competitionOrganisation: round(base + 0.3),
    commercialStrength: round(base - 0.3),
    internationalRelations: round(base + 0.2),
    governanceStability: round(base),
    infrastructureLevel: round(base - 0.4),
    lastUpdatedAt: date,
    status: simulationStatus,
  };
};

const ensureFederationBudgets = (db: GameDatabase, federationId: EntityId, date: string): void => {
  const repo = new FederationGovernanceRepository(db);
  const account = repo.financialAccount(federationId);
  const base = Math.max(scalePrice(db, 5000000), account?.cashBalance ?? scalePrice(db, 12000000));
  const existing = new Set(
    repo
      .budgets(federationId)
      .filter((budget) => budget.seasonLabel === seasonLabel(date))
      .map((budget) => budget.category),
  );
  const values: Record<FederationBudgetCategory, number> = {
    NATIONAL_TEAMS: Math.round(base * 0.22),
    YOUTH_DEVELOPMENT: Math.round(base * 0.18),
    GRASSROOTS: Math.round(base * 0.13),
    COACH_EDUCATION: Math.round(base * 0.08),
    REFEREE_DEVELOPMENT: Math.round(base * 0.06),
    COMPETITIONS: Math.round(base * 0.14),
    INFRASTRUCTURE: Math.round(base * 0.22),
    CLUB_SUPPORT: Math.round(base * 0.1),
    COMMERCIAL: Math.round(base * 0.05),
    ADMINISTRATION: Math.round(base * 0.09),
    WOMENS_FOOTBALL: Math.round(base * 0.08),
  };
  for (const [category, amount] of Object.entries(values)) {
    if (existing.has(category as FederationBudgetCategory)) continue;
    setFederationBudget(db, {
      federationId,
      seasonLabel: seasonLabel(date),
      category: category as FederationBudgetCategory,
      amount,
    });
  }
};

const ensureCommittees = (db: GameDatabase, federationId: EntityId): void => {
  const names: Record<FederationCommitteeType, string> = {
    COMPETITION_COMMITTEE: "Competition Committee",
    TECHNICAL_COMMITTEE: "Technical Committee",
    REFEREE_COMMITTEE: "Referee Committee",
    WOMENS_FOOTBALL_COMMITTEE: "Women's Football Committee",
    YOUTH_COMMITTEE: "Youth Committee",
    FINANCE_COMMITTEE: "Finance Committee",
    COMMERCIAL_COMMITTEE: "Commercial Committee",
  };
  const repo = new FederationGovernanceRepository(db);
  for (const [committeeType, name] of Object.entries(names)) {
    repo.upsertCommittee({
      id: createStableEntityId("federation-committee", `${federationId}:${committeeType}`),
      federationId,
      committeeType: committeeType as FederationCommitteeType,
      name,
      status: "ACTIVE",
      provenanceStatus: simulationStatus,
    });
  }
};

const ensureStrategy = (db: GameDatabase, federationId: EntityId, date: string): void => {
  const existing = new FederationGovernanceRepository(db).strategyPriorities(federationId);
  if (existing.length > 0) return;
  const priorities: Array<[FederationStrategicPriority, number]> = [
    ["GRASSROOTS_EXPANSION", 0.18],
    ["YOUTH_ELITE_DEVELOPMENT", 0.18],
    ["COACH_EDUCATION", 0.12],
    ["REFEREE_DEVELOPMENT", 0.1],
    ["CLUB_PROFESSIONALISATION", 0.13],
    ["NATIONAL_TEAM_PERFORMANCE", 0.14],
    ["WOMENS_FOOTBALL", 0.08],
    ["INFRASTRUCTURE", 0.07],
  ];
  for (const [priority, weight] of priorities) {
    new FederationGovernanceRepository(db).upsertStrategyPriority({
      id: createStableEntityId("federation-strategy", `${federationId}:${priority}:${date}`),
      federationId,
      priority,
      weight,
      effectiveFrom: date,
      status: "ACTIVE",
      provenanceStatus: simulationStatus,
    });
  }
};

const ensureRelationships = (db: GameDatabase, federationId: EntityId, date: string): void => {
  const repo = new FederationGovernanceRepository(db);
  for (const relationship of [
    ["GOVERNMENT", "GOVERNMENT", 5.2, 5.1, 4.8],
    ["NATIONAL_SPORTS_COUNCIL", "SPORTS_COUNCIL", 5.4, 5.2, 5.1],
    ["FIFA", "INTERNATIONAL_BODY", 5.5, 5.4, 5.3],
    ["AFC", "INTERNATIONAL_BODY", 5.4, 5.3, 5.2],
    ["SAFF", "INTERNATIONAL_BODY", 5.6, 5.4, 4.7],
  ] as const) {
    repo.upsertOrganisationRelationship({
      id: createStableEntityId("organisation-relationship", `${federationId}:${relationship[0]}`),
      federationId,
      organisationName: relationship[0],
      relationshipType: relationship[1],
      supportLevel: relationship[2],
      trust: relationship[3],
      fundingRelationship: relationship[4],
      updatedAt: date,
      status: simulationStatus,
    });
  }
};

const ensureObjectives = (db: GameDatabase, federationId: EntityId, date: string): void => {
  const repo = new FederationGovernanceRepository(db);
  if (repo.objectives(federationId).length > 0) return;
  for (const objective of [
    "IMPROVE_YOUTH_PIPELINE",
    "PROFESSIONALISE_LEAGUES",
    "BUILD_NATIONAL_CENTRE",
    "GROW_WOMENS_FOOTBALL",
    "IMPROVE_REFEREE_STANDARDS",
    "INCREASE_COMMERCIAL_REVENUE",
  ] as const) {
    repo.upsertObjective({
      id: createStableEntityId("federation-objective", `${federationId}:${objective}:${date}`),
      federationId,
      objective,
      cycleStart: date,
      cycleEnd: addYears(date, 4),
      progress: 0,
      status: "ACTIVE",
      provenanceStatus: simulationStatus,
    });
  }
};

const ensureFederationSponsorship = (
  db: GameDatabase,
  federationId: EntityId,
  date: string,
  seed: string,
): void => {
  const repo = new FederationGovernanceRepository(db);
  if (repo.federationSponsorships(federationId).some((item) => item.status === "ACTIVE")) return;
  const sponsors = new ClubEconomyRepository(db).sponsors();
  const sponsor = sponsors[0];
  if (!sponsor) return;
  const rng = seeded(seed, `${federationId}:federation-sponsor`);
  repo.upsertFederationSponsorship({
    id: createStableEntityId("federation-sponsorship", `${federationId}:${sponsor.id}:${date}`),
    federationId,
    sponsorId: sponsor.id,
    type: "OFFICIAL_PARTNER",
    startDate: date,
    endDate: addYears(date, 1),
    annualValue: Math.round(2200000 + rng.next() * 900000),
    currency: homeCurrency(db),
    status: "ACTIVE",
    provenanceStatus: simulationStatus,
  });
};

/**
 * Federation-level commercial context, read-only by construction: the one
 * sponsorship ensureFederationSponsorship creates is activated in the same
 * call that creates it, and settleFederationMediaRightsForCompetition
 * likewise creates and awards a media-rights offer atomically — neither
 * ever leaves an OFFERED state for a player to decide, so there is no
 * negotiation to expose here, only what already happened.
 */
export const federationCommercialOverview = (
  db: GameDatabase,
  federationId: EntityId,
): FederationCommercialOverview => {
  const sponsors = new Map(new ClubEconomyRepository(db).sponsors().map((sponsor) => [sponsor.id, sponsor]));
  const sponsorship = new FederationGovernanceRepository(db)
    .federationSponsorships(federationId)
    .find((item) => item.status === "ACTIVE");
  const mediaRepo = new MediaRightsRepository(db);
  const mediaRights = mediaRepo
    .packages(federationId)
    .flatMap((rightsPackage) =>
      mediaRepo
        .offers(rightsPackage.id)
        .filter((offer) => ["AWARDED", "ACTIVE", "EXPIRED", "RENEWED"].includes(offer.status))
        .map((offer) => ({
          packageName: rightsPackage.name,
          broadcasterName: mediaRepo.broadcaster(offer.broadcasterId)?.name ?? "Unknown broadcaster",
          value: offer.value,
          status: offer.status,
          startDate: offer.startDate,
          endDate: offer.endDate,
        })),
    );
  const rights = new CommercialRightsRepository(db);
  const competitionLinks = new CompetitionCommercialRepository(db).all();
  const nationalSettlements = new NationalTeamCommercialRepository(db).all(federationId);
  const supportedCategories = new Set([
    "FEDERATION_MAIN_PARTNER",
    "LEAGUE_TITLE_SPONSOR",
    "NATIONAL_TEAM_SPONSOR",
    "YOUTH_PROGRAMME_PARTNER",
    "WOMENS_GIRLS_PROGRAMME_PARTNER",
  ]);
  const sponsorReference = (sponsorId: EntityId): EntityReference | undefined => {
    const reference = buildEntityReference(db, "SPONSOR", sponsorId, "FEDERATION_PRESIDENT");
    return reference.visible ? reference : undefined;
  };
  const competitionContext = (offerId: EntityId): {
    seasonId?: EntityId;
    name: string;
    displayTitle?: string;
    endDate?: string;
    settlement: "SETTLED" | "NOT_SETTLED" | "NOT_APPLICABLE";
  } => {
    const link = competitionLinks.find((item) => item.rightsOfferId === offerId);
    if (!link) return { name: "Competition property", settlement: "NOT_SETTLED" };
    const row = db
      .prepare(
        `SELECT c.name AS competition_name, cs.name AS season_name
         FROM competition_seasons cs JOIN competitions c ON c.id = cs.competition_id
         WHERE cs.id = ?`,
      )
      .get(link.competitionSeasonId) as { competition_name?: string; season_name?: string } | undefined;
    return {
      seasonId: link.competitionSeasonId,
      name: row?.competition_name ?? "Competition property",
      displayTitle: link.displayTitle,
      endDate: link.endDate,
      settlement: "SETTLED",
    };
  };
  const offerActions = (status: string): PresidentCommercialPropertyView["availableActions"] => {
    if (status === "OFFERED" || status === "NEGOTIATED") return ["VIEW_OFFERS", "COUNTER", "ACCEPT", "REJECT"];
    if (status === "ACTIVE" || status === "RENEWED") return ["RENEW"];
    return ["VIEW_OFFERS"];
  };
  const properties: PresidentCommercialPropertyView[] = rights
    .packages(federationId)
    .filter((item) => supportedCategories.has(item.category))
    .map((rightsPackage) => {
      const offers = rights.offers(rightsPackage.id);
      const selected = offers.find((item) => ["ACTIVE", "RENEWED", "AWARDED"].includes(item.status)) ?? offers[offers.length - 1];
      const competition = selected ? competitionContext(selected.id) : { name: rightsPackage.name, settlement: "NOT_APPLICABLE" as const };
      const settlement = selected?.federationLedgerEntryId
        ? "SETTLED"
        : selected && nationalSettlements.some((item) => item.rightsOfferId === selected.id)
          ? "SETTLED"
          : competition.settlement;
      const programmeScope = nationalProgrammeScopeFor(rightsPackage);
      return {
        id: rightsPackage.id,
        scope: rightsPackage.scope === "COMPETITION"
          ? "COMPETITION"
          : programmeScope ?? "FEDERATION",
        programme: programmeScope,
        competitionSeasonId: competition.seasonId,
        canonicalName: competition.name,
        commercialDisplayTitle: competition.displayTitle,
        sponsor: selected ? sponsorReference(selected.sponsorId) : undefined,
        packageId: rightsPackage.id,
        offerId: selected?.id,
        termYears: selected?.termYears,
        annualValue: selected?.annualValue,
        status: selected?.status ?? rightsPackage.status,
        startDate: selected?.startDate,
        endDate: selected?.endDate ?? competition.endDate,
        negotiationRound: selected?.status === "NEGOTIATED" ? 1 : 0,
        settlementState: settlement,
        revenueDestination: selected?.federationLedgerEntryId ? "FEDERATION_LEDGER" : undefined,
        competingOfferCount: Math.max(0, offers.filter((item) => ["OFFERED", "NEGOTIATED"].includes(item.status) && item.id !== selected?.id).length),
        availableActions: offerActions(selected?.status ?? rightsPackage.status),
      };
    });
  const activeLegacyFederationSponsor = sponsorship;
  if (activeLegacyFederationSponsor && !properties.some((property) => property.scope === "FEDERATION")) {
    properties.unshift({
      id: activeLegacyFederationSponsor.id,
      scope: "FEDERATION",
      canonicalName: "Federation main partner",
      sponsor: sponsorReference(activeLegacyFederationSponsor.sponsorId),
      status: activeLegacyFederationSponsor.status,
      startDate: activeLegacyFederationSponsor.startDate,
      endDate: activeLegacyFederationSponsor.endDate,
      annualValue: activeLegacyFederationSponsor.annualValue,
      negotiationRound: 0,
      settlementState: "NOT_APPLICABLE",
      revenueDestination: "FEDERATION_LEDGER",
      competingOfferCount: 0,
      availableActions: ["RENEW"],
    });
  }
  const history: PresidentCommercialHistoryEntry[] = rights
    .offers()
    .filter((item) => item.federationId === federationId && ["ACTIVE", "EXPIRED", "RENEWED", "AWARDED"].includes(item.status))
    .sort((a, b) => `${b.offeredOn}:${b.id}`.localeCompare(`${a.offeredOn}:${a.id}`))
    .slice(0, 50)
    .map((item) => {
      const rightsPackage = rights.packages(federationId).find((candidate) => candidate.id === item.packageId);
      const competition = competitionContext(item.id);
      return {
        id: item.id,
        scope: competition.seasonId ? "COMPETITION" : nationalProgrammeScopeFor(rightsPackage) ?? "FEDERATION",
        canonicalName: competition.name,
        sponsor: sponsorReference(item.sponsorId),
        status: item.status,
        date: item.offeredOn,
        endDate: item.endDate,
        annualValue: item.annualValue,
        settlementState: item.federationLedgerEntryId || nationalSettlements.some((entry) => entry.rightsOfferId === item.id) || competition.seasonId ? "SETTLED" : "NOT_SETTLED",
      };
    });
  const legacyHistory = new FederationGovernanceRepository(db).federationSponsorships(federationId)
    .filter((item) => item.status !== "OFFERED")
    .slice(-50)
    .map((item) => ({
      id: item.id,
      scope: "FEDERATION" as const,
      canonicalName: "Federation main partner",
      sponsor: sponsorReference(item.sponsorId),
      status: item.status,
      date: item.startDate,
      endDate: item.endDate,
      annualValue: item.annualValue,
      settlementState: "NOT_APPLICABLE" as const,
    }));
  return {
    federationId,
    sponsorship: sponsorship
      ? { ...sponsorship, sponsorName: sponsors.get(sponsorship.sponsorId)?.name ?? "Unknown sponsor" }
      : undefined,
    mediaRights,
    properties,
    history: [...history, ...legacyHistory].sort((a, b) => `${b.date ?? ""}:${b.id}`.localeCompare(`${a.date ?? ""}:${a.id}`)).slice(0, 50),
  };
};

const seedFederationSponsors = (db: GameDatabase, date: string, seed: string): void => {
  const economy = new ClubEconomyRepository(db);
  const wanted = homeCountryPack(db).commercial?.federationSponsors ?? [];
  const present = new Set(economy.sponsors().map((sponsor) => sponsor.id));
  if (wanted.every(({ name }) => present.has(createStableEntityId("sponsor-organisation", name)))) {
    return;
  }
  const rng = seeded(seed, `federation-sponsors:${date}`);
  for (const { name, industry } of wanted) {
    const sponsor: SponsorOrganisation = {
      id: createStableEntityId("sponsor-organisation", name),
      name,
      industry,
      countryId: homeFederation(db).countryId,
      reputation: round(4 + rng.next() * 3),
      budgetTier: "NATIONAL",
      status: simulationStatus,
    };
    economy.upsertSponsor(sponsor);
  }
};

const applyDevelopmentEnvironmentFromFederation = (
  db: GameDatabase,
  federationId: EntityId,
  date: string,
  seed: string,
): void => {
  const federation = federationById(db, federationId);
  const profile = new FederationGovernanceRepository(db).profile(federationId);
  if (!profile) return;
  const youth = new YouthRepository(db);
  const previous = youth.latestCountryDevelopmentProfile(federation.countryId);
  const base = previous ?? {
    id: createStableEntityId("country-development", `${federation.countryId}:foundation`),
    countryId: federation.countryId,
    effectiveFrom: date,
    footballPopularity: 5,
    grassrootsReach: 4.8,
    coachingQuality: 4.7,
    youthInfrastructure: 4.6,
    talentConversion: 4.8,
    status: simulationStatus,
    notes: "Federation simulation foundation.",
  };
  youth.upsertCountryDevelopmentProfile({
    ...base,
    id: createStableEntityId("country-development", `${federation.countryId}:${date}:federation`),
    effectiveFrom: date,
    footballPopularity: gradual(base.footballPopularity, profile.reputation, 0.05),
    grassrootsReach: gradual(base.grassrootsReach, profile.grassrootsDevelopment, 0.08),
    coachingQuality: gradual(base.coachingQuality, profile.coachEducation, 0.06),
    youthInfrastructure: gradual(base.youthInfrastructure, profile.youthDevelopment, 0.07),
    talentConversion: gradual(
      base.talentConversion,
      (profile.youthDevelopment + profile.coachEducation) / 2,
      0.06,
    ),
    notes: `Generated from federation governance foundation (${seed}).`,
  });
  for (const academy of academyRows(db)) {
    const current = youth.academyProfiles().find((item) => item.academyId === academy.id);
    const profileValue = current ?? generatedAcademyProfile(academy, federation.countryId);
    youth.upsertAcademySimulationProfile({
      ...profileValue,
      youthRecruitmentQuality: gradual(
        profileValue.youthRecruitmentQuality,
        profile.youthDevelopment,
        0.04,
      ),
      academyCoachingQuality: gradual(
        profileValue.academyCoachingQuality,
        profile.coachEducation,
        0.04,
      ),
      academyFacilitiesQuality: gradual(
        profileValue.academyFacilitiesQuality,
        profile.infrastructureLevel,
        0.03,
      ),
      regionalReach: gradual(profileValue.regionalReach, profile.grassrootsDevelopment, 0.04),
      talentIdentificationQuality: gradual(
        profileValue.talentIdentificationQuality,
        profile.youthDevelopment,
        0.04,
      ),
    });
  }
};

const applyProjectImpact = (db: GameDatabase, project: FederationProject, date: string): void => {
  const repo = new FederationGovernanceRepository(db);
  const profile = repo.profile(project.federationId);
  if (!profile) return;
  repo.upsertProfile({
    ...profile,
    grassrootsDevelopment: clamp(
      profile.grassrootsDevelopment + (project.impactJson.grassrootsReach ?? 0) * 0.25,
    ),
    youthDevelopment: clamp(
      profile.youthDevelopment + (project.impactJson.youthDevelopment ?? 0) * 0.25,
    ),
    coachEducation: clamp(profile.coachEducation + (project.impactJson.coachEducation ?? 0) * 0.2),
    refereeDevelopment: clamp(
      profile.refereeDevelopment + (project.impactJson.refereeDevelopment ?? 0) * 0.2,
    ),
    commercialStrength: clamp(
      profile.commercialStrength + (project.impactJson.commercialStrength ?? 0) * 0.15,
    ),
    infrastructureLevel: clamp(
      profile.infrastructureLevel + (project.impactJson.infrastructureLevel ?? 0) * 0.25,
    ),
    lastUpdatedAt: date,
  });
  applyDevelopmentEnvironmentFromFederation(db, project.federationId, date, project.id);
};

const runFederationAiMonth = (
  db: GameDatabase,
  federationId: EntityId,
  date: string,
  seed: string,
): void => {
  const repo = new FederationGovernanceRepository(db);
  const profile = repo.profile(federationId);
  const account = repo.financialAccount(federationId);
  if (!profile || !account || account.cashBalance < reserveFloor(account) + 1200000) return;
  if (
    date.endsWith("-09-28") &&
    repo.projects(federationId).filter((project) => project.status !== "COMPLETED").length < 2
  ) {
    const weakProject =
      profile.infrastructureLevel < 1
        ? "NATIONAL_TRAINING_CENTRE"
        : profile.grassrootsDevelopment < 1
          ? "REGIONAL_CENTRE"
          : profile.refereeDevelopment < profile.coachEducation
            ? "REFEREE_PROGRAMME"
            : profile.youthDevelopment < profile.coachEducation
              ? "ACADEMY_EXPANSION"
              : "COACH_EDUCATION";
    createFederationProject(db, {
      federationId,
      projectType: weakProject,
      name: `${weakProject.replaceAll("_", " ")} ${date.slice(0, 4)}`,
      date,
      seed,
    });
  }
  if (date.endsWith("-12-28")) {
    distributeEligibleClubGrants(db, {
      federationId,
      date,
      amount: 250000,
      grantType: "CLUB_DEVELOPMENT_GRANT",
    });
  }
  if (date.endsWith("-11-28")) {
    const team = seniorMenNationalTeam(db, federationId);
    const callups = selectNationalTeamSquad(db, {
      federationId,
      nationalTeamId: team.id,
      date,
      programme: `AI federation friendly window ${date.slice(0, 4)}`,
      seed,
    });
    // A lightweight/imported federation may have no real eligible squad.
    // Do not ask match lineup repair to invent replacement IDs that cannot
    // participate in canonical national-team history.
    if (callups.length < 11) return;
    const friendly = scheduleFriendly(db, {
      federationId,
      nationalTeamId: team.id,
      opponentName: `Regional Friendly Opponent ${date.slice(0, 4)}`,
      date: addDays(date, 7),
      seed,
    });
    playNationalTeamFixture(db, friendly.id, seed);
  }
};

const investInDevelopmentEnvironment = (
  db: GameDatabase,
  federationId: EntityId,
  date: string,
): void => {
  const repo = new FederationGovernanceRepository(db);
  const federation = federationById(db, federationId);
  const account = repo.financialAccount(federationId);
  if (!account) return;
  const budgets = repo
    .budgets(federationId)
    .filter((budget) => budget.seasonLabel === seasonLabel(date));
  const youthBudget =
    budgets.find((budget) => budget.category === "YOUTH_DEVELOPMENT")?.amount ?? 0;
  const grassrootsBudget = budgets.find((budget) => budget.category === "GRASSROOTS")?.amount ?? 0;
  const coachBudget = budgets.find((budget) => budget.category === "COACH_EDUCATION")?.amount ?? 0;
  const amount = Math.min(
    Math.round((youthBudget + grassrootsBudget + coachBudget) / 18),
    Math.max(0, account.cashBalance - reserveFloor(account)),
  );
  if (amount <= 0) return;
  postFederationTransaction(db, {
    federationId,
    date,
    category: "YOUTH_DEVELOPMENT",
    direction: "DEBIT",
    amount,
    description: "Annual development environment investment tranche",
    idempotencyKey: `development-investment:${date}`,
  });
  repo.addBudgetUsage(
    federationId,
    seasonLabel(date),
    "YOUTH_DEVELOPMENT",
    Math.round(amount * 0.55),
  );
  repo.addBudgetUsage(federationId, seasonLabel(date), "GRASSROOTS", Math.round(amount * 0.3));
  repo.addBudgetUsage(
    federationId,
    seasonLabel(date),
    "COACH_EDUCATION",
    Math.round(amount * 0.15),
  );

  const youth = new YouthRepository(db);
  const current = youth.latestCountryDevelopmentProfile(federation.countryId);
  if (!current) return;
  const intensity = Math.min(0.16, amount / 50000000);
  youth.upsertCountryDevelopmentProfile({
    ...current,
    id: createStableEntityId("country-development", `${federation.countryId}:${date}:investment`),
    effectiveFrom: date,
    footballPopularity: round(clamp(current.footballPopularity + intensity * 1.2)),
    grassrootsReach: round(clamp(current.grassrootsReach + intensity * 2.2)),
    coachingQuality: round(clamp(current.coachingQuality + intensity * 1.4)),
    youthInfrastructure: round(clamp(current.youthInfrastructure + intensity * 1.7)),
    talentConversion: round(clamp(current.talentConversion + intensity * 1.5)),
    notes: "Gradual federation development investment effect.",
  });
};

const updateFederationKpis = (
  db: GameDatabase,
  federationId: EntityId,
  season: string,
  date: string,
): void => {
  const repo = new FederationGovernanceRepository(db);
  const profile = repo.profile(federationId);
  const account = repo.financialAccount(federationId);
  if (!profile || !account) return;
  const youthProfile = new YouthRepository(db).latestCountryDevelopmentProfile(
    federationById(db, federationId).countryId,
  );
  const metrics: Array<[FederationKPI["metric"], number]> = [
    ["REGISTERED_CLUBS", allClubs(db).length],
    ["ACTIVE_YOUTH_PLAYERS", countRows(db, "generated_player_origins")],
    [
      "LICENSED_COACHES",
      repo
        .coachEducationProgrammes(federationId)
        .reduce((total, item) => total + item.graduates, 0),
    ],
    [
      "REFEREE_POOL",
      countRows(db, "referee_profiles") +
        repo
          .refereeDevelopmentProgrammes(federationId)
          .reduce((total, item) => total + item.refereesAdvanced, 0),
    ],
    ["ACADEMY_OUTPUT", countRows(db, "youth_intake_events")],
    ["LEAGUE_ATTENDANCE", countRows(db, "fixtures") * 180],
    [
      "COMMERCIAL_REVENUE",
      repo
        .ledgerEntries(federationId)
        .filter((entry) => ["SPONSORSHIP", "BROADCASTING", "STREAMING"].includes(entry.category))
        .reduce((total, entry) => total + entry.amount, 0),
    ],
    ["NATIONAL_TEAM_REPUTATION", profile.reputation],
    [
      "INTERNATIONAL_WINS",
      nationalTeamOutcomes(db, federationId).filter((played) => played.result === "WIN").length,
    ],
    ["INFRASTRUCTURE_SCORE", profile.infrastructureLevel],
    [
      "WOMENS_FOOTBALL_SUPPORT",
      repo
        .budgets(federationId)
        .filter((budget) => budget.category === "WOMENS_FOOTBALL")
        .reduce((total, item) => total + item.amount, 0) /
        1000000 +
        (youthProfile?.footballPopularity ?? 0) * 0.05,
    ],
  ];
  for (const [metric, value] of metrics) {
    repo.upsertKpi({
      id: createStableEntityId("federation-kpi", `${federationId}:${season}:${metric}`),
      federationId,
      seasonLabel: season,
      metric,
      value: round(value),
      measuredAt: date,
      status: simulationStatus,
    });
  }
};

const createDemoPresident = (db: GameDatabase, federation: Federation, date: string): Person => {
  const world = new WorldRepository(db);
  const person: Person = {
    id: createStableEntityId("person", `federation-president-demo:${federation.id}`),
    fullName: `${homeFederationAbbreviation(db)} President Demo`,
    displayName: "President Demo",
    dateOfBirth: "1975-01-01",
    nationalityCountryId: federation.countryId,
    genderPresentation: "unknown",
    languages: [...homeNamePool(db).languageNames, "English"],
  };
  if (!world.getPerson(person.id)) {
    world.insertPerson(person);
    world.insertPersonRole({
      id: createStableEntityId("person-role", `${person.id}:FEDERATION_OFFICIAL`),
      personId: person.id,
      role: "FEDERATION_OFFICIAL",
      activeFrom: date,
    });
  }
  const repo = new FederationGovernanceRepository(db);
  repo.upsertLeadershipTenure({
    id: createStableEntityId(
      "federation-leadership",
      `${federation.id}:${person.id}:president:${date}`,
    ),
    personId: person.id,
    federationId: federation.id,
    role: "FEDERATION_PRESIDENT",
    termStart: date,
    termEnd: addYears(date, 4),
    status: "ACTIVE",
    provenanceStatus: simulationStatus,
  });
  world.insertStaffAppointment({
    id: createStableEntityId(
      "staff-appointment",
      `${person.id}:${federation.id}:federation-president:${date}`,
    ),
    personId: person.id,
    organisationType: "FEDERATION",
    federationId: federation.id,
    role: "FEDERATION_PRESIDENT",
    startDate: date,
    employmentStatus: "ACTIVE",
  });
  return person;
};

const federationReport = (
  db: GameDatabase,
  federationId: EntityId,
  date: string,
  seasons: number,
): FederationDiagnosticReport => {
  const repo = new FederationGovernanceRepository(db);
  const account = repo.financialAccount(federationId)!;
  const federation = federationById(db, federationId);
  const fixtures = repo
    .nationalTeamFixtures()
    .filter((fixture) => fixture.federationId === federationId);
  return {
    date,
    seasons,
    federationName: federation.name,
    cashBalance: account.cashBalance,
    financialHealth: account.financialHealth,
    ledgerEntries: repo.ledgerEntries(federationId).length,
    statements: repo.financialStatements(federationId).length,
    projects: repo.projects(federationId).length,
    completedProjects: repo
      .projects(federationId)
      .filter((project) => project.status === "COMPLETED").length,
    clubGrants: repo.grantDistributions(federationId).length,
    nationalTeamFixtures: fixtures.length,
    nationalTeamWins: nationalTeamOutcomes(db, federationId).filter((played) => played.result === "WIN").length,
    callups: repo.nationalTeamCallups().length,
    coachGraduates: repo
      .coachEducationProgrammes(federationId)
      .reduce((total, item) => total + item.graduates, 0),
    refereesAdvanced: repo
      .refereeDevelopmentProgrammes(federationId)
      .reduce((total, item) => total + item.refereesAdvanced, 0),
    reforms: repo.competitionReforms(federationId).length,
    licensingAssessments: repo.licensingAssessments(federationId).length,
    youthEnvironment: new YouthRepository(db).latestCountryDevelopmentProfile(federation.countryId),
    kpis: repo.kpis(federationId),
  };
};

type NationalTeamSelectionCandidate = PlayerAttributeSet & {
  internationalSelectionScore: number;
};

const eligiblePlayerAttributes = (
  db: GameDatabase,
  countryId: EntityId,
  federationId: EntityId,
  date: string,
  team: Team,
): PlayerAttributeSet[] => {
  const repo = new FederationGovernanceRepository(db);
  const priorEligibility = new Map(
    repo.internationalEligibilities(federationId).map((item) => [item.playerId, item]),
  );
  const retired = new Set(
    (
      db
        .prepare(
          "SELECT player_id FROM international_retirements WHERE national_team_id = ? AND status = 'RETIRED_INTERNATIONAL'",
        )
        .all(team.id) as Array<{ player_id: EntityId }>
    ).map((row) => row.player_id),
  );
  const seniorCallups =
    team.level === "senior"
      ? new Set<EntityId>()
      : new Set(
          (
            db
              .prepare(
                `SELECT c.player_id
                 FROM national_team_callups c
                 JOIN teams t ON t.id = c.national_team_id
                 WHERE t.federation_id = ? AND t.level = 'senior' AND t.gender = 'men'
                   AND c.status = 'CALLED_UP' AND c.callup_date <= ?`,
              )
              .all(federationId, date) as Array<{ player_id: EntityId }>
          ).map((row) => row.player_id),
        );
  const rows = db
    .prepare(
      `SELECT pa.*, p.nationality_country_id, p.second_nationality_country_id,
        p.gender_presentation, p.date_of_birth,
        COALESCE((SELECT s.fitness FROM player_availability_states s WHERE s.person_id = p.id ORDER BY s.updated_on DESC LIMIT 1), 100) AS fitness,
        COALESCE((SELECT s.form_modifier FROM player_availability_states s WHERE s.person_id = p.id ORDER BY s.updated_on DESC LIMIT 1), 0) AS form_modifier
      FROM player_attributes pa
      JOIN persons p ON p.id = pa.person_id
      JOIN person_roles pr ON pr.person_id = p.id AND pr.role = 'PLAYER' AND pr.active_to IS NULL
      WHERE (p.nationality_country_id = ? OR p.second_nationality_country_id = ?)
        AND (? = 'women' AND p.gender_presentation = 'female'
          OR ? != 'women' AND COALESCE(p.gender_presentation, 'male') != 'female')
        AND NOT EXISTS (
          SELECT 1 FROM injuries i
          WHERE i.person_id = p.id AND i.date_occurred <= ? AND i.expected_recovery_date >= ?
        )
        AND COALESCE((SELECT s.availability FROM player_availability_states s WHERE s.person_id = p.id ORDER BY s.updated_on DESC LIMIT 1), 'AVAILABLE') = 'AVAILABLE'
      ORDER BY pa.person_id`,
    )
    .all(countryId, countryId, team.gender, team.gender, date, date) as Array<any>;

  return rows.flatMap((row): NationalTeamSelectionCandidate[] => {
    if (retired.has(row.person_id) || seniorCallups.has(row.person_id)) return [];
    const existing = priorEligibility.get(row.person_id);
    const derivedStatus =
      row.nationality_country_id === countryId
        ? "ELIGIBLE"
        : row.second_nationality_country_id === countryId
          ? "DOCUMENTATION_REQUIRED"
          : "UNKNOWN";
    const status =
      existing && ["CAP_TIED", "INELIGIBLE", "DOCUMENTATION_REQUIRED"].includes(existing.status)
        ? existing.status
        : derivedStatus;
    if (!existing || existing.status !== status) {
      repo.upsertInternationalEligibility({
        id: createStableEntityId("international-eligibility", `${federationId}:${row.person_id}`),
        playerId: row.person_id,
        federationId,
        status,
        documentationStatus: status === "ELIGIBLE" ? "CONFIRMED" : "IN_PROGRESS",
        discoveredVia: status === "ELIGIBLE" ? "NATIONALITY" : "DIASPORA_SCOUTING",
        lastReviewedAt: date,
        provenanceStatus: status === "ELIGIBLE" ? "REPORTED" : simulationStatus,
      });
    }
    if (status !== "ELIGIBLE" || !eligibleForNationalTeamAge(row.date_of_birth, team.level, date)) {
      return [];
    }
    const player: NationalTeamSelectionCandidate = {
      id: row.id,
      personId: row.person_id,
      primaryPosition: row.primary_position,
      secondaryPositions: JSON.parse(row.secondary_positions_json ?? "[]"),
      technical: JSON.parse(row.technical_json),
      mental: JSON.parse(row.mental_json),
      physical: JSON.parse(row.physical_json),
      goalkeeping: JSON.parse(row.goalkeeping_json),
      internationalSelectionScore: 0,
    };
    player.internationalSelectionScore =
      basePlayerScore(player) +
      Math.max(-2, Math.min(2, (Number(row.fitness) - 70) / 15)) +
      Number(row.form_modifier) * 0.12;
    return [player];
  });
};

export const eligibleForNationalTeamAge = (
  dateOfBirth: string | undefined | null,
  level: Team["level"],
  referenceDate: string,
): boolean => {
  const maximumAge = teamLevelAgeCap(level);
  if (maximumAge === undefined) return true;
  if (!dateOfBirth) return false;
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  const reference = new Date(`${referenceDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime())) return false;
  const age =
    reference.getUTCFullYear() -
    birth.getUTCFullYear() -
    (reference.getUTCMonth() < birth.getUTCMonth() ||
    (reference.getUTCMonth() === birth.getUTCMonth() && reference.getUTCDate() < birth.getUTCDate())
      ? 1
      : 0);
  return age >= 0 && age <= maximumAge;
};

const allPlayerAttributes = (db: GameDatabase): PlayerAttributeSet[] =>
  db
    .prepare("SELECT * FROM player_attributes ORDER BY person_id")
    .all()
    .map((row: any) => ({
      id: row.id,
      personId: row.person_id,
      primaryPosition: row.primary_position,
      secondaryPositions: JSON.parse(row.secondary_positions_json ?? "[]"),
      technical: JSON.parse(row.technical_json),
      mental: JSON.parse(row.mental_json),
      physical: JSON.parse(row.physical_json),
      goalkeeping: JSON.parse(row.goalkeeping_json),
    }));

const balancedSelection = (
  players: readonly PlayerAttributeSet[],
  size: number,
): PlayerAttributeSet[] => {
  const byPosition = (positions: string[]) =>
    players
      .filter((player) => positions.includes(player.primaryPosition))
      .sort((a, b) => playerScore(b) - playerScore(a));
  const selected: PlayerAttributeSet[] = [];
  for (const group of [
    byPosition(["GK"]).slice(0, 3),
    byPosition(["CB", "LB", "RB"]).slice(0, 7),
    byPosition(["DM", "CM", "AM"]).slice(0, 7),
    byPosition(["LW", "RW", "ST"]).slice(0, 6),
  ]) {
    selected.push(...group);
  }
  const seen = new Set<EntityId>();
  return selected
    .concat([...players].sort((a, b) => playerScore(b) - playerScore(a)))
    .filter((player) => {
      if (seen.has(player.personId)) return false;
      seen.add(player.personId);
      return true;
    })
    .slice(0, size);
};

const playerScore = (player: PlayerAttributeSet): number => {
  const internationalScore = (player as Partial<NationalTeamSelectionCandidate>)
    .internationalSelectionScore;
  if (internationalScore !== undefined) return internationalScore;
  return basePlayerScore(player);
};

const basePlayerScore = (player: PlayerAttributeSet): number => {
  const technical = average(Object.values(player.technical));
  const mental = average(Object.values(player.mental));
  const physical = average(Object.values(player.physical));
  const goalkeeping = average(Object.values(player.goalkeeping));
  const positionWeight = player.primaryPosition === "GK" ? goalkeeping * 0.42 : technical * 0.36;
  return positionWeight + mental * 0.3 + physical * 0.24 + player.mental.teamwork * 0.04;
};

const generatedOpponentPlayers = (
  fixture: NationalTeamFixture,
  seed: string,
): PlayerAttributeSet[] => {
  const positions = [
    "GK",
    "GK",
    "CB",
    "CB",
    "LB",
    "RB",
    "DM",
    "CM",
    "CM",
    "AM",
    "LW",
    "RW",
    "ST",
    "ST",
    "CB",
    "CM",
    "ST",
  ];
  const rng = seeded(seed, fixture.opponentName);
  return positions.map((position, index) =>
    generatedPlayerAttributes(
      createStableEntityId("person", `opponent:${fixture.id}:${index}`),
      position as PlayerAttributeSet["primaryPosition"],
      7.2 + rng.next() * 2.2,
    ),
  );
};

const generatedPlayerAttributes = (
  personId: EntityId,
  position: PlayerAttributeSet["primaryPosition"],
  base: number,
): PlayerAttributeSet => {
  const value = (offset: number) => round(Math.max(3, Math.min(15, base + offset)));
  return {
    id: createStableEntityId("player-attributes", `${personId}:national-opponent`),
    personId,
    primaryPosition: position,
    secondaryPositions: [],
    technical: {
      firstTouch: value(0.2),
      passing: value(0.1),
      crossing: value(-0.1),
      dribbling: value(0),
      finishing: value(position === "ST" ? 1 : -0.4),
      heading: value(position === "CB" ? 0.8 : 0),
      tackling: value(["CB", "LB", "RB", "DM"].includes(position) ? 0.8 : -0.3),
      technique: value(0.1),
      longShots: value(-0.2),
      setPieces: value(-0.1),
    },
    mental: {
      decisions: value(0.2),
      vision: value(0),
      composure: value(0.1),
      positioning: value(0.2),
      anticipation: value(0.2),
      workRate: value(0.3),
      teamwork: value(0.3),
      leadership: value(-0.2),
      aggression: value(0),
      determination: value(0.4),
      professionalism: value(0.2),
    },
    physical: {
      pace: value(0.1),
      acceleration: value(0.1),
      strength: value(position === "CB" ? 0.7 : 0),
      stamina: value(0.2),
      agility: value(0),
      balance: value(0),
      jumping: value(position === "CB" ? 0.7 : 0),
      naturalFitness: value(0.1),
    },
    goalkeeping: {
      handling: value(position === "GK" ? 1 : -2),
      reflexes: value(position === "GK" ? 1 : -2),
      oneOnOnes: value(position === "GK" ? 0.8 : -2),
      aerialReach: value(position === "GK" ? 0.6 : -2),
      kicking: value(position === "GK" ? 0.2 : -2),
      distribution: value(position === "GK" ? 0.2 : -2),
      commandOfArea: value(position === "GK" ? 0.4 : -2),
    },
  };
};

const adjustReputationAfterResult = (
  db: GameDatabase,
  federationId: EntityId,
  fixture: NationalTeamFixture,
  date: string,
): void => {
  const repo = new FederationGovernanceRepository(db);
  const profile = repo.profile(federationId);
  if (!profile || fixture.homeGoals === undefined || fixture.awayGoals === undefined) return;
  const delta =
    fixture.homeGoals > fixture.awayGoals
      ? 0.06
      : fixture.homeGoals === fixture.awayGoals
        ? 0.02
        : -0.03;
  repo.upsertProfile({
    ...profile,
    reputation: clamp(profile.reputation + delta),
    commercialStrength: clamp(profile.commercialStrength + delta * 0.5),
    internationalRelations: clamp(profile.internationalRelations + Math.max(0, delta) * 0.4),
    lastUpdatedAt: date,
  });
};

const projectCost = (type: FederationProjectType, rng: SeededRandom): number => {
  const base =
    type === "NATIONAL_TRAINING_CENTRE"
      ? 22000000
      : type === "REGIONAL_CENTRE"
        ? 7600000
        : type === "ACADEMY_EXPANSION"
          ? 4200000
          : type === "DIGITAL_BROADCAST"
            ? 2800000
            : 1600000;
  return Math.round(base * (0.88 + rng.next() * 0.24));
};

const federationProjectComponents = (type: FederationProjectType): string[] => {
  switch (type) {
    case "NATIONAL_TRAINING_CENTRE": return ["national_pitches", "gym", "medical_suite", "coach_classrooms", "referee_classrooms"];
    case "REGIONAL_CENTRE": return ["training_pitch", "talent_hub", "coach_classroom"];
    case "COACH_EDUCATION": return ["classrooms", "analysis_suite", "library"];
    case "REFEREE_PROGRAMME": return ["referee_classroom", "fitness_lab", "video_review"];
    case "WOMENS_DEVELOPMENT": return ["women_training_slots", "safeguarding_office"];
    case "ACADEMY_EXPANSION": return ["youth_pitches", "education_rooms", "lodging"];
    default: return [type.toLowerCase()];
  }
};

const federationProjectUtilisation = (type: FederationProjectType): Record<string, number> => ({
  nationalTeamCamps: type === "NATIONAL_TRAINING_CENTRE" ? 12 : 0,
  regionalProgrammes: type === "REGIONAL_CENTRE" ? 8 : 0,
  coachCourses: type === "COACH_EDUCATION" || type === "NATIONAL_TRAINING_CENTRE" ? 6 : 0,
  refereeCourses: type === "REFEREE_PROGRAMME" || type === "NATIONAL_TRAINING_CENTRE" ? 6 : 0,
  youthProgrammes: ["ACADEMY_EXPANSION", "REGIONAL_CENTRE", "NATIONAL_TRAINING_CENTRE"].includes(type) ? 10 : 0,
  womensProgrammes: type === "WOMENS_DEVELOPMENT" ? 10 : 0,
});

const projectImpact = (type: FederationProjectType): Record<string, number> => {
  switch (type) {
    case "GRASSROOTS_PROGRAMME":
      return { grassrootsReach: 0.6, youthDevelopment: 0.25, footballPopularity: 0.2 };
    case "COACH_EDUCATION":
      return { coachEducation: 0.55, youthDevelopment: 0.15 };
    case "REFEREE_PROGRAMME":
      return { refereeDevelopment: 0.6, competitionOrganisation: 0.15 };
    case "ACADEMY_EXPANSION":
      return { youthDevelopment: 0.5, infrastructureLevel: 0.2 };
    case "NATIONAL_TRAINING_CENTRE":
      return { infrastructureLevel: 0.7, youthDevelopment: 0.25, coachEducation: 0.2 };
    case "REGIONAL_CENTRE":
      return { infrastructureLevel: 0.45, grassrootsReach: 0.35, youthDevelopment: 0.2 };
    case "WOMENS_DEVELOPMENT":
      return { grassrootsReach: 0.25, youthDevelopment: 0.25, footballPopularity: 0.35 };
    case "DIGITAL_BROADCAST":
      return { commercialStrength: 0.5, footballPopularity: 0.25 };
    case "CLUB_SUPPORT_PROGRAMME":
      return { competitionOrganisation: 0.3, youthDevelopment: 0.15 };
  }
};

const projectLedgerCategory = (type: FederationProjectType): FederationLedgerCategory => {
  if (type === "COACH_EDUCATION") return "COACH_EDUCATION";
  if (type === "REFEREE_PROGRAMME") return "REFEREE_DEVELOPMENT";
  if (type === "ACADEMY_EXPANSION") return "ACADEMY";
  if (type === "GRASSROOTS_PROGRAMME" || type === "WOMENS_DEVELOPMENT") return "YOUTH_DEVELOPMENT";
  if (type === "DIGITAL_BROADCAST") return "COMMERCIAL";
  if (type === "CLUB_SUPPORT_PROGRAMME") return "CLUB_GRANTS";
  return "INFRASTRUCTURE";
};

const allFederations = (db: GameDatabase): Federation[] =>
  db.prepare("SELECT * FROM federations ORDER BY name").all().map(mapFederation);

// Real Nepal clubs only — federation licensing/registration is a domestic
// process; a CONTEXT_ONLY foreign club (external_club_context) was never
// registered with this federation and must never be counted or assessed
// as if it were.
const allClubs = (db: GameDatabase): Club[] =>
  db
    .prepare(
      "SELECT c.* FROM clubs c WHERE NOT EXISTS (SELECT 1 FROM external_club_context ecc WHERE ecc.club_id = c.id) ORDER BY c.name",
    )
    .all()
    .map((row: any) => ({
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
    }));

const federationById = (db: GameDatabase, federationId: EntityId): Federation => {
  const row = db.prepare("SELECT * FROM federations WHERE id = ?").get(federationId) as any;
  if (!row) throw new Error(`Federation ${federationId} not found`);
  return mapFederation(row);
};

const mapFederation = (row: any): Federation => ({
  id: row.id,
  countryId: row.country_id,
  name: row.name,
  foundedYear: row.founded_year ?? undefined,
});

const teamById = (db: GameDatabase, teamId: EntityId): Team => {
  const row = db.prepare("SELECT * FROM teams WHERE id = ?").get(teamId) as any;
  if (!row) throw new Error(`Team ${teamId} not found`);
  return {
    id: row.id,
    clubId: row.club_id ?? undefined,
    federationId: row.federation_id ?? undefined,
    name: row.name,
    canonicalExternalId: row.canonical_external_id ?? undefined,
    level: row.level,
    gender: row.gender,
  };
};

const seniorMenNationalTeam = (db: GameDatabase, federationId: EntityId): Team => {
  const row = db
    .prepare(
      "SELECT * FROM teams WHERE federation_id = ? AND club_id IS NULL AND level = 'senior' AND gender = 'men' ORDER BY name LIMIT 1",
    )
    .get(federationId) as any;
  if (!row) throw new Error("Senior men national team is missing");
  return teamById(db, row.id);
};

const competitionByName = (db: GameDatabase, name: string): { id: EntityId; name: string } => {
  const row = db
    .prepare("SELECT id, name FROM competitions WHERE name = ? LIMIT 1")
    .get(name) as any;
  if (!row) throw new Error(`Competition ${name} not found`);
  return row;
};

const currentMembershipCount = (db: GameDatabase, seasonId: EntityId): number =>
  (
    db
      .prepare("SELECT COUNT(*) AS count FROM club_memberships WHERE competition_season_id = ?")
      .get(seasonId) as { count: number }
  ).count;

const seasonHasHistoricalMatches = (db: GameDatabase, seasonId: EntityId): boolean =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS count
      FROM matches m
      JOIN fixtures f ON f.id = m.fixture_id
      WHERE f.competition_season_id = ?`,
      )
      .get(seasonId) as { count: number }
  ).count > 0;

const academyRows = (
  db: GameDatabase,
): Array<{ id: EntityId; country_id: EntityId; academy_type: string }> =>
  db.prepare("SELECT id, country_id, academy_type FROM academies ORDER BY name").all() as Array<{
    id: EntityId;
    country_id: EntityId;
    academy_type: string;
  }>;

const generatedAcademyProfile = (
  academy: { id: EntityId; country_id: EntityId; academy_type: string },
  countryId: EntityId,
): AcademySimulationProfile => ({
  id: createStableEntityId("academy-simulation-profile", `${academy.id}:federation-foundation`),
  academyId: academy.id,
  countryId,
  youthRecruitmentQuality: academy.academy_type === "NATIONAL_ACADEMY" ? 5.8 : 4.8,
  academyCoachingQuality: academy.academy_type === "NATIONAL_ACADEMY" ? 5.7 : 4.7,
  academyFacilitiesQuality: academy.academy_type === "NATIONAL_ACADEMY" ? 5.6 : 4.6,
  regionalReach: academy.academy_type === "REGIONAL_ACADEMY" ? 5.6 : 4.7,
  talentIdentificationQuality: academy.academy_type === "NATIONAL_ACADEMY" ? 5.5 : 4.6,
  status: simulationStatus,
});

const countRows = (db: GameDatabase, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

const categoryTotals = (
  entries: readonly FederationLedgerEntry[],
  direction: FederationLedgerDirection,
): Record<string, number> => {
  const totals: Record<string, number> = {};
  for (const entry of entries.filter((item) => item.direction === direction)) {
    totals[entry.category] = (totals[entry.category] ?? 0) + entry.amount;
  }
  return totals;
};

const sumValues = (values: Record<string, number>): number =>
  Object.values(values).reduce((total, value) => total + value, 0);

const reserveFloor = (account: FederationFinancialAccount): number =>
  account.financialHealth === "DISTRESSED" || account.financialHealth === "INSOLVENT" ? 0 : 1500000;

const federationFinancialHealth = (cash: number, debt: number, priceLevel = 1): FederationFinancialHealth => {
  const net = cash - debt;
  if (net < 0) return "INSOLVENT";
  if (net < scaleAmount(priceLevel, 800000)) return "DISTRESSED";
  if (net < scaleAmount(priceLevel, 2500000)) return "TIGHT";
  if (net < scaleAmount(priceLevel, 9000000)) return "STABLE";
  if (net < scaleAmount(priceLevel, 22000000)) return "HEALTHY";
  return "EXCELLENT";
};

const gradual = (current: number, target: number, rate: number): number =>
  round(clamp(current + (target - current) * rate));

const clamp = (value: number): number => Math.max(1, Math.min(20, value));

const average = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

const seeded = (seed: string, key: string): SeededRandom =>
  new SeededRandom(`${seed}:federation:${key}`);

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

/**
 * A commercial rights package's own `scope` already distinguishes senior
 * national-team, youth, and women's & girls' programmes at creation time
 * (see ensureSeniorNationalTeamMainPartnerPackage /
 * ensureNationalProgrammePartnerPackage in commercial-rights.ts) — it is
 * "NATIONAL_TEAM" / "YOUTH" / "WOMENS" respectively, never a single shared
 * value re-split by category. Reading only `scope === "NATIONAL_TEAM"` as
 * the national-programme gate silently dropped every youth/women's package
 * to the FEDERATION fallback, since their own scope is "YOUTH"/"WOMENS",
 * not "NATIONAL_TEAM". This reads the package's real scope directly.
 */
const nationalProgrammeScopeFor = (
  rightsPackage: { scope: string } | undefined,
): "SENIOR_MENS" | "YOUTH" | "WOMENS_GIRLS" | undefined => {
  switch (rightsPackage?.scope) {
    case "NATIONAL_TEAM":
      return "SENIOR_MENS";
    case "YOUTH":
      return "YOUTH";
    case "WOMENS":
      return "WOMENS_GIRLS";
    default:
      return undefined;
  }
};
