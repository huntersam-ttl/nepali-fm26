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

export type SimulationClubStatus = "ACTIVE" | "DORMANT" | "FAILED";
export type SimulationClubRecord = {
  id: EntityId;
  clubId: EntityId;
  locationId: EntityId;
  foundedOn: ISODate;
  ownershipType: ClubOwnershipType;
  initialReputation: number;
  supporterBase: number;
  status: SimulationClubStatus;
  admissionStatus: "PENDING" | "ADMITTED" | "REJECTED";
  venueId?: EntityId;
  provenanceStatus: "SIMULATION_ONLY";
};
export type SimulationClubLifecycleEvent = {
  id: EntityId;
  clubId: EntityId;
  eventType: "FOUNDED" | "ADMISSION_REQUESTED" | "ADMITTED" | "REJECTED" | "DORMANT" | "REVIVED";
  occurredOn: ISODate;
  reason: string;
  provenanceStatus: "SIMULATION_ONLY";
};
export type ClubDevelopmentProgramme = {
  id: EntityId;
  clubId: EntityId;
  teamId: EntityId;
  programmeType: "WOMENS_SENIOR" | "WOMENS_YOUTH" | "YOUTH_PATHWAY";
  annualBudget: number;
  annualOperatingCost: number;
  startedOn: ISODate;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  provenanceStatus: "SIMULATION_ONLY";
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
  | "DIASPORA_YOUTH"
  | "GIRLS_DEVELOPMENT";

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
  /**
   * Which event produced this cohort. Distinct from `status`, which records how
   * factual the players are: both sources generate SIMULATION_ONLY people.
   */
  source: YouthIntakeSource;
  data?: Record<string, unknown>;
};

/** A club's recurring academy intake, or one-off squad repair during save creation. */
export type YouthIntakeSource = "ANNUAL_INTAKE" | "BOOTSTRAP_SQUAD_REPAIR";

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
  activityType: "ACADEMY_TRAINING" | "RESERVE_ACTIVITY" | "LOCAL_COMPETITION" | "TRIAL" | "FOREIGN_DEVELOPMENT_PROGRAMME";
  developmentMinutes: number;
  exposureLevel: number;
  data?: Record<string, unknown>;
};

export type YouthPartnershipDevelopmentProgramme = {
  id: EntityId;
  playerId: EntityId;
  homeClubId: EntityId;
  partnerClubId: EntityId;
  partnershipId: EntityId;
  programmeType: "FOREIGN_YOUTH_DEVELOPMENT";
  startDate: ISODate;
  endDate: ISODate;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  developmentApplied: boolean;
  completedOn?: ISODate;
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

/**
 * Reason a manager job opened up at a club. Kept separate from
 * `ManagerContractStatus` because "NEW_CLUB" vacancies (freshly promoted or
 * newly imported teams) never had a prior contract to end.
 */
export type JobVacancyReason = "SACKED" | "RESIGNED" | "EXPIRED" | "NEW_CLUB";

export type JobVacancyStatus = "OPEN" | "FILLED" | "WITHDRAWN";

/**
 * A club/team without an active manager contract. `countryId` is carried
 * even though every vacancy today is domestic (Nepal), so filtering by
 * country is a query change, not a schema change, once foreign jobs exist.
 */
export type JobVacancy = {
  id: EntityId;
  clubId?: EntityId;
  teamId: EntityId;
  countryId?: EntityId;
  openedOn: ISODate;
  reason: JobVacancyReason;
  boardExpectation: string;
  status: JobVacancyStatus;
  filledOn?: ISODate;
  filledByContractId?: EntityId;
};

export type JobApplicationStatus =
  "PENDING" | "OFFERED" | "ACCEPTED" | "DECLINED" | "REJECTED" | "WITHDRAWN";

export type JobApplication = {
  id: EntityId;
  vacancyId: EntityId;
  managerProfileId: EntityId;
  personId: EntityId;
  status: JobApplicationStatus;
  createdOn: ISODate;
  decidedOn?: ISODate;
  offeredSalaryMinor?: number;
  offeredContractEnd?: ISODate;
};

/**
 * The board's running trust in the current manager. One row per club;
 * `contractId` lets a fresh appointment start from a neutral confidence
 * rather than inheriting the previous manager's score.
 */
export type ClubBoardConfidence = {
  clubId: EntityId;
  contractId?: EntityId;
  confidence: number;
  expectation: string;
  lastEvaluatedOn: ISODate;
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
  /** Optional: absent for vacancies imported from real-world data with no known open date. */
  openedOn?: ISODate;
  reason?: StaffVacancyReason;
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
  availability?: "AVAILABLE" | "EMPLOYED" | "RETIRED" | "UNKNOWN";
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
    | "INTERNATIONAL_PLACEMENT_COMPLETED"
    | "REFEREE_DEVELOPMENT_COMPLETED"
    | "FEDERATION_OFFICIAL_APPOINTED"
    | "FEDERATION_OFFICIAL_LEFT"
    | "REFEREE_PROMOTED"
    | "STAFF_LICENCE_UPGRADED";
  occurredOn: ISODate;
  appointmentId?: EntityId;
  clubId?: EntityId;
  teamId?: EntityId;
  federationId?: EntityId;
  academyId?: EntityId;
  description?: string;
};

export type StaffTechnicalPlacement = {
  id: EntityId;
  personId: EntityId;
  homeClubId: EntityId;
  partnerClubId: EntityId;
  partnershipId: EntityId;
  programmeType: "INTERNATIONAL_PLACEMENT";
  startDate: ISODate;
  endDate: ISODate;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  developmentApplied: boolean;
  completedOn?: ISODate;
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

export type WinnerResolution = "EXTRA_TIME_THEN_PENALTIES" | "DIRECT_PENALTIES";

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
  /**
   * True for knockout-style fixtures that cannot end level: drawn matches go to
   * extra time and, if still level, a penalty shootout. Unset/false for the
   * real Nepal league data, which is round-robin and never needs a winner.
   */
  matchesRequireWinner?: boolean;
  /** Optional configured resolution for winner-required fixtures. */
  winnerResolution?: WinnerResolution;
  /** Optional overrides for configured knockout resolution. */
  allowExtraTime?: boolean;
  allowPenalties?: boolean;
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
  /**
   * REPRIEVED is a relegation that was reconciled away: the division below could
   * not supply an eligible promotion, so the sporting demotion was not enforced.
   * It is distinct from INELIGIBLE, which means the club itself failed licensing.
   */
  status: "PLANNED" | "APPLIED" | "SUSPENDED" | "INELIGIBLE" | "REPRIEVED";
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
  /**
   * Two-leg tie context. Unused by any current fixture generator (the real
   * Nepal competitions are round-robin), but additive so a future knockout
   * generator can populate it without another shape change.
   */
  tieId?: EntityId;
  leg?: 1 | 2;
};

export type Match = {
  id: EntityId;
  fixtureId: EntityId;
  playedDate?: ISODate;
  homeGoals?: number;
  awayGoals?: number;
  /** Set only for knockout ties: the team the tie was awarded to. */
  winnerTeamId?: EntityId;
  wentToExtraTime?: boolean;
  shootoutHomeGoals?: number;
  shootoutAwayGoals?: number;
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
  | "OWN_GOAL"
  | "EXTRA_TIME_START"
  | "EXTRA_TIME_HALF_TIME"
  | "EXTRA_TIME_SECOND_HALF"
  | "PENALTY_SHOOTOUT_KICK"
  | "PENALTY_SHOOTOUT_COMPLETE";

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
  "ATTRIBUTE" | "POSITION" | "ROLE" | "PHYSICAL" | "TECHNICAL" | "MENTAL" | "BALANCED" | "MAINTENANCE";

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
  simulationNationality?: string;
  simulationNationalityStatus?: "SIMULATION_ONLY";
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
    | "PLAYER_RETURNED_TO_FULL_TRAINING"
    | "ROLE_FAMILIARITY_INCREASED"
    | "RETRAINING_MILESTONE_REACHED"
    | "DEVELOPMENT_PLATEAU_DETECTED"
    | "DEVELOPMENT_PLAN_REVIEWED"
    | "TRAINING_SETBACK_INJURY"
    | "RETURNED_FROM_INJURY_RAMP_UP";
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
export type ScoutingAssignmentStatus = "PLANNED" | "QUEUED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
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

export type TransferRequestStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";

export type PlayerTransferRequest = {
  id: EntityId;
  playerId: EntityId;
  clubId: EntityId;
  requestedAt: ISODate;
  reason: string;
  pressureScore: number;
  status: TransferRequestStatus;
  askingContext?: KnowledgeRange;
  decidedAt?: ISODate;
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
  | "MERCHANDISE"
  | "SPONSORSHIP"
  | "COMMERCIAL_PARTNERSHIP_INCOME"
  | "BROADCASTING"
  | "PRIZE_MONEY"
  | "TRANSFER_INCOME"
  | "TRANSFER_EXPENSE"
  | "SELL_ON_INCOME"
  | "SELL_ON_PAYMENT"
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
export type OwnershipAcquisitionOffer = {
  id: EntityId;
  clubId: EntityId;
  buyerPersonId: EntityId;
  sellerHolderId?: EntityId;
  percentage: number;
  offerAmount: number;
  counterAmount?: number;
  status: "ENQUIRY" | "OFFER" | "COUNTER" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
  createdOn: ISODate;
  decidedOn?: ISODate;
  rationale?: string;
  provenanceStatus: "SIMULATION_ONLY";
};
export type OwnershipAcquisitionTransaction = {
  id: EntityId;
  offerId: EntityId;
  clubId: EntityId;
  buyerPersonId: EntityId;
  sellerHolderId?: EntityId;
  date: ISODate;
  amount: number;
  percentage: number;
  status: "POSTED";
  provenanceStatus: "SIMULATION_ONLY";
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
  lenderId?: EntityId;
  nextPaymentDate?: ISODate;
  scheduledPayment?: number;
  purpose?: string;
  status: "ACTIVE" | "REPAID" | "DEFAULTED";
  provenanceStatus: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type ClubLender = {
  id: EntityId;
  name: string;
  institutionType: "COMMERCIAL_BANK" | "DEVELOPMENT_BANK" | "FINANCE_COMPANY";
  countryId?: EntityId;
  sourceUrl?: string;
  status: "VERIFIED" | "SIMULATION_ONLY";
};

export type ClubLoanApplication = {
  id: EntityId;
  clubId: EntityId;
  lenderId: EntityId;
  principal: number;
  termMonths: number;
  purpose: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdOn: ISODate;
  decidedOn?: ISODate;
  reason?: string;
  provenanceStatus: "SIMULATION_ONLY";
};

export type ManagerBudgetRequest = {
  id: EntityId;
  clubId: EntityId;
  managerPersonId: EntityId;
  seasonLabel: string;
  category: ClubBudgetCategory;
  requestedAmount: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdOn: ISODate;
  decidedOn?: ISODate;
  decisionNote?: string;
  provenanceStatus: "SIMULATION_ONLY";
};

export type SponsorOrganisation = {
  id: EntityId;
  name: string;
  industry: string;
  countryId?: EntityId;
  reputation: number;
  budgetTier: "LOCAL" | "REGIONAL" | "NATIONAL" | "PREMIUM";
  sourceUrl?: string;
  identityProvenance?: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "UNKNOWN";
  status: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type ClubCommercialProfile = {
  clubId: EntityId;
  brandStrength: number;
  digitalReach: number;
  broadcastAppeal: number;
  merchandiseAppeal: number;
  ticketPriceElasticity: number;
  updatedOn: ISODate;
  status: "SIMULATION_ONLY" | "VERIFIED" | "REPORTED" | "ESTIMATED" | "UNKNOWN";
};

export type CompetitionMediaRights = {
  id: EntityId;
  competitionSeasonId: EntityId;
  rightsPartner: string;
  annualValue: number;
  streamingShare: number;
  currency: string;
  rightsType?: "DOMESTIC_BROADCAST" | "STREAMING" | "DOMESTIC_AND_STREAMING";
  startDate?: ISODate;
  endDate?: ISODate;
  contractStatus?: "OFFERED" | "ACTIVE" | "EXPIRED" | "REJECTED";
  exclusive?: boolean;
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
  exclusivityGroup?: string;
  expectations?: Record<string, number>;
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

export type ClubSeasonMembership = {
  id: EntityId;
  clubId: EntityId;
  seasonLabel: string;
  memberCount: number;
  price: number;
  revenue: number;
  status: "ACTIVE" | "EXPIRED";
};

export type CommercialHistoryEvent = {
  id: EntityId;
  clubId: EntityId;
  date: ISODate;
  eventType: "MERCHANDISE" | "SEASON_MEMBERSHIP" | "TOUR" | "SUPPORTER_GROWTH";
  amount: number;
  audienceImpact: number;
  description: string;
};

export type PreseasonCommercialCamp = {
  id: EntityId;
  clubId: EntityId;
  destination: string;
  startDate: ISODate;
  endDate: ISODate;
  cost: number;
  commercialReach: number;
  sportingImpact: number;
  status: "PLANNED" | "COMPLETED" | "CANCELLED";
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
  | "DRAINAGE"
  | "REFURBISHMENT";

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
  siteRights?: "OWNED" | "LEASED" | "SHARED" | "PERMISSION_REQUIRED";
  fundingStatus?: "UNFUNDED" | "PARTIALLY_FUNDED" | "FUNDED";
  fundingCommitted?: number;
  delayDays?: number;
  maintenanceStatus?: "FUNDED" | "UNDERFUNDED" | "DETERIORATING";
  components?: string[];
  utilisationCapacity?: number;
  cancelledOn?: ISODate;
  sunkCost?: number;
  recoveryPlan?: string;
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
  effect?: Record<string, number>;
};

export type ProcurementCategory =
  | "KITS_TRAINING_WEAR" | "FOOTBALL_EQUIPMENT" | "GYM_PERFORMANCE"
  | "MEDICAL_SUPPLIES" | "ANALYSIS_SCOUTING" | "GROUNDS_STADIUM";

export type ProcurementSupplier = {
  id: EntityId;
  name: string;
  region: string;
  reputation: number;
  priceLevel: number;
  reliability: number;
  foreign: boolean;
  status: "SIMULATION_ONLY";
};

export type ProcurementRequest = {
  id: EntityId;
  clubId: EntityId;
  category: ProcurementCategory;
  quantity: number;
  requestedOn: ISODate;
  status: "REQUESTED" | "OFFERED" | "SELECTED" | "ORDERED" | "DELIVERED" | "FAILED" | "CANCELLED";
  budgetCategory: ClubBudgetCategory;
  statusText?: string;
};

export type ProcurementOffer = {
  id: EntityId;
  requestId: EntityId;
  supplierId: EntityId;
  unitPrice: number;
  shippingCost: number;
  quality: number;
  deliveryDays: number;
  reliability: number;
  expiresOn: ISODate;
  status: "OFFERED" | "ACCEPTED" | "REJECTED";
};

export type ProcurementOrder = {
  id: EntityId;
  requestId: EntityId;
  offerId: EntityId;
  clubId: EntityId;
  orderedOn: ISODate;
  expectedDelivery: ISODate;
  deliveredOn?: ISODate;
  quantity: number;
  totalCost: number;
  category: ProcurementCategory;
  status: "ORDERED" | "IN_TRANSIT" | "DELIVERED" | "FAILED";
  quality: number;
  provenanceStatus: "SIMULATION_ONLY";
};

export type ProcurementAgreementType = "PREFERRED_SUPPLIER" | "RECURRING_SUPPLY" | "MAINTENANCE_SERVICE";
export type ProcurementContractStatus = "OFFERED" | "ACTIVE" | "EXPIRED" | "TERMINATED";
export type ProcurementContract = {
  id: EntityId;
  clubId: EntityId;
  supplierId: EntityId;
  agreementType: ProcurementAgreementType;
  category: ProcurementCategory;
  unitPrice: number;
  discountRate: number;
  serviceLevel: number;
  warrantyMonths: number;
  startsOn: ISODate;
  endsOn: ISODate;
  renewalNoticeDays: number;
  status: ProcurementContractStatus;
};
export type ProcurementServiceRecord = {
  id: EntityId;
  contractId: EntityId;
  clubId: EntityId;
  supplierId: EntityId;
  orderId?: EntityId;
  recordedOn: ISODate;
  serviceType: "MAINTENANCE" | "WARRANTY" | "REPLACEMENT";
  status: "SCHEDULED" | "COMPLETED" | "MISSED";
  cost: number;
};
export type ProcurementApprovalThreshold = {
  clubId: EntityId;
  category: ProcurementCategory;
  maxAutoApproval: number;
  chairmanApprovalAbove: number;
  status: "SIMULATION_ONLY";
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

export type ClubAiDecision = {
  id: EntityId;
  clubId: EntityId;
  date: ISODate;
  seasonLabel: string;
  objective: ClubBoardPolicy["strategicObjective"];
  priorities: Record<string, number>;
  actions: string[];
  context: Record<string, string | number>;
  identity?: ClubStrategicIdentity;
  identityStrength?: number;
  status: "SIMULATION_ONLY";
};

export type ClubStrategicIdentity =
  | "ACADEMY_FIRST"
  | "DEVELOPMENT_SELLING"
  | "AMBITIOUS_SPENDER"
  | "FINANCIALLY_CAUTIOUS"
  | "VETERAN_FOCUSED"
  | "INFRASTRUCTURE_FIRST"
  | "COMMERCIAL_GROWTH"
  | "LOAN_DEVELOPMENT_HEAVY";

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
export type AgentNetworkScope = "NEPAL_DOMESTIC" | "SOUTH_ASIA" | "WIDER_ASIA" | "EUROPE_GLOBAL";

export type AgentProfile = {
  id: EntityId;
  personId: EntityId;
  agencyName?: string;
  reputation: number;
  negotiationSkill: number;
  negotiationStyle: AgentNegotiationStyle;
  aggressiveness: number;
  loyaltyPreference: number;
  feeExpectation: number;
  careerAmbition: number;
  networkScope: AgentNetworkScope;
  preferredMarkets: string[];
  status: "SIMULATION_ONLY";
};

export type AgentClient = {
  id: EntityId;
  agentId: EntityId;
  playerId: EntityId;
  startedAt: ISODate;
  status: "ACTIVE" | "ENDED";
};

export type AgentApproachDecision = "APPROACHED" | "SIGNED" | "DECLINED" | "SELF_REPRESENTED";

export type AgentApproachRecord = {
  id: EntityId;
  agentId: EntityId;
  playerId: EntityId;
  approachedAt: ISODate;
  trigger:
    | "CAREER_EXPOSURE"
    | "SENIOR_NEPAL_CALLUP"
    | "SENIOR_INTERNATIONAL_APPEARANCE"
    | "YOUTH_INTERNATIONAL_EXPOSURE"
    | "FOREIGN_INTEREST"
    | "FOREIGN_BASED"
    | "MARKET_ACTIVITY";
  interestScore: number;
  networkScope: AgentNetworkScope;
  decision: AgentApproachDecision;
  decidedAt?: ISODate;
};

export type TransferOfferType =
  "PERMANENT" | "LOAN" | "LOAN_WITH_OPTION" | "LOAN_WITH_OBLIGATION" | "FREE_TRANSFER";
export type TransferOfferStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "NEGOTIATING"
  | "COUNTERED"
  | "ACCEPTED"
  | "REJECTED"
  | "WITHDRAWN"
  | "EXPIRED"
  | "PLAYER_NEGOTIATING"
  | "PLAYER_ACCEPTED"
  | "PLAYER_REJECTED"
  | "PLAYER_STALLED"
  | "COMPETING_OFFER"
  | "COMPLETED";

export type TransferConditionalClauseType = "APPEARANCE" | "PERFORMANCE";

export type TransferConditionalClause = {
  type: TransferConditionalClauseType;
  threshold: number;
  amount: number;
  description: string;
};

export type TransferPlayerExchange = {
  playerId: EntityId;
  fromClubId: EntityId;
  toClubId: EntityId;
  valuation: KnowledgeRange;
  requestedBy: "BUYING_CLUB" | "SELLING_CLUB";
};

export type TransferValuationSnapshot = {
  playerId: EntityId;
  buyingClubId?: EntityId;
  sellingClubId?: EntityId;
  internalValue: KnowledgeRange;
  scoutEstimate: KnowledgeRange;
  askingRange: KnowledgeRange;
  confidence: number;
  playerDesireToMove: number;
  factors: {
    contractExpiryLeverage: number;
    agePotentialUncertainty: number;
    sportingLevel: number;
    reputationForm: number;
    leagueEconomicLevel: number;
    internationalExposure: number;
    positionalScarcity: number;
    sellerFinancePressure: number;
    playerImportance: number;
    replacementDifficulty: number;
    windowTiming: number;
    buyerWealthPerception: number;
    playerDesire: number;
  };
};

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
  buyerPerceivedValue?: KnowledgeRange;
  sellerInternalValue?: KnowledgeRange;
  playerDesireToMove?: number;
  conditionals?: TransferConditionalClause[];
  playerExchanges?: TransferPlayerExchange[];
  sellerRequestedPlayerId?: EntityId;
};

export type NegotiationRound = {
  id: EntityId;
  offerId: EntityId;
  roundNumber: number;
  actor: "BUYING_CLUB" | "SELLING_CLUB" | "PLAYER_AGENT" | "PLAYER" | "SYSTEM";
  action:
    | "ENQUIRY"
    | "AVAILABILITY_RESPONSE"
    | "OPENING_OFFER"
    | "OFFER"
    | "DEMAND"
    | "COUNTER"
    | "ACCEPT"
    | "REJECT"
    | "STALL"
    | "COMPETING_OFFER";
  salary?: number;
  squadRole?: PlayerSquadRole;
  contractLengthMonths?: number;
  agentFee?: number;
  signingFee?: number;
  message: string;
  createdAt: ISODate;
};

export type PlayerPersonalTerms = {
  salary: number;
  contractLengthMonths: number;
  squadRole: PlayerSquadRole;
  signingFee: number;
  agentFee: number;
};

export type PlayerPersonalTermsState =
  "ACCEPTED" | "REJECTED" | "STALLED" | "COMPETING_OFFER" | "COUNTERED";

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
  | "TRANSFER_REQUESTED"
  | "SELL_ON_CLAUSE_PAID";

export type SellOnEntitlement = {
  id: EntityId;
  playerId: EntityId;
  entitledClubId: EntityId;
  originatingTransferId: EntityId;
  originatingSellerClubId: EntityId;
  originatingBuyerClubId: EntityId;
  percentage: number;
  basis: "TOTAL_RESALE_FEE";
  status: "ACTIVE" | "SETTLED";
  settledTransferId?: EntityId;
  settledOn?: ISODate;
};

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

export type MedicalRehabStage = "DIAGNOSIS" | "REHABILITATION" | "RETURN_TO_TRAINING" | "RETURN_TO_PLAY" | "CLEARED";
export type MedicalAvailabilityRecommendation = "UNAVAILABLE" | "LIMITED_TRAINING" | "AVAILABLE_WITH_RISK" | "FULLY_FIT";
export type MedicalAssessment = {
  id: EntityId;
  personId: EntityId;
  injuryId?: EntityId;
  assessedOn: ISODate;
  stage: MedicalRehabStage;
  estimatedReturnStart: ISODate;
  estimatedReturnEnd: ISODate;
  confidence: number;
  recurrenceRisk: number;
  fatigue: number;
  workloadFlag: "NORMAL" | "ELEVATED" | "OVERLOADED";
  availabilityRecommendation: MedicalAvailabilityRecommendation;
  clearanceStatus: "NOT_CLEARED" | "TRAINING_CLEARANCE" | "MATCH_CLEARANCE";
  rationale: string;
  provenanceStatus: "SIMULATION_ONLY";
};

// ---------------------------------------------------------------------------
// Medical Phase B — staged rehabilitation and return-to-play decisions
// ---------------------------------------------------------------------------

/** A distinct, staged rehab track — protection through match-ready — separate from the coarser MedicalRehabStage used by the standing assessment. */
export type RehabStage = "PROTECTION_REST" | "REHABILITATION" | "PARTIAL_TRAINING" | "FULL_TRAINING" | "MATCH_READY";

export type RehabilitationPlan = {
  id: EntityId;
  injuryId: EntityId;
  personId: EntityId;
  clubId?: EntityId;
  stage: RehabStage;
  stageStartedOn: ISODate;
  startedOn: ISODate;
  targetReturnDate: ISODate;
  status: "ACTIVE" | "COMPLETED" | "ABANDONED";
  provenanceStatus: "SIMULATION_ONLY";
};

/** Follow medical advice, hold a player out longer than advised, or push them back early against advice. */
export type ReturnToPlayDecision = "FOLLOW_ADVICE" | "DELAY" | "ACCEPT_RISK";

export type RehabDecisionOutcome = "ADVANCED" | "SETBACK" | "HELD" | "NO_CHANGE";

export type RehabDecisionRecord = {
  id: EntityId;
  planId: EntityId;
  personId: EntityId;
  decidedOn: ISODate;
  decision: ReturnToPlayDecision;
  medicalRecommendation: MedicalAvailabilityRecommendation;
  outcome: RehabDecisionOutcome;
  rationale: string;
  provenanceStatus: "SIMULATION_ONLY";
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
  /** Minute the player came on, when they started on the bench. */
  subbedOnMinute?: number;
  /** Minute the player was withdrawn. */
  subbedOffMinute?: number;
  /** Minute the player was dismissed. */
  sentOffMinute?: number;
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

export type FederationAiDecision = {
  id: EntityId;
  federationId: EntityId;
  date: ISODate;
  seasonLabel: string;
  priorities: Record<string, number>;
  actions: string[];
  context: Record<string, string | number>;
  status: "SIMULATION_ONLY";
};

export type ExternalFootballRegion = "SOUTH_ASIA" | "WIDER_ASIA" | "MIDDLE_EAST" | "AUSTRALIA" | "EUROPE" | "AFRICA" | "SOUTH_AMERICA" | "NORTH_CENTRAL_AMERICA" | "OCEANIA";

export type ExternalFootballRegionProfile = {
  id: EntityId;
  region: ExternalFootballRegion;
  seasonLabel: string;
  economicStrength: number;
  footballReputation: number;
  clubStrength: number;
  transferDemand: number;
  foreignRecruitmentAppeal: number;
  nationalTeamStrength: number;
  commercialGrowth: number;
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

export type FederationElectionCycle = {
  id: EntityId;
  federationId: EntityId;
  nominationStart: ISODate;
  electionDate: ISODate;
  termYears: number;
  status: "SCHEDULED" | "NOMINATIONS" | "VOTING" | "COMPLETED";
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationElectionCandidate = {
  id: EntityId;
  cycleId: EntityId;
  federationId: EntityId;
  personId: EntityId;
  reputation: number;
  supportBase: number;
  committeeInfluence: number;
  votingBlocs: Record<string, number>;
  manifesto: Record<string, number>;
  incumbent: boolean;
  status: "ELIGIBLE" | "WITHDRAWN" | "ELECTED" | "DEFEATED";
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationElectionResult = {
  id: EntityId;
  cycleId: EntityId;
  federationId: EntityId;
  winnerCandidateId: EntityId;
  electedPersonId: EntityId;
  votes: Record<string, number>;
  decidedAt: ISODate;
  status: "COMPLETED";
  provenanceStatus: "SIMULATION_ONLY";
};

export type FederationCommitteeMembership = { id: EntityId; federationId: EntityId; committeeId: EntityId; personId: EntityId; influence: number; startsOn: ISODate; endsOn?: ISODate; status: "ACTIVE" | "FORMER"; provenanceStatus: "SIMULATION_ONLY" };
export type FederationGovernanceProposal = {
  id: EntityId; federationId: EntityId; proposedByPersonId: EntityId; title: string;
  policyArea: "COMPETITION" | "DEVELOPMENT" | "INFRASTRUCTURE" | "GRANTS" | "COMMERCIAL";
  targetCommittee: FederationCommitteeType; payload: Record<string, unknown>; proposedAt: ISODate;
  reviewedAt?: ISODate; decidedAt?: ISODate; status: "PROPOSED" | "COMMITTEE_REVIEW" | "APPROVED" | "REJECTED" | "IMPLEMENTED";
  votes: Record<string, number>; provenanceStatus: "SIMULATION_ONLY";
};
export type FederationManifestoCommitment = { id: EntityId; federationId: EntityId; presidentPersonId: EntityId; electionCycleId: EntityId; policyArea: string; promise: string; targetValue: number; progress: number; dueDate: ISODate; status: "OPEN" | "FULFILLED" | "BROKEN"; lastUpdated: ISODate; provenanceStatus: "SIMULATION_ONLY" };
export type FederationCoalitionState = { federationId: EntityId; presidentPersonId: EntityId; confidence: number; coalitionSupport: number; noConfidenceThreshold: number; lastUpdated: ISODate; status: "CONFIDENT" | "STRAINED" | "NO_CONFIDENCE"; provenanceStatus: "SIMULATION_ONLY" };
export type FederationGovernanceEvent = { id: EntityId; federationId: EntityId; date: ISODate; eventType: "PROPOSAL" | "COMMITTEE_REVIEW" | "POLICY_DECISION" | "CONFIDENCE_CHANGE" | "RESIGNATION" | "REMOVAL"; subjectId: EntityId; summary: string; payload: Record<string, unknown>; provenanceStatus: "SIMULATION_ONLY" };

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
  ownership?: "FEDERATION" | "STATE" | "SHARED";
  siteRights?: "OWNED" | "LEASED" | "PERMISSION_REQUIRED";
  components?: string[];
  utilisationJson?: Record<string, number>;
  maintenanceStatus?: "FUNDED" | "UNDERFUNDED" | "DETERIORATING";
  delayDays?: number;
  fundingStatus?: "UNFUNDED" | "PARTIALLY_FUNDED" | "FUNDED";
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

export type NationalTeamType = "SENIOR_MEN" | "SENIOR_WOMEN" | "U23" | "U20" | "U17";

export type FootballConfederation = "AFC" | "UEFA" | "CAF" | "CONCACAF" | "CONMEBOL" | "OFC";

export type FootballRegion =
  | "SAFF"
  | "ASEAN_AFF"
  | "WAFF"
  | "CAFA"
  | "EAFF"
  | "EUROPE"
  | "AFRICA"
  | "AMERICAS"
  | "OCEANIA"
  | "GLOBAL";

export type InternationalTeamProfile = {
  id: EntityId;
  countryId: EntityId;
  nationalTeamId?: EntityId;
  name: string;
  teamType: NationalTeamType;
  confederation: FootballConfederation;
  region: FootballRegion;
  simulationReputation: number;
  simulationStrength: number;
  homeAdvantageProfile: number;
  developmentLevel: number;
  formRating: number;
  lastUpdated: ISODate;
  provenanceStatus: DataProvenanceStatus;
};

export type InternationalDevelopmentProfile = {
  id: EntityId;
  countryId: EntityId;
  effectiveFrom: ISODate;
  footballDevelopment: number;
  youthPipeline: number;
  coachQuality: number;
  infrastructure: number;
  domesticProfessionalism: number;
  populationTalentBase: number;
  provenanceStatus: "SIMULATION_ONLY";
};

export type InternationalCompetitionType =
  | "FRIENDLY"
  | "QUALIFIER"
  | "CONTINENTAL_CHAMPIONSHIP"
  | "REGIONAL_CHAMPIONSHIP"
  | "WORLD_QUALIFIER"
  | "WORLD_CHAMPIONSHIP"
  | "NATIONS_LEAGUE_STYLE"
  | "INVITATIONAL";

export type InternationalCompetition = {
  id: EntityId;
  name: string;
  competitionType: InternationalCompetitionType;
  confederation?: FootballConfederation;
  region?: FootballRegion;
  cadenceYears: number;
  provenanceStatus: DataProvenanceStatus;
};

export type InternationalCompetitionEditionStatus =
  "PLANNED" | "DRAWN" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED";

export type InternationalQualificationCondition =
  | "GROUP_WINNER"
  | "GROUP_RUNNER_UP"
  | "BEST_RUNNER_UP"
  | "KNOCKOUT_WINNER"
  | "HOST"
  | "PLAYOFF_WINNER"
  | "RANKING_SLOT";

export type InternationalQualificationLink = {
  fromCompetitionEditionId: EntityId;
  fromStageId?: EntityId;
  qualificationCondition: InternationalQualificationCondition;
  toCompetitionEditionId: EntityId;
  toStageId?: EntityId;
  slots: number;
};

export type InternationalCompetitionEdition = {
  id: EntityId;
  competitionId: EntityId;
  name: string;
  cycle: string;
  startDate: ISODate;
  endDate: ISODate;
  status: InternationalCompetitionEditionStatus;
  hostCountryIds: EntityId[];
  qualificationLinks: InternationalQualificationLink[];
  ruleProvenanceStatus: DataProvenanceStatus;
  ruleNotes?: string;
};

export type InternationalFormatType =
  | "GROUP_STAGE"
  | "SINGLE_ELIMINATION"
  | "DOUBLE_LEG_KNOCKOUT"
  | "ROUND_ROBIN"
  | "MULTI_STAGE_QUALIFICATION";

export type InternationalTiebreaker =
  "POINTS" | "GOAL_DIFFERENCE" | "GOALS_SCORED" | "HEAD_TO_HEAD" | "DISCIPLINE" | "SEEDED_FALLBACK";

export type InternationalCompetitionStage = {
  id: EntityId;
  editionId: EntityId;
  name: string;
  stageOrder: number;
  formatType: InternationalFormatType;
  groupCount: number;
  groupSize: number;
  legs: number;
  teamsToAdvance: number;
  matchdaySquadSize: number;
  preliminarySquadSize: number;
  finalSquadSize: number;
  tiebreakers: InternationalTiebreaker[];
  allowExtraTime: boolean;
  allowPenalties: boolean;
  awayGoals: boolean;
  provenanceStatus: DataProvenanceStatus;
};

export type InternationalCompetitionParticipant = {
  id: EntityId;
  editionId: EntityId;
  teamProfileId: EntityId;
  entryStatus: "INVITED" | "QUALIFIED" | "HOST" | "ELIMINATED" | "ACTIVE" | "CHAMPION";
  seedRating: number;
  pot?: number;
  groupName?: string;
  finalPlacement?: number;
  qualificationSource?: string;
  provenanceStatus: DataProvenanceStatus;
};

export type InternationalDrawRecord = {
  id: EntityId;
  editionId: EntityId;
  stageId: EntityId;
  drawDate: ISODate;
  seedKey: string;
  pots: Array<{ pot: number; teamProfileIds: EntityId[] }>;
  groups: Array<{ name: string; teamProfileIds: EntityId[] }>;
  restrictions: Record<string, unknown>;
  provenanceStatus: "SIMULATION_ONLY";
};

export type InternationalMatchImportance =
  "FRIENDLY" | "REGIONAL" | "QUALIFIER" | "CONTINENTAL" | "WORLD";

export type InternationalMatch = {
  id: EntityId;
  editionId?: EntityId;
  stageId?: EntityId;
  groupName?: string;
  matchDate: ISODate;
  homeTeamProfileId: EntityId;
  awayTeamProfileId: EntityId;
  neutralVenue: boolean;
  venueId?: EntityId;
  status: "SCHEDULED" | "PLAYED" | "CANCELLED";
  homeGoals?: number;
  awayGoals?: number;
  extraTimePlayed: boolean;
  penaltiesPlayed: boolean;
  homePenaltyGoals?: number;
  awayPenaltyGoals?: number;
  winnerTeamProfileId?: EntityId;
  importance: InternationalMatchImportance;
  provenanceStatus: "SIMULATION_ONLY";
};

export type SimulationWorldRanking = {
  id: EntityId;
  teamProfileId: EntityId;
  rankingDate: ISODate;
  rank: number;
  points: number;
  confederationRank: number;
  reputation: number;
  provenanceStatus: "SIMULATION_ONLY";
};

export type NationalTeamDutyStatus =
  | "AVAILABLE"
  | "INJURED"
  | "SUSPENDED"
  | "DECLINED"
  | "NOT_RELEASED"
  | "DOCUMENTATION_PENDING"
  | "ON_DUTY"
  | "RETURNED";

export type NationalTeamDuty = {
  id: EntityId;
  nationalTeamId: EntityId;
  playerId: EntityId;
  competitionEditionId?: EntityId;
  departureDate: ISODate;
  returnDate: ISODate;
  status: NationalTeamDutyStatus;
  fitnessEffect: number;
  provenanceStatus: "SIMULATION_ONLY";
};

export type NationalTeamCohesion = {
  id: EntityId;
  nationalTeamId: EntityId;
  playerId: EntityId;
  familiarity: number;
  lastUpdated: ISODate;
  provenanceStatus: "SIMULATION_ONLY";
};

export type NationalTeamCamp = {
  id: EntityId;
  federationId: EntityId;
  nationalTeamId: EntityId;
  competitionEditionId?: EntityId;
  startDate: ISODate;
  endDate: ISODate;
  focus: "COHESION" | "FITNESS" | "TACTICAL_FAMILIARITY" | "RECOVERY";
  cost: number;
  currency: string;
  status: "PLANNED" | "COMPLETED" | "CANCELLED";
  cohesionGain: number;
  provenanceStatus: "SIMULATION_ONLY";
};

export type NationalTeamManagementDecision = {
  id: EntityId;
  federationId: EntityId;
  nationalTeamId: EntityId;
  managerPersonId?: EntityId;
  decisionDate: ISODate;
  programme: string;
  selectedPlayerIds: EntityId[];
  captainPlayerId?: EntityId;
  tacticalSetupId?: EntityId;
  tacticalStyle?: string;
  competitionEditionId?: EntityId;
  status: "ACTIVE" | "SUPERSEDED";
  provenanceStatus: "SIMULATION_ONLY";
};

export type NationalTeamCampaign = {
  id: EntityId;
  federationId: EntityId;
  nationalTeamId: EntityId;
  competitionEditionId?: EntityId;
  name: string;
  startedOn: ISODate;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  qualificationStatus: "ACTIVE" | "QUALIFIED" | "ELIMINATED" | "COMPLETED";
  objectives?: Record<string, number>;
  status: "SIMULATION_ONLY";
};

export type NationalTeamSquadRegistration = { id: EntityId; federationId: EntityId; nationalTeamId: EntityId; competitionEditionId: EntityId; registrationDeadline: ISODate; provisionalPlayerIds: EntityId[]; finalPlayerIds?: EntityId[]; status: "PROVISIONAL" | "FINAL" | "REPLACEMENT_WINDOW_CLOSED"; provenanceStatus: "SIMULATION_ONLY" };
export type NationalTeamCampLifecycle = { id: EntityId; federationId: EntityId; nationalTeamId: EntityId; competitionEditionId?: EntityId; callupDate: ISODate; arrivalDate?: ISODate; trainingStart?: ISODate; matchDate?: ISODate; releaseDate?: ISODate; status: "CALLED_UP" | "ARRIVED" | "TRAINING" | "MATCH" | "RELEASED"; playerIds: EntityId[]; fitnessEffect: number; provenanceStatus: "SIMULATION_ONLY" };
export type InternationalCommitment = { playerId: EntityId; federationId: EntityId; status: "ACTIVE" | "TEMPORARILY_RELUCTANT" | "RETIRED"; decidedOn: ISODate; reason?: string; provenanceStatus: "SIMULATION_ONLY" };
export type DiasporaRecruitment = { id: EntityId; federationId: EntityId; playerId: EntityId; status: "IDENTIFIED" | "CONTACTED" | "INTERESTED" | "ELIGIBLE_CONFIRMED" | "COMMITTED"; lastUpdated: ISODate; provenanceStatus: "SIMULATION_ONLY" };

export type NationalTeamSelectionPolicy = "FORM_FIRST" | "EXPERIENCE_FIRST" | "YOUTH_DEVELOPMENT" | "DOMESTIC_CORE" | "DIASPORA_INCLUSIVE" | "BALANCED";
export type NationalTeamWatchlistItem = { id: EntityId; federationId: EntityId; nationalTeamId: EntityId; playerId: EntityId; playerKnowledgeLevel: PlayerKnowledgeLevel; reason: string; lastReviewed: ISODate; status: "MONITORING" | "SELECTED" | "DROPPED"; provenanceStatus: "SIMULATION_ONLY" };
export type NationalTeamOperationalPlan = { id: EntityId; federationId: EntityId; nationalTeamId: EntityId; competitionEditionId?: EntityId; campStart: ISODate; campEnd: ISODate; travelPlan: string; baseVenue?: EntityId; registrationDeadline?: ISODate; recoveryDaysBetweenFixtures: number; status: "PLANNED" | "ACTIVE" | "COMPLETED"; provenanceStatus: "SIMULATION_ONLY" };
export type NationalTeamInternationalForm = { id: EntityId; nationalTeamId: EntityId; playerId: EntityId; windowDate: ISODate; appearances: number; minutes: number; goals: number; formRating: number; rationale: string; provenanceStatus: "SIMULATION_ONLY" };

export type MediaOutlet = { id: EntityId; name: string; scope: "LOCAL" | "NATIONAL" | "REGIONAL_INTERNATIONAL"; reputation: number; reach: number; bias: "NEUTRAL" | "CLUB_FOCUSED" | "NATIONAL_FOCUS" | "DEVELOPMENT_FOCUS"; style: "WIRE" | "ANALYSIS" | "TABLOID" | "TRADE"; status: "SIMULATION_ONLY" };
export type MediaStory = { id: EntityId; outletId: EntityId; eventType: "MATCH_RESULT" | "TRANSFER" | "STAFF_CHANGE" | "INJURY" | "COMPETITION" | "MILESTONE" | "NATIONAL_TEAM"; sourceEntityId: EntityId; publishedOn: ISODate; importance: number; headline: string; summary: string; subjectIds: EntityId[]; reputationEffect: number; status: "PUBLISHED" | "ARCHIVED"; provenanceStatus: "SIMULATION_ONLY" };
export type MediaJournalist = { id: EntityId; outletId: EntityId; name: string; beat: string; temperament: "FRIENDLY" | "NEUTRAL" | "SCEPTICAL"; reputation: number; status: "SIMULATION_ONLY" };
export type MediaJournalistRelationship = { id: EntityId; journalistId: EntityId; managerPersonId?: EntityId; trust: number; lastInteraction?: ISODate; status: "SIMULATION_ONLY" };
export type MediaInterview = { id: EntityId; outletId: EntityId; journalistId: EntityId; sourceEntityId: EntityId; managerPersonId?: EntityId; interviewDate: ISODate; context: "PRE_MATCH" | "POST_MATCH" | "EVENT"; importance: number; questions: string[]; responses: string[]; summary: string; managerReputationEffect: number; clubSupportEffect: number; status: "OPEN" | "COMPLETED"; provenanceStatus: "SIMULATION_ONLY" };

export type InternationalRetirementStatus = "ACTIVE" | "CONSIDERING" | "RETIRED_INTERNATIONAL";

export type InternationalRetirement = {
  id: EntityId;
  playerId: EntityId;
  nationalTeamId: EntityId;
  status: InternationalRetirementStatus;
  decidedOn: ISODate;
  reason?: string;
  provenanceStatus: "SIMULATION_ONLY";
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
  lastAutosaveWorldDate?: ISODate;
  lastAutosaveAt?: ISODateTime;
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

/** Persisted live-match session. `stateJson` is the serialised engine state. */
export type MatchSessionRecord = {
  id: EntityId;
  fixtureId: EntityId;
  matchId: EntityId;
  status: MatchSessionStatus;
  period: string;
  minute: number;
  stoppageTime: number;
  homeGoals: number;
  awayGoals: number;
  seed: string;
  rngState: number;
  stateJson: string;
  viewMode?: MatchViewMode;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type MatchSessionStatus = "IN_PROGRESS" | "COMPLETED" | "ABANDONED";

export type MatchViewMode = "QUICK_SIM" | "KEY_EVENTS" | "TEXT_LIVE";

/** One player's line from a single match. Season aggregates live elsewhere. */
export type PlayerMatchRatingRecord = {
  matchId: EntityId;
  playerId: EntityId;
  teamId: EntityId;
  position?: string;
  role?: string;
  started: boolean;
  subbedOnMinute?: number;
  subbedOffMinute?: number;
  sentOffMinute?: number;
  minutes: number;
  rating: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  keyPasses: number;
  passesAttempted: number;
  passesCompleted: number;
  tackles: number;
  interceptions: number;
  saves: number;
  yellowCards: number;
  redCard: boolean;
};

// ---------------------------------------------------------------------------
// Manager Relationships & Squad Dynamics — Phase A
// ---------------------------------------------------------------------------

export type ManagerPlayerRelationshipLevel = "POOR" | "COOL" | "NEUTRAL" | "GOOD" | "STRONG";

/** One row per (manager, player) pair. Score drifts with concern lifecycle events. */
export type ManagerPlayerRelationship = {
  id: EntityId;
  managerProfileId: EntityId;
  personId: EntityId;
  score: number;
  level: ManagerPlayerRelationshipLevel;
  updatedOn: ISODate;
};

export type ClubSatisfactionLevel = "VERY_UNHAPPY" | "UNHAPPY" | "CONTENT" | "HAPPY" | "VERY_HAPPY";

/** How content a player is at their current club, independent of the manager relationship. */
export type PlayerClubSatisfaction = {
  id: EntityId;
  personId: EntityId;
  teamId: EntityId;
  score: number;
  level: ClubSatisfactionLevel;
  updatedOn: ISODate;
};

export type SquadHierarchyRole =
  "CAPTAIN" | "VICE_CAPTAIN" | "SENIOR_PLAYER" | "SQUAD_PLAYER" | "FRINGE_PLAYER";

/** Derived leadership/influence standing within a squad; recomputed each evaluation tick. */
export type SquadHierarchyEntry = {
  id: EntityId;
  teamId: EntityId;
  personId: EntityId;
  influence: number;
  role: SquadHierarchyRole;
  updatedOn: ISODate;
};

export type PlayerConcernType = "PLAYING_TIME" | "CONTRACT" | "ROLE_STATUS" | "TRANSFER_INTEREST";
export type PlayerConcernStatus = "RAISED" | "ACTIVE" | "RESOLVED" | "ESCALATED";

/** One row per (person, team, concern type) — a concern is re-raised, not duplicated. */
export type PlayerConcern = {
  id: EntityId;
  personId: EntityId;
  teamId: EntityId;
  type: PlayerConcernType;
  status: PlayerConcernStatus;
  severity: number;
  raisedOn: ISODate;
  updatedOn: ISODate;
  resolvedOn?: ISODate;
  note?: string;
};

export type RelationshipEventType =
  | "CONCERN_RAISED"
  | "CONCERN_ESCALATED"
  | "CONCERN_RESOLVED"
  | "RELATIONSHIP_IMPROVED"
  | "RELATIONSHIP_WORSENED"
  | "SQUAD_ROLE_CHANGED"
  | "CONCERN_RESPONSE"
  | "PROMISE_MADE"
  | "PROMISE_KEPT"
  | "PROMISE_BROKEN"
  | "PROMISE_EXPIRED"
  | "DISPUTE_FLARED"
  | "SPILLOVER_APPLIED"
  | "MEETING_HELD"
  | "DISPUTE_MEDIATED"
  | "DISPUTE_UNRESOLVED";

/** Append-only log of relationship/concern state transitions, mirroring TransferHistoryEvent. */
export type RelationshipHistoryEvent = {
  id: EntityId;
  personId: EntityId;
  teamId?: EntityId;
  managerProfileId?: EntityId;
  eventType: RelationshipEventType;
  occurredOn: ISODate;
  data?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Manager Relationships & Squad Dynamics — Phase B: conversations & promises
// ---------------------------------------------------------------------------

/** What the manager can say back to an active concern. */
export type ConcernResponseAction =
  | "REASSURE"
  | "PROMISE_PLAYING_TIME"
  | "PROMISE_CONTRACT_REVIEW"
  | "PROMISE_SQUAD_ROLE"
  | "PROMISE_TRANSFER_STANCE"
  | "DISMISS";

export type ConcernResponseOutcome = "ACCEPTED" | "SKEPTICAL" | "REJECTED";

/** One row per manager response to a concern; the audit trail behind a promise. */
export type ManagerConcernResponse = {
  id: EntityId;
  concernId: EntityId;
  managerProfileId: EntityId;
  personId: EntityId;
  teamId: EntityId;
  action: ConcernResponseAction;
  outcome: ConcernResponseOutcome;
  promiseId?: EntityId;
  occurredOn: ISODate;
};

export type ManagerPromiseType =
  | "PLAYING_TIME"
  | "CONTRACT_REVIEW"
  | "SQUAD_ROLE"
  | "TRANSFER_STANCE";
export type ManagerPromiseStatus = "ACTIVE" | "KEPT" | "BROKEN" | "EXPIRED";

/**
 * A concrete commitment made in response to a concern. `baselineMetric` snapshots
 * whatever real number the promise will be judged against at `dueOn` (appearance
 * count, squad-role rank, etc) so resolution reads real state, not a guess.
 */
export type ManagerPromise = {
  id: EntityId;
  managerProfileId: EntityId;
  personId: EntityId;
  teamId: EntityId;
  concernId?: EntityId;
  type: ManagerPromiseType;
  description: string;
  madeOn: ISODate;
  dueOn: ISODate;
  status: ManagerPromiseStatus;
  baselineMetric?: number;
  resolvedOn?: ISODate;
};

// ---------------------------------------------------------------------------
// Manager Relationships & Squad Dynamics — Phase C: dressing-room structure
// ---------------------------------------------------------------------------

/** Derived directly from squad-hierarchy role — no separate social graph. */
export type SquadGroupType = "CORE_LEADERS" | "MAIN_GROUP" | "PERIPHERAL";

export type SquadGroupMembership = {
  id: EntityId;
  teamId: EntityId;
  personId: EntityId;
  groupType: SquadGroupType;
  updatedOn: ISODate;
};

export type TeamCohesionLevel = "UNITED" | "STABLE" | "SHAKY" | "POOR" | "CRITICAL";
export type CaptainInfluence = "STABILIZING" | "NEUTRAL" | "DESTABILIZING";

/** One row per team: the dressing-room's overall state, recomputed each tick. */
export type TeamCohesion = {
  teamId: EntityId;
  score: number;
  level: TeamCohesionLevel;
  captainInfluence: CaptainInfluence;
  topIssue?: string;
  updatedOn: ISODate;
};

// ---------------------------------------------------------------------------
// Manager Relationships & Squad Dynamics — Phase D: meetings and mediation
// ---------------------------------------------------------------------------

export type SquadDisputeKind = "PLAYER_VS_PLAYER" | "PLAYER_VS_MANAGER";
export type SquadDisputeStatus = "OPEN" | "MEDIATED" | "UNRESOLVED";

/** A dispute is a persisted, actionable record — not just a log line. */
export type SquadDispute = {
  id: EntityId;
  teamId: EntityId;
  kind: SquadDisputeKind;
  personId: EntityId;
  withPersonId?: EntityId;
  concernType: PlayerConcernType;
  status: SquadDisputeStatus;
  raisedOn: ISODate;
  resolvedOn?: ISODate;
};

export type SquadMeetingType =
  | "ONE_TO_ONE"
  | "MEDIATE_DISPUTE"
  | "ADDRESS_MANAGER_DISPUTE"
  | "CAPTAIN_CONSULTATION"
  | "SQUAD_MEETING";

export type SquadMeetingOutcome = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

/** Persisted record of every meeting the manager holds, with its real outcome. */
export type SquadMeeting = {
  id: EntityId;
  teamId: EntityId;
  managerProfileId: EntityId;
  type: SquadMeetingType;
  personId?: EntityId;
  withPersonId?: EntityId;
  concernId?: EntityId;
  disputeId?: EntityId;
  outcome: SquadMeetingOutcome;
  summary: string;
  occurredOn: ISODate;
};

// ---------------------------------------------------------------------------
// Staff Market & Development — Phase A
// ---------------------------------------------------------------------------

/** Why a staff vacancy opened — mirrors JobVacancyReason for consistency. */
export type StaffVacancyReason = "DISMISSED" | "RESIGNED" | "EXPIRED" | "NEW_ROLE";

export type StaffApplicationStatus =
  "PENDING" | "OFFERED" | "COUNTERED" | "ACCEPTED" | "DECLINED" | "REJECTED" | "WITHDRAWN";

/** An approach from a candidate (or the club) for one open staff vacancy. */
export type StaffApplication = {
  id: EntityId;
  vacancyId: EntityId;
  personId: EntityId;
  status: StaffApplicationStatus;
  createdOn: ISODate;
  decidedOn?: ISODate;
  offeredSalaryMinor?: number;
  offeredContractEnd?: ISODate;
  /** Set when the candidate wants more than the club proposed — the manager then accepts or declines it. */
  counterSalaryMinor?: number;
};

export type StaffEmploymentContractStatus = "ACTIVE" | "EXPIRED" | "TERMINATED" | "RESIGNED" | "RETIRED";

/**
 * The employment contract behind a `StaffAppointment` (referenced by its
 * `contractId`). Appointments track *what role someone holds*; contracts
 * track *the deal that puts them there* — kept separate so a contract can
 * expire/renew without inventing a new appointment record each time.
 *
 * Named distinctly from the generic `StaffContract` (`Contract & { contractKind:
 * "STAFF" }`) above, which is unused scaffolding with a different, looser shape.
 */
export type StaffEmploymentContract = {
  id: EntityId;
  personId: EntityId;
  appointmentId: EntityId;
  clubId?: EntityId;
  teamId?: EntityId;
  role: FootballStaffRole;
  contractStart: ISODate;
  contractEnd?: ISODate;
  salaryAmountMinor: number;
  currency: string;
  status: StaffEmploymentContractStatus;
};

// ---------------------------------------------------------------------------
// Staff Market — Phase B: negotiation, performance, licences, poaching
// ---------------------------------------------------------------------------

export type StaffRenewalOfferStatus =
  "OFFERED" | "COUNTERED" | "ACCEPTED" | "DECLINED" | "REJECTED";

/**
 * A club-initiated renewal proposal against an *existing* appointment — kept
 * separate from `StaffApplication` (which is always against an open
 * vacancy) since a renewal never has a `vacancyId` to hang off.
 */
export type StaffRenewalOffer = {
  id: EntityId;
  appointmentId: EntityId;
  personId: EntityId;
  clubId: EntityId;
  proposedSalaryMinor: number;
  proposedContractEnd: ISODate;
  counterSalaryMinor?: number;
  status: StaffRenewalOfferStatus;
  createdOn: ISODate;
  decidedOn?: ISODate;
};

/** One evaluation window's role-appropriate performance read, never a raw ability score. */
export type StaffPerformanceRecord = {
  id: EntityId;
  personId: EntityId;
  appointmentId: EntityId;
  clubId: EntityId;
  periodEnd: ISODate;
  score: number;
  note?: string;
};

export type StaffLicenceCourseStatus = "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

/** A licence upgrade in progress, optionally club-funded. */
export type StaffLicenceCourse = {
  id: EntityId;
  personId: EntityId;
  fundedByClubId?: EntityId;
  targetLicenceType: string;
  startedOn: ISODate;
  completesOn: ISODate;
  status: StaffLicenceCourseStatus;
};

export type StaffApproachStatus = "PENDING" | "ACCEPTED" | "DECLINED";

/** A rival club's approach toward someone else's staff member. Resolves on its own — the
 * player's real lever against losing their own staff is proactively renewing their contract. */
export type StaffApproach = {
  id: EntityId;
  personId: EntityId;
  fromClubId: EntityId;
  currentClubId?: EntityId;
  role: FootballStaffRole;
  offeredSalaryMinor: number;
  status: StaffApproachStatus;
  createdOn: ISODate;
  decidedOn?: ISODate;
};

// ---------------------------------------------------------------------------
// Staff Market — Phase C: hierarchy, delegation, workload, planning
// ---------------------------------------------------------------------------

export type StaffResponsibilityDomain =
  "TRANSFERS" | "SCOUTING" | "CONTRACTS" | "YOUTH" | "TRAINING" | "MEDICAL";

export type StaffResponsibilityOwnerType = "MANAGER" | "STAFF" | "BOARD";

/**
 * Who currently owns one responsibility domain at a club — exactly one row
 * per (clubId, domain), which is what makes "two staff can't own the same
 * responsibility" true by construction rather than by convention.
 */
export type StaffResponsibility = {
  id: EntityId;
  clubId: EntityId;
  domain: StaffResponsibilityDomain;
  ownerType: StaffResponsibilityOwnerType;
  ownerAppointmentId?: EntityId;
  /** Set only when ownerType is BOARD and the board has signed off for a window. */
  boardApprovalGrantedUntil?: ISODate;
  updatedOn: ISODate;
};

/** Audit trail: which real actor (manager, staff member, or board) actually executed an action. */
export type StaffResponsibilityLogEntry = {
  id: EntityId;
  clubId: EntityId;
  domain: StaffResponsibilityDomain;
  ownerType: StaffResponsibilityOwnerType;
  ownerAppointmentId?: EntityId;
  action: string;
  occurredOn: ISODate;
  description?: string;
};

export type StaffWorkloadLevel = "LIGHT" | "NORMAL" | "HEAVY" | "OVERLOADED";

export type StaffDevelopmentPlanStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

/**
 * A club's stated intent to develop one staff member — when it targets a
 * licence, it drives the existing Phase B licence-course pipeline rather
 * than tracking progress a second time.
 */
export type StaffDevelopmentPlan = {
  id: EntityId;
  personId: EntityId;
  clubId: EntityId;
  focus: string;
  targetLicenceType?: string;
  licenceCourseId?: EntityId;
  createdOn: ISODate;
  targetDate: ISODate;
  status: StaffDevelopmentPlanStatus;
};

export type StaffSuccessionReason = "CONTRACT_EXPIRING" | "POACHING_RISK";
export type StaffSuccessionPlanStatus = "ACTIVE" | "RESOLVED" | "CANCELLED";

/** Raised automatically when a key appointment looks likely to end soon. */
export type StaffSuccessionPlan = {
  id: EntityId;
  clubId: EntityId;
  outgoingAppointmentId: EntityId;
  outgoingPersonId: EntityId;
  role: FootballStaffRole;
  candidatePersonId?: EntityId;
  reason: StaffSuccessionReason;
  createdOn: ISODate;
  status: StaffSuccessionPlanStatus;
};

export type InvestorExpectationType = "FINANCIAL_RETURN" | "SPORTING_GROWTH" | "INFRASTRUCTURE_GROWTH" | "REPUTATION_GROWTH";
export type InvestorExpectation = { type: InvestorExpectationType; target: number; progress: number; status: "ON_TRACK" | "AT_RISK" | "MET" | "MISSED" };
export type OwnershipInvestorProfile = {
  id: EntityId; clubId: EntityId; personId: EntityId; influence: number;
  expectations: Record<InvestorExpectationType, InvestorExpectation>; trust: number; confidence: number;
  lastReviewedOn: ISODate; status: "ACTIVE" | "EXITED"; provenanceStatus: "SIMULATION_ONLY";
};

export type ClubLicenceCaseStatus = "PENDING" | "PASSED" | "CONDITIONAL" | "FAILED" | "APPEALED" | "RESOLVED";
export type ClubLicenceRemediation = { key: string; requirement: string; deadline: ISODate; completed: boolean };
export type ClubLicenceHistoryEvent = { date: ISODate; action: "OPENED" | "ASSESSED" | "CONDITIONAL" | "PASSED" | "FAILED" | "APPEALED" | "RESOLVED" | "CLOSED"; note: string };
export type ClubLicenceCase = {
  id: EntityId; federationId: EntityId; clubId: EntityId; competitionSeasonId: EntityId; seasonLabel: string;
  status: ClubLicenceCaseStatus; remediation: ClubLicenceRemediation[]; sanctions: string[]; history: ClubLicenceHistoryEvent[]; reviewedAt: ISODate;
  provenanceStatus: "SIMULATION_ONLY";
};

export type CareerReputationDimensions = { sporting: number; businessOwnership: number; governance: number; nationalInternational: number };
export type CareerMilestoneType = "APPOINTMENT" | "RESIGNATION" | "SACKING" | "PROMOTION" | "TROPHY" | "OWNERSHIP" | "INFRASTRUCTURE" | "FEDERATION_TERM" | "NATIONAL_TEAM";
export type CareerMilestone = { id: EntityId; date: ISODate; type: CareerMilestoneType; role: "MANAGER" | "CHAIRMAN_OWNER" | "FEDERATION_PRESIDENT"; title: string; sourceEntityId?: EntityId; impact: Partial<CareerReputationDimensions> };
export type CareerIdentity = { personId: EntityId; reputation: CareerReputationDimensions; milestones: CareerMilestone[]; activeRoles: string[]; retired: boolean; legacy: { clubsServed: number; trophies: number; ownershipEvents: number; federationTerms: number; majorRecords: string[]; careerWealth: number }; lastUpdatedAt: ISODate; provenanceStatus: "SIMULATION_ONLY" };
export type CareerOpportunity = { id: EntityId; role: "MANAGER" | "CHAIRMAN_OWNER" | "FEDERATION_PRESIDENT"; sourceEntityId?: EntityId; eligible: boolean; rationale: string };
