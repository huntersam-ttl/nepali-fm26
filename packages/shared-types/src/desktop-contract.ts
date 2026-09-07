import type { EntityId } from "./ids.js";
import type { AdvanceMatchCommand, FixtureRow, LiveMatchView } from "./manager-contract.js";
import type { OwnerPostMatchSuggestion } from "./owner-meeting-suggestion.js";
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
  InfrastructureProjectStatus,
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
  OwnershipDealStructure,
  CompletedOwnershipDeal,
  ClubValuationBreakdown,
  OwnerInvestmentTransaction,
  StaffAppointment,
  ManagerPromise,
  MatchViewMode,
  PlayerMarketValueView,
  HistoricalEvent,
  StoryImportanceBand,
} from "./domain.js";
import type { ExecutiveAuthorityDesktopView } from "./executive-roles.js";
import type { FederationDevelopmentSummary, NationDevelopmentScorecard } from "./federation-policy.js";
import type { FederationRefereeContext } from "./referee-development.js";
import type { DistrictDetail, FederationMap } from "./territorial-football.js";
import type { UniversalInteraction } from "./universal-interactions.js";
import type { EntityReference, EntityReferenceType } from "./entity-reference.js";
import type { FederationCommercialRightsOffer } from "./commercial-rights.js";
import type { OrganizationProfile, OrganizationProfileEntityType } from "./organization-profile.js";
import type {
  OwnerManagerCommitmentInput,
  OwnerManagerMeetingOverview,
  OwnerManagerMeetingStance,
  OwnerManagerMeetingTopic,
  ManagerOwnerPlayerRequest,
  OwnerPlayerRequestContext,
  OwnerPlayerRequestIntent,
} from "./owner-manager-meetings.js";
import type {
  GovernmentOverview,
  GovernmentFundingApplication,
  GovernmentFundingType,
  ClubInfrastructureGovernmentContext,
  GovernmentSupportMeetingContext,
} from "./government.js";
import type {
  FacilityFundingSource,
  FacilityProjectMode,
  FacilityProjectPlan,
  FacilityProjectScope,
  FacilitySiteOption,
} from "./facility-planning.js";
import type {
  ActorPlayerActions,
  PlayerContractContext,
  PlayerTransferContext,
} from "./player-context.js";

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

/** Read-only, packaged attribution summary for an About/Credits surface. */
export type DatasetAttributionSummary = {
  datasetVersion: string;
  provenanceCategories: string[];
  factualDataNotice: string;
  simulationOnlyNotice: string;
  externalWorldPolicy: string;
  licensingNotice: string;
  fullDocumentLabel: string;
};

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
export type FounderLocationOption = {
  id: EntityId;
  province: string;
  district: string;
  locality: string;
  provenanceStatus: "REPORTED" | "SIMULATION_ONLY";
};
export type OwnerManagerCandidate = {
  vacancyId: EntityId;
  managerProfileId: EntityId;
  personId: EntityId;
  name: string;
  nationality: string;
  qualification: string;
  reputation: number;
  currentClub?: string;
  wageExpectation: number;
  available: boolean;
};

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
  latestInfrastructureUpdate?: InfrastructureStoryEntry;
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
  worldDate: ISODate;
  projects: InfrastructureProject[];
  plans: FacilityProjectPlan[];
  sites: FacilitySiteOption[];
  componentCatalog: Record<string, readonly string[]>;
  homeDistrict?: { districtId: EntityId; districtName: string; municipalityName: string };
  governmentApplications: GovernmentFundingApplication[];
  managerFacilityRequests: ManagerPromise[];
  /**
   * The government institution with real jurisdiction over this club's own
   * district/municipality, resolved even when the club has never had a prior
   * application (so a brand-new club is not blocked from ever discovering an
   * institution id). Undefined, never fabricated, when the club's location or
   * a covering institution genuinely cannot be determined yet.
   */
  resolvedInstitution?: EntityReference;
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
  worldDate: ISODate;
  market: OwnershipInvestorMarketView;
  valuation: ClubValuationBreakdown;
  recentActivity: Array<{ occurredOn: ISODate; title: string; eventType: string }>;
  completedDeals: CompletedOwnershipDeal[];
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
  /** Unified President decision surface for all currently supported properties. */
  properties: PresidentCommercialPropertyView[];
  history: PresidentCommercialHistoryEntry[];
};

export type PresidentCommercialPropertyView = {
  id: EntityId;
  scope: "FEDERATION" | "COMPETITION" | "SENIOR_MENS" | "YOUTH" | "WOMENS_GIRLS";
  programme?: "SENIOR_MENS" | "YOUTH" | "WOMENS_GIRLS";
  competitionSeasonId?: EntityId;
  canonicalName: string;
  commercialDisplayTitle?: string;
  sponsor?: EntityReference;
  packageId?: EntityId;
  offerId?: EntityId;
  termYears?: number;
  annualValue?: number;
  status: string;
  startDate?: string;
  endDate?: string;
  negotiationRound: number;
  settlementState: "SETTLED" | "NOT_SETTLED" | "NOT_APPLICABLE";
  revenueDestination?: string;
  competingOfferCount: number;
  availableActions: Array<"VIEW_OFFERS" | "COUNTER" | "ACCEPT" | "REJECT" | "RENEW">;
  blockedReason?: string;
};

export type PresidentCommercialHistoryEntry = {
  id: EntityId;
  scope: PresidentCommercialPropertyView["scope"];
  canonicalName: string;
  sponsor?: EntityReference;
  status: string;
  date?: string;
  endDate?: string;
  annualValue?: number;
  settlementState: "SETTLED" | "NOT_SETTLED" | "NOT_APPLICABLE";
};

export type ClubStadiumSummary = {
  venueId: EntityId;
  name: string;
  capacity?: number;
  surfaceType?: string;
  pitchQuality?: string;
  floodlights?: boolean;
  coveredStands?: boolean;
  yearOpened?: number;
  status?: string;
  /** True when this venue was resolved from an explicit club<->venue
   * relationship rather than a same-country capacity fallback — surfaced so
   * the UI can be honest about how confidently this is "the" home ground. */
  confirmedHomeGround: boolean;
};

export type ClubFinancialSummary = {
  cashBalance: number;
  currency: string;
  financialHealth: string;
};

export type ClubReputationSummary = {
  footballReputation: number;
  commercialReputation: number;
};

/** One active infrastructure project's real state, in the shape the club-
 * world campus visual needs (project type/status/expected date) — a
 * superset of what the plain `infrastructureProjects` EntityReference list
 * carries, never a second source of truth (built from the same rows). */
export type ClubCampusProject = {
  id: EntityId;
  reference: EntityReference;
  projectType: string;
  status: string;
  expectedCompletion?: ISODate;
};

export type ClubFacilitySnapshot = {
  trainingFacilityQuality: number;
  youthFacilityQuality: number;
  medicalFacilityQuality: number;
  analyticsFacilityQuality: number;
  academyCapacity: number;
};

export type ClubProfile = {
  entityReference: EntityReference;
  locationLabel?: string;
  division?: string;
  manager?: EntityReference;
  owner?: EntityReference;
  recentFixtures: EntityReference[];
  activeSponsors: EntityReference[];
  infrastructureProjects: EntityReference[];
  stadium?: ClubStadiumSummary;
  financialSummary?: ClubFinancialSummary;
  reputation?: ClubReputationSummary;
  facilitySnapshot?: ClubFacilitySnapshot;
  campusProjects: ClubCampusProject[];
  infrastructureHistory: InfrastructureStoryEntry[];
};

/** Tone-only classification for a story card — never used as the sole
 * signal in the UI (always paired with real status text), only as an
 * accent. */
export type InfrastructureStoryTone = "ok" | "warn" | "bad" | "info";

/** One real, already-occurred infrastructure/government moment — headline
 * text plus the entities actually involved, so the UI can render clickable
 * references instead of plain prose. Backed 1:1 by a historical_events row;
 * never a fabricated or duplicated local history model. */
export type InfrastructureStoryEntry = {
  headline: string;
  occurredOn: string;
  tone: InfrastructureStoryTone;
  entities: EntityReference[];
};

/** A single infrastructure project's real detail — the destination behind
 * every clickable project reference (club profile, campus view, facility
 * lifecycle list), never a second copy of the project's own state. */
export type InfrastructureProjectProfile = {
  entityReference: EntityReference;
  club: EntityReference;
  projectType: InfrastructureProjectType;
  status: InfrastructureProjectStatus;
  currency: string;
  capitalCost: number;
  ongoingCost: number;
  planningStart: ISODate;
  constructionStart?: ISODate;
  expectedCompletion: ISODate;
  completedAt?: ISODate;
  cancelledOn?: ISODate;
  delayDays?: number;
  fundingStatus?: string;
  fundingCommitted?: number;
  siteRights?: string;
  maintenanceStatus?: string;
  components?: string[];
  worldDate: ISODate;
};

export type StaffProfileReadModel = {
  entityReference: EntityReference;
  role?: string;
  club?: EntityReference;
  federation?: EntityReference;
  contractEnd?: string;
  careerHistory: EntityReference[];
};

export type CompetitionProfile = {
  entityReference: EntityReference;
  canonicalName: string;
  commercialDisplayTitle?: string;
  currentSeason?: { id: EntityId; name: string; startDate: string; endDate: string };
  standings: Array<{ team: EntityReference; played: number; points: number; goalDifference: number }>;
  fixtures: EntityReference[];
  titleSponsor?: EntityReference;
  participants: EntityReference[];
};

/** One real domestic tier — identified from the dataset's own competition
 * names (there is no explicit tier-number column), never an invented
 * division. */
export type CompetitionPyramidTier = {
  level: number;
  label: string;
  competition: EntityReference;
  currentSeasonName?: string;
  seasonStatus?: string;
  teamCount: number;
  leadingClub?: EntityReference;
  leadingClubPoints?: number;
  promotionSlots?: number;
  relegationSlots?: number;
  titleSponsor?: EntityReference;
  commercialDisplayTitle?: string;
};

export type CompetitionPyramid = {
  tiers: CompetitionPyramidTier[];
  provenanceStatus: "SIMULATION_ONLY";
};

/** One real national-team programme this player has actually been called
 * up to — never a fabricated selection guarantee. */
export type PlayerPathwayStage = {
  team: EntityReference;
  level: string;
  gender: string;
  programme: "SENIOR_MENS" | "YOUTH" | "WOMENS_GIRLS";
  firstCallup: ISODate;
  lastCallup: ISODate;
  appearances: number;
  firstAppearance?: ISODate;
};

/** A per-player national-team pathway timeline built entirely from real
 * call-up/appearance history — Women & Girls forms its own distinct stage
 * sequence, never a renamed men's flow. */
export type PlayerPathway = {
  playerId: EntityId;
  stages: PlayerPathwayStage[];
  currentStage?: string;
  nextPlausibleStage?: string;
  provenanceStatus: "SIMULATION_ONLY";
};

/** A thread is derived on every read from the existing historical-event
 * stream, never stored as its own record — membership comes from stable
 * event metadata (the involved player/club/competition), not a second
 * event/thread table. */
export type StoryThreadCategory =
  | "TRANSFER"
  | "LOAN"
  | "OWNERSHIP"
  | "FACILITY"
  | "INJURY"
  | "CONTRACT"
  | "NATIONAL_PATHWAY"
  | "COMMERCIAL"
  | "COMPETITION";

export type StoryThread = {
  id: string;
  category: StoryThreadCategory;
  primaryEntity: EntityReference;
  currentState: string;
  latestEvent: HistoricalEvent;
  resolved: boolean;
  /** Human status text — never a raw stage enum. */
  statusLabel: "Active" | "Waiting" | "Resolved" | "Collapsed";
  events: HistoricalEvent[];
  involvedEntities: EntityReference[];
};

/**
 * A real, authority-checked next step from a story — never a name/text
 * match, never shown when the underlying workflow can no longer be found.
 * `OPEN_ENTITY` reuses the existing EntityReference/profile mechanism;
 * `OPEN_INVESTOR_MEETING` deep-links into the live (or, once settled,
 * read-only) ownership negotiation by its own stable offer id.
 */
export type StoryAction =
  | { id: string; label: string; kind: "OPEN_ENTITY"; entity: EntityReference }
  | { id: string; label: string; kind: "OPEN_INVESTOR_MEETING"; offerId: EntityId }
  | { id: string; label: string; kind: "OPEN_TRANSFER_NEGOTIATION"; offerId: EntityId }
  | { id: string; label: string; kind: "OPEN_GOVERNMENT_SUPPORT"; clubId: EntityId }
  | { id: string; label: string; kind: "OPEN_NATIONAL_TEAM"; teamId: EntityId }
  | { id: string; label: string; kind: "OPEN_COMMERCIAL"; offerId: EntityId };

export type StoryDetail = {
  header: {
    importance: HistoricalEvent["importance"];
    importanceBand: StoryImportanceBand;
    category: string;
    date: ISODate;
    headline: string;
  };
  body: {
    narrative: string;
    whyItMatters: string;
    immediateConsequence: string;
    currentState: string;
  };
  contextRail: {
    entities: EntityReference[];
    financialImpact?: { amount: number; currency: string };
    additionalFacts: { label: string; value: string }[];
    priorEvents: { date: ISODate; headline: string }[];
  };
  /** Real, role-authority-checked next steps — see StoryAction. */
  actions: StoryAction[];
};

/** One line in a Player/Club Profile's recent-story section — read from the
 * same canonical historical events as the Inbox, never a separate record. */
export type StorylineEntry = {
  date: ISODate;
  headline: string;
  importanceBand: StoryImportanceBand;
  category?: StoryThreadCategory;
  eventId: EntityId;
};

export type EntityStoryline = {
  entries: StorylineEntry[];
  currentStory?: StoryThread;
};

export type NationalTeamSquadPlayer = {
  player: EntityReference;
  personId: EntityId;
  displayName: string;
  position?: string;
  currentClub?: EntityReference;
  age?: number;
  availability: "AVAILABLE" | "INJURED" | "SUSPENDED" | "UNAVAILABLE";
  selectionStatus: string;
  squadType: string;
  callupDate: string;
  internationalAppearances: number;
};

export type NationalTeamSelectionHistoryEntry = {
  id: EntityId;
  player: EntityReference;
  callupDate: string;
  programme: string;
  squadType: string;
  selectionStatus: string;
  competitionEditionId?: EntityId;
  appearance?: {
    date: string;
    opponent: string;
    minutes: number;
    goals: number;
  };
};

export type NationalTeamSquadReadModel = {
  nationalTeam: { id: EntityId; label: string; entityReference: EntityReference };
  programme: string;
  currentWindow?: {
    callupDate: string;
    competitionEditionId?: EntityId;
    campId?: EntityId;
  };
  squadSize: number;
  selectedCount: number;
  unavailableCount: number;
  clubDistribution: Array<{ club?: EntityReference; count: number }>;
  headCoach?: EntityReference;
  players: NationalTeamSquadPlayer[];
  selectionHistory: NationalTeamSelectionHistoryEntry[];
  asOf: string;
  supported: boolean;
  unsupportedReason?: string;
};

export type FederationNationalTeamSummary = {
  id: EntityId;
  name: string;
  level: string;
  gender: string;
  headCoach?: string;
  squadSize: number;
  nextFixture?: { opponent: string; date: string };
  recentResult?: { opponent: string; result: string };
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
  developmentScorecard?: NationDevelopmentScorecard;
  latestStory?: InfrastructureStoryEntry;
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
  appointManager(
    vacancyId: EntityId,
    managerProfileId: EntityId,
  ): Promise<AppResult<ManagerContract>>;
  createCareer(command: CareerCreationCommand): Promise<AppResult<DesktopApplicationState>>;
  loadCareer(saveId: EntityId): Promise<AppResult<DesktopApplicationState>>;
  closeCareer(): Promise<AppResult<{ closed: boolean }>>;
  getCareerHeader(): Promise<AppResult<CareerHeader>>;
  getDatasetAttribution(): Promise<AppResult<DatasetAttributionSummary>>;
  getCareerRoles(): Promise<AppResult<CareerRoleState>>;
  getExecutiveAuthority(
    clubId?: EntityId,
  ): Promise<AppResult<ExecutiveAuthorityDesktopView | undefined>>;
  switchActiveCareerRole(targetRole: CareerRole): Promise<AppResult<CareerHeader>>;
  getChairmanDashboard(): Promise<AppResult<ChairmanDashboard>>;
  getOwnerMatchday(): Promise<AppResult<OwnerMatchdayView>>;
  watchOwnerFixture(fixtureId?: EntityId): Promise<AppResult<LiveMatchView>>;
  /** Owner-only spectator progression through the canonical match session — same engine as the manager's own advance, no tactical authority. */
  advanceOwnerFixture(
    command?: AdvanceMatchCommand,
    fixtureId?: EntityId,
    viewMode?: MatchViewMode,
  ): Promise<AppResult<LiveMatchView>>;
  /** Owner may acknowledge the half-time break, but cannot alter either team. */
  continueOwnerFixture(
    fixtureId?: EntityId,
    viewMode?: MatchViewMode,
  ): Promise<AppResult<LiveMatchView>>;
  quickSimOwnerFixture(fixtureId?: EntityId): Promise<AppResult<LiveMatchView>>;
  /** Real, honest post-match follow-up suggestion for the most recently played fixture, or undefined when none is due. */
  getOwnerPostMatchSuggestion(): Promise<AppResult<OwnerPostMatchSuggestion | undefined>>;
  getEntityReference(
    entityType: EntityReferenceType,
    entityId: EntityId,
  ): Promise<AppResult<EntityReference>>;
  /** Canonical organization dossier (sponsor/lender/investor) — identity, active/historical/negotiating deals, and deduplicated involved entities. Works for any active role. */
  getOrganizationProfile(
    entityType: OrganizationProfileEntityType,
    entityId: EntityId,
  ): Promise<AppResult<OrganizationProfile>>;
  getClubProfile?(clubId: EntityId): Promise<AppResult<ClubProfile>>;
  getStaffProfile?(personId: EntityId): Promise<AppResult<StaffProfileReadModel>>;
  getCompetitionProfile?(competitionId: EntityId): Promise<AppResult<CompetitionProfile>>;
  getInfrastructureProjectProfile?(projectId: EntityId): Promise<AppResult<InfrastructureProjectProfile>>;
  getNationalTeamSquad?(nationalTeamId: EntityId, programme?: string): Promise<AppResult<NationalTeamSquadReadModel>>;
  /** Real actor-aware action availability for one player — the same authority check the mutating commands themselves use, so a profile can grey out a button honestly instead of the command rejecting it after the click. Works for any active role (Manager/Owner/President all get an honest answer). */
  getPlayerActions(playerId: EntityId): Promise<AppResult<ActorPlayerActions>>;
  /** Real active contract + club name for any player, safe for any active role to view. */
  getPlayerContractContext(playerId: EntityId): Promise<AppResult<PlayerContractContext>>;
  /** Real transfer-market status + recent offer activity for any player, safe for any active role to view. */
  getPlayerTransferContext(playerId: EntityId): Promise<AppResult<PlayerTransferContext>>;
  /** SIMULATION_ONLY market-value read (current value, range, asking range, club stance, interest, valuation history) — safe for any active role to view. */
  getPlayerMarketValue?(playerId: EntityId): Promise<AppResult<PlayerMarketValueView>>;
  /** Any real, currently-open Owner request to the Manager about this player — undefined when none exists. */
  getOwnerPlayerRequestContext(
    playerId: EntityId,
  ): Promise<AppResult<OwnerPlayerRequestContext | undefined>>;
  getManagerOwnerPlayerRequests(): Promise<AppResult<ManagerOwnerPlayerRequest[]>>;
  /** Opens a real Owner<->Manager meeting scoped to one player and intent — never a direct football mutation. */
  openOwnerPlayerRequest(
    playerId: EntityId,
    intent: OwnerPlayerRequestIntent,
    deadline?: string,
  ): Promise<AppResult<UniversalInteraction>>;
  /** Manager-side response to an open Owner player request. */
  respondToOwnerPlayerRequest(
    interactionId: EntityId,
    stance: OwnerManagerMeetingStance,
    commitment?: OwnerManagerCommitmentInput,
  ): Promise<AppResult<UniversalInteraction>>;
  getFacilityPlanning(clubId?: EntityId): Promise<AppResult<FacilityPlanningView>>;
  getFacilitySiteOptions(
    clubId: EntityId,
    districtId?: EntityId,
    municipalityName?: string,
  ): Promise<AppResult<FacilitySiteOption[]>>;
  createFacilityProjectPlan(
    input: FacilityProjectPlanInput,
  ): Promise<AppResult<FacilityProjectPlanResult>>;
  getClubInfrastructureGovernmentContext?: (
    projectId: EntityId,
  ) => Promise<AppResult<ClubInfrastructureGovernmentContext>>;
  openClubInfrastructureGovernmentRequest?: (input: {
    projectId: EntityId;
    institutionId: EntityId;
    fundingType: "INFRASTRUCTURE" | "REGIONAL_GROUND" | "MUNICIPAL_LAND_OR_VENUE";
    requestedAmount: number;
  }) => Promise<AppResult<GovernmentFundingApplication>>;
  /**
   * Anchors a government support request on a facility site option directly —
   * no InfrastructureProject need exist yet. This is the pre-project entry
   * point a NEW_SITE / GOVERNMENT_REVIEW facility plan actually needs;
   * createFacilityProjectPlan can then proceed once the resulting
   * application is approved and the site itself flips to AVAILABLE, without
   * ever requiring (or creating) a placeholder project first.
   */
  openFacilitySiteGovernmentRequest?: (input: {
    clubId: EntityId;
    siteOptionId: EntityId;
    fundingType: "INFRASTRUCTURE" | "REGIONAL_GROUND" | "MUNICIPAL_LAND_OR_VENUE";
    requestedAmount: number;
  }) => Promise<AppResult<GovernmentFundingApplication>>;
  /** Everything the Owner-side Government Support meeting needs in one call. */
  getGovernmentSupportMeeting?: (input: {
    clubId?: EntityId;
    siteOptionId?: EntityId;
    projectId?: EntityId;
  }) => Promise<AppResult<GovernmentSupportMeetingContext>>;
  /** PROPOSED -> SUBMITTED on a club-scoped application — a real, previously
   * unused step in the canonical lifecycle; this just gives the Owner a way
   * to trigger it instead of only ever reaching it from a test. */
  submitGovernmentSupportCase?: (applicationId: EntityId) => Promise<AppResult<GovernmentFundingApplication>>;
  getFederationPresidentDashboard(): Promise<AppResult<FederationPresidentDashboard>>;
  getNationalDevelopment(): Promise<AppResult<FederationDevelopmentSummary>>;
  getNationDevelopmentScorecard?: () => Promise<AppResult<NationDevelopmentScorecard>>;
  getFederationRefereeContext?: () => Promise<AppResult<FederationRefereeContext>>;
  getPlayerPathway?: (playerId: EntityId) => Promise<AppResult<PlayerPathway>>;
  getStoryThreads?: () => Promise<AppResult<StoryThread[]>>;
  getStoryDetail?: (eventId: EntityId) => Promise<AppResult<StoryDetail>>;
  getEntityStoryline?: (entityId: EntityId) => Promise<AppResult<EntityStoryline>>;
  getFederationMap?: () => Promise<AppResult<FederationMap>>;
  getDistrictDetail?: (districtId: EntityId) => Promise<AppResult<DistrictDetail>>;
  getCompetitionPyramid?: () => Promise<AppResult<CompetitionPyramid>>;
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
  implementFederationGovernanceProposal(
    proposalId: EntityId,
  ): Promise<AppResult<FederationGovernanceProposal>>;
  setClubBudget(
    clubId: EntityId,
    seasonLabel: string,
    category: ClubBudgetCategory,
    amount: number,
  ): Promise<AppResult<ClubBudget>>;
  createInfrastructureProject(
    clubId: EntityId,
    projectType: InfrastructureProjectType,
  ): Promise<AppResult<InfrastructureProject>>;
  acceptSponsorOffer(
    clubId: EntityId,
    sponsorshipId: EntityId,
  ): Promise<AppResult<SponsorshipContract>>;
  rejectSponsorOffer(
    clubId: EntityId,
    sponsorshipId: EntityId,
  ): Promise<AppResult<SponsorshipContract>>;
  counterSponsorOffer(
    clubId: EntityId,
    sponsorshipId: EntityId,
    annualValue: number,
    endDate?: string,
  ): Promise<AppResult<SponsorshipContract>>;
  getSponsorMeeting(clubId?: EntityId): Promise<AppResult<SponsorMeetingOverview>>;
  rejectExecutiveSponsorOffer(
    clubId: EntityId,
    sponsorshipId: EntityId,
  ): Promise<AppResult<SponsorshipContract>>;
  counterExecutiveSponsorOffer(
    clubId: EntityId,
    sponsorshipId: EntityId,
    annualValue: number,
    endDate?: string,
  ): Promise<AppResult<SponsorshipContract>>;
  getFederationCommercialOverview(): Promise<AppResult<FederationCommercialOverview>>;
  negotiateFederationCommercialOffer?(
    offerId: EntityId,
  ): Promise<AppResult<FederationCommercialRightsOffer>>;
  counterFederationCommercialOffer?(
    offerId: EntityId,
    annualValue: number,
    termYears?: number,
  ): Promise<AppResult<FederationCommercialRightsOffer>>;
  acceptFederationCommercialOffer?(
    offerId: EntityId,
  ): Promise<AppResult<FederationCommercialRightsOffer>>;
  rejectFederationCommercialOffer?(
    offerId: EntityId,
  ): Promise<AppResult<FederationCommercialRightsOffer>>;
  createInvestorStakeOffer(
    percentage: number,
    minimumAmount?: number,
  ): Promise<AppResult<OwnershipInvestorMarketView>>;
  decideInvestorBid(
    offerId: EntityId,
    accept: boolean,
  ): Promise<AppResult<OwnershipAcquisitionOffer>>;
  counterInvestorBid(
    offerId: EntityId,
    terms: { amount: number; percentage?: number; boardSeatRequested?: boolean },
  ): Promise<AppResult<OwnershipAcquisitionOffer>>;
  withdrawInvestorBidResponse(offerId: EntityId): Promise<AppResult<OwnershipAcquisitionOffer>>;
  acknowledgeBoardOppositionForInvestorBid(
    offerId: EntityId,
  ): Promise<AppResult<OwnershipAcquisitionOffer>>;
  getInvestorMeeting(): Promise<AppResult<InvestorMeetingOverview>>;
  injectOwnerCapital(amount: number): Promise<AppResult<OwnerInvestmentTransaction>>;
  getOwnerManagerMeeting(clubId?: EntityId): Promise<AppResult<OwnerManagerMeetingOverview>>;
  openOwnerManagerMeeting(
    clubId: EntityId,
    topic: OwnerManagerMeetingTopic,
  ): Promise<AppResult<UniversalInteraction>>;
  resolveOwnerManagerMeeting(
    interactionId: EntityId,
    stance: OwnerManagerMeetingStance,
    commitment?: OwnerManagerCommitmentInput,
  ): Promise<AppResult<UniversalInteraction>>;
  applyClubLoan(
    lenderId: EntityId,
    principal: number,
    termMonths: number,
    purpose: string,
  ): Promise<AppResult<ClubLoanApplication>>;
  repayClubLoan(debtId: EntityId, amount?: number): Promise<AppResult<ClubDebt>>;
  acceptExecutiveSponsorOffer(
    clubId: EntityId,
    sponsorshipId: EntityId,
  ): Promise<AppResult<SponsorshipContract>>;
  setExecutiveClubBudget(
    clubId: EntityId,
    seasonLabel: string,
    category: ClubBudgetCategory,
    amount: number,
  ): Promise<AppResult<ClubBudget>>;
  createExecutiveInfrastructureProject(
    clubId: EntityId,
    projectType: InfrastructureProjectType,
  ): Promise<AppResult<InfrastructureProject>>;
  applyExecutiveClubLoan(
    clubId: EntityId,
    lenderId: EntityId,
    principal: number,
    termMonths: number,
    purpose: string,
  ): Promise<AppResult<ClubLoanApplication>>;
  repayExecutiveClubLoan(
    clubId: EntityId,
    debtId: EntityId,
    amount?: number,
  ): Promise<AppResult<ClubDebt>>;
  closeExecutiveLicence(caseId: EntityId): Promise<AppResult<unknown>>;
  registerExecutiveCompetitionPlayers(
    teamId: EntityId,
    competitionSeasonId: EntityId,
  ): Promise<AppResult<unknown>>;
  hireStaffAsExecutive(
    clubId: EntityId,
    personId: EntityId,
    role: StaffAppointment["role"],
    salaryAmountMinor: number,
    teamId?: EntityId,
    contractMonths?: number,
  ): Promise<AppResult<unknown>>;
  dismissStaffAsExecutive(clubId: EntityId, appointmentId: EntityId): Promise<AppResult<unknown>>;
  requestManagerBudget(
    seasonLabel: string,
    category: ClubBudgetCategory,
    requestedAmount: number,
  ): Promise<AppResult<ManagerBudgetRequest>>;
  decideManagerBudgetRequest(
    requestId: EntityId,
    approve: boolean,
  ): Promise<AppResult<ManagerBudgetRequest>>;
  purchaseEquipment(
    category: ProcurementCategory,
    quantity: number,
  ): Promise<AppResult<ProcurementOrder>>;
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
