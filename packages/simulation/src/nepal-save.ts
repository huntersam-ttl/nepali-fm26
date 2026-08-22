import {
  validateNepalWorldDataset,
  validateNepalWorldReferences,
  type NepalWorldDataset,
} from "@nepal-football-sim/data-import";
import {
  createNewSave,
  CompetitionRepository,
  ImportRepository,
  loadSave,
  migrateDatabase,
  openGameDatabase,
  PlayerRepository,
  WorldRepository,
  type GameDatabase,
  type WorldInspection,
} from "@nepal-football-sim/database";
import {
  createEntityId,
  createStableEntityId,
  type DataProvenance,
  type EntityId,
} from "@nepal-football-sim/shared-types";

export type CreateNepalSaveInput = {
  databasePath: string;
  dataset: unknown;
  saveName?: string;
  gameVersion: string;
  randomSeed: string;
  worldDate?: string;
};

export type NepalSaveResult = {
  databasePath: string;
  saveId: EntityId;
  worldDate: string;
  inspection: WorldInspection;
};

type EntityMaps = {
  countries: Map<string, EntityId>;
  locations: Map<string, EntityId>;
  venues: Map<string, EntityId>;
  federations: Map<string, EntityId>;
  competitions: Map<string, EntityId>;
  competitionSeasons: Map<string, EntityId>;
  competitionRules: Map<string, EntityId>;
  competitionRelationships: Map<string, EntityId>;
  clubs: Map<string, EntityId>;
  clubAliases: Map<string, EntityId>;
  teams: Map<string, EntityId>;
  clubRelationships: Map<string, EntityId>;
  clubMemberships: Map<string, EntityId>;
  academies: Map<string, EntityId>;
  venueRelationships: Map<string, EntityId>;
  locationTravelContexts: Map<string, EntityId>;
  persons: Map<string, EntityId>;
  personRoles: Map<string, EntityId>;
  teamPersonAssignments: Map<string, EntityId>;
  playerAttributes: Map<string, EntityId>;
};

export const createNepalSave = (input: CreateNepalSaveInput): NepalSaveResult => {
  const dataset = validateNepalWorldDataset(input.dataset);
  const referenceIssues = validateNepalWorldReferences(dataset);
  if (referenceIssues.length > 0) {
    throw new Error(
      `Nepal world dataset has invalid references: ${referenceIssues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
  }

  const db = openGameDatabase(input.databasePath);
  migrateDatabase(db);
  try {
    db.exec("BEGIN;");
    const save = createNewSave(db, {
      name: input.saveName ?? `Nepal ${dataset.meta.targetDatabaseDate}`,
      worldDate: input.worldDate ?? `${dataset.meta.targetDatabaseDate}-01`,
      gameVersion: input.gameVersion,
      randomSeed: input.randomSeed,
    });
    importNepalWorld(db, dataset);
    db.exec("COMMIT;");

    const inspection = new WorldRepository(db).inspectWorld();
    db.close();
    return {
      databasePath: input.databasePath,
      saveId: save.id,
      worldDate: save.worldDate,
      inspection,
    };
  } catch (error) {
    db.exec("ROLLBACK;");
    db.close();
    throw error;
  }
};

export const inspectNepalSave = (databasePath: string): NepalSaveResult => {
  const db = openGameDatabase(databasePath);
  migrateDatabase(db);
  const save = loadSave(db);
  const inspection = new WorldRepository(db).inspectWorld();
  db.close();
  return {
    databasePath,
    saveId: save.id,
    worldDate: save.worldDate,
    inspection,
  };
};

const importNepalWorld = (db: GameDatabase, dataset: NepalWorldDataset): void => {
  const world = new WorldRepository(db);
  const competitions = new CompetitionRepository(db);
  const players = new PlayerRepository(db);
  const imports = new ImportRepository(db);
  const importedAt = new Date().toISOString();
  const maps = buildEntityMaps(dataset);

  for (const country of dataset.countries) {
    const id = maps.countries.get(country.key)!;
    world.insertCountry({
      id,
      name: country.name,
      isoCode: country.isoCode,
    });
    persistImport(imports, "country", id, country, country.provenance, importedAt);
  }

  for (const location of orderLocationsForImport(dataset.locations)) {
    const id = maps.locations.get(location.key)!;
    world.insertLocation({
      id,
      canonicalExternalId: location.canonicalExternalId,
      countryId: maps.countries.get(location.countryKey)!,
      name: location.name,
      kind: location.kind,
      parentLocationId: mapFact(location.parentLocationKey, maps.locations),
      latitude: valueOf(location.latitude),
      longitude: valueOf(location.longitude),
      altitudeMeters: valueOf(location.altitudeMeters),
      climateProfile: location.climateProfile
        ? {
            climateZone: valueOf(location.climateProfile.climateZone),
            seasonalHeatRisk: valueOf(location.climateProfile.seasonalHeatRisk) ?? "UNKNOWN",
            monsoonRisk: valueOf(location.climateProfile.monsoonRisk) ?? "UNKNOWN",
            coldRisk: valueOf(location.climateProfile.coldRisk) ?? "UNKNOWN",
            humidityRisk: valueOf(location.climateProfile.humidityRisk) ?? "UNKNOWN",
          }
        : undefined,
    });
    persistImport(imports, "location", id, location, location.provenance, importedAt);
  }

  for (const venue of dataset.venues) {
    const id = maps.venues.get(venue.key)!;
    world.insertVenue({
      id,
      canonicalExternalId: venue.canonicalExternalId,
      countryId: maps.countries.get(venue.countryKey)!,
      locationId: mapFact(venue.locationKey, maps.locations),
      provinceId: mapFact(venue.provinceKey, maps.locations),
      districtId: mapFact(venue.districtKey, maps.locations),
      cityId: mapFact(venue.cityKey, maps.locations),
      name: venue.name,
      officialName: valueOf(venue.officialName),
      shortName: valueOf(venue.shortName),
      aliases: venue.aliases,
      venueType: valueOf(venue.venueType) ?? "UNKNOWN",
      capacity: valueOf(venue.capacity),
      latitude: valueOf(venue.latitude),
      longitude: valueOf(venue.longitude),
      altitudeMeters: valueOf(venue.altitudeMeters),
      surfaceType: valueOf(venue.surfaceType) ?? "UNKNOWN",
      pitchQuality: valueOf(venue.pitchQuality) ?? "UNKNOWN",
      yearOpened: valueOf(venue.yearOpened),
      yearLastRenovated: valueOf(venue.yearLastRenovated),
      floodlights: valueOf(venue.floodlights),
      runningTrack: valueOf(venue.runningTrack),
      coveredStands: valueOf(venue.coveredStands),
      ownerEntity: valueOf(venue.ownerEntity),
      operatorEntity: valueOf(venue.operatorEntity),
      status: valueOf(venue.status) ?? "UNKNOWN",
    });
    persistImport(imports, "venue", id, venue, venue.provenance, importedAt);
  }

  for (const federation of dataset.federations) {
    const id = maps.federations.get(federation.key)!;
    world.insertFederation({
      id,
      countryId: maps.countries.get(federation.countryKey)!,
      name: federation.name,
      foundedYear: valueOf(federation.foundedYear),
    });
    persistImport(imports, "federation", id, federation, federation.provenance, importedAt);
  }

  for (const competition of dataset.competitions) {
    const id = maps.competitions.get(competition.key)!;
    world.insertCompetition({
      id,
      federationId: mapFact(competition.federationKey, maps.federations),
      name: competition.name,
      scope: competition.scope,
      category: competition.category,
    });
    persistImport(imports, "competition", id, competition, competition.provenance, importedAt);
  }

  for (const season of dataset.competitionSeasons) {
    const id = maps.competitionSeasons.get(season.key)!;
    world.insertCompetitionSeason({
      id,
      competitionId: maps.competitions.get(season.competitionKey)!,
      name: season.name,
      startDate: season.startDate,
      endDate: season.endDate,
    });
    persistImport(imports, "competitionSeason", id, season, season.provenance, importedAt);
  }

  for (const rules of dataset.competitionRules) {
    const id = maps.competitionRules.get(rules.key)!;
    competitions.insertRuleSet({
      id,
      competitionSeasonId: maps.competitionSeasons.get(rules.competitionSeasonKey)!,
      competitionType: rules.competitionType,
      pointsForWin: rules.pointsForWin,
      pointsForDraw: rules.pointsForDraw,
      pointsForLoss: rules.pointsForLoss,
      tiebreakers: rules.tiebreakers,
      numberOfRounds: rules.numberOfRounds,
      homeAwayStructure: rules.homeAwayStructure,
      fixtureCount: valueOf(rules.fixtureCount),
      seasonStartDate: rules.seasonStartDate,
      seasonEndDate: rules.seasonEndDate,
      roundSpacingDays: rules.roundSpacingDays,
      promotionSlots: rules.promotionSlots,
      relegationSlots: rules.relegationSlots,
      continentalQualificationSlots: rules.continentalQualificationSlots,
      promotionEnabled: rules.promotionEnabled,
      relegationEnabled: rules.relegationEnabled,
      specialRules: rules.specialRules,
    });
    persistImport(imports, "competitionRule", id, rules, rules.provenance, importedAt);
  }

  for (const relationship of dataset.competitionRelationships) {
    const id = maps.competitionRelationships.get(relationship.key)!;
    competitions.insertRelationship({
      id,
      fromCompetitionId: maps.competitions.get(relationship.fromCompetitionKey)!,
      toCompetitionId: maps.competitions.get(relationship.toCompetitionKey)!,
      movementType: relationship.movementType,
      numberOfTeams: relationship.numberOfTeams,
      selectionMethod: relationship.selectionMethod,
      effectiveSeasonId: mapFact(relationship.effectiveSeasonKey, maps.competitionSeasons),
    });
    persistImport(
      imports,
      "competitionRelationship",
      id,
      relationship,
      relationship.provenance,
      importedAt,
    );
  }

  for (const club of dataset.clubs) {
    const id = maps.clubs.get(club.key)!;
    world.insertClub({
      id,
      name: club.name,
      officialName: valueOf(club.officialName),
      shortName: valueOf(club.shortName),
      nepaliName: valueOf(club.nepaliName),
      canonicalExternalId: club.canonicalExternalId,
      countryId: maps.countries.get(club.countryKey)!,
      locationId: mapFact(club.locationKey, maps.locations),
      ownershipType: valueOf(club.ownershipType) ?? "UNKNOWN",
      organisationType: valueOf(club.organisationType),
      parentOrganisation: valueOf(club.parentOrganisation),
      foundedYear: valueOf(club.foundedYear),
    });
    persistImport(imports, "club", id, club, club.provenance, importedAt);
  }

  for (const alias of dataset.clubAliases) {
    const id = maps.clubAliases.get(alias.key)!;
    world.insertClubAlias({
      id,
      clubId: maps.clubs.get(alias.clubKey)!,
      alias: alias.alias,
      aliasType: alias.aliasType,
    });
    persistImport(imports, "clubAlias", id, alias, alias.provenance, importedAt);
  }

  for (const team of dataset.teams) {
    const id = maps.teams.get(team.key)!;
    world.insertTeam({
      id,
      clubId: mapFact(team.clubKey, maps.clubs),
      federationId: mapFact(team.federationKey, maps.federations),
      name: team.name,
      canonicalExternalId: team.canonicalExternalId,
      level: team.level,
      gender: team.gender,
    });
    persistImport(imports, "team", id, team, team.provenance, importedAt);
  }

  for (const relationship of dataset.clubRelationships) {
    const id = maps.clubRelationships.get(relationship.key)!;
    world.insertClubRelationship({
      id,
      parentClubId: maps.clubs.get(relationship.parentClubKey)!,
      childClubId: mapFact(relationship.childClubKey, maps.clubs),
      childTeamId: mapFact(relationship.childTeamKey, maps.teams),
      relationshipType: relationship.relationshipType,
    });
    persistImport(
      imports,
      "clubRelationship",
      id,
      relationship,
      relationship.provenance,
      importedAt,
    );
  }

  for (const membership of dataset.clubMemberships) {
    const id = maps.clubMemberships.get(membership.key)!;
    world.insertClubMembership({
      id,
      clubId: maps.clubs.get(membership.clubKey)!,
      teamId: mapFact(membership.teamKey, maps.teams),
      competitionId: maps.competitions.get(membership.competitionKey)!,
      competitionSeasonId: mapFact(membership.competitionSeasonKey, maps.competitionSeasons),
      membershipType: membership.membershipType,
      status: membership.status,
    });
    persistImport(imports, "clubMembership", id, membership, membership.provenance, importedAt);
  }

  for (const academy of dataset.academies) {
    const id = maps.academies.get(academy.key)!;
    world.insertAcademy({
      id,
      name: academy.name,
      canonicalExternalId: academy.canonicalExternalId,
      countryId: maps.countries.get(academy.countryKey)!,
      locationId: mapFact(academy.locationKey, maps.locations),
      parentClubId: mapFact(academy.parentClubKey, maps.clubs),
      linkedClubId: mapFact(academy.linkedClubKey, maps.clubs),
      federationId: mapFact(academy.federationKey, maps.federations),
      academyType: academy.academyType,
    });
    persistImport(imports, "academy", id, academy, academy.provenance, importedAt);
  }

  for (const relationship of dataset.venueRelationships) {
    const id = maps.venueRelationships.get(relationship.key)!;
    world.insertVenueRelationship({
      id,
      venueId: maps.venues.get(relationship.venueKey)!,
      clubId: mapFact(relationship.clubKey, maps.clubs),
      teamId: mapFact(relationship.teamKey, maps.teams),
      federationId: mapFact(relationship.federationKey, maps.federations),
      academyId: mapFact(relationship.academyKey, maps.academies),
      relationshipType: relationship.relationshipType,
      startDate: valueOf(relationship.startDate),
      endDate: valueOf(relationship.endDate),
      competitionSeasonId: mapFact(relationship.competitionSeasonKey, maps.competitionSeasons),
      status: relationship.status,
    });
    persistImport(
      imports,
      "venueRelationship",
      id,
      relationship,
      relationship.provenance,
      importedAt,
    );
  }

  for (const travel of dataset.locationTravelContexts) {
    const id = maps.locationTravelContexts.get(travel.key)!;
    world.insertLocationTravelContext({
      id,
      fromLocationId: maps.locations.get(travel.fromLocationKey)!,
      toLocationId: maps.locations.get(travel.toLocationKey)!,
      roadDistanceKm: valueOf(travel.roadDistanceKm),
      estimatedRoadTravelHours: valueOf(travel.estimatedRoadTravelHours),
      airTravelAvailable: valueOf(travel.airTravelAvailable),
      nearestAirportId: mapFact(travel.nearestAirportKey, maps.locations),
    });
    persistImport(imports, "locationTravelContext", id, travel, travel.provenance, importedAt);
  }

  for (const person of dataset.persons) {
    const id = maps.persons.get(person.key)!;
    world.insertPerson({
      id,
      fullName: person.fullName,
      displayName: valueOf(person.displayName),
      dateOfBirth: valueOf(person.dateOfBirth),
      nationalityCountryId: maps.countries.get(person.nationalityCountryKey)!,
      secondNationalityCountryId: mapFact(person.secondNationalityCountryKey, maps.countries),
      genderPresentation: valueOf(person.genderPresentation),
      placeOfBirthLocationId: mapFact(person.placeOfBirthLocationKey, maps.locations),
      hometownLocationId: mapFact(person.hometownLocationKey, maps.locations),
      languages: valueOf(person.languages) ?? [],
    });
    persistImport(imports, "person", id, person, person.provenance, importedAt);
  }

  for (const role of dataset.personRoles) {
    const id = maps.personRoles.get(role.key)!;
    world.insertPersonRole({
      id,
      personId: maps.persons.get(role.personKey)!,
      role: role.role,
      activeFrom: valueOf(role.activeFrom) ?? `${dataset.meta.targetDatabaseDate}-01`,
      activeTo: valueOf(role.activeTo),
    });
    persistImport(imports, "personRole", id, role, role.provenance, importedAt);
  }

  for (const assignment of dataset.teamPersonAssignments) {
    const id = maps.teamPersonAssignments.get(assignment.key)!;
    world.insertTeamPersonAssignment({
      id,
      personId: maps.persons.get(assignment.personKey)!,
      teamId: maps.teams.get(assignment.teamKey)!,
      role: assignment.role,
      startedOn: valueOf(assignment.startedOn),
      endedOn: valueOf(assignment.endedOn),
    });
    persistImport(
      imports,
      "teamPersonAssignment",
      id,
      assignment,
      assignment.provenance,
      importedAt,
    );
  }

  for (const attributes of dataset.playerAttributes) {
    const id = maps.playerAttributes.get(attributes.key)!;
    players.insertAttributes({
      id,
      personId: maps.persons.get(attributes.personKey)!,
      primaryPosition: attributes.primaryPosition,
      secondaryPositions: attributes.secondaryPositions,
      technical: attributes.technical,
      mental: attributes.mental,
      physical: attributes.physical,
      goalkeeping: attributes.goalkeeping,
    });
    persistImport(imports, "playerAttribute", id, attributes, attributes.provenance, importedAt);
  }
};

const buildEntityMaps = (dataset: NepalWorldDataset): EntityMaps => ({
  countries: mapKeys("country", dataset.countries),
  locations: mapKeys("location", dataset.locations),
  venues: mapKeys("venue", dataset.venues),
  federations: mapKeys("federation", dataset.federations),
  competitions: mapKeys("competition", dataset.competitions),
  competitionSeasons: mapKeys("competition-season", dataset.competitionSeasons),
  competitionRules: mapKeys("competition-rule", dataset.competitionRules),
  competitionRelationships: mapKeys("competition-relationship", dataset.competitionRelationships),
  clubs: mapKeys("club", dataset.clubs),
  clubAliases: mapKeys("club-alias", dataset.clubAliases),
  teams: mapKeys("team", dataset.teams),
  clubRelationships: mapKeys("club-relationship", dataset.clubRelationships),
  clubMemberships: mapKeys("club-membership", dataset.clubMemberships),
  academies: mapKeys("academy", dataset.academies),
  venueRelationships: mapKeys("venue-relationship", dataset.venueRelationships),
  locationTravelContexts: mapKeys("location-travel-context", dataset.locationTravelContexts),
  persons: mapKeys("person", dataset.persons),
  personRoles: mapKeys("person-role", dataset.personRoles),
  teamPersonAssignments: mapKeys("team-person-assignment", dataset.teamPersonAssignments),
  playerAttributes: mapKeys("player-attribute", dataset.playerAttributes),
});

const orderLocationsForImport = (
  locations: NepalWorldDataset["locations"],
): NepalWorldDataset["locations"] => {
  const pending = new Map(locations.map((location) => [location.key, location]));
  const ordered: NepalWorldDataset["locations"] = [];
  const inserted = new Set<string>();

  while (pending.size > 0) {
    const startingSize = pending.size;
    for (const [key, location] of pending) {
      const parentKey = location.parentLocationKey?.value;
      if (parentKey === undefined || inserted.has(parentKey) || !pending.has(parentKey)) {
        ordered.push(location);
        inserted.add(key);
        pending.delete(key);
      }
    }
    if (pending.size === startingSize) {
      throw new Error("Nepal world dataset has cyclic location parent references");
    }
  }

  return ordered;
};

const mapKeys = (
  namespace: string,
  records: ReadonlyArray<{ key: string }>,
): Map<string, EntityId> =>
  new Map(records.map((record) => [record.key, createStableEntityId(namespace, record.key)]));

const valueOf = <T>(fact: { value?: T } | undefined): T | undefined => fact?.value;

const mapFact = (
  fact: { value?: string } | undefined,
  map: ReadonlyMap<string, EntityId>,
): EntityId | undefined => {
  if (fact?.value === undefined) {
    return undefined;
  }
  return map.get(fact.value);
};

const persistImport = (
  imports: ImportRepository,
  entityType: string,
  entityId: EntityId,
  payload: Record<string, unknown>,
  provenance: DataProvenance,
  importedAt: string,
): void => {
  imports.insertImportRecord({
    id: createEntityId(),
    entityType,
    entityId,
    payload,
    provenance,
    importedAt,
  });
  imports.insertEntityProvenance({
    id: createEntityId(),
    entityType,
    entityId,
    provenance,
    importedAt,
  });
};
