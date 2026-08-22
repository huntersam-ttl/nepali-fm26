import { z } from "zod";

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
  countryKey: keySchema,
  name: z.string().min(1),
  kind: z.enum(["city", "district", "province", "stadium", "unknown"]),
  parentLocationKey: nullableKeyFactSchema.optional(),
  provenance: provenanceSchema,
});

const venueRecordSchema = z.object({
  key: keySchema,
  countryKey: keySchema,
  name: z.string().min(1),
  locationKey: nullableKeyFactSchema,
  capacity: nullableNumberFactSchema,
  pitchType: nullableStringFactSchema.optional(),
  provenance: provenanceSchema,
});

const federationRecordSchema = z.object({
  key: keySchema,
  countryKey: keySchema,
  name: z.string().min(1),
  foundedYear: nullableNumberFactSchema,
  provenance: provenanceSchema,
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
    relationshipType: z.enum([
      "OWNER",
      "OPERATOR",
      "TENANT",
      "TEMPORARY_USER",
      "SHARED_USER",
      "UNKNOWN",
    ]),
    provenance: provenanceSchema,
  })
  .superRefine((relationship, context) => {
    if (!relationship.clubKey?.value && !relationship.teamKey?.value) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Venue relationship must link to a club or team",
      });
    }
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
  primaryPosition: z.enum(["GK", "RB", "CB", "LB", "DM", "CM", "AM", "RW", "LW", "ST"]),
  secondaryPositions: z.array(z.enum(["GK", "RB", "CB", "LB", "DM", "CM", "AM", "RW", "LW", "ST"])),
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
  persons: z.array(personRecordSchema),
  personRoles: z.array(personRoleRecordSchema),
  teamPersonAssignments: z.array(teamPersonAssignmentRecordSchema),
  playerAttributes: z.array(playerAttributeRecordSchema).default([]),
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
  const venues = keySet(dataset.venues);
  const federations = keySet(dataset.federations);
  const competitions = keySet(dataset.competitions);
  const competitionSeasons = keySet(dataset.competitionSeasons);
  const clubs = keySet(dataset.clubs);
  const teams = keySet(dataset.teams);
  const persons = keySet(dataset.persons);

  requireUniqueKeys(issues, "countries", dataset.countries);
  requireUniqueKeys(issues, "locations", dataset.locations);
  requireUniqueKeys(issues, "venues", dataset.venues);
  requireUniqueKeys(issues, "federations", dataset.federations);
  requireUniqueKeys(issues, "competitions", dataset.competitions);
  requireUniqueKeys(issues, "competitionSeasons", dataset.competitionSeasons);
  requireUniqueKeys(issues, "competitionRelationships", dataset.competitionRelationships);
  requireUniqueKeys(issues, "clubs", dataset.clubs);
  requireUniqueKeys(issues, "teams", dataset.teams);
  requireUniqueCanonicalExternalIds(issues, dataset.clubs);
  requireUniqueCanonicalExternalIds(issues, dataset.teams);
  requireAliasIntegrity(issues, dataset.clubAliases, clubs);

  for (const [index, location] of dataset.locations.entries()) {
    requireRef(issues, `locations.${index}.countryKey`, location.countryKey, countries);
    requireOptionalFactRef(
      issues,
      `locations.${index}.parentLocationKey`,
      location.parentLocationKey,
      locations,
    );
  }
  for (const [index, venue] of dataset.venues.entries()) {
    requireRef(issues, `venues.${index}.countryKey`, venue.countryKey, countries);
    requireOptionalFactRef(issues, `venues.${index}.locationKey`, venue.locationKey, locations);
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
