import type {
  CareerCharacter,
  Academy,
  AcademySimulationProfile,
  AgentApproachRecord,
  AgentClient,
  AgentProfile,
  ClubAsset,
  ClubAlias,
  ClubBoardPolicy,
  ClubBudget,
  ClubDebt,
  ClubEmploymentProfile,
  ClubFacilityProfile,
  ClubFinancialAccount,
  ClubFinancialProfile,
  ClubFinancialStatement,
  ClubLedgerEntry,
  ClubRecruitmentProfile,
  ClubShortlistItem,
  ClubMembership,
  ClubOwnershipStake,
  ClubSupporterProfile,
  ClubValuation,
  ClubRelationship,
  Club,
  CompetitionMovement,
  CompetitionDevelopmentMultiplier,
  CompetitionRelationship,
  Country,
  CountryDevelopmentProfile,
  ClubLicensingAssessment,
  CoachEducationProgramme,
  Federation,
  FederationAsset,
  FederationBudget,
  FederationCommittee,
  FederationFinancialAccount,
  FederationFinancialStatement,
  FederationGrantDistribution,
  FederationKPI,
  FederationLeadershipTenure,
  FederationLedgerEntry,
  FederationObjective,
  FederationProject,
  FederationSimulationProfile,
  FederationSponsorshipContract,
  FederationStrategyPriority,
  FinanceAccount,
  FinancialTransaction,
  HistoricalEvent,
  IndividualDevelopmentPlan,
  InternationalCompetition,
  InternationalCompetitionEdition,
  InternationalCompetitionParticipant,
  InternationalCompetitionStage,
  InternationalDevelopmentProfile,
  InternationalDrawRecord,
  InternationalMatch,
  InternationalRetirement,
  InternationalTeamProfile,
  InfrastructureProject,
  Location,
  LocationTravelContext,
  Person,
  PersonRole,
  SaveMetadata,
  ScheduledEvent,
  ScoutReport,
  ScoutingAssignment,
  ScoutingStaffSimulationProfile,
  SimulationWorldRanking,
  CompetitionRegistration,
  CompetitionReformProposal,
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
  JobApplication,
  JobVacancy,
  ClubBoardConfidence,
  ManagerPlayerRelationship,
  PlayerClubSatisfaction,
  SquadHierarchyEntry,
  PlayerConcern,
  RelationshipHistoryEvent,
  ManagerConcernResponse,
  ManagerPromise,
  SquadGroupMembership,
  TeamCohesion,
  ClubCommercialProfile,
  CompetitionMediaRights,
  SquadDispute,
  SquadMeeting,
  LeagueStanding,
  ManagerContract,
  ManagerProfile,
  Match,
  MatchEvent,
  NationalTeamAppearance,
  NationalTeamCamp,
  NationalTeamCallup,
  NationalTeamCohesion,
  NationalTeamDuty,
  NationalTeamFixture,
  OrganisationRelationship,
  OwnerInvestmentTransaction,
  PersonalFinancialProfile,
  PlayerAttributeSet,
  PlayerContractRecord,
  PlayerDevelopmentState,
  PlayerFactualProfile,
  PlayerKnowledge,
  PlayerLoanRecord,
  PlayerRetirementRecord,
  PlayerInternationalEligibility,
  RefereeProfile,
  RefereeDevelopmentProgramme,
  RetiredStaffTransition,
  PlayerPotential,
  PlayerPlayingTimeSnapshot,
  PlayerSeasonStat,
  SuspensionRecord,
  TacticalSetup,
  TeamSeasonStat,
  TransferHistoryEvent,
  TransferOffer,
  TransferWindow,
  NegotiationRound,
  PlayerTransferStatusRecord,
  PlayerTransferRequest,
  GeneratedPlayerOrigin,
  SquadNeedReport,
  SponsorOrganisation,
  SponsorshipContract,
  TrainingFacilityProfile,
  TrainingHistoryEvent,
  TrainingPlan,
  VenueRelationship,
  YouthDevelopmentActivity,
  YouthIntakeEvent,
  YouthPlayerStatus,
  YouthPlayerStatusRecord,
  MatchSessionRecord,
  PlayerMatchRatingRecord,
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
      fixtures: scalar("fixtures"),
      matches: scalar("matches"),
      matchEvents: scalar("match_events"),
      leagueStandings: scalar("league_standings"),
      playerSeasonStats: scalar("player_season_stats"),
      teamSeasonStats: scalar("team_season_stats"),
      competitionWinners: scalar("competition_winners"),
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
      playerFactualProfiles: scalar("player_factual_profiles"),
      competitionSeasonStates: scalar("competition_season_states"),
      playerCareerStats: scalar("player_career_stats"),
      seasonAwards: scalar("season_awards"),
      playerKnowledge: scalar("player_knowledge"),
      clubRecruitmentProfiles: scalar("club_recruitment_profiles"),
      scoutingStaffSimulationProfiles: scalar("scouting_staff_simulation_profiles"),
      scoutingAssignments: scalar("scouting_assignments"),
      scoutReports: scalar("scout_reports"),
      clubShortlist: scalar("club_shortlist"),
      playerContracts: scalar("player_contracts"),
      transferWindows: scalar("transfer_windows"),
      clubFinancialProfiles: scalar("club_financial_profiles"),
      clubEmploymentProfiles: scalar("club_employment_profiles"),
      playerTransferStatuses: scalar("player_transfer_statuses"),
      agents: scalar("agents"),
      agentClients: scalar("agent_clients"),
      transferOffers: scalar("transfer_offers"),
      negotiationRounds: scalar("negotiation_rounds"),
      playerLoans: scalar("player_loans"),
      competitionRegistrations: scalar("competition_registrations"),
      transferHistoryEvents: scalar("transfer_history_events"),
      squadNeedReports: scalar("squad_need_reports"),
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

  activeContractForTeam(teamId: EntityId): ManagerContract | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM manager_contracts WHERE team_id = ? AND status = 'ACTIVE' ORDER BY contract_start DESC LIMIT 1",
      )
      .get(teamId) as any;
    return row ? mapManagerContract(row) : undefined;
  }

  allActiveContracts(): ManagerContract[] {
    return this.db
      .prepare("SELECT * FROM manager_contracts WHERE status = 'ACTIVE'")
      .all()
      .map(mapManagerContract);
  }

  /** Full employment history for a person, most recent first — career history. */
  contractsForPerson(personId: EntityId): ManagerContract[] {
    return this.db
      .prepare("SELECT * FROM manager_contracts WHERE person_id = ? ORDER BY contract_start DESC")
      .all(personId)
      .map(mapManagerContract);
  }

  /** Free agents: managers whose most recent contract already ended. */
  unemployedManagerProfiles(): ManagerProfile[] {
    return this.db
      .prepare(
        `SELECT mp.* FROM manager_profiles mp
        WHERE NOT EXISTS (
          SELECT 1 FROM manager_contracts mc
          WHERE mc.manager_profile_id = mp.id AND mc.status = 'ACTIVE'
        )`,
      )
      .all()
      .map(mapManagerProfile);
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

/** Vacancies, applications and board trust — the Manager Career World. */
export class CareerWorldRepository {
  constructor(private readonly db: GameDatabase) {}

  insertVacancy(vacancy: JobVacancy): void {
    this.db
      .prepare(
        `INSERT INTO manager_job_vacancies
        (id, club_id, team_id, country_id, opened_on, reason, board_expectation, status,
          filled_on, filled_by_contract_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          filled_on = excluded.filled_on,
          filled_by_contract_id = excluded.filled_by_contract_id`,
      )
      .run(
        vacancy.id,
        vacancy.clubId ?? null,
        vacancy.teamId,
        vacancy.countryId ?? null,
        vacancy.openedOn,
        vacancy.reason,
        vacancy.boardExpectation,
        vacancy.status,
        vacancy.filledOn ?? null,
        vacancy.filledByContractId ?? null,
      );
  }

  openVacancies(): JobVacancy[] {
    return this.db
      .prepare("SELECT * FROM manager_job_vacancies WHERE status = 'OPEN' ORDER BY opened_on")
      .all()
      .map(mapJobVacancy);
  }

  openVacancyForTeam(teamId: EntityId): JobVacancy | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM manager_job_vacancies WHERE team_id = ? AND status = 'OPEN' ORDER BY opened_on DESC LIMIT 1",
      )
      .get(teamId) as any;
    return row ? mapJobVacancy(row) : undefined;
  }

  vacancy(id: EntityId): JobVacancy | undefined {
    const row = this.db.prepare("SELECT * FROM manager_job_vacancies WHERE id = ?").get(id) as any;
    return row ? mapJobVacancy(row) : undefined;
  }

  fillVacancy(id: EntityId, filledOn: string, contractId: EntityId): void {
    this.db
      .prepare(
        "UPDATE manager_job_vacancies SET status = 'FILLED', filled_on = ?, filled_by_contract_id = ? WHERE id = ?",
      )
      .run(filledOn, contractId, id);
  }

  insertApplication(application: JobApplication): void {
    this.db
      .prepare(
        `INSERT INTO manager_job_applications
        (id, vacancy_id, manager_profile_id, person_id, status, created_on, decided_on,
          offered_salary_minor, offered_contract_end)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          decided_on = excluded.decided_on,
          offered_salary_minor = excluded.offered_salary_minor,
          offered_contract_end = excluded.offered_contract_end`,
      )
      .run(
        application.id,
        application.vacancyId,
        application.managerProfileId,
        application.personId,
        application.status,
        application.createdOn,
        application.decidedOn ?? null,
        application.offeredSalaryMinor ?? null,
        application.offeredContractEnd ?? null,
      );
  }

  application(id: EntityId): JobApplication | undefined {
    const row = this.db
      .prepare("SELECT * FROM manager_job_applications WHERE id = ?")
      .get(id) as any;
    return row ? mapJobApplication(row) : undefined;
  }

  applicationsForManager(managerProfileId: EntityId): JobApplication[] {
    return this.db
      .prepare(
        "SELECT * FROM manager_job_applications WHERE manager_profile_id = ? ORDER BY created_on DESC",
      )
      .all(managerProfileId)
      .map(mapJobApplication);
  }

  boardConfidence(clubId: EntityId): ClubBoardConfidence | undefined {
    const row = this.db
      .prepare("SELECT * FROM club_board_confidence WHERE club_id = ?")
      .get(clubId) as any;
    return row ? mapBoardConfidence(row) : undefined;
  }

  upsertBoardConfidence(confidence: ClubBoardConfidence): void {
    this.db
      .prepare(
        `INSERT INTO club_board_confidence (club_id, contract_id, confidence, expectation, last_evaluated_on)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(club_id) DO UPDATE SET
          contract_id = excluded.contract_id,
          confidence = excluded.confidence,
          expectation = excluded.expectation,
          last_evaluated_on = excluded.last_evaluated_on`,
      )
      .run(
        confidence.clubId,
        confidence.contractId ?? null,
        confidence.confidence,
        confidence.expectation,
        confidence.lastEvaluatedOn,
      );
  }
}

const mapJobVacancy = (row: any): JobVacancy => ({
  id: row.id,
  clubId: row.club_id ?? undefined,
  teamId: row.team_id,
  countryId: row.country_id ?? undefined,
  openedOn: row.opened_on,
  reason: row.reason,
  boardExpectation: row.board_expectation,
  status: row.status,
  filledOn: row.filled_on ?? undefined,
  filledByContractId: row.filled_by_contract_id ?? undefined,
});

const mapJobApplication = (row: any): JobApplication => ({
  id: row.id,
  vacancyId: row.vacancy_id,
  managerProfileId: row.manager_profile_id,
  personId: row.person_id,
  status: row.status,
  createdOn: row.created_on,
  decidedOn: row.decided_on ?? undefined,
  offeredSalaryMinor: row.offered_salary_minor ?? undefined,
  offeredContractEnd: row.offered_contract_end ?? undefined,
});

const mapBoardConfidence = (row: any): ClubBoardConfidence => ({
  clubId: row.club_id,
  contractId: row.contract_id ?? undefined,
  confidence: row.confidence,
  expectation: row.expectation,
  lastEvaluatedOn: row.last_evaluated_on,
});

/** Manager Relationships & Squad Dynamics — Phase A. */
export class SquadDynamicsRepository {
  constructor(private readonly db: GameDatabase) {}

  upsertRelationship(relationship: ManagerPlayerRelationship): void {
    this.db
      .prepare(
        `INSERT INTO manager_player_relationships
        (id, manager_profile_id, person_id, score, level, updated_on)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(manager_profile_id, person_id) DO UPDATE SET
          score = excluded.score,
          level = excluded.level,
          updated_on = excluded.updated_on`,
      )
      .run(
        relationship.id,
        relationship.managerProfileId,
        relationship.personId,
        relationship.score,
        relationship.level,
        relationship.updatedOn,
      );
  }

  relationship(
    managerProfileId: EntityId,
    personId: EntityId,
  ): ManagerPlayerRelationship | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM manager_player_relationships WHERE manager_profile_id = ? AND person_id = ?",
      )
      .get(managerProfileId, personId) as any;
    return row ? mapRelationship(row) : undefined;
  }

  relationshipsForManager(managerProfileId: EntityId): ManagerPlayerRelationship[] {
    return this.db
      .prepare("SELECT * FROM manager_player_relationships WHERE manager_profile_id = ?")
      .all(managerProfileId)
      .map(mapRelationship);
  }

  upsertSatisfaction(satisfaction: PlayerClubSatisfaction): void {
    this.db
      .prepare(
        `INSERT INTO player_club_satisfaction (id, person_id, team_id, score, level, updated_on)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(person_id, team_id) DO UPDATE SET
          score = excluded.score,
          level = excluded.level,
          updated_on = excluded.updated_on`,
      )
      .run(
        satisfaction.id,
        satisfaction.personId,
        satisfaction.teamId,
        satisfaction.score,
        satisfaction.level,
        satisfaction.updatedOn,
      );
  }

  satisfactionForTeam(teamId: EntityId): PlayerClubSatisfaction[] {
    return this.db
      .prepare("SELECT * FROM player_club_satisfaction WHERE team_id = ?")
      .all(teamId)
      .map(mapSatisfaction);
  }

  upsertHierarchyEntry(entry: SquadHierarchyEntry): void {
    this.db
      .prepare(
        `INSERT INTO squad_hierarchy (id, team_id, person_id, influence, role, updated_on)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(team_id, person_id) DO UPDATE SET
          influence = excluded.influence,
          role = excluded.role,
          updated_on = excluded.updated_on`,
      )
      .run(entry.id, entry.teamId, entry.personId, entry.influence, entry.role, entry.updatedOn);
  }

  hierarchyForTeam(teamId: EntityId): SquadHierarchyEntry[] {
    return this.db
      .prepare("SELECT * FROM squad_hierarchy WHERE team_id = ? ORDER BY influence DESC")
      .all(teamId)
      .map(mapHierarchyEntry);
  }

  /** Inserts a concern the first time, and re-raises/updates it on later ticks. */
  upsertConcern(concern: PlayerConcern): void {
    this.db
      .prepare(
        `INSERT INTO player_concerns
        (id, person_id, team_id, type, status, severity, raised_on, updated_on, resolved_on, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(person_id, team_id, type) DO UPDATE SET
          status = excluded.status,
          severity = excluded.severity,
          raised_on = excluded.raised_on,
          updated_on = excluded.updated_on,
          resolved_on = excluded.resolved_on,
          note = excluded.note`,
      )
      .run(
        concern.id,
        concern.personId,
        concern.teamId,
        concern.type,
        concern.status,
        concern.severity,
        concern.raisedOn,
        concern.updatedOn,
        concern.resolvedOn ?? null,
        concern.note ?? null,
      );
  }

  concern(
    personId: EntityId,
    teamId: EntityId,
    type: PlayerConcern["type"],
  ): PlayerConcern | undefined {
    const row = this.db
      .prepare("SELECT * FROM player_concerns WHERE person_id = ? AND team_id = ? AND type = ?")
      .get(personId, teamId, type) as any;
    return row ? mapConcern(row) : undefined;
  }

  concernsForTeam(teamId: EntityId): PlayerConcern[] {
    return this.db
      .prepare("SELECT * FROM player_concerns WHERE team_id = ? ORDER BY updated_on DESC")
      .all(teamId)
      .map(mapConcern);
  }

  concernsForPerson(personId: EntityId, teamId: EntityId): PlayerConcern[] {
    return this.db
      .prepare("SELECT * FROM player_concerns WHERE person_id = ? AND team_id = ?")
      .all(personId, teamId)
      .map(mapConcern);
  }

  concernById(id: EntityId): PlayerConcern | undefined {
    const row = this.db.prepare("SELECT * FROM player_concerns WHERE id = ?").get(id) as any;
    return row ? mapConcern(row) : undefined;
  }

  insertConcernResponse(response: ManagerConcernResponse): void {
    this.db
      .prepare(
        `INSERT INTO manager_concern_responses
        (id, concern_id, manager_profile_id, person_id, team_id, action, outcome, promise_id, occurred_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        response.id,
        response.concernId,
        response.managerProfileId,
        response.personId,
        response.teamId,
        response.action,
        response.outcome,
        response.promiseId ?? null,
        response.occurredOn,
      );
  }

  responsesForConcern(concernId: EntityId): ManagerConcernResponse[] {
    return this.db
      .prepare("SELECT * FROM manager_concern_responses WHERE concern_id = ? ORDER BY occurred_on")
      .all(concernId)
      .map(mapConcernResponse);
  }

  upsertPromise(promise: ManagerPromise): void {
    this.db
      .prepare(
        `INSERT INTO manager_promises
        (id, manager_profile_id, person_id, team_id, concern_id, type, description,
          made_on, due_on, status, baseline_metric, resolved_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          resolved_on = excluded.resolved_on`,
      )
      .run(
        promise.id,
        promise.managerProfileId,
        promise.personId,
        promise.teamId,
        promise.concernId ?? null,
        promise.type,
        promise.description,
        promise.madeOn,
        promise.dueOn,
        promise.status,
        promise.baselineMetric ?? null,
        promise.resolvedOn ?? null,
      );
  }

  promiseById(id: EntityId): ManagerPromise | undefined {
    const row = this.db.prepare("SELECT * FROM manager_promises WHERE id = ?").get(id) as any;
    return row ? mapPromise(row) : undefined;
  }

  activePromisesForTeam(teamId: EntityId): ManagerPromise[] {
    return this.db
      .prepare("SELECT * FROM manager_promises WHERE team_id = ? AND status = 'ACTIVE'")
      .all(teamId)
      .map(mapPromise);
  }

  activePromiseForConcern(concernId: EntityId): ManagerPromise | undefined {
    const row = this.db
      .prepare("SELECT * FROM manager_promises WHERE concern_id = ? AND status = 'ACTIVE'")
      .get(concernId) as any;
    return row ? mapPromise(row) : undefined;
  }

  promisesForPerson(personId: EntityId, teamId: EntityId): ManagerPromise[] {
    return this.db
      .prepare(
        "SELECT * FROM manager_promises WHERE person_id = ? AND team_id = ? ORDER BY made_on",
      )
      .all(personId, teamId)
      .map(mapPromise);
  }

  /** Append-only; mirrors TransferHistoryEvent's insert-once convention. */
  insertHistoryEvent(event: RelationshipHistoryEvent): void {
    this.db
      .prepare(
        `INSERT INTO relationship_history_events
        (id, person_id, team_id, manager_profile_id, event_type, occurred_on, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        event.id,
        event.personId,
        event.teamId ?? null,
        event.managerProfileId ?? null,
        event.eventType,
        event.occurredOn,
        event.data ? json.stringify(event.data) : null,
      );
  }

  historyForPerson(personId: EntityId): RelationshipHistoryEvent[] {
    return this.db
      .prepare(
        "SELECT * FROM relationship_history_events WHERE person_id = ? ORDER BY occurred_on, id",
      )
      .all(personId)
      .map(mapHistoryEvent);
  }

  upsertGroupMembership(membership: SquadGroupMembership): void {
    this.db
      .prepare(
        `INSERT INTO squad_group_membership (id, team_id, person_id, group_type, updated_on)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(team_id, person_id) DO UPDATE SET
          group_type = excluded.group_type,
          updated_on = excluded.updated_on`,
      )
      .run(membership.id, membership.teamId, membership.personId, membership.groupType, membership.updatedOn);
  }

  groupsForTeam(teamId: EntityId): SquadGroupMembership[] {
    return this.db
      .prepare("SELECT * FROM squad_group_membership WHERE team_id = ?")
      .all(teamId)
      .map(mapGroupMembership);
  }

  upsertCohesion(cohesion: TeamCohesion): void {
    this.db
      .prepare(
        `INSERT INTO team_cohesion (team_id, score, level, captain_influence, top_issue, updated_on)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(team_id) DO UPDATE SET
          score = excluded.score,
          level = excluded.level,
          captain_influence = excluded.captain_influence,
          top_issue = excluded.top_issue,
          updated_on = excluded.updated_on`,
      )
      .run(
        cohesion.teamId,
        cohesion.score,
        cohesion.level,
        cohesion.captainInfluence,
        cohesion.topIssue ?? null,
        cohesion.updatedOn,
      );
  }

  cohesion(teamId: EntityId): TeamCohesion | undefined {
    const row = this.db.prepare("SELECT * FROM team_cohesion WHERE team_id = ?").get(teamId) as any;
    return row ? mapCohesion(row) : undefined;
  }

  insertDispute(dispute: SquadDispute): void {
    this.db
      .prepare(
        `INSERT INTO squad_disputes
        (id, team_id, kind, person_id, with_person_id, concern_type, status, raised_on, resolved_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        dispute.id,
        dispute.teamId,
        dispute.kind,
        dispute.personId,
        dispute.withPersonId ?? null,
        dispute.concernType,
        dispute.status,
        dispute.raisedOn,
        dispute.resolvedOn ?? null,
      );
  }

  updateDisputeStatus(id: EntityId, status: SquadDispute["status"], resolvedOn?: string): void {
    this.db
      .prepare("UPDATE squad_disputes SET status = ?, resolved_on = ? WHERE id = ?")
      .run(status, resolvedOn ?? null, id);
  }

  disputeById(id: EntityId): SquadDispute | undefined {
    const row = this.db.prepare("SELECT * FROM squad_disputes WHERE id = ?").get(id) as any;
    return row ? mapDispute(row) : undefined;
  }

  openDisputesForTeam(teamId: EntityId): SquadDispute[] {
    return this.db
      .prepare("SELECT * FROM squad_disputes WHERE team_id = ? AND status = 'OPEN' ORDER BY raised_on")
      .all(teamId)
      .map(mapDispute);
  }

  /** Any dispute, open or not, for the given pairing/type — used to avoid re-raising the same one. */
  findDispute(
    teamId: EntityId,
    kind: SquadDispute["kind"],
    personId: EntityId,
    withPersonId: EntityId | undefined,
    concernType: PlayerConcern["type"],
  ): SquadDispute | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM squad_disputes
        WHERE team_id = ? AND kind = ? AND concern_type = ? AND status = 'OPEN'
          AND person_id = ? AND (with_person_id IS ? OR with_person_id = ?)`,
      )
      .get(teamId, kind, concernType, personId, withPersonId ?? null, withPersonId ?? null) as any;
    return row ? mapDispute(row) : undefined;
  }

  insertMeeting(meeting: SquadMeeting): void {
    this.db
      .prepare(
        `INSERT INTO squad_meetings
        (id, team_id, manager_profile_id, type, person_id, with_person_id, concern_id, dispute_id,
          outcome, summary, occurred_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        meeting.id,
        meeting.teamId,
        meeting.managerProfileId,
        meeting.type,
        meeting.personId ?? null,
        meeting.withPersonId ?? null,
        meeting.concernId ?? null,
        meeting.disputeId ?? null,
        meeting.outcome,
        meeting.summary,
        meeting.occurredOn,
      );
  }

  meetingsForTeam(teamId: EntityId): SquadMeeting[] {
    return this.db
      .prepare("SELECT * FROM squad_meetings WHERE team_id = ? ORDER BY occurred_on DESC")
      .all(teamId)
      .map(mapMeeting);
  }

  lastMeeting(
    teamId: EntityId,
    type: SquadMeeting["type"],
    personId: EntityId | undefined,
  ): SquadMeeting | undefined {
    const row = personId
      ? (this.db
          .prepare(
            `SELECT * FROM squad_meetings WHERE team_id = ? AND type = ? AND person_id = ?
            ORDER BY occurred_on DESC LIMIT 1`,
          )
          .get(teamId, type, personId) as any)
      : (this.db
          .prepare(
            `SELECT * FROM squad_meetings WHERE team_id = ? AND type = ?
            ORDER BY occurred_on DESC LIMIT 1`,
          )
          .get(teamId, type) as any);
    return row ? mapMeeting(row) : undefined;
  }
}

const mapDispute = (row: any): SquadDispute => ({
  id: row.id,
  teamId: row.team_id,
  kind: row.kind,
  personId: row.person_id,
  withPersonId: row.with_person_id ?? undefined,
  concernType: row.concern_type,
  status: row.status,
  raisedOn: row.raised_on,
  resolvedOn: row.resolved_on ?? undefined,
});

const mapMeeting = (row: any): SquadMeeting => ({
  id: row.id,
  teamId: row.team_id,
  managerProfileId: row.manager_profile_id,
  type: row.type,
  personId: row.person_id ?? undefined,
  withPersonId: row.with_person_id ?? undefined,
  concernId: row.concern_id ?? undefined,
  disputeId: row.dispute_id ?? undefined,
  outcome: row.outcome,
  summary: row.summary,
  occurredOn: row.occurred_on,
});

const mapGroupMembership = (row: any): SquadGroupMembership => ({
  id: row.id,
  teamId: row.team_id,
  personId: row.person_id,
  groupType: row.group_type,
  updatedOn: row.updated_on,
});

const mapCohesion = (row: any): TeamCohesion => ({
  teamId: row.team_id,
  score: row.score,
  level: row.level,
  captainInfluence: row.captain_influence,
  topIssue: row.top_issue ?? undefined,
  updatedOn: row.updated_on,
});

const mapRelationship = (row: any): ManagerPlayerRelationship => ({
  id: row.id,
  managerProfileId: row.manager_profile_id,
  personId: row.person_id,
  score: row.score,
  level: row.level,
  updatedOn: row.updated_on,
});

const mapConcernResponse = (row: any): ManagerConcernResponse => ({
  id: row.id,
  concernId: row.concern_id,
  managerProfileId: row.manager_profile_id,
  personId: row.person_id,
  teamId: row.team_id,
  action: row.action,
  outcome: row.outcome,
  promiseId: row.promise_id ?? undefined,
  occurredOn: row.occurred_on,
});

const mapPromise = (row: any): ManagerPromise => ({
  id: row.id,
  managerProfileId: row.manager_profile_id,
  personId: row.person_id,
  teamId: row.team_id,
  concernId: row.concern_id ?? undefined,
  type: row.type,
  description: row.description,
  madeOn: row.made_on,
  dueOn: row.due_on,
  status: row.status,
  baselineMetric: row.baseline_metric ?? undefined,
  resolvedOn: row.resolved_on ?? undefined,
});

const mapSatisfaction = (row: any): PlayerClubSatisfaction => ({
  id: row.id,
  personId: row.person_id,
  teamId: row.team_id,
  score: row.score,
  level: row.level,
  updatedOn: row.updated_on,
});

const mapHierarchyEntry = (row: any): SquadHierarchyEntry => ({
  id: row.id,
  teamId: row.team_id,
  personId: row.person_id,
  influence: row.influence,
  role: row.role,
  updatedOn: row.updated_on,
});

const mapConcern = (row: any): PlayerConcern => ({
  id: row.id,
  personId: row.person_id,
  teamId: row.team_id,
  type: row.type,
  status: row.status,
  severity: row.severity,
  raisedOn: row.raised_on,
  updatedOn: row.updated_on,
  resolvedOn: row.resolved_on ?? undefined,
  note: row.note ?? undefined,
});

const mapHistoryEvent = (row: any): RelationshipHistoryEvent => ({
  id: row.id,
  personId: row.person_id,
  teamId: row.team_id ?? undefined,
  managerProfileId: row.manager_profile_id ?? undefined,
  eventType: row.event_type,
  occurredOn: row.occurred_on,
  data: json.parse(row.data_json, undefined),
});

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

  /**
   * Idempotent by match id, so re-finalising a completed match is a no-op
   * rather than a primary-key error.
   */
  insertMatch(match: Match, attendance?: number): void {
    this.db
      .prepare(
        `INSERT INTO matches (
           id, fixture_id, played_date, home_goals, away_goals, attendance,
           winner_team_id, went_to_extra_time, shootout_home_goals, shootout_away_goals
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        match.id,
        match.fixtureId,
        match.playedDate ?? null,
        match.homeGoals ?? null,
        match.awayGoals ?? null,
        attendance ?? null,
        match.winnerTeamId ?? null,
        match.wentToExtraTime ? 1 : null,
        match.shootoutHomeGoals ?? null,
        match.shootoutAwayGoals ?? null,
      );
  }

  insertMatchEvent(event: MatchEvent): void {
    const personId = event.personId ?? event.primaryPersonId ?? undefined;
    const primaryPersonId = event.primaryPersonId ?? undefined;
    const secondaryPersonId = event.secondaryPersonId ?? undefined;
    const teamId = event.teamId ?? undefined;
    this.db
      .prepare(
        `INSERT INTO match_events
        (id, match_id, minute, stoppage_time, type, person_id, team_id, primary_person_id, secondary_person_id, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        event.id,
        event.matchId,
        event.minute ?? null,
        event.stoppageTime ?? null,
        event.type,
        personId && this.personExists(personId) ? personId : null,
        teamId && this.teamExists(teamId) ? teamId : null,
        primaryPersonId && this.personExists(primaryPersonId) ? primaryPersonId : null,
        secondaryPersonId && this.personExists(secondaryPersonId) ? secondaryPersonId : null,
        event.data ? json.stringify(event.data) : null,
      );
  }

  private personExists(personId: EntityId): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM persons WHERE id = ?").get(personId));
  }

  private teamExists(teamId: EntityId): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM teams WHERE id = ?").get(teamId));
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

  winnersForTeam(teamId: EntityId): CompetitionWinner[] {
    return this.db
      .prepare("SELECT * FROM competition_winners WHERE team_id = ? ORDER BY decided_on DESC")
      .all(teamId)
      .map((row: any) => ({
        id: row.id,
        competitionSeasonId: row.competition_season_id,
        teamId: row.team_id,
        decidedOn: row.decided_on,
      }));
  }
}

/** Live match sessions and per-match player lines. */
export class MatchSessionRepository {
  constructor(private readonly db: GameDatabase) {}

  upsertSession(session: MatchSessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO match_sessions
        (id, fixture_id, match_id, status, period, minute, stoppage_time, home_goals, away_goals,
          seed, rng_state, state_json, view_mode, started_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fixture_id) DO UPDATE SET
          status = excluded.status,
          period = excluded.period,
          minute = excluded.minute,
          stoppage_time = excluded.stoppage_time,
          home_goals = excluded.home_goals,
          away_goals = excluded.away_goals,
          rng_state = excluded.rng_state,
          state_json = excluded.state_json,
          view_mode = excluded.view_mode,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at`,
      )
      .run(
        session.id,
        session.fixtureId,
        session.matchId,
        session.status,
        session.period,
        session.minute,
        session.stoppageTime,
        session.homeGoals,
        session.awayGoals,
        session.seed,
        session.rngState,
        session.stateJson,
        session.viewMode ?? null,
        session.startedAt,
        session.updatedAt,
        session.completedAt ?? null,
      );
  }

  sessionForFixture(fixtureId: EntityId): MatchSessionRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM match_sessions WHERE fixture_id = ?")
      .get(fixtureId) as any;
    return row ? mapMatchSession(row) : undefined;
  }

  activeSessions(): MatchSessionRecord[] {
    return this.db
      .prepare("SELECT * FROM match_sessions WHERE status != 'COMPLETED' ORDER BY started_at")
      .all()
      .map(mapMatchSession);
  }

  deleteSession(fixtureId: EntityId): void {
    this.db.prepare("DELETE FROM match_sessions WHERE fixture_id = ?").run(fixtureId);
  }

  upsertRating(rating: PlayerMatchRatingRecord): void {
    this.db
      .prepare(
        `INSERT INTO player_match_ratings
        (match_id, player_id, team_id, position, role, started, subbed_on_minute, subbed_off_minute,
          sent_off_minute, minutes, rating, goals, assists, shots, shots_on_target, key_passes,
          passes_attempted, passes_completed, tackles, interceptions, saves, yellow_cards, red_card)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(match_id, player_id) DO UPDATE SET
          minutes = excluded.minutes,
          rating = excluded.rating,
          goals = excluded.goals,
          assists = excluded.assists,
          shots = excluded.shots,
          shots_on_target = excluded.shots_on_target,
          key_passes = excluded.key_passes,
          passes_attempted = excluded.passes_attempted,
          passes_completed = excluded.passes_completed,
          tackles = excluded.tackles,
          interceptions = excluded.interceptions,
          saves = excluded.saves,
          yellow_cards = excluded.yellow_cards,
          red_card = excluded.red_card,
          subbed_on_minute = excluded.subbed_on_minute,
          subbed_off_minute = excluded.subbed_off_minute,
          sent_off_minute = excluded.sent_off_minute`,
      )
      .run(
        rating.matchId,
        rating.playerId,
        rating.teamId,
        rating.position ?? null,
        rating.role ?? null,
        rating.started ? 1 : 0,
        rating.subbedOnMinute ?? null,
        rating.subbedOffMinute ?? null,
        rating.sentOffMinute ?? null,
        rating.minutes,
        rating.rating,
        rating.goals,
        rating.assists,
        rating.shots,
        rating.shotsOnTarget,
        rating.keyPasses,
        rating.passesAttempted,
        rating.passesCompleted,
        rating.tackles,
        rating.interceptions,
        rating.saves,
        rating.yellowCards,
        rating.redCard ? 1 : 0,
      );
  }

  ratingsForMatch(matchId: EntityId): PlayerMatchRatingRecord[] {
    return this.db
      .prepare("SELECT * FROM player_match_ratings WHERE match_id = ? ORDER BY rating DESC")
      .all(matchId)
      .map(mapPlayerMatchRating);
  }
}

const mapMatchSession = (row: any): MatchSessionRecord => ({
  id: row.id,
  fixtureId: row.fixture_id,
  matchId: row.match_id,
  status: row.status,
  period: row.period,
  minute: row.minute,
  stoppageTime: row.stoppage_time,
  homeGoals: row.home_goals,
  awayGoals: row.away_goals,
  seed: row.seed,
  rngState: row.rng_state,
  stateJson: row.state_json,
  viewMode: row.view_mode ?? undefined,
  startedAt: row.started_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at ?? undefined,
});

const mapPlayerMatchRating = (row: any): PlayerMatchRatingRecord => ({
  matchId: row.match_id,
  playerId: row.player_id,
  teamId: row.team_id,
  position: row.position ?? undefined,
  role: row.role ?? undefined,
  started: Boolean(row.started),
  subbedOnMinute: row.subbed_on_minute ?? undefined,
  subbedOffMinute: row.subbed_off_minute ?? undefined,
  sentOffMinute: row.sent_off_minute ?? undefined,
  minutes: row.minutes,
  rating: row.rating,
  goals: row.goals,
  assists: row.assists,
  shots: row.shots,
  shotsOnTarget: row.shots_on_target,
  keyPasses: row.key_passes,
  passesAttempted: row.passes_attempted,
  passesCompleted: row.passes_completed,
  tackles: row.tackles,
  interceptions: row.interceptions,
  saves: row.saves,
  yellowCards: row.yellow_cards,
  redCard: Boolean(row.red_card),
});

export class RecruitmentRepository {
  constructor(private readonly db: GameDatabase) {}

  upsertPlayerKnowledge(knowledge: PlayerKnowledge): void {
    this.db
      .prepare(
        `INSERT INTO player_knowledge
        (id, observer_type, observer_organisation_id, player_id, discovery_status,
          knowledge_level, confidence, source_type, identity_json, position_json, ability_json,
          potential_json, contract_json, personality_json, medical_json, career_json,
          observations, last_observed_at, last_scouted_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(observer_type, observer_organisation_id, player_id) DO UPDATE SET
          discovery_status = excluded.discovery_status,
          knowledge_level = excluded.knowledge_level,
          confidence = excluded.confidence,
          source_type = excluded.source_type,
          identity_json = excluded.identity_json,
          position_json = excluded.position_json,
          ability_json = excluded.ability_json,
          potential_json = excluded.potential_json,
          contract_json = excluded.contract_json,
          personality_json = excluded.personality_json,
          medical_json = excluded.medical_json,
          career_json = excluded.career_json,
          observations = excluded.observations,
          last_observed_at = excluded.last_observed_at,
          last_scouted_at = excluded.last_scouted_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        knowledge.id,
        knowledge.observerType,
        knowledge.observerOrganisationId,
        knowledge.playerId,
        knowledge.discoveryStatus,
        knowledge.knowledgeLevel,
        knowledge.confidence,
        knowledge.sourceType,
        json.stringify(knowledge.identityKnowledge),
        json.stringify(knowledge.positionKnowledge),
        json.stringify(knowledge.abilityKnowledge),
        json.stringify(knowledge.potentialKnowledge),
        json.stringify(knowledge.contractKnowledge),
        json.stringify(knowledge.personalityKnowledge),
        json.stringify(knowledge.medicalKnowledge),
        json.stringify(knowledge.careerKnowledge),
        knowledge.observations,
        knowledge.lastObservedAt ?? null,
        knowledge.lastScoutedAt ?? null,
        knowledge.updatedAt,
      );
  }

  playerKnowledge(clubId: EntityId, playerId: EntityId): PlayerKnowledge | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM player_knowledge
        WHERE observer_type = 'CLUB' AND observer_organisation_id = ? AND player_id = ?`,
      )
      .get(clubId, playerId) as any;
    return row ? mapPlayerKnowledge(row) : undefined;
  }

  playerKnowledgeForClub(clubId: EntityId): PlayerKnowledge[] {
    return this.db
      .prepare(
        `SELECT * FROM player_knowledge
        WHERE observer_type = 'CLUB' AND observer_organisation_id = ?
        ORDER BY updated_at DESC, player_id`,
      )
      .all(clubId)
      .map(mapPlayerKnowledge);
  }

  upsertClubRecruitmentProfile(profile: ClubRecruitmentProfile): void {
    this.db
      .prepare(
        `INSERT INTO club_recruitment_profiles
        (id, club_id, domestic_knowledge, regional_knowledge, international_knowledge,
          scouting_budget, network_reach, preferred_markets_json, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(club_id) DO UPDATE SET
          domestic_knowledge = excluded.domestic_knowledge,
          regional_knowledge = excluded.regional_knowledge,
          international_knowledge = excluded.international_knowledge,
          scouting_budget = excluded.scouting_budget,
          network_reach = excluded.network_reach,
          preferred_markets_json = excluded.preferred_markets_json,
          status = excluded.status`,
      )
      .run(
        profile.id,
        profile.clubId,
        profile.domesticKnowledge,
        profile.regionalKnowledge,
        profile.internationalKnowledge,
        profile.scoutingBudget,
        profile.networkReach,
        json.stringify(profile.preferredMarkets),
        profile.status,
      );
  }

  clubRecruitmentProfile(clubId: EntityId): ClubRecruitmentProfile | undefined {
    const row = this.db
      .prepare("SELECT * FROM club_recruitment_profiles WHERE club_id = ?")
      .get(clubId) as any;
    return row ? mapClubRecruitmentProfile(row) : undefined;
  }

  upsertScoutingStaffSimulationProfile(profile: ScoutingStaffSimulationProfile): void {
    this.db
      .prepare(
        `INSERT INTO scouting_staff_simulation_profiles
        (id, person_id, player_judgement, potential_judgement, adaptability,
          regional_knowledge, assignment_speed, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(person_id) DO UPDATE SET
          player_judgement = excluded.player_judgement,
          potential_judgement = excluded.potential_judgement,
          adaptability = excluded.adaptability,
          regional_knowledge = excluded.regional_knowledge,
          assignment_speed = excluded.assignment_speed,
          status = excluded.status`,
      )
      .run(
        profile.id,
        profile.personId,
        profile.playerJudgement,
        profile.potentialJudgement,
        profile.adaptability,
        profile.regionalKnowledge,
        profile.assignmentSpeed,
        profile.status,
      );
  }

  insertAssignment(assignment: ScoutingAssignment): void {
    this.db
      .prepare(
        `INSERT INTO scouting_assignments
        (id, club_id, scout_person_id, assignment_type, target_player_id, target_club_id,
          target_competition_id, target_location_id, started_at, expected_completion_at,
          status, priority)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status`,
      )
      .run(
        assignment.id,
        assignment.clubId,
        assignment.scoutPersonId ?? null,
        assignment.assignmentType,
        assignment.targetPlayerId ?? null,
        assignment.targetClubId ?? null,
        assignment.targetCompetitionId ?? null,
        assignment.targetLocationId ?? null,
        assignment.startedAt,
        assignment.expectedCompletionAt,
        assignment.status,
        assignment.priority,
      );
  }

  activeAssignments(worldDate: string): ScoutingAssignment[] {
    return this.db
      .prepare(
        `SELECT * FROM scouting_assignments
        WHERE status IN ('QUEUED', 'ACTIVE') AND expected_completion_at <= ?
        ORDER BY priority DESC, expected_completion_at, id`,
      )
      .all(worldDate)
      .map(mapScoutingAssignment);
  }

  markAssignmentCompleted(id: EntityId): void {
    this.db.prepare("UPDATE scouting_assignments SET status = 'COMPLETED' WHERE id = ?").run(id);
  }

  insertScoutReport(report: ScoutReport): void {
    this.db
      .prepare(
        `INSERT INTO scout_reports
        (id, player_id, observer_club_id, scout_id, estimated_ability_json,
          estimated_potential_band, strengths_json, weaknesses_json, position_assessment,
          role_assessment, personality_assessment, medical_assessment, recommendation,
          confidence, observations, generated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        report.id,
        report.playerId,
        report.observerClubId,
        report.scoutId ?? null,
        json.stringify(report.estimatedAbilityBand),
        report.estimatedPotentialBand,
        json.stringify(report.strengths),
        json.stringify(report.weaknesses),
        report.positionAssessment,
        report.roleAssessment,
        report.personalityAssessment,
        report.medicalAssessment,
        report.recommendation,
        report.confidence,
        report.observations,
        report.generatedAt,
      );
  }

  addShortlistItem(item: ClubShortlistItem): void {
    this.db
      .prepare(
        `INSERT INTO club_shortlist
        (id, club_id, player_id, added_at, priority, notes, scouting_status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(club_id, player_id) DO UPDATE SET
          priority = excluded.priority,
          notes = excluded.notes,
          scouting_status = excluded.scouting_status`,
      )
      .run(
        item.id,
        item.clubId,
        item.playerId,
        item.addedAt,
        item.priority,
        item.notes ?? null,
        item.scoutingStatus,
      );
  }

  removeShortlistItem(clubId: EntityId, playerId: EntityId): void {
    this.db
      .prepare("DELETE FROM club_shortlist WHERE club_id = ? AND player_id = ?")
      .run(clubId, playerId);
  }

  shortlist(clubId: EntityId): ClubShortlistItem[] {
    return this.db
      .prepare("SELECT * FROM club_shortlist WHERE club_id = ? ORDER BY added_at DESC")
      .all(clubId)
      .map(mapClubShortlistItem);
  }
}

export class TransferMarketRepository {
  constructor(private readonly db: GameDatabase) {}

  upsertPlayerContract(contract: PlayerContractRecord): void {
    this.db
      .prepare(
        `INSERT INTO player_contracts
        (id, player_id, club_id, start_date, end_date, contract_type, salary,
          appearance_fee, goal_bonus, clean_sheet_bonus, signing_bonus, loyalty_bonus,
          currency, squad_role, release_clause, status, provenance_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          club_id = excluded.club_id,
          start_date = excluded.start_date,
          end_date = excluded.end_date,
          contract_type = excluded.contract_type,
          salary = excluded.salary,
          appearance_fee = excluded.appearance_fee,
          goal_bonus = excluded.goal_bonus,
          clean_sheet_bonus = excluded.clean_sheet_bonus,
          signing_bonus = excluded.signing_bonus,
          loyalty_bonus = excluded.loyalty_bonus,
          currency = excluded.currency,
          squad_role = excluded.squad_role,
          release_clause = excluded.release_clause,
          status = excluded.status,
          provenance_json = excluded.provenance_json`,
      )
      .run(
        contract.id,
        contract.playerId,
        contract.clubId,
        contract.startDate,
        contract.endDate,
        contract.contractType,
        contract.salary,
        contract.appearanceFee,
        contract.goalBonus,
        contract.cleanSheetBonus,
        contract.signingBonus,
        contract.loyaltyBonus,
        contract.currency,
        contract.squadRole,
        contract.releaseClause ?? null,
        contract.status,
        json.stringify(contract.provenance),
      );
  }

  activeContract(playerId: EntityId, date: string): PlayerContractRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM player_contracts
        WHERE player_id = ? AND status = 'ACTIVE' AND start_date <= ? AND end_date >= ?
        ORDER BY end_date DESC LIMIT 1`,
      )
      .get(playerId, date, date) as any;
    return row ? mapPlayerContract(row) : undefined;
  }

  activeContractsForClub(clubId: EntityId, date: string): PlayerContractRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM player_contracts
        WHERE club_id = ? AND status = 'ACTIVE' AND start_date <= ? AND end_date >= ?
        ORDER BY player_id`,
      )
      .all(clubId, date, date)
      .map(mapPlayerContract);
  }

  allPlayerContracts(): PlayerContractRecord[] {
    return this.db
      .prepare("SELECT * FROM player_contracts ORDER BY player_id, start_date")
      .all()
      .map(mapPlayerContract);
  }

  expiringContracts(date: string): PlayerContractRecord[] {
    return this.db
      .prepare("SELECT * FROM player_contracts WHERE status = 'ACTIVE' AND end_date <= ?")
      .all(date)
      .map(mapPlayerContract);
  }

  contractsExpiringBetween(from: string, to: string): PlayerContractRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM player_contracts WHERE status = 'ACTIVE' AND end_date >= ? AND end_date <= ?",
      )
      .all(from, to)
      .map(mapPlayerContract);
  }

  markContractStatus(id: EntityId, status: PlayerContractRecord["status"]): void {
    this.db.prepare("UPDATE player_contracts SET status = ? WHERE id = ?").run(status, id);
  }

  upsertTransferWindow(window: TransferWindow): void {
    this.db
      .prepare(
        `INSERT INTO transfer_windows
        (id, country_id, competition_id, window_type, open_date, close_date,
          registration_deadline, status, provenance_json, rules_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          rules_json = excluded.rules_json`,
      )
      .run(
        window.id,
        window.countryId,
        window.competitionId ?? null,
        window.windowType,
        window.openDate,
        window.closeDate,
        window.registrationDeadline,
        window.status,
        json.stringify(window.provenance),
        json.stringify(window.rules),
      );
  }

  transferWindows(): TransferWindow[] {
    return this.db
      .prepare("SELECT * FROM transfer_windows ORDER BY open_date, id")
      .all()
      .map(mapTransferWindow);
  }

  openTransferWindows(date: string): TransferWindow[] {
    return this.db
      .prepare("SELECT * FROM transfer_windows WHERE open_date <= ? AND close_date >= ?")
      .all(date, date)
      .map(mapTransferWindow);
  }

  upsertClubFinancialProfile(profile: ClubFinancialProfile): void {
    this.db
      .prepare(
        `INSERT INTO club_financial_profiles
        (id, club_id, wage_budget, transfer_budget, current_wage_spend,
          financial_health, currency, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(club_id) DO UPDATE SET
          wage_budget = excluded.wage_budget,
          transfer_budget = excluded.transfer_budget,
          current_wage_spend = excluded.current_wage_spend,
          financial_health = excluded.financial_health`,
      )
      .run(
        profile.id,
        profile.clubId,
        profile.wageBudget,
        profile.transferBudget,
        profile.currentWageSpend,
        profile.financialHealth,
        profile.currency,
        profile.status,
      );
  }

  clubFinancialProfile(clubId: EntityId): ClubFinancialProfile | undefined {
    const row = this.db
      .prepare("SELECT * FROM club_financial_profiles WHERE club_id = ?")
      .get(clubId) as any;
    return row ? mapClubFinancialProfile(row) : undefined;
  }

  upsertClubEmploymentProfile(profile: ClubEmploymentProfile): void {
    this.db
      .prepare(
        `INSERT INTO club_employment_profiles
        (id, club_id, employment_model, contract_profile, status)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(club_id) DO UPDATE SET
          employment_model = excluded.employment_model,
          contract_profile = excluded.contract_profile`,
      )
      .run(
        profile.id,
        profile.clubId,
        profile.employmentModel,
        profile.contractProfile,
        profile.status,
      );
  }

  clubEmploymentProfile(clubId: EntityId): ClubEmploymentProfile | undefined {
    const row = this.db
      .prepare("SELECT * FROM club_employment_profiles WHERE club_id = ?")
      .get(clubId) as any;
    return row ? mapClubEmploymentProfile(row) : undefined;
  }

  upsertTransferStatus(status: PlayerTransferStatusRecord): void {
    this.db
      .prepare(
        `INSERT INTO player_transfer_statuses
        (id, player_id, club_id, status, reason, set_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id) DO UPDATE SET
          club_id = excluded.club_id,
          status = excluded.status,
          reason = excluded.reason,
          set_by = excluded.set_by,
          updated_at = excluded.updated_at`,
      )
      .run(
        status.id,
        status.playerId,
        status.clubId ?? null,
        status.status,
        status.reason,
        status.setBy,
        status.updatedAt,
      );
  }

  transferStatus(playerId: EntityId): PlayerTransferStatusRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM player_transfer_statuses WHERE player_id = ?")
      .get(playerId) as any;
    return row ? mapPlayerTransferStatus(row) : undefined;
  }

  upsertTransferRequest(request: PlayerTransferRequest): void {
    this.db
      .prepare(
        `INSERT INTO player_transfer_requests
        (id, player_id, club_id, requested_at, reason, pressure_score, status,
          asking_context_json, decided_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          reason = excluded.reason,
          pressure_score = excluded.pressure_score,
          status = excluded.status,
          asking_context_json = excluded.asking_context_json,
          decided_at = excluded.decided_at`,
      )
      .run(
        request.id,
        request.playerId,
        request.clubId,
        request.requestedAt,
        request.reason,
        request.pressureScore,
        request.status,
        request.askingContext ? json.stringify(request.askingContext) : null,
        request.decidedAt ?? null,
      );
  }

  transferRequests(playerId?: EntityId): PlayerTransferRequest[] {
    const rows = playerId
      ? this.db
          .prepare(
            "SELECT * FROM player_transfer_requests WHERE player_id = ? ORDER BY requested_at, id",
          )
          .all(playerId)
      : this.db.prepare("SELECT * FROM player_transfer_requests ORDER BY requested_at, id").all();
    return rows.map(mapPlayerTransferRequest);
  }

  upsertAgent(agent: AgentProfile): void {
    this.db
      .prepare(
        `INSERT INTO agents
        (id, person_id, agency_name, reputation, negotiation_style, aggressiveness,
          loyalty_preference, fee_expectation, career_ambition, status, negotiation_skill,
          network_scope, preferred_markets_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(person_id) DO UPDATE SET
          reputation = excluded.reputation,
          negotiation_skill = excluded.negotiation_skill,
          negotiation_style = excluded.negotiation_style,
          aggressiveness = excluded.aggressiveness,
          loyalty_preference = excluded.loyalty_preference,
          fee_expectation = excluded.fee_expectation,
          career_ambition = excluded.career_ambition,
          network_scope = excluded.network_scope,
          preferred_markets_json = excluded.preferred_markets_json`,
      )
      .run(
        agent.id,
        agent.personId,
        agent.agencyName ?? null,
        agent.reputation,
        agent.negotiationStyle,
        agent.aggressiveness,
        agent.loyaltyPreference,
        agent.feeExpectation,
        agent.careerAmbition,
        agent.status,
        agent.negotiationSkill,
        agent.networkScope,
        json.stringify(agent.preferredMarkets),
      );
  }

  agents(): AgentProfile[] {
    return this.db.prepare("SELECT * FROM agents ORDER BY id").all().map(mapAgentProfile);
  }

  upsertAgentClient(client: AgentClient): void {
    this.db
      .prepare(
        `INSERT INTO agent_clients
        (id, agent_id, player_id, started_at, status)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(player_id, status) DO UPDATE SET agent_id = excluded.agent_id`,
      )
      .run(client.id, client.agentId, client.playerId, client.startedAt, client.status);
  }

  agentForPlayer(playerId: EntityId): AgentProfile | undefined {
    const row = this.db
      .prepare(
        `SELECT a.*
        FROM agents a
        JOIN agent_clients ac ON ac.agent_id = a.id
        WHERE ac.player_id = ? AND ac.status = 'ACTIVE'`,
      )
      .get(playerId) as any;
    return row ? mapAgentProfile(row) : undefined;
  }

  agentClients(playerId?: EntityId): AgentClient[] {
    const rows = playerId
      ? this.db
          .prepare("SELECT * FROM agent_clients WHERE player_id = ? ORDER BY started_at, id")
          .all(playerId)
      : this.db.prepare("SELECT * FROM agent_clients ORDER BY player_id, started_at, id").all();
    return rows.map(mapAgentClient);
  }

  endActiveAgentClient(playerId: EntityId): void {
    this.db
      .prepare(
        "UPDATE agent_clients SET status = 'ENDED' WHERE player_id = ? AND status = 'ACTIVE'",
      )
      .run(playerId);
  }

  insertAgentApproach(approach: AgentApproachRecord): void {
    this.db
      .prepare(
        `INSERT INTO agent_approaches
        (id, agent_id, player_id, approached_at, trigger, interest_score, network_scope,
          decision, decided_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          decision = excluded.decision,
          decided_at = excluded.decided_at`,
      )
      .run(
        approach.id,
        approach.agentId,
        approach.playerId,
        approach.approachedAt,
        approach.trigger,
        approach.interestScore,
        approach.networkScope,
        approach.decision,
        approach.decidedAt ?? null,
      );
  }

  agentApproaches(playerId?: EntityId): AgentApproachRecord[] {
    const rows = playerId
      ? this.db
          .prepare("SELECT * FROM agent_approaches WHERE player_id = ? ORDER BY approached_at, id")
          .all(playerId)
      : this.db.prepare("SELECT * FROM agent_approaches ORDER BY approached_at, id").all();
    return rows.map(mapAgentApproach);
  }

  insertTransferOffer(offer: TransferOffer): void {
    this.db
      .prepare(
        `INSERT INTO transfer_offers
        (id, buying_club_id, selling_club_id, player_id, offer_type, transfer_fee,
          installments, addons, sell_on_percentage, submitted_at, expires_at, status,
          currency, asking_range_json, agent_fee, signing_fee, buyer_perceived_value_json,
          seller_internal_value_json, player_desire_to_move, conditionals_json,
          player_exchanges_json, seller_requested_player_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          transfer_fee = excluded.transfer_fee,
          installments = excluded.installments,
          addons = excluded.addons,
          sell_on_percentage = excluded.sell_on_percentage,
          expires_at = excluded.expires_at,
          asking_range_json = excluded.asking_range_json,
          buyer_perceived_value_json = excluded.buyer_perceived_value_json,
          seller_internal_value_json = excluded.seller_internal_value_json,
          player_desire_to_move = excluded.player_desire_to_move,
          conditionals_json = excluded.conditionals_json,
          player_exchanges_json = excluded.player_exchanges_json,
          seller_requested_player_id = excluded.seller_requested_player_id`,
      )
      .run(
        offer.id,
        offer.buyingClubId,
        offer.sellingClubId ?? null,
        offer.playerId,
        offer.offerType,
        offer.transferFee,
        offer.installments,
        offer.addOns,
        offer.sellOnPercentage,
        offer.submittedAt,
        offer.expiresAt,
        offer.status,
        offer.currency,
        offer.askingRange ? json.stringify(offer.askingRange) : null,
        offer.agentFee,
        offer.signingFee,
        offer.buyerPerceivedValue ? json.stringify(offer.buyerPerceivedValue) : null,
        offer.sellerInternalValue ? json.stringify(offer.sellerInternalValue) : null,
        offer.playerDesireToMove ?? null,
        offer.conditionals ? json.stringify(offer.conditionals) : null,
        offer.playerExchanges ? json.stringify(offer.playerExchanges) : null,
        offer.sellerRequestedPlayerId ?? null,
      );
  }

  updateOfferStatus(id: EntityId, status: TransferOffer["status"]): void {
    this.db.prepare("UPDATE transfer_offers SET status = ? WHERE id = ?").run(status, id);
  }

  transferOffers(): TransferOffer[] {
    return this.db
      .prepare("SELECT * FROM transfer_offers ORDER BY submitted_at, id")
      .all()
      .map(mapTransferOffer);
  }

  insertNegotiationRound(round: NegotiationRound): void {
    this.db
      .prepare(
        `INSERT INTO negotiation_rounds
        (id, offer_id, round_number, actor, action, salary, squad_role,
          contract_length_months, agent_fee, signing_fee, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        round.id,
        round.offerId,
        round.roundNumber,
        round.actor,
        round.action,
        round.salary ?? null,
        round.squadRole ?? null,
        round.contractLengthMonths ?? null,
        round.agentFee ?? null,
        round.signingFee ?? null,
        round.message,
        round.createdAt,
      );
  }

  negotiationRounds(offerId: EntityId): NegotiationRound[] {
    return this.db
      .prepare("SELECT * FROM negotiation_rounds WHERE offer_id = ? ORDER BY round_number, id")
      .all(offerId)
      .map(mapNegotiationRound);
  }

  upsertLoan(loan: PlayerLoanRecord): void {
    this.db
      .prepare(
        `INSERT INTO player_loans
        (id, parent_club_id, loan_club_id, player_id, start_date, end_date,
          wage_contribution_percent, loan_fee, playing_time_expectation, recall_allowed,
          purchase_option, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status`,
      )
      .run(
        loan.id,
        loan.parentClubId,
        loan.loanClubId,
        loan.playerId,
        loan.startDate,
        loan.endDate,
        loan.wageContributionPercent,
        loan.loanFee ?? null,
        loan.playingTimeExpectation,
        Number(loan.recallAllowed),
        loan.purchaseOption ?? null,
        loan.status,
      );
  }

  activeLoans(date: string): PlayerLoanRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM player_loans WHERE status = 'ACTIVE' AND start_date <= ? AND end_date >= ?",
      )
      .all(date, date)
      .map(mapPlayerLoan);
  }

  endingLoans(date: string): PlayerLoanRecord[] {
    return this.db
      .prepare("SELECT * FROM player_loans WHERE status = 'ACTIVE' AND end_date <= ?")
      .all(date)
      .map(mapPlayerLoan);
  }

  upsertCompetitionRegistration(registration: CompetitionRegistration): void {
    this.db
      .prepare(
        `INSERT INTO competition_registrations
        (id, player_id, club_id, competition_season_id, registration_type,
          registered_from, registered_until, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id, competition_season_id, registration_type) DO UPDATE SET
          club_id = excluded.club_id,
          registered_until = excluded.registered_until,
          status = excluded.status`,
      )
      .run(
        registration.id,
        registration.playerId,
        registration.clubId,
        registration.competitionSeasonId,
        registration.registrationType,
        registration.registeredFrom,
        registration.registeredUntil ?? null,
        registration.status,
      );
  }

  competitionRegistrations(): CompetitionRegistration[] {
    return this.db
      .prepare("SELECT * FROM competition_registrations ORDER BY id")
      .all()
      .map(mapCompetitionRegistration);
  }

  insertTransferHistoryEvent(event: TransferHistoryEvent): void {
    this.db
      .prepare(
        `INSERT INTO transfer_history_events
        (id, player_id, club_id, related_club_id, event_type, occurred_on, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        event.id,
        event.playerId,
        event.clubId ?? null,
        event.relatedClubId ?? null,
        event.eventType,
        event.occurredOn,
        event.data ? json.stringify(event.data) : null,
      );
  }

  transferHistory(): TransferHistoryEvent[] {
    return this.db
      .prepare("SELECT * FROM transfer_history_events ORDER BY occurred_on, id")
      .all()
      .map(mapTransferHistoryEvent);
  }

  upsertSquadNeedReport(report: SquadNeedReport): void {
    this.db
      .prepare(
        `INSERT INTO squad_need_reports
        (id, club_id, generated_at, needs_json, expected_departures)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(club_id, generated_at) DO UPDATE SET
          needs_json = excluded.needs_json,
          expected_departures = excluded.expected_departures`,
      )
      .run(
        report.id,
        report.clubId,
        report.generatedAt,
        json.stringify(report.needs),
        report.expectedDepartures,
      );
  }

  updatePlayerClub(playerId: EntityId, clubId: EntityId | undefined): void {
    this.db
      .prepare("UPDATE player_factual_profiles SET current_club_id = ? WHERE player_id = ?")
      .run(clubId ?? null, playerId);
  }

  endActiveTeamAssignments(playerId: EntityId, endedOn: string): void {
    this.db
      .prepare(
        `UPDATE team_person_assignments SET ended_on = ?
        WHERE person_id = ? AND role = 'PLAYER' AND ended_on IS NULL`,
      )
      .run(endedOn, playerId);
  }

  insertTeamAssignment(assignment: TeamPersonAssignment): void {
    this.db
      .prepare(
        `INSERT INTO team_person_assignments
        (id, person_id, team_id, role, started_on, ended_on)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
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
}

export class YouthRepository {
  constructor(private readonly db: GameDatabase) {}

  upsertCountryDevelopmentProfile(profile: CountryDevelopmentProfile): void {
    this.db
      .prepare(
        `INSERT INTO country_development_profiles
        (id, country_id, effective_from, football_popularity, grassroots_reach, coaching_quality,
          youth_infrastructure, talent_conversion, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(country_id, effective_from) DO UPDATE SET
          football_popularity = excluded.football_popularity,
          grassroots_reach = excluded.grassroots_reach,
          coaching_quality = excluded.coaching_quality,
          youth_infrastructure = excluded.youth_infrastructure,
          talent_conversion = excluded.talent_conversion,
          status = excluded.status,
          notes = excluded.notes`,
      )
      .run(
        profile.id,
        profile.countryId,
        profile.effectiveFrom,
        profile.footballPopularity,
        profile.grassrootsReach,
        profile.coachingQuality,
        profile.youthInfrastructure,
        profile.talentConversion,
        profile.status,
        profile.notes ?? null,
      );
  }

  latestCountryDevelopmentProfile(countryId: EntityId): CountryDevelopmentProfile | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM country_development_profiles
        WHERE country_id = ?
        ORDER BY effective_from DESC LIMIT 1`,
      )
      .get(countryId) as any;
    return row ? mapCountryDevelopmentProfile(row) : undefined;
  }

  upsertAcademySimulationProfile(profile: AcademySimulationProfile): void {
    this.db
      .prepare(
        `INSERT INTO academy_simulation_profiles
        (id, academy_id, club_id, country_id, youth_recruitment_quality, academy_coaching_quality,
          academy_facilities_quality, regional_reach, talent_identification_quality, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          youth_recruitment_quality = excluded.youth_recruitment_quality,
          academy_coaching_quality = excluded.academy_coaching_quality,
          academy_facilities_quality = excluded.academy_facilities_quality,
          regional_reach = excluded.regional_reach,
          talent_identification_quality = excluded.talent_identification_quality,
          status = excluded.status`,
      )
      .run(
        profile.id,
        profile.academyId ?? null,
        profile.clubId ?? null,
        profile.countryId,
        profile.youthRecruitmentQuality,
        profile.academyCoachingQuality,
        profile.academyFacilitiesQuality,
        profile.regionalReach,
        profile.talentIdentificationQuality,
        profile.status,
      );
  }

  academyProfiles(): AcademySimulationProfile[] {
    return this.db
      .prepare("SELECT * FROM academy_simulation_profiles ORDER BY club_id, academy_id, id")
      .all()
      .map(mapAcademySimulationProfile);
  }

  insertYouthIntakeEvent(event: YouthIntakeEvent): void {
    this.db
      .prepare(
        `INSERT INTO youth_intake_events
        (id, country_id, club_id, academy_id, intake_date, season_label, intake_type,
          players_generated, average_current_ability, average_potential, highest_potential,
          status, seed_key, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          players_generated = excluded.players_generated,
          average_current_ability = excluded.average_current_ability,
          average_potential = excluded.average_potential,
          highest_potential = excluded.highest_potential,
          data_json = excluded.data_json`,
      )
      .run(
        event.id,
        event.countryId,
        event.clubId ?? null,
        event.academyId ?? null,
        event.intakeDate,
        event.seasonLabel,
        event.intakeType,
        event.playersGenerated,
        event.averageCurrentAbility,
        event.averagePotential,
        event.highestPotential,
        event.status,
        event.seedKey,
        event.data ? json.stringify(event.data) : null,
      );
  }

  youthIntakeEvents(): YouthIntakeEvent[] {
    return this.db
      .prepare("SELECT * FROM youth_intake_events ORDER BY intake_date, id")
      .all()
      .map(mapYouthIntakeEvent);
  }

  hasIntakeForSeason(seasonLabel: string): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM youth_intake_events WHERE season_label = ?")
      .get(seasonLabel) as any;
    return Number(row?.count ?? 0) > 0;
  }

  insertGeneratedPlayerOrigin(origin: GeneratedPlayerOrigin): void {
    this.db
      .prepare(
        `INSERT INTO generated_player_origins
        (id, player_id, origin_type, origin_data_type, country_id, club_id, academy_id,
          location_id, district_location_id, intake_event_id, generated_on, name_generation_key,
          archetype, youth_status, eligibility_json, source_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id) DO NOTHING`,
      )
      .run(
        origin.id,
        origin.playerId,
        origin.originType,
        origin.originDataType,
        origin.countryId,
        origin.clubId ?? null,
        origin.academyId ?? null,
        origin.locationId ?? null,
        origin.districtLocationId ?? null,
        origin.intakeEventId ?? null,
        origin.generatedOn,
        origin.nameGenerationKey,
        origin.archetype,
        origin.youthStatus,
        json.stringify(origin.eligibility),
        origin.sourceNotes ?? null,
      );
  }

  generatedPlayerOrigins(): GeneratedPlayerOrigin[] {
    return this.db
      .prepare("SELECT * FROM generated_player_origins ORDER BY generated_on, player_id")
      .all()
      .map(mapGeneratedPlayerOrigin);
  }

  upsertYouthStatus(status: YouthPlayerStatusRecord): void {
    this.db
      .prepare(
        `INSERT INTO youth_player_statuses
        (player_id, youth_status, club_id, academy_id, status_since, pathway_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id) DO UPDATE SET
          youth_status = excluded.youth_status,
          club_id = excluded.club_id,
          academy_id = excluded.academy_id,
          status_since = excluded.status_since,
          pathway_json = excluded.pathway_json`,
      )
      .run(
        status.playerId,
        status.youthStatus,
        status.clubId ?? null,
        status.academyId ?? null,
        status.statusSince,
        json.stringify(status.pathway),
      );
  }

  youthStatuses(): YouthPlayerStatusRecord[] {
    return this.db
      .prepare("SELECT * FROM youth_player_statuses ORDER BY club_id, academy_id, player_id")
      .all()
      .map(mapYouthPlayerStatus);
  }

  updateYouthStatus(playerId: EntityId, status: YouthPlayerStatus, date: string): void {
    this.db
      .prepare(
        "UPDATE youth_player_statuses SET youth_status = ?, status_since = ? WHERE player_id = ?",
      )
      .run(status, date, playerId);
  }

  insertYouthDevelopmentActivity(activity: YouthDevelopmentActivity): void {
    this.db
      .prepare(
        `INSERT INTO youth_development_activity
        (id, player_id, club_id, academy_id, activity_date, activity_type,
          development_minutes, exposure_level, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        activity.id,
        activity.playerId,
        activity.clubId ?? null,
        activity.academyId ?? null,
        activity.activityDate,
        activity.activityType,
        activity.developmentMinutes,
        activity.exposureLevel,
        activity.data ? json.stringify(activity.data) : null,
      );
  }

  upsertRetirementState(record: PlayerRetirementRecord): void {
    this.db
      .prepare(
        `INSERT INTO player_retirement_states
        (player_id, state, decided_on, announced_on, retirement_date, reason, staff_interest, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id) DO UPDATE SET
          state = excluded.state,
          decided_on = excluded.decided_on,
          announced_on = excluded.announced_on,
          retirement_date = excluded.retirement_date,
          reason = excluded.reason,
          staff_interest = excluded.staff_interest,
          data_json = excluded.data_json`,
      )
      .run(
        record.playerId,
        record.state,
        record.decidedOn,
        record.announcedOn ?? null,
        record.retirementDate ?? null,
        record.reason ?? null,
        record.staffInterest,
        record.data ? json.stringify(record.data) : null,
      );
  }

  retirementStates(): PlayerRetirementRecord[] {
    return this.db
      .prepare("SELECT * FROM player_retirement_states ORDER BY decided_on, player_id")
      .all()
      .map(mapPlayerRetirementRecord);
  }

  insertRetiredStaffTransition(transition: RetiredStaffTransition): void {
    this.db
      .prepare(
        `INSERT INTO retired_staff_transitions
        (id, player_id, staff_role, club_id, academy_id, federation_id, transitioned_on, status, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        transition.id,
        transition.playerId,
        transition.staffRole,
        transition.clubId ?? null,
        transition.academyId ?? null,
        transition.federationId ?? null,
        transition.transitionedOn,
        transition.status,
        transition.data ? json.stringify(transition.data) : null,
      );
  }

  staffTransitions(): RetiredStaffTransition[] {
    return this.db
      .prepare("SELECT * FROM retired_staff_transitions ORDER BY transitioned_on, id")
      .all()
      .map(mapRetiredStaffTransition);
  }

  playerPopulation(): {
    totalPlayers: number;
    realImportedPlayers: number;
    generatedPlayers: number;
    activeSeniorAssignments: number;
    retiredPlayers: number;
  } {
    const scalar = (sql: string): number => Number((this.db.prepare(sql).get() as any)?.count ?? 0);
    return {
      totalPlayers: scalar(
        "SELECT COUNT(DISTINCT person_id) AS count FROM person_roles WHERE role = 'PLAYER'",
      ),
      realImportedPlayers: scalar("SELECT COUNT(*) AS count FROM player_factual_profiles"),
      generatedPlayers: scalar("SELECT COUNT(*) AS count FROM generated_player_origins"),
      activeSeniorAssignments: scalar(
        `SELECT COUNT(DISTINCT tpa.person_id) AS count
        FROM team_person_assignments tpa
        JOIN teams t ON t.id = tpa.team_id
        WHERE tpa.role = 'PLAYER' AND tpa.ended_on IS NULL AND t.level = 'senior'`,
      ),
      retiredPlayers: scalar(
        "SELECT COUNT(*) AS count FROM player_retirement_states WHERE state = 'RETIRED'",
      ),
    };
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
        WHERE tpa.team_id = ? AND tpa.role = 'PLAYER' AND tpa.ended_on IS NULL
        ORDER BY pa.person_id`,
      )
      .all(teamId)
      .map(mapAttributes);
  }

  insertFactualProfile(profile: PlayerFactualProfile): void {
    this.db
      .prepare(
        `INSERT INTO player_factual_profiles
        (id, player_id, canonical_external_id, current_club_id, factual_json,
          simulation_json, evidence_json, record_status, confidence_level, last_verified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(canonical_external_id) DO UPDATE SET
          player_id = excluded.player_id,
          current_club_id = excluded.current_club_id,
          factual_json = excluded.factual_json,
          simulation_json = excluded.simulation_json,
          evidence_json = excluded.evidence_json,
          record_status = excluded.record_status,
          confidence_level = excluded.confidence_level,
          last_verified = excluded.last_verified`,
      )
      .run(
        profile.id,
        profile.playerId,
        profile.canonicalExternalId,
        profile.currentClubId ?? null,
        json.stringify({
          nameVariants: profile.nameVariants,
          nepaliName: profile.nepaliName,
          factualPrimaryPosition: profile.factualPrimaryPosition,
          factualSecondaryPositions: profile.factualSecondaryPositions,
          factualPositionGroup: profile.factualPositionGroup,
          positionPrecision: profile.positionPrecision,
          sourcePosition: profile.sourcePosition,
          squadStatus: profile.squadStatus,
          shirtNumber: profile.shirtNumber,
          goalkeeperFlag: profile.goalkeeperFlag,
          latestKnownAppearanceDate: profile.latestKnownAppearanceDate,
          dateOfBirth: profile.dateOfBirth,
          heightCm: profile.heightCm,
          preferredFoot: profile.preferredFoot,
          nationality: profile.nationality,
          placeOfBirth: profile.placeOfBirth,
          previousClubs: profile.previousClubs,
          factualContractStatus: profile.factualContractStatus,
        }),
        json.stringify({
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
        }),
        json.stringify(profile.evidence),
        profile.recordStatus,
        profile.confidenceLevel,
        profile.lastVerified ?? null,
      );
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
        `INSERT INTO suspensions (id, person_id, competition_season_id, reason, matches_remaining)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          matches_remaining = MAX(suspensions.matches_remaining, excluded.matches_remaining)`,
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

const mapCountryDevelopmentProfile = (row: any): CountryDevelopmentProfile => ({
  id: row.id,
  countryId: row.country_id,
  effectiveFrom: row.effective_from,
  footballPopularity: row.football_popularity,
  grassrootsReach: row.grassroots_reach,
  coachingQuality: row.coaching_quality,
  youthInfrastructure: row.youth_infrastructure,
  talentConversion: row.talent_conversion,
  status: row.status,
  notes: row.notes ?? undefined,
});

const mapAcademySimulationProfile = (row: any): AcademySimulationProfile => ({
  id: row.id,
  academyId: row.academy_id ?? undefined,
  clubId: row.club_id ?? undefined,
  countryId: row.country_id,
  youthRecruitmentQuality: row.youth_recruitment_quality,
  academyCoachingQuality: row.academy_coaching_quality,
  academyFacilitiesQuality: row.academy_facilities_quality,
  regionalReach: row.regional_reach,
  talentIdentificationQuality: row.talent_identification_quality,
  status: row.status,
});

const mapYouthIntakeEvent = (row: any): YouthIntakeEvent => ({
  id: row.id,
  countryId: row.country_id,
  clubId: row.club_id ?? undefined,
  academyId: row.academy_id ?? undefined,
  intakeDate: row.intake_date,
  seasonLabel: row.season_label,
  intakeType: row.intake_type,
  playersGenerated: row.players_generated,
  averageCurrentAbility: row.average_current_ability,
  averagePotential: row.average_potential,
  highestPotential: row.highest_potential,
  status: row.status,
  seedKey: row.seed_key,
  data: json.parse<Record<string, unknown> | undefined>(row.data_json, undefined),
});

const mapGeneratedPlayerOrigin = (row: any): GeneratedPlayerOrigin => ({
  id: row.id,
  playerId: row.player_id,
  originType: row.origin_type,
  originDataType: row.origin_data_type,
  countryId: row.country_id,
  clubId: row.club_id ?? undefined,
  academyId: row.academy_id ?? undefined,
  locationId: row.location_id ?? undefined,
  districtLocationId: row.district_location_id ?? undefined,
  intakeEventId: row.intake_event_id ?? undefined,
  generatedOn: row.generated_on,
  nameGenerationKey: row.name_generation_key,
  archetype: row.archetype,
  youthStatus: row.youth_status,
  eligibility: json.parse(row.eligibility_json, {
    nationalityCountryId: row.country_id,
    ageGroupEligible: true,
    diaspora: false,
  }),
  sourceNotes: row.source_notes ?? undefined,
});

const mapYouthPlayerStatus = (row: any): YouthPlayerStatusRecord => ({
  playerId: row.player_id,
  youthStatus: row.youth_status,
  clubId: row.club_id ?? undefined,
  academyId: row.academy_id ?? undefined,
  statusSince: row.status_since,
  pathway: json.parse(row.pathway_json, {}),
});

const mapPlayerRetirementRecord = (row: any): PlayerRetirementRecord => ({
  playerId: row.player_id,
  state: row.state,
  decidedOn: row.decided_on,
  announcedOn: row.announced_on ?? undefined,
  retirementDate: row.retirement_date ?? undefined,
  reason: row.reason ?? undefined,
  staffInterest: row.staff_interest,
  data: json.parse<Record<string, unknown> | undefined>(row.data_json, undefined),
});

const mapRetiredStaffTransition = (row: any): RetiredStaffTransition => ({
  id: row.id,
  playerId: row.player_id,
  staffRole: row.staff_role,
  clubId: row.club_id ?? undefined,
  academyId: row.academy_id ?? undefined,
  federationId: row.federation_id ?? undefined,
  transitionedOn: row.transitioned_on,
  status: row.status,
  data: json.parse<Record<string, unknown> | undefined>(row.data_json, undefined),
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

const mapPlayerKnowledge = (row: any): PlayerKnowledge => ({
  id: row.id,
  observerType: row.observer_type,
  observerOrganisationId: row.observer_organisation_id,
  playerId: row.player_id,
  discoveryStatus: row.discovery_status,
  knowledgeLevel: row.knowledge_level,
  confidence: row.confidence,
  sourceType: row.source_type,
  identityKnowledge: json.parse(row.identity_json, {}),
  positionKnowledge: json.parse(row.position_json, {}),
  abilityKnowledge: json.parse(row.ability_json, {}),
  potentialKnowledge: json.parse(row.potential_json, {}),
  contractKnowledge: json.parse(row.contract_json, {}),
  personalityKnowledge: json.parse(row.personality_json, {}),
  medicalKnowledge: json.parse(row.medical_json, {}),
  careerKnowledge: json.parse(row.career_json, {}),
  observations: row.observations,
  lastObservedAt: row.last_observed_at ?? undefined,
  lastScoutedAt: row.last_scouted_at ?? undefined,
  updatedAt: row.updated_at,
});

const mapClubRecruitmentProfile = (row: any): ClubRecruitmentProfile => ({
  id: row.id,
  clubId: row.club_id,
  domesticKnowledge: row.domestic_knowledge,
  regionalKnowledge: row.regional_knowledge,
  internationalKnowledge: row.international_knowledge,
  scoutingBudget: row.scouting_budget,
  networkReach: row.network_reach,
  preferredMarkets: json.parse(row.preferred_markets_json, []),
  status: row.status,
});

const mapScoutingAssignment = (row: any): ScoutingAssignment => ({
  id: row.id,
  clubId: row.club_id,
  scoutPersonId: row.scout_person_id ?? undefined,
  assignmentType: row.assignment_type,
  targetPlayerId: row.target_player_id ?? undefined,
  targetClubId: row.target_club_id ?? undefined,
  targetCompetitionId: row.target_competition_id ?? undefined,
  targetLocationId: row.target_location_id ?? undefined,
  startedAt: row.started_at,
  expectedCompletionAt: row.expected_completion_at,
  status: row.status,
  priority: row.priority,
});

const mapClubShortlistItem = (row: any): ClubShortlistItem => ({
  id: row.id,
  clubId: row.club_id,
  playerId: row.player_id,
  addedAt: row.added_at,
  priority: row.priority,
  notes: row.notes ?? undefined,
  scoutingStatus: row.scouting_status,
});

const mapPlayerContract = (row: any): PlayerContractRecord => ({
  id: row.id,
  playerId: row.player_id,
  clubId: row.club_id,
  startDate: row.start_date,
  endDate: row.end_date,
  contractType: row.contract_type,
  salary: row.salary,
  appearanceFee: row.appearance_fee,
  goalBonus: row.goal_bonus,
  cleanSheetBonus: row.clean_sheet_bonus,
  signingBonus: row.signing_bonus,
  loyaltyBonus: row.loyalty_bonus,
  currency: row.currency,
  squadRole: row.squad_role,
  releaseClause: row.release_clause ?? undefined,
  status: row.status,
  provenance: json.parse(row.provenance_json, {
    sourceName: "Nepal football simulation",
    confidence: 0,
    status: "SIMULATION_ONLY",
  }),
});

const mapTransferWindow = (row: any): TransferWindow => ({
  id: row.id,
  countryId: row.country_id,
  competitionId: row.competition_id ?? undefined,
  windowType: row.window_type,
  openDate: row.open_date,
  closeDate: row.close_date,
  registrationDeadline: row.registration_deadline,
  status: row.status,
  provenance: json.parse(row.provenance_json, {
    sourceName: "Nepal football simulation",
    confidence: 0,
    status: "SIMULATION_ONLY",
  }),
  rules: json.parse(row.rules_json, {
    freeAgentsAllowedOutsideWindow: true,
    loansAllowed: true,
    youthRegistrationAllowed: true,
    emergencyGoalkeeperAllowed: true,
    domesticOnly: false,
  }),
});

const mapClubFinancialProfile = (row: any): ClubFinancialProfile => ({
  id: row.id,
  clubId: row.club_id,
  wageBudget: row.wage_budget,
  transferBudget: row.transfer_budget,
  currentWageSpend: row.current_wage_spend,
  financialHealth: row.financial_health,
  currency: row.currency,
  status: row.status,
});

const mapClubEmploymentProfile = (row: any): ClubEmploymentProfile => ({
  id: row.id,
  clubId: row.club_id,
  employmentModel: row.employment_model,
  contractProfile: row.contract_profile,
  status: row.status,
});

const mapClubFinancialAccount = (row: any): ClubFinancialAccount => ({
  clubId: row.club_id,
  currency: row.currency,
  cashBalance: row.cash_balance,
  restrictedCash: row.restricted_cash,
  receivables: row.receivables,
  payables: row.payables,
  debtBalance: row.debt_balance,
  equityBalance: row.equity_balance,
  seasonRevenue: row.season_revenue,
  seasonExpenses: row.season_expenses,
  seasonProfitLoss: row.season_profit_loss,
  financialHealth: row.financial_health,
  lastUpdatedAt: row.last_updated_at,
  status: row.status,
});

const mapClubLedgerEntry = (row: any): ClubLedgerEntry => ({
  id: row.id,
  clubId: row.club_id,
  date: row.entry_date,
  category: row.category,
  direction: row.direction,
  amount: row.amount,
  currency: row.currency,
  description: row.description,
  relatedEntityId: row.related_entity_id ?? undefined,
  status: row.status,
});

const mapClubBudget = (row: any): ClubBudget => ({
  id: row.id,
  clubId: row.club_id,
  seasonLabel: row.season_label,
  category: row.category,
  amount: row.amount,
  usedAmount: row.used_amount,
  currency: row.currency,
  status: row.status,
  provenanceStatus: row.provenance_status,
});

const mapClubOwnershipStake = (row: any): ClubOwnershipStake => ({
  id: row.id,
  clubId: row.club_id,
  holderType: row.holder_type,
  holderId: row.holder_id ?? undefined,
  holderName: row.holder_name,
  role: row.role,
  percentage: row.percentage ?? undefined,
  votingPercentage: row.voting_percentage ?? undefined,
  startDate: row.start_date,
  endDate: row.end_date ?? undefined,
  status: row.status,
  ownershipModel: row.ownership_model,
  provenanceStatus: row.provenance_status,
});

const mapPersonalFinancialProfile = (row: any): PersonalFinancialProfile => ({
  personId: row.person_id,
  cash: row.cash,
  investments: row.investments,
  assets: row.assets,
  liabilities: row.liabilities,
  netWorth: row.net_worth,
  currency: row.currency,
  lastUpdatedAt: row.last_updated_at,
  status: row.status,
});

const mapOwnerInvestment = (row: any): OwnerInvestmentTransaction => ({
  id: row.id,
  personId: row.person_id,
  clubId: row.club_id,
  date: row.transaction_date,
  amount: row.amount,
  currency: row.currency,
  form: row.form,
  personalLedgerEntryId: row.personal_ledger_entry_id,
  clubLedgerEntryId: row.club_ledger_entry_id,
  status: row.status,
  provenanceStatus: row.provenance_status,
});

const mapClubDebt = (row: any): ClubDebt => ({
  id: row.id,
  clubId: row.club_id,
  lenderType: row.lender_type,
  principal: row.principal,
  outstandingPrincipal: row.outstanding_principal,
  interestRate: row.interest_rate,
  currency: row.currency,
  startDate: row.start_date,
  maturityDate: row.maturity_date,
  repaymentSchedule: row.repayment_schedule,
  status: row.status,
  provenanceStatus: row.provenance_status,
});

const mapSponsorOrganisation = (row: any): SponsorOrganisation => ({
  id: row.id,
  name: row.name,
  industry: row.industry,
  countryId: row.country_id ?? undefined,
  reputation: row.reputation,
  budgetTier: row.budget_tier,
  status: row.status,
});

const mapClubCommercialProfile = (row: any): ClubCommercialProfile => ({
  clubId: row.club_id,
  brandStrength: row.brand_strength,
  digitalReach: row.digital_reach,
  broadcastAppeal: row.broadcast_appeal,
  merchandiseAppeal: row.merchandise_appeal,
  ticketPriceElasticity: row.ticket_price_elasticity,
  updatedOn: row.updated_on,
  status: row.status,
});

const mapCompetitionMediaRights = (row: any): CompetitionMediaRights => ({
  id: row.id,
  competitionSeasonId: row.competition_season_id,
  rightsPartner: row.rights_partner,
  annualValue: row.annual_value,
  streamingShare: row.streaming_share,
  currency: row.currency,
  status: row.status,
});

const mapSponsorshipContract = (row: any): SponsorshipContract => ({
  id: row.id,
  clubId: row.club_id,
  sponsorId: row.sponsor_id,
  type: row.sponsorship_type,
  startDate: row.start_date,
  endDate: row.end_date,
  annualValue: row.annual_value,
  bonuses: json.parse(row.bonuses_json, {}),
  currency: row.currency,
  status: row.status,
  provenanceStatus: row.provenance_status,
});

const mapClubSupporterProfile = (row: any): ClubSupporterProfile => ({
  clubId: row.club_id,
  coreSupporters: row.core_supporters,
  casualSupporters: row.casual_supporters,
  regionalSupport: row.regional_support,
  diasporaSupport: row.diaspora_support,
  activeSupport: row.active_support,
  familySupport: row.family_support,
  youthSupport: row.youth_support,
  clubPopularity: row.club_popularity,
  footballReputation: row.football_reputation,
  commercialReputation: row.commercial_reputation,
  sentiment: row.sentiment,
  standardTicketPrice: row.standard_ticket_price,
  currency: row.currency,
  status: row.status,
});

const mapClubFacilityProfile = (row: any): ClubFacilityProfile => ({
  clubId: row.club_id,
  trainingFacilityQuality: row.training_facility_quality,
  youthFacilityQuality: row.youth_facility_quality,
  medicalFacilityQuality: row.medical_facility_quality,
  analyticsFacilityQuality: row.analytics_facility_quality,
  academyCapacity: row.academy_capacity,
  monthlyOperatingCost: row.monthly_operating_cost,
  currency: row.currency,
  status: row.status,
});

const mapInfrastructureProject = (row: any): InfrastructureProject => ({
  id: row.id,
  clubId: row.club_id,
  projectType: row.project_type,
  locationId: row.location_id ?? undefined,
  venueId: row.venue_id ?? undefined,
  planningStart: row.planning_start,
  constructionStart: row.construction_start ?? undefined,
  expectedCompletion: row.expected_completion,
  completedAt: row.completed_at ?? undefined,
  capitalCost: row.capital_cost,
  ongoingCost: row.ongoing_cost,
  currency: row.currency,
  status: row.status,
  financingJson: json.parse(row.financing_json, {}),
  provenanceStatus: row.provenance_status,
});

const mapClubAsset = (row: any): ClubAsset => ({
  id: row.id,
  clubId: row.club_id,
  assetType: row.asset_type,
  ownership: row.ownership,
  locationId: row.location_id ?? undefined,
  venueId: row.venue_id ?? undefined,
  estimatedValue: row.estimated_value,
  currency: row.currency,
  status: row.status,
});

const mapClubValuation = (row: any): ClubValuation => ({
  clubId: row.club_id,
  valuation: row.valuation,
  currency: row.currency,
  calculatedAt: row.calculated_at,
  method: row.method,
  status: row.status,
});

const mapClubBoardPolicy = (row: any): ClubBoardPolicy => ({
  clubId: row.club_id,
  financialRiskTolerance: row.financial_risk_tolerance,
  transferPhilosophy: row.transfer_philosophy,
  youthPriority: row.youth_priority,
  commercialPriority: row.commercial_priority,
  infrastructurePriority: row.infrastructure_priority,
  strategicObjective: row.strategic_objective,
  chairmanPersonId: row.chairman_person_id ?? undefined,
  updatedAt: row.updated_at,
  status: row.status,
});

const mapClubFinancialStatement = (row: any): ClubFinancialStatement => ({
  id: row.id,
  clubId: row.club_id,
  seasonLabel: row.season_label,
  openingCash: row.opening_cash,
  revenueByCategory: json.parse(row.revenue_by_category_json, {}),
  expensesByCategory: json.parse(row.expenses_by_category_json, {}),
  operatingProfit: row.operating_profit,
  transferProfitLoss: row.transfer_profit_loss,
  netProfitLoss: row.net_profit_loss,
  closingCash: row.closing_cash,
  debt: row.debt,
  currency: row.currency,
  closedAt: row.closed_at,
  status: row.status,
});

const mapPlayerTransferStatus = (row: any): PlayerTransferStatusRecord => ({
  id: row.id,
  playerId: row.player_id,
  clubId: row.club_id ?? undefined,
  status: row.status,
  reason: row.reason,
  setBy: row.set_by,
  updatedAt: row.updated_at,
});

const mapPlayerTransferRequest = (row: any): PlayerTransferRequest => ({
  id: row.id,
  playerId: row.player_id,
  clubId: row.club_id,
  requestedAt: row.requested_at,
  reason: row.reason,
  pressureScore: row.pressure_score,
  status: row.status,
  askingContext: row.asking_context_json
    ? json.parse(row.asking_context_json, undefined)
    : undefined,
  decidedAt: row.decided_at ?? undefined,
});

const mapAgentProfile = (row: any): AgentProfile => ({
  id: row.id,
  personId: row.person_id,
  agencyName: row.agency_name ?? undefined,
  reputation: row.reputation,
  negotiationSkill: row.negotiation_skill ?? row.reputation,
  negotiationStyle: row.negotiation_style,
  aggressiveness: row.aggressiveness,
  loyaltyPreference: row.loyalty_preference,
  feeExpectation: row.fee_expectation,
  careerAmbition: row.career_ambition,
  networkScope: row.network_scope ?? "NEPAL_DOMESTIC",
  preferredMarkets: json.parse(row.preferred_markets_json, ["NP"]),
  status: row.status,
});

const mapAgentClient = (row: any): AgentClient => ({
  id: row.id,
  agentId: row.agent_id,
  playerId: row.player_id,
  startedAt: row.started_at,
  status: row.status,
});

const mapAgentApproach = (row: any): AgentApproachRecord => ({
  id: row.id,
  agentId: row.agent_id,
  playerId: row.player_id,
  approachedAt: row.approached_at,
  trigger: row.trigger,
  interestScore: row.interest_score,
  networkScope: row.network_scope,
  decision: row.decision,
  decidedAt: row.decided_at ?? undefined,
});

const mapTransferOffer = (row: any): TransferOffer => ({
  id: row.id,
  buyingClubId: row.buying_club_id,
  sellingClubId: row.selling_club_id ?? undefined,
  playerId: row.player_id,
  offerType: row.offer_type,
  transferFee: row.transfer_fee,
  installments: row.installments,
  addOns: row.addons,
  sellOnPercentage: row.sell_on_percentage,
  submittedAt: row.submitted_at,
  expiresAt: row.expires_at,
  status: row.status,
  currency: row.currency,
  askingRange: row.asking_range_json ? json.parse(row.asking_range_json, undefined) : undefined,
  agentFee: row.agent_fee,
  signingFee: row.signing_fee,
  buyerPerceivedValue: row.buyer_perceived_value_json
    ? json.parse(row.buyer_perceived_value_json, undefined)
    : undefined,
  sellerInternalValue: row.seller_internal_value_json
    ? json.parse(row.seller_internal_value_json, undefined)
    : undefined,
  playerDesireToMove: row.player_desire_to_move ?? undefined,
  conditionals: row.conditionals_json ? json.parse(row.conditionals_json, []) : undefined,
  playerExchanges: row.player_exchanges_json
    ? json.parse(row.player_exchanges_json, [])
    : undefined,
  sellerRequestedPlayerId: row.seller_requested_player_id ?? undefined,
});

const mapNegotiationRound = (row: any): NegotiationRound => ({
  id: row.id,
  offerId: row.offer_id,
  roundNumber: row.round_number,
  actor: row.actor,
  action: row.action,
  salary: row.salary ?? undefined,
  squadRole: row.squad_role ?? undefined,
  contractLengthMonths: row.contract_length_months ?? undefined,
  agentFee: row.agent_fee ?? undefined,
  signingFee: row.signing_fee ?? undefined,
  message: row.message,
  createdAt: row.created_at,
});

const mapPlayerLoan = (row: any): PlayerLoanRecord => ({
  id: row.id,
  parentClubId: row.parent_club_id,
  loanClubId: row.loan_club_id,
  playerId: row.player_id,
  startDate: row.start_date,
  endDate: row.end_date,
  wageContributionPercent: row.wage_contribution_percent,
  loanFee: row.loan_fee ?? undefined,
  playingTimeExpectation: row.playing_time_expectation,
  recallAllowed: Boolean(row.recall_allowed),
  purchaseOption: row.purchase_option ?? undefined,
  status: row.status,
});

const mapCompetitionRegistration = (row: any): CompetitionRegistration => ({
  id: row.id,
  playerId: row.player_id,
  clubId: row.club_id,
  competitionSeasonId: row.competition_season_id,
  registrationType: row.registration_type,
  registeredFrom: row.registered_from,
  registeredUntil: row.registered_until ?? undefined,
  status: row.status,
});

const mapTransferHistoryEvent = (row: any): TransferHistoryEvent => ({
  id: row.id,
  playerId: row.player_id,
  clubId: row.club_id ?? undefined,
  relatedClubId: row.related_club_id ?? undefined,
  eventType: row.event_type,
  occurredOn: row.occurred_on,
  data: json.parse(row.data_json, undefined),
});

export type WorldInspection = {
  countries: number;
  locations: number;
  venues: number;
  federations: number;
  competitions: number;
  competitionSeasons: number;
  fixtures: number;
  matches: number;
  matchEvents: number;
  leagueStandings: number;
  playerSeasonStats: number;
  teamSeasonStats: number;
  competitionWinners: number;
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
  playerFactualProfiles: number;
  competitionSeasonStates: number;
  playerCareerStats: number;
  seasonAwards: number;
  playerKnowledge: number;
  clubRecruitmentProfiles: number;
  scoutingStaffSimulationProfiles: number;
  scoutingAssignments: number;
  scoutReports: number;
  clubShortlist: number;
  playerContracts: number;
  transferWindows: number;
  clubFinancialProfiles: number;
  clubEmploymentProfiles: number;
  playerTransferStatuses: number;
  agents: number;
  agentClients: number;
  transferOffers: number;
  negotiationRounds: number;
  playerLoans: number;
  competitionRegistrations: number;
  transferHistoryEvents: number;
  squadNeedReports: number;
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

export class ClubEconomyRepository {
  constructor(private readonly db: GameDatabase) {}

  upsertFinancialAccount(account: ClubFinancialAccount): void {
    this.db
      .prepare(
        `INSERT INTO club_financial_accounts
        (club_id, currency, cash_balance, restricted_cash, receivables, payables, debt_balance,
          equity_balance, season_revenue, season_expenses, season_profit_loss, financial_health,
          last_updated_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(club_id) DO UPDATE SET
          currency = excluded.currency,
          cash_balance = excluded.cash_balance,
          restricted_cash = excluded.restricted_cash,
          receivables = excluded.receivables,
          payables = excluded.payables,
          debt_balance = excluded.debt_balance,
          equity_balance = excluded.equity_balance,
          season_revenue = excluded.season_revenue,
          season_expenses = excluded.season_expenses,
          season_profit_loss = excluded.season_profit_loss,
          financial_health = excluded.financial_health,
          last_updated_at = excluded.last_updated_at,
          status = excluded.status`,
      )
      .run(
        account.clubId,
        account.currency,
        account.cashBalance,
        account.restrictedCash,
        account.receivables,
        account.payables,
        account.debtBalance,
        account.equityBalance,
        account.seasonRevenue,
        account.seasonExpenses,
        account.seasonProfitLoss,
        account.financialHealth,
        account.lastUpdatedAt,
        account.status,
      );
  }

  financialAccount(clubId: EntityId): ClubFinancialAccount | undefined {
    const row = this.db
      .prepare("SELECT * FROM club_financial_accounts WHERE club_id = ?")
      .get(clubId) as any;
    return row ? mapClubFinancialAccount(row) : undefined;
  }

  financialAccounts(): ClubFinancialAccount[] {
    return this.db
      .prepare("SELECT * FROM club_financial_accounts ORDER BY club_id")
      .all()
      .map(mapClubFinancialAccount);
  }

  postLedgerEntry(entry: ClubLedgerEntry): void {
    this.db
      .prepare(
        `INSERT INTO club_ledger_entries
        (id, club_id, entry_date, category, direction, amount, currency, description,
          related_entity_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        entry.id,
        entry.clubId,
        entry.date,
        entry.category,
        entry.direction,
        entry.amount,
        entry.currency,
        entry.description,
        entry.relatedEntityId ?? null,
        entry.status,
      );
    const changes = Number((this.db.prepare("SELECT changes() AS changes").get() as any).changes);
    if (changes === 0) return;
    const sign = entry.direction === "CREDIT" ? 1 : -1;
    this.db
      .prepare(
        `UPDATE club_financial_accounts
        SET cash_balance = cash_balance + ?,
          season_revenue = season_revenue + ?,
          season_expenses = season_expenses + ?,
          season_profit_loss = season_profit_loss + ?,
          last_updated_at = ?,
          financial_health = CASE
            WHEN cash_balance + ? < 0 THEN 'INSOLVENT'
            WHEN cash_balance + ? < 500000 THEN 'DISTRESSED'
            WHEN cash_balance + ? < 1500000 THEN 'TIGHT'
            WHEN cash_balance + ? < 6000000 THEN 'STABLE'
            WHEN cash_balance + ? < 15000000 THEN 'HEALTHY'
            ELSE 'EXCELLENT'
          END
        WHERE club_id = ?`,
      )
      .run(
        sign * entry.amount,
        entry.direction === "CREDIT" ? entry.amount : 0,
        entry.direction === "DEBIT" ? entry.amount : 0,
        sign * entry.amount,
        entry.date,
        sign * entry.amount,
        sign * entry.amount,
        sign * entry.amount,
        sign * entry.amount,
        sign * entry.amount,
        entry.clubId,
      );
  }

  ledgerEntries(clubId?: EntityId): ClubLedgerEntry[] {
    const rows = clubId
      ? this.db
          .prepare("SELECT * FROM club_ledger_entries WHERE club_id = ? ORDER BY entry_date, id")
          .all(clubId)
      : this.db.prepare("SELECT * FROM club_ledger_entries ORDER BY entry_date, id").all();
    return rows.map(mapClubLedgerEntry);
  }

  upsertBudget(budget: ClubBudget): void {
    this.db
      .prepare(
        `INSERT INTO club_budgets
        (id, club_id, season_label, category, amount, used_amount, currency, status, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(club_id, season_label, category) DO UPDATE SET
          amount = excluded.amount,
          used_amount = excluded.used_amount,
          currency = excluded.currency,
          status = excluded.status,
          provenance_status = excluded.provenance_status`,
      )
      .run(
        budget.id,
        budget.clubId,
        budget.seasonLabel,
        budget.category,
        budget.amount,
        budget.usedAmount,
        budget.currency,
        budget.status,
        budget.provenanceStatus,
      );
  }

  budgets(clubId?: EntityId): ClubBudget[] {
    const rows = clubId
      ? this.db
          .prepare("SELECT * FROM club_budgets WHERE club_id = ? ORDER BY category")
          .all(clubId)
      : this.db.prepare("SELECT * FROM club_budgets ORDER BY club_id, category").all();
    return rows.map(mapClubBudget);
  }

  addBudgetUsage(clubId: EntityId, seasonLabel: string, category: string, amount: number): void {
    this.db
      .prepare(
        `UPDATE club_budgets SET used_amount = used_amount + ?
        WHERE club_id = ? AND season_label = ? AND category = ?`,
      )
      .run(amount, clubId, seasonLabel, category);
  }

  upsertOwnershipStake(stake: ClubOwnershipStake): void {
    this.db
      .prepare(
        `INSERT INTO club_ownership_stakes
        (id, club_id, holder_type, holder_id, holder_name, role, percentage, voting_percentage,
          start_date, end_date, status, ownership_model, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          holder_type = excluded.holder_type,
          holder_id = excluded.holder_id,
          holder_name = excluded.holder_name,
          role = excluded.role,
          percentage = excluded.percentage,
          voting_percentage = excluded.voting_percentage,
          end_date = excluded.end_date,
          status = excluded.status,
          ownership_model = excluded.ownership_model,
          provenance_status = excluded.provenance_status`,
      )
      .run(
        stake.id,
        stake.clubId,
        stake.holderType,
        stake.holderId ?? null,
        stake.holderName,
        stake.role,
        stake.percentage ?? null,
        stake.votingPercentage ?? null,
        stake.startDate,
        stake.endDate ?? null,
        stake.status,
        stake.ownershipModel,
        stake.provenanceStatus,
      );
  }

  ownershipStakes(clubId?: EntityId): ClubOwnershipStake[] {
    const rows = clubId
      ? this.db
          .prepare("SELECT * FROM club_ownership_stakes WHERE club_id = ? ORDER BY role, id")
          .all(clubId)
      : this.db.prepare("SELECT * FROM club_ownership_stakes ORDER BY club_id, role").all();
    return rows.map(mapClubOwnershipStake);
  }

  upsertPersonalFinancialProfile(profile: PersonalFinancialProfile): void {
    this.db
      .prepare(
        `INSERT INTO personal_financial_profiles
        (person_id, cash, investments, assets, liabilities, net_worth, currency, last_updated_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(person_id) DO UPDATE SET
          cash = excluded.cash,
          investments = excluded.investments,
          assets = excluded.assets,
          liabilities = excluded.liabilities,
          net_worth = excluded.net_worth,
          currency = excluded.currency,
          last_updated_at = excluded.last_updated_at,
          status = excluded.status`,
      )
      .run(
        profile.personId,
        profile.cash,
        profile.investments,
        profile.assets,
        profile.liabilities,
        profile.netWorth,
        profile.currency,
        profile.lastUpdatedAt,
        profile.status,
      );
  }

  personalFinancialProfile(personId: EntityId): PersonalFinancialProfile | undefined {
    const row = this.db
      .prepare("SELECT * FROM personal_financial_profiles WHERE person_id = ?")
      .get(personId) as any;
    return row ? mapPersonalFinancialProfile(row) : undefined;
  }

  updatePersonalCash(personId: EntityId, delta: number, date: string): void {
    this.db
      .prepare(
        `UPDATE personal_financial_profiles
        SET cash = cash + ?,
          net_worth = net_worth + ?,
          last_updated_at = ?
        WHERE person_id = ?`,
      )
      .run(delta, delta, date, personId);
  }

  insertOwnerInvestment(transaction: OwnerInvestmentTransaction): void {
    this.db
      .prepare(
        `INSERT INTO owner_investment_transactions
        (id, person_id, club_id, transaction_date, amount, currency, form,
          personal_ledger_entry_id, club_ledger_entry_id, status, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        transaction.id,
        transaction.personId,
        transaction.clubId,
        transaction.date,
        transaction.amount,
        transaction.currency,
        transaction.form,
        transaction.personalLedgerEntryId,
        transaction.clubLedgerEntryId,
        transaction.status,
        transaction.provenanceStatus,
      );
  }

  ownerInvestments(): OwnerInvestmentTransaction[] {
    return this.db
      .prepare("SELECT * FROM owner_investment_transactions ORDER BY transaction_date, id")
      .all()
      .map(mapOwnerInvestment);
  }

  upsertDebt(debt: ClubDebt): void {
    this.db
      .prepare(
        `INSERT INTO club_debts
        (id, club_id, lender_type, principal, outstanding_principal, interest_rate, currency,
          start_date, maturity_date, repayment_schedule, status, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          outstanding_principal = excluded.outstanding_principal,
          status = excluded.status`,
      )
      .run(
        debt.id,
        debt.clubId,
        debt.lenderType,
        debt.principal,
        debt.outstandingPrincipal,
        debt.interestRate,
        debt.currency,
        debt.startDate,
        debt.maturityDate,
        debt.repaymentSchedule,
        debt.status,
        debt.provenanceStatus,
      );
  }

  debts(clubId?: EntityId): ClubDebt[] {
    const rows = clubId
      ? this.db
          .prepare("SELECT * FROM club_debts WHERE club_id = ? ORDER BY start_date")
          .all(clubId)
      : this.db.prepare("SELECT * FROM club_debts ORDER BY club_id, start_date").all();
    return rows.map(mapClubDebt);
  }

  upsertSponsor(sponsor: SponsorOrganisation): void {
    this.db
      .prepare(
        `INSERT INTO sponsor_organisations
        (id, name, industry, country_id, reputation, budget_tier, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          industry = excluded.industry,
          country_id = excluded.country_id,
          reputation = excluded.reputation,
          budget_tier = excluded.budget_tier,
          status = excluded.status`,
      )
      .run(
        sponsor.id,
        sponsor.name,
        sponsor.industry,
        sponsor.countryId ?? null,
        sponsor.reputation,
        sponsor.budgetTier,
        sponsor.status,
      );
  }

  sponsors(): SponsorOrganisation[] {
    return this.db
      .prepare("SELECT * FROM sponsor_organisations ORDER BY name")
      .all()
      .map(mapSponsorOrganisation);
  }

  upsertSponsorship(contract: SponsorshipContract): void {
    this.db
      .prepare(
        `INSERT INTO sponsorship_contracts
        (id, club_id, sponsor_id, sponsorship_type, start_date, end_date, annual_value,
          bonuses_json, currency, status, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          annual_value = excluded.annual_value`,
      )
      .run(
        contract.id,
        contract.clubId,
        contract.sponsorId,
        contract.type,
        contract.startDate,
        contract.endDate,
        contract.annualValue,
        json.stringify(contract.bonuses),
        contract.currency,
        contract.status,
        contract.provenanceStatus,
      );
  }

  sponsorships(clubId?: EntityId): SponsorshipContract[] {
    const rows = clubId
      ? this.db
          .prepare("SELECT * FROM sponsorship_contracts WHERE club_id = ? ORDER BY start_date")
          .all(clubId)
      : this.db.prepare("SELECT * FROM sponsorship_contracts ORDER BY club_id, start_date").all();
    return rows.map(mapSponsorshipContract);
  }

  upsertCommercialProfile(profile: ClubCommercialProfile): void {
    this.db.prepare(`INSERT INTO club_commercial_profiles
      (club_id, brand_strength, digital_reach, broadcast_appeal, merchandise_appeal, ticket_price_elasticity, updated_on, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(club_id) DO UPDATE SET brand_strength=excluded.brand_strength, digital_reach=excluded.digital_reach,
      broadcast_appeal=excluded.broadcast_appeal, merchandise_appeal=excluded.merchandise_appeal,
      ticket_price_elasticity=excluded.ticket_price_elasticity, updated_on=excluded.updated_on, status=excluded.status`).run(
      profile.clubId, profile.brandStrength, profile.digitalReach, profile.broadcastAppeal, profile.merchandiseAppeal,
      profile.ticketPriceElasticity, profile.updatedOn, profile.status);
  }

  commercialProfile(clubId: EntityId): ClubCommercialProfile | undefined {
    const row = this.db.prepare("SELECT * FROM club_commercial_profiles WHERE club_id = ?").get(clubId) as any;
    return row ? mapClubCommercialProfile(row) : undefined;
  }

  upsertMediaRights(rights: CompetitionMediaRights): void {
    this.db.prepare(`INSERT INTO competition_media_rights
      (id, competition_season_id, rights_partner, annual_value, streaming_share, currency, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(competition_season_id) DO UPDATE SET rights_partner=excluded.rights_partner,
      annual_value=excluded.annual_value, streaming_share=excluded.streaming_share, currency=excluded.currency, status=excluded.status`).run(
      rights.id, rights.competitionSeasonId, rights.rightsPartner, rights.annualValue, rights.streamingShare,
      rights.currency, rights.status);
  }

  mediaRights(competitionSeasonId?: EntityId): CompetitionMediaRights[] {
    const rows = competitionSeasonId
      ? this.db.prepare("SELECT * FROM competition_media_rights WHERE competition_season_id = ?").all(competitionSeasonId)
      : this.db.prepare("SELECT * FROM competition_media_rights ORDER BY competition_season_id").all();
    return rows.map(mapCompetitionMediaRights);
  }

  updateSponsorshipStatus(id: EntityId, status: SponsorshipContract["status"]): void {
    this.db.prepare("UPDATE sponsorship_contracts SET status = ? WHERE id = ?").run(status, id);
  }

  upsertSupporterProfile(profile: ClubSupporterProfile): void {
    this.db
      .prepare(
        `INSERT INTO club_supporter_profiles
        (club_id, core_supporters, casual_supporters, regional_support, diaspora_support,
          active_support, family_support, youth_support, club_popularity, football_reputation,
          commercial_reputation, sentiment, standard_ticket_price, currency, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(club_id) DO UPDATE SET
          core_supporters = excluded.core_supporters,
          casual_supporters = excluded.casual_supporters,
          regional_support = excluded.regional_support,
          diaspora_support = excluded.diaspora_support,
          active_support = excluded.active_support,
          family_support = excluded.family_support,
          youth_support = excluded.youth_support,
          club_popularity = excluded.club_popularity,
          football_reputation = excluded.football_reputation,
          commercial_reputation = excluded.commercial_reputation,
          sentiment = excluded.sentiment,
          standard_ticket_price = excluded.standard_ticket_price,
          currency = excluded.currency,
          status = excluded.status`,
      )
      .run(
        profile.clubId,
        profile.coreSupporters,
        profile.casualSupporters,
        profile.regionalSupport,
        profile.diasporaSupport,
        profile.activeSupport,
        profile.familySupport,
        profile.youthSupport,
        profile.clubPopularity,
        profile.footballReputation,
        profile.commercialReputation,
        profile.sentiment,
        profile.standardTicketPrice,
        profile.currency,
        profile.status,
      );
  }

  supporterProfile(clubId: EntityId): ClubSupporterProfile | undefined {
    const row = this.db
      .prepare("SELECT * FROM club_supporter_profiles WHERE club_id = ?")
      .get(clubId) as any;
    return row ? mapClubSupporterProfile(row) : undefined;
  }

  supporterProfiles(): ClubSupporterProfile[] {
    return this.db
      .prepare("SELECT * FROM club_supporter_profiles ORDER BY club_id")
      .all()
      .map(mapClubSupporterProfile);
  }

  upsertFacilityProfile(profile: ClubFacilityProfile): void {
    this.db
      .prepare(
        `INSERT INTO club_facility_profiles
        (club_id, training_facility_quality, youth_facility_quality, medical_facility_quality,
          analytics_facility_quality, academy_capacity, monthly_operating_cost, currency, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(club_id) DO UPDATE SET
          training_facility_quality = excluded.training_facility_quality,
          youth_facility_quality = excluded.youth_facility_quality,
          medical_facility_quality = excluded.medical_facility_quality,
          analytics_facility_quality = excluded.analytics_facility_quality,
          academy_capacity = excluded.academy_capacity,
          monthly_operating_cost = excluded.monthly_operating_cost,
          currency = excluded.currency,
          status = excluded.status`,
      )
      .run(
        profile.clubId,
        profile.trainingFacilityQuality,
        profile.youthFacilityQuality,
        profile.medicalFacilityQuality,
        profile.analyticsFacilityQuality,
        profile.academyCapacity,
        profile.monthlyOperatingCost,
        profile.currency,
        profile.status,
      );
  }

  facilityProfile(clubId: EntityId): ClubFacilityProfile | undefined {
    const row = this.db
      .prepare("SELECT * FROM club_facility_profiles WHERE club_id = ?")
      .get(clubId) as any;
    return row ? mapClubFacilityProfile(row) : undefined;
  }

  upsertInfrastructureProject(project: InfrastructureProject): void {
    this.db
      .prepare(
        `INSERT INTO infrastructure_projects
        (id, club_id, project_type, location_id, venue_id, planning_start, construction_start,
          expected_completion, completed_at, capital_cost, ongoing_cost, currency, status,
          financing_json, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          construction_start = excluded.construction_start,
          expected_completion = excluded.expected_completion,
          completed_at = excluded.completed_at,
          status = excluded.status`,
      )
      .run(
        project.id,
        project.clubId,
        project.projectType,
        project.locationId ?? null,
        project.venueId ?? null,
        project.planningStart,
        project.constructionStart ?? null,
        project.expectedCompletion,
        project.completedAt ?? null,
        project.capitalCost,
        project.ongoingCost,
        project.currency,
        project.status,
        json.stringify(project.financingJson),
        project.provenanceStatus,
      );
  }

  infrastructureProjects(clubId?: EntityId): InfrastructureProject[] {
    const rows = clubId
      ? this.db
          .prepare(
            "SELECT * FROM infrastructure_projects WHERE club_id = ? ORDER BY planning_start",
          )
          .all(clubId)
      : this.db
          .prepare("SELECT * FROM infrastructure_projects ORDER BY club_id, planning_start")
          .all();
    return rows.map(mapInfrastructureProject);
  }

  upsertAsset(asset: ClubAsset): void {
    this.db
      .prepare(
        `INSERT INTO club_assets
        (id, club_id, asset_type, ownership, location_id, venue_id, estimated_value, currency, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          ownership = excluded.ownership,
          estimated_value = excluded.estimated_value,
          status = excluded.status`,
      )
      .run(
        asset.id,
        asset.clubId,
        asset.assetType,
        asset.ownership,
        asset.locationId ?? null,
        asset.venueId ?? null,
        asset.estimatedValue,
        asset.currency,
        asset.status,
      );
  }

  assets(clubId?: EntityId): ClubAsset[] {
    const rows = clubId
      ? this.db
          .prepare("SELECT * FROM club_assets WHERE club_id = ? ORDER BY asset_type")
          .all(clubId)
      : this.db.prepare("SELECT * FROM club_assets ORDER BY club_id, asset_type").all();
    return rows.map(mapClubAsset);
  }

  upsertValuation(valuation: ClubValuation): void {
    this.db
      .prepare(
        `INSERT INTO club_valuations
        (club_id, valuation, currency, calculated_at, method, status)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(club_id) DO UPDATE SET
          valuation = excluded.valuation,
          calculated_at = excluded.calculated_at,
          method = excluded.method,
          status = excluded.status`,
      )
      .run(
        valuation.clubId,
        valuation.valuation,
        valuation.currency,
        valuation.calculatedAt,
        valuation.method,
        valuation.status,
      );
  }

  valuation(clubId: EntityId): ClubValuation | undefined {
    const row = this.db
      .prepare("SELECT * FROM club_valuations WHERE club_id = ?")
      .get(clubId) as any;
    return row ? mapClubValuation(row) : undefined;
  }

  upsertBoardPolicy(policy: ClubBoardPolicy): void {
    this.db
      .prepare(
        `INSERT INTO club_board_policies
        (club_id, financial_risk_tolerance, transfer_philosophy, youth_priority,
          commercial_priority, infrastructure_priority, strategic_objective, chairman_person_id,
          updated_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(club_id) DO UPDATE SET
          financial_risk_tolerance = excluded.financial_risk_tolerance,
          transfer_philosophy = excluded.transfer_philosophy,
          youth_priority = excluded.youth_priority,
          commercial_priority = excluded.commercial_priority,
          infrastructure_priority = excluded.infrastructure_priority,
          strategic_objective = excluded.strategic_objective,
          chairman_person_id = excluded.chairman_person_id,
          updated_at = excluded.updated_at,
          status = excluded.status`,
      )
      .run(
        policy.clubId,
        policy.financialRiskTolerance,
        policy.transferPhilosophy,
        policy.youthPriority,
        policy.commercialPriority,
        policy.infrastructurePriority,
        policy.strategicObjective,
        policy.chairmanPersonId ?? null,
        policy.updatedAt,
        policy.status,
      );
  }

  boardPolicy(clubId: EntityId): ClubBoardPolicy | undefined {
    const row = this.db
      .prepare("SELECT * FROM club_board_policies WHERE club_id = ?")
      .get(clubId) as any;
    return row ? mapClubBoardPolicy(row) : undefined;
  }

  upsertFinancialStatement(statement: ClubFinancialStatement): void {
    this.db
      .prepare(
        `INSERT INTO club_financial_statements
        (id, club_id, season_label, opening_cash, revenue_by_category_json, expenses_by_category_json,
          operating_profit, transfer_profit_loss, net_profit_loss, closing_cash, debt, currency,
          closed_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(club_id, season_label) DO UPDATE SET
          revenue_by_category_json = excluded.revenue_by_category_json,
          expenses_by_category_json = excluded.expenses_by_category_json,
          operating_profit = excluded.operating_profit,
          transfer_profit_loss = excluded.transfer_profit_loss,
          net_profit_loss = excluded.net_profit_loss,
          closing_cash = excluded.closing_cash,
          debt = excluded.debt,
          closed_at = excluded.closed_at`,
      )
      .run(
        statement.id,
        statement.clubId,
        statement.seasonLabel,
        statement.openingCash,
        json.stringify(statement.revenueByCategory),
        json.stringify(statement.expensesByCategory),
        statement.operatingProfit,
        statement.transferProfitLoss,
        statement.netProfitLoss,
        statement.closingCash,
        statement.debt,
        statement.currency,
        statement.closedAt,
        statement.status,
      );
  }

  financialStatements(clubId?: EntityId): ClubFinancialStatement[] {
    const rows = clubId
      ? this.db
          .prepare(
            "SELECT * FROM club_financial_statements WHERE club_id = ? ORDER BY season_label",
          )
          .all(clubId)
      : this.db
          .prepare("SELECT * FROM club_financial_statements ORDER BY club_id, season_label")
          .all();
    return rows.map(mapClubFinancialStatement);
  }
}

export class FederationGovernanceRepository {
  constructor(private readonly db: GameDatabase) {}

  upsertProfile(profile: FederationSimulationProfile): void {
    this.db
      .prepare(
        `INSERT INTO federation_simulation_profiles
        (federation_id, country_id, reputation, financial_health, grassroots_development,
          youth_development, coach_education, referee_development, competition_organisation,
          commercial_strength, international_relations, governance_stability, infrastructure_level,
          last_updated_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(federation_id) DO UPDATE SET
          reputation = excluded.reputation,
          financial_health = excluded.financial_health,
          grassroots_development = excluded.grassroots_development,
          youth_development = excluded.youth_development,
          coach_education = excluded.coach_education,
          referee_development = excluded.referee_development,
          competition_organisation = excluded.competition_organisation,
          commercial_strength = excluded.commercial_strength,
          international_relations = excluded.international_relations,
          governance_stability = excluded.governance_stability,
          infrastructure_level = excluded.infrastructure_level,
          last_updated_at = excluded.last_updated_at,
          status = excluded.status`,
      )
      .run(
        profile.federationId,
        profile.countryId,
        profile.reputation,
        profile.financialHealth,
        profile.grassrootsDevelopment,
        profile.youthDevelopment,
        profile.coachEducation,
        profile.refereeDevelopment,
        profile.competitionOrganisation,
        profile.commercialStrength,
        profile.internationalRelations,
        profile.governanceStability,
        profile.infrastructureLevel,
        profile.lastUpdatedAt,
        profile.status,
      );
  }

  profile(federationId: EntityId): FederationSimulationProfile | undefined {
    const row = this.db
      .prepare("SELECT * FROM federation_simulation_profiles WHERE federation_id = ?")
      .get(federationId) as any;
    return row ? mapFederationSimulationProfile(row) : undefined;
  }

  upsertFinancialAccount(account: FederationFinancialAccount): void {
    this.db
      .prepare(
        `INSERT INTO federation_financial_accounts
        (federation_id, currency, cash_balance, restricted_funds, receivables, payables, debt,
          season_revenue, season_expenses, season_profit_loss, financial_health, last_updated_at,
          status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(federation_id) DO UPDATE SET
          cash_balance = excluded.cash_balance,
          restricted_funds = excluded.restricted_funds,
          receivables = excluded.receivables,
          payables = excluded.payables,
          debt = excluded.debt,
          season_revenue = excluded.season_revenue,
          season_expenses = excluded.season_expenses,
          season_profit_loss = excluded.season_profit_loss,
          financial_health = excluded.financial_health,
          last_updated_at = excluded.last_updated_at,
          status = excluded.status`,
      )
      .run(
        account.federationId,
        account.currency,
        account.cashBalance,
        account.restrictedFunds,
        account.receivables,
        account.payables,
        account.debt,
        account.seasonRevenue,
        account.seasonExpenses,
        account.seasonProfitLoss,
        account.financialHealth,
        account.lastUpdatedAt,
        account.status,
      );
  }

  financialAccount(federationId: EntityId): FederationFinancialAccount | undefined {
    const row = this.db
      .prepare("SELECT * FROM federation_financial_accounts WHERE federation_id = ?")
      .get(federationId) as any;
    return row ? mapFederationFinancialAccount(row) : undefined;
  }

  financialAccounts(): FederationFinancialAccount[] {
    return this.db
      .prepare("SELECT * FROM federation_financial_accounts ORDER BY federation_id")
      .all()
      .map(mapFederationFinancialAccount);
  }

  postLedgerEntry(entry: FederationLedgerEntry): void {
    const result = this.db
      .prepare(
        `INSERT INTO federation_ledger_entries
        (id, federation_id, entry_date, category, direction, amount, currency, description,
          related_entity_id, restriction_tag, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        entry.id,
        entry.federationId,
        entry.date,
        entry.category,
        entry.direction,
        entry.amount,
        entry.currency,
        entry.description,
        entry.relatedEntityId ?? null,
        entry.restrictionTag ?? null,
        entry.status,
      );
    if (result.changes === 0) return;
    const delta = entry.direction === "CREDIT" ? entry.amount : -entry.amount;
    this.db
      .prepare(
        `UPDATE federation_financial_accounts
        SET cash_balance = cash_balance + ?,
          season_revenue = season_revenue + ?,
          season_expenses = season_expenses + ?,
          season_profit_loss = season_profit_loss + ?,
          financial_health = CASE
            WHEN cash_balance + ? - debt < 0 THEN 'INSOLVENT'
            WHEN cash_balance + ? - debt < 800000 THEN 'DISTRESSED'
            WHEN cash_balance + ? - debt < 2500000 THEN 'TIGHT'
            WHEN cash_balance + ? - debt < 9000000 THEN 'STABLE'
            WHEN cash_balance + ? - debt < 22000000 THEN 'HEALTHY'
            ELSE 'EXCELLENT'
          END,
          last_updated_at = ?
        WHERE federation_id = ?`,
      )
      .run(
        delta,
        entry.direction === "CREDIT" ? entry.amount : 0,
        entry.direction === "DEBIT" ? entry.amount : 0,
        delta,
        delta,
        delta,
        delta,
        delta,
        delta,
        entry.date,
        entry.federationId,
      );
  }

  ledgerEntries(federationId?: EntityId): FederationLedgerEntry[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM federation_ledger_entries WHERE federation_id = ? ORDER BY entry_date, id",
          )
          .all(federationId)
      : this.db
          .prepare("SELECT * FROM federation_ledger_entries ORDER BY federation_id, entry_date, id")
          .all();
    return rows.map(mapFederationLedgerEntry);
  }

  upsertBudget(budget: FederationBudget): void {
    this.db
      .prepare(
        `INSERT INTO federation_budgets
        (id, federation_id, season_label, category, amount, used_amount, currency, status,
          provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(federation_id, season_label, category) DO UPDATE SET
          amount = excluded.amount,
          used_amount = excluded.used_amount,
          status = excluded.status`,
      )
      .run(
        budget.id,
        budget.federationId,
        budget.seasonLabel,
        budget.category,
        budget.amount,
        budget.usedAmount,
        budget.currency,
        budget.status,
        budget.provenanceStatus,
      );
  }

  budgets(federationId?: EntityId): FederationBudget[] {
    const rows = federationId
      ? this.db
          .prepare("SELECT * FROM federation_budgets WHERE federation_id = ? ORDER BY season_label")
          .all(federationId)
      : this.db
          .prepare("SELECT * FROM federation_budgets ORDER BY federation_id, season_label")
          .all();
    return rows.map(mapFederationBudget);
  }

  addBudgetUsage(
    federationId: EntityId,
    seasonLabel: string,
    category: FederationBudget["category"],
    amount: number,
  ): void {
    this.db
      .prepare(
        `UPDATE federation_budgets
        SET used_amount = used_amount + ?
        WHERE federation_id = ? AND season_label = ? AND category = ?`,
      )
      .run(amount, federationId, seasonLabel, category);
  }

  upsertLeadershipTenure(tenure: FederationLeadershipTenure): void {
    this.db
      .prepare(
        `INSERT INTO federation_leadership_tenures
        (id, person_id, federation_id, role, term_start, term_end, status, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET term_end = excluded.term_end, status = excluded.status`,
      )
      .run(
        tenure.id,
        tenure.personId,
        tenure.federationId,
        tenure.role,
        tenure.termStart,
        tenure.termEnd ?? null,
        tenure.status,
        tenure.provenanceStatus,
      );
  }

  leadershipTenures(federationId?: EntityId): FederationLeadershipTenure[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM federation_leadership_tenures WHERE federation_id = ? ORDER BY term_start",
          )
          .all(federationId)
      : this.db
          .prepare("SELECT * FROM federation_leadership_tenures ORDER BY federation_id, term_start")
          .all();
    return rows.map(mapFederationLeadershipTenure);
  }

  upsertCommittee(committee: FederationCommittee): void {
    this.db
      .prepare(
        `INSERT INTO federation_committees
        (id, federation_id, committee_type, name, chair_person_id, status, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(federation_id, committee_type) DO UPDATE SET
          name = excluded.name,
          chair_person_id = excluded.chair_person_id,
          status = excluded.status`,
      )
      .run(
        committee.id,
        committee.federationId,
        committee.committeeType,
        committee.name,
        committee.chairPersonId ?? null,
        committee.status,
        committee.provenanceStatus,
      );
  }

  committees(federationId?: EntityId): FederationCommittee[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM federation_committees WHERE federation_id = ? ORDER BY committee_type",
          )
          .all(federationId)
      : this.db
          .prepare("SELECT * FROM federation_committees ORDER BY federation_id, committee_type")
          .all();
    return rows.map(mapFederationCommittee);
  }

  upsertStrategyPriority(priority: FederationStrategyPriority): void {
    this.db
      .prepare(
        `INSERT INTO federation_strategy_priorities
        (id, federation_id, priority, weight, effective_from, effective_to, status,
          provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET weight = excluded.weight, effective_to = excluded.effective_to,
          status = excluded.status`,
      )
      .run(
        priority.id,
        priority.federationId,
        priority.priority,
        priority.weight,
        priority.effectiveFrom,
        priority.effectiveTo ?? null,
        priority.status,
        priority.provenanceStatus,
      );
  }

  strategyPriorities(federationId?: EntityId): FederationStrategyPriority[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM federation_strategy_priorities WHERE federation_id = ? ORDER BY effective_from, priority",
          )
          .all(federationId)
      : this.db
          .prepare(
            "SELECT * FROM federation_strategy_priorities ORDER BY federation_id, effective_from",
          )
          .all();
    return rows.map(mapFederationStrategyPriority);
  }

  upsertProject(project: FederationProject): void {
    this.db
      .prepare(
        `INSERT INTO federation_projects
        (id, federation_id, project_type, name, location_id, target_province_id, target_district_id,
          academy_id, start_date, expected_completion, completed_at, capital_cost,
          annual_operating_cost, currency, status, impact_json, funding_json, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          expected_completion = excluded.expected_completion,
          completed_at = excluded.completed_at,
          status = excluded.status,
          impact_json = excluded.impact_json`,
      )
      .run(
        project.id,
        project.federationId,
        project.projectType,
        project.name,
        project.locationId ?? null,
        project.targetProvinceId ?? null,
        project.targetDistrictId ?? null,
        project.academyId ?? null,
        project.startDate,
        project.expectedCompletion,
        project.completedAt ?? null,
        project.capitalCost,
        project.annualOperatingCost,
        project.currency,
        project.status,
        json.stringify(project.impactJson),
        json.stringify(project.fundingJson),
        project.provenanceStatus,
      );
  }

  projects(federationId?: EntityId): FederationProject[] {
    const rows = federationId
      ? this.db
          .prepare("SELECT * FROM federation_projects WHERE federation_id = ? ORDER BY start_date")
          .all(federationId)
      : this.db
          .prepare("SELECT * FROM federation_projects ORDER BY federation_id, start_date")
          .all();
    return rows.map(mapFederationProject);
  }

  upsertAsset(asset: FederationAsset): void {
    this.db
      .prepare(
        `INSERT INTO federation_assets
        (id, federation_id, asset_type, ownership, location_id, academy_id, estimated_value,
          currency, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET ownership = excluded.ownership,
          estimated_value = excluded.estimated_value,
          status = excluded.status`,
      )
      .run(
        asset.id,
        asset.federationId,
        asset.assetType,
        asset.ownership,
        asset.locationId ?? null,
        asset.academyId ?? null,
        asset.estimatedValue,
        asset.currency,
        asset.status,
      );
  }

  assets(federationId?: EntityId): FederationAsset[] {
    const rows = federationId
      ? this.db
          .prepare("SELECT * FROM federation_assets WHERE federation_id = ? ORDER BY asset_type")
          .all(federationId)
      : this.db.prepare("SELECT * FROM federation_assets ORDER BY federation_id, asset_type").all();
    return rows.map(mapFederationAsset);
  }

  upsertCompetitionReform(reform: CompetitionReformProposal): void {
    this.db
      .prepare(
        `INSERT INTO competition_reform_proposals
        (id, federation_id, competition_id, effective_season, changes_json, status, proposed_at,
          decided_at, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET changes_json = excluded.changes_json,
          status = excluded.status,
          decided_at = excluded.decided_at`,
      )
      .run(
        reform.id,
        reform.federationId,
        reform.competitionId,
        reform.effectiveSeason,
        json.stringify(reform.changes),
        reform.status,
        reform.proposedAt,
        reform.decidedAt ?? null,
        reform.provenanceStatus,
      );
  }

  competitionReforms(federationId?: EntityId): CompetitionReformProposal[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM competition_reform_proposals WHERE federation_id = ? ORDER BY effective_season",
          )
          .all(federationId)
      : this.db
          .prepare(
            "SELECT * FROM competition_reform_proposals ORDER BY federation_id, effective_season",
          )
          .all();
    return rows.map(mapCompetitionReformProposal);
  }

  upsertClubLicensingAssessment(assessment: ClubLicensingAssessment): void {
    this.db
      .prepare(
        `INSERT INTO club_licensing_assessments
        (id, federation_id, club_id, season_label, financial, stadium, youth, medical,
          administrative, coaching, legal, overall, assessed_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(federation_id, club_id, season_label) DO UPDATE SET
          financial = excluded.financial,
          stadium = excluded.stadium,
          youth = excluded.youth,
          medical = excluded.medical,
          administrative = excluded.administrative,
          coaching = excluded.coaching,
          legal = excluded.legal,
          overall = excluded.overall,
          assessed_at = excluded.assessed_at`,
      )
      .run(
        assessment.id,
        assessment.federationId,
        assessment.clubId,
        assessment.seasonLabel,
        assessment.financial,
        assessment.stadium,
        assessment.youth,
        assessment.medical,
        assessment.administrative,
        assessment.coaching,
        assessment.legal,
        assessment.overall,
        assessment.assessedAt,
        assessment.status,
      );
  }

  licensingAssessments(federationId?: EntityId): ClubLicensingAssessment[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM club_licensing_assessments WHERE federation_id = ? ORDER BY season_label, club_id",
          )
          .all(federationId)
      : this.db
          .prepare(
            "SELECT * FROM club_licensing_assessments ORDER BY federation_id, season_label, club_id",
          )
          .all();
    return rows.map(mapClubLicensingAssessment);
  }

  insertGrantDistribution(grant: FederationGrantDistribution): void {
    this.db
      .prepare(
        `INSERT INTO federation_grant_distributions
        (id, federation_id, club_id, grant_date, grant_type, amount, currency,
          federation_ledger_entry_id, club_ledger_entry_id, status, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        grant.id,
        grant.federationId,
        grant.clubId,
        grant.date,
        grant.grantType,
        grant.amount,
        grant.currency,
        grant.federationLedgerEntryId,
        grant.clubLedgerEntryId,
        grant.status,
        grant.provenanceStatus,
      );
  }

  grantDistributions(federationId?: EntityId): FederationGrantDistribution[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM federation_grant_distributions WHERE federation_id = ? ORDER BY grant_date",
          )
          .all(federationId)
      : this.db
          .prepare(
            "SELECT * FROM federation_grant_distributions ORDER BY federation_id, grant_date",
          )
          .all();
    return rows.map(mapFederationGrantDistribution);
  }

  upsertNationalTeamCallup(callup: NationalTeamCallup): void {
    this.db
      .prepare(
        `INSERT INTO national_team_callups
        (id, national_team_id, player_id, callup_date, programme, squad_type, status,
          provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, squad_type = excluded.squad_type`,
      )
      .run(
        callup.id,
        callup.nationalTeamId,
        callup.playerId,
        callup.callupDate,
        callup.programme,
        callup.squadType,
        callup.status,
        callup.provenanceStatus,
      );
  }

  nationalTeamCallups(teamId?: EntityId): NationalTeamCallup[] {
    const rows = teamId
      ? this.db
          .prepare(
            "SELECT * FROM national_team_callups WHERE national_team_id = ? ORDER BY callup_date",
          )
          .all(teamId)
      : this.db
          .prepare("SELECT * FROM national_team_callups ORDER BY national_team_id, callup_date")
          .all();
    return rows.map(mapNationalTeamCallup);
  }

  insertNationalTeamAppearance(appearance: NationalTeamAppearance): void {
    this.db
      .prepare(
        `INSERT INTO national_team_appearances
        (id, national_team_id, player_id, match_date, opponent_name, minutes, goals, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        appearance.id,
        appearance.nationalTeamId,
        appearance.playerId,
        appearance.matchDate,
        appearance.opponentName,
        appearance.minutes,
        appearance.goals,
        appearance.status,
      );
  }

  nationalTeamAppearances(teamId?: EntityId): NationalTeamAppearance[] {
    const rows = teamId
      ? this.db
          .prepare(
            "SELECT * FROM national_team_appearances WHERE national_team_id = ? ORDER BY match_date",
          )
          .all(teamId)
      : this.db
          .prepare("SELECT * FROM national_team_appearances ORDER BY national_team_id, match_date")
          .all();
    return rows.map(mapNationalTeamAppearance);
  }

  upsertNationalTeamFixture(fixture: NationalTeamFixture): void {
    this.db
      .prepare(
        `INSERT INTO national_team_fixtures
        (id, federation_id, national_team_id, opponent_name, fixture_date, fixture_type, venue_id,
          status, home_goals, away_goals, estimated_cost, estimated_revenue, currency,
          provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status,
          home_goals = excluded.home_goals,
          away_goals = excluded.away_goals`,
      )
      .run(
        fixture.id,
        fixture.federationId,
        fixture.nationalTeamId,
        fixture.opponentName,
        fixture.fixtureDate,
        fixture.fixtureType,
        fixture.venueId ?? null,
        fixture.status,
        fixture.homeGoals ?? null,
        fixture.awayGoals ?? null,
        fixture.estimatedCost,
        fixture.estimatedRevenue,
        fixture.currency,
        fixture.provenanceStatus,
      );
  }

  nationalTeamFixtures(teamId?: EntityId): NationalTeamFixture[] {
    const rows = teamId
      ? this.db
          .prepare(
            "SELECT * FROM national_team_fixtures WHERE national_team_id = ? ORDER BY fixture_date",
          )
          .all(teamId)
      : this.db
          .prepare("SELECT * FROM national_team_fixtures ORDER BY national_team_id, fixture_date")
          .all();
    return rows.map(mapNationalTeamFixture);
  }

  upsertInternationalEligibility(eligibility: PlayerInternationalEligibility): void {
    this.db
      .prepare(
        `INSERT INTO player_international_eligibilities
        (id, player_id, federation_id, eligibility_status, documentation_status, discovered_via,
          last_reviewed_at, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id, federation_id) DO UPDATE SET
          eligibility_status = excluded.eligibility_status,
          documentation_status = excluded.documentation_status,
          discovered_via = excluded.discovered_via,
          last_reviewed_at = excluded.last_reviewed_at`,
      )
      .run(
        eligibility.id,
        eligibility.playerId,
        eligibility.federationId,
        eligibility.status,
        eligibility.documentationStatus,
        eligibility.discoveredVia,
        eligibility.lastReviewedAt,
        eligibility.provenanceStatus,
      );
  }

  internationalEligibilities(federationId?: EntityId): PlayerInternationalEligibility[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM player_international_eligibilities WHERE federation_id = ? ORDER BY player_id",
          )
          .all(federationId)
      : this.db
          .prepare(
            "SELECT * FROM player_international_eligibilities ORDER BY federation_id, player_id",
          )
          .all();
    return rows.map(mapPlayerInternationalEligibility);
  }

  upsertCoachEducationProgramme(programme: CoachEducationProgramme): void {
    this.db
      .prepare(
        `INSERT INTO coach_education_programmes
        (id, federation_id, licence_level, start_date, end_date, capacity, cost, graduates,
          currency, status, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET graduates = excluded.graduates, status = excluded.status`,
      )
      .run(
        programme.id,
        programme.federationId,
        programme.licenceLevel,
        programme.startDate,
        programme.endDate,
        programme.capacity,
        programme.cost,
        programme.graduates,
        programme.currency,
        programme.status,
        programme.provenanceStatus,
      );
  }

  coachEducationProgrammes(federationId?: EntityId): CoachEducationProgramme[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM coach_education_programmes WHERE federation_id = ? ORDER BY start_date",
          )
          .all(federationId)
      : this.db
          .prepare("SELECT * FROM coach_education_programmes ORDER BY federation_id, start_date")
          .all();
    return rows.map(mapCoachEducationProgramme);
  }

  upsertRefereeDevelopmentProgramme(programme: RefereeDevelopmentProgramme): void {
    this.db
      .prepare(
        `INSERT INTO referee_development_programmes
        (id, federation_id, programme_type, start_date, end_date, capacity, cost,
          referees_advanced, currency, status, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          referees_advanced = excluded.referees_advanced,
          status = excluded.status`,
      )
      .run(
        programme.id,
        programme.federationId,
        programme.programmeType,
        programme.startDate,
        programme.endDate,
        programme.capacity,
        programme.cost,
        programme.refereesAdvanced,
        programme.currency,
        programme.status,
        programme.provenanceStatus,
      );
  }

  refereeDevelopmentProgrammes(federationId?: EntityId): RefereeDevelopmentProgramme[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM referee_development_programmes WHERE federation_id = ? ORDER BY start_date",
          )
          .all(federationId)
      : this.db
          .prepare(
            "SELECT * FROM referee_development_programmes ORDER BY federation_id, start_date",
          )
          .all();
    return rows.map(mapRefereeDevelopmentProgramme);
  }

  upsertOrganisationRelationship(relationship: OrganisationRelationship): void {
    this.db
      .prepare(
        `INSERT INTO organisation_relationships
        (id, federation_id, organisation_name, relationship_type, support_level, trust,
          funding_relationship, updated_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(federation_id, organisation_name) DO UPDATE SET
          support_level = excluded.support_level,
          trust = excluded.trust,
          funding_relationship = excluded.funding_relationship,
          updated_at = excluded.updated_at`,
      )
      .run(
        relationship.id,
        relationship.federationId,
        relationship.organisationName,
        relationship.relationshipType,
        relationship.supportLevel,
        relationship.trust,
        relationship.fundingRelationship,
        relationship.updatedAt,
        relationship.status,
      );
  }

  organisationRelationships(federationId?: EntityId): OrganisationRelationship[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM organisation_relationships WHERE federation_id = ? ORDER BY organisation_name",
          )
          .all(federationId)
      : this.db
          .prepare(
            "SELECT * FROM organisation_relationships ORDER BY federation_id, organisation_name",
          )
          .all();
    return rows.map(mapOrganisationRelationship);
  }

  upsertFederationSponsorship(contract: FederationSponsorshipContract): void {
    this.db
      .prepare(
        `INSERT INTO federation_sponsorship_contracts
        (id, federation_id, sponsor_id, sponsorship_type, start_date, end_date, annual_value,
          currency, status, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET annual_value = excluded.annual_value, status = excluded.status`,
      )
      .run(
        contract.id,
        contract.federationId,
        contract.sponsorId,
        contract.type,
        contract.startDate,
        contract.endDate,
        contract.annualValue,
        contract.currency,
        contract.status,
        contract.provenanceStatus,
      );
  }

  federationSponsorships(federationId?: EntityId): FederationSponsorshipContract[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM federation_sponsorship_contracts WHERE federation_id = ? ORDER BY start_date",
          )
          .all(federationId)
      : this.db
          .prepare(
            "SELECT * FROM federation_sponsorship_contracts ORDER BY federation_id, start_date",
          )
          .all();
    return rows.map(mapFederationSponsorshipContract);
  }

  upsertObjective(objective: FederationObjective): void {
    this.db
      .prepare(
        `INSERT INTO federation_objectives
        (id, federation_id, objective, cycle_start, cycle_end, progress, status, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET progress = excluded.progress, status = excluded.status`,
      )
      .run(
        objective.id,
        objective.federationId,
        objective.objective,
        objective.cycleStart,
        objective.cycleEnd,
        objective.progress,
        objective.status,
        objective.provenanceStatus,
      );
  }

  objectives(federationId?: EntityId): FederationObjective[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM federation_objectives WHERE federation_id = ? ORDER BY cycle_start",
          )
          .all(federationId)
      : this.db
          .prepare("SELECT * FROM federation_objectives ORDER BY federation_id, cycle_start")
          .all();
    return rows.map(mapFederationObjective);
  }

  upsertKpi(kpi: FederationKPI): void {
    this.db
      .prepare(
        `INSERT INTO federation_kpis
        (id, federation_id, season_label, metric, metric_value, measured_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(federation_id, season_label, metric) DO UPDATE SET
          metric_value = excluded.metric_value,
          measured_at = excluded.measured_at`,
      )
      .run(
        kpi.id,
        kpi.federationId,
        kpi.seasonLabel,
        kpi.metric,
        kpi.value,
        kpi.measuredAt,
        kpi.status,
      );
  }

  kpis(federationId?: EntityId): FederationKPI[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM federation_kpis WHERE federation_id = ? ORDER BY season_label, metric",
          )
          .all(federationId)
      : this.db
          .prepare("SELECT * FROM federation_kpis ORDER BY federation_id, season_label, metric")
          .all();
    return rows.map(mapFederationKpi);
  }

  upsertFinancialStatement(statement: FederationFinancialStatement): void {
    this.db
      .prepare(
        `INSERT INTO federation_financial_statements
        (id, federation_id, season_label, opening_cash, revenue_by_category_json,
          expenses_by_category_json, programme_spending, national_team_spending,
          competition_spending, infrastructure_spending, net_profit_loss, closing_cash, debt,
          currency, closed_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(federation_id, season_label) DO UPDATE SET
          revenue_by_category_json = excluded.revenue_by_category_json,
          expenses_by_category_json = excluded.expenses_by_category_json,
          programme_spending = excluded.programme_spending,
          national_team_spending = excluded.national_team_spending,
          competition_spending = excluded.competition_spending,
          infrastructure_spending = excluded.infrastructure_spending,
          net_profit_loss = excluded.net_profit_loss,
          closing_cash = excluded.closing_cash,
          debt = excluded.debt,
          closed_at = excluded.closed_at`,
      )
      .run(
        statement.id,
        statement.federationId,
        statement.seasonLabel,
        statement.openingCash,
        json.stringify(statement.revenueByCategory),
        json.stringify(statement.expensesByCategory),
        statement.programmeSpending,
        statement.nationalTeamSpending,
        statement.competitionSpending,
        statement.infrastructureSpending,
        statement.netProfitLoss,
        statement.closingCash,
        statement.debt,
        statement.currency,
        statement.closedAt,
        statement.status,
      );
  }

  financialStatements(federationId?: EntityId): FederationFinancialStatement[] {
    const rows = federationId
      ? this.db
          .prepare(
            "SELECT * FROM federation_financial_statements WHERE federation_id = ? ORDER BY season_label",
          )
          .all(federationId)
      : this.db
          .prepare(
            "SELECT * FROM federation_financial_statements ORDER BY federation_id, season_label",
          )
          .all();
    return rows.map(mapFederationFinancialStatement);
  }
}

const mapFederationSimulationProfile = (row: any): FederationSimulationProfile => ({
  federationId: row.federation_id,
  countryId: row.country_id,
  reputation: row.reputation,
  financialHealth: row.financial_health,
  grassrootsDevelopment: row.grassroots_development,
  youthDevelopment: row.youth_development,
  coachEducation: row.coach_education,
  refereeDevelopment: row.referee_development,
  competitionOrganisation: row.competition_organisation,
  commercialStrength: row.commercial_strength,
  internationalRelations: row.international_relations,
  governanceStability: row.governance_stability,
  infrastructureLevel: row.infrastructure_level,
  lastUpdatedAt: row.last_updated_at,
  status: row.status,
});

const mapFederationFinancialAccount = (row: any): FederationFinancialAccount => ({
  federationId: row.federation_id,
  currency: row.currency,
  cashBalance: row.cash_balance,
  restrictedFunds: row.restricted_funds,
  receivables: row.receivables,
  payables: row.payables,
  debt: row.debt,
  seasonRevenue: row.season_revenue,
  seasonExpenses: row.season_expenses,
  seasonProfitLoss: row.season_profit_loss,
  financialHealth: row.financial_health,
  lastUpdatedAt: row.last_updated_at,
  status: row.status,
});

const mapFederationLedgerEntry = (row: any): FederationLedgerEntry => ({
  id: row.id,
  federationId: row.federation_id,
  date: row.entry_date,
  category: row.category,
  direction: row.direction,
  amount: row.amount,
  currency: row.currency,
  description: row.description,
  relatedEntityId: row.related_entity_id ?? undefined,
  restrictionTag: row.restriction_tag ?? undefined,
  status: row.status,
});

const mapFederationBudget = (row: any): FederationBudget => ({
  id: row.id,
  federationId: row.federation_id,
  seasonLabel: row.season_label,
  category: row.category,
  amount: row.amount,
  usedAmount: row.used_amount,
  currency: row.currency,
  status: row.status,
  provenanceStatus: row.provenance_status,
});

const mapFederationLeadershipTenure = (row: any): FederationLeadershipTenure => ({
  id: row.id,
  personId: row.person_id,
  federationId: row.federation_id,
  role: row.role,
  termStart: row.term_start,
  termEnd: row.term_end ?? undefined,
  status: row.status,
  provenanceStatus: row.provenance_status,
});

const mapFederationCommittee = (row: any): FederationCommittee => ({
  id: row.id,
  federationId: row.federation_id,
  committeeType: row.committee_type,
  name: row.name,
  chairPersonId: row.chair_person_id ?? undefined,
  status: row.status,
  provenanceStatus: row.provenance_status,
});

const mapFederationStrategyPriority = (row: any): FederationStrategyPriority => ({
  id: row.id,
  federationId: row.federation_id,
  priority: row.priority,
  weight: row.weight,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to ?? undefined,
  status: row.status,
  provenanceStatus: row.provenance_status,
});

const mapFederationProject = (row: any): FederationProject => ({
  id: row.id,
  federationId: row.federation_id,
  projectType: row.project_type,
  name: row.name,
  locationId: row.location_id ?? undefined,
  targetProvinceId: row.target_province_id ?? undefined,
  targetDistrictId: row.target_district_id ?? undefined,
  academyId: row.academy_id ?? undefined,
  startDate: row.start_date,
  expectedCompletion: row.expected_completion,
  completedAt: row.completed_at ?? undefined,
  capitalCost: row.capital_cost,
  annualOperatingCost: row.annual_operating_cost,
  currency: row.currency,
  status: row.status,
  impactJson: json.parse<Record<string, number>>(row.impact_json, {}),
  fundingJson: json.parse<Record<string, number>>(row.funding_json, {}),
  provenanceStatus: row.provenance_status,
});

const mapFederationAsset = (row: any): FederationAsset => ({
  id: row.id,
  federationId: row.federation_id,
  assetType: row.asset_type,
  ownership: row.ownership,
  locationId: row.location_id ?? undefined,
  academyId: row.academy_id ?? undefined,
  estimatedValue: row.estimated_value,
  currency: row.currency,
  status: row.status,
});

const mapCompetitionReformProposal = (row: any): CompetitionReformProposal => ({
  id: row.id,
  federationId: row.federation_id,
  competitionId: row.competition_id,
  effectiveSeason: row.effective_season,
  changes: json.parse(row.changes_json, {}),
  status: row.status,
  proposedAt: row.proposed_at,
  decidedAt: row.decided_at ?? undefined,
  provenanceStatus: row.provenance_status,
});

const mapClubLicensingAssessment = (row: any): ClubLicensingAssessment => ({
  id: row.id,
  federationId: row.federation_id,
  clubId: row.club_id,
  seasonLabel: row.season_label,
  financial: row.financial,
  stadium: row.stadium,
  youth: row.youth,
  medical: row.medical,
  administrative: row.administrative,
  coaching: row.coaching,
  legal: row.legal,
  overall: row.overall,
  assessedAt: row.assessed_at,
  status: row.status,
});

const mapFederationGrantDistribution = (row: any): FederationGrantDistribution => ({
  id: row.id,
  federationId: row.federation_id,
  clubId: row.club_id,
  date: row.grant_date,
  grantType: row.grant_type,
  amount: row.amount,
  currency: row.currency,
  federationLedgerEntryId: row.federation_ledger_entry_id,
  clubLedgerEntryId: row.club_ledger_entry_id,
  status: row.status,
  provenanceStatus: row.provenance_status,
});

const mapNationalTeamCallup = (row: any): NationalTeamCallup => ({
  id: row.id,
  nationalTeamId: row.national_team_id,
  playerId: row.player_id,
  callupDate: row.callup_date,
  programme: row.programme,
  squadType: row.squad_type,
  status: row.status,
  provenanceStatus: row.provenance_status,
});

const mapNationalTeamAppearance = (row: any): NationalTeamAppearance => ({
  id: row.id,
  nationalTeamId: row.national_team_id,
  playerId: row.player_id,
  matchDate: row.match_date,
  opponentName: row.opponent_name,
  minutes: row.minutes,
  goals: row.goals,
  status: row.status,
});

const mapNationalTeamFixture = (row: any): NationalTeamFixture => ({
  id: row.id,
  federationId: row.federation_id,
  nationalTeamId: row.national_team_id,
  opponentName: row.opponent_name,
  fixtureDate: row.fixture_date,
  fixtureType: row.fixture_type,
  venueId: row.venue_id ?? undefined,
  status: row.status,
  homeGoals: row.home_goals ?? undefined,
  awayGoals: row.away_goals ?? undefined,
  estimatedCost: row.estimated_cost,
  estimatedRevenue: row.estimated_revenue,
  currency: row.currency,
  provenanceStatus: row.provenance_status,
});

const mapPlayerInternationalEligibility = (row: any): PlayerInternationalEligibility => ({
  id: row.id,
  playerId: row.player_id,
  federationId: row.federation_id,
  status: row.eligibility_status,
  documentationStatus: row.documentation_status,
  discoveredVia: row.discovered_via,
  lastReviewedAt: row.last_reviewed_at,
  provenanceStatus: row.provenance_status,
});

const mapCoachEducationProgramme = (row: any): CoachEducationProgramme => ({
  id: row.id,
  federationId: row.federation_id,
  licenceLevel: row.licence_level,
  startDate: row.start_date,
  endDate: row.end_date,
  capacity: row.capacity,
  cost: row.cost,
  graduates: row.graduates,
  currency: row.currency,
  status: row.status,
  provenanceStatus: row.provenance_status,
});

const mapRefereeDevelopmentProgramme = (row: any): RefereeDevelopmentProgramme => ({
  id: row.id,
  federationId: row.federation_id,
  programmeType: row.programme_type,
  startDate: row.start_date,
  endDate: row.end_date,
  capacity: row.capacity,
  cost: row.cost,
  refereesAdvanced: row.referees_advanced,
  currency: row.currency,
  status: row.status,
  provenanceStatus: row.provenance_status,
});

const mapOrganisationRelationship = (row: any): OrganisationRelationship => ({
  id: row.id,
  federationId: row.federation_id,
  organisationName: row.organisation_name,
  relationshipType: row.relationship_type,
  supportLevel: row.support_level,
  trust: row.trust,
  fundingRelationship: row.funding_relationship,
  updatedAt: row.updated_at,
  status: row.status,
});

const mapFederationSponsorshipContract = (row: any): FederationSponsorshipContract => ({
  id: row.id,
  federationId: row.federation_id,
  sponsorId: row.sponsor_id,
  type: row.sponsorship_type,
  startDate: row.start_date,
  endDate: row.end_date,
  annualValue: row.annual_value,
  currency: row.currency,
  status: row.status,
  provenanceStatus: row.provenance_status,
});

const mapFederationObjective = (row: any): FederationObjective => ({
  id: row.id,
  federationId: row.federation_id,
  objective: row.objective,
  cycleStart: row.cycle_start,
  cycleEnd: row.cycle_end,
  progress: row.progress,
  status: row.status,
  provenanceStatus: row.provenance_status,
});

const mapFederationKpi = (row: any): FederationKPI => ({
  id: row.id,
  federationId: row.federation_id,
  seasonLabel: row.season_label,
  metric: row.metric,
  value: row.metric_value,
  measuredAt: row.measured_at,
  status: row.status,
});

const mapFederationFinancialStatement = (row: any): FederationFinancialStatement => ({
  id: row.id,
  federationId: row.federation_id,
  seasonLabel: row.season_label,
  openingCash: row.opening_cash,
  revenueByCategory: json.parse(row.revenue_by_category_json, {}),
  expensesByCategory: json.parse(row.expenses_by_category_json, {}),
  programmeSpending: row.programme_spending,
  nationalTeamSpending: row.national_team_spending,
  competitionSpending: row.competition_spending,
  infrastructureSpending: row.infrastructure_spending,
  netProfitLoss: row.net_profit_loss,
  closingCash: row.closing_cash,
  debt: row.debt,
  currency: row.currency,
  closedAt: row.closed_at,
  status: row.status,
});

export class InternationalFootballRepository {
  constructor(private readonly db: GameDatabase) {}

  upsertTeamProfile(profile: InternationalTeamProfile): void {
    this.db
      .prepare(
        `INSERT INTO international_team_profiles
        (id, country_id, national_team_id, name, team_type, confederation, region,
         simulation_reputation, simulation_strength, home_advantage_profile, development_level,
         form_rating, last_updated, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          national_team_id = excluded.national_team_id,
          name = excluded.name,
          confederation = excluded.confederation,
          region = excluded.region,
          simulation_reputation = excluded.simulation_reputation,
          simulation_strength = excluded.simulation_strength,
          home_advantage_profile = excluded.home_advantage_profile,
          development_level = excluded.development_level,
          form_rating = excluded.form_rating,
          last_updated = excluded.last_updated,
          provenance_status = excluded.provenance_status`,
      )
      .run(
        profile.id,
        profile.countryId,
        profile.nationalTeamId ?? null,
        profile.name,
        profile.teamType,
        profile.confederation,
        profile.region,
        profile.simulationReputation,
        profile.simulationStrength,
        profile.homeAdvantageProfile,
        profile.developmentLevel,
        profile.formRating,
        profile.lastUpdated,
        profile.provenanceStatus,
      );
  }

  teamProfiles(): InternationalTeamProfile[] {
    return (
      this.db.prepare("SELECT * FROM international_team_profiles ORDER BY name").all() as any[]
    ).map(mapInternationalTeamProfile);
  }

  teamProfile(id: EntityId): InternationalTeamProfile | undefined {
    const row = this.db.prepare("SELECT * FROM international_team_profiles WHERE id = ?").get(id);
    return row ? mapInternationalTeamProfile(row) : undefined;
  }

  upsertDevelopmentProfile(profile: InternationalDevelopmentProfile): void {
    this.db
      .prepare(
        `INSERT INTO international_development_profiles
        (id, country_id, effective_from, football_development, youth_pipeline, coach_quality,
         infrastructure, domestic_professionalism, population_talent_base, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          football_development = excluded.football_development,
          youth_pipeline = excluded.youth_pipeline,
          coach_quality = excluded.coach_quality,
          infrastructure = excluded.infrastructure,
          domestic_professionalism = excluded.domestic_professionalism,
          population_talent_base = excluded.population_talent_base`,
      )
      .run(
        profile.id,
        profile.countryId,
        profile.effectiveFrom,
        profile.footballDevelopment,
        profile.youthPipeline,
        profile.coachQuality,
        profile.infrastructure,
        profile.domesticProfessionalism,
        profile.populationTalentBase,
        profile.provenanceStatus,
      );
  }

  developmentProfiles(): InternationalDevelopmentProfile[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM international_development_profiles ORDER BY country_id, effective_from",
        )
        .all() as any[]
    ).map(mapInternationalDevelopmentProfile);
  }

  upsertCompetition(competition: InternationalCompetition): void {
    this.db
      .prepare(
        `INSERT INTO international_competitions
        (id, name, competition_type, confederation, region, cadence_years, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          competition_type = excluded.competition_type,
          confederation = excluded.confederation,
          region = excluded.region,
          cadence_years = excluded.cadence_years,
          provenance_status = excluded.provenance_status`,
      )
      .run(
        competition.id,
        competition.name,
        competition.competitionType,
        competition.confederation ?? null,
        competition.region ?? null,
        competition.cadenceYears,
        competition.provenanceStatus,
      );
  }

  competitions(): InternationalCompetition[] {
    return (
      this.db.prepare("SELECT * FROM international_competitions ORDER BY name").all() as any[]
    ).map(mapInternationalCompetition);
  }

  upsertEdition(edition: InternationalCompetitionEdition): void {
    this.db
      .prepare(
        `INSERT INTO international_competition_editions
        (id, competition_id, name, cycle, start_date, end_date, status, host_country_ids_json,
         qualification_links_json, rule_provenance_status, rule_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          start_date = excluded.start_date,
          end_date = excluded.end_date,
          status = excluded.status,
          host_country_ids_json = excluded.host_country_ids_json,
          qualification_links_json = excluded.qualification_links_json,
          rule_provenance_status = excluded.rule_provenance_status,
          rule_notes = excluded.rule_notes`,
      )
      .run(
        edition.id,
        edition.competitionId,
        edition.name,
        edition.cycle,
        edition.startDate,
        edition.endDate,
        edition.status,
        json.stringify(edition.hostCountryIds),
        json.stringify(edition.qualificationLinks),
        edition.ruleProvenanceStatus,
        edition.ruleNotes ?? null,
      );
  }

  editions(): InternationalCompetitionEdition[] {
    return (
      this.db
        .prepare("SELECT * FROM international_competition_editions ORDER BY start_date, name")
        .all() as any[]
    ).map(mapInternationalCompetitionEdition);
  }

  upsertStage(stage: InternationalCompetitionStage): void {
    this.db
      .prepare(
        `INSERT INTO international_competition_stages
        (id, edition_id, name, stage_order, format_type, group_count, group_size, legs,
         teams_to_advance, matchday_squad_size, preliminary_squad_size, final_squad_size,
         tiebreakers_json, allow_extra_time, allow_penalties, away_goals, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          format_type = excluded.format_type,
          group_count = excluded.group_count,
          group_size = excluded.group_size,
          legs = excluded.legs,
          teams_to_advance = excluded.teams_to_advance,
          matchday_squad_size = excluded.matchday_squad_size,
          preliminary_squad_size = excluded.preliminary_squad_size,
          final_squad_size = excluded.final_squad_size,
          tiebreakers_json = excluded.tiebreakers_json,
          allow_extra_time = excluded.allow_extra_time,
          allow_penalties = excluded.allow_penalties,
          away_goals = excluded.away_goals`,
      )
      .run(
        stage.id,
        stage.editionId,
        stage.name,
        stage.stageOrder,
        stage.formatType,
        stage.groupCount,
        stage.groupSize,
        stage.legs,
        stage.teamsToAdvance,
        stage.matchdaySquadSize,
        stage.preliminarySquadSize,
        stage.finalSquadSize,
        json.stringify(stage.tiebreakers),
        Number(stage.allowExtraTime),
        Number(stage.allowPenalties),
        Number(stage.awayGoals),
        stage.provenanceStatus,
      );
  }

  stages(editionId?: EntityId): InternationalCompetitionStage[] {
    const rows = editionId
      ? (this.db
          .prepare(
            "SELECT * FROM international_competition_stages WHERE edition_id = ? ORDER BY stage_order",
          )
          .all(editionId) as any[])
      : (this.db
          .prepare(
            "SELECT * FROM international_competition_stages ORDER BY edition_id, stage_order",
          )
          .all() as any[]);
    return rows.map(mapInternationalCompetitionStage);
  }

  upsertParticipant(participant: InternationalCompetitionParticipant): void {
    this.db
      .prepare(
        `INSERT INTO international_competition_participants
        (id, edition_id, team_profile_id, entry_status, seed_rating, pot, group_name,
         final_placement, qualification_source, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          entry_status = excluded.entry_status,
          seed_rating = excluded.seed_rating,
          pot = excluded.pot,
          group_name = excluded.group_name,
          final_placement = excluded.final_placement,
          qualification_source = excluded.qualification_source`,
      )
      .run(
        participant.id,
        participant.editionId,
        participant.teamProfileId,
        participant.entryStatus,
        participant.seedRating,
        participant.pot ?? null,
        participant.groupName ?? null,
        participant.finalPlacement ?? null,
        participant.qualificationSource ?? null,
        participant.provenanceStatus,
      );
  }

  participants(editionId?: EntityId): InternationalCompetitionParticipant[] {
    const rows = editionId
      ? (this.db
          .prepare(
            "SELECT * FROM international_competition_participants WHERE edition_id = ? ORDER BY seed_rating DESC",
          )
          .all(editionId) as any[])
      : (this.db
          .prepare(
            "SELECT * FROM international_competition_participants ORDER BY edition_id, seed_rating DESC",
          )
          .all() as any[]);
    return rows.map(mapInternationalCompetitionParticipant);
  }

  upsertDraw(draw: InternationalDrawRecord): void {
    this.db
      .prepare(
        `INSERT INTO international_draw_records
        (id, edition_id, stage_id, draw_date, seed_key, pots_json, groups_json, restrictions_json,
         provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          draw_date = excluded.draw_date,
          seed_key = excluded.seed_key,
          pots_json = excluded.pots_json,
          groups_json = excluded.groups_json,
          restrictions_json = excluded.restrictions_json`,
      )
      .run(
        draw.id,
        draw.editionId,
        draw.stageId,
        draw.drawDate,
        draw.seedKey,
        json.stringify(draw.pots),
        json.stringify(draw.groups),
        json.stringify(draw.restrictions),
        draw.provenanceStatus,
      );
  }

  draws(editionId?: EntityId): InternationalDrawRecord[] {
    const rows = editionId
      ? (this.db
          .prepare(
            "SELECT * FROM international_draw_records WHERE edition_id = ? ORDER BY draw_date",
          )
          .all(editionId) as any[])
      : (this.db
          .prepare("SELECT * FROM international_draw_records ORDER BY draw_date")
          .all() as any[]);
    return rows.map(mapInternationalDrawRecord);
  }

  upsertMatch(match: InternationalMatch): void {
    this.db
      .prepare(
        `INSERT INTO international_matches
        (id, edition_id, stage_id, group_name, match_date, home_team_profile_id, away_team_profile_id,
         neutral_venue, venue_id, status, home_goals, away_goals, extra_time_played,
         penalties_played, home_penalty_goals, away_penalty_goals, winner_team_profile_id,
         importance, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          match_date = excluded.match_date,
          status = excluded.status,
          home_goals = excluded.home_goals,
          away_goals = excluded.away_goals,
          extra_time_played = excluded.extra_time_played,
          penalties_played = excluded.penalties_played,
          home_penalty_goals = excluded.home_penalty_goals,
          away_penalty_goals = excluded.away_penalty_goals,
          winner_team_profile_id = excluded.winner_team_profile_id`,
      )
      .run(
        match.id,
        match.editionId ?? null,
        match.stageId ?? null,
        match.groupName ?? null,
        match.matchDate,
        match.homeTeamProfileId,
        match.awayTeamProfileId,
        Number(match.neutralVenue),
        match.venueId ?? null,
        match.status,
        match.homeGoals ?? null,
        match.awayGoals ?? null,
        Number(match.extraTimePlayed),
        Number(match.penaltiesPlayed),
        match.homePenaltyGoals ?? null,
        match.awayPenaltyGoals ?? null,
        match.winnerTeamProfileId ?? null,
        match.importance,
        match.provenanceStatus,
      );
  }

  matches(editionId?: EntityId): InternationalMatch[] {
    const rows = editionId
      ? (this.db
          .prepare(
            "SELECT * FROM international_matches WHERE edition_id = ? ORDER BY match_date, id",
          )
          .all(editionId) as any[])
      : (this.db
          .prepare("SELECT * FROM international_matches ORDER BY match_date, id")
          .all() as any[]);
    return rows.map(mapInternationalMatch);
  }

  upsertRanking(ranking: SimulationWorldRanking): void {
    this.db
      .prepare(
        `INSERT INTO simulation_world_rankings
        (id, team_profile_id, ranking_date, rank, points, confederation_rank, reputation,
         provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          rank = excluded.rank,
          points = excluded.points,
          confederation_rank = excluded.confederation_rank,
          reputation = excluded.reputation`,
      )
      .run(
        ranking.id,
        ranking.teamProfileId,
        ranking.rankingDate,
        ranking.rank,
        ranking.points,
        ranking.confederationRank,
        ranking.reputation,
        ranking.provenanceStatus,
      );
  }

  rankings(rankingDate?: string): SimulationWorldRanking[] {
    const rows = rankingDate
      ? (this.db
          .prepare("SELECT * FROM simulation_world_rankings WHERE ranking_date = ? ORDER BY rank")
          .all(rankingDate) as any[])
      : (this.db
          .prepare("SELECT * FROM simulation_world_rankings ORDER BY ranking_date, rank")
          .all() as any[]);
    return rows.map(mapSimulationWorldRanking);
  }

  upsertDuty(duty: NationalTeamDuty): void {
    this.db
      .prepare(
        `INSERT INTO national_team_duties
        (id, national_team_id, player_id, competition_edition_id, departure_date, return_date,
         status, fitness_effect, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          return_date = excluded.return_date,
          fitness_effect = excluded.fitness_effect`,
      )
      .run(
        duty.id,
        duty.nationalTeamId,
        duty.playerId,
        duty.competitionEditionId ?? null,
        duty.departureDate,
        duty.returnDate,
        duty.status,
        duty.fitnessEffect,
        duty.provenanceStatus,
      );
  }

  duties(): NationalTeamDuty[] {
    return (
      this.db.prepare("SELECT * FROM national_team_duties ORDER BY departure_date").all() as any[]
    ).map(mapNationalTeamDuty);
  }

  upsertCohesion(cohesion: NationalTeamCohesion): void {
    this.db
      .prepare(
        `INSERT INTO national_team_cohesion
        (id, national_team_id, player_id, familiarity, last_updated, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          familiarity = excluded.familiarity,
          last_updated = excluded.last_updated`,
      )
      .run(
        cohesion.id,
        cohesion.nationalTeamId,
        cohesion.playerId,
        cohesion.familiarity,
        cohesion.lastUpdated,
        cohesion.provenanceStatus,
      );
  }

  cohesion(nationalTeamId: EntityId): NationalTeamCohesion[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM national_team_cohesion WHERE national_team_id = ? ORDER BY familiarity DESC",
        )
        .all(nationalTeamId) as any[]
    ).map(mapNationalTeamCohesion);
  }

  upsertCamp(camp: NationalTeamCamp): void {
    this.db
      .prepare(
        `INSERT INTO national_team_camps
        (id, federation_id, national_team_id, competition_edition_id, start_date, end_date, focus,
         cost, currency, status, cohesion_gain, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          cost = excluded.cost,
          cohesion_gain = excluded.cohesion_gain`,
      )
      .run(
        camp.id,
        camp.federationId,
        camp.nationalTeamId,
        camp.competitionEditionId ?? null,
        camp.startDate,
        camp.endDate,
        camp.focus,
        camp.cost,
        camp.currency,
        camp.status,
        camp.cohesionGain,
        camp.provenanceStatus,
      );
  }

  camps(): NationalTeamCamp[] {
    return (
      this.db.prepare("SELECT * FROM national_team_camps ORDER BY start_date").all() as any[]
    ).map(mapNationalTeamCamp);
  }

  upsertInternationalRetirement(retirement: InternationalRetirement): void {
    this.db
      .prepare(
        `INSERT INTO international_retirements
        (id, player_id, national_team_id, status, decided_on, reason, provenance_status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          decided_on = excluded.decided_on,
          reason = excluded.reason`,
      )
      .run(
        retirement.id,
        retirement.playerId,
        retirement.nationalTeamId,
        retirement.status,
        retirement.decidedOn,
        retirement.reason ?? null,
        retirement.provenanceStatus,
      );
  }

  internationalRetirements(nationalTeamId?: EntityId): InternationalRetirement[] {
    const rows = nationalTeamId
      ? (this.db
          .prepare(
            "SELECT * FROM international_retirements WHERE national_team_id = ? ORDER BY decided_on",
          )
          .all(nationalTeamId) as any[])
      : (this.db
          .prepare("SELECT * FROM international_retirements ORDER BY decided_on")
          .all() as any[]);
    return rows.map(mapInternationalRetirement);
  }
}

const mapInternationalTeamProfile = (row: any): InternationalTeamProfile => ({
  id: row.id,
  countryId: row.country_id,
  nationalTeamId: row.national_team_id ?? undefined,
  name: row.name,
  teamType: row.team_type,
  confederation: row.confederation,
  region: row.region,
  simulationReputation: row.simulation_reputation,
  simulationStrength: row.simulation_strength,
  homeAdvantageProfile: row.home_advantage_profile,
  developmentLevel: row.development_level,
  formRating: row.form_rating,
  lastUpdated: row.last_updated,
  provenanceStatus: row.provenance_status,
});

const mapInternationalDevelopmentProfile = (row: any): InternationalDevelopmentProfile => ({
  id: row.id,
  countryId: row.country_id,
  effectiveFrom: row.effective_from,
  footballDevelopment: row.football_development,
  youthPipeline: row.youth_pipeline,
  coachQuality: row.coach_quality,
  infrastructure: row.infrastructure,
  domesticProfessionalism: row.domestic_professionalism,
  populationTalentBase: row.population_talent_base,
  provenanceStatus: row.provenance_status,
});

const mapInternationalCompetition = (row: any): InternationalCompetition => ({
  id: row.id,
  name: row.name,
  competitionType: row.competition_type,
  confederation: row.confederation ?? undefined,
  region: row.region ?? undefined,
  cadenceYears: row.cadence_years,
  provenanceStatus: row.provenance_status,
});

const mapInternationalCompetitionEdition = (row: any): InternationalCompetitionEdition => ({
  id: row.id,
  competitionId: row.competition_id,
  name: row.name,
  cycle: row.cycle,
  startDate: row.start_date,
  endDate: row.end_date,
  status: row.status,
  hostCountryIds: json.parse(row.host_country_ids_json, []),
  qualificationLinks: json.parse(row.qualification_links_json, []),
  ruleProvenanceStatus: row.rule_provenance_status,
  ruleNotes: row.rule_notes ?? undefined,
});

const mapInternationalCompetitionStage = (row: any): InternationalCompetitionStage => ({
  id: row.id,
  editionId: row.edition_id,
  name: row.name,
  stageOrder: row.stage_order,
  formatType: row.format_type,
  groupCount: row.group_count,
  groupSize: row.group_size,
  legs: row.legs,
  teamsToAdvance: row.teams_to_advance,
  matchdaySquadSize: row.matchday_squad_size,
  preliminarySquadSize: row.preliminary_squad_size,
  finalSquadSize: row.final_squad_size,
  tiebreakers: json.parse(row.tiebreakers_json, []),
  allowExtraTime: Boolean(row.allow_extra_time),
  allowPenalties: Boolean(row.allow_penalties),
  awayGoals: Boolean(row.away_goals),
  provenanceStatus: row.provenance_status,
});

const mapInternationalCompetitionParticipant = (row: any): InternationalCompetitionParticipant => ({
  id: row.id,
  editionId: row.edition_id,
  teamProfileId: row.team_profile_id,
  entryStatus: row.entry_status,
  seedRating: row.seed_rating,
  pot: row.pot ?? undefined,
  groupName: row.group_name ?? undefined,
  finalPlacement: row.final_placement ?? undefined,
  qualificationSource: row.qualification_source ?? undefined,
  provenanceStatus: row.provenance_status,
});

const mapInternationalDrawRecord = (row: any): InternationalDrawRecord => ({
  id: row.id,
  editionId: row.edition_id,
  stageId: row.stage_id,
  drawDate: row.draw_date,
  seedKey: row.seed_key,
  pots: json.parse(row.pots_json, []),
  groups: json.parse(row.groups_json, []),
  restrictions: json.parse(row.restrictions_json, {}),
  provenanceStatus: row.provenance_status,
});

const mapInternationalMatch = (row: any): InternationalMatch => ({
  id: row.id,
  editionId: row.edition_id ?? undefined,
  stageId: row.stage_id ?? undefined,
  groupName: row.group_name ?? undefined,
  matchDate: row.match_date,
  homeTeamProfileId: row.home_team_profile_id,
  awayTeamProfileId: row.away_team_profile_id,
  neutralVenue: Boolean(row.neutral_venue),
  venueId: row.venue_id ?? undefined,
  status: row.status,
  homeGoals: row.home_goals ?? undefined,
  awayGoals: row.away_goals ?? undefined,
  extraTimePlayed: Boolean(row.extra_time_played),
  penaltiesPlayed: Boolean(row.penalties_played),
  homePenaltyGoals: row.home_penalty_goals ?? undefined,
  awayPenaltyGoals: row.away_penalty_goals ?? undefined,
  winnerTeamProfileId: row.winner_team_profile_id ?? undefined,
  importance: row.importance,
  provenanceStatus: row.provenance_status,
});

const mapSimulationWorldRanking = (row: any): SimulationWorldRanking => ({
  id: row.id,
  teamProfileId: row.team_profile_id,
  rankingDate: row.ranking_date,
  rank: row.rank,
  points: row.points,
  confederationRank: row.confederation_rank,
  reputation: row.reputation,
  provenanceStatus: row.provenance_status,
});

const mapNationalTeamDuty = (row: any): NationalTeamDuty => ({
  id: row.id,
  nationalTeamId: row.national_team_id,
  playerId: row.player_id,
  competitionEditionId: row.competition_edition_id ?? undefined,
  departureDate: row.departure_date,
  returnDate: row.return_date,
  status: row.status,
  fitnessEffect: row.fitness_effect,
  provenanceStatus: row.provenance_status,
});

const mapNationalTeamCohesion = (row: any): NationalTeamCohesion => ({
  id: row.id,
  nationalTeamId: row.national_team_id,
  playerId: row.player_id,
  familiarity: row.familiarity,
  lastUpdated: row.last_updated,
  provenanceStatus: row.provenance_status,
});

const mapNationalTeamCamp = (row: any): NationalTeamCamp => ({
  id: row.id,
  federationId: row.federation_id,
  nationalTeamId: row.national_team_id,
  competitionEditionId: row.competition_edition_id ?? undefined,
  startDate: row.start_date,
  endDate: row.end_date,
  focus: row.focus,
  cost: row.cost,
  currency: row.currency,
  status: row.status,
  cohesionGain: row.cohesion_gain,
  provenanceStatus: row.provenance_status,
});

const mapInternationalRetirement = (row: any): InternationalRetirement => ({
  id: row.id,
  playerId: row.player_id,
  nationalTeamId: row.national_team_id,
  status: row.status,
  decidedOn: row.decided_on,
  reason: row.reason ?? undefined,
  provenanceStatus: row.provenance_status,
});

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
