import type { EntityId } from "./ids.js";
import type { FixtureRow, LiveMatchView } from "./manager-contract.js";
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
  SponsorOrganisation,
  FederationSponsorshipContract,
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
  OwnerInvestmentTransaction,
  StaffAppointment,
  ManagerPromise,
} from "./domain.js";
import type { ExecutiveAuthorityDesktopView } from "./executive-roles.js";
import type { FederationDevelopmentSummary } from "./federation-policy.js";
import type { UniversalInteraction } from "./universal-interactions.js";
import type { EntityReference, EntityReferenceType } from "./entity-reference.js";
import type {
  OwnerManagerCommitmentInput,
  OwnerManagerMeetingOverview,
  OwnerManagerMeetingStance,
  OwnerManagerMeetingTopic,
} from "./owner-manager-meetings.js";
import type { GovernmentOverview, GovernmentFundingApplication, GovernmentFundingType } from "./government.js";
import type {
  FacilityFundingSource,
  FacilityProjectMode,
  FacilityProjectPlan,
  FacilityProjectScope,
  FacilitySiteOption,
} from "./facility-planning.js";

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

/**
 * Owner-facing matchday view: real fixtures/results for the owner's club,
 * read-only. The owner can watch a match through the same live/quick-sim
 * paths a manager uses, but never gets tactical authority — this view
 * carries no lineup/tactics fields at all, by construction.
 */
export type OwnerMatchdayView = {
  clubId: EntityId;
  clubName: string;
  teamId: EntityId;
  upcoming: FixtureRow[];
  results: FixtureRow[];
  currentFixtureId?: EntityId;
  positionContext?: { position: number; played: number; points: number };
};

/**
 * Facility planner read model. componentCatalog and homeDistrict are the
 * canonical engine's own defaults/geography — the UI must render only what
 * this lists, never a richer invented set. governmentApplications is
 * filtered to this club and will typically be empty today: no command lets
 * an Owner create one (requestGovernmentFunding is federation-president-only
 * and takes no clubId), so a government-review site stays honestly blocked
 * rather than bypassed. managerFacilityRequests surfaces any active
 * FACILITY_PROJECT commitment the manager raised through the owner-manager
 * meeting system, so the planner can show it is responding to a real
 * request instead of appearing unprompted.
 */
export type FacilityPlanningView = {
  clubId: EntityId;
  projects: InfrastructureProject[];
  plans: FacilityProjectPlan[];
  sites: FacilitySiteOption[];
  componentCatalog: Record<string, readonly string[]>;
  homeDistrict?: { districtId: EntityId; districtName: string; municipalityName: string };
  governmentApplications: GovernmentFundingApplication[];
  managerFacilityRequests: ManagerPromise[];
};

export type FacilityProjectPlanInput = {
  clubId: EntityId;
  projectType: InfrastructureProjectType;
  mode: FacilityProjectMode;
  scope: FacilityProjectScope;
  components?: string[];
  siteOptionId?: EntityId;
  fundingSource: FacilityFundingSource;
  financing?: Record<string, number>;
  governmentApplicationId?: EntityId;
  rationale: string;
  /** Computes and returns the real cost/duration bands without persisting anything — the planner's pre-commit summary step. */
  dryRun?: boolean;
};

export type FacilityProjectPlanResult = {
  project: InfrastructureProject;
  plan: FacilityProjectPlan;
  siteOption?: FacilitySiteOption;
};

/**
 * Bank-meeting read model, shared by the controlling owner and a CEO with
 * delegated BUDGET_ADMINISTRATION. headroom/maxNewPrincipal/maxTotalDebt are
 * the club's real, current affordability ceiling — the same numbers
 * applyForClubLoan itself decides approval with, never a fabricated score.
 */
export type ClubFinanceMeetingOverview = {
  clubId: EntityId;
  clubName: string;
  account: ClubFinancialAccount;
  debts: ClubDebt[];
  loans: ClubLoanApplication[];
  lenders: ClubLender[];
  existingDebt: number;
  maxNewPrincipal: number;
  maxTotalDebt: number;
  headroom: number;
};

/**
 * Investor-meeting read model, owner-only (ownership decisions carry no
 * delegable executive authority in the current authority model — see
 * ExecutiveAuthority). market is the same OwnershipInvestorMarketView the
 * owner dashboard already renders; this adds only the owner's own personal
 * cash and the majority-control threshold so the UI never hardcodes either.
 */
export type InvestorMeetingOverview = {
  clubId: EntityId;
  clubName: string;
  ownerPersonId: EntityId;
  ownerPersonalCash: number;
  majorityThreshold: number;
  market: OwnershipInvestorMarketView;
};

/**
 * A sponsorship contract with its sponsor's real identity attached — the
 * dashboard's own SponsorshipContract[] never carried the sponsor's name,
 * industry, or budget tier, so the sponsorship table couldn't say who the
 * deal was even with. Real company records (VERIFIED) and the simulation's
 * own local businesses (SIMULATION_ONLY) are both included as-is; nothing
 * here fabricates a company that doesn't exist in the sponsor registry.
 */
export type SponsorMeetingContract = SponsorshipContract & {
  sponsorName: string;
  sponsorIndustry: string;
  sponsorBudgetTier: SponsorOrganisation["budgetTier"];
  sponsorIdentityProvenance?: SponsorOrganisation["identityProvenance"];
};

export type SponsorMeetingOverview = {
  clubId: EntityId;
  clubName: string;
  offers: SponsorMeetingContract[];
  active: SponsorMeetingContract[];
  history: SponsorMeetingContract[];
};

/**
 * Federation-level commercial context is read-only: the one auto-generated
 * OFFICIAL_PARTNER sponsorship (ensureFederationSponsorship) is created and
 * activated in a single step with no offer/decision stage, and competition
 * media rights (settleFederationMediaRightsForCompetition) are likewise
 * created and awarded atomically. Neither has a negotiation lifecycle to
 * expose, so this is presented as information, never as a meeting.
 */
export type FederationCommercialOverview = {
  federationId: EntityId;
  sponsorship?: FederationSponsorshipContract & { sponsorName: string };
  mediaRights: Array<{
    packageName: string;
    broadcasterName: string;
    value: number;
    status: string;
    startDate?: string;
    endDate?: string;
  }>;
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
  getOwnerMatchday(): Promise<AppResult<OwnerMatchdayView>>;
  watchOwnerFixture(fixtureId?: EntityId): Promise<AppResult<LiveMatchView>>;
  quickSimOwnerFixture(fixtureId?: EntityId): Promise<AppResult<LiveMatchView>>;
  getEntityReference(entityType: EntityReferenceType, entityId: EntityId): Promise<AppResult<EntityReference>>;
  getFacilityPlanning(clubId?: EntityId): Promise<AppResult<FacilityPlanningView>>;
  getFacilitySiteOptions(clubId: EntityId, districtId?: EntityId, municipalityName?: string): Promise<AppResult<FacilitySiteOption[]>>;
  createFacilityProjectPlan(input: FacilityProjectPlanInput): Promise<AppResult<FacilityProjectPlanResult>>;
  getFederationPresidentDashboard(): Promise<AppResult<FederationPresidentDashboard>>;
  getNationalDevelopment(): Promise<AppResult<FederationDevelopmentSummary>>;
  getGovernmentOverview(): Promise<AppResult<GovernmentOverview>>;
  requestGovernmentFunding(
    institutionId: EntityId,
    fundingType: GovernmentFundingType,
    requestedAmount: number,
  ): Promise<AppResult<GovernmentFundingApplication>>;
  getClubFinanceMeeting(clubId?: EntityId): Promise<AppResult<ClubFinanceMeetingOverview>>;
  getFederationCandidacy(): Promise<AppResult<FederationCandidacyAssessment>>;
  declareFederationElectionCandidacy(): Promise<AppResult<FederationCandidacyAssessment>>;
  foundClub(name: string, locationName: string): Promise<AppResult<SimulationClubRecord>>;
  implementFederationGovernanceProposal(proposalId: EntityId): Promise<AppResult<FederationGovernanceProposal>>;
  setClubBudget(clubId: EntityId, seasonLabel: string, category: ClubBudgetCategory, amount: number): Promise<AppResult<ClubBudget>>;
  createInfrastructureProject(clubId: EntityId, projectType: InfrastructureProjectType): Promise<AppResult<InfrastructureProject>>;
  acceptSponsorOffer(clubId: EntityId, sponsorshipId: EntityId): Promise<AppResult<SponsorshipContract>>;
  rejectSponsorOffer(clubId: EntityId, sponsorshipId: EntityId): Promise<AppResult<SponsorshipContract>>;
  counterSponsorOffer(clubId: EntityId, sponsorshipId: EntityId, annualValue: number, endDate?: string): Promise<AppResult<SponsorshipContract>>;
  getSponsorMeeting(clubId?: EntityId): Promise<AppResult<SponsorMeetingOverview>>;
  rejectExecutiveSponsorOffer(clubId: EntityId, sponsorshipId: EntityId): Promise<AppResult<SponsorshipContract>>;
  counterExecutiveSponsorOffer(clubId: EntityId, sponsorshipId: EntityId, annualValue: number, endDate?: string): Promise<AppResult<SponsorshipContract>>;
  getFederationCommercialOverview(): Promise<AppResult<FederationCommercialOverview>>;
  createInvestorStakeOffer(percentage: number, minimumAmount?: number): Promise<AppResult<OwnershipInvestorMarketView>>;
  decideInvestorBid(offerId: EntityId, accept: boolean): Promise<AppResult<OwnershipAcquisitionOffer>>;
  getInvestorMeeting(): Promise<AppResult<InvestorMeetingOverview>>;
  injectOwnerCapital(amount: number): Promise<AppResult<OwnerInvestmentTransaction>>;
  getOwnerManagerMeeting(clubId?: EntityId): Promise<AppResult<OwnerManagerMeetingOverview>>;
  openOwnerManagerMeeting(clubId: EntityId, topic: OwnerManagerMeetingTopic): Promise<AppResult<UniversalInteraction>>;
  resolveOwnerManagerMeeting(
    interactionId: EntityId,
    stance: OwnerManagerMeetingStance,
    commitment?: OwnerManagerCommitmentInput,
  ): Promise<AppResult<UniversalInteraction>>;
  applyClubLoan(lenderId: EntityId, principal: number, termMonths: number, purpose: string): Promise<AppResult<ClubLoanApplication>>;
  repayClubLoan(debtId: EntityId, amount?: number): Promise<AppResult<ClubDebt>>;
  acceptExecutiveSponsorOffer(clubId: EntityId, sponsorshipId: EntityId): Promise<AppResult<SponsorshipContract>>;
  setExecutiveClubBudget(clubId: EntityId, seasonLabel: string, category: ClubBudgetCategory, amount: number): Promise<AppResult<ClubBudget>>;
  createExecutiveInfrastructureProject(clubId: EntityId, projectType: InfrastructureProjectType): Promise<AppResult<InfrastructureProject>>;
  applyExecutiveClubLoan(clubId: EntityId, lenderId: EntityId, principal: number, termMonths: number, purpose: string): Promise<AppResult<ClubLoanApplication>>;
  repayExecutiveClubLoan(clubId: EntityId, debtId: EntityId, amount?: number): Promise<AppResult<ClubDebt>>;
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
