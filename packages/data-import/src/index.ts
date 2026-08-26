import { z } from "zod";
export * from "./player-coverage-report.js";
export * from "./personnel-coverage-report.js";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const targetDatabaseDateSchema = z.string().regex(/^\d{4}-\d{2}$/);

export const provenanceStatusSchema = z.enum([
  "VERIFIED",
  "REPORTED",
  "ESTIMATED",
  "UNKNOWN",
  "SIMULATION_ONLY",
]);

export const provenanceSchema = z.object({
  sourceId: z.string().min(1).optional(),
  sourceUrl: z.string().url().optional(),
  sourceName: z.string().min(1),
  publishedAt: z.string().datetime().optional(),
  lastVerifiedDate: isoDateSchema.optional(),
  retrievedAt: z.string().datetime().optional(),
  confidence: z.number().min(0).max(1),
  confidenceLevel: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  status: provenanceStatusSchema,
  notes: z.string().min(1).optional(),
});

const factSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z
    .object({
      value: valueSchema.optional(),
      status: provenanceStatusSchema,
      provenance: provenanceSchema.optional(),
    })
    .superRefine((fact, context) => {
      if (fact.status === "UNKNOWN" && fact.value !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "UNKNOWN facts must not carry a value",
          path: ["value"],
        });
      }
      if (
        fact.status !== "UNKNOWN" &&
        fact.status !== "SIMULATION_ONLY" &&
        fact.value === undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fact.status} facts must carry a value`,
          path: ["value"],
        });
      }
    });

const keySchema = z.string().min(1);
const nullableKeyFactSchema = factSchema(keySchema);
const nullableDateFactSchema = factSchema(isoDateSchema);
const nullableStringFactSchema = factSchema(z.string().min(1));
const nullableNumberFactSchema = factSchema(z.number().int().nonnegative());
const nullableDecimalFactSchema = factSchema(z.number());
const nullableBooleanFactSchema = factSchema(z.boolean());
const footballStaffRoleSchema = z.string().min(1);
const staffOrganisationTypeSchema = z.enum([
  "CLUB",
  "TEAM",
  "FEDERATION",
  "ACADEMY",
  "PARENT_ORGANISATION",
  "NATIONAL_TEAM",
  "UNKNOWN",
]);
const staffEmploymentStatusSchema = z.enum([
  "ACTIVE",
  "FORMER",
  "INTERIM",
  "CONTRACT_EXPIRED",
  "UNKNOWN",
]);
const trainingIntensitySchema = z.enum(["LOW", "NORMAL", "HIGH", "VERY_HIGH"]);
const trainingSessionCategorySchema = z
  .enum([
    "RECOVERY",
    "FITNESS",
    "ENDURANCE",
    "STRENGTH",
    "SPEED",
    "AGILITY",
    "TECHNICAL_GENERAL",
    "PASSING",
    "FIRST_TOUCH",
    "DRIBBLING",
    "FINISHING",
    "CROSSING",
    "DEFENDING",
    "TACKLING",
    "HEADING",
    "TACTICAL_GENERAL",
    "ATTACKING_SHAPE",
    "DEFENSIVE_SHAPE",
    "PRESSING",
    "TRANSITION",
    "POSSESSION",
    "COUNTER_ATTACK",
    "SET_PIECES_ATTACK",
    "SET_PIECES_DEFENCE",
    "GOALKEEPING",
    "GK_SHOT_STOPPING",
    "GK_DISTRIBUTION",
    "MATCH_PREPARATION",
    "TEAM_BONDING",
    "VIDEO_ANALYSIS",
    "REST",
  ])
  .or(z.string().min(1));
const trainingGroupSchema = z.enum([
  "FULL_SQUAD",
  "GOALKEEPERS",
  "DEFENDERS",
  "MIDFIELDERS",
  "ATTACKERS",
  "YOUTH",
  "RESERVES",
  "CUSTOM",
]);
const developmentPhaseSchema = z.enum([
  "YOUTH_DEVELOPMENT",
  "EARLY_CAREER",
  "PRIME",
  "LATE_PRIME",
  "DECLINE",
]);
const playerPositionSchema = z.enum(["GK", "RB", "CB", "LB", "DM", "CM", "AM", "RW", "LW", "ST"]);

export const importRecordSchema = z.object({
  entityType: z.string().min(1),
  externalId: z.string().optional(),
  payload: z.record(z.unknown()),
  provenance: provenanceSchema,
});

const countryRecordSchema = z.object({
  key: keySchema,
  name: z.string().min(1),
  isoCode: z.string().min(2).max(3),
  provenance: provenanceSchema,
});

const locationRecordSchema = z.object({
  key: keySchema,
  canonicalExternalId: z.string().min(1).optional(),
  countryKey: keySchema,
  name: z.string().min(1),
  kind: z.enum([
    "city",
    "municipality",
    "neighbourhood",
    "district",
    "province",
    "stadium",
    "airport",
    "unknown",
  ]),
  parentLocationKey: nullableKeyFactSchema.optional(),
  latitude: nullableDecimalFactSchema.optional(),
  longitude: nullableDecimalFactSchema.optional(),
  altitudeMeters: nullableNumberFactSchema.optional(),
  climateProfile: z
    .object({
      climateZone: nullableStringFactSchema.optional(),
      seasonalHeatRisk: factSchema(z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"])),
      monsoonRisk: factSchema(z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"])),
      coldRisk: factSchema(z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"])),
      humidityRisk: factSchema(z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"])),
    })
    .optional(),
  provenance: provenanceSchema,
});

const venueRecordSchema = z.object({
  key: keySchema,
  canonicalExternalId: z.string().min(1).optional(),
  countryKey: keySchema,
  name: z.string().min(1),
  officialName: nullableStringFactSchema.optional(),
  shortName: nullableStringFactSchema.optional(),
  aliases: z.array(z.string().min(1)).default([]),
  venueType: factSchema(
    z.enum([
      "STADIUM",
      "FOOTBALL_GROUND",
      "TRAINING_GROUND",
      "ACADEMY_GROUND",
      "MULTI_SPORT_STADIUM",
      "NATIONAL_TRAINING_CENTRE",
      "UNKNOWN",
    ]),
  ).optional(),
  locationKey: nullableKeyFactSchema,
  provinceKey: nullableKeyFactSchema.optional(),
  districtKey: nullableKeyFactSchema.optional(),
  cityKey: nullableKeyFactSchema.optional(),
  latitude: nullableDecimalFactSchema.optional(),
  longitude: nullableDecimalFactSchema.optional(),
  altitudeMeters: nullableNumberFactSchema.optional(),
  capacity: nullableNumberFactSchema,
  surfaceType: factSchema(
    z.enum(["NATURAL_GRASS", "ARTIFICIAL_TURF", "HYBRID", "DIRT", "UNKNOWN"]),
  ).optional(),
  pitchType: nullableStringFactSchema.optional(),
  pitchQuality: factSchema(
    z.enum(["EXCELLENT", "GOOD", "FAIR", "POOR", "VERY_POOR", "UNKNOWN"]),
  ).optional(),
  yearOpened: nullableNumberFactSchema.optional(),
  yearLastRenovated: nullableNumberFactSchema.optional(),
  floodlights: nullableBooleanFactSchema.optional(),
  runningTrack: nullableBooleanFactSchema.optional(),
  coveredStands: nullableBooleanFactSchema.optional(),
  ownerEntity: nullableStringFactSchema.optional(),
  operatorEntity: nullableStringFactSchema.optional(),
  status: factSchema(
    z.enum(["ACTIVE", "LIMITED_USE", "UNDER_RENOVATION", "CLOSED", "UNKNOWN"]),
  ).optional(),
  provenance: provenanceSchema,
});

const federationRecordSchema = z.object({
  key: keySchema,
  countryKey: keySchema,
  name: z.string().min(1),
  foundedYear: nullableNumberFactSchema,
  provenance: provenanceSchema,
});

/**
 * FIFA/AFC starting-state hook (requirement 8). Only ever populated by
 * verified research — never a hardcoded gameplay assumption. Absent entirely
 * from a dataset, the federation gets a default NORMAL profile tagged
 * provenanceStatus "UNKNOWN" rather than any factual claim.
 */
const federationComplianceSanctionSeedSchema = z.object({
  authority: z.enum(["FIFA", "AFC", "DOMESTIC"]),
  reason: z.string().min(1),
  category: z.string().min(1),
  startDate: isoDateSchema,
  requirementsForResolution: z.array(z.string().min(1)).default([]),
  affectedProgrammes: z.array(z.string().min(1)).default([]),
  consequences: z.array(
    z.enum([
      "FUNDING_FROZEN",
      "NEW_GRANTS_BLOCKED",
      "NATIONAL_TEAM_PARTICIPATION_BLOCKED",
      "CLUB_CONTINENTAL_PARTICIPATION_BLOCKED",
      "DEVELOPMENT_PROGRAMMES_UNAVAILABLE",
      "REPUTATION_DAMAGE",
    ]),
  ),
  provenanceStatus: provenanceStatusSchema,
});

const federationComplianceSnapshotRecordSchema = z.object({
  federationKey: keySchema,
  status: z.enum([
    "NORMAL",
    "WARNING",
    "FORMAL_REVIEW",
    "FUNDING_RESTRICTED",
    "COMPETITION_RESTRICTED",
    "SUSPENDED",
    "REINSTATEMENT_REVIEW",
  ]),
  dimensions: z
    .object({
      autonomy: z.number().min(0).max(100),
      statutoryCompliance: z.number().min(0).max(100),
      electionLegitimacy: z.number().min(0).max(100),
      financialControls: z.number().min(0).max(100),
      auditQuality: z.number().min(0).max(100),
      transparencyReporting: z.number().min(0).max(100),
      safeguarding: z.number().min(0).max(100),
      projectDelivery: z.number().min(0).max(100),
    })
    .partial()
    .optional(),
  effectiveDate: isoDateSchema,
  provenanceStatus: provenanceStatusSchema,
  sanctions: z.array(federationComplianceSanctionSeedSchema).default([]),
});

const competitionRecordSchema = z.object({
  key: keySchema,
  federationKey: nullableKeyFactSchema,
  name: z.string().min(1),
  scope: z.enum(["domestic", "continental", "international", "local"]),
  category: z
    .enum([
      "PYRAMID_LEAGUE",
      "FRANCHISE_LEAGUE",
      "QUALIFICATION_LEAGUE",
      "CUP",
      "SPECIAL_NATIONAL_LEAGUE",
      "WOMENS_LEAGUE",
      "YOUTH_COMPETITION",
    ])
    .optional(),
  provenance: provenanceSchema,
});

const competitionSeasonRecordSchema = z.object({
  key: keySchema,
  competitionKey: keySchema,
  name: z.string().min(1),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  provenance: provenanceSchema,
});

const competitionRuleRecordSchema = z.object({
  key: keySchema,
  competitionSeasonKey: keySchema,
  competitionType: z.enum([
    "LEAGUE",
    "CUP",
    "GROUP_AND_KNOCKOUT",
    "ROUND_ROBIN",
    "DOUBLE_ROUND_ROBIN",
    "CUSTOM_FUTURE",
  ]),
  pointsForWin: z.number().int().min(0),
  pointsForDraw: z.number().int().min(0),
  pointsForLoss: z.number().int().min(0),
  tiebreakers: z.array(
    z.enum([
      "points",
      "goalDifference",
      "goalsScored",
      "headToHeadPoints",
      "headToHeadGoalDifference",
      "headToHeadGoals",
      "wins",
      "fairPlay",
      "playoff",
    ]),
  ),
  numberOfRounds: z.number().int().min(1),
  homeAwayStructure: z.enum(["single", "double", "neutral", "custom"]),
  fixtureCount: nullableNumberFactSchema.optional(),
  seasonStartDate: isoDateSchema,
  seasonEndDate: isoDateSchema,
  roundSpacingDays: z.number().int().min(1),
  promotionSlots: z.number().int().min(0),
  relegationSlots: z.number().int().min(0),
  continentalQualificationSlots: z.number().int().min(0),
  promotionEnabled: z.boolean().optional(),
  relegationEnabled: z.boolean().optional(),
  specialRules: z
    .object({
      relegationSuspended: z.boolean().optional(),
      promotionSuspended: z.boolean().optional(),
      temporaryExpandedLeague: z.boolean().optional(),
      specialQualificationPath: z.boolean().optional(),
      competitionPostponed: z.boolean().optional(),
      competitionSuspended: z.boolean().optional(),
    })
    .optional(),
  provenance: provenanceSchema,
});

const competitionRelationshipRecordSchema = z.object({
  key: keySchema,
  fromCompetitionKey: keySchema,
  toCompetitionKey: keySchema,
  movementType: z.enum(["PROMOTION", "RELEGATION", "QUALIFICATION"]),
  numberOfTeams: z.number().int().min(0),
  selectionMethod: z.enum([
    "TOP_TABLE",
    "BOTTOM_TABLE",
    "QUALIFIER_RESULT",
    "FEDERATION_DECISION",
    "MANUAL",
  ]),
  effectiveSeasonKey: nullableKeyFactSchema.optional(),
  provenance: provenanceSchema,
});

const clubRecordSchema = z.object({
  key: keySchema,
  canonicalExternalId: z.string().min(1).optional(),
  countryKey: keySchema,
  name: z.string().min(1),
  officialName: nullableStringFactSchema.optional(),
  shortName: nullableStringFactSchema.optional(),
  nepaliName: nullableStringFactSchema.optional(),
  locationKey: nullableKeyFactSchema,
  ownershipType: factSchema(
    z.enum([
      "PRIVATE",
      "CORPORATE",
      "COMMUNITY",
      "MEMBER_OWNED",
      "DEPARTMENTAL",
      "MUNICIPALITY_BACKED",
      "INSTITUTIONAL",
      "UNKNOWN",
    ]),
  ),
  organisationType: factSchema(
    z.enum(["CLUB", "FRANCHISE", "DEPARTMENTAL", "ACADEMY", "UNKNOWN"]),
  ).optional(),
  parentOrganisation: nullableStringFactSchema.optional(),
  foundedYear: nullableNumberFactSchema,
  provenance: provenanceSchema,
});

const clubAliasRecordSchema = z.object({
  key: keySchema,
  clubKey: keySchema,
  alias: z.string().min(1),
  aliasType: z.enum(["SHORT_NAME", "FORMER_NAME", "SPONSOR_NAME", "COMMON_NAME", "SEARCH_ALIAS"]),
  provenance: provenanceSchema,
});

const teamRecordSchema = z
  .object({
    key: keySchema,
    canonicalExternalId: z.string().min(1).optional(),
    name: z.string().min(1),
    clubKey: nullableKeyFactSchema.optional(),
    federationKey: nullableKeyFactSchema.optional(),
    level: z.enum(["senior", "u23", "u20", "u17", "reserve", "academy"]),
    gender: z.enum(["men", "women", "mixed", "unknown"]),
    provenance: provenanceSchema,
  })
  .superRefine((team, context) => {
    if (!team.clubKey?.value && !team.federationKey?.value) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Team must link to a club or federation when imported",
      });
    }
  });

const clubRelationshipRecordSchema = z
  .object({
    key: keySchema,
    parentClubKey: keySchema,
    childClubKey: nullableKeyFactSchema.optional(),
    childTeamKey: nullableKeyFactSchema.optional(),
    relationshipType: z.enum([
      "MEN_FIRST_TEAM",
      "WOMENS_BRANCH",
      "YOUTH_BRANCH",
      "ACADEMY",
      "INSTITUTIONAL_PARENT",
      "LINKED_ENTITY",
    ]),
    provenance: provenanceSchema,
  })
  .superRefine((relationship, context) => {
    if (!relationship.childClubKey?.value && !relationship.childTeamKey?.value) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Club relationship must link to a child club or child team",
      });
    }
  });

const clubMembershipRecordSchema = z.object({
  key: keySchema,
  clubKey: keySchema,
  teamKey: nullableKeyFactSchema.optional(),
  competitionKey: keySchema,
  competitionSeasonKey: nullableKeyFactSchema.optional(),
  membershipType: z.enum(["FRANCHISE", "LEAGUE_MEMBER", "CUP_PARTICIPANT", "WOMENS_COMPETITION"]),
  status: z.enum([
    "ACTIVE",
    "INACTIVE",
    "REPORTED",
    "UNKNOWN",
    "QUALIFIED",
    "PROMOTED",
    "RELEGATED",
    "WITHDRAWN",
    "SUSPENDED",
    "INELIGIBLE",
  ]),
  provenance: provenanceSchema,
});

const academyRecordSchema = z.object({
  key: keySchema,
  canonicalExternalId: z.string().min(1).optional(),
  name: z.string().min(1),
  countryKey: keySchema,
  locationKey: nullableKeyFactSchema,
  parentClubKey: nullableKeyFactSchema.optional(),
  linkedClubKey: nullableKeyFactSchema.optional(),
  federationKey: nullableKeyFactSchema.optional(),
  academyType: z.enum([
    "NATIONAL_ACADEMY",
    "REGIONAL_ACADEMY",
    "CLUB_ACADEMY",
    "PRIVATE_ACADEMY",
    "ACADEMY_CLUB_HYBRID",
  ]),
  provenance: provenanceSchema,
});

const venueRelationshipRecordSchema = z
  .object({
    key: keySchema,
    venueKey: keySchema,
    clubKey: nullableKeyFactSchema.optional(),
    teamKey: nullableKeyFactSchema.optional(),
    federationKey: nullableKeyFactSchema.optional(),
    academyKey: nullableKeyFactSchema.optional(),
    relationshipType: z.enum([
      "OWNER",
      "OPERATOR",
      "PRIMARY_TENANT",
      "TENANT",
      "TEMPORARY_USER",
      "SHARED_USER",
      "TRAINING_USER",
      "ACADEMY_USER",
      "NATIONAL_TEAM_USER",
      "UNKNOWN",
    ]),
    startDate: nullableDateFactSchema.optional(),
    endDate: nullableDateFactSchema.optional(),
    competitionSeasonKey: nullableKeyFactSchema.optional(),
    status: z
      .enum([
        "available",
        "unavailable",
        "underRenovation",
        "sharedConflict",
        "federationAssigned",
        "unknown",
      ])
      .default("unknown"),
    provenance: provenanceSchema,
  })
  .superRefine((relationship, context) => {
    if (
      !relationship.clubKey?.value &&
      !relationship.teamKey?.value &&
      !relationship.federationKey?.value &&
      !relationship.academyKey?.value
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Venue relationship must link to a club, team, federation, or academy",
      });
    }
  });

const locationTravelContextRecordSchema = z.object({
  key: keySchema,
  fromLocationKey: keySchema,
  toLocationKey: keySchema,
  roadDistanceKm: nullableDecimalFactSchema.optional(),
  estimatedRoadTravelHours: nullableDecimalFactSchema.optional(),
  airTravelAvailable: nullableBooleanFactSchema.optional(),
  nearestAirportKey: nullableKeyFactSchema.optional(),
  provenance: provenanceSchema,
});

const staffProfileRecordSchema = z.object({
  key: keySchema,
  personKey: keySchema,
  preferredRole: nullableStringFactSchema.optional(),
  salaryExpectation: nullableStringFactSchema.optional(),
  reputation: nullableStringFactSchema.optional(),
  countryKnowledgeKeys: z.array(keySchema).default([]),
  clubKnowledgeKeys: z.array(keySchema).default([]),
  availability: factSchema(z.enum(["AVAILABLE", "EMPLOYED", "UNKNOWN"])).optional(),
  workEligibilityStatus: factSchema(z.enum(["ELIGIBLE", "REQUIRES_PERMIT", "UNKNOWN"])).optional(),
  provenance: provenanceSchema,
});

const staffAppointmentRecordSchema = z
  .object({
    key: keySchema,
    personKey: keySchema,
    organisationType: staffOrganisationTypeSchema,
    clubKey: nullableKeyFactSchema.optional(),
    teamKey: nullableKeyFactSchema.optional(),
    federationKey: nullableKeyFactSchema.optional(),
    academyKey: nullableKeyFactSchema.optional(),
    organisationName: nullableStringFactSchema.optional(),
    role: footballStaffRoleSchema,
    startDate: nullableDateFactSchema.optional(),
    endDate: nullableDateFactSchema.optional(),
    employmentStatus: staffEmploymentStatusSchema,
    contractId: nullableStringFactSchema.optional(),
    serviceRankTitle: nullableStringFactSchema.optional(),
    provenance: provenanceSchema,
  })
  .superRefine((appointment, context) => {
    if (
      !appointment.clubKey?.value &&
      !appointment.teamKey?.value &&
      !appointment.federationKey?.value &&
      !appointment.academyKey?.value &&
      !appointment.organisationName?.value
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Staff appointment must target an organisation",
      });
    }
  });

const staffVacancyRecordSchema = z
  .object({
    key: keySchema,
    organisationType: staffOrganisationTypeSchema,
    clubKey: nullableKeyFactSchema.optional(),
    teamKey: nullableKeyFactSchema.optional(),
    federationKey: nullableKeyFactSchema.optional(),
    academyKey: nullableKeyFactSchema.optional(),
    organisationName: nullableStringFactSchema.optional(),
    role: footballStaffRoleSchema,
    required: z.boolean(),
    assignedPersonKey: nullableKeyFactSchema.optional(),
    status: z.enum(["FILLED", "VACANT", "UNKNOWN"]),
    provenance: provenanceSchema,
  })
  .superRefine((vacancy, context) => {
    if (
      !vacancy.clubKey?.value &&
      !vacancy.teamKey?.value &&
      !vacancy.federationKey?.value &&
      !vacancy.academyKey?.value &&
      !vacancy.organisationName?.value
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Staff vacancy must target an organisation",
      });
    }
  });

const staffLicenceRecordSchema = z.object({
  key: keySchema,
  personKey: keySchema,
  licenceType: z.string().min(1),
  issuer: z.string().min(1),
  issueDate: nullableDateFactSchema.optional(),
  expiryDate: nullableDateFactSchema.optional(),
  status: z.enum(["VERIFIED", "REPORTED", "UNKNOWN"]),
  provenance: provenanceSchema,
});

const refereeProfileRecordSchema = z.object({
  key: keySchema,
  personKey: keySchema,
  refereeLevel: nullableStringFactSchema.optional(),
  fifaListed: nullableBooleanFactSchema.optional(),
  fifaListedSince: nullableDateFactSchema.optional(),
  primaryRole: footballStaffRoleSchema,
  competitionsEligibleKeys: z.array(keySchema).default([]),
  experienceLevel: nullableStringFactSchema.optional(),
  provenance: provenanceSchema,
});

const staffHistoryEventRecordSchema = z.object({
  key: keySchema,
  personKey: keySchema,
  eventType: z.enum([
    "MANAGER_APPOINTED",
    "MANAGER_SACKED",
    "MANAGER_RESIGNED",
    "STAFF_JOINED",
    "STAFF_LEFT",
    "FEDERATION_OFFICIAL_APPOINTED",
    "FEDERATION_OFFICIAL_LEFT",
    "REFEREE_PROMOTED",
  ]),
  occurredOn: isoDateSchema,
  staffAppointmentKey: nullableKeyFactSchema.optional(),
  clubKey: nullableKeyFactSchema.optional(),
  teamKey: nullableKeyFactSchema.optional(),
  federationKey: nullableKeyFactSchema.optional(),
  academyKey: nullableKeyFactSchema.optional(),
  description: nullableStringFactSchema.optional(),
  provenance: provenanceSchema,
});

const trainingSessionRecordSchema = z.object({
  day: z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]),
  slot: z.number().int().min(1),
  category: trainingSessionCategorySchema,
  intensity: trainingIntensitySchema,
  targetGroup: trainingGroupSchema,
  coachAssignmentKey: nullableKeyFactSchema.optional(),
});

const trainingPlanRecordSchema = z.object({
  key: keySchema,
  teamKey: keySchema,
  name: z.string().min(1),
  effectiveFrom: isoDateSchema,
  effectiveTo: isoDateSchema.optional(),
  intensity: trainingIntensitySchema,
  sessions: z.array(trainingSessionRecordSchema),
  source: z.enum(["USER", "AI", "DEFAULT"]),
  provenance: provenanceSchema,
});

const individualDevelopmentPlanRecordSchema = z.object({
  key: keySchema,
  playerKey: keySchema,
  focusType: z.enum([
    "ATTRIBUTE",
    "POSITION",
    "ROLE",
    "PHYSICAL",
    "TECHNICAL",
    "MENTAL",
    "BALANCED",
  ]),
  targetPosition: playerPositionSchema.optional(),
  targetRole: z.string().min(1).optional(),
  targetAttributeGroup: z.enum(["technical", "mental", "physical", "goalkeeping"]).optional(),
  intensity: trainingIntensitySchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  status: z.enum(["ACTIVE", "PAUSED", "COMPLETED"]),
  provenance: provenanceSchema,
});

const playerDevelopmentStateRecordSchema = z.object({
  key: keySchema,
  playerKey: keySchema,
  developmentPhase: developmentPhaseSchema,
  trainingLoad: z.number().min(0).max(100),
  fatigue: z.number().min(0).max(100),
  matchSharpness: z.number().min(0).max(100),
  fitness: z.number().min(0).max(100),
  recovery: z.number().min(0).max(100),
  developmentMomentum: z.number().min(-100).max(100),
  positionFamiliarity: z.record(z.number().min(0).max(100)).default({}),
  roleFamiliarity: z.record(z.number().min(0).max(100)).default({}),
  lastTrainingDate: isoDateSchema.optional(),
  lastDevelopmentUpdate: isoDateSchema.optional(),
  provenance: provenanceSchema,
});

const playerPotentialRecordSchema = z.object({
  key: keySchema,
  playerKey: keySchema,
  potentialCeiling: z.number().min(1).max(20),
  developmentRate: z.number().min(0).max(2),
  volatility: z.number().min(0).max(2),
  professionalism: z.number().min(0).max(2),
  status: z.literal("SIMULATION_ONLY"),
  provenance: provenanceSchema.refine((provenance) => provenance.status === "SIMULATION_ONLY", {
    message: "Potential must be marked SIMULATION_ONLY",
  }),
});

const playerFactualProfileRecordSchema = z.object({
  key: keySchema,
  playerKey: keySchema,
  canonicalExternalId: z.string().min(1),
  currentClubKey: nullableKeyFactSchema.optional(),
  nameVariants: z.array(z.string().min(1)).default([]),
  nepaliName: nullableStringFactSchema.optional(),
  factualPrimaryPosition: playerPositionSchema.optional(),
  factualSecondaryPositions: z.array(playerPositionSchema).default([]),
  factualPositionGroup: z
    .enum(["GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD", "UNKNOWN"])
    .optional(),
  positionPrecision: z.enum(["EXACT", "GENERAL", "UNKNOWN"]),
  sourcePosition: nullableStringFactSchema.optional(),
  squadStatus: z.enum(["STARTER", "REGULAR", "SQUAD", "RESERVE", "YOUTH", "UNKNOWN"]).optional(),
  shirtNumber: nullableNumberFactSchema.optional(),
  goalkeeperFlag: nullableBooleanFactSchema.optional(),
  latestKnownAppearanceDate: nullableDateFactSchema.optional(),
  dateOfBirth: nullableDateFactSchema.optional(),
  heightCm: nullableNumberFactSchema.optional(),
  preferredFoot: factSchema(z.enum(["RIGHT", "LEFT", "BOTH", "UNKNOWN"])).optional(),
  nationality: nullableStringFactSchema.optional(),
  placeOfBirth: nullableStringFactSchema.optional(),
  previousClubs: z.array(z.string().min(1)).default([]),
  factualContractStatus: z.enum(["UNKNOWN", "REPORTED", "VERIFIED"]),
  recordStatus: z.enum(["VERIFIED", "REPORTED", "UNKNOWN"]),
  confidenceLevel: z.enum(["HIGH", "MEDIUM", "LOW"]),
  lastVerified: isoDateSchema.optional(),
  simulationPrimaryPosition: playerPositionSchema,
  simulationPrimaryPositionStatus: z.literal("SIMULATION_ONLY"),
  simulationAgeProfile: z.enum([
    "YOUNG",
    "EARLY_CAREER",
    "PRIME",
    "EXPERIENCED",
    "VETERAN",
    "UNKNOWN",
  ]),
  simulationDateOfBirth: isoDateSchema.optional(),
  simulationDateOfBirthStatus: z.literal("SIMULATION_ONLY").optional(),
  simulationHeightCm: z.number().int().min(120).max(230).optional(),
  simulationHeightStatus: z.literal("SIMULATION_ONLY").optional(),
  simulationPreferredFoot: z.enum(["RIGHT", "LEFT", "BOTH"]).optional(),
  simulationPreferredFootStatus: z.literal("SIMULATION_ONLY").optional(),
  currentAbility: z.number().min(1).max(20),
  potentialAbility: z.number().min(1).max(20),
  reputation: z.number().min(0).max(100),
  hiddenTraits: z.object({
    professionalism: z.number().min(1).max(20),
    consistency: z.number().min(1).max(20),
    ambition: z.number().min(1).max(20),
    adaptability: z.number().min(1).max(20),
    pressureHandling: z.number().min(1).max(20),
    injuryProneness: z.number().min(1).max(20),
    developmentRate: z.number().min(0).max(2),
    status: z.literal("SIMULATION_ONLY"),
  }),
  evidence: z.array(
    z.object({
      summary: z.string().min(1).optional(),
      date: isoDateSchema.optional(),
      sourceUrls: z.array(z.string().min(1)).default([]),
      whatItConfirms: z.string().min(1).optional(),
      status: z.enum(["VERIFIED", "REPORTED", "UNKNOWN"]),
      confidenceLevel: z.enum(["HIGH", "MEDIUM", "LOW"]),
    }),
  ),
  provenance: provenanceSchema,
});

const playerPlayingTimeSnapshotRecordSchema = z.object({
  key: keySchema,
  playerKey: keySchema,
  competitionSeasonKey: nullableKeyFactSchema.optional(),
  minutesLast30Days: z.number().int().min(0),
  minutesSeason: z.number().int().min(0),
  startsSeason: z.number().int().min(0),
  subAppearances: z.number().int().min(0),
  updatedOn: isoDateSchema,
  provenance: provenanceSchema,
});

const competitionDevelopmentMultiplierRecordSchema = z.object({
  key: keySchema,
  competitionKey: keySchema,
  multiplier: z.number().min(0),
  status: z.enum(["SIMULATION_ONLY", "UNKNOWN"]),
  provenance: provenanceSchema,
});

const staffSimulationProfileRecordSchema = z.object({
  key: keySchema,
  personKey: keySchema,
  coachingTechnical: z.number().min(0).max(20),
  coachingTactical: z.number().min(0).max(20),
  coachingPhysical: z.number().min(0).max(20),
  coachingMental: z.number().min(0).max(20),
  goalkeeping: z.number().min(0).max(20),
  youthDevelopment: z.number().min(0).max(20),
  manManagement: z.number().min(0).max(20),
  status: z.literal("SIMULATION_ONLY"),
  provenance: provenanceSchema.refine((provenance) => provenance.status === "SIMULATION_ONLY", {
    message: "Staff simulation profiles must be marked SIMULATION_ONLY",
  }),
});

const trainingFacilityProfileRecordSchema = z
  .object({
    key: keySchema,
    clubKey: nullableKeyFactSchema.optional(),
    academyKey: nullableKeyFactSchema.optional(),
    trainingFacilityQuality: nullableDecimalFactSchema.optional(),
    youthFacilityQuality: nullableDecimalFactSchema.optional(),
    medicalFacilityQuality: nullableDecimalFactSchema.optional(),
    status: z.enum(["SIMULATION_ONLY", "UNKNOWN"]),
    provenance: provenanceSchema,
  })
  .superRefine((profile, context) => {
    if (!profile.clubKey?.value && !profile.academyKey?.value) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Training facility profile must link to a club or academy",
      });
    }
  });

const trainingHistoryEventRecordSchema = z.object({
  key: keySchema,
  playerKey: nullableKeyFactSchema.optional(),
  teamKey: nullableKeyFactSchema.optional(),
  eventType: z.enum([
    "TRAINING_PLAN_CHANGED",
    "INDIVIDUAL_FOCUS_STARTED",
    "POSITION_TRAINING_STARTED",
    "POSITION_FAMILIARITY_INCREASED",
    "ATTRIBUTE_IMPROVED",
    "ATTRIBUTE_DECLINED",
    "PLAYER_OVERTRAINED",
    "PLAYER_RETURNED_TO_FULL_TRAINING",
  ]),
  occurredOn: isoDateSchema,
  data: z.record(z.unknown()).optional(),
  provenance: provenanceSchema,
});

const personRecordSchema = z.object({
  key: keySchema,
  fullName: z.string().min(1),
  displayName: nullableStringFactSchema.optional(),
  dateOfBirth: nullableDateFactSchema,
  nationalityCountryKey: keySchema,
  secondNationalityCountryKey: nullableKeyFactSchema.optional(),
  genderPresentation: nullableStringFactSchema,
  placeOfBirthLocationKey: nullableKeyFactSchema,
  hometownLocationKey: nullableKeyFactSchema,
  languages: factSchema(z.array(z.string().min(1))),
  provenance: provenanceSchema,
});

const personRoleRecordSchema = z.object({
  key: keySchema,
  personKey: keySchema,
  role: z.enum(["PLAYER", "MANAGER", "STAFF", "AGENT", "CHAIRMAN", "FEDERATION_OFFICIAL"]),
  activeFrom: nullableDateFactSchema,
  activeTo: nullableDateFactSchema.optional(),
  provenance: provenanceSchema,
});

const teamPersonAssignmentRecordSchema = z.object({
  key: keySchema,
  personKey: keySchema,
  teamKey: keySchema,
  role: z.enum(["PLAYER", "MANAGER", "STAFF"]),
  startedOn: nullableDateFactSchema,
  endedOn: nullableDateFactSchema.optional(),
  provenance: provenanceSchema,
});

const ratingSchema = z.number().int().min(1).max(20);

const playerAttributeRecordSchema = z.object({
  key: keySchema,
  personKey: keySchema,
  primaryPosition: playerPositionSchema,
  secondaryPositions: z.array(playerPositionSchema),
  technical: z.object({
    firstTouch: ratingSchema,
    passing: ratingSchema,
    crossing: ratingSchema,
    dribbling: ratingSchema,
    finishing: ratingSchema,
    heading: ratingSchema,
    tackling: ratingSchema,
    technique: ratingSchema,
    longShots: ratingSchema,
    setPieces: ratingSchema,
  }),
  mental: z.object({
    decisions: ratingSchema,
    vision: ratingSchema,
    composure: ratingSchema,
    positioning: ratingSchema,
    anticipation: ratingSchema,
    workRate: ratingSchema,
    teamwork: ratingSchema,
    leadership: ratingSchema,
    aggression: ratingSchema,
    determination: ratingSchema,
    professionalism: ratingSchema,
  }),
  physical: z.object({
    pace: ratingSchema,
    acceleration: ratingSchema,
    strength: ratingSchema,
    stamina: ratingSchema,
    agility: ratingSchema,
    balance: ratingSchema,
    jumping: ratingSchema,
    naturalFitness: ratingSchema,
  }),
  goalkeeping: z.object({
    handling: ratingSchema,
    reflexes: ratingSchema,
    oneOnOnes: ratingSchema,
    aerialReach: ratingSchema,
    kicking: ratingSchema,
    distribution: ratingSchema,
    commandOfArea: ratingSchema,
  }),
  provenance: provenanceSchema.refine((provenance) => provenance.status === "SIMULATION_ONLY", {
    message: "Imported player ratings are game assessments and must be SIMULATION_ONLY",
  }),
});

const playerImportSummarySchema = z.object({
  sourceRows: z.number().int().nonnegative(),
  uniquePlayersImported: z.number().int().nonnegative(),
  recordsExcluded: z.number().int().nonnegative().default(0),
  duplicateRecommendationRows: z.number().int().nonnegative().default(0),
  duplicateMergesApplied: z.number().int().nonnegative(),
  duplicateUnresolvedCases: z.number().int().nonnegative(),
  clubMappingFailures: z.array(z.string()).default([]),
  generatedAt: isoDateSchema,
});

const playerSourceRegisterRecordSchema = z.object({
  sourceId: z.string().min(1),
  clubName: z.string().min(1),
  publisher: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  sourceDate: z.string().min(1),
  sourceType: z.string().min(1),
  reliability: z.enum(["HIGH", "MEDIUM", "LOW"]),
  playersExtracted: z.number().int().nonnegative(),
});

export const nepalWorldDatasetSchema = z.object({
  meta: z.object({
    datasetId: z.string().min(1),
    targetDatabaseDate: targetDatabaseDateSchema,
    description: z.string().min(1),
    provenance: provenanceSchema,
  }),
  countries: z.array(countryRecordSchema),
  locations: z.array(locationRecordSchema),
  venues: z.array(venueRecordSchema),
  federations: z.array(federationRecordSchema),
  federationComplianceSnapshots: z.array(federationComplianceSnapshotRecordSchema).default([]),
  competitions: z.array(competitionRecordSchema),
  competitionSeasons: z.array(competitionSeasonRecordSchema),
  competitionRules: z.array(competitionRuleRecordSchema).default([]),
  competitionRelationships: z.array(competitionRelationshipRecordSchema).default([]),
  clubs: z.array(clubRecordSchema),
  clubAliases: z.array(clubAliasRecordSchema).default([]),
  teams: z.array(teamRecordSchema),
  clubRelationships: z.array(clubRelationshipRecordSchema).default([]),
  clubMemberships: z.array(clubMembershipRecordSchema).default([]),
  academies: z.array(academyRecordSchema).default([]),
  venueRelationships: z.array(venueRelationshipRecordSchema).default([]),
  locationTravelContexts: z.array(locationTravelContextRecordSchema).default([]),
  staffProfiles: z.array(staffProfileRecordSchema).default([]),
  staffAppointments: z.array(staffAppointmentRecordSchema).default([]),
  staffVacancies: z.array(staffVacancyRecordSchema).default([]),
  staffLicences: z.array(staffLicenceRecordSchema).default([]),
  refereeProfiles: z.array(refereeProfileRecordSchema).default([]),
  staffHistoryEvents: z.array(staffHistoryEventRecordSchema).default([]),
  persons: z.array(personRecordSchema),
  personRoles: z.array(personRoleRecordSchema),
  teamPersonAssignments: z.array(teamPersonAssignmentRecordSchema),
  playerAttributes: z.array(playerAttributeRecordSchema).default([]),
  playerFactualProfiles: z.array(playerFactualProfileRecordSchema).default([]),
  playerImportSummary: playerImportSummarySchema.optional(),
  playerSourceRegister: z.array(playerSourceRegisterRecordSchema).default([]),
  trainingPlans: z.array(trainingPlanRecordSchema).default([]),
  individualDevelopmentPlans: z.array(individualDevelopmentPlanRecordSchema).default([]),
  playerDevelopmentStates: z.array(playerDevelopmentStateRecordSchema).default([]),
  playerPotentials: z.array(playerPotentialRecordSchema).default([]),
  playerPlayingTimeSnapshots: z.array(playerPlayingTimeSnapshotRecordSchema).default([]),
  competitionDevelopmentMultipliers: z
    .array(competitionDevelopmentMultiplierRecordSchema)
    .default([]),
  staffSimulationProfiles: z.array(staffSimulationProfileRecordSchema).default([]),
  trainingFacilityProfiles: z.array(trainingFacilityProfileRecordSchema).default([]),
  trainingHistoryEvents: z.array(trainingHistoryEventRecordSchema).default([]),
});

export type ImportRecordInput = z.infer<typeof importRecordSchema>;
export type NepalWorldDataset = z.infer<typeof nepalWorldDatasetSchema>;
export type ProvenanceStatus = z.infer<typeof provenanceStatusSchema>;

export const validateImportRecord = (input: unknown): ImportRecordInput =>
  importRecordSchema.parse(input);

export const validateNepalWorldDataset = (input: unknown): NepalWorldDataset =>
  nepalWorldDatasetSchema.parse(input);

export type DatasetReferenceIssue = {
  path: string;
  message: string;
};

export const validateNepalWorldReferences = (
  dataset: NepalWorldDataset,
): DatasetReferenceIssue[] => {
  const issues: DatasetReferenceIssue[] = [];
  const countries = keySet(dataset.countries);
  const locations = keySet(dataset.locations);
  const locationKinds = new Map(dataset.locations.map((location) => [location.key, location.kind]));
  const venues = keySet(dataset.venues);
  const federations = keySet(dataset.federations);
  const competitions = keySet(dataset.competitions);
  const competitionSeasons = keySet(dataset.competitionSeasons);
  const clubs = keySet(dataset.clubs);
  const teams = keySet(dataset.teams);
  const academies = keySet(dataset.academies);
  const persons = keySet(dataset.persons);

  requireUniqueKeys(issues, "countries", dataset.countries);
  requireUniqueKeys(issues, "locations", dataset.locations);
  requireUniqueKeys(issues, "venues", dataset.venues);
  requireUniqueKeys(issues, "federations", dataset.federations);
  requireUniqueKeys(issues, "competitions", dataset.competitions);
  requireUniqueKeys(issues, "competitionSeasons", dataset.competitionSeasons);
  requireUniqueKeys(issues, "competitionRelationships", dataset.competitionRelationships);
  requireUniqueKeys(issues, "staffProfiles", dataset.staffProfiles);
  requireUniqueKeys(issues, "staffAppointments", dataset.staffAppointments);
  requireUniqueKeys(issues, "staffVacancies", dataset.staffVacancies);
  requireUniqueKeys(issues, "staffLicences", dataset.staffLicences);
  requireUniqueKeys(issues, "refereeProfiles", dataset.refereeProfiles);
  requireUniqueKeys(issues, "staffHistoryEvents", dataset.staffHistoryEvents);
  requireUniqueKeys(issues, "trainingPlans", dataset.trainingPlans);
  requireUniqueKeys(issues, "individualDevelopmentPlans", dataset.individualDevelopmentPlans);
  requireUniqueKeys(issues, "playerDevelopmentStates", dataset.playerDevelopmentStates);
  requireUniqueKeys(issues, "playerPotentials", dataset.playerPotentials);
  requireUniqueKeys(issues, "playerFactualProfiles", dataset.playerFactualProfiles);
  requireUniqueKeys(issues, "playerPlayingTimeSnapshots", dataset.playerPlayingTimeSnapshots);
  requireUniqueKeys(
    issues,
    "competitionDevelopmentMultipliers",
    dataset.competitionDevelopmentMultipliers,
  );
  requireUniqueKeys(issues, "staffSimulationProfiles", dataset.staffSimulationProfiles);
  requireUniqueKeys(issues, "trainingFacilityProfiles", dataset.trainingFacilityProfiles);
  requireUniqueKeys(issues, "trainingHistoryEvents", dataset.trainingHistoryEvents);
  requireUniqueKeys(issues, "clubs", dataset.clubs);
  requireUniqueKeys(issues, "teams", dataset.teams);
  requireUniqueCanonicalExternalIds(issues, dataset.clubs);
  requireUniqueCanonicalExternalIds(issues, dataset.teams);
  requireUniqueCanonicalExternalIds(issues, dataset.venues);
  requireAliasIntegrity(issues, dataset.clubAliases, clubs);

  for (const [index, location] of dataset.locations.entries()) {
    requireRef(issues, `locations.${index}.countryKey`, location.countryKey, countries);
    requireOptionalFactRef(
      issues,
      `locations.${index}.parentLocationKey`,
      location.parentLocationKey,
      locations,
    );
    requireValidCoordinates(issues, `locations.${index}`, location.latitude, location.longitude);
    requireValidAltitude(issues, `locations.${index}.altitudeMeters`, location.altitudeMeters);
    if (location.parentLocationKey?.value === location.key) {
      issues.push({
        path: `locations.${index}.parentLocationKey`,
        message: "Location cannot be its own parent",
      });
    }
    if (location.kind === "province" && location.parentLocationKey?.value) {
      issues.push({
        path: `locations.${index}.parentLocationKey`,
        message: "Province locations must not have a parent location",
      });
    }
    if (location.kind === "district") {
      requireOptionalLocationKind(
        issues,
        `locations.${index}.parentLocationKey`,
        location.parentLocationKey,
        locationKinds,
        ["province"],
      );
    }
    if (location.kind === "city" || location.kind === "municipality") {
      requireOptionalLocationKind(
        issues,
        `locations.${index}.parentLocationKey`,
        location.parentLocationKey,
        locationKinds,
        ["district"],
      );
    }
    if (location.kind === "neighbourhood" || location.kind === "airport") {
      requireOptionalLocationKind(
        issues,
        `locations.${index}.parentLocationKey`,
        location.parentLocationKey,
        locationKinds,
        ["city", "municipality"],
      );
    }
  }
  for (const [index, venue] of dataset.venues.entries()) {
    requireRef(issues, `venues.${index}.countryKey`, venue.countryKey, countries);
    requireOptionalFactRef(issues, `venues.${index}.locationKey`, venue.locationKey, locations);
    requireOptionalFactRef(issues, `venues.${index}.provinceKey`, venue.provinceKey, locations);
    requireOptionalFactRef(issues, `venues.${index}.districtKey`, venue.districtKey, locations);
    requireOptionalFactRef(issues, `venues.${index}.cityKey`, venue.cityKey, locations);
    requireOptionalLocationKind(
      issues,
      `venues.${index}.provinceKey`,
      venue.provinceKey,
      locationKinds,
      ["province"],
    );
    requireOptionalLocationKind(
      issues,
      `venues.${index}.districtKey`,
      venue.districtKey,
      locationKinds,
      ["district"],
    );
    requireOptionalLocationKind(issues, `venues.${index}.cityKey`, venue.cityKey, locationKinds, [
      "city",
      "municipality",
    ]);
    requireValidCoordinates(issues, `venues.${index}`, venue.latitude, venue.longitude);
    requireValidAltitude(issues, `venues.${index}.altitudeMeters`, venue.altitudeMeters);
  }
  for (const [index, federation] of dataset.federations.entries()) {
    requireRef(issues, `federations.${index}.countryKey`, federation.countryKey, countries);
  }
  for (const [index, competition] of dataset.competitions.entries()) {
    requireOptionalFactRef(
      issues,
      `competitions.${index}.federationKey`,
      competition.federationKey,
      federations,
    );
  }
  for (const [index, season] of dataset.competitionSeasons.entries()) {
    requireRef(
      issues,
      `competitionSeasons.${index}.competitionKey`,
      season.competitionKey,
      competitions,
    );
  }
  for (const [index, rules] of dataset.competitionRules.entries()) {
    requireRef(
      issues,
      `competitionRules.${index}.competitionSeasonKey`,
      rules.competitionSeasonKey,
      competitionSeasons,
    );
  }
  for (const [index, relationship] of dataset.competitionRelationships.entries()) {
    requireRef(
      issues,
      `competitionRelationships.${index}.fromCompetitionKey`,
      relationship.fromCompetitionKey,
      competitions,
    );
    requireRef(
      issues,
      `competitionRelationships.${index}.toCompetitionKey`,
      relationship.toCompetitionKey,
      competitions,
    );
    requireOptionalFactRef(
      issues,
      `competitionRelationships.${index}.effectiveSeasonKey`,
      relationship.effectiveSeasonKey,
      competitionSeasons,
    );
  }
  for (const [index, club] of dataset.clubs.entries()) {
    requireRef(issues, `clubs.${index}.countryKey`, club.countryKey, countries);
    requireOptionalFactRef(issues, `clubs.${index}.locationKey`, club.locationKey, locations);
  }
  for (const [index, alias] of dataset.clubAliases.entries()) {
    requireRef(issues, `clubAliases.${index}.clubKey`, alias.clubKey, clubs);
  }
  for (const [index, team] of dataset.teams.entries()) {
    requireOptionalFactRef(issues, `teams.${index}.clubKey`, team.clubKey, clubs);
    requireOptionalFactRef(issues, `teams.${index}.federationKey`, team.federationKey, federations);
  }
  for (const [index, relationship] of dataset.clubRelationships.entries()) {
    requireRef(
      issues,
      `clubRelationships.${index}.parentClubKey`,
      relationship.parentClubKey,
      clubs,
    );
    requireOptionalFactRef(
      issues,
      `clubRelationships.${index}.childClubKey`,
      relationship.childClubKey,
      clubs,
    );
    requireOptionalFactRef(
      issues,
      `clubRelationships.${index}.childTeamKey`,
      relationship.childTeamKey,
      teams,
    );
  }
  for (const [index, membership] of dataset.clubMemberships.entries()) {
    requireRef(issues, `clubMemberships.${index}.clubKey`, membership.clubKey, clubs);
    requireOptionalFactRef(issues, `clubMemberships.${index}.teamKey`, membership.teamKey, teams);
    requireRef(
      issues,
      `clubMemberships.${index}.competitionKey`,
      membership.competitionKey,
      competitions,
    );
    requireOptionalFactRef(
      issues,
      `clubMemberships.${index}.competitionSeasonKey`,
      membership.competitionSeasonKey,
      competitionSeasons,
    );
  }
  for (const [index, academy] of dataset.academies.entries()) {
    requireRef(issues, `academies.${index}.countryKey`, academy.countryKey, countries);
    requireOptionalFactRef(
      issues,
      `academies.${index}.locationKey`,
      academy.locationKey,
      locations,
    );
    requireOptionalFactRef(
      issues,
      `academies.${index}.parentClubKey`,
      academy.parentClubKey,
      clubs,
    );
    requireOptionalFactRef(
      issues,
      `academies.${index}.linkedClubKey`,
      academy.linkedClubKey,
      clubs,
    );
    requireOptionalFactRef(
      issues,
      `academies.${index}.federationKey`,
      academy.federationKey,
      federations,
    );
  }
  for (const [index, venueRelationship] of dataset.venueRelationships.entries()) {
    requireRef(issues, `venueRelationships.${index}.venueKey`, venueRelationship.venueKey, venues);
    requireOptionalFactRef(
      issues,
      `venueRelationships.${index}.clubKey`,
      venueRelationship.clubKey,
      clubs,
    );
    requireOptionalFactRef(
      issues,
      `venueRelationships.${index}.teamKey`,
      venueRelationship.teamKey,
      teams,
    );
    requireOptionalFactRef(
      issues,
      `venueRelationships.${index}.federationKey`,
      venueRelationship.federationKey,
      federations,
    );
    requireOptionalFactRef(
      issues,
      `venueRelationships.${index}.academyKey`,
      venueRelationship.academyKey,
      academies,
    );
    requireOptionalFactRef(
      issues,
      `venueRelationships.${index}.competitionSeasonKey`,
      venueRelationship.competitionSeasonKey,
      competitionSeasons,
    );
  }
  for (const [index, travel] of dataset.locationTravelContexts.entries()) {
    requireRef(
      issues,
      `locationTravelContexts.${index}.fromLocationKey`,
      travel.fromLocationKey,
      locations,
    );
    requireRef(
      issues,
      `locationTravelContexts.${index}.toLocationKey`,
      travel.toLocationKey,
      locations,
    );
    requireOptionalFactRef(
      issues,
      `locationTravelContexts.${index}.nearestAirportKey`,
      travel.nearestAirportKey,
      locations,
    );
  }
  for (const [index, profile] of dataset.staffProfiles.entries()) {
    requireRef(issues, `staffProfiles.${index}.personKey`, profile.personKey, persons);
    for (const [countryIndex, countryKey] of profile.countryKnowledgeKeys.entries()) {
      requireRef(
        issues,
        `staffProfiles.${index}.countryKnowledgeKeys.${countryIndex}`,
        countryKey,
        countries,
      );
    }
    for (const [clubIndex, clubKey] of profile.clubKnowledgeKeys.entries()) {
      requireRef(issues, `staffProfiles.${index}.clubKnowledgeKeys.${clubIndex}`, clubKey, clubs);
    }
  }
  for (const [index, appointment] of dataset.staffAppointments.entries()) {
    requireRef(issues, `staffAppointments.${index}.personKey`, appointment.personKey, persons);
    requireOptionalFactRef(
      issues,
      `staffAppointments.${index}.clubKey`,
      appointment.clubKey,
      clubs,
    );
    requireOptionalFactRef(
      issues,
      `staffAppointments.${index}.teamKey`,
      appointment.teamKey,
      teams,
    );
    requireOptionalFactRef(
      issues,
      `staffAppointments.${index}.federationKey`,
      appointment.federationKey,
      federations,
    );
    requireOptionalFactRef(
      issues,
      `staffAppointments.${index}.academyKey`,
      appointment.academyKey,
      academies,
    );
  }
  for (const [index, vacancy] of dataset.staffVacancies.entries()) {
    requireOptionalFactRef(issues, `staffVacancies.${index}.clubKey`, vacancy.clubKey, clubs);
    requireOptionalFactRef(issues, `staffVacancies.${index}.teamKey`, vacancy.teamKey, teams);
    requireOptionalFactRef(
      issues,
      `staffVacancies.${index}.federationKey`,
      vacancy.federationKey,
      federations,
    );
    requireOptionalFactRef(
      issues,
      `staffVacancies.${index}.academyKey`,
      vacancy.academyKey,
      academies,
    );
    requireOptionalFactRef(
      issues,
      `staffVacancies.${index}.assignedPersonKey`,
      vacancy.assignedPersonKey,
      persons,
    );
  }
  for (const [index, licence] of dataset.staffLicences.entries()) {
    requireRef(issues, `staffLicences.${index}.personKey`, licence.personKey, persons);
  }
  for (const [index, referee] of dataset.refereeProfiles.entries()) {
    requireRef(issues, `refereeProfiles.${index}.personKey`, referee.personKey, persons);
    for (const [competitionIndex, competitionKey] of referee.competitionsEligibleKeys.entries()) {
      requireRef(
        issues,
        `refereeProfiles.${index}.competitionsEligibleKeys.${competitionIndex}`,
        competitionKey,
        competitions,
      );
    }
  }
  const staffAppointments = keySet(dataset.staffAppointments);
  for (const [index, event] of dataset.staffHistoryEvents.entries()) {
    requireRef(issues, `staffHistoryEvents.${index}.personKey`, event.personKey, persons);
    requireOptionalFactRef(
      issues,
      `staffHistoryEvents.${index}.staffAppointmentKey`,
      event.staffAppointmentKey,
      staffAppointments,
    );
    requireOptionalFactRef(issues, `staffHistoryEvents.${index}.clubKey`, event.clubKey, clubs);
    requireOptionalFactRef(issues, `staffHistoryEvents.${index}.teamKey`, event.teamKey, teams);
    requireOptionalFactRef(
      issues,
      `staffHistoryEvents.${index}.federationKey`,
      event.federationKey,
      federations,
    );
    requireOptionalFactRef(
      issues,
      `staffHistoryEvents.${index}.academyKey`,
      event.academyKey,
      academies,
    );
  }
  for (const [index, person] of dataset.persons.entries()) {
    requireRef(
      issues,
      `persons.${index}.nationalityCountryKey`,
      person.nationalityCountryKey,
      countries,
    );
    requireOptionalFactRef(
      issues,
      `persons.${index}.secondNationalityCountryKey`,
      person.secondNationalityCountryKey,
      countries,
    );
    requireOptionalFactRef(
      issues,
      `persons.${index}.placeOfBirthLocationKey`,
      person.placeOfBirthLocationKey,
      locations,
    );
    requireOptionalFactRef(
      issues,
      `persons.${index}.hometownLocationKey`,
      person.hometownLocationKey,
      locations,
    );
  }
  for (const [index, role] of dataset.personRoles.entries()) {
    requireRef(issues, `personRoles.${index}.personKey`, role.personKey, persons);
  }
  for (const [index, assignment] of dataset.teamPersonAssignments.entries()) {
    requireRef(issues, `teamPersonAssignments.${index}.personKey`, assignment.personKey, persons);
    requireRef(issues, `teamPersonAssignments.${index}.teamKey`, assignment.teamKey, teams);
  }
  for (const [index, attributes] of dataset.playerAttributes.entries()) {
    requireRef(issues, `playerAttributes.${index}.personKey`, attributes.personKey, persons);
  }
  for (const [index, profile] of dataset.playerFactualProfiles.entries()) {
    requireRef(issues, `playerFactualProfiles.${index}.playerKey`, profile.playerKey, persons);
    requireOptionalFactRef(
      issues,
      `playerFactualProfiles.${index}.currentClubKey`,
      profile.currentClubKey,
      clubs,
    );
  }
  for (const [index, plan] of dataset.trainingPlans.entries()) {
    requireRef(issues, `trainingPlans.${index}.teamKey`, plan.teamKey, teams);
    for (const [sessionIndex, session] of plan.sessions.entries()) {
      requireOptionalFactRef(
        issues,
        `trainingPlans.${index}.sessions.${sessionIndex}.coachAssignmentKey`,
        session.coachAssignmentKey,
        staffAppointments,
      );
    }
  }
  for (const [index, plan] of dataset.individualDevelopmentPlans.entries()) {
    requireRef(issues, `individualDevelopmentPlans.${index}.playerKey`, plan.playerKey, persons);
  }
  for (const [index, state] of dataset.playerDevelopmentStates.entries()) {
    requireRef(issues, `playerDevelopmentStates.${index}.playerKey`, state.playerKey, persons);
  }
  for (const [index, potential] of dataset.playerPotentials.entries()) {
    requireRef(issues, `playerPotentials.${index}.playerKey`, potential.playerKey, persons);
  }
  for (const [index, snapshot] of dataset.playerPlayingTimeSnapshots.entries()) {
    requireRef(
      issues,
      `playerPlayingTimeSnapshots.${index}.playerKey`,
      snapshot.playerKey,
      persons,
    );
    requireOptionalFactRef(
      issues,
      `playerPlayingTimeSnapshots.${index}.competitionSeasonKey`,
      snapshot.competitionSeasonKey,
      competitionSeasons,
    );
  }
  for (const [index, multiplier] of dataset.competitionDevelopmentMultipliers.entries()) {
    requireRef(
      issues,
      `competitionDevelopmentMultipliers.${index}.competitionKey`,
      multiplier.competitionKey,
      competitions,
    );
  }
  for (const [index, profile] of dataset.staffSimulationProfiles.entries()) {
    requireRef(issues, `staffSimulationProfiles.${index}.personKey`, profile.personKey, persons);
  }
  for (const [index, profile] of dataset.trainingFacilityProfiles.entries()) {
    requireOptionalFactRef(
      issues,
      `trainingFacilityProfiles.${index}.clubKey`,
      profile.clubKey,
      clubs,
    );
    requireOptionalFactRef(
      issues,
      `trainingFacilityProfiles.${index}.academyKey`,
      profile.academyKey,
      academies,
    );
  }
  for (const [index, event] of dataset.trainingHistoryEvents.entries()) {
    requireOptionalFactRef(
      issues,
      `trainingHistoryEvents.${index}.playerKey`,
      event.playerKey,
      persons,
    );
    requireOptionalFactRef(issues, `trainingHistoryEvents.${index}.teamKey`, event.teamKey, teams);
  }

  return issues;
};

const keySet = (records: ReadonlyArray<{ key: string }>): ReadonlySet<string> =>
  new Set(records.map((record) => record.key));

const requireUniqueKeys = (
  issues: DatasetReferenceIssue[],
  label: string,
  records: ReadonlyArray<{ key: string }>,
): void => {
  const seen = new Set<string>();
  for (const [index, record] of records.entries()) {
    if (seen.has(record.key)) {
      issues.push({ path: `${label}.${index}.key`, message: `Duplicate key: ${record.key}` });
    }
    seen.add(record.key);
  }
};

const requireUniqueCanonicalExternalIds = (
  issues: DatasetReferenceIssue[],
  records: ReadonlyArray<{ canonicalExternalId?: string }>,
): void => {
  const seen = new Map<string, number>();
  for (const [index, record] of records.entries()) {
    if (!record.canonicalExternalId) {
      continue;
    }
    const existing = seen.get(record.canonicalExternalId);
    if (existing !== undefined) {
      issues.push({
        path: `canonicalExternalId.${index}`,
        message: `Duplicate canonical external ID: ${record.canonicalExternalId} first seen at ${existing}`,
      });
    }
    seen.set(record.canonicalExternalId, index);
  }
};

const requireAliasIntegrity = (
  issues: DatasetReferenceIssue[],
  aliases: ReadonlyArray<{ clubKey: string; alias: string }>,
  clubs: ReadonlySet<string>,
): void => {
  const seenAliases = new Map<string, string>();
  for (const [index, alias] of aliases.entries()) {
    const normalized = alias.alias.trim().toLocaleLowerCase("en-US");
    const existingClub = seenAliases.get(normalized);
    if (existingClub !== undefined && existingClub !== alias.clubKey) {
      issues.push({
        path: `clubAliases.${index}.alias`,
        message: `Alias collision: ${alias.alias} already belongs to ${existingClub}`,
      });
    }
    if (!clubs.has(alias.clubKey)) {
      issues.push({
        path: `clubAliases.${index}.clubKey`,
        message: `Unknown reference: ${alias.clubKey}`,
      });
    }
    seenAliases.set(normalized, alias.clubKey);
  }
};

const requireRef = (
  issues: DatasetReferenceIssue[],
  path: string,
  key: string,
  validKeys: ReadonlySet<string>,
): void => {
  if (!validKeys.has(key)) {
    issues.push({ path, message: `Unknown reference: ${key}` });
  }
};

const requireOptionalFactRef = (
  issues: DatasetReferenceIssue[],
  path: string,
  fact: { value?: string } | undefined,
  validKeys: ReadonlySet<string>,
): void => {
  if (fact?.value !== undefined && !validKeys.has(fact.value)) {
    issues.push({ path, message: `Unknown reference: ${fact.value}` });
  }
};

const requireOptionalLocationKind = (
  issues: DatasetReferenceIssue[],
  path: string,
  fact: { value?: string } | undefined,
  locationKinds: ReadonlyMap<string, string>,
  allowedKinds: readonly string[],
): void => {
  if (fact?.value === undefined) {
    return;
  }
  const kind = locationKinds.get(fact.value);
  if (kind !== undefined && !allowedKinds.includes(kind)) {
    issues.push({
      path,
      message: `Expected ${fact.value} to be ${allowedKinds.join(" or ")}, got ${kind}`,
    });
  }
};

const requireValidCoordinates = (
  issues: DatasetReferenceIssue[],
  path: string,
  latitude: { value?: number } | undefined,
  longitude: { value?: number } | undefined,
): void => {
  if (latitude?.value !== undefined && (latitude.value < -90 || latitude.value > 90)) {
    issues.push({ path: `${path}.latitude`, message: `Invalid latitude: ${latitude.value}` });
  }
  if (longitude?.value !== undefined && (longitude.value < -180 || longitude.value > 180)) {
    issues.push({ path: `${path}.longitude`, message: `Invalid longitude: ${longitude.value}` });
  }
};

const requireValidAltitude = (
  issues: DatasetReferenceIssue[],
  path: string,
  altitude: { value?: number } | undefined,
): void => {
  if (altitude?.value !== undefined && (altitude.value < -500 || altitude.value > 9000)) {
    issues.push({ path, message: `Invalid altitudeMeters: ${altitude.value}` });
  }
};
