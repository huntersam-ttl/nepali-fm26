import type {
  CareerCharacter,
  Academy,
  ClubAlias,
  ClubMembership,
  ClubRelationship,
  Club,
  CompetitionMovement,
  CompetitionDevelopmentMultiplier,
  CompetitionRelationship,
  Country,
  Federation,
  FinanceAccount,
  FinancialTransaction,
  HistoricalEvent,
  IndividualDevelopmentPlan,
  Location,
  LocationTravelContext,
  Person,
  PersonRole,
  SaveMetadata,
  ScheduledEvent,
  StaffAppointment,
  StaffHistoryEvent,
  StaffLicence,
  StaffProfile,
  StaffSimulationProfile,
  StaffVacancy,
  Team,
  TeamPersonAssignment,
  Venue,
  Competition,
  CompetitionSeason,
  CompetitionRuleSet,
  CompetitionWinner,
  DataProvenance,
  FixtureRecord,
  InjuryRecord,
  InboxItem,
  LeagueStanding,
  ManagerContract,
  ManagerProfile,
  Match,
  MatchEvent,
  PlayerAttributeSet,
  PlayerDevelopmentState,
  RefereeProfile,
  PlayerPotential,
  PlayerPlayingTimeSnapshot,
  PlayerSeasonStat,
  SuspensionRecord,
  TacticalSetup,
  TeamSeasonStat,
  TrainingFacilityProfile,
  TrainingHistoryEvent,
  TrainingPlan,
  VenueRelationship,
} from "@nepal-football-sim/shared-types";
import type { EntityId } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const json = {
  parse: <T>(value: string | null | undefined, fallback: T): T =>
    value === null || value === undefined ? fallback : (JSON.parse(value) as T),
  stringify: (value: unknown): string => JSON.stringify(value),
};

const boolToDb = (value: boolean | undefined): number | null =>
  value === undefined ? null : Number(value);

export class SaveRepository {
  constructor(private readonly db: GameDatabase) {}

  upsert(save: SaveMetadata): void {
    this.db
      .prepare(
        `INSERT INTO saves
        (id, name, world_date, database_version, game_version, random_seed, created_at, last_saved_at, player_character_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          world_date = excluded.world_date,
          database_version = excluded.database_version,
          game_version = excluded.game_version,
          random_seed = excluded.random_seed,
          last_saved_at = excluded.last_saved_at,
          player_character_id = excluded.player_character_id`,
      )
      .run(
        save.id,
        save.name,
        save.worldDate,
        save.databaseVersion,
        save.gameVersion,
        save.randomSeed,
        save.createdAt,
        save.lastSavedAt,
        save.playerCharacterId ?? null,
      );
  }

  get(id: EntityId): SaveMetadata | undefined {
    const row = this.db.prepare("SELECT * FROM saves WHERE id = ?").get(id) as any;
    return row
      ? {
          id: row.id,
          name: row.name,
          worldDate: row.world_date,
          databaseVersion: row.database_version,
          gameVersion: row.game_version,
          randomSeed: row.random_seed,
          createdAt: row.created_at,
          lastSavedAt: row.last_saved_at,
          playerCharacterId: row.player_character_id ?? undefined,
        }
      : undefined;
  }

  first(): SaveMetadata | undefined {
    const row = this.db.prepare("SELECT id FROM saves ORDER BY created_at LIMIT 1").get() as any;
    return row ? this.get(row.id) : undefined;
  }
}

export class WorldRepository {
  constructor(private readonly db: GameDatabase) {}

  insertCountry(country: Country): void {
    this.db
      .prepare("INSERT INTO countries (id, name, iso_code) VALUES (?, ?, ?)")
      .run(country.id, country.name, country.isoCode);
  }

  insertLocation(location: Location): void {
    this.db
      .prepare(
        `INSERT INTO locations
        (id, canonical_external_id, country_id, name, kind, parent_location_id, latitude, longitude,
          altitude_meters, climate_profile_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        location.id,
        location.canonicalExternalId ?? null,
        location.countryId,
        location.name,
        location.kind,
        location.parentLocationId ?? null,
        location.latitude ?? null,
        location.longitude ?? null,
        location.altitudeMeters ?? null,
        location.climateProfile ? json.stringify(location.climateProfile) : null,
      );
  }

  insertVenue(venue: Venue): void {
    this.db
      .prepare(
        `INSERT INTO venues
        (id, canonical_external_id, country_id, location_id, province_id, district_id, city_id, name,
          official_name, short_name, aliases_json, venue_type, capacity, pitch_type, latitude,
          longitude, altitude_meters, surface_type, pitch_quality, year_opened,
          year_last_renovated, floodlights, running_track, covered_stands, owner_entity,
          operator_entity, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        venue.id,
        venue.canonicalExternalId ?? null,
        venue.countryId,
        venue.locationId ?? null,
        venue.provinceId ?? null,
        venue.districtId ?? null,
        venue.cityId ?? null,
        venue.name,
        venue.officialName ?? null,
        venue.shortName ?? null,
        json.stringify(venue.aliases ?? []),
        venue.venueType ?? "UNKNOWN",
        venue.capacity ?? null,
        venue.surfaceType ?? "UNKNOWN",
        venue.latitude ?? null,
        venue.longitude ?? null,
        venue.altitudeMeters ?? null,
        venue.surfaceType ?? "UNKNOWN",
        venue.pitchQuality ?? "UNKNOWN",
        venue.yearOpened ?? null,
        venue.yearLastRenovated ?? null,
        boolToDb(venue.floodlights),
        boolToDb(venue.runningTrack),
        boolToDb(venue.coveredStands),
        venue.ownerEntity ?? null,
        venue.operatorEntity ?? null,
        venue.status ?? "UNKNOWN",
      );
  }

  insertFederation(federation: Federation): void {
    this.db
      .prepare("INSERT INTO federations (id, country_id, name, founded_year) VALUES (?, ?, ?, ?)")
      .run(federation.id, federation.countryId, federation.name, federation.foundedYear ?? null);
  }

  insertClub(club: Club): void {
    this.db
      .prepare(
        `INSERT INTO clubs
        (id, name, official_name, short_name, nepali_name, canonical_external_id, country_id, location_id,
          ownership_type, organisation_type, parent_organisation, founded_year)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        club.id,
        club.name,
        club.officialName ?? null,
        club.shortName ?? null,
        club.nepaliName ?? null,
        club.canonicalExternalId ?? null,
        club.countryId,
        club.locationId ?? null,
        club.ownershipType,
        club.organisationType ?? null,
        club.parentOrganisation ?? null,
        club.foundedYear ?? null,
      );
  }

  insertClubAlias(alias: ClubAlias): void {
    this.db
      .prepare(
        "INSERT INTO club_aliases (id, club_id, alias, alias_type) VALUES (?, ?, ?, ?) ON CONFLICT(club_id, alias) DO NOTHING",
      )
      .run(alias.id, alias.clubId, alias.alias, alias.aliasType);
  }

  insertClubRelationship(relationship: ClubRelationship): void {
    this.db
      .prepare(
        `INSERT INTO club_relationships
        (id, parent_club_id, child_club_id, child_team_id, relationship_type)
        VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        relationship.id,
        relationship.parentClubId,
        relationship.childClubId ?? null,
        relationship.childTeamId ?? null,
        relationship.relationshipType,
      );
  }

  insertClubMembership(membership: ClubMembership): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO club_memberships
        (id, club_id, team_id, competition_id, competition_season_id, membership_type, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        membership.id,
        membership.clubId,
        membership.teamId ?? null,
        membership.competitionId,
        membership.competitionSeasonId ?? null,
        membership.membershipType,
        membership.status,
      );
  }

  clubMembershipsForCompetitionSeason(competitionSeasonId: EntityId): ClubMembership[] {
    return this.db
      .prepare(
        "SELECT * FROM club_memberships WHERE competition_season_id = ? ORDER BY club_id, team_id",
      )
      .all(competitionSeasonId)
      .map(mapClubMembership);
  }

  insertAcademy(academy: Academy): void {
    this.db
      .prepare(
        `INSERT INTO academies
        (id, name, canonical_external_id, country_id, location_id, parent_club_id, linked_club_id,
          federation_id, academy_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        academy.id,
        academy.name,
        academy.canonicalExternalId ?? null,
        academy.countryId,
        academy.locationId ?? null,
        academy.parentClubId ?? null,
        academy.linkedClubId ?? null,
        academy.federationId ?? null,
        academy.academyType,
      );
  }

  insertVenueRelationship(relationship: VenueRelationship): void {
    this.db
      .prepare(
        `INSERT INTO venue_relationships
        (id, venue_id, club_id, team_id, federation_id, academy_id, relationship_type,
          start_date, end_date, competition_season_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        relationship.id,
        relationship.venueId,
        relationship.clubId ?? null,
        relationship.teamId ?? null,
        relationship.federationId ?? null,
        relationship.academyId ?? null,
        relationship.relationshipType,
        relationship.startDate ?? null,
        relationship.endDate ?? null,
        relationship.competitionSeasonId ?? null,
        relationship.status,
      );
  }

  insertLocationTravelContext(context: LocationTravelContext): void {
    this.db
      .prepare(
        `INSERT INTO location_travel_contexts
        (id, from_location_id, to_location_id, road_distance_km, estimated_road_travel_hours,
          air_travel_available, nearest_airport_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        context.id,
        context.fromLocationId,
        context.toLocationId,
        context.roadDistanceKm ?? null,
        context.estimatedRoadTravelHours ?? null,
        boolToDb(context.airTravelAvailable),
        context.nearestAirportId ?? null,
      );
  }

  insertTeam(team: Team): void {
    this.db
      .prepare(
        "INSERT INTO teams (id, club_id, federation_id, name, canonical_external_id, level, gender) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        team.id,
        team.clubId ?? null,
        team.federationId ?? null,
        team.name,
        team.canonicalExternalId ?? null,
        team.level,
        team.gender,
      );
  }

  insertCompetition(competition: Competition): void {
    this.db
      .prepare(
        "INSERT INTO competitions (id, federation_id, name, scope, category) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        competition.id,
        competition.federationId ?? null,
        competition.name,
        competition.scope,
        competition.category ?? null,
      );
  }

  insertCompetitionSeason(season: CompetitionSeason): void {
    this.db
      .prepare(
        "INSERT INTO competition_seasons (id, competition_id, name, start_date, end_date) VALUES (?, ?, ?, ?, ?)",
      )
      .run(season.id, season.competitionId, season.name, season.startDate, season.endDate);
  }

  getCompetitionSeason(id: EntityId): CompetitionSeason | undefined {
    const row = this.db.prepare("SELECT * FROM competition_seasons WHERE id = ?").get(id) as any;
    return row
      ? {
          id: row.id,
          competitionId: row.competition_id,
          name: row.name,
          startDate: row.start_date,
          endDate: row.end_date,
        }
      : undefined;
  }

  teamsForCompetitionSeason(competitionSeasonId: EntityId): Team[] {
    return this.db
      .prepare(
        `SELECT DISTINCT t.*
        FROM club_memberships cm
        JOIN teams t ON t.id = cm.team_id OR (cm.team_id IS NULL AND t.club_id = cm.club_id)
        WHERE cm.competition_season_id = ? AND t.level = 'senior'
        ORDER BY t.name`,
      )
      .all(competitionSeasonId)
      .map((row: any) => ({
        id: row.id,
        clubId: row.club_id ?? undefined,
        federationId: row.federation_id ?? undefined,
        name: row.name,
        canonicalExternalId: row.canonical_external_id ?? undefined,
        level: row.level,
        gender: row.gender,
      }));
  }

  insertPerson(person: Person): void {
    this.db
      .prepare(
        `INSERT INTO persons
        (id, full_name, display_name, date_of_birth, nationality_country_id, second_nationality_country_id,
          gender_presentation, place_of_birth_location_id, hometown_location_id, languages_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        person.id,
        person.fullName,
        person.displayName ?? null,
        person.dateOfBirth ?? null,
        person.nationalityCountryId,
        person.secondNationalityCountryId ?? null,
        person.genderPresentation ?? null,
        person.placeOfBirthLocationId ?? null,
        person.hometownLocationId ?? null,
        json.stringify(person.languages),
      );
  }

  getPerson(id: EntityId): Person | undefined {
    const row = this.db.prepare("SELECT * FROM persons WHERE id = ?").get(id) as any;
    return row
      ? {
          id: row.id,
          fullName: row.full_name,
          displayName: row.display_name ?? undefined,
          dateOfBirth: row.date_of_birth ?? undefined,
          nationalityCountryId: row.nationality_country_id,
          secondNationalityCountryId: row.second_nationality_country_id ?? undefined,
          genderPresentation: row.gender_presentation ?? undefined,
          placeOfBirthLocationId: row.place_of_birth_location_id ?? undefined,
          hometownLocationId: row.hometown_location_id ?? undefined,
          languages: json.parse<string[]>(row.languages_json, []),
        }
      : undefined;
  }

  insertPersonRole(role: PersonRole): void {
    this.db
      .prepare(
        "INSERT INTO person_roles (id, person_id, role, active_from, active_to) VALUES (?, ?, ?, ?, ?)",
      )
      .run(role.id, role.personId, role.role, role.activeFrom, role.activeTo ?? null);
  }

  insertTeamPersonAssignment(assignment: TeamPersonAssignment): void {
    this.db
      .prepare(
        "INSERT INTO team_person_assignments (id, person_id, team_id, role, started_on, ended_on) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        assignment.id,
        assignment.personId,
        assignment.teamId,
        assignment.role,
        assignment.startedOn ?? null,
        assignment.endedOn ?? null,
      );
  }

  insertStaffProfile(profile: StaffProfile): void {
    this.db
      .prepare(
        `INSERT INTO staff_profiles
        (id, person_id, preferred_role, salary_expectation, reputation, country_knowledge_json,
          club_knowledge_json, availability, work_eligibility_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profile.id,
        profile.personId,
        profile.preferredRole ?? null,
        profile.salaryExpectation ?? null,
        profile.reputation ?? null,
        json.stringify(profile.countryKnowledge),
        json.stringify(profile.clubKnowledge),
        profile.availability ?? null,
        profile.workEligibilityStatus ?? null,
      );
  }

  insertStaffAppointment(appointment: StaffAppointment): void {
    this.db
      .prepare(
        `INSERT INTO staff_appointments
        (id, person_id, organisation_type, club_id, team_id, federation_id, academy_id,
          organisation_name, role, start_date, end_date, employment_status, contract_id,
          service_rank_title)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        appointment.id,
        appointment.personId,
        appointment.organisationType,
        appointment.clubId ?? null,
        appointment.teamId ?? null,
        appointment.federationId ?? null,
        appointment.academyId ?? null,
        appointment.organisationName ?? null,
        appointment.role,
        appointment.startDate ?? null,
        appointment.endDate ?? null,
        appointment.employmentStatus,
        appointment.contractId ?? null,
        appointment.serviceRankTitle ?? null,
      );
  }

  insertStaffVacancy(vacancy: StaffVacancy): void {
    this.db
      .prepare(
        `INSERT INTO staff_vacancies
        (id, organisation_type, club_id, team_id, federation_id, academy_id, organisation_name,
          role, required, assigned_person_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        vacancy.id,
        vacancy.organisationType,
        vacancy.clubId ?? null,
        vacancy.teamId ?? null,
        vacancy.federationId ?? null,
        vacancy.academyId ?? null,
        vacancy.organisationName ?? null,
        vacancy.role,
        Number(vacancy.required),
        vacancy.assignedPersonId ?? null,
        vacancy.status,
      );
  }

  insertStaffLicence(licence: StaffLicence): void {
    this.db
      .prepare(
        `INSERT INTO staff_licences
        (id, person_id, licence_type, issuer, issue_date, expiry_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        licence.id,
        licence.personId,
        licence.licenceType,
        licence.issuer,
        licence.issueDate ?? null,
        licence.expiryDate ?? null,
        licence.status,
      );
  }

  insertRefereeProfile(profile: RefereeProfile): void {
    this.db
      .prepare(
        `INSERT INTO referee_profiles
        (id, person_id, referee_level, fifa_listed, fifa_listed_since, primary_role,
          competitions_eligible_json, experience_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profile.id,
        profile.personId,
        profile.refereeLevel ?? null,
        boolToDb(profile.fifaListed),
        profile.fifaListedSince ?? null,
        profile.primaryRole,
        json.stringify(profile.competitionsEligible),
        profile.experienceLevel ?? null,
      );
  }

  insertStaffHistoryEvent(event: StaffHistoryEvent): void {
    this.db
      .prepare(
        `INSERT INTO staff_history_events
        (id, person_id, event_type, occurred_on, staff_appointment_id, club_id, team_id,
          federation_id, academy_id, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.personId,
        event.eventType,
        event.occurredOn,
        event.appointmentId ?? null,
        event.clubId ?? null,
        event.teamId ?? null,
        event.federationId ?? null,
        event.academyId ?? null,
        event.description ?? null,
      );
  }

  insertTrainingPlan(plan: TrainingPlan): void {
    this.db
      .prepare(
        `INSERT INTO training_plans
        (id, team_id, name, effective_from, effective_to, intensity, sessions_json, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        plan.id,
        plan.teamId,
        plan.name,
        plan.effectiveFrom,
        plan.effectiveTo ?? null,
        plan.intensity,
        json.stringify(plan.sessions),
        plan.source,
      );
  }

  insertTrainingFacilityProfile(profile: TrainingFacilityProfile): void {
    this.db
      .prepare(
        `INSERT INTO training_facility_profiles
        (id, club_id, academy_id, training_facility_quality, youth_facility_quality,
          medical_facility_quality, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profile.id,
        profile.clubId ?? null,
        profile.academyId ?? null,
        profile.trainingFacilityQuality ?? null,
        profile.youthFacilityQuality ?? null,
        profile.medicalFacilityQuality ?? null,
        profile.status,
      );
  }

  insertIndividualDevelopmentPlan(plan: IndividualDevelopmentPlan): void {
    this.db
      .prepare(
        `INSERT INTO individual_development_plans
        (id, player_id, focus_type, target_position, target_role, target_attribute_group,
          intensity, start_date, end_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        plan.id,
        plan.playerId,
        plan.focusType,
        plan.targetPosition ?? null,
        plan.targetRole ?? null,
        plan.targetAttributeGroup ?? null,
        plan.intensity,
        plan.startDate,
        plan.endDate ?? null,
        plan.status,
      );
  }

  insertCompetitionDevelopmentMultiplier(multiplier: CompetitionDevelopmentMultiplier): void {
    this.db
      .prepare(
        `INSERT INTO competition_development_multipliers
        (id, competition_id, multiplier, status)
        VALUES (?, ?, ?, ?)`,
      )
      .run(multiplier.id, multiplier.competitionId, multiplier.multiplier, multiplier.status);
  }

  insertStaffSimulationProfile(profile: StaffSimulationProfile): void {
    this.db
      .prepare(
        `INSERT INTO staff_simulation_profiles
        (id, person_id, coaching_technical, coaching_tactical, coaching_physical,
          coaching_mental, goalkeeping, youth_development, man_management, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profile.id,
        profile.personId,
        profile.coachingTechnical,
        profile.coachingTactical,
        profile.coachingPhysical,
        profile.coachingMental,
        profile.goalkeeping,
        profile.youthDevelopment,
        profile.manManagement,
        profile.status,
      );
  }

  getTeamPersonAssignments(teamId: EntityId): TeamPersonAssignment[] {
    return this.db
      .prepare("SELECT * FROM team_person_assignments WHERE team_id = ? ORDER BY id")
      .all(teamId)
      .map((row: any) => ({
        id: row.id,
        personId: row.person_id,
        teamId: row.team_id,
        role: row.role,
        startedOn: row.started_on ?? undefined,
        endedOn: row.ended_on ?? undefined,
      }));
  }

  getPersonRoles(personId: EntityId): PersonRole[] {
    return this.db
      .prepare("SELECT * FROM person_roles WHERE person_id = ? ORDER BY active_from")
      .all(personId)
      .map((row: any) => ({
        id: row.id,
        personId: row.person_id,
        role: row.role,
        activeFrom: row.active_from,
        activeTo: row.active_to ?? undefined,
      }));
  }

  insertCareerCharacter(character: CareerCharacter): void {
    this.db
      .prepare(
        `INSERT INTO career_characters
        (id, person_id, preferred_display_name, starting_age, football_background, education, playing_experience,
          coaching_experience, coaching_licences_json, business_background, starting_reputation_profile)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        character.id,
        character.personId,
        character.preferredDisplayName ?? null,
        character.startingAge ?? null,
        character.footballBackground ?? null,
        character.education ?? null,
        character.playingExperience ?? null,
        character.coachingExperience ?? null,
        json.stringify(character.coachingLicences),
        character.businessBackground ?? null,
        character.startingReputationProfile ?? null,
      );
  }

  getCareerCharacter(id: EntityId): CareerCharacter | undefined {
    const row = this.db.prepare("SELECT * FROM career_characters WHERE id = ?").get(id) as any;
    return row
      ? {
          id: row.id,
          personId: row.person_id,
          preferredDisplayName: row.preferred_display_name ?? undefined,
          startingAge: row.starting_age ?? undefined,
          footballBackground: row.football_background ?? undefined,
          education: row.education ?? undefined,
          playingExperience: row.playing_experience ?? undefined,
          coachingExperience: row.coaching_experience ?? undefined,
          coachingLicences: json.parse(row.coaching_licences_json, []),
          businessBackground: row.business_background ?? undefined,
          startingReputationProfile: row.starting_reputation_profile ?? undefined,
        }
      : undefined;
  }

  inspectWorld(): WorldInspection {
    const scalar = (table: string): number =>
      (this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

    return {
      countries: scalar("countries"),
      locations: scalar("locations"),
      venues: scalar("venues"),
      federations: scalar("federations"),
      competitions: scalar("competitions"),
      competitionSeasons: scalar("competition_seasons"),
      competitionRelationships: scalar("competition_relationships"),
      competitionMovements: scalar("competition_movements"),
      clubs: scalar("clubs"),
      clubAliases: scalar("club_aliases"),
      clubRelationships: scalar("club_relationships"),
      clubMemberships: scalar("club_memberships"),
      teams: scalar("teams"),
      academies: scalar("academies"),
      venueRelationships: scalar("venue_relationships"),
      locationTravelContexts: scalar("location_travel_contexts"),
      persons: scalar("persons"),
      personRoles: scalar("person_roles"),
      teamPersonAssignments: scalar("team_person_assignments"),
      staffProfiles: scalar("staff_profiles"),
      staffAppointments: scalar("staff_appointments"),
      staffVacancies: scalar("staff_vacancies"),
      staffLicences: scalar("staff_licences"),
      refereeProfiles: scalar("referee_profiles"),
      staffHistoryEvents: scalar("staff_history_events"),
      playerAttributes: scalar("player_attributes"),
      trainingPlans: scalar("training_plans"),
      individualDevelopmentPlans: scalar("individual_development_plans"),
      playerDevelopmentStates: scalar("player_development_states"),
      playerPotentials: scalar("player_potentials"),
      playerPlayingTimeSnapshots: scalar("player_playing_time_snapshots"),
      competitionDevelopmentMultipliers: scalar("competition_development_multipliers"),
      staffSimulationProfiles: scalar("staff_simulation_profiles"),
      trainingFacilityProfiles: scalar("training_facility_profiles"),
      trainingHistoryEvents: scalar("training_history_events"),
      entityProvenance: scalar("entity_provenance"),
    };
  }
}

export class ManagerRepository {
  constructor(private readonly db: GameDatabase) {}

  insertProfile(profile: ManagerProfile): void {
    this.db
      .prepare(
        `INSERT INTO manager_profiles
        (id, person_id, attributes_json, preferred_style, reputation_profile, created_on)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          attributes_json = excluded.attributes_json,
          preferred_style = excluded.preferred_style,
          reputation_profile = excluded.reputation_profile`,
      )
      .run(
        profile.id,
        profile.personId,
        json.stringify(profile.attributes),
        profile.preferredStyle ?? null,
        profile.reputationProfile,
        profile.createdOn,
      );
  }

  getProfile(id: EntityId): ManagerProfile | undefined {
    const row = this.db.prepare("SELECT * FROM manager_profiles WHERE id = ?").get(id) as any;
    return row ? mapManagerProfile(row) : undefined;
  }

  getProfileByPerson(personId: EntityId): ManagerProfile | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM manager_profiles WHERE person_id = ? ORDER BY created_on DESC LIMIT 1",
      )
      .get(personId) as any;
    return row ? mapManagerProfile(row) : undefined;
  }

  insertContract(contract: ManagerContract): void {
    this.db
      .prepare(
        `INSERT INTO manager_contracts
        (id, manager_profile_id, person_id, team_id, club_id, job_title, contract_start, contract_end,
          salary_amount_minor, currency, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          team_id = excluded.team_id,
          club_id = excluded.club_id,
          job_title = excluded.job_title,
          contract_end = excluded.contract_end,
          salary_amount_minor = excluded.salary_amount_minor,
          currency = excluded.currency,
          status = excluded.status`,
      )
      .run(
        contract.id,
        contract.managerProfileId,
        contract.personId,
        contract.teamId ?? null,
        contract.clubId ?? null,
        contract.jobTitle,
        contract.contractStart,
        contract.contractEnd ?? null,
        contract.salaryAmountMinor,
        contract.currency,
        contract.status,
      );
  }

  activeContract(managerProfileId: EntityId): ManagerContract | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM manager_contracts WHERE manager_profile_id = ? AND status = 'ACTIVE' ORDER BY contract_start DESC LIMIT 1",
      )
      .get(managerProfileId) as any;
    return row ? mapManagerContract(row) : undefined;
  }

  insertTacticalSetup(setup: TacticalSetup): void {
    this.db
      .prepare(
        `INSERT INTO tactical_setups
        (id, manager_profile_id, team_id, name, formation_json, style, instructions_json, familiarity_json,
          assignments_json, bench_json, set_pieces_json, created_on, updated_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          formation_json = excluded.formation_json,
          style = excluded.style,
          instructions_json = excluded.instructions_json,
          familiarity_json = excluded.familiarity_json,
          assignments_json = excluded.assignments_json,
          bench_json = excluded.bench_json,
          set_pieces_json = excluded.set_pieces_json,
          updated_on = excluded.updated_on`,
      )
      .run(
        setup.id,
        setup.managerProfileId ?? null,
        setup.teamId,
        setup.name,
        json.stringify(setup.formation),
        setup.style,
        json.stringify(setup.instructions),
        json.stringify(setup.familiarity),
        json.stringify(setup.assignments),
        json.stringify(setup.bench),
        json.stringify(setup.setPieces),
        setup.createdOn,
        setup.updatedOn,
      );
  }

  tacticalSetups(teamId: EntityId): TacticalSetup[] {
    return this.db
      .prepare("SELECT * FROM tactical_setups WHERE team_id = ? ORDER BY updated_on DESC")
      .all(teamId)
      .map(mapTacticalSetup);
  }

  insertInboxItem(item: InboxItem): void {
    this.db
      .prepare(
        `INSERT INTO inbox_items
        (id, created_on, type, title, body, related_entity_json, read)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET read = excluded.read`,
      )
      .run(
        item.id,
        item.createdOn,
        item.type,
        item.title,
        item.body,
        item.relatedEntity ? json.stringify(item.relatedEntity) : null,
        item.read ? 1 : 0,
      );
  }

  inboxItems(): InboxItem[] {
    return this.db
      .prepare("SELECT * FROM inbox_items ORDER BY created_on DESC, id DESC")
      .all()
      .map((row: any) => ({
        id: row.id,
        createdOn: row.created_on,
        type: row.type,
        title: row.title,
        body: row.body,
        relatedEntity: json.parse(row.related_entity_json, undefined),
        read: Boolean(row.read),
      }));
  }
}

export class CompetitionRepository {
  constructor(private readonly db: GameDatabase) {}

  insertRuleSet(ruleSet: CompetitionRuleSet): void {
    this.db
      .prepare(
        `INSERT INTO competition_rules
        (id, competition_season_id, competition_type, points_for_win, points_for_draw, points_for_loss,
          tiebreakers_json, number_of_rounds, home_away_structure, fixture_count, season_start_date,
          season_end_date, round_spacing_days, promotion_slots, relegation_slots,
          continental_qualification_slots, promotion_enabled, relegation_enabled, special_rules_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          competition_type = excluded.competition_type,
          points_for_win = excluded.points_for_win,
          points_for_draw = excluded.points_for_draw,
          points_for_loss = excluded.points_for_loss,
          tiebreakers_json = excluded.tiebreakers_json,
          number_of_rounds = excluded.number_of_rounds,
          home_away_structure = excluded.home_away_structure,
          fixture_count = excluded.fixture_count,
          season_start_date = excluded.season_start_date,
          season_end_date = excluded.season_end_date,
          round_spacing_days = excluded.round_spacing_days,
          promotion_slots = excluded.promotion_slots,
          relegation_slots = excluded.relegation_slots,
          continental_qualification_slots = excluded.continental_qualification_slots,
          promotion_enabled = excluded.promotion_enabled,
          relegation_enabled = excluded.relegation_enabled,
          special_rules_json = excluded.special_rules_json`,
      )
      .run(
        ruleSet.id,
        ruleSet.competitionSeasonId,
        ruleSet.competitionType,
        ruleSet.pointsForWin,
        ruleSet.pointsForDraw,
        ruleSet.pointsForLoss,
        json.stringify(ruleSet.tiebreakers),
        ruleSet.numberOfRounds,
        ruleSet.homeAwayStructure,
        ruleSet.fixtureCount ?? null,
        ruleSet.seasonStartDate,
        ruleSet.seasonEndDate,
        ruleSet.roundSpacingDays,
        ruleSet.promotionSlots,
        ruleSet.relegationSlots,
        ruleSet.continentalQualificationSlots,
        ruleSet.promotionEnabled === false ? 0 : 1,
        ruleSet.relegationEnabled === false ? 0 : 1,
        json.stringify(ruleSet.specialRules ?? {}),
      );
  }

  getRuleSet(competitionSeasonId: EntityId): CompetitionRuleSet | undefined {
    const row = this.db
      .prepare("SELECT * FROM competition_rules WHERE competition_season_id = ? LIMIT 1")
      .get(competitionSeasonId) as any;
    return row
      ? {
          id: row.id,
          competitionSeasonId: row.competition_season_id,
          competitionType: row.competition_type,
          pointsForWin: row.points_for_win,
          pointsForDraw: row.points_for_draw,
          pointsForLoss: row.points_for_loss,
          tiebreakers: json.parse(row.tiebreakers_json, []),
          numberOfRounds: row.number_of_rounds,
          homeAwayStructure: row.home_away_structure,
          fixtureCount: row.fixture_count ?? undefined,
          seasonStartDate: row.season_start_date,
          seasonEndDate: row.season_end_date,
          roundSpacingDays: row.round_spacing_days,
          promotionSlots: row.promotion_slots,
          relegationSlots: row.relegation_slots,
          continentalQualificationSlots: row.continental_qualification_slots,
          promotionEnabled: Boolean(row.promotion_enabled),
          relegationEnabled: Boolean(row.relegation_enabled),
          specialRules: json.parse(row.special_rules_json, {}),
        }
      : undefined;
  }

  insertRelationship(relationship: CompetitionRelationship): void {
    this.db
      .prepare(
        `INSERT INTO competition_relationships
        (id, from_competition_id, to_competition_id, movement_type, number_of_teams,
          selection_method, effective_season_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          from_competition_id = excluded.from_competition_id,
          to_competition_id = excluded.to_competition_id,
          movement_type = excluded.movement_type,
          number_of_teams = excluded.number_of_teams,
          selection_method = excluded.selection_method,
          effective_season_id = excluded.effective_season_id`,
      )
      .run(
        relationship.id,
        relationship.fromCompetitionId,
        relationship.toCompetitionId,
        relationship.movementType,
        relationship.numberOfTeams,
        relationship.selectionMethod,
        relationship.effectiveSeasonId ?? null,
      );
  }

  relationshipsFrom(
    competitionId: EntityId,
    movementType?: CompetitionRelationship["movementType"],
  ): CompetitionRelationship[] {
    const rows =
      movementType === undefined
        ? this.db
            .prepare("SELECT * FROM competition_relationships WHERE from_competition_id = ?")
            .all(competitionId)
        : this.db
            .prepare(
              "SELECT * FROM competition_relationships WHERE from_competition_id = ? AND movement_type = ?",
            )
            .all(competitionId, movementType);
    return rows.map(mapCompetitionRelationship);
  }

  insertMovement(movement: CompetitionMovement): void {
    this.db
      .prepare(
        `INSERT INTO competition_movements
        (id, club_id, team_id, from_competition_id, to_competition_id, from_competition_season_id,
          to_competition_season_id, movement_type, status, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          reason = excluded.reason`,
      )
      .run(
        movement.id,
        movement.clubId,
        movement.teamId ?? null,
        movement.fromCompetitionId,
        movement.toCompetitionId,
        movement.fromCompetitionSeasonId,
        movement.toCompetitionSeasonId,
        movement.movementType,
        movement.status,
        movement.reason ?? null,
      );
  }

  movements(fromCompetitionSeasonId: EntityId): CompetitionMovement[] {
    return this.db
      .prepare("SELECT * FROM competition_movements WHERE from_competition_season_id = ?")
      .all(fromCompetitionSeasonId)
      .map(mapCompetitionMovement);
  }

  insertFixture(fixture: FixtureRecord): void {
    this.db
      .prepare(
        `INSERT INTO fixtures
        (id, competition_season_id, home_team_id, away_team_id, scheduled_date, status, round, venue_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        fixture.id,
        fixture.competitionSeasonId ?? null,
        fixture.homeTeamId,
        fixture.awayTeamId,
        fixture.scheduledDate,
        fixture.status,
        fixture.round,
        fixture.venueId ?? null,
      );
  }

  fixtures(competitionSeasonId: EntityId): FixtureRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM fixtures WHERE competition_season_id = ? ORDER BY scheduled_date, round, id",
      )
      .all(competitionSeasonId)
      .map((row: any) => ({
        id: row.id,
        competitionSeasonId: row.competition_season_id ?? undefined,
        homeTeamId: row.home_team_id,
        awayTeamId: row.away_team_id,
        scheduledDate: row.scheduled_date,
        status: row.status,
        round: row.round,
        venueId: row.venue_id ?? undefined,
      }));
  }

  markFixturePlayed(fixtureId: EntityId): void {
    this.db.prepare("UPDATE fixtures SET status = 'played' WHERE id = ?").run(fixtureId);
  }

  insertMatch(match: Match): void {
    this.db
      .prepare(
        "INSERT INTO matches (id, fixture_id, played_date, home_goals, away_goals) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        match.id,
        match.fixtureId,
        match.playedDate ?? null,
        match.homeGoals ?? null,
        match.awayGoals ?? null,
      );
  }

  insertMatchEvent(event: MatchEvent): void {
    this.db
      .prepare(
        `INSERT INTO match_events
        (id, match_id, minute, stoppage_time, type, person_id, team_id, primary_person_id, secondary_person_id, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.matchId,
        event.minute ?? null,
        event.stoppageTime ?? null,
        event.type,
        event.personId ?? event.primaryPersonId ?? null,
        event.teamId ?? null,
        event.primaryPersonId ?? null,
        event.secondaryPersonId ?? null,
        event.data ? json.stringify(event.data) : null,
      );
  }

  upsertStanding(standing: LeagueStanding): void {
    this.db
      .prepare(
        `INSERT INTO league_standings
        (competition_season_id, team_id, played, won, drawn, lost, goals_for, goals_against, goal_difference, points)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(competition_season_id, team_id) DO UPDATE SET
          played = excluded.played,
          won = excluded.won,
          drawn = excluded.drawn,
          lost = excluded.lost,
          goals_for = excluded.goals_for,
          goals_against = excluded.goals_against,
          goal_difference = excluded.goal_difference,
          points = excluded.points`,
      )
      .run(
        standing.competitionSeasonId,
        standing.teamId,
        standing.played,
        standing.won,
        standing.drawn,
        standing.lost,
        standing.goalsFor,
        standing.goalsAgainst,
        standing.goalDifference,
        standing.points,
      );
  }

  standings(competitionSeasonId: EntityId): LeagueStanding[] {
    return this.db
      .prepare(
        "SELECT * FROM league_standings WHERE competition_season_id = ? ORDER BY points DESC",
      )
      .all(competitionSeasonId)
      .map((row: any) => ({
        competitionSeasonId: row.competition_season_id,
        teamId: row.team_id,
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        goalsFor: row.goals_for,
        goalsAgainst: row.goals_against,
        goalDifference: row.goal_difference,
        points: row.points,
      }));
  }

  upsertPlayerSeasonStat(stat: PlayerSeasonStat): void {
    this.db
      .prepare(
        `INSERT INTO player_season_stats
        (competition_season_id, person_id, team_id, appearances, starts, minutes, goals, assists,
          yellow_cards, red_cards, average_rating, clean_sheets)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(competition_season_id, person_id, team_id) DO UPDATE SET
          appearances = excluded.appearances,
          starts = excluded.starts,
          minutes = excluded.minutes,
          goals = excluded.goals,
          assists = excluded.assists,
          yellow_cards = excluded.yellow_cards,
          red_cards = excluded.red_cards,
          average_rating = excluded.average_rating,
          clean_sheets = excluded.clean_sheets`,
      )
      .run(
        stat.competitionSeasonId,
        stat.personId,
        stat.teamId,
        stat.appearances,
        stat.starts,
        stat.minutes,
        stat.goals,
        stat.assists,
        stat.yellowCards,
        stat.redCards,
        stat.averageRating,
        stat.cleanSheets,
      );
  }

  upsertTeamSeasonStat(stat: TeamSeasonStat): void {
    this.db
      .prepare(
        `INSERT INTO team_season_stats
        (competition_season_id, team_id, played, wins, draws, losses, goals_for, goals_against, clean_sheets)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(competition_season_id, team_id) DO UPDATE SET
          played = excluded.played,
          wins = excluded.wins,
          draws = excluded.draws,
          losses = excluded.losses,
          goals_for = excluded.goals_for,
          goals_against = excluded.goals_against,
          clean_sheets = excluded.clean_sheets`,
      )
      .run(
        stat.competitionSeasonId,
        stat.teamId,
        stat.played,
        stat.wins,
        stat.draws,
        stat.losses,
        stat.goalsFor,
        stat.goalsAgainst,
        stat.cleanSheets,
      );
  }

  insertWinner(winner: CompetitionWinner): void {
    this.db
      .prepare(
        "INSERT INTO competition_winners (id, competition_season_id, team_id, decided_on) VALUES (?, ?, ?, ?)",
      )
      .run(winner.id, winner.competitionSeasonId, winner.teamId, winner.decidedOn);
  }
}

export class PlayerRepository {
  constructor(private readonly db: GameDatabase) {}

  insertAttributes(attributes: PlayerAttributeSet): void {
    this.db
      .prepare(
        `INSERT INTO player_attributes
        (id, person_id, primary_position, secondary_positions_json, technical_json, mental_json, physical_json, goalkeeping_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          primary_position = excluded.primary_position,
          secondary_positions_json = excluded.secondary_positions_json,
          technical_json = excluded.technical_json,
          mental_json = excluded.mental_json,
          physical_json = excluded.physical_json,
          goalkeeping_json = excluded.goalkeeping_json`,
      )
      .run(
        attributes.id,
        attributes.personId,
        attributes.primaryPosition,
        json.stringify(attributes.secondaryPositions),
        json.stringify(attributes.technical),
        json.stringify(attributes.mental),
        json.stringify(attributes.physical),
        json.stringify(attributes.goalkeeping),
      );
  }

  upsertAttributes(attributes: PlayerAttributeSet): void {
    this.insertAttributes(attributes);
  }

  getAttributes(personId: EntityId): PlayerAttributeSet | undefined {
    const row = this.db
      .prepare("SELECT * FROM player_attributes WHERE person_id = ?")
      .get(personId) as any;
    return row ? mapAttributes(row) : undefined;
  }

  attributesForTeam(teamId: EntityId): PlayerAttributeSet[] {
    return this.db
      .prepare(
        `SELECT pa.*
        FROM player_attributes pa
        JOIN team_person_assignments tpa ON tpa.person_id = pa.person_id
        WHERE tpa.team_id = ? AND tpa.role = 'PLAYER'
        ORDER BY pa.person_id`,
      )
      .all(teamId)
      .map(mapAttributes);
  }

  upsertDevelopmentState(state: PlayerDevelopmentState): void {
    this.db
      .prepare(
        `INSERT INTO player_development_states
        (id, player_id, development_phase, training_load, fatigue, match_sharpness,
          fitness, recovery, development_momentum, position_familiarity_json,
          role_familiarity_json, last_training_date, last_development_update)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id) DO UPDATE SET
          development_phase = excluded.development_phase,
          training_load = excluded.training_load,
          fatigue = excluded.fatigue,
          match_sharpness = excluded.match_sharpness,
          fitness = excluded.fitness,
          recovery = excluded.recovery,
          development_momentum = excluded.development_momentum,
          position_familiarity_json = excluded.position_familiarity_json,
          role_familiarity_json = excluded.role_familiarity_json,
          last_training_date = excluded.last_training_date,
          last_development_update = excluded.last_development_update`,
      )
      .run(
        state.id,
        state.playerId,
        state.developmentPhase,
        state.trainingLoad,
        state.fatigue,
        state.matchSharpness,
        state.fitness,
        state.recovery,
        state.developmentMomentum,
        json.stringify(state.positionFamiliarity),
        json.stringify(state.roleFamiliarity),
        state.lastTrainingDate ?? null,
        state.lastDevelopmentUpdate ?? null,
      );
  }

  developmentState(playerId: EntityId): PlayerDevelopmentState | undefined {
    const row = this.db
      .prepare("SELECT * FROM player_development_states WHERE player_id = ?")
      .get(playerId) as any;
    return row ? mapDevelopmentState(row) : undefined;
  }

  insertPotential(potential: PlayerPotential): void {
    this.db
      .prepare(
        `INSERT INTO player_potentials
        (id, player_id, potential_ceiling, development_rate, volatility, professionalism, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        potential.id,
        potential.playerId,
        potential.potentialCeiling,
        potential.developmentRate,
        potential.volatility,
        potential.professionalism,
        potential.status,
      );
  }

  potential(playerId: EntityId): PlayerPotential | undefined {
    const row = this.db
      .prepare("SELECT * FROM player_potentials WHERE player_id = ? ORDER BY id LIMIT 1")
      .get(playerId) as any;
    return row
      ? {
          id: row.id,
          playerId: row.player_id,
          potentialCeiling: row.potential_ceiling,
          developmentRate: row.development_rate,
          volatility: row.volatility,
          professionalism: row.professionalism,
          status: row.status,
        }
      : undefined;
  }

  insertPlayingTimeSnapshot(snapshot: PlayerPlayingTimeSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO player_playing_time_snapshots
        (id, player_id, competition_season_id, minutes_last_30_days, minutes_season,
          starts_season, sub_appearances, updated_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.id,
        snapshot.playerId,
        snapshot.competitionSeasonId ?? null,
        snapshot.minutesLast30Days,
        snapshot.minutesSeason,
        snapshot.startsSeason,
        snapshot.subAppearances,
        snapshot.updatedOn,
      );
  }

  latestPlayingTime(playerId: EntityId): PlayerPlayingTimeSnapshot | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM player_playing_time_snapshots
        WHERE player_id = ?
        ORDER BY updated_on DESC, id DESC
        LIMIT 1`,
      )
      .get(playerId) as any;
    return row
      ? {
          id: row.id,
          playerId: row.player_id,
          competitionSeasonId: row.competition_season_id ?? undefined,
          minutesLast30Days: row.minutes_last_30_days,
          minutesSeason: row.minutes_season,
          startsSeason: row.starts_season,
          subAppearances: row.sub_appearances,
          updatedOn: row.updated_on,
        }
      : undefined;
  }

  insertTrainingHistoryEvent(event: TrainingHistoryEvent): void {
    this.db
      .prepare(
        `INSERT INTO training_history_events
        (id, player_id, team_id, event_type, occurred_on, data_json)
        VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.playerId ?? null,
        event.teamId ?? null,
        event.eventType,
        event.occurredOn,
        event.data ? json.stringify(event.data) : null,
      );
  }

  insertInjury(injury: InjuryRecord): void {
    this.db
      .prepare(
        "INSERT INTO injuries (id, person_id, injury_type, date_occurred, expected_recovery_date, severity) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        injury.id,
        injury.personId,
        injury.injuryType,
        injury.dateOccurred,
        injury.expectedRecoveryDate,
        injury.severity,
      );
  }

  activeInjuries(onDate: string): InjuryRecord[] {
    return this.db
      .prepare("SELECT * FROM injuries WHERE expected_recovery_date >= ? ORDER BY person_id")
      .all(onDate)
      .map((row: any) => ({
        id: row.id,
        personId: row.person_id,
        injuryType: row.injury_type,
        dateOccurred: row.date_occurred,
        expectedRecoveryDate: row.expected_recovery_date,
        severity: row.severity,
      }));
  }

  insertSuspension(suspension: SuspensionRecord): void {
    this.db
      .prepare(
        "INSERT INTO suspensions (id, person_id, competition_season_id, reason, matches_remaining) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        suspension.id,
        suspension.personId,
        suspension.competitionSeasonId,
        suspension.reason,
        suspension.matchesRemaining,
      );
  }

  upsertAvailabilityState(input: {
    personId: EntityId;
    teamId?: EntityId;
    fitness: number;
    moraleModifier: number;
    formModifier: number;
    availability: string;
    updatedOn: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO player_availability_states
        (person_id, team_id, fitness, morale_modifier, form_modifier, availability, updated_on)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(person_id) DO UPDATE SET
          team_id = excluded.team_id,
          fitness = excluded.fitness,
          morale_modifier = excluded.morale_modifier,
          form_modifier = excluded.form_modifier,
          availability = excluded.availability,
          updated_on = excluded.updated_on`,
      )
      .run(
        input.personId,
        input.teamId ?? null,
        input.fitness,
        input.moraleModifier,
        input.formModifier,
        input.availability,
        input.updatedOn,
      );
  }

  availabilityStates(teamId: EntityId): Array<{
    personId: EntityId;
    teamId?: EntityId;
    fitness: number;
    moraleModifier: number;
    formModifier: number;
    availability: string;
    updatedOn: string;
  }> {
    return this.db
      .prepare("SELECT * FROM player_availability_states WHERE team_id = ? ORDER BY person_id")
      .all(teamId)
      .map((row: any) => ({
        personId: row.person_id,
        teamId: row.team_id ?? undefined,
        fitness: row.fitness,
        moraleModifier: row.morale_modifier,
        formModifier: row.form_modifier,
        availability: row.availability,
        updatedOn: row.updated_on,
      }));
  }

  activeSuspensions(competitionSeasonId: EntityId): SuspensionRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM suspensions WHERE competition_season_id = ? AND matches_remaining > 0",
      )
      .all(competitionSeasonId)
      .map((row: any) => ({
        id: row.id,
        personId: row.person_id,
        competitionSeasonId: row.competition_season_id,
        reason: row.reason,
        matchesRemaining: row.matches_remaining,
      }));
  }
}

const mapAttributes = (row: any): PlayerAttributeSet => ({
  id: row.id,
  personId: row.person_id,
  primaryPosition: row.primary_position,
  secondaryPositions: json.parse(row.secondary_positions_json, []),
  technical: json.parse(row.technical_json, {}) as PlayerAttributeSet["technical"],
  mental: json.parse(row.mental_json, {}) as PlayerAttributeSet["mental"],
  physical: json.parse(row.physical_json, {}) as PlayerAttributeSet["physical"],
  goalkeeping: json.parse(row.goalkeeping_json, {}) as PlayerAttributeSet["goalkeeping"],
});

const mapDevelopmentState = (row: any): PlayerDevelopmentState => ({
  id: row.id,
  playerId: row.player_id,
  developmentPhase: row.development_phase,
  trainingLoad: row.training_load,
  fatigue: row.fatigue,
  matchSharpness: row.match_sharpness,
  fitness: row.fitness,
  recovery: row.recovery,
  developmentMomentum: row.development_momentum,
  positionFamiliarity: json.parse(row.position_familiarity_json, {}),
  roleFamiliarity: json.parse(row.role_familiarity_json, {}),
  lastTrainingDate: row.last_training_date ?? undefined,
  lastDevelopmentUpdate: row.last_development_update ?? undefined,
});

const mapManagerProfile = (row: any): ManagerProfile => ({
  id: row.id,
  personId: row.person_id,
  attributes: json.parse(row.attributes_json, {}) as ManagerProfile["attributes"],
  preferredStyle: row.preferred_style ?? undefined,
  reputationProfile: row.reputation_profile,
  createdOn: row.created_on,
});

const mapManagerContract = (row: any): ManagerContract => ({
  id: row.id,
  managerProfileId: row.manager_profile_id,
  personId: row.person_id,
  teamId: row.team_id ?? undefined,
  clubId: row.club_id ?? undefined,
  jobTitle: row.job_title,
  contractStart: row.contract_start,
  contractEnd: row.contract_end ?? undefined,
  salaryAmountMinor: row.salary_amount_minor,
  currency: row.currency,
  status: row.status,
});

const mapTacticalSetup = (row: any): TacticalSetup => ({
  id: row.id,
  managerProfileId: row.manager_profile_id ?? undefined,
  teamId: row.team_id,
  name: row.name,
  formation: json.parse(row.formation_json, {}) as TacticalSetup["formation"],
  style: row.style,
  instructions: json.parse(row.instructions_json, {}) as TacticalSetup["instructions"],
  familiarity: json.parse(row.familiarity_json, {}) as TacticalSetup["familiarity"],
  assignments: json.parse(row.assignments_json, []) as TacticalSetup["assignments"],
  bench: json.parse(row.bench_json, []) as TacticalSetup["bench"],
  setPieces: json.parse(row.set_pieces_json, {}) as TacticalSetup["setPieces"],
  createdOn: row.created_on,
  updatedOn: row.updated_on,
});

const mapClubMembership = (row: any): ClubMembership => ({
  id: row.id,
  clubId: row.club_id,
  teamId: row.team_id ?? undefined,
  competitionId: row.competition_id,
  competitionSeasonId: row.competition_season_id ?? undefined,
  membershipType: row.membership_type,
  status: row.status,
});

const mapCompetitionRelationship = (row: any): CompetitionRelationship => ({
  id: row.id,
  fromCompetitionId: row.from_competition_id,
  toCompetitionId: row.to_competition_id,
  movementType: row.movement_type,
  numberOfTeams: row.number_of_teams,
  selectionMethod: row.selection_method,
  effectiveSeasonId: row.effective_season_id ?? undefined,
});

const mapCompetitionMovement = (row: any): CompetitionMovement => ({
  id: row.id,
  clubId: row.club_id,
  teamId: row.team_id ?? undefined,
  fromCompetitionId: row.from_competition_id,
  toCompetitionId: row.to_competition_id,
  fromCompetitionSeasonId: row.from_competition_season_id,
  toCompetitionSeasonId: row.to_competition_season_id,
  movementType: row.movement_type,
  status: row.status,
  reason: row.reason ?? undefined,
});

export type WorldInspection = {
  countries: number;
  locations: number;
  venues: number;
  federations: number;
  competitions: number;
  competitionSeasons: number;
  competitionRelationships: number;
  competitionMovements: number;
  clubs: number;
  clubAliases: number;
  clubRelationships: number;
  clubMemberships: number;
  teams: number;
  academies: number;
  venueRelationships: number;
  locationTravelContexts: number;
  persons: number;
  personRoles: number;
  teamPersonAssignments: number;
  staffProfiles: number;
  staffAppointments: number;
  staffVacancies: number;
  staffLicences: number;
  refereeProfiles: number;
  staffHistoryEvents: number;
  playerAttributes: number;
  trainingPlans: number;
  individualDevelopmentPlans: number;
  playerDevelopmentStates: number;
  playerPotentials: number;
  playerPlayingTimeSnapshots: number;
  competitionDevelopmentMultipliers: number;
  staffSimulationProfiles: number;
  trainingFacilityProfiles: number;
  trainingHistoryEvents: number;
  entityProvenance: number;
};

export class ImportRepository {
  constructor(private readonly db: GameDatabase) {}

  insertImportRecord(input: {
    id: EntityId;
    entityType: string;
    entityId?: EntityId;
    payload: Record<string, unknown>;
    provenance: DataProvenance;
    importedAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO import_records
        (id, entity_type, entity_id, payload_json, provenance_json, imported_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.entityType,
        input.entityId ?? null,
        json.stringify(input.payload),
        json.stringify(input.provenance),
        input.importedAt,
      );
  }

  insertEntityProvenance(input: {
    id: EntityId;
    entityType: string;
    entityId: EntityId;
    provenance: DataProvenance;
    importedAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO entity_provenance
        (id, entity_type, entity_id, source_url, source_name, last_verified_date, confidence, status, imported_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.entityType,
        input.entityId,
        input.provenance.sourceUrl ?? null,
        input.provenance.sourceName,
        input.provenance.lastVerifiedDate ?? null,
        input.provenance.confidence,
        input.provenance.status,
        input.importedAt,
      );
  }
}

export class FinanceRepository {
  constructor(private readonly db: GameDatabase) {}

  insertAccount(account: FinanceAccount): void {
    this.db
      .prepare(
        "INSERT INTO finance_accounts (id, owner_type, owner_id, name, currency) VALUES (?, ?, ?, ?, ?)",
      )
      .run(account.id, account.ownerType, account.ownerId, account.name, account.currency);
  }

  getAccount(id: EntityId): FinanceAccount | undefined {
    const row = this.db.prepare("SELECT * FROM finance_accounts WHERE id = ?").get(id) as any;
    return row
      ? {
          id: row.id,
          ownerType: row.owner_type,
          ownerId: row.owner_id,
          name: row.name,
          currency: row.currency,
        }
      : undefined;
  }

  insertTransaction(transaction: FinancialTransaction): void {
    this.db
      .prepare(
        `INSERT INTO financial_transactions
        (id, account_id, occurred_on, amount_minor, currency, category, description, related_entity_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        transaction.id,
        transaction.accountId,
        transaction.occurredOn,
        transaction.amountMinor,
        transaction.currency,
        transaction.category,
        transaction.description ?? null,
        transaction.relatedEntity ? json.stringify(transaction.relatedEntity) : null,
      );
  }
}

export class EventRepository {
  constructor(private readonly db: GameDatabase) {}

  schedule(event: ScheduledEvent): void {
    this.db
      .prepare(
        "INSERT INTO scheduled_events (id, due_on, event_type, payload_json, status, processed_on) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        event.id,
        event.dueOn,
        event.eventType,
        json.stringify(event.payload),
        event.status,
        event.processedOn ?? null,
      );
  }

  dueEvents(worldDate: string): ScheduledEvent[] {
    return this.db
      .prepare(
        "SELECT * FROM scheduled_events WHERE status = 'pending' AND due_on <= ? ORDER BY due_on, id",
      )
      .all(worldDate)
      .map((row: any) => ({
        id: row.id,
        dueOn: row.due_on,
        eventType: row.event_type,
        payload: json.parse<Record<string, unknown>>(row.payload_json, {}),
        status: row.status,
        processedOn: row.processed_on ?? undefined,
      }));
  }

  markProcessed(id: EntityId, processedOn: string): void {
    this.db
      .prepare("UPDATE scheduled_events SET status = 'processed', processed_on = ? WHERE id = ?")
      .run(processedOn, id);
  }

  insertHistoricalEvent(event: HistoricalEvent): void {
    this.db
      .prepare(
        `INSERT INTO historical_events
        (id, occurred_on, event_type, involved_entities_json, title, data_json, importance, scope)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.occurredOn,
        event.eventType,
        json.stringify(event.involvedEntities),
        event.title,
        event.data ? json.stringify(event.data) : null,
        event.importance,
        event.scope,
      );
  }

  historicalEvents(): HistoricalEvent[] {
    return this.db
      .prepare("SELECT * FROM historical_events ORDER BY occurred_on, id")
      .all()
      .map((row: any) => ({
        id: row.id,
        occurredOn: row.occurred_on,
        eventType: row.event_type,
        involvedEntities: json.parse(row.involved_entities_json, []),
        title: row.title,
        data: json.parse<Record<string, unknown> | undefined>(row.data_json, undefined),
        importance: row.importance,
        scope: row.scope,
      }));
  }
}
