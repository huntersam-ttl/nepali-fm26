import type { EntityId } from "./ids.js";
import type {
  FixtureRecord,
  InboxItem,
  ISODate,
  ManagerContract,
  ManagerProfile,
  MatchEvent,
  MatchResult,
  PlayerAttributeSet,
  SaveMetadata,
  TacticalSetup,
  FederationGovernanceProposal,
  ClubBudget,
  ClubBudgetCategory,
  InfrastructureProjectType,
  SponsorshipContract,
  SimulationClubRecord,
  ClubFinancialAccount,
  ClubLedgerEntry,
  ClubOwnershipStake,
  InfrastructureProject,
  Federation,
  FederationFinancialAccount,
  FederationFinancialStatement,
  FederationLedgerEntry,
  FederationLeadershipTenure,
  FederationProject,
  FederationSimulationProfile,
  FederationBudget,
  ClubDebt,
  ClubLoanApplication,
  ClubLender,
  ManagerBudgetRequest,
  ClubAsset,
  ProcurementCategory,
  ProcurementOrder,
  OwnershipInvestorMarketView,
  OwnershipAcquisitionOffer,
  StaffAppointment,
} from "./domain.js";
import type { ExecutiveAuthorityDesktopView } from "./executive-roles.js";
import type { FederationDevelopmentSummary } from "./federation-policy.js";

/**
 * Canonical desktop application contract.
 *
 * Both the runtime service (packages/simulation) and the desktop UI (apps/desktop)
 * import these types so the wire format cannot drift between them.
 */

export type DesktopErrorCode =
  | "SAVE_NOT_FOUND"
  | "SAVE_CORRUPT"
  | "SCHEMA_TOO_NEW"
  | "MIGRATION_FAILED"
  | "CAREER_CREATION_FAILED"
  | "DATABASE_ERROR"
  | "SESSION_NOT_OPEN"
  | "SIMULATION_ERROR"
  | "FIXTURE_MISSING"
  | "PLAYER_MISSING"
  | "INVALID_SELECTION"
  | "WORLD_DATA_UNAVAILABLE"
  | "RUNTIME_UNAVAILABLE"
  /** The active career role may not perform the requested action. */
  | "ROLE_NOT_AUTHORIZED"
  /** The fixture already has a result and cannot be played again. */
  | "MATCH_ALREADY_PLAYED"
  /** The selected fixture is not the manager's unresolved current matchday. */
  | "MATCHDAY_REQUIRED"
  // Interactive matchday failures.
  | "MATCH_NOT_ACTIVE"
  | "MATCH_ALREADY_COMPLETE"
  | "INVALID_SUBSTITUTION"
  | "SUBSTITUTION_LIMIT_REACHED"
  | "PLAYER_NOT_ON_PITCH"
  | "PLAYER_NOT_ON_BENCH"
  | "INVALID_TACTICAL_CHANGE"
  | "MATCH_NOT_AT_HALF_TIME";

export type DesktopAppError = {
  code: DesktopErrorCode;
  message: string;
  detail?: string;
};

export type AppResult<T> = { ok: true; data: T } | { ok: false; error: DesktopAppError };

export type CareerRole =
  | "MANAGER"
  | "CHAIRMAN_OWNER"
  | "FEDERATION_PRESIDENT"
  | "SPORTING_DIRECTOR"
  | "DIRECTOR_OF_FOOTBALL"
  | "CEO"
  | "GENERAL_SECRETARY";
export type CareerStartMode = "MANAGER" | "OWNER";
export type CareerRoleState = { activeRole: CareerRole; heldRoles: CareerRole[] };
export type FounderLocationOption = { id: EntityId; province: string; district: string; locality: string; provenanceStatus: "REPORTED" | "SIMULATION_ONLY" };
export type OwnerManagerCandidate = { vacancyId: EntityId; managerProfileId: EntityId; personId: EntityId; name: string; nationality: string; qualification: string; reputation: number; currentClub?: string; wageExpectation: number; available: boolean };

/** Save catalog entry. Readable without opening the full simulation world. */
export type SaveCatalogEntry = {
  saveId: EntityId;
  saveName: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  worldDate: string;
  characterName?: string;
  activeRole?: CareerRole;
  organisation?: string;
  gameVersion: string;
  schemaVersion: number;
  lastAutosaveAt?: string;
  lastAutosaveWorldDate?: string;
};

export type AutosaveSlotView = {
  slotIndex: number;
  savedAt: string;
};

export type AutosaveStatusView = {
  enabled: boolean;
  intervalDays: number;
  lastAutosaveAt?: string;
  lastAutosaveWorldDate?: string;
  slots: AutosaveSlotView[];
  slotCount: number;
};

export type StartingClubOption = {
  teamId: EntityId;
  clubId?: EntityId;
  clubName: string;
  teamName: string;
  competitionName: string;
  squadSize: number;
  division: string;
  locationName?: string;
  professionalStatus?: string;
};

export type CareerCreationCommand = {
  saveName: string;
  careerMode?: CareerStartMode;
  character: {
    fullName: string;
    preferredDisplayName?: string;
    dateOfBirth: ISODate;
    startingAge: number;
    languages: string[];
    footballBackground: string;
    education: string;
    playingExperience: string;
    coachingExperience: string;
    businessBackground: string;
    startingReputationProfile: string;
    careerStartDate?: ISODate;
  };
  joinTeamId?: EntityId;
  founder?: {
    clubName: string;
    shortName?: string;
    nickname?: string;
    locationId: EntityId;
    locationName?: string;
    groundName?: string;
    philosophy?: "COMMUNITY" | "YOUTH_DEVELOPMENT" | "COMPETITIVE" | "COMMERCIAL";
  };
};

export type SquadRow = {
  personId: EntityId;
  name: string;
  age?: number;
  nationality: string;
  positions: string[];
  preferredFoot: "Left" | "Right";
  fitness: number;
  form: number;
  morale: string;
  overall: number;
  roleSuitability: string;
  appearances: number;
  goals: number;
  assists: number;
  averageRating: number;
  availability: string;
};

export type FixtureReadModel = {
  id: EntityId;
  date: string;
  opponent: string;
  homeAway: "home" | "away";
  competition: string;
  status: FixtureRecord["status"];
  score?: string;
};

export type CompetitionView = {
  name: string;
  table: Array<{
    teamId: EntityId;
    teamName: string;
    played: number;
    goalDifference: number;
    points: number;
  }>;
};

export type PostMatchReadModel = {
  match: MatchResult["match"];
  homeTeam: string;
  awayTeam: string;
  events: MatchEvent[];
  score: string;
  homeStats: MatchResult["homeStats"];
  awayStats: MatchResult["awayStats"];
  playerRatings: Array<{ personId: EntityId; name: string; rating: number; minutes: number }>;
};

export type PlayerProfileReadModel = SquadRow & {
  attributes: PlayerAttributeSet;
  provenanceStatus?: string;
  matchStats: { minutes: number; yellowCards: number; redCards: number };
};

export type ChairmanDashboard = {
  role: "CHAIRMAN_OWNER";
  club: {
    id: EntityId;
    name: string;
    ownershipPercentage: number;
    controllingOwner: boolean;
    ownership: ClubOwnershipStake[];
  };
  finances: {
    account: ClubFinancialAccount;
    budgets: ClubBudget[];
    ledgerEntries: ClubLedgerEntry[];
    debts: ClubDebt[];
    loans: ClubLoanApplication[];
    lenders: ClubLender[];
    budgetRequests: ManagerBudgetRequest[];
  };
  investorMarket: OwnershipInvestorMarketView;
  infrastructure: InfrastructureProject[];
  equipment: ClubAsset[];
  sponsorships: SponsorshipContract[];
  manager?: { name: string; contract: ManagerContract };
  inbox: InboxItem[];
};

export type FederationNationalTeamSummary = {
  id: EntityId;
  name: string;
  level: string;
  gender: string;
  headCoach?: string;
};

export type FederationPresidentDashboard = {
  role: "FEDERATION_PRESIDENT";
  federation: Federation;
  profile: FederationSimulationProfile;
  finances: {
    account: FederationFinancialAccount;
    budgets: FederationBudget[];
    ledgerEntries: FederationLedgerEntry[];
    statements: FederationFinancialStatement[];
  };
  tenure?: FederationLeadershipTenure;
  proposals: FederationGovernanceProposal[];
  projects: FederationProject[];
  nationalTeams: FederationNationalTeamSummary[];
  inbox: InboxItem[];
};

export type FederationCandidacyAssessment = {
  eligible: boolean;
  reasons: string[];
  careerSeasons: number;
  reputation: number;
  nextElectionDate?: ISODate;
  candidateId?: EntityId;
};

export type E2ERoleFixtureResult = { ready: true };

/** Lightweight identity of the open career. Cheap enough for headers and menus. */
export type CareerHeader = {
  saveId: EntityId;
  saveName: string;
  worldDate: string;
  characterName: string;
  activeRole: CareerRole;
  clubName?: string;
  teamName?: string;
  competitionName?: string;
};

export type ManagerHomeReadModel = {
  save: SaveMetadata;
  manager: ManagerProfile;
  managerName: string;
  contract?: ManagerContract;
  clubName?: string;
  teamName?: string;
  nextFixture?: FixtureReadModel;
  previousResult?: PostMatchReadModel;
  inbox: InboxItem[];
  unavailablePlayers: SquadRow[];
  position?: string;
};

export type DesktopApplicationState = {
  save: SaveMetadata;
  header: CareerHeader;
  catalogEntry: SaveCatalogEntry;
  home: ManagerHomeReadModel;
  squad: SquadRow[];
  tactics: TacticalSetup[];
  activeTactic?: TacticalSetup;
  fixtures: FixtureReadModel[];
  competition: CompetitionView;
};

/**
 * Runtime command surface. The transport (HTTP sidecar today, Tauri IPC later)
 * must implement exactly this shape.
 */
export type DesktopRuntimeApi = {
  listSaves(): Promise<AppResult<SaveCatalogEntry[]>>;
  listStartingClubs(): Promise<AppResult<StartingClubOption[]>>;
  listFounderLocations(): Promise<AppResult<FounderLocationOption[]>>;
  listOwnerManagerCandidates(): Promise<AppResult<OwnerManagerCandidate[]>>;
  appointManager(vacancyId: EntityId, managerProfileId: EntityId): Promise<AppResult<ManagerContract>>;
  createCareer(command: CareerCreationCommand): Promise<AppResult<DesktopApplicationState>>;
  loadCareer(saveId: EntityId): Promise<AppResult<DesktopApplicationState>>;
  closeCareer(): Promise<AppResult<{ closed: boolean }>>;
  getCareerHeader(): Promise<AppResult<CareerHeader>>;
  getCareerRoles(): Promise<AppResult<CareerRoleState>>;
  getExecutiveAuthority(clubId?: EntityId): Promise<AppResult<ExecutiveAuthorityDesktopView | undefined>>;
  switchActiveCareerRole(targetRole: CareerRole): Promise<AppResult<CareerHeader>>;
  getChairmanDashboard(): Promise<AppResult<ChairmanDashboard>>;
  getFederationPresidentDashboard(): Promise<AppResult<FederationPresidentDashboard>>;
  getNationalDevelopment(): Promise<AppResult<FederationDevelopmentSummary>>;
  getFederationCandidacy(): Promise<AppResult<FederationCandidacyAssessment>>;
  declareFederationElectionCandidacy(): Promise<AppResult<FederationCandidacyAssessment>>;
  foundClub(name: string, locationName: string): Promise<AppResult<SimulationClubRecord>>;
  implementFederationGovernanceProposal(proposalId: EntityId): Promise<AppResult<FederationGovernanceProposal>>;
  setClubBudget(clubId: EntityId, seasonLabel: string, category: ClubBudgetCategory, amount: number): Promise<AppResult<ClubBudget>>;
  createInfrastructureProject(clubId: EntityId, projectType: InfrastructureProjectType): Promise<AppResult<InfrastructureProject>>;
  acceptSponsorOffer(clubId: EntityId, sponsorshipId: EntityId): Promise<AppResult<SponsorshipContract>>;
  rejectSponsorOffer(clubId: EntityId, sponsorshipId: EntityId): Promise<AppResult<SponsorshipContract>>;
  counterSponsorOffer(clubId: EntityId, sponsorshipId: EntityId, annualValue: number, endDate?: string): Promise<AppResult<SponsorshipContract>>;
  createInvestorStakeOffer(percentage: number, minimumAmount?: number): Promise<AppResult<OwnershipInvestorMarketView>>;
  decideInvestorBid(offerId: EntityId, accept: boolean): Promise<AppResult<OwnershipAcquisitionOffer>>;
  applyClubLoan(lenderId: EntityId, principal: number, termMonths: number, purpose: string): Promise<AppResult<ClubLoanApplication>>;
  repayClubLoan(debtId: EntityId, amount?: number): Promise<AppResult<ClubDebt>>;
  acceptExecutiveSponsorOffer(clubId: EntityId, sponsorshipId: EntityId): Promise<AppResult<SponsorshipContract>>;
  setExecutiveClubBudget(clubId: EntityId, seasonLabel: string, category: ClubBudgetCategory, amount: number): Promise<AppResult<ClubBudget>>;
  createExecutiveInfrastructureProject(clubId: EntityId, projectType: InfrastructureProjectType): Promise<AppResult<InfrastructureProject>>;
  applyExecutiveClubLoan(clubId: EntityId, lenderId: EntityId, principal: number, termMonths: number, purpose: string): Promise<AppResult<ClubLoanApplication>>;
  closeExecutiveLicence(caseId: EntityId): Promise<AppResult<unknown>>;
  registerExecutiveCompetitionPlayers(teamId: EntityId, competitionSeasonId: EntityId): Promise<AppResult<unknown>>;
  hireStaffAsExecutive(clubId: EntityId, personId: EntityId, role: StaffAppointment["role"], salaryAmountMinor: number, teamId?: EntityId, contractMonths?: number): Promise<AppResult<unknown>>;
  dismissStaffAsExecutive(clubId: EntityId, appointmentId: EntityId): Promise<AppResult<unknown>>;
  requestManagerBudget(seasonLabel: string, category: ClubBudgetCategory, requestedAmount: number): Promise<AppResult<ManagerBudgetRequest>>;
  decideManagerBudgetRequest(requestId: EntityId, approve: boolean): Promise<AppResult<ManagerBudgetRequest>>;
  purchaseEquipment(category: ProcurementCategory, quantity: number): Promise<AppResult<ProcurementOrder>>;
  getHomeDashboard(): Promise<AppResult<DesktopApplicationState>>;
  continueCareer(): Promise<AppResult<DesktopApplicationState>>;
  quickSimMatch(fixtureId?: EntityId): Promise<AppResult<DesktopApplicationState>>;
  saveTactic(tactic: TacticalSetup): Promise<AppResult<TacticalSetup>>;
  saveCareer(): Promise<AppResult<SaveCatalogEntry>>;
  saveCareerAs(saveName: string): Promise<AppResult<SaveCatalogEntry>>;
  deleteSave(saveId: EntityId): Promise<AppResult<{ deleted: boolean }>>;
  getAutosaveStatus(): Promise<AppResult<AutosaveStatusView>>;
  loadAutosaveSlot(slotIndex: number): Promise<AppResult<DesktopApplicationState>>;
};
