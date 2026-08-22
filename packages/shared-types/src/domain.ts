import type { EntityId } from "./ids.js";

export type ISODate = string;
export type ISODateTime = string;

export type EntityRef = {
  id: EntityId;
  type:
    | "country"
    | "location"
    | "venue"
    | "federation"
    | "club"
    | "team"
    | "person"
    | "competition"
    | "competitionSeason"
    | "fixture"
    | "match"
    | "contract"
    | "transfer"
    | "loan"
    | "financeAccount"
    | "careerCharacter"
    | "managerProfile"
    | "managerContract"
    | "tacticalSetup"
    | "inboxItem";
};

export type Country = {
  id: EntityId;
  name: string;
  isoCode: string;
};

export type Location = {
  id: EntityId;
  countryId: EntityId;
  name: string;
  kind: "city" | "district" | "province" | "stadium" | "unknown";
  parentLocationId?: EntityId;
};

export type Venue = {
  id: EntityId;
  countryId: EntityId;
  locationId?: EntityId;
  name: string;
  capacity?: number;
  pitchType?: string;
};

export type Federation = {
  id: EntityId;
  countryId: EntityId;
  name: string;
  foundedYear?: number;
};

export type ClubOwnershipType =
  | "PRIVATE"
  | "CORPORATE"
  | "COMMUNITY"
  | "MEMBER_OWNED"
  | "DEPARTMENTAL"
  | "MUNICIPALITY_BACKED"
  | "INSTITUTIONAL"
  | "UNKNOWN";

export type Club = {
  id: EntityId;
  name: string;
  officialName?: string;
  shortName?: string;
  nepaliName?: string;
  canonicalExternalId?: string;
  countryId: EntityId;
  locationId?: EntityId;
  ownershipType: ClubOwnershipType;
  organisationType?: "CLUB" | "FRANCHISE" | "DEPARTMENTAL" | "ACADEMY" | "UNKNOWN";
  parentOrganisation?: string;
  foundedYear?: number;
};

export type ClubAlias = {
  id: EntityId;
  clubId: EntityId;
  alias: string;
  aliasType: "SHORT_NAME" | "FORMER_NAME" | "SPONSOR_NAME" | "COMMON_NAME" | "SEARCH_ALIAS";
};

export type Team = {
  id: EntityId;
  clubId?: EntityId;
  federationId?: EntityId;
  name: string;
  canonicalExternalId?: string;
  level: "senior" | "u23" | "u20" | "u17" | "reserve" | "academy";
  gender: "men" | "women" | "mixed" | "unknown";
};

export type ClubRelationship = {
  id: EntityId;
  parentClubId: EntityId;
  childClubId?: EntityId;
  childTeamId?: EntityId;
  relationshipType:
    | "MEN_FIRST_TEAM"
    | "WOMENS_BRANCH"
    | "YOUTH_BRANCH"
    | "ACADEMY"
    | "INSTITUTIONAL_PARENT"
    | "LINKED_ENTITY";
};

export type ClubMembership = {
  id: EntityId;
  clubId: EntityId;
  teamId?: EntityId;
  competitionId: EntityId;
  competitionSeasonId?: EntityId;
  membershipType: "FRANCHISE" | "LEAGUE_MEMBER" | "CUP_PARTICIPANT" | "WOMENS_COMPETITION";
  status: "ACTIVE" | "INACTIVE" | "REPORTED" | "UNKNOWN";
};

export type AcademyType =
  | "NATIONAL_ACADEMY"
  | "REGIONAL_ACADEMY"
  | "CLUB_ACADEMY"
  | "PRIVATE_ACADEMY"
  | "ACADEMY_CLUB_HYBRID";

export type Academy = {
  id: EntityId;
  name: string;
  canonicalExternalId?: string;
  countryId: EntityId;
  locationId?: EntityId;
  parentClubId?: EntityId;
  linkedClubId?: EntityId;
  federationId?: EntityId;
  academyType: AcademyType;
};

export type VenueRelationship = {
  id: EntityId;
  venueId: EntityId;
  clubId?: EntityId;
  teamId?: EntityId;
  relationshipType: "OWNER" | "OPERATOR" | "TENANT" | "TEMPORARY_USER" | "SHARED_USER" | "UNKNOWN";
};

export type TeamPersonAssignment = {
  id: EntityId;
  personId: EntityId;
  teamId: EntityId;
  role: PersonRoleType;
  startedOn?: ISODate;
  endedOn?: ISODate;
};

export type Person = {
  id: EntityId;
  fullName: string;
  displayName?: string;
  dateOfBirth?: ISODate;
  nationalityCountryId: EntityId;
  secondNationalityCountryId?: EntityId;
  genderPresentation?: string;
  placeOfBirthLocationId?: EntityId;
  hometownLocationId?: EntityId;
  languages: string[];
};

export type PersonRoleType =
  "PLAYER" | "MANAGER" | "STAFF" | "AGENT" | "CHAIRMAN" | "FEDERATION_OFFICIAL";

export type PersonRole = {
  id: EntityId;
  personId: EntityId;
  role: PersonRoleType;
  activeFrom: ISODate;
  activeTo?: ISODate;
};

export type Player = PersonRole & { role: "PLAYER" };
export type Manager = PersonRole & { role: "MANAGER" };
export type Staff = PersonRole & { role: "STAFF" };
export type Agent = PersonRole & { role: "AGENT" };
export type Chairman = PersonRole & { role: "CHAIRMAN" };
export type FederationOfficial = PersonRole & { role: "FEDERATION_OFFICIAL" };

export type CareerCharacter = {
  id: EntityId;
  personId: EntityId;
  preferredDisplayName?: string;
  startingAge?: number;
  footballBackground?: FootballBackground;
  education?: EducationBackground;
  playingExperience?: PlayingExperience;
  coachingExperience?: CoachingExperience;
  coachingLicences: CoachingLicence[];
  businessBackground?: BusinessBackground;
  startingReputationProfile?: string;
};

export type PlayingExperience =
  | "NO_PLAYING_EXPERIENCE"
  | "AMATEUR_PLAYER"
  | "SEMI_PROFESSIONAL_PLAYER"
  | "PROFESSIONAL_PLAYER"
  | "FORMER_INTERNATIONAL";

export type CoachingExperience =
  "NONE" | "GRASSROOTS" | "YOUTH_COACH" | "ASSISTANT_COACH" | "SENIOR_COACH";

export type EducationBackground =
  "BASIC" | "SECONDARY" | "UNIVERSITY" | "SPORTS_RELATED_DEGREE" | "BUSINESS_RELATED_DEGREE";

export type BusinessBackground =
  "NONE" | "SMALL_BUSINESS" | "CORPORATE" | "FINANCE" | "ENTREPRENEURSHIP";

export type FootballBackground =
  | "LOCAL_FOOTBALL"
  | "SCHOOL_FOOTBALL"
  | "ACADEMY"
  | "COMMUNITY_COACHING"
  | "ADMINISTRATION"
  | "OTHER";

export type CoachingLicence = {
  id: EntityId;
  level: string;
  issuingBody: string;
  issuedOn?: ISODate;
  expiresOn?: ISODate;
  requirements: string[];
  reputationEffect: number;
};

export type ManagerProfile = {
  id: EntityId;
  personId: EntityId;
  attributes: ManagerAttributeSet;
  preferredStyle?: TacticalStyleId;
  reputationProfile: string;
  createdOn: ISODate;
};

export type ManagerAttributeSet = {
  tactical: {
    tacticalKnowledge: number;
    adaptability: number;
    matchManagement: number;
    setPieceKnowledge: number;
  };
  coaching: {
    attackingCoaching: number;
    defensiveCoaching: number;
    technicalCoaching: number;
    mentalCoaching: number;
    fitnessUnderstanding: number;
    youthDevelopment: number;
  };
  people: {
    manManagement: number;
    motivation: number;
    discipline: number;
    communication: number;
  };
  recruitment: {
    playerJudgement: number;
    potentialJudgement: number;
  };
  personality: {
    reputation: number;
    mediaHandling: number;
    pressureHandling: number;
    professionalism: number;
    ambition: number;
    loyalty: number;
  };
};

export type ManagerContractStatus = "ACTIVE" | "RESIGNED" | "SACKED" | "EXPIRED";

export type ManagerContract = {
  id: EntityId;
  managerProfileId: EntityId;
  personId: EntityId;
  teamId?: EntityId;
  clubId?: EntityId;
  jobTitle: string;
  contractStart: ISODate;
  contractEnd?: ISODate;
  salaryAmountMinor: number;
  currency: string;
  status: ManagerContractStatus;
};

export type Competition = {
  id: EntityId;
  federationId?: EntityId;
  name: string;
  scope: "domestic" | "continental" | "international" | "local";
};

export type CompetitionSeason = {
  id: EntityId;
  competitionId: EntityId;
  name: string;
  startDate: ISODate;
  endDate: ISODate;
};

export type CompetitionType =
  "LEAGUE" | "CUP" | "GROUP_AND_KNOCKOUT" | "ROUND_ROBIN" | "DOUBLE_ROUND_ROBIN" | "CUSTOM_FUTURE";

export type TableTiebreaker =
  | "points"
  | "goalDifference"
  | "goalsScored"
  | "headToHeadPoints"
  | "headToHeadGoalDifference"
  | "headToHeadGoals"
  | "wins"
  | "fairPlay"
  | "playoff";

export type CompetitionRuleSet = {
  id: EntityId;
  competitionSeasonId: EntityId;
  competitionType: CompetitionType;
  pointsForWin: number;
  pointsForDraw: number;
  pointsForLoss: number;
  tiebreakers: TableTiebreaker[];
  numberOfRounds: number;
  homeAwayStructure: "single" | "double" | "neutral" | "custom";
  fixtureCount?: number;
  seasonStartDate: ISODate;
  seasonEndDate: ISODate;
  roundSpacingDays: number;
  promotionSlots: number;
  relegationSlots: number;
  continentalQualificationSlots: number;
};

export type Fixture = {
  id: EntityId;
  competitionSeasonId?: EntityId;
  homeTeamId: EntityId;
  awayTeamId: EntityId;
  scheduledDate: ISODate;
  status: "scheduled" | "postponed" | "played" | "cancelled";
};

export type FixtureRecord = Fixture & {
  round: number;
  venueId?: EntityId;
};

export type Match = {
  id: EntityId;
  fixtureId: EntityId;
  playedDate?: ISODate;
  homeGoals?: number;
  awayGoals?: number;
};

export type MatchEventType =
  | "KICK_OFF"
  | "SHOT"
  | "SHOT_ON_TARGET"
  | "GOAL"
  | "ASSIST"
  | "SAVE"
  | "CORNER"
  | "FOUL"
  | "YELLOW_CARD"
  | "RED_CARD"
  | "INJURY"
  | "SUBSTITUTION"
  | "HALF_TIME"
  | "SECOND_HALF"
  | "FULL_TIME"
  | "TACTICAL_CHANGE"
  | "VAR_CHECK"
  | "PENALTY"
  | "OFFSIDE"
  | "OWN_GOAL";

export type MatchEvent = {
  id: EntityId;
  matchId: EntityId;
  minute?: number;
  stoppageTime?: number;
  type: string;
  personId?: EntityId;
  teamId?: EntityId;
  primaryPersonId?: EntityId;
  secondaryPersonId?: EntityId;
  data?: Record<string, unknown>;
};

export type PlayerPosition = "GK" | "RB" | "CB" | "LB" | "DM" | "CM" | "AM" | "RW" | "LW" | "ST";

export type TacticalPositionCode =
  | "GK"
  | "DL"
  | "DCL"
  | "DC"
  | "DCR"
  | "DR"
  | "WBL"
  | "WBR"
  | "DM"
  | "DML"
  | "DMR"
  | "ML"
  | "MCL"
  | "MC"
  | "MCR"
  | "MR"
  | "AML"
  | "AMC"
  | "AMR"
  | "STL"
  | "STC"
  | "STR";

export type TacticalSlot = {
  id: string;
  label: string;
  position: TacticalPositionCode;
  x: number;
  y: number;
  zone:
    | "goalkeeper"
    | "defense"
    | "wingback"
    | "defensiveMidfield"
    | "midfield"
    | "attackingMidfield"
    | "forward";
};

export type FormationDefinition = {
  id: string;
  name: string;
  kind: "PRESET" | "CUSTOM";
  slots: TacticalSlot[];
};

export type RoleFamily =
  "GOALKEEPER" | "CENTRE_BACK" | "FULLBACK_WINGBACK" | "MIDFIELD" | "WIDE_ATTACKING" | "FORWARD";

export type PlayerRoleDefinition = {
  id: string;
  name: string;
  family: RoleFamily;
  weightedAttributes: Record<string, number>;
  preferredZones: TacticalSlot["zone"][];
  notes?: string;
};

export type RoleFit = {
  playerId: EntityId;
  slotId: string;
  roleId: string;
  positionFit: number;
  attributeFit: number;
  familiarity: number;
  preferredFootFit: number;
  physicalFit: number;
  overall: number;
  label: "Poor" | "Weak" | "Adequate" | "Good" | "Very Good" | "Natural";
};

export type TacticalStyleId =
  | "BALANCED"
  | "POSSESSION"
  | "GEGENPRESS"
  | "HIGH_PRESS"
  | "COUNTER_ATTACK"
  | "DIRECT"
  | "LOW_BLOCK"
  | "WING_PLAY"
  | "VERTICAL";

export type Mentality =
  | "VERY_DEFENSIVE"
  | "DEFENSIVE"
  | "CAUTIOUS"
  | "BALANCED"
  | "POSITIVE"
  | "ATTACKING"
  | "VERY_ATTACKING";

export type GoalkeeperDistributionStyle =
  "SHORT" | "CENTRE_BACKS" | "FULLBACKS" | "TARGET_FORWARD" | "MIXED" | "LONG";

export type TeamInstructions = {
  mentality: Mentality;
  inPossession: {
    tempo: number;
    passingLength: number;
    width: number;
    buildUpRisk: number;
    playFromBack: boolean;
    workBallIntoBox: boolean;
    earlyCrosses: boolean;
    focusMiddle: boolean;
    focusLeft: boolean;
    focusRight: boolean;
    overlapLeft: boolean;
    overlapRight: boolean;
    underlapLeft: boolean;
    underlapRight: boolean;
  };
  transition: {
    counterPress: boolean;
    regroup: boolean;
    counter: boolean;
    holdShape: boolean;
    goalkeeperDistributionStyle: GoalkeeperDistributionStyle;
  };
  outOfPossession: {
    pressingIntensity: number;
    defensiveLine: number;
    engagementLine: number;
    tacklingIntensity: number;
    pressGoalkeeper: boolean;
    stopShortDistribution: boolean;
    forceInside: boolean;
    forceOutside: boolean;
  };
};

export type TacticalFamiliarity = {
  formation: number;
  style: number;
  roles: number;
  instructions: number;
};

export type SetPieceAssignments = {
  penaltyTaker?: EntityId;
  directFreeKickTaker?: EntityId;
  leftCornerTaker?: EntityId;
  rightCornerTaker?: EntityId;
};

export type TacticalAssignment = {
  slotId: string;
  playerId?: EntityId;
  roleId: string;
};

export type TacticalSetup = {
  id: EntityId;
  managerProfileId?: EntityId;
  teamId: EntityId;
  name: string;
  formation: FormationDefinition;
  style: TacticalStyleId;
  instructions: TeamInstructions;
  familiarity: TacticalFamiliarity;
  assignments: TacticalAssignment[];
  bench: EntityId[];
  setPieces: SetPieceAssignments;
  createdOn: ISODate;
  updatedOn: ISODate;
};

export type TacticalShapeAnalysis = {
  width: number;
  centralDensity: number;
  defensiveCoverage: number;
  midfieldControl: number;
  attackingNumbers: number;
  restDefense: number;
  pressingStructure: number;
  warnings: string[];
};

export type SelectionValidation = {
  isValid: boolean;
  blockingErrors: string[];
  warnings: string[];
};

export type PlayerAttributeSet = {
  id: EntityId;
  personId: EntityId;
  primaryPosition: PlayerPosition;
  secondaryPositions: PlayerPosition[];
  technical: {
    firstTouch: number;
    passing: number;
    crossing: number;
    dribbling: number;
    finishing: number;
    heading: number;
    tackling: number;
    technique: number;
    longShots: number;
    setPieces: number;
  };
  mental: {
    decisions: number;
    vision: number;
    composure: number;
    positioning: number;
    anticipation: number;
    workRate: number;
    teamwork: number;
    leadership: number;
    aggression: number;
    determination: number;
    professionalism: number;
  };
  physical: {
    pace: number;
    acceleration: number;
    strength: number;
    stamina: number;
    agility: number;
    balance: number;
    jumping: number;
    naturalFitness: number;
  };
  goalkeeping: {
    handling: number;
    reflexes: number;
    oneOnOnes: number;
    aerialReach: number;
    kicking: number;
    distribution: number;
    commandOfArea: number;
  };
};

export type PlayerAvailability = {
  personId: EntityId;
  fitness: number;
  moraleModifier: number;
  formModifier: number;
  availability?: "AVAILABLE" | "INJURED" | "SUSPENDED" | "UNREGISTERED";
  injury?: InjuryRecord;
  suspension?: SuspensionRecord;
};

export type InjuryRecord = {
  id: EntityId;
  personId: EntityId;
  injuryType: string;
  dateOccurred: ISODate;
  expectedRecoveryDate: ISODate;
  severity: "minor" | "moderate" | "major";
};

export type SuspensionRecord = {
  id: EntityId;
  personId: EntityId;
  competitionSeasonId: EntityId;
  reason: "yellowAccumulation" | "redCard";
  matchesRemaining: number;
};

export type PlayerMatchState = {
  personId: EntityId;
  teamId: EntityId;
  startingFitness: number;
  currentFitness: number;
  fatigue: number;
  moraleModifier: number;
  formModifier: number;
  yellowCards: number;
  redCard: boolean;
  injuryDuringMatch?: InjuryRecord;
  minutesPlayed: number;
  position: PlayerPosition;
  role?: string;
  rating: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  passesAttempted: number;
  passesCompleted: number;
  tackles: number;
  interceptions: number;
  keyPasses: number;
  saves: number;
};

export type TeamMatchStats = {
  teamId: EntityId;
  possession: number;
  shots: number;
  shotsOnTarget: number;
  xg: number;
  corners: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
};

export type MatchResult = {
  match: Match;
  events: MatchEvent[];
  homeStats: TeamMatchStats;
  awayStats: TeamMatchStats;
  playerStates: PlayerMatchState[];
  attendance?: number;
  weather?: string;
  pitch?: string;
};

export type InboxItem = {
  id: EntityId;
  createdOn: ISODate;
  type: "FIXTURE_UPCOMING" | "MATCH_RESULT" | "INJURY" | "SUSPENSION" | "COMPETITION_UPDATE";
  title: string;
  body: string;
  relatedEntity?: EntityRef;
  read: boolean;
};

export type ManagerHomeSummary = {
  worldDate: ISODate;
  managerProfile: ManagerProfile;
  activeContract?: ManagerContract;
  nextFixture?: FixtureRecord;
  previousResult?: MatchResult;
  recentForm: string[];
  unavailablePlayers: EntityId[];
};

export type QuickSimResult = {
  result: MatchResult;
  standings: LeagueStanding[];
  inboxItems: InboxItem[];
  tacticalShape: TacticalShapeAnalysis;
  validation: SelectionValidation;
};

export type LeagueStanding = {
  competitionSeasonId: EntityId;
  teamId: EntityId;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

export type PlayerSeasonStat = {
  competitionSeasonId: EntityId;
  personId: EntityId;
  teamId: EntityId;
  appearances: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  averageRating: number;
  cleanSheets: number;
};

export type TeamSeasonStat = {
  competitionSeasonId: EntityId;
  teamId: EntityId;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
};

export type CompetitionWinner = {
  id: EntityId;
  competitionSeasonId: EntityId;
  teamId: EntityId;
  decidedOn: ISODate;
};

export type Contract = {
  id: EntityId;
  personId: EntityId;
  employerEntity: EntityRef;
  startsOn: ISODate;
  endsOn?: ISODate;
  wageAmountMinor: number;
  currency: string;
};

export type PlayerContract = Contract & { contractKind: "PLAYER" };
export type StaffContract = Contract & { contractKind: "STAFF" };

export type Transfer = {
  id: EntityId;
  personId: EntityId;
  fromClubId?: EntityId;
  toClubId: EntityId;
  transferDate: ISODate;
  feeAmountMinor?: number;
  currency?: string;
};

export type Loan = {
  id: EntityId;
  personId: EntityId;
  fromClubId: EntityId;
  toClubId: EntityId;
  startsOn: ISODate;
  endsOn: ISODate;
};

export type FinanceOwnerType = "PERSON" | "CLUB" | "FEDERATION";

export type FinanceAccount = {
  id: EntityId;
  ownerType: FinanceOwnerType;
  ownerId: EntityId;
  name: string;
  currency: string;
};

export type FinancialTransaction = {
  id: EntityId;
  accountId: EntityId;
  occurredOn: ISODate;
  amountMinor: number;
  currency: string;
  category: string;
  description?: string;
  relatedEntity?: EntityRef;
};

export type Relationship = {
  id: EntityId;
  fromEntity: EntityRef;
  toEntity: EntityRef;
  kind: string;
  strength?: number;
};

export type Promise = {
  id: EntityId;
  madeBy: EntityRef;
  madeTo: EntityRef;
  madeOn: ISODate;
  dueOn?: ISODate;
  status: "open" | "kept" | "broken" | "cancelled";
  description: string;
};

export type HistoricalEvent = {
  id: EntityId;
  occurredOn: ISODate;
  eventType: string;
  involvedEntities: EntityRef[];
  title: string;
  data?: Record<string, unknown>;
  importance: "low" | "medium" | "high" | "historic";
  scope: "person" | "club" | "federation" | "country" | "world";
};

export type ScheduledEvent = {
  id: EntityId;
  dueOn: ISODate;
  eventType: string;
  payload: Record<string, unknown>;
  status: "pending" | "processed" | "cancelled";
  processedOn?: ISODate;
};

export type SaveMetadata = {
  id: EntityId;
  name: string;
  worldDate: ISODate;
  databaseVersion: number;
  gameVersion: string;
  randomSeed: string;
  createdAt: ISODateTime;
  lastSavedAt: ISODateTime;
  playerCharacterId?: EntityId;
};

export type DataProvenanceStatus =
  "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN" | "SIMULATION_ONLY";

export type DataProvenance = {
  sourceId?: string;
  sourceUrl?: string;
  sourceName: string;
  lastVerifiedDate?: ISODate;
  retrievedAt?: ISODateTime;
  confidence: number;
  confidenceLevel?: "HIGH" | "MEDIUM" | "LOW";
  status: DataProvenanceStatus;
  notes?: string;
};
