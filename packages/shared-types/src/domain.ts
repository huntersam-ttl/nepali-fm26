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
    | "careerCharacter";
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
  countryId: EntityId;
  locationId?: EntityId;
  ownershipType: ClubOwnershipType;
  foundedYear?: number;
};

export type Team = {
  id: EntityId;
  clubId?: EntityId;
  federationId?: EntityId;
  name: string;
  level: "senior" | "u23" | "u20" | "u17" | "reserve" | "academy";
  gender: "men" | "women" | "mixed" | "unknown";
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
  footballBackground?: string;
  education?: string;
  playingExperience?: string;
  coachingLicences: string[];
  businessBackground?: string;
  startingReputationProfile?: string;
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
  sourceUrl?: string;
  sourceName: string;
  lastVerifiedDate?: ISODate;
  confidence: number;
  status: DataProvenanceStatus;
};
