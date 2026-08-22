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
  sourceUrl: z.string().url().optional(),
  sourceName: z.string().min(1),
  lastVerifiedDate: isoDateSchema.optional(),
  confidence: z.number().min(0).max(1),
  status: provenanceStatusSchema,
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
  provenance: provenanceSchema,
});

const clubRecordSchema = z.object({
  key: keySchema,
  countryKey: keySchema,
  name: z.string().min(1),
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
  foundedYear: nullableNumberFactSchema,
  provenance: provenanceSchema,
});

const teamRecordSchema = z
  .object({
    key: keySchema,
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
  clubs: z.array(clubRecordSchema),
  teams: z.array(teamRecordSchema),
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
  const federations = keySet(dataset.federations);
  const competitions = keySet(dataset.competitions);
  const competitionSeasons = keySet(dataset.competitionSeasons);
  const clubs = keySet(dataset.clubs);
  const teams = keySet(dataset.teams);
  const persons = keySet(dataset.persons);

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
  for (const [index, club] of dataset.clubs.entries()) {
    requireRef(issues, `clubs.${index}.countryKey`, club.countryKey, countries);
    requireOptionalFactRef(issues, `clubs.${index}.locationKey`, club.locationKey, locations);
  }
  for (const [index, team] of dataset.teams.entries()) {
    requireOptionalFactRef(issues, `teams.${index}.clubKey`, team.clubKey, clubs);
    requireOptionalFactRef(issues, `teams.${index}.federationKey`, team.federationKey, federations);
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
