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
    | "inboxItem"
    | "staffAppointment"
    | "staffVacancy"
    | "staffLicence"
    | "refereeProfile"
    | "staffProfile"
    | "staffHistoryEvent"
    | "trainingPlan"
    | "individualDevelopmentPlan"
    | "playerDevelopmentState"
    | "playerPotential"
    | "playerFactualProfile"
    | "trainingHistoryEvent"
    | "youthIntakeEvent"
    | "generatedPlayerOrigin"
    | "retirementState";
};

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export type Country = {
  id: EntityId;
  name: string;
  isoCode: string;
};

export type Location = {
  id: EntityId;
  canonicalExternalId?: string;
  countryId: EntityId;
  name: string;
  kind:
    | "city"
    | "municipality"
    | "neighbourhood"
    | "district"
    | "province"
    | "stadium"
    | "airport"
    | "unknown";
  parentLocationId?: EntityId;
  latitude?: number;
  longitude?: number;
  altitudeMeters?: number;
  climateProfile?: LocationClimateProfile;
};

export type Venue = {
  id: EntityId;
  canonicalExternalId?: string;
  countryId: EntityId;
  locationId?: EntityId;
  provinceId?: EntityId;
  districtId?: EntityId;
  cityId?: EntityId;
  name: string;
  officialName?: string;
  shortName?: string;
  aliases?: string[];
  venueType?: VenueType;
  capacity?: number;
  latitude?: number;
  longitude?: number;
  altitudeMeters?: number;
  surfaceType?: SurfaceType;
  pitchQuality?: PitchQuality;
  yearOpened?: number;
  yearLastRenovated?: number;
  floodlights?: boolean;
  runningTrack?: boolean;
  coveredStands?: boolean;
  ownerEntity?: string;
  operatorEntity?: string;
  status?: VenueStatus;
};

export type LocationClimateProfile = {
  climateZone?: string;
  seasonalHeatRisk: RiskLevel;
  monsoonRisk: RiskLevel;
  coldRisk: RiskLevel;
  humidityRisk: RiskLevel;
};

export type VenueType =
  | "STADIUM"
  | "FOOTBALL_GROUND"
  | "TRAINING_GROUND"
  | "ACADEMY_GROUND"
  | "MULTI_SPORT_STADIUM"
  | "NATIONAL_TRAINING_CENTRE"
  | "UNKNOWN";

export type SurfaceType = "NATURAL_GRASS" | "ARTIFICIAL_TURF" | "HYBRID" | "DIRT" | "UNKNOWN";

export type PitchQuality = "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "VERY_POOR" | "UNKNOWN";

export type VenueStatus = "ACTIVE" | "LIMITED_USE" | "UNDER_RENOVATION" | "CLOSED" | "UNKNOWN";

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
  status:
    | "ACTIVE"
    | "INACTIVE"
    | "REPORTED"
    | "UNKNOWN"
    | "QUALIFIED"
    | "PROMOTED"
    | "RELEGATED"
    | "WITHDRAWN"
    | "SUSPENDED"
    | "INELIGIBLE";
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

export type PlayerOriginType =
  | "CLUB_ACADEMY"
  | "NATIONAL_ACADEMY"
  | "REGIONAL_ACADEMY"
  | "DISTRICT_FOOTBALL"
  | "GRASSROOTS"
  | "PRIVATE_ACADEMY"
  | "DEPARTMENTAL_RECRUITMENT"
  | "GENERATED_FREE_PLAYER"
  | "FOREIGN_YOUTH"
  | "DIASPORA_YOUTH";

export type YouthPlayerStatus =
  | "ACADEMY_CANDIDATE"
  | "YOUTH_PLAYER"
  | "RESERVE_PLAYER"
  | "FIRST_TEAM_PROSPECT"
  | "FIRST_TEAM_PLAYER";

export type PlayerArchetype =
  | "BALL_PLAYING_CB"
  | "PHYSICAL_CB"
  | "ATTACKING_FULLBACK"
  | "DEFENSIVE_FULLBACK"
  | "BALL_WINNING_MIDFIELDER"
  | "DEEP_PLAYMAKER"
  | "BOX_TO_BOX"
  | "CREATIVE_MIDFIELDER"
  | "WINGER"
  | "INSIDE_FORWARD"
  | "TARGET_FORWARD"
  | "MOBILE_STRIKER"
  | "POACHER"
  | "SWEEPER_KEEPER"
  | "SHOT_STOPPER";

export type CountryDevelopmentProfile = {
  id: EntityId;
  countryId: EntityId;
  effectiveFrom: ISODate;
  footballPopularity: number;
  grassrootsReach: number;
  coachingQuality: number;
  youthInfrastructure: number;
  talentConversion: number;
  status: "SIMULATION_ONLY";
  notes?: string;
};

export type AcademySimulationProfile = {
  id: EntityId;
  academyId?: EntityId;
  clubId?: EntityId;
  countryId: EntityId;
  youthRecruitmentQuality: number;
  academyCoachingQuality: number;
  academyFacilitiesQuality: number;
  regionalReach: number;
  talentIdentificationQuality: number;
  status: "SIMULATION_ONLY";
};

export type YouthIntakeEvent = {
  id: EntityId;
  countryId: EntityId;
  clubId?: EntityId;
  academyId?: EntityId;
  intakeDate: ISODate;
  seasonLabel: string;
  intakeType: PlayerOriginType;
  playersGenerated: number;
  averageCurrentAbility: number;
  averagePotential: number;
  highestPotential: number;
  status: "SIMULATION_ONLY";
  seedKey: string;
  data?: Record<string, unknown>;
};

export type GeneratedPlayerOrigin = {
  id: EntityId;
  playerId: EntityId;
  originType: PlayerOriginType;
  originDataType: "SIMULATION_ONLY";
  countryId: EntityId;
  clubId?: EntityId;
  academyId?: EntityId;
  locationId?: EntityId;
  districtLocationId?: EntityId;
  intakeEventId?: EntityId;
  generatedOn: ISODate;
  nameGenerationKey: string;
  archetype: PlayerArchetype;
  youthStatus: YouthPlayerStatus;
  eligibility: {
    nationalityCountryId: EntityId;
    secondNationalityCountryId?: EntityId;
    ageGroupEligible: boolean;
    diaspora: boolean;
  };
  sourceNotes?: string;
};

export type YouthPlayerStatusRecord = {
  playerId: EntityId;
  youthStatus: YouthPlayerStatus;
  clubId?: EntityId;
  academyId?: EntityId;
  statusSince: ISODate;
  pathway: Record<string, unknown>;
};

export type YouthDevelopmentActivity = {
  id: EntityId;
  playerId: EntityId;
  clubId?: EntityId;
  academyId?: EntityId;
  activityDate: ISODate;
  activityType: "ACADEMY_TRAINING" | "RESERVE_ACTIVITY" | "LOCAL_COMPETITION" | "TRIAL";
  developmentMinutes: number;
  exposureLevel: number;
  data?: Record<string, unknown>;
};

export type RetirementState =
  "ACTIVE" | "CONSIDERING_RETIREMENT" | "RETIREMENT_ANNOUNCED" | "RETIRED";

export type PlayerRetirementRecord = {
  playerId: EntityId;
  state: RetirementState;
  decidedOn: ISODate;
  announcedOn?: ISODate;
  retirementDate?: ISODate;
  reason?: string;
  staffInterest: number;
  data?: Record<string, unknown>;
};

export type RetiredStaffTransition = {
  id: EntityId;
  playerId: EntityId;
  staffRole: "COACH" | "ASSISTANT_COACH" | "MANAGER" | "SCOUT" | "ACADEMY_COACH" | "DIRECTOR";
  clubId?: EntityId;
  academyId?: EntityId;
  federationId?: EntityId;
  transitionedOn: ISODate;
  status: "SIMULATION_ONLY";
  data?: Record<string, unknown>;
};

export type VenueRelationship = {
  id: EntityId;
  venueId: EntityId;
  clubId?: EntityId;
  teamId?: EntityId;
  federationId?: EntityId;
  academyId?: EntityId;
  relationshipType:
    | "OWNER"
    | "OPERATOR"
    | "PRIMARY_TENANT"
    | "TENANT"
    | "TEMPORARY_USER"
    | "SHARED_USER"
    | "TRAINING_USER"
    | "ACADEMY_USER"
    | "NATIONAL_TEAM_USER"
    | "UNKNOWN";
  startDate?: ISODate;
  endDate?: ISODate;
  competitionSeasonId?: EntityId;
  status:
    | "available"
    | "unavailable"
    | "underRenovation"
    | "sharedConflict"
    | "federationAssigned"
    | "unknown";
};

export type LocationTravelContext = {
  id: EntityId;
  fromLocationId: EntityId;
  toLocationId: EntityId;
  roadDistanceKm?: number;
  estimatedRoadTravelHours?: number;
  airTravelAvailable?: boolean;
  nearestAirportId?: EntityId;
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

export type FootballStaffRole =
  | "HEAD_COACH"
  | "ASSISTANT_COACH"
  | "FIRST_TEAM_COACH"
  | "GOALKEEPER_COACH"
  | "FITNESS_COACH"
  | "SET_PIECE_COACH"
  | "YOUTH_COACH"
  | "ACADEMY_DIRECTOR"
  | "SCOUT"
  | "CHIEF_SCOUT"
  | "ANALYST"
  | "HEAD_ANALYST"
  | "PHYSIO"
  | "HEAD_PHYSIO"
  | "DOCTOR"
  | "SPORTS_SCIENTIST"
  | "NUTRITIONIST"
  | "PSYCHOLOGIST"
  | "SPORTING_DIRECTOR"
  | "TECHNICAL_DIRECTOR"
  | "DIRECTOR_OF_FOOTBALL"
  | "CHAIRMAN"
  | "PRESIDENT"
  | "VICE_PRESIDENT"
  | "CEO"
  | "GENERAL_SECRETARY"
  | "BOARD_MEMBER"
  | "FEDERATION_PRESIDENT"
  | "FEDERATION_GENERAL_SECRETARY"
  | "FEDERATION_EXECUTIVE"
  | "TECHNICAL_COMMITTEE_MEMBER"
  | "REFEREE_COMMITTEE_MEMBER"
  | "NATIONAL_TEAM_HEAD_COACH"
  | "NATIONAL_TEAM_ASSISTANT"
  | "NATIONAL_TEAM_GK_COACH"
  | "NATIONAL_TEAM_PHYSIO"
  | "NATIONAL_TEAM_ANALYST"
  | "REFEREE"
  | "ASSISTANT_REFEREE"
  | "FOURTH_OFFICIAL"
  | "VAR_OFFICIAL"
  | "REFEREE_INSTRUCTOR"
  | "REFEREE_ASSESSOR"
  | string;

export type StaffEmploymentStatus =
  "ACTIVE" | "FORMER" | "INTERIM" | "CONTRACT_EXPIRED" | "UNKNOWN";

export type StaffOrganisationType =
  "CLUB" | "TEAM" | "FEDERATION" | "ACADEMY" | "PARENT_ORGANISATION" | "NATIONAL_TEAM" | "UNKNOWN";

export type StaffAppointment = {
  id: EntityId;
  personId: EntityId;
  organisationType: StaffOrganisationType;
  clubId?: EntityId;
  teamId?: EntityId;
  federationId?: EntityId;
  academyId?: EntityId;
  organisationName?: string;
  role: FootballStaffRole;
  startDate?: ISODate;
  endDate?: ISODate;
  employmentStatus: StaffEmploymentStatus;
  contractId?: EntityId;
  serviceRankTitle?: string;
};

export type StaffVacancy = {
  id: EntityId;
  organisationType: StaffOrganisationType;
  clubId?: EntityId;
  teamId?: EntityId;
  federationId?: EntityId;
  academyId?: EntityId;
  organisationName?: string;
  role: FootballStaffRole;
  required: boolean;
  assignedPersonId?: EntityId;
  status: "FILLED" | "VACANT" | "UNKNOWN";
};

export type StaffLicence = {
  id: EntityId;
  personId: EntityId;
  licenceType: string;
  issuer: string;
  issueDate?: ISODate;
  expiryDate?: ISODate;
  status: "VERIFIED" | "REPORTED" | "UNKNOWN";
};

export type RefereeProfile = {
  id: EntityId;
  personId: EntityId;
  refereeLevel?: string;
  fifaListed?: boolean;
  fifaListedSince?: ISODate;
  primaryRole: FootballStaffRole;
  competitionsEligible: EntityId[];
  experienceLevel?: string;
};

export type StaffProfile = {
  id: EntityId;
  personId: EntityId;
  preferredRole?: FootballStaffRole;
  salaryExpectation?: string;
  reputation?: string;
  countryKnowledge: EntityId[];
  clubKnowledge: EntityId[];
  availability?: "AVAILABLE" | "EMPLOYED" | "UNKNOWN";
  workEligibilityStatus?: "ELIGIBLE" | "REQUIRES_PERMIT" | "UNKNOWN";
};

export type StaffHistoryEvent = {
  id: EntityId;
  personId: EntityId;
  eventType:
    | "MANAGER_APPOINTED"
    | "MANAGER_SACKED"
    | "MANAGER_RESIGNED"
    | "STAFF_JOINED"
    | "STAFF_LEFT"
    | "FEDERATION_OFFICIAL_APPOINTED"
    | "FEDERATION_OFFICIAL_LEFT"
    | "REFEREE_PROMOTED";
  occurredOn: ISODate;
  appointmentId?: EntityId;
  clubId?: EntityId;
  teamId?: EntityId;
  federationId?: EntityId;
  academyId?: EntityId;
  description?: string;
};

export type Competition = {
  id: EntityId;
  federationId?: EntityId;
  name: string;
  scope: "domestic" | "continental" | "international" | "local";
  category?: CompetitionCategory;
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

export type CompetitionCategory =
  | "PYRAMID_LEAGUE"
  | "FRANCHISE_LEAGUE"
  | "QUALIFICATION_LEAGUE"
  | "CUP"
  | "SPECIAL_NATIONAL_LEAGUE"
  | "WOMENS_LEAGUE"
  | "YOUTH_COMPETITION";

export type SeasonSpecialRuleFlag =
  | "relegationSuspended"
  | "promotionSuspended"
  | "temporaryExpandedLeague"
  | "specialQualificationPath"
  | "competitionPostponed"
  | "competitionSuspended";

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
  promotionEnabled?: boolean;
  relegationEnabled?: boolean;
  specialRules?: Partial<Record<SeasonSpecialRuleFlag, boolean>>;
};

export type CompetitionMovementType = "PROMOTION" | "RELEGATION" | "QUALIFICATION";

export type CompetitionMovementSelectionMethod =
  "TOP_TABLE" | "BOTTOM_TABLE" | "QUALIFIER_RESULT" | "FEDERATION_DECISION" | "MANUAL";

export type CompetitionRelationship = {
  id: EntityId;
  fromCompetitionId: EntityId;
  toCompetitionId: EntityId;
  movementType: CompetitionMovementType;
  numberOfTeams: number;
  selectionMethod: CompetitionMovementSelectionMethod;
  effectiveSeasonId?: EntityId;
};

export type CompetitionMovement = {
  id: EntityId;
  clubId: EntityId;
  teamId?: EntityId;
  fromCompetitionId: EntityId;
  toCompetitionId: EntityId;
  fromCompetitionSeasonId: EntityId;
  toCompetitionSeasonId: EntityId;
  movementType: CompetitionMovementType;
  status: "PLANNED" | "APPLIED" | "SUSPENDED" | "INELIGIBLE";
  reason?: string;
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

export type TrainingIntensity = "LOW" | "NORMAL" | "HIGH" | "VERY_HIGH";

export type TrainingSessionCategory =
  | "RECOVERY"
  | "FITNESS"
  | "ENDURANCE"
  | "STRENGTH"
  | "SPEED"
  | "AGILITY"
  | "TECHNICAL_GENERAL"
  | "PASSING"
  | "FIRST_TOUCH"
  | "DRIBBLING"
  | "FINISHING"
  | "CROSSING"
  | "DEFENDING"
  | "TACKLING"
  | "HEADING"
  | "TACTICAL_GENERAL"
  | "ATTACKING_SHAPE"
  | "DEFENSIVE_SHAPE"
  | "PRESSING"
  | "TRANSITION"
  | "POSSESSION"
  | "COUNTER_ATTACK"
  | "SET_PIECES_ATTACK"
  | "SET_PIECES_DEFENCE"
  | "GOALKEEPING"
  | "GK_SHOT_STOPPING"
  | "GK_DISTRIBUTION"
  | "MATCH_PREPARATION"
  | "TEAM_BONDING"
  | "VIDEO_ANALYSIS"
  | "REST"
  | string;

export type TrainingGroup =
  | "FULL_SQUAD"
  | "GOALKEEPERS"
  | "DEFENDERS"
  | "MIDFIELDERS"
  | "ATTACKERS"
  | "YOUTH"
  | "RESERVES"
  | "CUSTOM";

export type TrainingPlanSource = "USER" | "AI" | "DEFAULT";

export type TrainingSession = {
  day: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
  slot: number;
  category: TrainingSessionCategory;
  intensity: TrainingIntensity;
  targetGroup: TrainingGroup;
  coachAssignmentId?: EntityId;
};

export type TrainingPlan = {
  id: EntityId;
  teamId: EntityId;
  name: string;
  effectiveFrom: ISODate;
  effectiveTo?: ISODate;
  intensity: TrainingIntensity;
  sessions: TrainingSession[];
  source: TrainingPlanSource;
};

export type DevelopmentFocusType =
  "ATTRIBUTE" | "POSITION" | "ROLE" | "PHYSICAL" | "TECHNICAL" | "MENTAL" | "BALANCED";

export type IndividualDevelopmentPlan = {
  id: EntityId;
  playerId: EntityId;
  focusType: DevelopmentFocusType;
  targetPosition?: PlayerPosition;
  targetRole?: string;
  targetAttributeGroup?: "technical" | "mental" | "physical" | "goalkeeping";
  intensity: TrainingIntensity;
  startDate: ISODate;
  endDate?: ISODate;
  status: "ACTIVE" | "PAUSED" | "COMPLETED";
};

export type DevelopmentPhase =
  "YOUTH_DEVELOPMENT" | "EARLY_CAREER" | "PRIME" | "LATE_PRIME" | "DECLINE";

export type FamiliarityLevel = "NATURAL" | "ACCOMPLISHED" | "COMPETENT" | "BASIC" | "UNFAMILIAR";

export type PlayerDevelopmentState = {
  id: EntityId;
  playerId: EntityId;
  developmentPhase: DevelopmentPhase;
  trainingLoad: number;
  fatigue: number;
  matchSharpness: number;
  fitness: number;
  recovery: number;
  developmentMomentum: number;
  positionFamiliarity: Record<string, number>;
  roleFamiliarity: Record<string, number>;
  lastTrainingDate?: ISODate;
  lastDevelopmentUpdate?: ISODate;
};

export type PlayerPotential = {
  id: EntityId;
  playerId: EntityId;
  potentialCeiling: number;
  developmentRate: number;
  volatility: number;
  professionalism: number;
  status: "SIMULATION_ONLY";
};

export type PlayerFactualProfile = {
  id: EntityId;
  playerId: EntityId;
  canonicalExternalId: string;
  currentClubId?: EntityId;
  nameVariants: string[];
  nepaliName?: string;
  factualPrimaryPosition?: PlayerPosition;
  factualSecondaryPositions: PlayerPosition[];
  factualPositionGroup?: "GOALKEEPER" | "DEFENDER" | "MIDFIELDER" | "FORWARD" | "UNKNOWN";
  positionPrecision: "EXACT" | "GENERAL" | "UNKNOWN";
  sourcePosition?: string;
  squadStatus?: "STARTER" | "REGULAR" | "SQUAD" | "RESERVE" | "YOUTH" | "UNKNOWN";
  shirtNumber?: number;
  goalkeeperFlag?: boolean;
  latestKnownAppearanceDate?: ISODate;
  dateOfBirth?: ISODate;
  heightCm?: number;
  preferredFoot?: "RIGHT" | "LEFT" | "BOTH" | "UNKNOWN";
  nationality?: string;
  placeOfBirth?: string;
  previousClubs: string[];
  factualContractStatus: "UNKNOWN" | "REPORTED" | "VERIFIED";
  recordStatus: "VERIFIED" | "REPORTED" | "UNKNOWN";
  confidenceLevel: "HIGH" | "MEDIUM" | "LOW";
  lastVerified?: ISODate;
  simulationPrimaryPosition: PlayerPosition;
  simulationPrimaryPositionStatus: "SIMULATION_ONLY";
  simulationAgeProfile: "YOUNG" | "EARLY_CAREER" | "PRIME" | "EXPERIENCED" | "VETERAN" | "UNKNOWN";
  simulationDateOfBirth?: ISODate;
  simulationDateOfBirthStatus?: "SIMULATION_ONLY";
  simulationHeightCm?: number;
  simulationHeightStatus?: "SIMULATION_ONLY";
  simulationPreferredFoot?: "RIGHT" | "LEFT" | "BOTH";
  simulationPreferredFootStatus?: "SIMULATION_ONLY";
  currentAbility: number;
  potentialAbility: number;
  reputation: number;
  hiddenTraits: {
    professionalism: number;
    consistency: number;
    ambition: number;
    adaptability: number;
    pressureHandling: number;
    injuryProneness: number;
    developmentRate: number;
    status: "SIMULATION_ONLY";
  };
  evidence: Array<{
    summary?: string;
    date?: ISODate;
    sourceUrls: string[];
    whatItConfirms?: string;
    status: "VERIFIED" | "REPORTED" | "UNKNOWN";
    confidenceLevel: "HIGH" | "MEDIUM" | "LOW";
  }>;
};

export type PlayerDevelopmentCurve = {
  id: EntityId;
  name: string;
  youthMaxAge: number;
  earlyCareerMaxAge: number;
  primeMaxAge: number;
  latePrimeMaxAge: number;
};

export type PlayerPlayingTimeSnapshot = {
  id: EntityId;
  playerId: EntityId;
  competitionSeasonId?: EntityId;
  minutesLast30Days: number;
  minutesSeason: number;
  startsSeason: number;
  subAppearances: number;
  updatedOn: ISODate;
};

export type CompetitionDevelopmentMultiplier = {
  id: EntityId;
  competitionId: EntityId;
  multiplier: number;
  status: "SIMULATION_ONLY" | "UNKNOWN";
};

export type StaffSimulationProfile = {
  id: EntityId;
  personId: EntityId;
  coachingTechnical: number;
  coachingTactical: number;
  coachingPhysical: number;
  coachingMental: number;
  goalkeeping: number;
  youthDevelopment: number;
  manManagement: number;
  status: "SIMULATION_ONLY";
};

export type TrainingFacilityProfile = {
  id: EntityId;
  clubId?: EntityId;
  academyId?: EntityId;
  trainingFacilityQuality?: number;
  youthFacilityQuality?: number;
  medicalFacilityQuality?: number;
  status: "SIMULATION_ONLY" | "UNKNOWN";
};

export type TrainingInjuryRiskSignal = {
  playerId: EntityId;
  load: number;
  fatigue: number;
  recovery: number;
  physicalCondition: number;
  risk: number;
};

export type TrainingHistoryEvent = {
  id: EntityId;
  playerId?: EntityId;
  teamId?: EntityId;
  eventType:
    | "TRAINING_PLAN_CHANGED"
    | "INDIVIDUAL_FOCUS_STARTED"
    | "POSITION_TRAINING_STARTED"
    | "POSITION_FAMILIARITY_INCREASED"
    | "ATTRIBUTE_IMPROVED"
    | "ATTRIBUTE_DECLINED"
    | "PLAYER_OVERTRAINED"
    | "PLAYER_RETURNED_TO_FULL_TRAINING";
  occurredOn: ISODate;
  data?: Record<string, unknown>;
};

export type PlayerKnowledgeObserverType =
  "CLUB" | "MANAGER" | "SCOUT" | "FEDERATION" | "NATIONAL_TEAM";
export type PlayerKnowledgeLevel = "NONE" | "MINIMAL" | "BASIC" | "GOOD" | "EXTENSIVE" | "COMPLETE";
export type PlayerDiscoveryStatus = "UNDISCOVERED" | "DISCOVERED" | "KNOWN" | "SCOUTED";
export type KnowledgeConfidence = "LOW" | "MEDIUM" | "HIGH";
export type PlayerKnowledgeSourceType =
  | "PUBLIC"
  | "MATCH_OBSERVATION"
  | "SCOUT_REPORT"
  | "TRIAL"
  | "OWN_PLAYER"
  | "FORMER_PLAYER"
  | "NATIONAL_TEAM"
  | "AGENT"
  | "TRANSFER_INTEREST";

export type KnowledgeRange = {
  min: number;
  max: number;
};

export type PlayerKnowledge = {
  id: EntityId;
  observerType: PlayerKnowledgeObserverType;
  observerOrganisationId: EntityId;
  playerId: EntityId;
  discoveryStatus: PlayerDiscoveryStatus;
  knowledgeLevel: PlayerKnowledgeLevel;
  confidence: KnowledgeConfidence;
  sourceType: PlayerKnowledgeSourceType;
  identityKnowledge: Record<string, unknown>;
  positionKnowledge: Record<string, unknown>;
  abilityKnowledge: Record<string, unknown>;
  potentialKnowledge: Record<string, unknown>;
  contractKnowledge: Record<string, unknown>;
  personalityKnowledge: Record<string, unknown>;
  medicalKnowledge: Record<string, unknown>;
  careerKnowledge: Record<string, unknown>;
  observations: number;
  lastObservedAt?: ISODate;
  lastScoutedAt?: ISODate;
  updatedAt: ISODate;
};

export type ClubRecruitmentProfile = {
  id: EntityId;
  clubId: EntityId;
  domesticKnowledge: number;
  regionalKnowledge: number;
  internationalKnowledge: number;
  scoutingBudget: number;
  networkReach: "LOCAL" | "DISTRICT" | "REGIONAL" | "NATIONAL" | "SOUTH_ASIA" | "GLOBAL";
  preferredMarkets: string[];
  status: "SIMULATION_ONLY";
};

export type ScoutingStaffSimulationProfile = {
  id: EntityId;
  personId: EntityId;
  playerJudgement: number;
  potentialJudgement: number;
  adaptability: number;
  regionalKnowledge: number;
  assignmentSpeed: number;
  status: "SIMULATION_ONLY";
};

export type ScoutingAssignmentType =
  "PLAYER" | "CLUB" | "COMPETITION" | "REGION" | "POSITION" | "SHORTLIST";
export type ScoutingAssignmentStatus = "QUEUED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
export type ScoutingAssignmentPriority = "LOW" | "NORMAL" | "HIGH";

export type ScoutingAssignment = {
  id: EntityId;
  clubId: EntityId;
  scoutPersonId?: EntityId;
  assignmentType: ScoutingAssignmentType;
  targetPlayerId?: EntityId;
  targetClubId?: EntityId;
  targetCompetitionId?: EntityId;
  targetLocationId?: EntityId;
  startedAt: ISODate;
  expectedCompletionAt: ISODate;
  status: ScoutingAssignmentStatus;
  priority: ScoutingAssignmentPriority;
};

export type ScoutReportRecommendation =
  "DO_NOT_SIGN" | "BACKUP" | "ROTATION" | "STARTER" | "KEY_PLAYER" | "PROSPECT";

export type ScoutReport = {
  id: EntityId;
  playerId: EntityId;
  observerClubId: EntityId;
  scoutId?: EntityId;
  estimatedAbilityBand: KnowledgeRange;
  estimatedPotentialBand: string;
  strengths: string[];
  weaknesses: string[];
  positionAssessment: string;
  roleAssessment: string;
  personalityAssessment: string;
  medicalAssessment: string;
  recommendation: ScoutReportRecommendation;
  confidence: KnowledgeConfidence;
  observations: number;
  generatedAt: ISODate;
};

export type ShortlistPriority = "MONITOR" | "INTERESTED" | "HIGH_PRIORITY";

export type ClubShortlistItem = {
  id: EntityId;
  clubId: EntityId;
  playerId: EntityId;
  addedAt: ISODate;
  priority: ShortlistPriority;
  notes?: string;
  scoutingStatus: ScoutingAssignmentStatus | "NONE";
};

export type PlayerContractType =
  | "PERMANENT"
  | "SHORT_TERM"
  | "YOUTH"
  | "AMATEUR"
  | "SEMI_PRO"
  | "PROFESSIONAL"
  | "SIMULATION_ONLY";
export type PlayerContractStatus =
  "ACTIVE" | "EXPIRED" | "TERMINATED" | "AGREED_FUTURE" | "UNKNOWN";
export type PlayerSquadRole =
  "KEY_PLAYER" | "IMPORTANT_PLAYER" | "FIRST_TEAM" | "ROTATION" | "BACKUP" | "PROSPECT" | "YOUTH";

export type PlayerContractRecord = {
  id: EntityId;
  playerId: EntityId;
  clubId: EntityId;
  startDate: ISODate;
  endDate: ISODate;
  contractType: PlayerContractType;
  salary: number;
  appearanceFee: number;
  goalBonus: number;
  cleanSheetBonus: number;
  signingBonus: number;
  loyaltyBonus: number;
  currency: string;
  squadRole: PlayerSquadRole;
  releaseClause?: number;
  status: PlayerContractStatus;
  provenance: DataProvenance;
};

export type TransferWindowType = "PRIMARY" | "SECONDARY" | "SPECIAL" | "DOMESTIC_ONLY";
export type TransferWindowStatus = "SCHEDULED" | "OPEN" | "CLOSED";

export type TransferWindow = {
  id: EntityId;
  countryId: EntityId;
  competitionId?: EntityId;
  windowType: TransferWindowType;
  openDate: ISODate;
  closeDate: ISODate;
  registrationDeadline: ISODate;
  status: TransferWindowStatus;
  provenance: DataProvenance;
  rules: {
    freeAgentsAllowedOutsideWindow: boolean;
    loansAllowed: boolean;
    youthRegistrationAllowed: boolean;
    emergencyGoalkeeperAllowed: boolean;
    domesticOnly: boolean;
  };
};

export type TransferStatus =
  | "NOT_FOR_SALE"
  | "AVAILABLE"
  | "TRANSFER_LISTED"
  | "LOAN_LISTED"
  | "FREE_AGENT"
  | "CONTRACT_EXPIRING"
  | "INTERESTED_IN_MOVE"
  | "UNSETTLED";

export type PlayerTransferStatusRecord = {
  id: EntityId;
  playerId: EntityId;
  clubId?: EntityId;
  status: TransferStatus;
  reason: string;
  setBy: "CLUB" | "PLAYER" | "SYSTEM";
  updatedAt: ISODate;
};

export type ClubFinancialProfile = {
  id: EntityId;
  clubId: EntityId;
  wageBudget: number;
  transferBudget: number;
  currentWageSpend: number;
  financialHealth: "POOR" | "STABLE" | "GOOD";
  currency: string;
  status: "SIMULATION_ONLY";
};

export type ClubEmploymentModel =
  "STANDARD" | "DEPARTMENTAL" | "AMATEUR" | "SEMI_PRO" | "FRANCHISE_TEMPORARY";

export type ClubEmploymentProfile = {
  id: EntityId;
  clubId: EntityId;
  employmentModel: ClubEmploymentModel;
  contractProfile: "SEASONAL" | "SHORT_TERM" | "SEMI_PRO" | "PROFESSIONAL";
  status: "SIMULATION_ONLY";
};

export type ClubEconomicType =
  | "COMMUNITY_CLUB"
  | "DEPARTMENTAL_CLUB"
  | "PRIVATE_CLUB"
  | "FRANCHISE_CLUB"
  | "ACADEMY_CLUB"
  | "MUNICIPALITY_BACKED"
  | "NON_PROFIT"
  | "UNKNOWN";

export type ClubFinancialHealth =
  "EXCELLENT" | "HEALTHY" | "STABLE" | "TIGHT" | "DISTRESSED" | "INSOLVENT";

export type ClubFinancialAccount = {
  clubId: EntityId;
  currency: string;
  cashBalance: number;
  restrictedCash: number;
  receivables: number;
  payables: number;
  debtBalance: number;
  equityBalance: number;
  seasonRevenue: number;
  seasonExpenses: number;
  seasonProfitLoss: number;
  financialHealth: ClubFinancialHealth;
  lastUpdatedAt: ISODate;
  status: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type ClubLedgerCategory =
  | "MATCHDAY_REVENUE"
  | "SPONSORSHIP"
  | "BROADCASTING"
  | "PRIZE_MONEY"
  | "TRANSFER_INCOME"
  | "TRANSFER_EXPENSE"
  | "PLAYER_WAGES"
  | "STAFF_WAGES"
  | "FACILITY_COST"
  | "TRAVEL"
  | "ACADEMY"
  | "MEDICAL"
  | "ADMIN"
  | "MARKETING"
  | "LOAN_PAYMENT"
  | "DEBT_INTEREST"
  | "OWNER_INVESTMENT"
  | "EQUITY_INVESTMENT"
  | "GRANT"
  | "FINE"
  | "OTHER";

export type ClubLedgerDirection = "CREDIT" | "DEBIT";

export type ClubLedgerEntry = {
  id: EntityId;
  clubId: EntityId;
  date: ISODate;
  category: ClubLedgerCategory;
  direction: ClubLedgerDirection;
  amount: number;
  currency: string;
  description: string;
  relatedEntityId?: EntityId;
  status: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type ClubBudgetCategory =
  | "WAGE_BUDGET"
  | "TRANSFER_BUDGET"
  | "STAFF_BUDGET"
  | "ACADEMY_BUDGET"
  | "FACILITY_BUDGET"
  | "SCOUTING_BUDGET"
  | "MARKETING_BUDGET";

export type ClubBudget = {
  id: EntityId;
  clubId: EntityId;
  seasonLabel: string;
  category: ClubBudgetCategory;
  amount: number;
  usedAmount: number;
  currency: string;
  status: "ACTIVE" | "CLOSED";
  provenanceStatus: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type OwnershipHolderType =
  "PERSON" | "ORGANISATION" | "GOVERNMENT_BODY" | "COMMUNITY" | "UNKNOWN";

export type ClubOwnershipRole =
  | "OWNER"
  | "MAJORITY_OWNER"
  | "MINORITY_OWNER"
  | "CHAIRMAN"
  | "PRESIDENT"
  | "BOARD_MEMBER"
  | "INVESTOR";

export type ClubOwnershipStatus = "ACTIVE" | "FORMER" | "UNKNOWN";

export type ClubOwnershipModel =
  | "BUYABLE"
  | "PARTIALLY_BUYABLE"
  | "COMMUNITY_CONTROLLED"
  | "DEPARTMENTAL"
  | "STATE_CONTROLLED"
  | "FRANCHISE"
  | "UNKNOWN";

export type ClubOwnershipStake = {
  id: EntityId;
  clubId: EntityId;
  holderType: OwnershipHolderType;
  holderId?: EntityId;
  holderName: string;
  role: ClubOwnershipRole;
  percentage?: number;
  votingPercentage?: number;
  startDate: ISODate;
  endDate?: ISODate;
  status: ClubOwnershipStatus;
  ownershipModel: ClubOwnershipModel;
  provenanceStatus: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type PersonalFinancialProfile = {
  personId: EntityId;
  cash: number;
  investments: number;
  assets: number;
  liabilities: number;
  netWorth: number;
  currency: string;
  lastUpdatedAt: ISODate;
  status: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type OwnerInvestmentForm = "EQUITY" | "SHAREHOLDER_LOAN" | "DONATION" | "CAPITAL_INJECTION";

export type OwnerInvestmentTransaction = {
  id: EntityId;
  personId: EntityId;
  clubId: EntityId;
  date: ISODate;
  amount: number;
  currency: string;
  form: OwnerInvestmentForm;
  personalLedgerEntryId: EntityId;
  clubLedgerEntryId: EntityId;
  status: "POSTED" | "VOID";
  provenanceStatus: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type ClubDebt = {
  id: EntityId;
  clubId: EntityId;
  lenderType: "BANK" | "FINANCE_COMPANY" | "SHAREHOLDER" | "SHORT_TERM" | "OTHER";
  principal: number;
  outstandingPrincipal: number;
  interestRate: number;
  currency: string;
  startDate: ISODate;
  maturityDate: ISODate;
  repaymentSchedule: "MONTHLY" | "QUARTERLY" | "SEASONAL" | "BULLET";
  status: "ACTIVE" | "REPAID" | "DEFAULTED";
  provenanceStatus: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type SponsorOrganisation = {
  id: EntityId;
  name: string;
  industry: string;
  countryId?: EntityId;
  reputation: number;
  budgetTier: "LOCAL" | "REGIONAL" | "NATIONAL" | "PREMIUM";
  status: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type SponsorshipType =
  | "SHIRT_MAIN"
  | "SHIRT_SECONDARY"
  | "SLEEVE"
  | "TRAINING_KIT"
  | "STADIUM"
  | "ACADEMY"
  | "OFFICIAL_PARTNER"
  | "LOCAL_PARTNER";

export type SponsorshipContract = {
  id: EntityId;
  clubId: EntityId;
  sponsorId: EntityId;
  type: SponsorshipType;
  startDate: ISODate;
  endDate: ISODate;
  annualValue: number;
  bonuses: Record<string, number>;
  currency: string;
  status: "OFFERED" | "ACTIVE" | "EXPIRED" | "REJECTED";
  provenanceStatus: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type SupporterSentiment =
  "VERY_POSITIVE" | "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "VERY_NEGATIVE";

export type ClubSupporterProfile = {
  clubId: EntityId;
  coreSupporters: number;
  casualSupporters: number;
  regionalSupport: number;
  diasporaSupport: number;
  activeSupport: number;
  familySupport: number;
  youthSupport: number;
  clubPopularity: number;
  footballReputation: number;
  commercialReputation: number;
  sentiment: SupporterSentiment;
  standardTicketPrice: number;
  currency: string;
  status: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type ClubFacilityProfile = {
  clubId: EntityId;
  trainingFacilityQuality: number;
  youthFacilityQuality: number;
  medicalFacilityQuality: number;
  analyticsFacilityQuality: number;
  academyCapacity: number;
  monthlyOperatingCost: number;
  currency: string;
  status: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type InfrastructureProjectType =
  | "TRAINING_GROUND"
  | "GYM"
  | "MEDICAL_ROOM"
  | "RECOVERY_CENTRE"
  | "ACADEMY"
  | "OFFICE"
  | "SCOUTING_DEPARTMENT"
  | "ANALYSIS_ROOM"
  | "STADIUM"
  | "STAND"
  | "FLOODLIGHTS"
  | "PITCH"
  | "DRAINAGE";

export type InfrastructureProjectStatus =
  "IDEA" | "PLANNING" | "APPROVED" | "FINANCING" | "CONSTRUCTION" | "COMPLETED" | "CANCELLED";

export type InfrastructureProject = {
  id: EntityId;
  clubId: EntityId;
  projectType: InfrastructureProjectType;
  locationId?: EntityId;
  venueId?: EntityId;
  planningStart: ISODate;
  constructionStart?: ISODate;
  expectedCompletion: ISODate;
  completedAt?: ISODate;
  capitalCost: number;
  ongoingCost: number;
  currency: string;
  status: InfrastructureProjectStatus;
  financingJson: Record<string, number>;
  provenanceStatus: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type ClubAsset = {
  id: EntityId;
  clubId: EntityId;
  assetType: "LAND" | "BUILDING" | "VENUE" | "TRAINING_GROUND" | "EQUIPMENT" | "OTHER";
  ownership: "OWNED" | "LEASED" | "USED_BY_PERMISSION" | "UNKNOWN";
  locationId?: EntityId;
  venueId?: EntityId;
  estimatedValue: number;
  currency: string;
  status: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type ClubValuation = {
  clubId: EntityId;
  valuation: number;
  currency: string;
  calculatedAt: ISODate;
  method: "SIMULATION_FOUNDATION";
  status: "SIMULATION_ONLY";
};

export type ClubBoardPolicy = {
  clubId: EntityId;
  financialRiskTolerance: "LOW" | "BALANCED" | "HIGH";
  transferPhilosophy: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE" | "PLAYER_TRADING";
  youthPriority: number;
  commercialPriority: number;
  infrastructurePriority: number;
  strategicObjective:
    | "SURVIVE"
    | "PROMOTION"
    | "TITLE_CHALLENGE"
    | "YOUTH_DEVELOPMENT"
    | "FINANCIAL_STABILITY"
    | "COMMERCIAL_GROWTH"
    | "INFRASTRUCTURE"
    | "PLAYER_TRADING";
  chairmanPersonId?: EntityId;
  updatedAt: ISODate;
  status: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type ClubFinancialStatement = {
  id: EntityId;
  clubId: EntityId;
  seasonLabel: string;
  openingCash: number;
  revenueByCategory: Record<string, number>;
  expensesByCategory: Record<string, number>;
  operatingProfit: number;
  transferProfitLoss: number;
  netProfitLoss: number;
  closingCash: number;
  debt: number;
  currency: string;
  closedAt: ISODate;
  status: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type AgentNegotiationStyle = "BALANCED" | "AGGRESSIVE" | "LOYAL" | "CAREER_FIRST";

export type AgentProfile = {
  id: EntityId;
  personId: EntityId;
  agencyName?: string;
  reputation: number;
  negotiationStyle: AgentNegotiationStyle;
  aggressiveness: number;
  loyaltyPreference: number;
  feeExpectation: number;
  careerAmbition: number;
  status: "SIMULATION_ONLY";
};

export type AgentClient = {
  id: EntityId;
  agentId: EntityId;
  playerId: EntityId;
  startedAt: ISODate;
  status: "ACTIVE" | "ENDED";
};

export type TransferOfferType =
  "PERMANENT" | "LOAN" | "LOAN_WITH_OPTION" | "LOAN_WITH_OBLIGATION" | "FREE_TRANSFER";
export type TransferOfferStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "NEGOTIATING"
  | "ACCEPTED"
  | "REJECTED"
  | "WITHDRAWN"
  | "EXPIRED"
  | "COMPLETED";

export type TransferOffer = {
  id: EntityId;
  buyingClubId: EntityId;
  sellingClubId?: EntityId;
  playerId: EntityId;
  offerType: TransferOfferType;
  transferFee: number;
  installments: number;
  addOns: number;
  sellOnPercentage: number;
  submittedAt: ISODate;
  expiresAt: ISODate;
  status: TransferOfferStatus;
  currency: string;
  askingRange?: KnowledgeRange;
  agentFee: number;
  signingFee: number;
};

export type NegotiationRound = {
  id: EntityId;
  offerId: EntityId;
  roundNumber: number;
  actor: "BUYING_CLUB" | "SELLING_CLUB" | "PLAYER_AGENT" | "SYSTEM";
  action: "OFFER" | "DEMAND" | "COUNTER" | "ACCEPT" | "REJECT";
  salary?: number;
  squadRole?: PlayerSquadRole;
  contractLengthMonths?: number;
  agentFee?: number;
  signingFee?: number;
  message: string;
  createdAt: ISODate;
};

export type LoanStatus = "ACTIVE" | "ENDED" | "CANCELLED";

export type PlayerLoanRecord = {
  id: EntityId;
  parentClubId: EntityId;
  loanClubId: EntityId;
  playerId: EntityId;
  startDate: ISODate;
  endDate: ISODate;
  wageContributionPercent: number;
  loanFee?: number;
  playingTimeExpectation: PlayerSquadRole;
  recallAllowed: boolean;
  purchaseOption?: number;
  status: LoanStatus;
};

export type CompetitionRegistrationType =
  "CONTRACTED" | "LOAN" | "TEMPORARY_NSL" | "CUP" | "YOUTH" | "SPECIAL";
export type CompetitionRegistrationStatus = "ACTIVE" | "EXPIRED" | "CANCELLED";

export type CompetitionRegistration = {
  id: EntityId;
  playerId: EntityId;
  clubId: EntityId;
  competitionSeasonId: EntityId;
  registrationType: CompetitionRegistrationType;
  registeredFrom: ISODate;
  registeredUntil?: ISODate;
  status: CompetitionRegistrationStatus;
};

export type TransferHistoryEventType =
  | "TRANSFER_COMPLETED"
  | "FREE_AGENT_SIGNED"
  | "LOAN_STARTED"
  | "LOAN_ENDED"
  | "CONTRACT_RENEWED"
  | "CONTRACT_EXPIRED"
  | "PLAYER_RELEASED"
  | "TRANSFER_REQUESTED";

export type TransferHistoryEvent = {
  id: EntityId;
  playerId: EntityId;
  clubId?: EntityId;
  relatedClubId?: EntityId;
  eventType: TransferHistoryEventType;
  occurredOn: ISODate;
  data?: Record<string, unknown>;
};

export type SquadNeed = {
  positionGroup: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  reason: string;
};

export type SquadNeedReport = {
  id: EntityId;
  clubId: EntityId;
  generatedAt: ISODate;
  needs: SquadNeed[];
  expectedDepartures: number;
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

export type FederationFinancialHealth =
  "EXCELLENT" | "HEALTHY" | "STABLE" | "TIGHT" | "DISTRESSED" | "INSOLVENT";

export type FederationSimulationProfile = {
  federationId: EntityId;
  countryId: EntityId;
  reputation: number;
  financialHealth: FederationFinancialHealth;
  grassrootsDevelopment: number;
  youthDevelopment: number;
  coachEducation: number;
  refereeDevelopment: number;
  competitionOrganisation: number;
  commercialStrength: number;
  internationalRelations: number;
  governanceStability: number;
  infrastructureLevel: number;
  lastUpdatedAt: ISODate;
  status: "SIMULATION_ONLY";
};

export type FederationFinancialAccount = {
  federationId: EntityId;
  currency: string;
  cashBalance: number;
  restrictedFunds: number;
  receivables: number;
  payables: number;
  debt: number;
  seasonRevenue: number;
  seasonExpenses: number;
  seasonProfitLoss: number;
  financialHealth: FederationFinancialHealth;
  lastUpdatedAt: ISODate;
  status: "SIMULATION_ONLY";
};

export type FederationLedgerCategory =
  | "FIFA_GRANT"
  | "AFC_GRANT"
  | "GOVERNMENT_GRANT"
  | "SPONSORSHIP"
  | "BROADCASTING"
  | "STREAMING"
  | "MATCH_REVENUE"
  | "COMPETITION_FEES"
  | "REGISTRATION_FEES"
  | "FINES"
  | "TOURNAMENT_DISTRIBUTION"
  | "PRIZE_DISTRIBUTION"
  | "CLUB_GRANTS"
  | "NATIONAL_TEAM_COST"
  | "PLAYER_ALLOWANCES"
  | "TRAVEL"
  | "STAFF_WAGES"
  | "YOUTH_DEVELOPMENT"
  | "GRASSROOTS"
  | "COACH_EDUCATION"
  | "REFEREE_DEVELOPMENT"
  | "INFRASTRUCTURE"
  | "ACADEMY"
  | "ADMINISTRATION"
  | "MARKETING"
  | "MEDICAL"
  | "COMMERCIAL"
  | "OTHER";

export type FederationLedgerDirection = "CREDIT" | "DEBIT";

export type FederationLedgerEntry = {
  id: EntityId;
  federationId: EntityId;
  date: ISODate;
  category: FederationLedgerCategory;
  direction: FederationLedgerDirection;
  amount: number;
  currency: string;
  description: string;
  relatedEntityId?: EntityId;
  restrictionTag?: string;
  status: "SIMULATION_ONLY";
};

export type FederationBudgetCategory =
  | "NATIONAL_TEAMS"
  | "YOUTH_DEVELOPMENT"
  | "GRASSROOTS"
  | "COACH_EDUCATION"
  | "REFEREE_DEVELOPMENT"
  | "COMPETITIONS"
  | "INFRASTRUCTURE"
  | "CLUB_SUPPORT"
  | "COMMERCIAL"
  | "ADMINISTRATION"
  | "WOMENS_FOOTBALL";

export type FederationBudget = {
  id: EntityId;
  federationId: EntityId;
  seasonLabel: string;
  category: FederationBudgetCategory;
  amount: number;
  usedAmount: number;
  currency: string;
  status: "ACTIVE" | "CLOSED";
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationLeadershipRole =
  "FEDERATION_PRESIDENT" | "VICE_PRESIDENT" | "GENERAL_SECRETARY" | "EXECUTIVE_MEMBER";

export type FederationLeadershipTenure = {
  id: EntityId;
  personId: EntityId;
  federationId: EntityId;
  role: FederationLeadershipRole;
  termStart: ISODate;
  termEnd?: ISODate;
  status: "ACTIVE" | "FORMER" | "INTERIM";
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationCommitteeType =
  | "COMPETITION_COMMITTEE"
  | "TECHNICAL_COMMITTEE"
  | "REFEREE_COMMITTEE"
  | "WOMENS_FOOTBALL_COMMITTEE"
  | "YOUTH_COMMITTEE"
  | "FINANCE_COMMITTEE"
  | "COMMERCIAL_COMMITTEE";

export type FederationCommittee = {
  id: EntityId;
  federationId: EntityId;
  committeeType: FederationCommitteeType;
  name: string;
  chairPersonId?: EntityId;
  status: "ACTIVE" | "INACTIVE";
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationStrategicPriority =
  | "GRASSROOTS_EXPANSION"
  | "YOUTH_ELITE_DEVELOPMENT"
  | "COACH_EDUCATION"
  | "REFEREE_DEVELOPMENT"
  | "CLUB_PROFESSIONALISATION"
  | "NATIONAL_TEAM_PERFORMANCE"
  | "WOMENS_FOOTBALL"
  | "INFRASTRUCTURE"
  | "COMMERCIAL_GROWTH"
  | "INTERNATIONAL_EXPOSURE";

export type FederationStrategyPriority = {
  id: EntityId;
  federationId: EntityId;
  priority: FederationStrategicPriority;
  weight: number;
  effectiveFrom: ISODate;
  effectiveTo?: ISODate;
  status: "ACTIVE" | "INACTIVE";
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationProjectType =
  | "GRASSROOTS_PROGRAMME"
  | "COACH_EDUCATION"
  | "REFEREE_PROGRAMME"
  | "ACADEMY_EXPANSION"
  | "NATIONAL_TRAINING_CENTRE"
  | "REGIONAL_CENTRE"
  | "WOMENS_DEVELOPMENT"
  | "DIGITAL_BROADCAST"
  | "CLUB_SUPPORT_PROGRAMME";

export type FederationProjectStatus =
  "IDEA" | "PLANNING" | "FINANCING" | "CONSTRUCTION" | "IMPLEMENTATION" | "COMPLETED" | "CANCELLED";

export type FederationProject = {
  id: EntityId;
  federationId: EntityId;
  projectType: FederationProjectType;
  name: string;
  locationId?: EntityId;
  targetProvinceId?: EntityId;
  targetDistrictId?: EntityId;
  academyId?: EntityId;
  startDate: ISODate;
  expectedCompletion: ISODate;
  completedAt?: ISODate;
  capitalCost: number;
  annualOperatingCost: number;
  currency: string;
  status: FederationProjectStatus;
  impactJson: Record<string, number>;
  fundingJson: Record<string, number>;
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationAsset = {
  id: EntityId;
  federationId: EntityId;
  assetType:
    "LAND" | "TRAINING_CENTRE" | "ACADEMY_FACILITY" | "OFFICE" | "TECHNICAL_CENTRE" | "EQUIPMENT";
  ownership: "OWNED" | "OPERATED" | "LEASED" | "UNKNOWN";
  locationId?: EntityId;
  academyId?: EntityId;
  estimatedValue: number;
  currency: string;
  status: "SIMULATION_ONLY";
};

export type CompetitionReformProposal = {
  id: EntityId;
  federationId: EntityId;
  competitionId: EntityId;
  effectiveSeason: string;
  changes: {
    teamCount?: number;
    rounds?: number;
    promotionSlots?: number;
    relegationSlots?: number;
    format?: CompetitionType;
    calendar?: { startDate?: ISODate; endDate?: ISODate };
    registrationPolicy?: Record<string, unknown>;
  };
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "IMPLEMENTED";
  proposedAt: ISODate;
  decidedAt?: ISODate;
  provenanceStatus: "SIMULATION_ONLY";
};

export type ClubLicensingOutcome = "LICENSED" | "CONDITIONAL" | "FAILED" | "EXEMPT" | "UNKNOWN";

export type ClubLicensingAssessment = {
  id: EntityId;
  federationId: EntityId;
  clubId: EntityId;
  seasonLabel: string;
  financial: ClubLicensingOutcome;
  stadium: ClubLicensingOutcome;
  youth: ClubLicensingOutcome;
  medical: ClubLicensingOutcome;
  administrative: ClubLicensingOutcome;
  coaching: ClubLicensingOutcome;
  legal: ClubLicensingOutcome;
  overall: ClubLicensingOutcome;
  assessedAt: ISODate;
  status: "SIMULATION_ONLY";
};

export type FederationGrantDistribution = {
  id: EntityId;
  federationId: EntityId;
  clubId: EntityId;
  date: ISODate;
  grantType:
    | "INFRASTRUCTURE_GRANT"
    | "ACADEMY_GRANT"
    | "WOMENS_FOOTBALL_GRANT"
    | "CLUB_DEVELOPMENT_GRANT"
    | "TRAVEL_SUPPORT";
  amount: number;
  currency: string;
  federationLedgerEntryId: EntityId;
  clubLedgerEntryId: EntityId;
  status: "POSTED";
  provenanceStatus: "SIMULATION_ONLY";
};

export type NationalTeamCallupStatus =
  "CALLED_UP" | "WITHDRAWN" | "INJURED" | "DECLINED" | "RELEASED";

export type NationalTeamCallup = {
  id: EntityId;
  nationalTeamId: EntityId;
  playerId: EntityId;
  callupDate: ISODate;
  programme: string;
  squadType: "PRELIMINARY" | "FINAL" | "MATCHDAY";
  status: NationalTeamCallupStatus;
  provenanceStatus: "SIMULATION_ONLY";
};

export type NationalTeamAppearance = {
  id: EntityId;
  nationalTeamId: EntityId;
  playerId: EntityId;
  matchDate: ISODate;
  opponentName: string;
  minutes: number;
  goals: number;
  status: "SIMULATION_ONLY";
};

export type NationalTeamFixture = {
  id: EntityId;
  federationId: EntityId;
  nationalTeamId: EntityId;
  opponentName: string;
  fixtureDate: ISODate;
  fixtureType: "FRIENDLY" | "QUALIFIER" | "REGIONAL_TOURNAMENT" | "TRAINING_MATCH";
  venueId?: EntityId;
  status: "SCHEDULED" | "PLAYED" | "CANCELLED";
  homeGoals?: number;
  awayGoals?: number;
  estimatedCost: number;
  estimatedRevenue: number;
  currency: string;
  provenanceStatus: "SIMULATION_ONLY";
};

export type PlayerEligibilityStatus =
  | "ELIGIBLE"
  | "PROVISIONALLY_ELIGIBLE"
  | "DOCUMENTATION_REQUIRED"
  | "CAP_TIED"
  | "INELIGIBLE"
  | "UNKNOWN";

export type PlayerInternationalEligibility = {
  id: EntityId;
  playerId: EntityId;
  federationId: EntityId;
  status: PlayerEligibilityStatus;
  documentationStatus: "UNKNOWN" | "NOT_STARTED" | "IN_PROGRESS" | "CONFIRMED";
  discoveredVia: "NATIONALITY" | "DIASPORA_SCOUTING" | "SELF_DECLARED" | "UNKNOWN";
  lastReviewedAt: ISODate;
  provenanceStatus: DataProvenanceStatus;
};

export type CoachEducationProgramme = {
  id: EntityId;
  federationId: EntityId;
  licenceLevel: "AFC C" | "AFC B" | "AFC A" | "AFC Pro";
  startDate: ISODate;
  endDate: ISODate;
  capacity: number;
  cost: number;
  graduates: number;
  currency: string;
  status: "PLANNED" | "RUNNING" | "COMPLETED";
  provenanceStatus: "SIMULATION_ONLY";
};

export type RefereeDevelopmentProgramme = {
  id: EntityId;
  federationId: EntityId;
  programmeType:
    "TRAINING" | "FITNESS" | "VAR_EDUCATION" | "INTERNATIONAL_CERTIFICATION" | "YOUTH_PATHWAY";
  startDate: ISODate;
  endDate: ISODate;
  capacity: number;
  cost: number;
  refereesAdvanced: number;
  currency: string;
  status: "PLANNED" | "RUNNING" | "COMPLETED";
  provenanceStatus: "SIMULATION_ONLY";
};

export type OrganisationRelationship = {
  id: EntityId;
  federationId: EntityId;
  organisationName: "GOVERNMENT" | "NATIONAL_SPORTS_COUNCIL" | "FIFA" | "AFC" | "SAFF" | string;
  relationshipType: "GOVERNMENT" | "SPORTS_COUNCIL" | "INTERNATIONAL_BODY" | "NATIONAL_ASSOCIATION";
  supportLevel: number;
  trust: number;
  fundingRelationship: number;
  updatedAt: ISODate;
  status: "SIMULATION_ONLY";
};

export type FederationSponsorshipContract = {
  id: EntityId;
  federationId: EntityId;
  sponsorId: EntityId;
  type:
    | "NATIONAL_TEAM_SHIRT"
    | "TECHNICAL_PARTNER"
    | "COMPETITION_TITLE"
    | "OFFICIAL_PARTNER"
    | "BROADCAST_PARTNER";
  startDate: ISODate;
  endDate: ISODate;
  annualValue: number;
  currency: string;
  status: "OFFERED" | "ACTIVE" | "EXPIRED" | "REJECTED";
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationObjective = {
  id: EntityId;
  federationId: EntityId;
  objective:
    | "QUALIFY_FOR_ASIAN_CUP"
    | "IMPROVE_YOUTH_PIPELINE"
    | "PROFESSIONALISE_LEAGUES"
    | "BUILD_NATIONAL_CENTRE"
    | "GROW_WOMENS_FOOTBALL"
    | "IMPROVE_REFEREE_STANDARDS"
    | "EXPAND_GRASSROOTS"
    | "INCREASE_COMMERCIAL_REVENUE";
  cycleStart: ISODate;
  cycleEnd: ISODate;
  progress: number;
  status: "ACTIVE" | "COMPLETED" | "FAILED";
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationKPI = {
  id: EntityId;
  federationId: EntityId;
  seasonLabel: string;
  metric:
    | "REGISTERED_CLUBS"
    | "ACTIVE_YOUTH_PLAYERS"
    | "LICENSED_COACHES"
    | "REFEREE_POOL"
    | "ACADEMY_OUTPUT"
    | "LEAGUE_ATTENDANCE"
    | "COMMERCIAL_REVENUE"
    | "NATIONAL_TEAM_REPUTATION"
    | "INTERNATIONAL_WINS"
    | "INFRASTRUCTURE_SCORE"
    | "WOMENS_FOOTBALL_SUPPORT";
  value: number;
  measuredAt: ISODate;
  status: "SIMULATION_ONLY";
};

export type FederationFinancialStatement = {
  id: EntityId;
  federationId: EntityId;
  seasonLabel: string;
  openingCash: number;
  revenueByCategory: Record<string, number>;
  expensesByCategory: Record<string, number>;
  programmeSpending: number;
  nationalTeamSpending: number;
  competitionSpending: number;
  infrastructureSpending: number;
  netProfitLoss: number;
  closingCash: number;
  debt: number;
  currency: string;
  closedAt: ISODate;
  status: "SIMULATION_ONLY";
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
  publishedAt?: ISODateTime;
  lastVerifiedDate?: ISODate;
  retrievedAt?: ISODateTime;
  confidence: number;
  confidenceLevel?: "HIGH" | "MEDIUM" | "LOW";
  status: DataProvenanceStatus;
  notes?: string;
};
