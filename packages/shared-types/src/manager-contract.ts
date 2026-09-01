import type { EntityId } from "./ids.js";
import type {
  CaptainInfluence,
  ConcernResponseAction,
  ConcernResponseOutcome,
  InboxItem,
  MedicalAssessment,
  ISODate,
  ManagerPromiseStatus,
  ManagerPromiseType,
  MatchViewMode,
  KnowledgeConfidence,
  KnowledgeRange,
  PlayerAttributeSet,
  PlayerConcernStatus,
  PlayerConcernType,
  PlayerDiscoveryStatus,
  PlayerKnowledgeLevel,
  PlayerPosition,
  PlayerSquadRole,
  SquadGroupType,
  SquadHierarchyRole,
  SquadDispute,
  SquadMeeting,
  SquadMeetingType,
  TacticalFamiliarity,
  TacticalSetup,
  TeamCohesionLevel,
  TeamInstructions,
  GoalkeeperDistributionStyle,
  TrainingIntensity,
  TrainingPlan,
} from "./domain.js";

/**
 * Manager gameplay contract.
 *
 * Additive to `desktop-contract.ts`: this file only adds Manager-mode read models
 * and commands. Nothing here changes the career-creation or session contract.
 *
 * Every type is a targeted read model. Raw database rows never reach React.
 */

/** How much of a value the save is allowed to assert as real-world fact. */
export type ProvenanceStatus =
  "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN" | "SIMULATION_ONLY";

/**
 * A value plus how much the world actually knows about it. `value` is undefined
 * when the fact is genuinely unknown — the UI must render that as "Unknown"
 * rather than inventing a plausible number.
 */
export type Fact<T> = {
  value?: T;
  status: ProvenanceStatus;
};

export type ManagerPermission =
  | "SELECT_SQUAD"
  | "SET_TACTICS"
  | "SET_TRAINING"
  | "SCOUT_PLAYERS"
  | "OFFER_TRANSFER"
  | "NEGOTIATE_CONTRACT"
  | "LIST_PLAYER"
  | "MANAGE_STAFF";

// ---------------------------------------------------------------------------
// Squad and players
// ---------------------------------------------------------------------------

/** Lightweight squad row. Never carries full attributes — see `PlayerProfile`. */
export type SquadPlayerRow = {
  personId: EntityId;
  name: string;
  age: Fact<number>;
  nationality: string;
  primaryPosition: PlayerPosition;
  positions: PlayerPosition[];
  squadStatus: string;
  availability: SquadAvailability;
  fitness: number;
  condition: number;
  morale: string;
  form: number;
  appearances: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  contractExpiry?: ISODate;
  salary?: number;
  squadRole?: string;
  transferStatus?: string;
  /** Manager's own knowledge level for this player. */
  knowledge: PlayerKnowledgeLevel;
  /** Presentation-only rating derived from attributes; not a factual rating. */
  abilityLabel: string;
  ability: number;
};

export type SquadAvailability =
  "AVAILABLE" | "INJURED" | "SUSPENDED" | "INTERNATIONAL_DUTY" | "UNAVAILABLE";

export type SquadList = {
  teamId: EntityId;
  teamName: string;
  clubName?: string;
  players: SquadPlayerRow[];
  positionOptions: PlayerPosition[];
  availabilityCounts: Record<SquadAvailability, number>;
};

export type AttributeGroupView = {
  group: "Technical" | "Mental" | "Physical" | "Goalkeeping";
  attributes: Array<{ key: string; label: string; value: number }>;
};

export type PlayerProfile = {
  personId: EntityId;
  name: string;
  fullName: string;
  dateOfBirth: Fact<ISODate>;
  age: Fact<number>;
  nationality: Fact<string>;
  heightCm: Fact<number>;
  preferredFoot: Fact<string>;
  primaryPosition: PlayerPosition;
  secondaryPositions: PlayerPosition[];
  clubName?: string;
  squadStatus: string;
  availability: SquadAvailability;
  /** Attribute values are gameplay values, always SIMULATION_ONLY. */
  attributeProvenance: ProvenanceStatus;
  attributeGroups: AttributeGroupView[];
  ability: number;
  abilityLabel: string;
  form: number;
  fitness: number;
  condition: number;
  morale: string;
  contract?: {
    salary: number;
    currency: string;
    startDate: ISODate;
    endDate: ISODate;
    squadRole: string;
    status: string;
    releaseClause?: number;
  };
  development?: {
    phase: string;
    momentum: number;
    matchSharpness: number;
    fatigue: number;
    recovery: number;
    /** Banded, never the exact hidden ceiling. */
    potentialBand: string;
    lastUpdated?: ISODate;
  };
  season: {
    appearances: number;
    starts: number;
    minutes: number;
    goals: number;
    assists: number;
    yellowCards: number;
    redCards: number;
    averageRating: number;
  };
  knowledge: PlayerKnowledgeLevel;
  /** Present only when this is not the manager's own player. */
  scoutingSummary?: ScoutingReportView;
};

// ---------------------------------------------------------------------------
// Tactics
// ---------------------------------------------------------------------------

export type FormationOption = {
  id: string;
  name: string;
  slots: Array<{
    id: string;
    label: string;
    position: PlayerPosition | string;
    x: number;
    y: number;
    zone: string;
  }>;
};

export type RoleOption = {
  id: string;
  name: string;
  family: string;
  zones: string[];
};

export type SlotRoleFit = {
  slotId: string;
  playerId?: EntityId;
  playerName?: string;
  roleId: string;
  overall: number;
  label: string;
  positionFit: number;
  attributeFit: number;
  familiarity: number;
};

export type TacticsView = {
  setup: TacticalSetup;
  formations: FormationOption[];
  roles: RoleOption[];
  styles: string[];
  mentalities: string[];
  familiarity: TacticalFamiliarity;
  roleFits: SlotRoleFit[];
  benchCandidates: SquadPlayerRow[];
  validation: SquadSelectionValidation;
};

export type SquadSelectionValidation = {
  isValid: boolean;
  blockingErrors: string[];
  warnings: string[];
};

export type TacticsUpdateCommand = {
  formationId?: string;
  name?: string;
  style?: string;
  instructions?: TeamInstructions;
  assignments?: Array<{ slotId: string; playerId?: EntityId; roleId: string }>;
  bench?: EntityId[];
  setPieces?: Record<string, EntityId | undefined>;
};

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export type TrainingView = {
  plan: TrainingPlan;
  intensityOptions: TrainingIntensity[];
  categoryOptions: string[];
  groupOptions: string[];
  dayOptions: string[];
  squadDevelopment: Array<{
    personId: EntityId;
    name: string;
    phase: string;
    momentum: number;
    fitness: number;
    fatigue: number;
    matchSharpness: number;
    focus?: string;
  }>;
  facility?: {
    trainingQuality?: number;
    youthQuality?: number;
    medicalQuality?: number;
  };
};

export type TrainingUpdateCommand = {
  name?: string;
  intensity?: TrainingIntensity;
  sessions?: Array<{
    day: string;
    slot: number;
    category: string;
    intensity: TrainingIntensity;
    targetGroup: string;
  }>;
};

// ---------------------------------------------------------------------------
// Player development (Phase A)
// ---------------------------------------------------------------------------

export type IndividualDevelopmentPlanView = {
  id: EntityId;
  focusType: string;
  targetPosition?: string;
  targetRole?: string;
  targetAttributeGroup?: string;
  intensity: TrainingIntensity;
  startDate: ISODate;
  endDate?: ISODate;
  status: string;
};

export type DevelopmentHistoryEntryView = {
  eventType: string;
  occurredOn: ISODate;
  data?: Record<string, unknown>;
};

export type PlayerDevelopmentEntry = {
  personId: EntityId;
  name: string;
  age?: number;
  primaryPosition: string;
  phase: string;
  trend: "IMPROVING" | "STABLE" | "DECLINING";
  momentum: number;
  currentAbility: number;
  fitness: number;
  fatigue: number;
  recovery: number;
  injuryRisk: number;
  currentlyInjured: boolean;
  trainingAvailability: "FULL" | "INJURED" | "RETURNING";
  plateaued: boolean;
  latestRecommendation?: string;
  activePlan?: IndividualDevelopmentPlanView;
  recentHistory: DevelopmentHistoryEntryView[];
};

export type PlayerDevelopmentView = {
  players: PlayerDevelopmentEntry[];
  focusTypeOptions: string[];
  attributeGroupOptions: string[];
  positionOptions: string[];
  intensityOptions: TrainingIntensity[];
  environment?: {
    coachingQuality?: number;
    facilitiesEffect?: number;
  };
};

export type CreateDevelopmentPlanCommand = {
  personId: EntityId;
  focusType: string;
  targetPosition?: string;
  targetRole?: string;
  targetAttributeGroup?: string;
  intensity: TrainingIntensity;
};

// ---------------------------------------------------------------------------
// Medical, fitness & injury management (Phase B)
// ---------------------------------------------------------------------------

export type RehabilitationPlanView = {
  id: EntityId;
  stage: string;
  stageStartedOn: ISODate;
  startedOn: ISODate;
  targetReturnDate: ISODate;
  status: string;
};

export type RehabDecisionView = {
  id: EntityId;
  decidedOn: ISODate;
  decision: string;
  medicalRecommendation: string;
  outcome: string;
  rationale: string;
};

export type MedicalCentreEntryView = {
  personId: EntityId;
  name: string;
  stage: string;
  estimatedReturnStart: ISODate;
  estimatedReturnEnd: ISODate;
  confidence: number;
  recurrenceRisk: number;
  fatigue: number;
  workloadFlag: "NORMAL" | "ELEVATED" | "OVERLOADED";
  availabilityRecommendation: string;
  clearanceStatus: string;
  rationale: string;
  chronicRisk: boolean;
  trainingAvailability: "FULL" | "INJURED" | "RETURNING";
  congestionMultiplier: number;
  rehabPlan?: RehabilitationPlanView;
  decisionHistory: RehabDecisionView[];
};

export type MedicalCentreView = {
  players: MedicalCentreEntryView[];
  decisionOptions: string[];
};

export type ReturnToPlayDecisionCommand = {
  personId: EntityId;
  decision: string;
};

// ---------------------------------------------------------------------------
// Fixtures and competitions
// ---------------------------------------------------------------------------

export type FixtureRow = {
  id: EntityId;
  date: ISODate;
  competition: string;
  opponent: string;
  opponentId: EntityId;
  homeAway: "home" | "away";
  venue?: string;
  status: string;
  score?: string;
  result?: "W" | "D" | "L";
};

export type FixtureList = {
  upcoming: FixtureRow[];
  results: FixtureRow[];
  competitions: string[];
  worldDate: string;
};

export type FixtureDetail = {
  fixture: FixtureRow;
  opponentForm: string[];
  ownForm: string[];
  previousMeetings: Array<{ date: ISODate; score: string; competition: string }>;
  availableCount: number;
  unavailable: SquadPlayerRow[];
  selectionValid: boolean;
  warnings: string[];
  selectedXI: Array<{ slotId: string; playerName?: string; roleId: string }>;
  bench: string[];
};

export type CompetitionTableRow = {
  position: number;
  teamId: EntityId;
  teamName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  isManagerTeam: boolean;
};

export type ManagerCompetitionView = {
  seasonName: string;
  competitionName: string;
  table: CompetitionTableRow[];
  topScorers: Array<{ personId: EntityId; name: string; teamName: string; goals: number }>;
  managerPosition?: number;
  form: string[];
};

// ---------------------------------------------------------------------------
// Scouting
// ---------------------------------------------------------------------------

export type ScoutingReportView = {
  playerId: EntityId;
  playerName?: string;
  /** Banded estimate. The exact hidden ability is never sent to the client. */
  estimatedAbility?: KnowledgeRange;
  estimatedPotentialBand: string;
  confidence: KnowledgeConfidence;
  observations: number;
  strengths: string[];
  weaknesses: string[];
  positionAssessment: string;
  roleAssessment: string;
  recommendation: string;
  generatedAt: ISODate;
  scoutName?: string;
};

export type ScoutingAssignmentView = {
  id: EntityId;
  assignmentType: string;
  targetName: string;
  status: string;
  priority: string;
  startedAt: ISODate;
  expectedCompletionAt: ISODate;
};

export type ShortlistEntry = {
  playerId: EntityId;
  playerName?: string;
  clubName?: string;
  priority: string;
  addedAt: ISODate;
  scoutingStatus: string;
  knowledge: PlayerKnowledgeLevel;
  estimatedAbility?: KnowledgeRange;
};

export type RecruitmentRow = {
  playerId: EntityId;
  /** Undefined while the player is still undiscovered. */
  name?: string;
  clubName?: string;
  discoveryStatus: PlayerDiscoveryStatus;
  knowledge: PlayerKnowledgeLevel;
  confidence: KnowledgeConfidence;
  knownPosition?: string;
  positionGroup?: string;
  estimatedAbility?: KnowledgeRange;
  estimatedPotential?: string;
  shortlisted: boolean;
};

export type ScoutingDashboard = {
  coverage: {
    knownPlayers: number;
    discoveredPlayers: number;
    unknownPlayers: number;
    totalPlayers: number;
  };
  assignments: ScoutingAssignmentView[];
  recentReports: ScoutingReportView[];
  shortlist: ShortlistEntry[];
};

export type RecruitmentSearchCommand = {
  position?: PlayerPosition;
  ageMin?: number;
  ageMax?: number;
  clubId?: EntityId;
  estimatedAbilityMin?: number;
  query?: string;
  page?: number;
  pageSize?: number;
};

export type RecruitmentSearchPage = {
  rows: RecruitmentRow[];
  page: number;
  pageSize: number;
  total: number;
};

export type ScoutingAssignmentCommand = {
  targetPlayerId?: EntityId;
  targetClubId?: EntityId;
  targetCompetitionId?: EntityId;
  priority?: "LOW" | "NORMAL" | "HIGH";
};

// ---------------------------------------------------------------------------
// Transfers and contracts
// ---------------------------------------------------------------------------

export type TransferOfferView = {
  id: EntityId;
  playerId: EntityId;
  playerName?: string;
  direction: "INCOMING" | "OUTGOING";
  otherClubName?: string;
  offerType: string;
  transferFee: number;
  installments: number;
  addOns: number;
  sellOnPercentage: number;
  askingRange?: KnowledgeRange;
  agentFee: number;
  signingFee: number;
  agentContact: "SELF_REPRESENTED" | "AGENT";
  conditionals: Array<{ type: string; threshold: number; amount: number; description: string }>;
  playerExchanges: Array<{
    playerId: EntityId;
    playerName?: string;
    valuation?: KnowledgeRange;
    requestedBy: string;
  }>;
  sellerRequestedPlayerId?: EntityId;
  currency: string;
  status: string;
  submittedAt: ISODate;
  expiresAt: ISODate;
  negotiation: Array<{ round: number; actor: string; action: string; message: string }>;
};

export type TransferBudgetView = {
  seasonLabel: string;
  /** Budget allocated for transfers, which is not the same as club cash. */
  transferBudget: number;
  transferSpent: number;
  transferRemaining: number;
  wageBudget: number;
  committedWages: number;
  wageRemaining: number;
  currency: string;
};

export type TransferCentre = {
  budget: TransferBudgetView;
  windowOpen: boolean;
  windowCloses?: ISODate;
  expiringContracts: Array<{
    playerId: EntityId;
    playerName?: string;
    endDate: ISODate;
    monthsRemaining: number;
    squadRole: string;
  }>;
  requests: Array<{
    id: EntityId;
    playerId: EntityId;
    playerName?: string;
    reason: string;
    pressureScore: number;
    status: string;
    askingRange?: KnowledgeRange;
  }>;
  targets: ShortlistEntry[];
  incoming: TransferOfferView[];
  outgoing: TransferOfferView[];
  loans: Array<{
    playerId: EntityId;
    playerName?: string;
    direction: "IN" | "OUT";
    otherClubName?: string;
    startDate: ISODate;
    endDate: ISODate;
    wageContributionPercent: number;
    status: string;
  }>;
  freeAgents: RecruitmentRow[];
  history: Array<{
    playerId: EntityId;
    playerName?: string;
    eventType: string;
    occurredOn: ISODate;
    otherClubName?: string;
  }>;
};

export type TransferOfferCommand = {
  playerId: EntityId;
  fee?: number;
  installments?: number;
  addOns?: number;
  sellOnPercentage?: number;
  conditionals?: Array<{
    type: "APPEARANCE" | "PERFORMANCE";
    threshold: number;
    amount: number;
    description: string;
  }>;
  exchangePlayerIds?: EntityId[];
  sellerRequestedPlayerId?: EntityId;
};

export type TransferResponseCommand = {
  offerId: EntityId;
  action: "ACCEPT" | "REJECT" | "COUNTER";
  transferFee?: number;
  installments?: number;
  addOns?: number;
  sellOnPercentage?: number;
  sellerRequestedPlayerId?: EntityId;
};

export type TransferRequestCommand = {
  playerId: EntityId;
  reason?: string;
  satisfaction?: number;
  ambition?: number;
  foreignInterest?: boolean;
};

export type TransferRequestResponseCommand = {
  requestId: EntityId;
  decision: "ACCEPTED" | "REJECTED";
};

export type TransferLoanCommand = {
  playerId: EntityId;
  endDate?: ISODate;
  wageContributionPercent?: number;
  loanFee?: number;
  playingTimeExpectation?: PlayerSquadRole;
  recallAllowed?: boolean;
};

export type TransferListCommand = {
  playerId: EntityId;
  status: "TRANSFER_LISTED" | "LOAN_LISTED" | "NOT_FOR_SALE";
};

export type ContractRow = {
  playerId: EntityId;
  playerName: string;
  salary: number;
  currency: string;
  startDate: ISODate;
  endDate: ISODate;
  squadRole: string;
  status: string;
  monthsRemaining: number;
  expiringSoon: boolean;
};

export type ContractList = {
  contracts: ContractRow[];
  totalWageBill: number;
  currency: string;
  expiringCount: number;
};

export type ContractRenewalCommand = {
  playerId: EntityId;
  /** Omitted values fall back to the engine's negotiated terms. */
  salary?: number;
  months?: number;
  squadRole?: string;
};

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export type StaffRow = {
  personId: EntityId;
  appointmentId: EntityId;
  name: string;
  role: string;
  category: "COACHING" | "MEDICAL" | "RECRUITMENT" | "DIRECTOR" | "OTHER";
  startDate?: ISODate;
  endDate?: ISODate;
  employmentStatus: string;
  serviceRankTitle?: string;
  licence?: string;
  /** Gameplay coaching values, always SIMULATION_ONLY when present. */
  simulatedQualities?: Array<{ label: string; value: number }>;
};

export type StaffVacancyView = {
  id: EntityId;
  role: string;
  required: boolean;
  status: string;
};

export type StaffList = {
  staff: StaffRow[];
  vacancies: StaffVacancyView[];
  candidates: Array<{ personId: EntityId; name: string; preferredRole?: string }>;
};

export type StaffRowWithContract = StaffRow & {
  salaryAmountMinor?: number;
  contractEnd?: ISODate;
  lastPerformanceScore?: number;
};

export type StaffApplicationView = {
  id: EntityId;
  vacancyId: EntityId;
  personId: EntityId;
  personName: string;
  role: string;
  status: string;
  offeredSalaryMinor?: number;
  counterSalaryMinor?: number;
  createdOn: ISODate;
};

export type StaffRenewalOfferView = {
  id: EntityId;
  appointmentId: EntityId;
  personId: EntityId;
  personName: string;
  role: string;
  status: string;
  proposedSalaryMinor: number;
  counterSalaryMinor?: number;
  createdOn: ISODate;
};

export type StaffApproachView = {
  id: EntityId;
  personId: EntityId;
  personName: string;
  fromClubName: string;
  role: string;
  offeredSalaryMinor: number;
  status: string;
  createdOn: ISODate;
};

export type StaffMarketView = {
  staff: StaffRowWithContract[];
  vacancies: StaffVacancyView[];
  candidates: Array<{ personId: EntityId; name: string; preferredRole?: string }>;
  applications: StaffApplicationView[];
  renewalOffers: StaffRenewalOfferView[];
  approaches: StaffApproachView[];
};

export type StaffHierarchyEntryView = {
  appointmentId: EntityId;
  personId: EntityId;
  personName: string;
  role: string;
  seniorityRank: number;
  domains: string[];
  workload: string;
};

export type StaffResponsibilityView = {
  domain: string;
  ownerType: string;
  ownerAppointmentId?: EntityId;
  ownerName?: string;
  boardApprovalGrantedUntil?: ISODate;
};

export type StaffDevelopmentPlanView = {
  id: EntityId;
  personId: EntityId;
  personName: string;
  focus: string;
  targetLicenceType?: string;
  targetDate: ISODate;
  status: string;
};

export type StaffSuccessionPlanView = {
  id: EntityId;
  outgoingAppointmentId: EntityId;
  personName: string;
  role: string;
  candidateName?: string;
  reason: string;
};

export type StaffHierarchyView = {
  hierarchy: StaffHierarchyEntryView[];
  responsibilities: StaffResponsibilityView[];
  developmentPlans: StaffDevelopmentPlanView[];
  successionPlans: StaffSuccessionPlanView[];
};

// ---------------------------------------------------------------------------
// Dashboard, calendar and continue
// ---------------------------------------------------------------------------

/** Vacancy the manager could apply for. Domestic-only today; see JobVacancy. */
export type JobVacancyView = {
  id: EntityId;
  clubName: string;
  teamName: string;
  competitionName: string;
  openedOn: ISODate;
  reason: string;
  boardExpectation: string;
  eligible: boolean;
  eligibilityNote?: string;
};

export type JobApplicationView = {
  id: EntityId;
  vacancyId: EntityId;
  clubName: string;
  teamName: string;
  status: string;
  createdOn: ISODate;
  decidedOn?: ISODate;
  offeredSalaryMinor?: number;
  offeredContractEnd?: ISODate;
  negotiationStage?: string;
  competingCandidateCount?: number;
  candidateStanding?: "LEADING" | "COMPETITIVE" | "OUTSIDE_CHALLENGE";
  decisionReason?: string;
};

export type JobCentreView = {
  reputationProfile: string;
  vacancies: JobVacancyView[];
  applications: JobApplicationView[];
};

export type SquadPromiseView = {
  id: EntityId;
  type: ManagerPromiseType;
  description: string;
  madeOn: ISODate;
  dueOn: ISODate;
  status: ManagerPromiseStatus;
};

export type SquadConcernView = {
  id: EntityId;
  personId: EntityId;
  playerName: string;
  hierarchyRole?: SquadHierarchyRole;
  type: PlayerConcernType;
  status: PlayerConcernStatus;
  severity: number;
  raisedOn: ISODate;
  updatedOn: ISODate;
  note?: string;
  validActions: ConcernResponseAction[];
  activePromise?: SquadPromiseView;
};

export type SquadGroupMemberView = {
  personId: EntityId;
  playerName: string;
  groupType: SquadGroupType;
  hierarchyRole: SquadHierarchyRole;
  influence: number;
};

export type TeamCohesionView = {
  score: number;
  level: TeamCohesionLevel;
  captainName?: string;
  captainInfluence: CaptainInfluence;
  topIssue?: string;
};

export type SquadDisputeView = SquadDispute & {
  playerName: string;
  withPlayerName?: string;
};

export type SquadMeetingView = SquadMeeting;

export type SquadDynamicsView = {
  concerns: SquadConcernView[];
  promises: SquadPromiseView[];
  cohesion: TeamCohesionView;
  groups: SquadGroupMemberView[];
  disputes: SquadDisputeView[];
  meetings: SquadMeetingView[];
};

export type SquadMeetingCommand = {
  type: SquadMeetingType;
  personId?: EntityId;
  disputeId?: EntityId;
};

export type SquadMeetingResult = {
  meeting: SquadMeetingView;
  squad: SquadDynamicsView;
};

export type ConcernResponseCommand = {
  concernId: EntityId;
  action: ConcernResponseAction;
};

export type ConcernResponseResult = {
  outcome: ConcernResponseOutcome;
  squad: SquadDynamicsView;
};

export type ManagerCareerHistoryEntry = {
  contractId: EntityId;
  clubName?: string;
  teamName?: string;
  jobTitle: string;
  start: ISODate;
  end?: ISODate;
  outcome: string;
};

export type ManagerTrophyEntry = {
  competitionName: string;
  teamName: string;
  wonOn: ISODate;
};

export type ManagerCareerHistoryView = {
  managerName: string;
  reputationProfile: string;
  jobsHeld: number;
  history: ManagerCareerHistoryEntry[];
  trophies: ManagerTrophyEntry[];
};

export type ManagerDashboard = {
  employmentStatus: "EMPLOYED" | "UNEMPLOYED";
  clubName?: string;
  teamName: string;
  competitionName: string;
  worldDate: ISODate;
  leaguePosition?: number;
  played: number;
  points: number;
  form: string[];
  nextFixture?: FixtureRow;
  recentResults: FixtureRow[];
  boardConfidence?: number;
  boardExpectation?: string;
  concernCount?: number;
  cohesionScore?: number;
  cohesionLevel?: TeamCohesionLevel;
  cohesionTopIssue?: string;
  jobCentre?: JobCentreView;
  squadAvailability: {
    total: number;
    available: number;
    injured: number;
    suspended: number;
    unavailable: number;
  };
  moraleSummary: string;
  trainingSummary: string;
  scoutingUpdates: number;
  transferActivity: number;
  contractIssues: number;
  staffIssues: number;
  inbox: InboxItem[];
  medicalCentre?: MedicalAssessment[];
};

export type CalendarEntry = {
  date: ISODate;
  type: "FIXTURE" | "TRANSFER_WINDOW" | "CONTRACT_EXPIRY" | "SCOUTING" | "COMPETITION";
  title: string;
  detail?: string;
};

export type ContinueStopReason =
  "NEXT_FIXTURE" | "SCOUT_REPORT" | "TRANSFER_RESPONSE" | "CONTRACT_EXPIRY" | "SEASON_COMPLETE";

export type ContinueOutcome = {
  worldDate: ISODate;
  daysAdvanced: number;
  stopReason: ContinueStopReason;
  message: string;
};

export type QuickSimSummary = {
  fixtureId: EntityId;
  score: string;
  homeTeam: string;
  awayTeam: string;
  result: "W" | "D" | "L";
  scorers: Array<{ minute?: number; playerName: string; teamName: string }>;
  possession: { home: number; away: number };
  shots: { home: number; away: number };
  shotsOnTarget: { home: number; away: number };
  xg: { home: number; away: number };
  cards: Array<{ minute?: number; playerName: string; type: string }>;
  injuries: Array<{ playerName: string; minute?: number }>;
  ratings: Array<{ personId: EntityId; playerName: string; rating: number; minutes: number }>;
  attendance?: number;
};

/** Manager-mode runtime commands. Additive to `DesktopRuntimeApi`. */
export type ManagerRuntimeApi = {
  getManagerDashboard(): Promise<unknown>;
  getSquad(): Promise<unknown>;
  getPlayerProfile(playerId: EntityId): Promise<unknown>;
  getTactics(): Promise<unknown>;
  updateTactics(command: TacticsUpdateCommand): Promise<unknown>;
  getTraining(): Promise<unknown>;
  updateTraining(command: TrainingUpdateCommand): Promise<unknown>;
  getPlayerDevelopment(): Promise<unknown>;
  createPlayerDevelopmentPlan(command: CreateDevelopmentPlanCommand): Promise<unknown>;
  setPlayerDevelopmentPlanStatus(planId: EntityId, status: string): Promise<unknown>;
  getMedicalCentre(): Promise<unknown>;
  decideReturnToPlay(command: ReturnToPlayDecisionCommand): Promise<unknown>;
  getFixtures(): Promise<unknown>;
  getFixture(fixtureId: EntityId): Promise<unknown>;
  getCompetition(): Promise<unknown>;
  getScoutingDashboard(): Promise<unknown>;
  createScoutingAssignment(command: ScoutingAssignmentCommand): Promise<unknown>;
  getScoutingReport(playerId: EntityId): Promise<unknown>;
  toggleShortlist(playerId: EntityId): Promise<unknown>;
  searchRecruitment(command: RecruitmentSearchCommand): Promise<unknown>;
  getTransferCentre(): Promise<unknown>;
  makeTransferOffer(command: TransferOfferCommand): Promise<unknown>;
  respondTransferOffer(command: TransferResponseCommand): Promise<unknown>;
  makeTransferRequest(command: TransferRequestCommand): Promise<unknown>;
  respondTransferRequest(command: TransferRequestResponseCommand): Promise<unknown>;
  negotiateLoan(command: TransferLoanCommand): Promise<unknown>;
  setTransferStatus(command: TransferListCommand): Promise<unknown>;
  getContracts(): Promise<unknown>;
  renewContract(command: ContractRenewalCommand): Promise<unknown>;
  getStaff(clubId?: EntityId): Promise<unknown>;
  // Staff Market Phase B.
  getStaffMarket(): Promise<unknown>;
  applyForStaffRole(
    vacancyId: EntityId,
    personId: EntityId,
    salaryAmountMinor: number,
    contractMonths: number,
  ): Promise<unknown>;
  respondToStaffApplication(applicationId: EntityId, accept: boolean): Promise<unknown>;
  offerStaffContractRenewal(
    appointmentId: EntityId,
    salaryAmountMinor: number,
    contractMonths: number,
  ): Promise<unknown>;
  respondToStaffRenewal(offerId: EntityId, accept: boolean): Promise<unknown>;
  dismissStaffMember(appointmentId: EntityId): Promise<unknown>;
  enrolStaffLicenceCourse(personId: EntityId, clubFunded: boolean): Promise<unknown>;
  // Staff Market Phase C.
  getStaffHierarchy(): Promise<unknown>;
  assignStaffResponsibility(
    domain: string,
    ownerType: string,
    ownerAppointmentId?: EntityId,
  ): Promise<unknown>;
  requestStaffBoardApproval(domain: string): Promise<unknown>;
  createStaffDevelopmentPlan(
    personId: EntityId,
    focus: string,
    targetLicenceType?: string,
    clubFunded?: boolean,
  ): Promise<unknown>;
  getCalendar(): Promise<unknown>;
  // Manager Career World (Step 5).
  getJobCentre(): Promise<unknown>;
  applyForJob(vacancyId: EntityId): Promise<unknown>;
  declineJobOffer(applicationId: EntityId): Promise<unknown>;
  acceptJobOffer(applicationId: EntityId): Promise<unknown>;
  resignFromClub(): Promise<unknown>;
  getCareerHistory(): Promise<unknown>;
  // Squad Dynamics Phase B.
  getSquadConcerns(): Promise<unknown>;
  respondToConcern(concernId: EntityId, action: ConcernResponseAction): Promise<unknown>;
  holdSquadMeeting(command: SquadMeetingCommand): Promise<unknown>;
};

/** Attribute keys grouped for presentation. Values stay on the engine's 1-20 scale. */
export const ATTRIBUTE_GROUPS: ReadonlyArray<{
  group: AttributeGroupView["group"];
  source: keyof Pick<PlayerAttributeSet, "technical" | "mental" | "physical" | "goalkeeping">;
}> = [
  { group: "Technical", source: "technical" },
  { group: "Mental", source: "mental" },
  { group: "Physical", source: "physical" },
  { group: "Goalkeeping", source: "goalkeeping" },
];

// ---------------------------------------------------------------------------
// Live matchday (Step 4C)
//
// Read models only. The serialised engine state never reaches the client.
// ---------------------------------------------------------------------------

export type MatchCommentaryLine = {
  eventId: string;
  minute?: number;
  stoppageTime?: number;
  type: string;
  importance: "MINOR" | "NOTABLE" | "MAJOR" | "CRITICAL";
  teamId?: EntityId;
  /** Monotonic cursor so a live view can fetch only what is new. */
  sequence: number;
  text: string;
};

export type LivePlayerState = {
  personId: EntityId;
  name: string;
  position: string;
  status: "ON_PITCH" | "BENCH" | "SUBBED_OFF" | "SENT_OFF";
  minutes: number;
  rating: number;
  fitness: number;
  fatigue: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCard: boolean;
  injured: boolean;
  subbedOnMinute?: number;
  subbedOffMinute?: number;
};

export type LiveTeamView = {
  teamId: EntityId;
  teamName: string;
  goals: number;
  possession: number;
  shots: number;
  shotsOnTarget: number;
  xg: number;
  corners: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  onPitch: LivePlayerState[];
  bench: LivePlayerState[];
  playersOff: LivePlayerState[];
  substitutionsUsed: number;
  substitutionsRemaining: number;
  /** Fewer than eleven after a dismissal. */
  playersOnPitch: number;
  formation?: string;
  style?: string;
  mentality?: string;
};

export type LiveMatchView = {
  matchId: EntityId;
  fixtureId: EntityId;
  competitionName: string;
  period:
    | "NOT_STARTED"
    | "FIRST_HALF"
    | "HALF_TIME"
    | "SECOND_HALF"
    | "EXTRA_TIME_FIRST_HALF"
    | "EXTRA_TIME_HALF_TIME"
    | "EXTRA_TIME_SECOND_HALF"
    | "PENALTY_SHOOTOUT"
    | "FULL_TIME";
  minute: number;
  stoppageTime: number;
  /** Set when the match wants the manager's attention. */
  pauseReason?:
    | "HALF_TIME"
    | "INJURY_DECISION"
    | "RED_CARD"
    | "FULL_TIME"
    | "EXTRA_TIME_START"
    | "EXTRA_TIME_HALF_TIME"
    | "PENALTY_SHOOTOUT";
  viewMode: MatchViewMode;
  home: LiveTeamView;
  away: LiveTeamView;
  /** The team this career manages, so the UI knows which side to control. */
  managedTeamId: EntityId;
  commentary: MatchCommentaryLine[];
  /** Highest sequence included, to pass back as the next cursor. */
  cursor: number;
  /** Players who picked up an injury and may need replacing. */
  injuryDecisions: LivePlayerState[];
  finalized: boolean;
  /** Set for knockout ties: whether the tie currently requires a winner. */
  requiresWinner?: boolean;
  /** First-leg score of a two-leg tie, if this is the second leg. */
  aggregateFirstLeg?: { homeGoals: number; awayGoals: number };
  /** Aggregate score including this leg, only set when a first leg exists. */
  aggregateScore?: { home: number; away: number };
  shootoutHomeGoals?: number;
  shootoutAwayGoals?: number;
  winnerTeamId?: EntityId;
};

export type StartMatchCommand = {
  fixtureId?: EntityId;
  viewMode?: MatchViewMode;
};

export type AdvanceMatchCommand = {
  /** Defaults to a single minute. */
  minutes?: number;
  toNextEvent?: boolean;
  minImportance?: "MINOR" | "NOTABLE" | "MAJOR" | "CRITICAL";
  toHalfTime?: boolean;
  /** Cursor: only commentary after this sequence is returned. */
  since?: number;
};

export type SubstitutionCommand = {
  playerOffId: EntityId;
  playerOnId: EntityId;
};

export type LiveTacticsCommand = {
  formationId?: string;
  style?: string;
  mentality?: string;
  tempo?: number;
  passingLength?: number;
  width?: number;
  pressingIntensity?: number;
  defensiveLine?: number;
  engagementLine?: number;
  tacklingIntensity?: number;
  buildUpRisk?: number;
  counterPress?: boolean;
  regroup?: boolean;
  counter?: boolean;
  holdShape?: boolean;
  playFromBack?: boolean;
  workBallIntoBox?: boolean;
  earlyCrosses?: boolean;
  goalkeeperDistributionStyle?: GoalkeeperDistributionStyle;
  assignments?: Array<{ slotId: string; playerId?: EntityId; roleId: string }>;
};

export type MatchRatingRow = {
  personId: EntityId;
  name: string;
  teamId: EntityId;
  teamName: string;
  position?: string;
  minutes: number;
  rating: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCard: boolean;
  started: boolean;
  subbedOnMinute?: number;
  subbedOffMinute?: number;
};

export type PostMatchReport = {
  matchId: EntityId;
  fixtureId: EntityId;
  competitionName: string;
  venue?: string;
  date: ISODate;
  homeTeamName: string;
  awayTeamName: string;
  homeGoals: number;
  awayGoals: number;
  result: "W" | "D" | "L";
  attendance?: number;
  wentToExtraTime?: boolean;
  shootoutHomeGoals?: number;
  shootoutAwayGoals?: number;
  winnerTeamId?: EntityId;
  aggregateFirstLeg?: { homeGoals: number; awayGoals: number };
  aggregateScore?: { home: number; away: number };
  scorers: Array<{ minute?: number; playerName: string; teamName: string; assist?: string }>;
  stats: {
    possession: { home: number; away: number };
    shots: { home: number; away: number };
    shotsOnTarget: { home: number; away: number };
    xg: { home: number; away: number };
    corners: { home: number; away: number };
    fouls: { home: number; away: number };
    yellowCards: { home: number; away: number };
    redCards: { home: number; away: number };
  };
  timeline: MatchCommentaryLine[];
  ratings: MatchRatingRow[];
  playerOfTheMatch?: MatchRatingRow;
  substitutions: Array<{
    minute?: number;
    teamName: string;
    playerOn: string;
    playerOff: string;
    reason?: string;
  }>;
  tacticalChanges: Array<{
    minute?: number;
    teamName: string;
    decidedBy: string;
    summary: string;
  }>;
  cards: Array<{ minute?: number; playerName: string; teamName: string; type: string }>;
  injuries: Array<{ minute?: number; playerName: string; teamName: string; severity?: string }>;
  finances: Array<{ description: string; amount: number; currency: string; direction: string }>;
};
