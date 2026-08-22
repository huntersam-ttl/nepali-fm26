import type {
  CareerCharacter,
  Club,
  Country,
  Federation,
  FinanceAccount,
  FinancialTransaction,
  HistoricalEvent,
  Location,
  Person,
  PersonRole,
  SaveMetadata,
  ScheduledEvent,
  Team,
  TeamPersonAssignment,
  Venue,
  Competition,
  CompetitionSeason,
  DataProvenance,
} from "@nepal-football-sim/shared-types";
import type { EntityId } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const json = {
  parse: <T>(value: string | null | undefined, fallback: T): T =>
    value === null || value === undefined ? fallback : (JSON.parse(value) as T),
  stringify: (value: unknown): string => JSON.stringify(value),
};

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
        "INSERT INTO locations (id, country_id, name, kind, parent_location_id) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        location.id,
        location.countryId,
        location.name,
        location.kind,
        location.parentLocationId ?? null,
      );
  }

  insertVenue(venue: Venue): void {
    this.db
      .prepare(
        "INSERT INTO venues (id, country_id, location_id, name, capacity) VALUES (?, ?, ?, ?, ?)",
      )
      .run(venue.id, venue.countryId, venue.locationId ?? null, venue.name, venue.capacity ?? null);
  }

  insertFederation(federation: Federation): void {
    this.db
      .prepare("INSERT INTO federations (id, country_id, name, founded_year) VALUES (?, ?, ?, ?)")
      .run(federation.id, federation.countryId, federation.name, federation.foundedYear ?? null);
  }

  insertClub(club: Club): void {
    this.db
      .prepare(
        "INSERT INTO clubs (id, name, country_id, location_id, ownership_type, founded_year) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        club.id,
        club.name,
        club.countryId,
        club.locationId ?? null,
        club.ownershipType,
        club.foundedYear ?? null,
      );
  }

  insertTeam(team: Team): void {
    this.db
      .prepare(
        "INSERT INTO teams (id, club_id, federation_id, name, level, gender) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        team.id,
        team.clubId ?? null,
        team.federationId ?? null,
        team.name,
        team.level,
        team.gender,
      );
  }

  insertCompetition(competition: Competition): void {
    this.db
      .prepare("INSERT INTO competitions (id, federation_id, name, scope) VALUES (?, ?, ?, ?)")
      .run(competition.id, competition.federationId ?? null, competition.name, competition.scope);
  }

  insertCompetitionSeason(season: CompetitionSeason): void {
    this.db
      .prepare(
        "INSERT INTO competition_seasons (id, competition_id, name, start_date, end_date) VALUES (?, ?, ?, ?, ?)",
      )
      .run(season.id, season.competitionId, season.name, season.startDate, season.endDate);
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
          coaching_licences_json, business_background, starting_reputation_profile)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        character.id,
        character.personId,
        character.preferredDisplayName ?? null,
        character.startingAge ?? null,
        character.footballBackground ?? null,
        character.education ?? null,
        character.playingExperience ?? null,
        json.stringify(character.coachingLicences),
        character.businessBackground ?? null,
        character.startingReputationProfile ?? null,
      );
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
      clubs: scalar("clubs"),
      teams: scalar("teams"),
      persons: scalar("persons"),
      personRoles: scalar("person_roles"),
      teamPersonAssignments: scalar("team_person_assignments"),
      entityProvenance: scalar("entity_provenance"),
    };
  }
}

export type WorldInspection = {
  countries: number;
  locations: number;
  venues: number;
  federations: number;
  competitions: number;
  competitionSeasons: number;
  clubs: number;
  teams: number;
  persons: number;
  personRoles: number;
  teamPersonAssignments: number;
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
