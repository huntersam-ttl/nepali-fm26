import type { GameDatabase } from "./connection.js";

export const CURRENT_DATABASE_VERSION = 7;

const migrations: ReadonlyArray<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS saves (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        world_date TEXT NOT NULL,
        database_version INTEGER NOT NULL,
        game_version TEXT NOT NULL,
        random_seed TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_saved_at TEXT NOT NULL,
        player_character_id TEXT
      );

      CREATE TABLE IF NOT EXISTS countries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        iso_code TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY,
        country_id TEXT NOT NULL REFERENCES countries(id),
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        parent_location_id TEXT REFERENCES locations(id)
      );

      CREATE TABLE IF NOT EXISTS federations (
        id TEXT PRIMARY KEY,
        country_id TEXT NOT NULL REFERENCES countries(id),
        name TEXT NOT NULL,
        founded_year INTEGER
      );

      CREATE TABLE IF NOT EXISTS clubs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        country_id TEXT NOT NULL REFERENCES countries(id),
        location_id TEXT REFERENCES locations(id),
        ownership_type TEXT NOT NULL,
        founded_year INTEGER
      );

      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        club_id TEXT REFERENCES clubs(id),
        federation_id TEXT REFERENCES federations(id),
        name TEXT NOT NULL,
        level TEXT NOT NULL,
        gender TEXT NOT NULL,
        CHECK (club_id IS NOT NULL OR federation_id IS NOT NULL)
      );

      CREATE TABLE IF NOT EXISTS persons (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        display_name TEXT,
        date_of_birth TEXT,
        nationality_country_id TEXT NOT NULL REFERENCES countries(id),
        second_nationality_country_id TEXT REFERENCES countries(id),
        gender_presentation TEXT,
        place_of_birth_location_id TEXT REFERENCES locations(id),
        hometown_location_id TEXT REFERENCES locations(id),
        languages_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS person_roles (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        role TEXT NOT NULL,
        active_from TEXT NOT NULL,
        active_to TEXT
      );

      CREATE TABLE IF NOT EXISTS career_characters (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        preferred_display_name TEXT,
        starting_age INTEGER,
        football_background TEXT,
        education TEXT,
        playing_experience TEXT,
        coaching_licences_json TEXT NOT NULL,
        business_background TEXT,
        starting_reputation_profile TEXT
      );

      CREATE TABLE IF NOT EXISTS competitions (
        id TEXT PRIMARY KEY,
        federation_id TEXT REFERENCES federations(id),
        name TEXT NOT NULL,
        scope TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS competition_seasons (
        id TEXT PRIMARY KEY,
        competition_id TEXT NOT NULL REFERENCES competitions(id),
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fixtures (
        id TEXT PRIMARY KEY,
        competition_season_id TEXT REFERENCES competition_seasons(id),
        home_team_id TEXT NOT NULL REFERENCES teams(id),
        away_team_id TEXT NOT NULL REFERENCES teams(id),
        scheduled_date TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        fixture_id TEXT NOT NULL REFERENCES fixtures(id),
        played_date TEXT,
        home_goals INTEGER,
        away_goals INTEGER
      );

      CREATE TABLE IF NOT EXISTS match_events (
        id TEXT PRIMARY KEY,
        match_id TEXT NOT NULL REFERENCES matches(id),
        minute INTEGER,
        type TEXT NOT NULL,
        person_id TEXT REFERENCES persons(id),
        team_id TEXT REFERENCES teams(id),
        data_json TEXT
      );

      CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        contract_kind TEXT NOT NULL,
        employer_entity_json TEXT NOT NULL,
        starts_on TEXT NOT NULL,
        ends_on TEXT,
        wage_amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        from_club_id TEXT REFERENCES clubs(id),
        to_club_id TEXT NOT NULL REFERENCES clubs(id),
        transfer_date TEXT NOT NULL,
        fee_amount_minor INTEGER,
        currency TEXT
      );

      CREATE TABLE IF NOT EXISTS loans (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        from_club_id TEXT NOT NULL REFERENCES clubs(id),
        to_club_id TEXT NOT NULL REFERENCES clubs(id),
        starts_on TEXT NOT NULL,
        ends_on TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS finance_accounts (
        id TEXT PRIMARY KEY,
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        currency TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS financial_transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES finance_accounts(id),
        occurred_on TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        related_entity_json TEXT
      );

      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        from_entity_json TEXT NOT NULL,
        to_entity_json TEXT NOT NULL,
        kind TEXT NOT NULL,
        strength INTEGER
      );

      CREATE TABLE IF NOT EXISTS promises (
        id TEXT PRIMARY KEY,
        made_by_json TEXT NOT NULL,
        made_to_json TEXT NOT NULL,
        made_on TEXT NOT NULL,
        due_on TEXT,
        status TEXT NOT NULL,
        description TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS historical_events (
        id TEXT PRIMARY KEY,
        occurred_on TEXT NOT NULL,
        event_type TEXT NOT NULL,
        involved_entities_json TEXT NOT NULL,
        title TEXT NOT NULL,
        data_json TEXT,
        importance TEXT NOT NULL,
        scope TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scheduled_events (
        id TEXT PRIMARY KEY,
        due_on TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        processed_on TEXT
      );

      CREATE TABLE IF NOT EXISTS import_records (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        payload_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS venues (
        id TEXT PRIMARY KEY,
        country_id TEXT NOT NULL REFERENCES countries(id),
        location_id TEXT REFERENCES locations(id),
        name TEXT NOT NULL,
        capacity INTEGER
      );

      CREATE TABLE IF NOT EXISTS team_person_assignments (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        team_id TEXT NOT NULL REFERENCES teams(id),
        role TEXT NOT NULL,
        started_on TEXT,
        ended_on TEXT
      );

      CREATE TABLE IF NOT EXISTS entity_provenance (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        source_url TEXT,
        source_name TEXT NOT NULL,
        last_verified_date TEXT,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_entity_provenance_entity
        ON entity_provenance(entity_type, entity_id);
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE fixtures ADD COLUMN round INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE fixtures ADD COLUMN venue_id TEXT REFERENCES venues(id);

      ALTER TABLE match_events ADD COLUMN stoppage_time INTEGER;
      ALTER TABLE match_events ADD COLUMN primary_person_id TEXT REFERENCES persons(id);
      ALTER TABLE match_events ADD COLUMN secondary_person_id TEXT REFERENCES persons(id);

      CREATE TABLE IF NOT EXISTS competition_rules (
        id TEXT PRIMARY KEY,
        competition_season_id TEXT NOT NULL REFERENCES competition_seasons(id),
        competition_type TEXT NOT NULL,
        points_for_win INTEGER NOT NULL,
        points_for_draw INTEGER NOT NULL,
        points_for_loss INTEGER NOT NULL,
        tiebreakers_json TEXT NOT NULL,
        number_of_rounds INTEGER NOT NULL,
        home_away_structure TEXT NOT NULL,
        fixture_count INTEGER,
        season_start_date TEXT NOT NULL,
        season_end_date TEXT NOT NULL,
        round_spacing_days INTEGER NOT NULL,
        promotion_slots INTEGER NOT NULL,
        relegation_slots INTEGER NOT NULL,
        continental_qualification_slots INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS player_attributes (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        primary_position TEXT NOT NULL,
        secondary_positions_json TEXT NOT NULL,
        technical_json TEXT NOT NULL,
        mental_json TEXT NOT NULL,
        physical_json TEXT NOT NULL,
        goalkeeping_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS injuries (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        injury_type TEXT NOT NULL,
        date_occurred TEXT NOT NULL,
        expected_recovery_date TEXT NOT NULL,
        severity TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS suspensions (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        competition_season_id TEXT NOT NULL REFERENCES competition_seasons(id),
        reason TEXT NOT NULL,
        matches_remaining INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS league_standings (
        competition_season_id TEXT NOT NULL REFERENCES competition_seasons(id),
        team_id TEXT NOT NULL REFERENCES teams(id),
        played INTEGER NOT NULL,
        won INTEGER NOT NULL,
        drawn INTEGER NOT NULL,
        lost INTEGER NOT NULL,
        goals_for INTEGER NOT NULL,
        goals_against INTEGER NOT NULL,
        goal_difference INTEGER NOT NULL,
        points INTEGER NOT NULL,
        PRIMARY KEY (competition_season_id, team_id)
      );

      CREATE TABLE IF NOT EXISTS player_season_stats (
        competition_season_id TEXT NOT NULL REFERENCES competition_seasons(id),
        person_id TEXT NOT NULL REFERENCES persons(id),
        team_id TEXT NOT NULL REFERENCES teams(id),
        appearances INTEGER NOT NULL,
        starts INTEGER NOT NULL,
        minutes INTEGER NOT NULL,
        goals INTEGER NOT NULL,
        assists INTEGER NOT NULL,
        yellow_cards INTEGER NOT NULL,
        red_cards INTEGER NOT NULL,
        average_rating REAL NOT NULL,
        clean_sheets INTEGER NOT NULL,
        PRIMARY KEY (competition_season_id, person_id, team_id)
      );

      CREATE TABLE IF NOT EXISTS team_season_stats (
        competition_season_id TEXT NOT NULL REFERENCES competition_seasons(id),
        team_id TEXT NOT NULL REFERENCES teams(id),
        played INTEGER NOT NULL,
        wins INTEGER NOT NULL,
        draws INTEGER NOT NULL,
        losses INTEGER NOT NULL,
        goals_for INTEGER NOT NULL,
        goals_against INTEGER NOT NULL,
        clean_sheets INTEGER NOT NULL,
        PRIMARY KEY (competition_season_id, team_id)
      );

      CREATE TABLE IF NOT EXISTS competition_winners (
        id TEXT PRIMARY KEY,
        competition_season_id TEXT NOT NULL REFERENCES competition_seasons(id),
        team_id TEXT NOT NULL REFERENCES teams(id),
        decided_on TEXT NOT NULL
      );
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE career_characters ADD COLUMN coaching_experience TEXT;

      CREATE TABLE IF NOT EXISTS manager_profiles (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        attributes_json TEXT NOT NULL,
        preferred_style TEXT,
        reputation_profile TEXT NOT NULL,
        created_on TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS manager_contracts (
        id TEXT PRIMARY KEY,
        manager_profile_id TEXT NOT NULL REFERENCES manager_profiles(id),
        person_id TEXT NOT NULL REFERENCES persons(id),
        team_id TEXT REFERENCES teams(id),
        club_id TEXT REFERENCES clubs(id),
        job_title TEXT NOT NULL,
        contract_start TEXT NOT NULL,
        contract_end TEXT,
        salary_amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tactical_setups (
        id TEXT PRIMARY KEY,
        manager_profile_id TEXT REFERENCES manager_profiles(id),
        team_id TEXT NOT NULL REFERENCES teams(id),
        name TEXT NOT NULL,
        formation_json TEXT NOT NULL,
        style TEXT NOT NULL,
        instructions_json TEXT NOT NULL,
        familiarity_json TEXT NOT NULL,
        assignments_json TEXT NOT NULL,
        bench_json TEXT NOT NULL,
        set_pieces_json TEXT NOT NULL,
        created_on TEXT NOT NULL,
        updated_on TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inbox_items (
        id TEXT PRIMARY KEY,
        created_on TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        related_entity_json TEXT,
        read INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS player_availability_states (
        person_id TEXT PRIMARY KEY REFERENCES persons(id),
        team_id TEXT REFERENCES teams(id),
        fitness REAL NOT NULL,
        morale_modifier REAL NOT NULL,
        form_modifier REAL NOT NULL,
        availability TEXT NOT NULL,
        updated_on TEXT NOT NULL
      );
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE venues ADD COLUMN pitch_type TEXT;

      ALTER TABLE clubs ADD COLUMN official_name TEXT;
      ALTER TABLE clubs ADD COLUMN short_name TEXT;
      ALTER TABLE clubs ADD COLUMN nepali_name TEXT;
      ALTER TABLE clubs ADD COLUMN canonical_external_id TEXT;
      ALTER TABLE clubs ADD COLUMN organisation_type TEXT;
      ALTER TABLE clubs ADD COLUMN parent_organisation TEXT;

      ALTER TABLE teams ADD COLUMN canonical_external_id TEXT;

      CREATE TABLE IF NOT EXISTS club_aliases (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        alias TEXT NOT NULL,
        alias_type TEXT NOT NULL,
        UNIQUE (club_id, alias)
      );

      CREATE TABLE IF NOT EXISTS club_relationships (
        id TEXT PRIMARY KEY,
        parent_club_id TEXT NOT NULL REFERENCES clubs(id),
        child_club_id TEXT REFERENCES clubs(id),
        child_team_id TEXT REFERENCES teams(id),
        relationship_type TEXT NOT NULL,
        CHECK (child_club_id IS NOT NULL OR child_team_id IS NOT NULL)
      );

      CREATE TABLE IF NOT EXISTS club_memberships (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        team_id TEXT REFERENCES teams(id),
        competition_id TEXT NOT NULL REFERENCES competitions(id),
        competition_season_id TEXT REFERENCES competition_seasons(id),
        membership_type TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS academies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        canonical_external_id TEXT,
        country_id TEXT NOT NULL REFERENCES countries(id),
        location_id TEXT REFERENCES locations(id),
        parent_club_id TEXT REFERENCES clubs(id),
        linked_club_id TEXT REFERENCES clubs(id),
        federation_id TEXT REFERENCES federations(id),
        academy_type TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS venue_relationships (
        id TEXT PRIMARY KEY,
        venue_id TEXT NOT NULL REFERENCES venues(id),
        club_id TEXT REFERENCES clubs(id),
        team_id TEXT REFERENCES teams(id),
        relationship_type TEXT NOT NULL,
        CHECK (club_id IS NOT NULL OR team_id IS NOT NULL)
      );

      CREATE INDEX IF NOT EXISTS idx_club_aliases_alias ON club_aliases(alias);
      CREATE INDEX IF NOT EXISTS idx_club_memberships_season
        ON club_memberships(competition_season_id, club_id);
      CREATE INDEX IF NOT EXISTS idx_club_relationships_parent
        ON club_relationships(parent_club_id);
      CREATE INDEX IF NOT EXISTS idx_venue_relationships_venue
        ON venue_relationships(venue_id);
    `,
  },
  {
    version: 6,
    sql: `
      ALTER TABLE competitions ADD COLUMN category TEXT;

      ALTER TABLE competition_rules ADD COLUMN promotion_enabled INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE competition_rules ADD COLUMN relegation_enabled INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE competition_rules ADD COLUMN special_rules_json TEXT NOT NULL DEFAULT '{}';

      CREATE TABLE IF NOT EXISTS competition_relationships (
        id TEXT PRIMARY KEY,
        from_competition_id TEXT NOT NULL REFERENCES competitions(id),
        to_competition_id TEXT NOT NULL REFERENCES competitions(id),
        movement_type TEXT NOT NULL,
        number_of_teams INTEGER NOT NULL,
        selection_method TEXT NOT NULL,
        effective_season_id TEXT REFERENCES competition_seasons(id)
      );

      CREATE TABLE IF NOT EXISTS competition_movements (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        team_id TEXT REFERENCES teams(id),
        from_competition_id TEXT NOT NULL REFERENCES competitions(id),
        to_competition_id TEXT NOT NULL REFERENCES competitions(id),
        from_competition_season_id TEXT NOT NULL REFERENCES competition_seasons(id),
        to_competition_season_id TEXT NOT NULL REFERENCES competition_seasons(id),
        movement_type TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_club_memberships_unique_active_season
        ON club_memberships(club_id, competition_season_id)
        WHERE competition_season_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_competition_relationships_from
        ON competition_relationships(from_competition_id, movement_type);
      CREATE INDEX IF NOT EXISTS idx_competition_movements_season
        ON competition_movements(from_competition_season_id, to_competition_season_id);
    `,
  },
  {
    version: 7,
    sql: `
      ALTER TABLE locations ADD COLUMN canonical_external_id TEXT;
      ALTER TABLE locations ADD COLUMN latitude REAL;
      ALTER TABLE locations ADD COLUMN longitude REAL;
      ALTER TABLE locations ADD COLUMN altitude_meters INTEGER;
      ALTER TABLE locations ADD COLUMN climate_profile_json TEXT;

      ALTER TABLE venues ADD COLUMN canonical_external_id TEXT;
      ALTER TABLE venues ADD COLUMN province_id TEXT REFERENCES locations(id);
      ALTER TABLE venues ADD COLUMN district_id TEXT REFERENCES locations(id);
      ALTER TABLE venues ADD COLUMN city_id TEXT REFERENCES locations(id);
      ALTER TABLE venues ADD COLUMN official_name TEXT;
      ALTER TABLE venues ADD COLUMN short_name TEXT;
      ALTER TABLE venues ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE venues ADD COLUMN venue_type TEXT NOT NULL DEFAULT 'UNKNOWN';
      ALTER TABLE venues ADD COLUMN latitude REAL;
      ALTER TABLE venues ADD COLUMN longitude REAL;
      ALTER TABLE venues ADD COLUMN altitude_meters INTEGER;
      ALTER TABLE venues ADD COLUMN surface_type TEXT NOT NULL DEFAULT 'UNKNOWN';
      ALTER TABLE venues ADD COLUMN pitch_quality TEXT NOT NULL DEFAULT 'UNKNOWN';
      ALTER TABLE venues ADD COLUMN year_opened INTEGER;
      ALTER TABLE venues ADD COLUMN year_last_renovated INTEGER;
      ALTER TABLE venues ADD COLUMN floodlights INTEGER;
      ALTER TABLE venues ADD COLUMN running_track INTEGER;
      ALTER TABLE venues ADD COLUMN covered_stands INTEGER;
      ALTER TABLE venues ADD COLUMN owner_entity TEXT;
      ALTER TABLE venues ADD COLUMN operator_entity TEXT;
      ALTER TABLE venues ADD COLUMN status TEXT NOT NULL DEFAULT 'UNKNOWN';

      CREATE TABLE IF NOT EXISTS venue_relationships_v7 (
        id TEXT PRIMARY KEY,
        venue_id TEXT NOT NULL REFERENCES venues(id),
        club_id TEXT REFERENCES clubs(id),
        team_id TEXT REFERENCES teams(id),
        federation_id TEXT REFERENCES federations(id),
        academy_id TEXT REFERENCES academies(id),
        relationship_type TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        competition_season_id TEXT REFERENCES competition_seasons(id),
        status TEXT NOT NULL DEFAULT 'unknown',
        CHECK (
          club_id IS NOT NULL OR team_id IS NOT NULL OR federation_id IS NOT NULL OR academy_id IS NOT NULL
        )
      );

      INSERT INTO venue_relationships_v7
        (id, venue_id, club_id, team_id, relationship_type, status)
        SELECT id, venue_id, club_id, team_id, relationship_type, 'unknown'
        FROM venue_relationships;

      DROP TABLE venue_relationships;
      ALTER TABLE venue_relationships_v7 RENAME TO venue_relationships;

      CREATE TABLE IF NOT EXISTS location_travel_contexts (
        id TEXT PRIMARY KEY,
        from_location_id TEXT NOT NULL REFERENCES locations(id),
        to_location_id TEXT NOT NULL REFERENCES locations(id),
        road_distance_km REAL,
        estimated_road_travel_hours REAL,
        air_travel_available INTEGER,
        nearest_airport_id TEXT REFERENCES locations(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_canonical_external_id
        ON locations(canonical_external_id)
        WHERE canonical_external_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_canonical_external_id
        ON venues(canonical_external_id)
        WHERE canonical_external_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_venue_relationships_venue
        ON venue_relationships(venue_id);
      CREATE INDEX IF NOT EXISTS idx_location_travel_contexts_pair
        ON location_travel_contexts(from_location_id, to_location_id);
    `,
  },
];

export const migrateDatabase = (db: GameDatabase): number => {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
  );
  const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{
    version: number;
  }>;
  const applied = new Set(rows.map((row) => row.version));
  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      db.exec("BEGIN;");
      try {
        db.exec(migration.sql);
        db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
          migration.version,
          new Date().toISOString(),
        );
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
    }
  }
  return CURRENT_DATABASE_VERSION;
};
