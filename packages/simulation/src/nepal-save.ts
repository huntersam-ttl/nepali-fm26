import {
  validateCountryWorldDataset,
  validateCountryWorldReferences,
  type CountryWorldDataset,
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
  type FederationComplianceSnapshotSeed,
} from "@nepal-football-sim/shared-types";
import { applyFederationComplianceSnapshot } from "./federation-compliance.js";
import { ensureLowerLeaguePlayableWorld } from "./workforce-supply.js";
import { advanceMacroEconomyForWorldDate } from "./macro-economy.js";
import { initializeSupporterCultureForSave } from "./supporter-culture.js";
import { countryPack, type CountryPack } from "./country-pack.js";
import { NEPAL_PACK_ID } from "./country-packs/nepal.js";
import { establishHomeFootballContext } from "./home-context.js";
import { ensurePlayableClubVenues } from "./club-creation.js";
import { applyCanonicalGlobalDatasetSeed } from "./global-football-seed.js";
import { reconcilePlayablePlayerProfilesOnce } from "./player-profile-reconciliation.js";
import { initializeClubFinanceMarkets } from "./club-finance-markets.js";
import { initializePeopleFoundation } from "./people-foundation.js";

export type CreateNepalSaveInput = {
  databasePath: string;
  dataset: unknown;
  saveName?: string;
  gameVersion: string;
  randomSeed: string;
  worldDate?: string;
  /**
   * Canonical global dataset seed. Defaults to the repository artifact; pass
   * null to build a Nepal-only world (fixtures and focused tests do this).
   */
  globalSeedPath?: string | null;
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
  staffProfiles: Map<string, EntityId>;
  staffAppointments: Map<string, EntityId>;
  staffVacancies: Map<string, EntityId>;
  staffLicences: Map<string, EntityId>;
  refereeProfiles: Map<string, EntityId>;
  staffHistoryEvents: Map<string, EntityId>;
  playerAttributes: Map<string, EntityId>;
  playerFactualProfiles: Map<string, EntityId>;
  trainingPlans: Map<string, EntityId>;
  individualDevelopmentPlans: Map<string, EntityId>;
  playerDevelopmentStates: Map<string, EntityId>;
  playerPotentials: Map<string, EntityId>;
  playerPlayingTimeSnapshots: Map<string, EntityId>;
  competitionDevelopmentMultipliers: Map<string, EntityId>;
  staffSimulationProfiles: Map<string, EntityId>;
  trainingFacilityProfiles: Map<string, EntityId>;
  trainingHistoryEvents: Map<string, EntityId>;
};

export type CreateCountrySaveInput = CreateNepalSaveInput & {
  /** The country pack the dataset belongs to, e.g. "nepal-v1". */
  packId: string;
};

/** Creates a save for the country a dataset and its pack describe. This is the one save-creation path. */
export const createCountrySave = (input: CreateCountrySaveInput): NepalSaveResult => {
  const pack = countryPack(input.packId);
  const dataset = validateCountryWorldDataset(input.dataset);
  const referenceIssues = validateCountryWorldReferences(dataset);
  if (referenceIssues.length > 0) {
    throw new Error(
      `${pack.countryName} world dataset has invalid references: ${referenceIssues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
  }

  const db = openGameDatabase(input.databasePath);
  migrateDatabase(db);
  try {
    db.exec("BEGIN;");
    const save = createNewSave(db, {
      name: input.saveName ?? `${pack.countryName} ${dataset.meta.targetDatabaseDate}`,
      worldDate: input.worldDate ?? `${dataset.meta.targetDatabaseDate}-01`,
      gameVersion: input.gameVersion,
      randomSeed: input.randomSeed,
    });
    importCountryWorld(db, dataset, pack, input.worldDate ?? `${dataset.meta.targetDatabaseDate}-01`);
    ensurePlayableClubVenues(db, save.worldDate);
    advanceMacroEconomyForWorldDate(db, { date: save.worldDate, seed: input.randomSeed });
    ensureLowerLeaguePlayableWorld({ db, date: save.worldDate, seed: input.randomSeed });
    initializePeopleFoundation({ db, date: save.worldDate, seed: input.randomSeed });
    initializeSupporterCultureForSave({ db, worldDate: save.worldDate, seed: input.randomSeed });
    db.exec("COMMIT;");

    /*
     * The global dataset is applied after the Nepal world is committed, so the
     * importer reconciles against canonical Nepal identities rather than
     * creating parallel ones, and so its own transaction does not nest inside
     * this one. Existing careers are untouched: this runs only at save
     * creation, and the dataset version is recorded on the save's world.
     */
    if (input.globalSeedPath !== null && (input.globalSeedPath !== undefined || pack.canonicalGlobalSeed)) {
      applyCanonicalGlobalDatasetSeed(db, { seedPath: input.globalSeedPath });
    }
    reconcilePlayablePlayerProfilesOnce(db, { worldDate: save.worldDate, seed: input.randomSeed });
    initializeClubFinanceMarkets(db);

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

/** Creates a Nepal save: the launch country, through the generic country-save path. */
export const createNepalSave = (input: CreateNepalSaveInput): NepalSaveResult =>
  createCountrySave({ ...input, packId: NEPAL_PACK_ID });

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

/**
 * Imports a country's dataset, records the save's home football context from the country pack
 * and builds the pack's country-specific structures. The context is established right after
 * the import so everything that follows can ask for the home country and federation.
 */
export const importCountryWorld = (db: GameDatabase, dataset: CountryWorldDataset, pack: CountryPack, date: string): void => {
  importWorldRecords(db, dataset);
  establishHomeFootballContext(db, pack, date);
  pack.initialiseTerritory?.(db, date);
};

const importWorldRecords = (db: GameDatabase, dataset: CountryWorldDataset): void => {
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

  // FIFA/AFC starting-state hook (requirement 8): only ever seeds a
  // compliance snapshot the dataset actually supplies with real provenance.
  // Absent that, federations get the generic default profile later, tagged
  // provenanceStatus "UNKNOWN" rather than any hardcoded claim.
  for (const snapshot of dataset.federationComplianceSnapshots) {
    const federationId = maps.federations.get(snapshot.federationKey);
    if (!federationId) continue;
    const seed: FederationComplianceSnapshotSeed = {
      federationKey: snapshot.federationKey,
      status: snapshot.status,
      dimensions: snapshot.dimensions,
      effectiveDate: snapshot.effectiveDate,
      provenanceStatus: snapshot.provenanceStatus,
      sanctions: snapshot.sanctions,
    };
    applyFederationComplianceSnapshot(db, federationId, seed);
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

  for (const profile of dataset.staffProfiles) {
    const id = maps.staffProfiles.get(profile.key)!;
    world.insertStaffProfile({
      id,
      personId: maps.persons.get(profile.personKey)!,
      preferredRole: valueOf(profile.preferredRole),
      salaryExpectation: valueOf(profile.salaryExpectation),
      reputation: valueOf(profile.reputation),
      countryKnowledge: mapKeyArray(profile.countryKnowledgeKeys, maps.countries),
      clubKnowledge: mapKeyArray(profile.clubKnowledgeKeys, maps.clubs),
      availability: valueOf(profile.availability),
      workEligibilityStatus: valueOf(profile.workEligibilityStatus),
    });
    persistImport(imports, "staffProfile", id, profile, profile.provenance, importedAt);
  }

  for (const appointment of dataset.staffAppointments) {
    const id = maps.staffAppointments.get(appointment.key)!;
    world.insertStaffAppointment({
      id,
      personId: maps.persons.get(appointment.personKey)!,
      organisationType: appointment.organisationType,
      clubId: mapFact(appointment.clubKey, maps.clubs),
      teamId: mapFact(appointment.teamKey, maps.teams),
      federationId: mapFact(appointment.federationKey, maps.federations),
      academyId: mapFact(appointment.academyKey, maps.academies),
      organisationName: valueOf(appointment.organisationName),
      role: appointment.role,
      startDate: valueOf(appointment.startDate),
      endDate: valueOf(appointment.endDate),
      employmentStatus: appointment.employmentStatus,
      contractId: valueOf(appointment.contractId) as EntityId | undefined,
      serviceRankTitle: valueOf(appointment.serviceRankTitle),
    });
    persistImport(imports, "staffAppointment", id, appointment, appointment.provenance, importedAt);
  }

  for (const vacancy of dataset.staffVacancies) {
    const id = maps.staffVacancies.get(vacancy.key)!;
    world.insertStaffVacancy({
      id,
      organisationType: vacancy.organisationType,
      clubId: mapFact(vacancy.clubKey, maps.clubs),
      teamId: mapFact(vacancy.teamKey, maps.teams),
      federationId: mapFact(vacancy.federationKey, maps.federations),
      academyId: mapFact(vacancy.academyKey, maps.academies),
      organisationName: valueOf(vacancy.organisationName),
      role: vacancy.role,
      required: vacancy.required,
      assignedPersonId: mapFact(vacancy.assignedPersonKey, maps.persons),
      status: vacancy.status,
    });
    persistImport(imports, "staffVacancy", id, vacancy, vacancy.provenance, importedAt);
  }

  for (const licence of dataset.staffLicences) {
    const id = maps.staffLicences.get(licence.key)!;
    world.insertStaffLicence({
      id,
      personId: maps.persons.get(licence.personKey)!,
      licenceType: licence.licenceType,
      issuer: licence.issuer,
      issueDate: valueOf(licence.issueDate),
      expiryDate: valueOf(licence.expiryDate),
      status: licence.status,
    });
    persistImport(imports, "staffLicence", id, licence, licence.provenance, importedAt);
  }

  for (const referee of dataset.refereeProfiles) {
    const id = maps.refereeProfiles.get(referee.key)!;
    world.insertRefereeProfile({
      id,
      personId: maps.persons.get(referee.personKey)!,
      refereeLevel: valueOf(referee.refereeLevel),
      fifaListed: valueOf(referee.fifaListed),
      fifaListedSince: valueOf(referee.fifaListedSince),
      primaryRole: referee.primaryRole,
      competitionsEligible: mapKeyArray(referee.competitionsEligibleKeys, maps.competitions),
      experienceLevel: valueOf(referee.experienceLevel),
    });
    persistImport(imports, "refereeProfile", id, referee, referee.provenance, importedAt);
  }

  for (const event of dataset.staffHistoryEvents) {
    const id = maps.staffHistoryEvents.get(event.key)!;
    world.insertStaffHistoryEvent({
      id,
      personId: maps.persons.get(event.personKey)!,
      eventType: event.eventType,
      occurredOn: event.occurredOn,
      appointmentId: mapFact(event.staffAppointmentKey, maps.staffAppointments),
      clubId: mapFact(event.clubKey, maps.clubs),
      teamId: mapFact(event.teamKey, maps.teams),
      federationId: mapFact(event.federationKey, maps.federations),
      academyId: mapFact(event.academyKey, maps.academies),
      description: valueOf(event.description),
    });
    persistImport(imports, "staffHistoryEvent", id, event, event.provenance, importedAt);
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

  for (const profile of dataset.playerFactualProfiles) {
    const id = maps.playerFactualProfiles.get(profile.key)!;
    players.insertFactualProfile({
      id,
      playerId: maps.persons.get(profile.playerKey)!,
      canonicalExternalId: profile.canonicalExternalId,
      currentClubId: mapFact(profile.currentClubKey, maps.clubs),
      nameVariants: profile.nameVariants,
      nepaliName: valueOf(profile.nepaliName),
      factualPrimaryPosition: profile.factualPrimaryPosition,
      factualSecondaryPositions: profile.factualSecondaryPositions,
      factualPositionGroup: profile.factualPositionGroup,
      positionPrecision: profile.positionPrecision,
      sourcePosition: valueOf(profile.sourcePosition),
      squadStatus: profile.squadStatus,
      shirtNumber: valueOf(profile.shirtNumber),
      goalkeeperFlag: valueOf(profile.goalkeeperFlag),
      latestKnownAppearanceDate: valueOf(profile.latestKnownAppearanceDate),
      dateOfBirth: valueOf(profile.dateOfBirth),
      heightCm: valueOf(profile.heightCm),
      preferredFoot: valueOf(profile.preferredFoot),
      nationality: valueOf(profile.nationality),
      placeOfBirth: valueOf(profile.placeOfBirth),
      previousClubs: profile.previousClubs,
      factualContractStatus: profile.factualContractStatus,
      recordStatus: profile.recordStatus,
      confidenceLevel: profile.confidenceLevel,
      lastVerified: profile.lastVerified,
      simulationPrimaryPosition: profile.simulationPrimaryPosition,
      simulationPrimaryPositionStatus: profile.simulationPrimaryPositionStatus,
      simulationAgeProfile: profile.simulationAgeProfile,
      simulationDateOfBirth: profile.simulationDateOfBirth,
      simulationDateOfBirthStatus: profile.simulationDateOfBirthStatus,
      simulationHeightCm: profile.simulationHeightCm,
      simulationHeightStatus: profile.simulationHeightStatus,
      simulationPreferredFoot: profile.simulationPreferredFoot,
      simulationPreferredFootStatus: profile.simulationPreferredFootStatus,
      currentAbility: profile.currentAbility,
      potentialAbility: profile.potentialAbility,
      reputation: profile.reputation,
      hiddenTraits: profile.hiddenTraits,
      evidence: profile.evidence,
    });
    persistImport(imports, "playerFactualProfile", id, profile, profile.provenance, importedAt);
  }

  for (const plan of dataset.trainingPlans) {
    const id = maps.trainingPlans.get(plan.key)!;
    world.insertTrainingPlan({
      id,
      teamId: maps.teams.get(plan.teamKey)!,
      name: plan.name,
      effectiveFrom: plan.effectiveFrom,
      effectiveTo: plan.effectiveTo,
      intensity: plan.intensity,
      sessions: plan.sessions.map((session) => ({
        day: session.day,
        slot: session.slot,
        category: session.category,
        intensity: session.intensity,
        targetGroup: session.targetGroup,
        coachAssignmentId: mapFact(session.coachAssignmentKey, maps.staffAppointments),
      })),
      source: plan.source,
    });
    persistImport(imports, "trainingPlan", id, plan, plan.provenance, importedAt);
  }

  for (const plan of dataset.individualDevelopmentPlans) {
    const id = maps.individualDevelopmentPlans.get(plan.key)!;
    world.insertIndividualDevelopmentPlan({
      id,
      playerId: maps.persons.get(plan.playerKey)!,
      focusType: plan.focusType,
      targetPosition: plan.targetPosition,
      targetRole: plan.targetRole,
      targetAttributeGroup: plan.targetAttributeGroup,
      intensity: plan.intensity,
      startDate: plan.startDate,
      endDate: plan.endDate,
      status: plan.status,
    });
    persistImport(imports, "individualDevelopmentPlan", id, plan, plan.provenance, importedAt);
  }

  for (const state of dataset.playerDevelopmentStates) {
    const id = maps.playerDevelopmentStates.get(state.key)!;
    players.upsertDevelopmentState({
      id,
      playerId: maps.persons.get(state.playerKey)!,
      developmentPhase: state.developmentPhase,
      trainingLoad: state.trainingLoad,
      fatigue: state.fatigue,
      matchSharpness: state.matchSharpness,
      fitness: state.fitness,
      recovery: state.recovery,
      developmentMomentum: state.developmentMomentum,
      positionFamiliarity: state.positionFamiliarity,
      roleFamiliarity: state.roleFamiliarity,
      lastTrainingDate: state.lastTrainingDate,
      lastDevelopmentUpdate: state.lastDevelopmentUpdate,
    });
    persistImport(imports, "playerDevelopmentState", id, state, state.provenance, importedAt);
  }

  for (const potential of dataset.playerPotentials) {
    const id = maps.playerPotentials.get(potential.key)!;
    players.insertPotential({
      id,
      playerId: maps.persons.get(potential.playerKey)!,
      potentialCeiling: potential.potentialCeiling,
      developmentRate: potential.developmentRate,
      volatility: potential.volatility,
      professionalism: potential.professionalism,
      status: potential.status,
    });
    persistImport(imports, "playerPotential", id, potential, potential.provenance, importedAt);
  }

  for (const snapshot of dataset.playerPlayingTimeSnapshots) {
    const id = maps.playerPlayingTimeSnapshots.get(snapshot.key)!;
    players.insertPlayingTimeSnapshot({
      id,
      playerId: maps.persons.get(snapshot.playerKey)!,
      competitionSeasonId: mapFact(snapshot.competitionSeasonKey, maps.competitionSeasons),
      minutesLast30Days: snapshot.minutesLast30Days,
      minutesSeason: snapshot.minutesSeason,
      startsSeason: snapshot.startsSeason,
      subAppearances: snapshot.subAppearances,
      updatedOn: snapshot.updatedOn,
    });
    persistImport(
      imports,
      "playerPlayingTimeSnapshot",
      id,
      snapshot,
      snapshot.provenance,
      importedAt,
    );
  }

  for (const multiplier of dataset.competitionDevelopmentMultipliers) {
    const id = maps.competitionDevelopmentMultipliers.get(multiplier.key)!;
    world.insertCompetitionDevelopmentMultiplier({
      id,
      competitionId: maps.competitions.get(multiplier.competitionKey)!,
      multiplier: multiplier.multiplier,
      status: multiplier.status,
    });
    persistImport(
      imports,
      "competitionDevelopmentMultiplier",
      id,
      multiplier,
      multiplier.provenance,
      importedAt,
    );
  }

  for (const profile of dataset.staffSimulationProfiles) {
    const id = maps.staffSimulationProfiles.get(profile.key)!;
    world.insertStaffSimulationProfile({
      id,
      personId: maps.persons.get(profile.personKey)!,
      coachingTechnical: profile.coachingTechnical,
      coachingTactical: profile.coachingTactical,
      coachingPhysical: profile.coachingPhysical,
      coachingMental: profile.coachingMental,
      goalkeeping: profile.goalkeeping,
      youthDevelopment: profile.youthDevelopment,
      manManagement: profile.manManagement,
      status: profile.status,
    });
    persistImport(imports, "staffSimulationProfile", id, profile, profile.provenance, importedAt);
  }

  for (const profile of dataset.trainingFacilityProfiles) {
    const id = maps.trainingFacilityProfiles.get(profile.key)!;
    world.insertTrainingFacilityProfile({
      id,
      clubId: mapFact(profile.clubKey, maps.clubs),
      academyId: mapFact(profile.academyKey, maps.academies),
      trainingFacilityQuality: valueOf(profile.trainingFacilityQuality),
      youthFacilityQuality: valueOf(profile.youthFacilityQuality),
      medicalFacilityQuality: valueOf(profile.medicalFacilityQuality),
      status: profile.status,
    });
    persistImport(imports, "trainingFacilityProfile", id, profile, profile.provenance, importedAt);
  }

  for (const event of dataset.trainingHistoryEvents) {
    const id = maps.trainingHistoryEvents.get(event.key)!;
    players.insertTrainingHistoryEvent({
      id,
      playerId: mapFact(event.playerKey, maps.persons),
      teamId: mapFact(event.teamKey, maps.teams),
      eventType: event.eventType,
      occurredOn: event.occurredOn,
      data: event.data,
    });
    persistImport(imports, "trainingHistoryEvent", id, event, event.provenance, importedAt);
  }
};

const buildEntityMaps = (dataset: CountryWorldDataset): EntityMaps => ({
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
  staffProfiles: mapKeys("staff-profile", dataset.staffProfiles),
  staffAppointments: mapKeys("staff-appointment", dataset.staffAppointments),
  staffVacancies: mapKeys("staff-vacancy", dataset.staffVacancies),
  staffLicences: mapKeys("staff-licence", dataset.staffLicences),
  refereeProfiles: mapKeys("referee-profile", dataset.refereeProfiles),
  staffHistoryEvents: mapKeys("staff-history-event", dataset.staffHistoryEvents),
  playerAttributes: mapKeys("player-attribute", dataset.playerAttributes),
  playerFactualProfiles: mapKeys("player-factual-profile", dataset.playerFactualProfiles),
  trainingPlans: mapKeys("training-plan", dataset.trainingPlans),
  individualDevelopmentPlans: mapKeys(
    "individual-development-plan",
    dataset.individualDevelopmentPlans,
  ),
  playerDevelopmentStates: mapKeys("player-development-state", dataset.playerDevelopmentStates),
  playerPotentials: mapKeys("player-potential", dataset.playerPotentials),
  playerPlayingTimeSnapshots: mapKeys(
    "player-playing-time-snapshot",
    dataset.playerPlayingTimeSnapshots,
  ),
  competitionDevelopmentMultipliers: mapKeys(
    "competition-development-multiplier",
    dataset.competitionDevelopmentMultipliers,
  ),
  staffSimulationProfiles: mapKeys("staff-simulation-profile", dataset.staffSimulationProfiles),
  trainingFacilityProfiles: mapKeys("training-facility-profile", dataset.trainingFacilityProfiles),
  trainingHistoryEvents: mapKeys("training-history-event", dataset.trainingHistoryEvents),
});

const orderLocationsForImport = (
  locations: CountryWorldDataset["locations"],
): CountryWorldDataset["locations"] => {
  const pending = new Map(locations.map((location) => [location.key, location]));
  const ordered: CountryWorldDataset["locations"] = [];
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

const mapKeyArray = (keys: readonly string[], map: ReadonlyMap<string, EntityId>): EntityId[] =>
  keys.map((key) => map.get(key)!);

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
