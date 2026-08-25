import type { EntityId } from "./ids.js";
import type {
  InboxItem,
  ISODate,
  KnowledgeConfidence,
  KnowledgeRange,
  PlayerAttributeSet,
  PlayerDiscoveryStatus,
  PlayerKnowledgeLevel,
  PlayerPosition,
  TacticalFamiliarity,
  TacticalSetup,
  TeamInstructions,
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
  addOns: number;
  currency: string;
  status: string;
  submittedAt: ISODate;
  expiresAt: ISODate;
  negotiation: Array<{ round: number; actor: string; action: string; message: string }>;
};

export type TransferBudgetView = {
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
};

export type TransferResponseCommand = {
  offerId: EntityId;
  action: "ACCEPT" | "REJECT";
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

// ---------------------------------------------------------------------------
// Dashboard, calendar and continue
// ---------------------------------------------------------------------------

export type ManagerDashboard = {
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
  setTransferStatus(command: TransferListCommand): Promise<unknown>;
  getContracts(): Promise<unknown>;
  renewContract(command: ContractRenewalCommand): Promise<unknown>;
  getStaff(clubId?: EntityId): Promise<unknown>;
  getCalendar(): Promise<unknown>;
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
