import type { GameDatabase } from "./connection.js";

export const CURRENT_DATABASE_VERSION = 50;

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
  {
    version: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS staff_profiles (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        preferred_role TEXT,
        salary_expectation TEXT,
        reputation TEXT,
        country_knowledge_json TEXT NOT NULL DEFAULT '[]',
        club_knowledge_json TEXT NOT NULL DEFAULT '[]',
        availability TEXT,
        work_eligibility_status TEXT
      );

      CREATE TABLE IF NOT EXISTS staff_appointments (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        organisation_type TEXT NOT NULL,
        club_id TEXT REFERENCES clubs(id),
        team_id TEXT REFERENCES teams(id),
        federation_id TEXT REFERENCES federations(id),
        academy_id TEXT REFERENCES academies(id),
        organisation_name TEXT,
        role TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        employment_status TEXT NOT NULL,
        contract_id TEXT,
        service_rank_title TEXT,
        CHECK (
          club_id IS NOT NULL OR team_id IS NOT NULL OR federation_id IS NOT NULL OR
          academy_id IS NOT NULL OR organisation_name IS NOT NULL
        )
      );

      CREATE TABLE IF NOT EXISTS staff_vacancies (
        id TEXT PRIMARY KEY,
        organisation_type TEXT NOT NULL,
        club_id TEXT REFERENCES clubs(id),
        team_id TEXT REFERENCES teams(id),
        federation_id TEXT REFERENCES federations(id),
        academy_id TEXT REFERENCES academies(id),
        organisation_name TEXT,
        role TEXT NOT NULL,
        required INTEGER NOT NULL,
        assigned_person_id TEXT REFERENCES persons(id),
        status TEXT NOT NULL,
        CHECK (
          club_id IS NOT NULL OR team_id IS NOT NULL OR federation_id IS NOT NULL OR
          academy_id IS NOT NULL OR organisation_name IS NOT NULL
        )
      );

      CREATE TABLE IF NOT EXISTS staff_licences (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        licence_type TEXT NOT NULL,
        issuer TEXT NOT NULL,
        issue_date TEXT,
        expiry_date TEXT,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS referee_profiles (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        referee_level TEXT,
        fifa_listed INTEGER,
        fifa_listed_since TEXT,
        primary_role TEXT NOT NULL,
        competitions_eligible_json TEXT NOT NULL DEFAULT '[]',
        experience_level TEXT
      );

      CREATE TABLE IF NOT EXISTS staff_history_events (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        event_type TEXT NOT NULL,
        occurred_on TEXT NOT NULL,
        staff_appointment_id TEXT REFERENCES staff_appointments(id),
        club_id TEXT REFERENCES clubs(id),
        team_id TEXT REFERENCES teams(id),
        federation_id TEXT REFERENCES federations(id),
        academy_id TEXT REFERENCES academies(id),
        description TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_staff_appointments_person
        ON staff_appointments(person_id, employment_status);
      CREATE INDEX IF NOT EXISTS idx_staff_appointments_club
        ON staff_appointments(club_id, role);
      CREATE INDEX IF NOT EXISTS idx_staff_appointments_team
        ON staff_appointments(team_id, role);
      CREATE INDEX IF NOT EXISTS idx_staff_vacancies_org
        ON staff_vacancies(organisation_type, club_id, team_id, federation_id, academy_id);
      CREATE INDEX IF NOT EXISTS idx_staff_licences_person
        ON staff_licences(person_id);
      CREATE INDEX IF NOT EXISTS idx_referee_profiles_person
        ON referee_profiles(person_id);
      CREATE INDEX IF NOT EXISTS idx_staff_history_person
        ON staff_history_events(person_id, occurred_on);
    `,
  },
  {
    version: 9,
    sql: `
      CREATE TABLE IF NOT EXISTS training_plans (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id),
        name TEXT NOT NULL,
        effective_from TEXT NOT NULL,
        effective_to TEXT,
        intensity TEXT NOT NULL,
        sessions_json TEXT NOT NULL,
        source TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS individual_development_plans (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        focus_type TEXT NOT NULL,
        target_position TEXT,
        target_role TEXT,
        target_attribute_group TEXT,
        intensity TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS player_development_states (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        development_phase TEXT NOT NULL,
        training_load REAL NOT NULL,
        fatigue REAL NOT NULL,
        match_sharpness REAL NOT NULL,
        fitness REAL NOT NULL,
        recovery REAL NOT NULL,
        development_momentum REAL NOT NULL,
        position_familiarity_json TEXT NOT NULL,
        role_familiarity_json TEXT NOT NULL,
        last_training_date TEXT,
        last_development_update TEXT,
        UNIQUE(player_id)
      );

      CREATE TABLE IF NOT EXISTS player_potentials (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        potential_ceiling REAL NOT NULL,
        development_rate REAL NOT NULL,
        volatility REAL NOT NULL,
        professionalism REAL NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS player_playing_time_snapshots (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        competition_season_id TEXT REFERENCES competition_seasons(id),
        minutes_last_30_days INTEGER NOT NULL,
        minutes_season INTEGER NOT NULL,
        starts_season INTEGER NOT NULL,
        sub_appearances INTEGER NOT NULL,
        updated_on TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS competition_development_multipliers (
        id TEXT PRIMARY KEY,
        competition_id TEXT NOT NULL REFERENCES competitions(id),
        multiplier REAL NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS staff_simulation_profiles (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        coaching_technical REAL NOT NULL,
        coaching_tactical REAL NOT NULL,
        coaching_physical REAL NOT NULL,
        coaching_mental REAL NOT NULL,
        goalkeeping REAL NOT NULL,
        youth_development REAL NOT NULL,
        man_management REAL NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS training_facility_profiles (
        id TEXT PRIMARY KEY,
        club_id TEXT REFERENCES clubs(id),
        academy_id TEXT REFERENCES academies(id),
        training_facility_quality REAL,
        youth_facility_quality REAL,
        medical_facility_quality REAL,
        status TEXT NOT NULL,
        CHECK (club_id IS NOT NULL OR academy_id IS NOT NULL)
      );

      CREATE TABLE IF NOT EXISTS training_history_events (
        id TEXT PRIMARY KEY,
        player_id TEXT REFERENCES persons(id),
        team_id TEXT REFERENCES teams(id),
        event_type TEXT NOT NULL,
        occurred_on TEXT NOT NULL,
        data_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_training_plans_team
        ON training_plans(team_id, effective_from, effective_to);
      CREATE INDEX IF NOT EXISTS idx_development_plans_player
        ON individual_development_plans(player_id, status);
      CREATE INDEX IF NOT EXISTS idx_playing_time_player
        ON player_playing_time_snapshots(player_id, updated_on);
      CREATE INDEX IF NOT EXISTS idx_training_history_player
        ON training_history_events(player_id, occurred_on);
    `,
  },
  {
    version: 10,
    sql: `
      CREATE TABLE IF NOT EXISTS player_factual_profiles (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        canonical_external_id TEXT NOT NULL UNIQUE,
        current_club_id TEXT REFERENCES clubs(id),
        factual_json TEXT NOT NULL,
        simulation_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        record_status TEXT NOT NULL,
        confidence_level TEXT NOT NULL,
        last_verified TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_player_factual_profiles_player
        ON player_factual_profiles(player_id);
      CREATE INDEX IF NOT EXISTS idx_player_factual_profiles_club
        ON player_factual_profiles(current_club_id);
    `,
  },
  {
    version: 11,
    sql: `
      CREATE TABLE IF NOT EXISTS competition_season_states (
        competition_season_id TEXT PRIMARY KEY REFERENCES competition_seasons(id),
        competition_id TEXT NOT NULL REFERENCES competitions(id),
        season_label TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL,
        current_round INTEGER NOT NULL DEFAULT 0,
        champion_club_id TEXT REFERENCES clubs(id),
        completed_at TEXT,
        rolled_over_at TEXT
      );

      CREATE TABLE IF NOT EXISTS player_career_stats (
        person_id TEXT NOT NULL REFERENCES persons(id),
        team_id TEXT NOT NULL REFERENCES teams(id),
        appearances INTEGER NOT NULL,
        starts INTEGER NOT NULL,
        minutes INTEGER NOT NULL,
        goals INTEGER NOT NULL,
        assists INTEGER NOT NULL,
        yellow_cards INTEGER NOT NULL,
        red_cards INTEGER NOT NULL,
        clean_sheets INTEGER NOT NULL,
        PRIMARY KEY (person_id, team_id)
      );

      CREATE TABLE IF NOT EXISTS season_awards (
        id TEXT PRIMARY KEY,
        competition_season_id TEXT NOT NULL REFERENCES competition_seasons(id),
        award_type TEXT NOT NULL,
        person_id TEXT REFERENCES persons(id),
        team_id TEXT REFERENCES teams(id),
        value REAL NOT NULL,
        decided_on TEXT NOT NULL,
        UNIQUE (competition_season_id, award_type)
      );
    `,
  },
  {
    version: 12,
    sql: `
      CREATE TABLE IF NOT EXISTS player_knowledge (
        id TEXT PRIMARY KEY,
        observer_type TEXT NOT NULL,
        observer_organisation_id TEXT NOT NULL,
        player_id TEXT NOT NULL REFERENCES persons(id),
        discovery_status TEXT NOT NULL,
        knowledge_level TEXT NOT NULL,
        confidence TEXT NOT NULL,
        source_type TEXT NOT NULL,
        identity_json TEXT NOT NULL,
        position_json TEXT NOT NULL,
        ability_json TEXT NOT NULL,
        potential_json TEXT NOT NULL,
        contract_json TEXT NOT NULL,
        personality_json TEXT NOT NULL,
        medical_json TEXT NOT NULL,
        career_json TEXT NOT NULL,
        observations INTEGER NOT NULL,
        last_observed_at TEXT,
        last_scouted_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(observer_type, observer_organisation_id, player_id)
      );

      CREATE INDEX IF NOT EXISTS idx_player_knowledge_observer
        ON player_knowledge(observer_type, observer_organisation_id);
      CREATE INDEX IF NOT EXISTS idx_player_knowledge_player
        ON player_knowledge(player_id);

      CREATE TABLE IF NOT EXISTS club_recruitment_profiles (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL UNIQUE REFERENCES clubs(id),
        domestic_knowledge REAL NOT NULL,
        regional_knowledge REAL NOT NULL,
        international_knowledge REAL NOT NULL,
        scouting_budget INTEGER NOT NULL,
        network_reach TEXT NOT NULL,
        preferred_markets_json TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scouting_staff_simulation_profiles (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL UNIQUE REFERENCES persons(id),
        player_judgement INTEGER NOT NULL,
        potential_judgement INTEGER NOT NULL,
        adaptability INTEGER NOT NULL,
        regional_knowledge INTEGER NOT NULL,
        assignment_speed INTEGER NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scouting_assignments (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        scout_person_id TEXT REFERENCES persons(id),
        assignment_type TEXT NOT NULL,
        target_player_id TEXT REFERENCES persons(id),
        target_club_id TEXT REFERENCES clubs(id),
        target_competition_id TEXT REFERENCES competitions(id),
        target_location_id TEXT REFERENCES locations(id),
        started_at TEXT NOT NULL,
        expected_completion_at TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scouting_assignments_club_status
        ON scouting_assignments(club_id, status);

      CREATE TABLE IF NOT EXISTS scout_reports (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        observer_club_id TEXT NOT NULL REFERENCES clubs(id),
        scout_id TEXT REFERENCES persons(id),
        estimated_ability_json TEXT NOT NULL,
        estimated_potential_band TEXT NOT NULL,
        strengths_json TEXT NOT NULL,
        weaknesses_json TEXT NOT NULL,
        position_assessment TEXT NOT NULL,
        role_assessment TEXT NOT NULL,
        personality_assessment TEXT NOT NULL,
        medical_assessment TEXT NOT NULL,
        recommendation TEXT NOT NULL,
        confidence TEXT NOT NULL,
        observations INTEGER NOT NULL,
        generated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scout_reports_club_player
        ON scout_reports(observer_club_id, player_id);

      CREATE TABLE IF NOT EXISTS club_shortlist (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        player_id TEXT NOT NULL REFERENCES persons(id),
        added_at TEXT NOT NULL,
        priority TEXT NOT NULL,
        notes TEXT,
        scouting_status TEXT NOT NULL,
        UNIQUE(club_id, player_id)
      );
    `,
  },
  {
    version: 13,
    sql: `
      CREATE TABLE IF NOT EXISTS player_contracts (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        club_id TEXT NOT NULL REFERENCES clubs(id),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        contract_type TEXT NOT NULL,
        salary INTEGER NOT NULL,
        appearance_fee INTEGER NOT NULL,
        goal_bonus INTEGER NOT NULL,
        clean_sheet_bonus INTEGER NOT NULL,
        signing_bonus INTEGER NOT NULL,
        loyalty_bonus INTEGER NOT NULL,
        currency TEXT NOT NULL,
        squad_role TEXT NOT NULL,
        release_clause INTEGER,
        status TEXT NOT NULL,
        provenance_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_player_contracts_player_status
        ON player_contracts(player_id, status);
      CREATE INDEX IF NOT EXISTS idx_player_contracts_club_status
        ON player_contracts(club_id, status);

      CREATE TABLE IF NOT EXISTS transfer_windows (
        id TEXT PRIMARY KEY,
        country_id TEXT NOT NULL REFERENCES countries(id),
        competition_id TEXT REFERENCES competitions(id),
        window_type TEXT NOT NULL,
        open_date TEXT NOT NULL,
        close_date TEXT NOT NULL,
        registration_deadline TEXT NOT NULL,
        status TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        rules_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS club_financial_profiles (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL UNIQUE REFERENCES clubs(id),
        wage_budget INTEGER NOT NULL,
        transfer_budget INTEGER NOT NULL,
        current_wage_spend INTEGER NOT NULL,
        financial_health TEXT NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS club_employment_profiles (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL UNIQUE REFERENCES clubs(id),
        employment_model TEXT NOT NULL,
        contract_profile TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS player_transfer_statuses (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        club_id TEXT REFERENCES clubs(id),
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        set_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(player_id)
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL UNIQUE REFERENCES persons(id),
        agency_name TEXT,
        reputation INTEGER NOT NULL,
        negotiation_style TEXT NOT NULL,
        aggressiveness INTEGER NOT NULL,
        loyalty_preference INTEGER NOT NULL,
        fee_expectation INTEGER NOT NULL,
        career_ambition INTEGER NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_clients (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        player_id TEXT NOT NULL REFERENCES persons(id),
        started_at TEXT NOT NULL,
        status TEXT NOT NULL,
        UNIQUE(player_id, status)
      );

      CREATE TABLE IF NOT EXISTS transfer_offers (
        id TEXT PRIMARY KEY,
        buying_club_id TEXT NOT NULL REFERENCES clubs(id),
        selling_club_id TEXT REFERENCES clubs(id),
        player_id TEXT NOT NULL REFERENCES persons(id),
        offer_type TEXT NOT NULL,
        transfer_fee INTEGER NOT NULL,
        installments INTEGER NOT NULL,
        addons INTEGER NOT NULL,
        sell_on_percentage REAL NOT NULL,
        submitted_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL,
        currency TEXT NOT NULL,
        asking_range_json TEXT,
        agent_fee INTEGER NOT NULL,
        signing_fee INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transfer_offers_player
        ON transfer_offers(player_id, status);

      CREATE TABLE IF NOT EXISTS negotiation_rounds (
        id TEXT PRIMARY KEY,
        offer_id TEXT NOT NULL REFERENCES transfer_offers(id),
        round_number INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        salary INTEGER,
        squad_role TEXT,
        contract_length_months INTEGER,
        agent_fee INTEGER,
        signing_fee INTEGER,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS player_loans (
        id TEXT PRIMARY KEY,
        parent_club_id TEXT NOT NULL REFERENCES clubs(id),
        loan_club_id TEXT NOT NULL REFERENCES clubs(id),
        player_id TEXT NOT NULL REFERENCES persons(id),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        wage_contribution_percent REAL NOT NULL,
        loan_fee INTEGER,
        playing_time_expectation TEXT NOT NULL,
        recall_allowed INTEGER NOT NULL,
        purchase_option INTEGER,
        status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_player_loans_player_status
        ON player_loans(player_id, status);

      CREATE TABLE IF NOT EXISTS competition_registrations (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        club_id TEXT NOT NULL REFERENCES clubs(id),
        competition_season_id TEXT NOT NULL REFERENCES competition_seasons(id),
        registration_type TEXT NOT NULL,
        registered_from TEXT NOT NULL,
        registered_until TEXT,
        status TEXT NOT NULL,
        UNIQUE(player_id, competition_season_id, registration_type)
      );

      CREATE INDEX IF NOT EXISTS idx_competition_registrations_club
        ON competition_registrations(club_id, competition_season_id, status);

      CREATE TABLE IF NOT EXISTS transfer_history_events (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        club_id TEXT REFERENCES clubs(id),
        related_club_id TEXT REFERENCES clubs(id),
        event_type TEXT NOT NULL,
        occurred_on TEXT NOT NULL,
        data_json TEXT
      );

      CREATE TABLE IF NOT EXISTS squad_need_reports (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        generated_at TEXT NOT NULL,
        needs_json TEXT NOT NULL,
        expected_departures INTEGER NOT NULL,
        UNIQUE(club_id, generated_at)
      );
    `,
  },
  {
    version: 14,
    sql: `
      CREATE TABLE IF NOT EXISTS country_development_profiles (
        id TEXT PRIMARY KEY,
        country_id TEXT NOT NULL REFERENCES countries(id),
        effective_from TEXT NOT NULL,
        football_popularity REAL NOT NULL,
        grassroots_reach REAL NOT NULL,
        coaching_quality REAL NOT NULL,
        youth_infrastructure REAL NOT NULL,
        talent_conversion REAL NOT NULL,
        status TEXT NOT NULL,
        notes TEXT,
        UNIQUE(country_id, effective_from)
      );

      CREATE TABLE IF NOT EXISTS academy_simulation_profiles (
        id TEXT PRIMARY KEY,
        academy_id TEXT REFERENCES academies(id),
        club_id TEXT REFERENCES clubs(id),
        country_id TEXT NOT NULL REFERENCES countries(id),
        youth_recruitment_quality REAL NOT NULL,
        academy_coaching_quality REAL NOT NULL,
        academy_facilities_quality REAL NOT NULL,
        regional_reach REAL NOT NULL,
        talent_identification_quality REAL NOT NULL,
        status TEXT NOT NULL,
        CHECK (academy_id IS NOT NULL OR club_id IS NOT NULL)
      );

      CREATE TABLE IF NOT EXISTS youth_intake_events (
        id TEXT PRIMARY KEY,
        country_id TEXT NOT NULL REFERENCES countries(id),
        club_id TEXT REFERENCES clubs(id),
        academy_id TEXT REFERENCES academies(id),
        intake_date TEXT NOT NULL,
        season_label TEXT NOT NULL,
        intake_type TEXT NOT NULL,
        players_generated INTEGER NOT NULL,
        average_current_ability REAL NOT NULL,
        average_potential REAL NOT NULL,
        highest_potential REAL NOT NULL,
        status TEXT NOT NULL,
        seed_key TEXT NOT NULL,
        data_json TEXT
      );

      CREATE TABLE IF NOT EXISTS generated_player_origins (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL UNIQUE REFERENCES persons(id),
        origin_type TEXT NOT NULL,
        origin_data_type TEXT NOT NULL,
        country_id TEXT NOT NULL REFERENCES countries(id),
        club_id TEXT REFERENCES clubs(id),
        academy_id TEXT REFERENCES academies(id),
        location_id TEXT REFERENCES locations(id),
        district_location_id TEXT REFERENCES locations(id),
        intake_event_id TEXT REFERENCES youth_intake_events(id),
        generated_on TEXT NOT NULL,
        name_generation_key TEXT NOT NULL,
        archetype TEXT NOT NULL,
        youth_status TEXT NOT NULL,
        eligibility_json TEXT NOT NULL,
        source_notes TEXT
      );

      CREATE TABLE IF NOT EXISTS youth_player_statuses (
        player_id TEXT PRIMARY KEY REFERENCES persons(id),
        youth_status TEXT NOT NULL,
        club_id TEXT REFERENCES clubs(id),
        academy_id TEXT REFERENCES academies(id),
        status_since TEXT NOT NULL,
        pathway_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS youth_development_activity (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        club_id TEXT REFERENCES clubs(id),
        academy_id TEXT REFERENCES academies(id),
        activity_date TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        development_minutes INTEGER NOT NULL,
        exposure_level REAL NOT NULL,
        data_json TEXT
      );

      CREATE TABLE IF NOT EXISTS player_retirement_states (
        player_id TEXT PRIMARY KEY REFERENCES persons(id),
        state TEXT NOT NULL,
        decided_on TEXT NOT NULL,
        announced_on TEXT,
        retirement_date TEXT,
        reason TEXT,
        staff_interest REAL NOT NULL,
        data_json TEXT
      );

      CREATE TABLE IF NOT EXISTS retired_staff_transitions (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        staff_role TEXT NOT NULL,
        club_id TEXT REFERENCES clubs(id),
        academy_id TEXT REFERENCES academies(id),
        federation_id TEXT REFERENCES federations(id),
        transitioned_on TEXT NOT NULL,
        status TEXT NOT NULL,
        data_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_generated_player_origins_club
        ON generated_player_origins(club_id, generated_on);
      CREATE INDEX IF NOT EXISTS idx_generated_player_origins_academy
        ON generated_player_origins(academy_id, generated_on);
      CREATE INDEX IF NOT EXISTS idx_youth_intake_events_date
        ON youth_intake_events(intake_date, club_id, academy_id);
      CREATE INDEX IF NOT EXISTS idx_youth_status_club
        ON youth_player_statuses(club_id, youth_status);
      CREATE INDEX IF NOT EXISTS idx_retirement_state
        ON player_retirement_states(state, retirement_date);
    `,
  },
  {
    version: 15,
    sql: `
      CREATE TABLE IF NOT EXISTS club_financial_accounts (
        club_id TEXT PRIMARY KEY REFERENCES clubs(id),
        currency TEXT NOT NULL,
        cash_balance INTEGER NOT NULL,
        restricted_cash INTEGER NOT NULL,
        receivables INTEGER NOT NULL,
        payables INTEGER NOT NULL,
        debt_balance INTEGER NOT NULL,
        equity_balance INTEGER NOT NULL,
        season_revenue INTEGER NOT NULL,
        season_expenses INTEGER NOT NULL,
        season_profit_loss INTEGER NOT NULL,
        financial_health TEXT NOT NULL,
        last_updated_at TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS club_ledger_entries (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        entry_date TEXT NOT NULL,
        category TEXT NOT NULL,
        direction TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        description TEXT NOT NULL,
        related_entity_id TEXT,
        status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_club_ledger_club_date
        ON club_ledger_entries(club_id, entry_date);

      CREATE TABLE IF NOT EXISTS club_budgets (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        season_label TEXT NOT NULL,
        category TEXT NOT NULL,
        amount INTEGER NOT NULL,
        used_amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        provenance_status TEXT NOT NULL,
        UNIQUE(club_id, season_label, category)
      );

      CREATE TABLE IF NOT EXISTS club_ownership_stakes (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        holder_type TEXT NOT NULL,
        holder_id TEXT,
        holder_name TEXT NOT NULL,
        role TEXT NOT NULL,
        percentage REAL,
        voting_percentage REAL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        status TEXT NOT NULL,
        ownership_model TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS personal_financial_profiles (
        person_id TEXT PRIMARY KEY REFERENCES persons(id),
        cash INTEGER NOT NULL,
        investments INTEGER NOT NULL,
        assets INTEGER NOT NULL,
        liabilities INTEGER NOT NULL,
        net_worth INTEGER NOT NULL,
        currency TEXT NOT NULL,
        last_updated_at TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS owner_investment_transactions (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        club_id TEXT NOT NULL REFERENCES clubs(id),
        transaction_date TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        form TEXT NOT NULL,
        personal_ledger_entry_id TEXT NOT NULL,
        club_ledger_entry_id TEXT NOT NULL REFERENCES club_ledger_entries(id),
        status TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS club_debts (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        lender_type TEXT NOT NULL,
        principal INTEGER NOT NULL,
        outstanding_principal INTEGER NOT NULL,
        interest_rate REAL NOT NULL,
        currency TEXT NOT NULL,
        start_date TEXT NOT NULL,
        maturity_date TEXT NOT NULL,
        repayment_schedule TEXT NOT NULL,
        status TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sponsor_organisations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        industry TEXT NOT NULL,
        country_id TEXT REFERENCES countries(id),
        reputation REAL NOT NULL,
        budget_tier TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sponsorship_contracts (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        sponsor_id TEXT NOT NULL REFERENCES sponsor_organisations(id),
        sponsorship_type TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        annual_value INTEGER NOT NULL,
        bonuses_json TEXT NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sponsorship_club_status
        ON sponsorship_contracts(club_id, status);

      CREATE TABLE IF NOT EXISTS club_supporter_profiles (
        club_id TEXT PRIMARY KEY REFERENCES clubs(id),
        core_supporters INTEGER NOT NULL,
        casual_supporters INTEGER NOT NULL,
        regional_support INTEGER NOT NULL,
        diaspora_support INTEGER NOT NULL,
        active_support INTEGER NOT NULL,
        family_support INTEGER NOT NULL,
        youth_support INTEGER NOT NULL,
        club_popularity REAL NOT NULL,
        football_reputation REAL NOT NULL,
        commercial_reputation REAL NOT NULL,
        sentiment TEXT NOT NULL,
        standard_ticket_price INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS club_facility_profiles (
        club_id TEXT PRIMARY KEY REFERENCES clubs(id),
        training_facility_quality REAL NOT NULL,
        youth_facility_quality REAL NOT NULL,
        medical_facility_quality REAL NOT NULL,
        analytics_facility_quality REAL NOT NULL,
        academy_capacity INTEGER NOT NULL,
        monthly_operating_cost INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS infrastructure_projects (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        project_type TEXT NOT NULL,
        location_id TEXT REFERENCES locations(id),
        venue_id TEXT REFERENCES venues(id),
        planning_start TEXT NOT NULL,
        construction_start TEXT,
        expected_completion TEXT NOT NULL,
        completed_at TEXT,
        capital_cost INTEGER NOT NULL,
        ongoing_cost INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        financing_json TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_infrastructure_projects_club_status
        ON infrastructure_projects(club_id, status);

      CREATE TABLE IF NOT EXISTS club_assets (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        asset_type TEXT NOT NULL,
        ownership TEXT NOT NULL,
        location_id TEXT REFERENCES locations(id),
        venue_id TEXT REFERENCES venues(id),
        estimated_value INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS club_valuations (
        club_id TEXT PRIMARY KEY REFERENCES clubs(id),
        valuation INTEGER NOT NULL,
        currency TEXT NOT NULL,
        calculated_at TEXT NOT NULL,
        method TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS club_board_policies (
        club_id TEXT PRIMARY KEY REFERENCES clubs(id),
        financial_risk_tolerance TEXT NOT NULL,
        transfer_philosophy TEXT NOT NULL,
        youth_priority REAL NOT NULL,
        commercial_priority REAL NOT NULL,
        infrastructure_priority REAL NOT NULL,
        strategic_objective TEXT NOT NULL,
        chairman_person_id TEXT REFERENCES persons(id),
        updated_at TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS club_financial_statements (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        season_label TEXT NOT NULL,
        opening_cash INTEGER NOT NULL,
        revenue_by_category_json TEXT NOT NULL,
        expenses_by_category_json TEXT NOT NULL,
        operating_profit INTEGER NOT NULL,
        transfer_profit_loss INTEGER NOT NULL,
        net_profit_loss INTEGER NOT NULL,
        closing_cash INTEGER NOT NULL,
        debt INTEGER NOT NULL,
        currency TEXT NOT NULL,
        closed_at TEXT NOT NULL,
        status TEXT NOT NULL,
        UNIQUE(club_id, season_label)
      );
    `,
  },
  {
    version: 16,
    sql: `
      CREATE TABLE IF NOT EXISTS federation_simulation_profiles (
        federation_id TEXT PRIMARY KEY REFERENCES federations(id),
        country_id TEXT NOT NULL REFERENCES countries(id),
        reputation REAL NOT NULL,
        financial_health TEXT NOT NULL,
        grassroots_development REAL NOT NULL,
        youth_development REAL NOT NULL,
        coach_education REAL NOT NULL,
        referee_development REAL NOT NULL,
        competition_organisation REAL NOT NULL,
        commercial_strength REAL NOT NULL,
        international_relations REAL NOT NULL,
        governance_stability REAL NOT NULL,
        infrastructure_level REAL NOT NULL,
        last_updated_at TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS federation_financial_accounts (
        federation_id TEXT PRIMARY KEY REFERENCES federations(id),
        currency TEXT NOT NULL,
        cash_balance INTEGER NOT NULL,
        restricted_funds INTEGER NOT NULL,
        receivables INTEGER NOT NULL,
        payables INTEGER NOT NULL,
        debt INTEGER NOT NULL,
        season_revenue INTEGER NOT NULL,
        season_expenses INTEGER NOT NULL,
        season_profit_loss INTEGER NOT NULL,
        financial_health TEXT NOT NULL,
        last_updated_at TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS federation_ledger_entries (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        entry_date TEXT NOT NULL,
        category TEXT NOT NULL,
        direction TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        description TEXT NOT NULL,
        related_entity_id TEXT,
        restriction_tag TEXT,
        status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_federation_ledger_federation_date
        ON federation_ledger_entries(federation_id, entry_date);

      CREATE TABLE IF NOT EXISTS federation_budgets (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        season_label TEXT NOT NULL,
        category TEXT NOT NULL,
        amount INTEGER NOT NULL,
        used_amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        provenance_status TEXT NOT NULL,
        UNIQUE(federation_id, season_label, category)
      );

      CREATE TABLE IF NOT EXISTS federation_leadership_tenures (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        federation_id TEXT NOT NULL REFERENCES federations(id),
        role TEXT NOT NULL,
        term_start TEXT NOT NULL,
        term_end TEXT,
        status TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_federation_leadership_active
        ON federation_leadership_tenures(federation_id, role, status);

      CREATE TABLE IF NOT EXISTS federation_committees (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        committee_type TEXT NOT NULL,
        name TEXT NOT NULL,
        chair_person_id TEXT REFERENCES persons(id),
        status TEXT NOT NULL,
        provenance_status TEXT NOT NULL,
        UNIQUE(federation_id, committee_type)
      );

      CREATE TABLE IF NOT EXISTS federation_strategy_priorities (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        priority TEXT NOT NULL,
        weight REAL NOT NULL,
        effective_from TEXT NOT NULL,
        effective_to TEXT,
        status TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS federation_projects (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        project_type TEXT NOT NULL,
        name TEXT NOT NULL,
        location_id TEXT REFERENCES locations(id),
        target_province_id TEXT REFERENCES locations(id),
        target_district_id TEXT REFERENCES locations(id),
        academy_id TEXT REFERENCES academies(id),
        start_date TEXT NOT NULL,
        expected_completion TEXT NOT NULL,
        completed_at TEXT,
        capital_cost INTEGER NOT NULL,
        annual_operating_cost INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        impact_json TEXT NOT NULL,
        funding_json TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_federation_projects_federation_status
        ON federation_projects(federation_id, status);

      CREATE TABLE IF NOT EXISTS federation_assets (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        asset_type TEXT NOT NULL,
        ownership TEXT NOT NULL,
        location_id TEXT REFERENCES locations(id),
        academy_id TEXT REFERENCES academies(id),
        estimated_value INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS competition_reform_proposals (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        competition_id TEXT NOT NULL REFERENCES competitions(id),
        effective_season TEXT NOT NULL,
        changes_json TEXT NOT NULL,
        status TEXT NOT NULL,
        proposed_at TEXT NOT NULL,
        decided_at TEXT,
        provenance_status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS club_licensing_assessments (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        club_id TEXT NOT NULL REFERENCES clubs(id),
        season_label TEXT NOT NULL,
        financial TEXT NOT NULL,
        stadium TEXT NOT NULL,
        youth TEXT NOT NULL,
        medical TEXT NOT NULL,
        administrative TEXT NOT NULL,
        coaching TEXT NOT NULL,
        legal TEXT NOT NULL,
        overall TEXT NOT NULL,
        assessed_at TEXT NOT NULL,
        status TEXT NOT NULL,
        UNIQUE(federation_id, club_id, season_label)
      );

      CREATE TABLE IF NOT EXISTS federation_grant_distributions (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        club_id TEXT NOT NULL REFERENCES clubs(id),
        grant_date TEXT NOT NULL,
        grant_type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        federation_ledger_entry_id TEXT NOT NULL REFERENCES federation_ledger_entries(id),
        club_ledger_entry_id TEXT NOT NULL REFERENCES club_ledger_entries(id),
        status TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS national_team_callups (
        id TEXT PRIMARY KEY,
        national_team_id TEXT NOT NULL REFERENCES teams(id),
        player_id TEXT NOT NULL REFERENCES persons(id),
        callup_date TEXT NOT NULL,
        programme TEXT NOT NULL,
        squad_type TEXT NOT NULL,
        status TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_national_callups_team_date
        ON national_team_callups(national_team_id, callup_date);

      CREATE TABLE IF NOT EXISTS national_team_appearances (
        id TEXT PRIMARY KEY,
        national_team_id TEXT NOT NULL REFERENCES teams(id),
        player_id TEXT NOT NULL REFERENCES persons(id),
        match_date TEXT NOT NULL,
        opponent_name TEXT NOT NULL,
        minutes INTEGER NOT NULL,
        goals INTEGER NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS national_team_fixtures (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        national_team_id TEXT NOT NULL REFERENCES teams(id),
        opponent_name TEXT NOT NULL,
        fixture_date TEXT NOT NULL,
        fixture_type TEXT NOT NULL,
        venue_id TEXT REFERENCES venues(id),
        status TEXT NOT NULL,
        home_goals INTEGER,
        away_goals INTEGER,
        estimated_cost INTEGER NOT NULL,
        estimated_revenue INTEGER NOT NULL,
        currency TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS player_international_eligibilities (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        federation_id TEXT NOT NULL REFERENCES federations(id),
        eligibility_status TEXT NOT NULL,
        documentation_status TEXT NOT NULL,
        discovered_via TEXT NOT NULL,
        last_reviewed_at TEXT NOT NULL,
        provenance_status TEXT NOT NULL,
        UNIQUE(player_id, federation_id)
      );

      CREATE TABLE IF NOT EXISTS coach_education_programmes (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        licence_level TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        capacity INTEGER NOT NULL,
        cost INTEGER NOT NULL,
        graduates INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS referee_development_programmes (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        programme_type TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        capacity INTEGER NOT NULL,
        cost INTEGER NOT NULL,
        referees_advanced INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS organisation_relationships (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        organisation_name TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        support_level REAL NOT NULL,
        trust REAL NOT NULL,
        funding_relationship REAL NOT NULL,
        updated_at TEXT NOT NULL,
        status TEXT NOT NULL,
        UNIQUE(federation_id, organisation_name)
      );

      CREATE TABLE IF NOT EXISTS federation_sponsorship_contracts (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        sponsor_id TEXT NOT NULL REFERENCES sponsor_organisations(id),
        sponsorship_type TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        annual_value INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS federation_objectives (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        objective TEXT NOT NULL,
        cycle_start TEXT NOT NULL,
        cycle_end TEXT NOT NULL,
        progress REAL NOT NULL,
        status TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS federation_kpis (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        season_label TEXT NOT NULL,
        metric TEXT NOT NULL,
        metric_value REAL NOT NULL,
        measured_at TEXT NOT NULL,
        status TEXT NOT NULL,
        UNIQUE(federation_id, season_label, metric)
      );

      CREATE TABLE IF NOT EXISTS federation_financial_statements (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        season_label TEXT NOT NULL,
        opening_cash INTEGER NOT NULL,
        revenue_by_category_json TEXT NOT NULL,
        expenses_by_category_json TEXT NOT NULL,
        programme_spending INTEGER NOT NULL,
        national_team_spending INTEGER NOT NULL,
        competition_spending INTEGER NOT NULL,
        infrastructure_spending INTEGER NOT NULL,
        net_profit_loss INTEGER NOT NULL,
        closing_cash INTEGER NOT NULL,
        debt INTEGER NOT NULL,
        currency TEXT NOT NULL,
        closed_at TEXT NOT NULL,
        status TEXT NOT NULL,
        UNIQUE(federation_id, season_label)
      );
    `,
  },
  {
    version: 17,
    sql: `
      CREATE TABLE IF NOT EXISTS international_team_profiles (
        id TEXT PRIMARY KEY,
        country_id TEXT NOT NULL REFERENCES countries(id),
        national_team_id TEXT REFERENCES teams(id),
        name TEXT NOT NULL,
        team_type TEXT NOT NULL,
        confederation TEXT NOT NULL,
        region TEXT NOT NULL,
        simulation_reputation REAL NOT NULL,
        simulation_strength REAL NOT NULL,
        home_advantage_profile REAL NOT NULL,
        development_level REAL NOT NULL,
        form_rating REAL NOT NULL,
        last_updated TEXT NOT NULL,
        provenance_status TEXT NOT NULL,
        UNIQUE(country_id, team_type)
      );

      CREATE TABLE IF NOT EXISTS international_development_profiles (
        id TEXT PRIMARY KEY,
        country_id TEXT NOT NULL REFERENCES countries(id),
        effective_from TEXT NOT NULL,
        football_development REAL NOT NULL,
        youth_pipeline REAL NOT NULL,
        coach_quality REAL NOT NULL,
        infrastructure REAL NOT NULL,
        domestic_professionalism REAL NOT NULL,
        population_talent_base REAL NOT NULL,
        provenance_status TEXT NOT NULL,
        UNIQUE(country_id, effective_from)
      );

      CREATE TABLE IF NOT EXISTS international_competitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        competition_type TEXT NOT NULL,
        confederation TEXT,
        region TEXT,
        cadence_years INTEGER NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS international_competition_editions (
        id TEXT PRIMARY KEY,
        competition_id TEXT NOT NULL REFERENCES international_competitions(id),
        name TEXT NOT NULL,
        cycle TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL,
        host_country_ids_json TEXT NOT NULL,
        qualification_links_json TEXT NOT NULL,
        rule_provenance_status TEXT NOT NULL,
        rule_notes TEXT
      );

      CREATE TABLE IF NOT EXISTS international_competition_stages (
        id TEXT PRIMARY KEY,
        edition_id TEXT NOT NULL REFERENCES international_competition_editions(id),
        name TEXT NOT NULL,
        stage_order INTEGER NOT NULL,
        format_type TEXT NOT NULL,
        group_count INTEGER NOT NULL,
        group_size INTEGER NOT NULL,
        legs INTEGER NOT NULL,
        teams_to_advance INTEGER NOT NULL,
        matchday_squad_size INTEGER NOT NULL,
        preliminary_squad_size INTEGER NOT NULL,
        final_squad_size INTEGER NOT NULL,
        tiebreakers_json TEXT NOT NULL,
        allow_extra_time INTEGER NOT NULL,
        allow_penalties INTEGER NOT NULL,
        away_goals INTEGER NOT NULL,
        provenance_status TEXT NOT NULL,
        UNIQUE(edition_id, stage_order)
      );

      CREATE TABLE IF NOT EXISTS international_competition_participants (
        id TEXT PRIMARY KEY,
        edition_id TEXT NOT NULL REFERENCES international_competition_editions(id),
        team_profile_id TEXT NOT NULL REFERENCES international_team_profiles(id),
        entry_status TEXT NOT NULL,
        seed_rating REAL NOT NULL,
        pot INTEGER,
        group_name TEXT,
        final_placement INTEGER,
        qualification_source TEXT,
        provenance_status TEXT NOT NULL,
        UNIQUE(edition_id, team_profile_id)
      );

      CREATE TABLE IF NOT EXISTS international_draw_records (
        id TEXT PRIMARY KEY,
        edition_id TEXT NOT NULL REFERENCES international_competition_editions(id),
        stage_id TEXT NOT NULL REFERENCES international_competition_stages(id),
        draw_date TEXT NOT NULL,
        seed_key TEXT NOT NULL,
        pots_json TEXT NOT NULL,
        groups_json TEXT NOT NULL,
        restrictions_json TEXT NOT NULL,
        provenance_status TEXT NOT NULL,
        UNIQUE(edition_id, stage_id)
      );

      CREATE TABLE IF NOT EXISTS international_matches (
        id TEXT PRIMARY KEY,
        edition_id TEXT REFERENCES international_competition_editions(id),
        stage_id TEXT REFERENCES international_competition_stages(id),
        group_name TEXT,
        match_date TEXT NOT NULL,
        home_team_profile_id TEXT NOT NULL REFERENCES international_team_profiles(id),
        away_team_profile_id TEXT NOT NULL REFERENCES international_team_profiles(id),
        neutral_venue INTEGER NOT NULL,
        venue_id TEXT REFERENCES venues(id),
        status TEXT NOT NULL,
        home_goals INTEGER,
        away_goals INTEGER,
        extra_time_played INTEGER NOT NULL,
        penalties_played INTEGER NOT NULL,
        home_penalty_goals INTEGER,
        away_penalty_goals INTEGER,
        winner_team_profile_id TEXT REFERENCES international_team_profiles(id),
        importance TEXT NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_international_matches_date
        ON international_matches(match_date);

      CREATE INDEX IF NOT EXISTS idx_international_matches_edition
        ON international_matches(edition_id, stage_id);

      CREATE TABLE IF NOT EXISTS simulation_world_rankings (
        id TEXT PRIMARY KEY,
        team_profile_id TEXT NOT NULL REFERENCES international_team_profiles(id),
        ranking_date TEXT NOT NULL,
        rank INTEGER NOT NULL,
        points REAL NOT NULL,
        confederation_rank INTEGER NOT NULL,
        reputation REAL NOT NULL,
        provenance_status TEXT NOT NULL,
        UNIQUE(team_profile_id, ranking_date)
      );

      CREATE TABLE IF NOT EXISTS national_team_duties (
        id TEXT PRIMARY KEY,
        national_team_id TEXT NOT NULL REFERENCES teams(id),
        player_id TEXT NOT NULL REFERENCES persons(id),
        competition_edition_id TEXT REFERENCES international_competition_editions(id),
        departure_date TEXT NOT NULL,
        return_date TEXT NOT NULL,
        status TEXT NOT NULL,
        fitness_effect REAL NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_national_team_duties_player_window
        ON national_team_duties(player_id, departure_date, return_date);

      CREATE TABLE IF NOT EXISTS national_team_cohesion (
        id TEXT PRIMARY KEY,
        national_team_id TEXT NOT NULL REFERENCES teams(id),
        player_id TEXT NOT NULL REFERENCES persons(id),
        familiarity REAL NOT NULL,
        last_updated TEXT NOT NULL,
        provenance_status TEXT NOT NULL,
        UNIQUE(national_team_id, player_id)
      );

      CREATE TABLE IF NOT EXISTS national_team_camps (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        national_team_id TEXT NOT NULL REFERENCES teams(id),
        competition_edition_id TEXT REFERENCES international_competition_editions(id),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        focus TEXT NOT NULL,
        cost INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        cohesion_gain REAL NOT NULL,
        provenance_status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS international_retirements (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        national_team_id TEXT NOT NULL REFERENCES teams(id),
        status TEXT NOT NULL,
        decided_on TEXT NOT NULL,
        reason TEXT,
        provenance_status TEXT NOT NULL,
        UNIQUE(player_id, national_team_id)
      );
    `,
  },
  {
    version: 18,
    sql: `
      -- A match in progress. One row per fixture; the serialised engine state
      -- is what makes a match resumable after the app closes.
      CREATE TABLE IF NOT EXISTS match_sessions (
        id TEXT PRIMARY KEY,
        fixture_id TEXT NOT NULL REFERENCES fixtures(id),
        match_id TEXT NOT NULL,
        status TEXT NOT NULL,
        period TEXT NOT NULL,
        minute INTEGER NOT NULL,
        stoppage_time INTEGER NOT NULL DEFAULT 0,
        home_goals INTEGER NOT NULL DEFAULT 0,
        away_goals INTEGER NOT NULL DEFAULT 0,
        seed TEXT NOT NULL,
        rng_state INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        view_mode TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(fixture_id)
      );

      -- Per-match player line. Season aggregates stay in player_season_stats.
      CREATE TABLE IF NOT EXISTS player_match_ratings (
        match_id TEXT NOT NULL,
        player_id TEXT NOT NULL REFERENCES persons(id),
        team_id TEXT NOT NULL REFERENCES teams(id),
        position TEXT,
        role TEXT,
        started INTEGER NOT NULL,
        subbed_on_minute INTEGER,
        subbed_off_minute INTEGER,
        sent_off_minute INTEGER,
        minutes INTEGER NOT NULL,
        rating REAL NOT NULL,
        goals INTEGER NOT NULL,
        assists INTEGER NOT NULL,
        shots INTEGER NOT NULL,
        shots_on_target INTEGER NOT NULL,
        key_passes INTEGER NOT NULL,
        passes_attempted INTEGER NOT NULL,
        passes_completed INTEGER NOT NULL,
        tackles INTEGER NOT NULL,
        interceptions INTEGER NOT NULL,
        saves INTEGER NOT NULL,
        yellow_cards INTEGER NOT NULL,
        red_card INTEGER NOT NULL,
        PRIMARY KEY (match_id, player_id)
      );

      ALTER TABLE matches ADD COLUMN attendance INTEGER;
    `,
  },
  {
    version: 19,
    sql: `
      -- Knockout-tie outcome. NULL for every league match; only set when a
      -- competition rule required a winner (extra time / penalties / aggregate).
      ALTER TABLE matches ADD COLUMN winner_team_id TEXT REFERENCES teams(id);
      ALTER TABLE matches ADD COLUMN went_to_extra_time INTEGER;
      ALTER TABLE matches ADD COLUMN shootout_home_goals INTEGER;
      ALTER TABLE matches ADD COLUMN shootout_away_goals INTEGER;

      -- Two-leg tie pairing. Unused by any current fixture generator.
      ALTER TABLE fixtures ADD COLUMN tie_id TEXT;
      ALTER TABLE fixtures ADD COLUMN leg INTEGER;
    `,
  },
  {
    version: 20,
    sql: `
      -- Manager Career World: vacancies, applications and board trust.
      CREATE TABLE IF NOT EXISTS manager_job_vacancies (
        id TEXT PRIMARY KEY,
        club_id TEXT REFERENCES clubs(id),
        team_id TEXT NOT NULL REFERENCES teams(id),
        country_id TEXT REFERENCES countries(id),
        opened_on TEXT NOT NULL,
        reason TEXT NOT NULL,
        board_expectation TEXT NOT NULL,
        status TEXT NOT NULL,
        filled_on TEXT,
        filled_by_contract_id TEXT REFERENCES manager_contracts(id)
      );

      CREATE TABLE IF NOT EXISTS manager_job_applications (
        id TEXT PRIMARY KEY,
        vacancy_id TEXT NOT NULL REFERENCES manager_job_vacancies(id),
        manager_profile_id TEXT NOT NULL REFERENCES manager_profiles(id),
        person_id TEXT NOT NULL REFERENCES persons(id),
        status TEXT NOT NULL,
        created_on TEXT NOT NULL,
        decided_on TEXT,
        offered_salary_minor INTEGER,
        offered_contract_end TEXT
      );

      CREATE TABLE IF NOT EXISTS club_board_confidence (
        club_id TEXT PRIMARY KEY REFERENCES clubs(id),
        contract_id TEXT REFERENCES manager_contracts(id),
        confidence INTEGER NOT NULL,
        expectation TEXT NOT NULL,
        last_evaluated_on TEXT NOT NULL
      );
    `,
  },
  {
    version: 21,
    sql: `
      -- Deep Transfer Market Phase A: contextual valuation and exchange clauses.
      ALTER TABLE transfer_offers ADD COLUMN buyer_perceived_value_json TEXT;
      ALTER TABLE transfer_offers ADD COLUMN seller_internal_value_json TEXT;
      ALTER TABLE transfer_offers ADD COLUMN player_desire_to_move REAL;
      ALTER TABLE transfer_offers ADD COLUMN conditionals_json TEXT;
      ALTER TABLE transfer_offers ADD COLUMN player_exchanges_json TEXT;
      ALTER TABLE transfer_offers ADD COLUMN seller_requested_player_id TEXT REFERENCES persons(id);
    `,
  },
  {
    version: 22,
    sql: `
      -- Deep Transfer Market Phase B: earned representation and agent approaches.
      ALTER TABLE agents ADD COLUMN negotiation_skill INTEGER NOT NULL DEFAULT 8;
      ALTER TABLE agents ADD COLUMN network_scope TEXT NOT NULL DEFAULT 'NEPAL_DOMESTIC';
      ALTER TABLE agents ADD COLUMN preferred_markets_json TEXT NOT NULL DEFAULT '["NP"]';

      CREATE TABLE IF NOT EXISTS agent_approaches (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        player_id TEXT NOT NULL REFERENCES persons(id),
        approached_at TEXT NOT NULL,
        trigger TEXT NOT NULL,
        interest_score REAL NOT NULL,
        network_scope TEXT NOT NULL,
        decision TEXT NOT NULL,
        decided_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_agent_approaches_player
        ON agent_approaches(player_id, approached_at);
    `,
  },
  {
    version: 23,
    sql: `
      -- Manager Relationships & Squad Dynamics: Phase A foundation.
      CREATE TABLE IF NOT EXISTS manager_player_relationships (
        id TEXT PRIMARY KEY,
        manager_profile_id TEXT NOT NULL REFERENCES manager_profiles(id),
        person_id TEXT NOT NULL REFERENCES persons(id),
        score INTEGER NOT NULL,
        level TEXT NOT NULL,
        updated_on TEXT NOT NULL,
        UNIQUE(manager_profile_id, person_id)
      );

      CREATE TABLE IF NOT EXISTS player_club_satisfaction (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        team_id TEXT NOT NULL REFERENCES teams(id),
        score INTEGER NOT NULL,
        level TEXT NOT NULL,
        updated_on TEXT NOT NULL,
        UNIQUE(person_id, team_id)
      );

      CREATE TABLE IF NOT EXISTS squad_hierarchy (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id),
        person_id TEXT NOT NULL REFERENCES persons(id),
        influence INTEGER NOT NULL,
        role TEXT NOT NULL,
        updated_on TEXT NOT NULL,
        UNIQUE(team_id, person_id)
      );

      CREATE TABLE IF NOT EXISTS player_concerns (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        team_id TEXT NOT NULL REFERENCES teams(id),
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        severity INTEGER NOT NULL,
        raised_on TEXT NOT NULL,
        updated_on TEXT NOT NULL,
        resolved_on TEXT,
        note TEXT,
        UNIQUE(person_id, team_id, type)
      );

      CREATE TABLE IF NOT EXISTS relationship_history_events (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        team_id TEXT REFERENCES teams(id),
        manager_profile_id TEXT REFERENCES manager_profiles(id),
        event_type TEXT NOT NULL,
        occurred_on TEXT NOT NULL,
        data_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_relationship_history_person
        ON relationship_history_events(person_id, occurred_on);
    `,
  },
  {
    version: 24,
    sql: `
      -- Deep Transfer Market Phase D: persisted player transfer requests.
      CREATE TABLE IF NOT EXISTS player_transfer_requests (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES persons(id),
        club_id TEXT NOT NULL REFERENCES clubs(id),
        requested_at TEXT NOT NULL,
        reason TEXT NOT NULL,
        pressure_score REAL NOT NULL,
        status TEXT NOT NULL,
        asking_context_json TEXT,
        decided_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_player_transfer_requests_player
        ON player_transfer_requests(player_id, requested_at);
    `,
  },
  {
    version: 25,
    sql: `
      -- Manager Relationships & Squad Dynamics: Phase B conversations & promises.
      CREATE TABLE IF NOT EXISTS manager_concern_responses (
        id TEXT PRIMARY KEY,
        concern_id TEXT NOT NULL REFERENCES player_concerns(id),
        manager_profile_id TEXT NOT NULL REFERENCES manager_profiles(id),
        person_id TEXT NOT NULL REFERENCES persons(id),
        team_id TEXT NOT NULL REFERENCES teams(id),
        action TEXT NOT NULL,
        outcome TEXT NOT NULL,
        promise_id TEXT,
        occurred_on TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_manager_concern_responses_concern
        ON manager_concern_responses(concern_id, occurred_on);

      CREATE TABLE IF NOT EXISTS manager_promises (
        id TEXT PRIMARY KEY,
        manager_profile_id TEXT NOT NULL REFERENCES manager_profiles(id),
        person_id TEXT NOT NULL REFERENCES persons(id),
        team_id TEXT NOT NULL REFERENCES teams(id),
        concern_id TEXT REFERENCES player_concerns(id),
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        made_on TEXT NOT NULL,
        due_on TEXT NOT NULL,
        status TEXT NOT NULL,
        baseline_metric REAL,
        resolved_on TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_manager_promises_team_status
        ON manager_promises(team_id, status, due_on);
    `,
  },
  {
    version: 26,
    sql: `
      -- Manager Relationships & Squad Dynamics: Phase C dressing-room structure.
      CREATE TABLE IF NOT EXISTS squad_group_membership (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id),
        person_id TEXT NOT NULL REFERENCES persons(id),
        group_type TEXT NOT NULL,
        updated_on TEXT NOT NULL,
        UNIQUE(team_id, person_id)
      );

      CREATE TABLE IF NOT EXISTS team_cohesion (
        team_id TEXT PRIMARY KEY REFERENCES teams(id),
        score INTEGER NOT NULL,
        level TEXT NOT NULL,
        captain_influence TEXT NOT NULL,
        top_issue TEXT,
        updated_on TEXT NOT NULL
      );
    `,
  },
  {
    version: 27,
    sql: `
      -- Manager Relationships & Squad Dynamics: Phase D meetings and mediation.
      CREATE TABLE IF NOT EXISTS squad_disputes (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id),
        kind TEXT NOT NULL,
        person_id TEXT NOT NULL REFERENCES persons(id),
        with_person_id TEXT REFERENCES persons(id),
        concern_type TEXT NOT NULL,
        status TEXT NOT NULL,
        raised_on TEXT NOT NULL,
        resolved_on TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_squad_disputes_team_status
        ON squad_disputes(team_id, status);

      CREATE TABLE IF NOT EXISTS squad_meetings (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id),
        manager_profile_id TEXT NOT NULL REFERENCES manager_profiles(id),
        type TEXT NOT NULL,
        person_id TEXT REFERENCES persons(id),
        with_person_id TEXT REFERENCES persons(id),
        concern_id TEXT REFERENCES player_concerns(id),
        dispute_id TEXT REFERENCES squad_disputes(id),
        outcome TEXT NOT NULL,
        summary TEXT NOT NULL,
        occurred_on TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_squad_meetings_team
        ON squad_meetings(team_id, occurred_on);

      CREATE INDEX IF NOT EXISTS idx_squad_meetings_type_person
        ON squad_meetings(team_id, type, person_id, occurred_on);
    `,
  },
  {
    version: 28,
    sql: `
      CREATE TABLE IF NOT EXISTS club_commercial_profiles (
        club_id TEXT PRIMARY KEY REFERENCES clubs(id),
        brand_strength REAL NOT NULL,
        digital_reach REAL NOT NULL,
        broadcast_appeal REAL NOT NULL,
        merchandise_appeal REAL NOT NULL,
        ticket_price_elasticity REAL NOT NULL,
        updated_on TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS competition_media_rights (
        id TEXT PRIMARY KEY,
        competition_season_id TEXT NOT NULL REFERENCES competition_seasons(id),
        rights_partner TEXT NOT NULL,
        annual_value INTEGER NOT NULL,
        streaming_share REAL NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        UNIQUE(competition_season_id)
      );
    `,
  },
  {
    version: 29,
    sql: `
      ALTER TABLE sponsorship_contracts ADD COLUMN exclusivity_group TEXT;
      ALTER TABLE sponsorship_contracts ADD COLUMN expectations_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE competition_media_rights ADD COLUMN rights_type TEXT NOT NULL DEFAULT 'DOMESTIC_AND_STREAMING';
      ALTER TABLE competition_media_rights ADD COLUMN start_date TEXT;
      ALTER TABLE competition_media_rights ADD COLUMN end_date TEXT;
      ALTER TABLE competition_media_rights ADD COLUMN contract_status TEXT NOT NULL DEFAULT 'ACTIVE';
      ALTER TABLE competition_media_rights ADD COLUMN exclusive INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    version: 30,
    sql: `
      CREATE TABLE IF NOT EXISTS club_season_memberships (
        id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id), season_label TEXT NOT NULL,
        member_count INTEGER NOT NULL, price INTEGER NOT NULL, revenue INTEGER NOT NULL, status TEXT NOT NULL,
        UNIQUE(club_id, season_label)
      );
      CREATE TABLE IF NOT EXISTS commercial_history_events (
        id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id), event_date TEXT NOT NULL,
        event_type TEXT NOT NULL, amount INTEGER NOT NULL, audience_impact REAL NOT NULL, description TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_commercial_history_club_date ON commercial_history_events(club_id, event_date);
      CREATE TABLE IF NOT EXISTS preseason_commercial_camps (
        id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id), destination TEXT NOT NULL,
        start_date TEXT NOT NULL, end_date TEXT NOT NULL, cost INTEGER NOT NULL, commercial_reach REAL NOT NULL,
        sporting_impact REAL NOT NULL, status TEXT NOT NULL
      );
    `,
  },
  {
    version: 31,
    sql: `
      ALTER TABLE infrastructure_projects ADD COLUMN site_rights TEXT NOT NULL DEFAULT 'OWNED';
      ALTER TABLE infrastructure_projects ADD COLUMN funding_status TEXT NOT NULL DEFAULT 'FUNDED';
      ALTER TABLE infrastructure_projects ADD COLUMN funding_committed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE infrastructure_projects ADD COLUMN delay_days INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE infrastructure_projects ADD COLUMN maintenance_status TEXT NOT NULL DEFAULT 'FUNDED';
    `,
  },
  {
    version: 32,
    sql: `
      ALTER TABLE infrastructure_projects ADD COLUMN components_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE infrastructure_projects ADD COLUMN utilisation_capacity INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE infrastructure_projects ADD COLUMN cancelled_on TEXT;
      ALTER TABLE infrastructure_projects ADD COLUMN sunk_cost INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE infrastructure_projects ADD COLUMN recovery_plan TEXT;
    `,
  },
  {
    version: 33,
    sql: `
      ALTER TABLE federation_projects ADD COLUMN ownership TEXT NOT NULL DEFAULT 'FEDERATION';
      ALTER TABLE federation_projects ADD COLUMN site_rights TEXT NOT NULL DEFAULT 'OWNED';
      ALTER TABLE federation_projects ADD COLUMN components_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE federation_projects ADD COLUMN utilisation_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE federation_projects ADD COLUMN maintenance_status TEXT NOT NULL DEFAULT 'FUNDED';
      ALTER TABLE federation_projects ADD COLUMN delay_days INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE federation_projects ADD COLUMN funding_status TEXT NOT NULL DEFAULT 'FUNDED';
    `,
  },
  {
    version: 34,
    sql: `
      -- Staff Market & Development: Phase A employment foundation.
      ALTER TABLE staff_vacancies ADD COLUMN opened_on TEXT;
      ALTER TABLE staff_vacancies ADD COLUMN reason TEXT;

      CREATE TABLE IF NOT EXISTS staff_applications (
        id TEXT PRIMARY KEY,
        vacancy_id TEXT NOT NULL REFERENCES staff_vacancies(id),
        person_id TEXT NOT NULL REFERENCES persons(id),
        status TEXT NOT NULL,
        created_on TEXT NOT NULL,
        decided_on TEXT,
        offered_salary_minor INTEGER,
        offered_contract_end TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_staff_applications_vacancy
        ON staff_applications(vacancy_id, status);
      CREATE INDEX IF NOT EXISTS idx_staff_applications_person
        ON staff_applications(person_id, status);

      CREATE TABLE IF NOT EXISTS staff_employment_contracts (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        appointment_id TEXT NOT NULL REFERENCES staff_appointments(id),
        club_id TEXT REFERENCES clubs(id),
        team_id TEXT REFERENCES teams(id),
        role TEXT NOT NULL,
        contract_start TEXT NOT NULL,
        contract_end TEXT,
        salary_amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_staff_employment_contracts_club
        ON staff_employment_contracts(club_id, status);
      CREATE INDEX IF NOT EXISTS idx_staff_employment_contracts_person
        ON staff_employment_contracts(person_id, status);
    `,
  },
  {
    version: 35,
    sql: `
      CREATE TABLE IF NOT EXISTS club_ai_decision_history (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        decision_date TEXT NOT NULL,
        season_label TEXT NOT NULL,
        objective TEXT NOT NULL,
        priorities_json TEXT NOT NULL,
        actions_json TEXT NOT NULL,
        context_json TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_club_ai_decision_history_club_date
        ON club_ai_decision_history(club_id, decision_date);
    `,
  },
  {
    version: 36,
    sql: `
      CREATE TABLE IF NOT EXISTS federation_ai_decision_history (
        id TEXT PRIMARY KEY,
        federation_id TEXT NOT NULL REFERENCES federations(id),
        decision_date TEXT NOT NULL,
        season_label TEXT NOT NULL,
        priorities_json TEXT NOT NULL,
        actions_json TEXT NOT NULL,
        context_json TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_federation_ai_decision_history_date
        ON federation_ai_decision_history(federation_id, decision_date);
    `,
  },
  {
    version: 37,
    sql: `
      CREATE TABLE IF NOT EXISTS external_football_region_profiles (
        id TEXT PRIMARY KEY,
        region TEXT NOT NULL,
        season_label TEXT NOT NULL,
        economic_strength REAL NOT NULL,
        football_reputation REAL NOT NULL,
        club_strength REAL NOT NULL,
        transfer_demand REAL NOT NULL,
        foreign_recruitment_appeal REAL NOT NULL,
        national_team_strength REAL NOT NULL,
        commercial_growth REAL NOT NULL,
        status TEXT NOT NULL,
        UNIQUE(region, season_label)
      );
      CREATE INDEX IF NOT EXISTS idx_external_football_region_profiles_season
        ON external_football_region_profiles(season_label, region);
    `,
  },
  {
    version: 38,
    sql: `
      -- Staff Market Phase B: negotiation, performance, licence pathway, poaching.
      ALTER TABLE staff_applications ADD COLUMN counter_salary_minor INTEGER;

      CREATE TABLE IF NOT EXISTS staff_renewal_offers (
        id TEXT PRIMARY KEY,
        appointment_id TEXT NOT NULL REFERENCES staff_appointments(id),
        person_id TEXT NOT NULL REFERENCES persons(id),
        club_id TEXT NOT NULL REFERENCES clubs(id),
        proposed_salary_minor INTEGER NOT NULL,
        proposed_contract_end TEXT NOT NULL,
        counter_salary_minor INTEGER,
        status TEXT NOT NULL,
        created_on TEXT NOT NULL,
        decided_on TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_staff_renewal_offers_appointment
        ON staff_renewal_offers(appointment_id, status);

      CREATE TABLE IF NOT EXISTS staff_performance_records (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        appointment_id TEXT NOT NULL REFERENCES staff_appointments(id),
        club_id TEXT NOT NULL REFERENCES clubs(id),
        period_end TEXT NOT NULL,
        score REAL NOT NULL,
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_staff_performance_records_person
        ON staff_performance_records(person_id, period_end);

      CREATE TABLE IF NOT EXISTS staff_licence_courses (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        funded_by_club_id TEXT REFERENCES clubs(id),
        target_licence_type TEXT NOT NULL,
        started_on TEXT NOT NULL,
        completes_on TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_staff_licence_courses_person
        ON staff_licence_courses(person_id, status);

      CREATE TABLE IF NOT EXISTS staff_approaches (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        from_club_id TEXT NOT NULL REFERENCES clubs(id),
        current_club_id TEXT REFERENCES clubs(id),
        role TEXT NOT NULL,
        offered_salary_minor INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_on TEXT NOT NULL,
        decided_on TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_staff_approaches_person
        ON staff_approaches(person_id, created_on);
    `,
  },
  {
    version: 39,
    sql: `
      CREATE TABLE IF NOT EXISTS procurement_suppliers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL,
        reputation REAL NOT NULL, price_level REAL NOT NULL, reliability REAL NOT NULL,
        foreign_supplier INTEGER NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS procurement_requests (
        id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id), category TEXT NOT NULL,
        quantity INTEGER NOT NULL, requested_on TEXT NOT NULL, status TEXT NOT NULL,
        budget_category TEXT NOT NULL, status_text TEXT
      );
      CREATE TABLE IF NOT EXISTS procurement_offers (
        id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES procurement_requests(id), supplier_id TEXT NOT NULL REFERENCES procurement_suppliers(id),
        unit_price INTEGER NOT NULL, shipping_cost INTEGER NOT NULL, quality REAL NOT NULL,
        delivery_days INTEGER NOT NULL, reliability REAL NOT NULL, expires_on TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS procurement_orders (
        id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES procurement_requests(id), offer_id TEXT NOT NULL REFERENCES procurement_offers(id), club_id TEXT NOT NULL REFERENCES clubs(id),
        ordered_on TEXT NOT NULL, expected_delivery TEXT NOT NULL, delivered_on TEXT,
        quantity INTEGER NOT NULL, total_cost INTEGER NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL,
        quality REAL NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_procurement_requests_club ON procurement_requests(club_id, requested_on);
      CREATE INDEX IF NOT EXISTS idx_procurement_orders_delivery ON procurement_orders(expected_delivery, status);
    `,
  },
  {
    version: 40,
    sql: `
      CREATE TABLE IF NOT EXISTS procurement_contracts (
        id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id), supplier_id TEXT NOT NULL REFERENCES procurement_suppliers(id),
        agreement_type TEXT NOT NULL, category TEXT NOT NULL, unit_price INTEGER NOT NULL, discount_rate REAL NOT NULL,
        service_level REAL NOT NULL, warranty_months INTEGER NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT NOT NULL,
        renewal_notice_days INTEGER NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS procurement_service_records (
        id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES procurement_contracts(id), club_id TEXT NOT NULL REFERENCES clubs(id),
        supplier_id TEXT NOT NULL REFERENCES procurement_suppliers(id), order_id TEXT REFERENCES procurement_orders(id), recorded_on TEXT NOT NULL,
        service_type TEXT NOT NULL, status TEXT NOT NULL, cost INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS procurement_approval_thresholds (
        club_id TEXT NOT NULL REFERENCES clubs(id), category TEXT NOT NULL, max_auto_approval INTEGER NOT NULL,
        chairman_approval_above INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY (club_id, category)
      );
      CREATE INDEX IF NOT EXISTS idx_procurement_contracts_club ON procurement_contracts(club_id, status, ends_on);
      CREATE INDEX IF NOT EXISTS idx_procurement_service_records_club ON procurement_service_records(club_id, recorded_on);
    `,
  },
  {
    version: 41,
    sql: `
      CREATE TABLE IF NOT EXISTS federation_election_cycles (
        id TEXT PRIMARY KEY, federation_id TEXT NOT NULL REFERENCES federations(id), nomination_start TEXT NOT NULL,
        election_date TEXT NOT NULL, term_years INTEGER NOT NULL, status TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS federation_election_candidates (
        id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL REFERENCES federation_election_cycles(id), federation_id TEXT NOT NULL REFERENCES federations(id),
        person_id TEXT NOT NULL REFERENCES persons(id), reputation REAL NOT NULL, support_base REAL NOT NULL, committee_influence REAL NOT NULL,
        voting_blocs_json TEXT NOT NULL, manifesto_json TEXT NOT NULL, incumbent INTEGER NOT NULL, status TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS federation_election_results (
        id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL REFERENCES federation_election_cycles(id), federation_id TEXT NOT NULL REFERENCES federations(id),
        winner_candidate_id TEXT NOT NULL REFERENCES federation_election_candidates(id), elected_person_id TEXT NOT NULL REFERENCES persons(id),
        votes_json TEXT NOT NULL, decided_at TEXT NOT NULL, status TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_federation_election_cycles_date ON federation_election_cycles(federation_id, election_date);
      CREATE INDEX IF NOT EXISTS idx_federation_election_candidates_cycle ON federation_election_candidates(cycle_id, status);
    `,
  },
  {
    version: 42,
    sql: `
      CREATE TABLE IF NOT EXISTS federation_committee_memberships (
        id TEXT PRIMARY KEY, federation_id TEXT NOT NULL REFERENCES federations(id), committee_id TEXT NOT NULL REFERENCES federation_committees(id),
        person_id TEXT NOT NULL REFERENCES persons(id), influence REAL NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT, status TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS federation_governance_proposals (
        id TEXT PRIMARY KEY, federation_id TEXT NOT NULL REFERENCES federations(id), proposed_by_person_id TEXT NOT NULL REFERENCES persons(id), title TEXT NOT NULL,
        policy_area TEXT NOT NULL, target_committee TEXT NOT NULL, payload_json TEXT NOT NULL, proposed_at TEXT NOT NULL, reviewed_at TEXT, decided_at TEXT,
        status TEXT NOT NULL, votes_json TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS federation_manifesto_commitments (
        id TEXT PRIMARY KEY, federation_id TEXT NOT NULL REFERENCES federations(id), president_person_id TEXT NOT NULL REFERENCES persons(id), election_cycle_id TEXT NOT NULL REFERENCES federation_election_cycles(id),
        policy_area TEXT NOT NULL, promise TEXT NOT NULL, target_value REAL NOT NULL, progress REAL NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL, last_updated TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS federation_coalition_states (
        federation_id TEXT PRIMARY KEY REFERENCES federations(id), president_person_id TEXT NOT NULL REFERENCES persons(id), confidence REAL NOT NULL, coalition_support REAL NOT NULL,
        no_confidence_threshold REAL NOT NULL, last_updated TEXT NOT NULL, status TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS federation_governance_events (
        id TEXT PRIMARY KEY, federation_id TEXT NOT NULL REFERENCES federations(id), event_date TEXT NOT NULL, event_type TEXT NOT NULL, subject_id TEXT NOT NULL,
        summary TEXT NOT NULL, payload_json TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_federation_governance_proposals_federation ON federation_governance_proposals(federation_id, status, proposed_at);
      CREATE INDEX IF NOT EXISTS idx_federation_governance_events_federation ON federation_governance_events(federation_id, event_date, id);
    `,
  },
  {
    version: 43,
    sql: `
      -- Staff Market Phase C: hierarchy, delegation, workload, planning.
      CREATE TABLE IF NOT EXISTS staff_responsibilities (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        domain TEXT NOT NULL,
        owner_type TEXT NOT NULL,
        owner_appointment_id TEXT REFERENCES staff_appointments(id),
        board_approval_granted_until TEXT,
        updated_on TEXT NOT NULL,
        UNIQUE(club_id, domain)
      );

      CREATE TABLE IF NOT EXISTS staff_responsibility_log (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        domain TEXT NOT NULL,
        owner_type TEXT NOT NULL,
        owner_appointment_id TEXT REFERENCES staff_appointments(id),
        action TEXT NOT NULL,
        occurred_on TEXT NOT NULL,
        description TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_staff_responsibility_log_club
        ON staff_responsibility_log(club_id, occurred_on);

      CREATE TABLE IF NOT EXISTS staff_development_plans (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES persons(id),
        club_id TEXT NOT NULL REFERENCES clubs(id),
        focus TEXT NOT NULL,
        target_licence_type TEXT,
        licence_course_id TEXT REFERENCES staff_licence_courses(id),
        created_on TEXT NOT NULL,
        target_date TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_staff_development_plans_person
        ON staff_development_plans(person_id, status);

      CREATE TABLE IF NOT EXISTS staff_succession_plans (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id),
        outgoing_appointment_id TEXT NOT NULL REFERENCES staff_appointments(id),
        outgoing_person_id TEXT NOT NULL REFERENCES persons(id),
        role TEXT NOT NULL,
        candidate_person_id TEXT REFERENCES persons(id),
        reason TEXT NOT NULL,
        created_on TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_staff_succession_plans_club
        ON staff_succession_plans(club_id, status);
    `,
  },
  {
    version: 44,
    sql: `
      CREATE TABLE IF NOT EXISTS national_team_management_decisions (
        id TEXT PRIMARY KEY, federation_id TEXT NOT NULL REFERENCES federations(id), national_team_id TEXT NOT NULL REFERENCES teams(id),
        manager_person_id TEXT REFERENCES persons(id), decision_date TEXT NOT NULL, programme TEXT NOT NULL, selected_player_ids_json TEXT NOT NULL,
        captain_player_id TEXT REFERENCES persons(id), tactical_setup_id TEXT, tactical_style TEXT, competition_edition_id TEXT REFERENCES international_competition_editions(id),
        status TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS national_team_campaigns (
        id TEXT PRIMARY KEY, federation_id TEXT NOT NULL REFERENCES federations(id), national_team_id TEXT NOT NULL REFERENCES teams(id),
        competition_edition_id TEXT REFERENCES international_competition_editions(id), name TEXT NOT NULL, started_on TEXT NOT NULL,
        matches_played INTEGER NOT NULL, wins INTEGER NOT NULL, draws INTEGER NOT NULL, losses INTEGER NOT NULL, qualification_status TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_national_team_management_team ON national_team_management_decisions(national_team_id, decision_date);
      CREATE INDEX IF NOT EXISTS idx_national_team_campaigns_team ON national_team_campaigns(national_team_id, started_on);
    `,
  },
  {
    version: 45,
    sql: `
      ALTER TABLE national_team_campaigns ADD COLUMN objectives_json TEXT NOT NULL DEFAULT '{}';
      CREATE TABLE IF NOT EXISTS national_team_squad_registrations (
        id TEXT PRIMARY KEY, federation_id TEXT NOT NULL REFERENCES federations(id), national_team_id TEXT NOT NULL REFERENCES teams(id), competition_edition_id TEXT NOT NULL REFERENCES international_competition_editions(id),
        registration_deadline TEXT NOT NULL, provisional_player_ids_json TEXT NOT NULL, final_player_ids_json TEXT, status TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS national_team_camp_lifecycles (
        id TEXT PRIMARY KEY, federation_id TEXT NOT NULL REFERENCES federations(id), national_team_id TEXT NOT NULL REFERENCES teams(id), competition_edition_id TEXT REFERENCES international_competition_editions(id),
        callup_date TEXT NOT NULL, arrival_date TEXT, training_start TEXT, match_date TEXT, release_date TEXT, status TEXT NOT NULL, player_ids_json TEXT NOT NULL, fitness_effect REAL NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS international_commitments (
        player_id TEXT NOT NULL REFERENCES persons(id), federation_id TEXT NOT NULL REFERENCES federations(id), status TEXT NOT NULL, decided_on TEXT NOT NULL, reason TEXT, provenance_status TEXT NOT NULL, PRIMARY KEY (player_id, federation_id)
      );
      CREATE TABLE IF NOT EXISTS diaspora_recruitment (
        id TEXT PRIMARY KEY, federation_id TEXT NOT NULL REFERENCES federations(id), player_id TEXT NOT NULL REFERENCES persons(id), status TEXT NOT NULL, last_updated TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_national_team_registrations_deadline ON national_team_squad_registrations(competition_edition_id, registration_deadline);
      CREATE INDEX IF NOT EXISTS idx_national_team_camps_status ON national_team_camp_lifecycles(national_team_id, status);
    `,
  },
  {
    version: 46,
    sql: `
      CREATE TABLE IF NOT EXISTS national_team_watchlist (
        id TEXT PRIMARY KEY, federation_id TEXT NOT NULL REFERENCES federations(id), national_team_id TEXT NOT NULL REFERENCES teams(id), player_id TEXT NOT NULL REFERENCES persons(id),
        player_knowledge_level TEXT NOT NULL, reason TEXT NOT NULL, last_reviewed TEXT NOT NULL, status TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS national_team_operational_plans (
        id TEXT PRIMARY KEY, federation_id TEXT NOT NULL REFERENCES federations(id), national_team_id TEXT NOT NULL REFERENCES teams(id), competition_edition_id TEXT REFERENCES international_competition_editions(id),
        camp_start TEXT NOT NULL, camp_end TEXT NOT NULL, travel_plan TEXT NOT NULL, base_venue_id TEXT REFERENCES venues(id), registration_deadline TEXT, recovery_days INTEGER NOT NULL, status TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS national_team_international_form (
        id TEXT PRIMARY KEY, national_team_id TEXT NOT NULL REFERENCES teams(id), player_id TEXT NOT NULL REFERENCES persons(id), window_date TEXT NOT NULL, appearances INTEGER NOT NULL, minutes INTEGER NOT NULL, goals INTEGER NOT NULL, form_rating REAL NOT NULL, rationale TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_national_team_watchlist_team ON national_team_watchlist(national_team_id, status, last_reviewed);
      CREATE INDEX IF NOT EXISTS idx_national_team_form_player ON national_team_international_form(player_id, window_date);
    `,
  },
  {
    version: 47,
    sql: `
      CREATE TABLE IF NOT EXISTS media_outlets (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL, reputation REAL NOT NULL, reach REAL NOT NULL, bias TEXT NOT NULL, style TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_stories (
        id TEXT PRIMARY KEY, outlet_id TEXT NOT NULL REFERENCES media_outlets(id), event_type TEXT NOT NULL, source_entity_id TEXT NOT NULL, published_on TEXT NOT NULL,
        importance REAL NOT NULL, headline TEXT NOT NULL, summary TEXT NOT NULL, subject_ids_json TEXT NOT NULL, reputation_effect REAL NOT NULL, status TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_media_stories_date ON media_stories(published_on, importance DESC);
    `,
  },
  {
    version: 48,
    sql: `
      CREATE TABLE IF NOT EXISTS media_journalists (
        id TEXT PRIMARY KEY, outlet_id TEXT NOT NULL REFERENCES media_outlets(id), name TEXT NOT NULL, beat TEXT NOT NULL, temperament TEXT NOT NULL, reputation REAL NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_journalist_relationships (
        id TEXT PRIMARY KEY, journalist_id TEXT NOT NULL REFERENCES media_journalists(id), manager_person_id TEXT REFERENCES persons(id), trust REAL NOT NULL, last_interaction TEXT, status TEXT NOT NULL,
        UNIQUE(journalist_id, manager_person_id)
      );
      CREATE TABLE IF NOT EXISTS media_interviews (
        id TEXT PRIMARY KEY, outlet_id TEXT NOT NULL REFERENCES media_outlets(id), journalist_id TEXT NOT NULL REFERENCES media_journalists(id), source_entity_id TEXT NOT NULL, manager_person_id TEXT REFERENCES persons(id),
        interview_date TEXT NOT NULL, context TEXT NOT NULL, importance REAL NOT NULL, questions_json TEXT NOT NULL, responses_json TEXT NOT NULL, summary TEXT NOT NULL, manager_reputation_effect REAL NOT NULL, club_support_effect REAL NOT NULL, status TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_media_interviews_date ON media_interviews(interview_date, importance DESC);
    `,
  },
  {
    version: 49,
    sql: `
      CREATE TABLE IF NOT EXISTS medical_assessments (
        id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES persons(id), injury_id TEXT REFERENCES injuries(id), assessed_on TEXT NOT NULL,
        stage TEXT NOT NULL, estimated_return_start TEXT NOT NULL, estimated_return_end TEXT NOT NULL, confidence REAL NOT NULL,
        recurrence_risk REAL NOT NULL, fatigue REAL NOT NULL, workload_flag TEXT NOT NULL, availability_recommendation TEXT NOT NULL,
        clearance_status TEXT NOT NULL, rationale TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS medical_assessment_history (
        id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES persons(id), assessed_on TEXT NOT NULL, stage TEXT NOT NULL,
        recommendation TEXT NOT NULL, rationale TEXT NOT NULL, provenance_status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_medical_assessments_person ON medical_assessments(person_id, assessed_on);
      CREATE INDEX IF NOT EXISTS idx_medical_history_person ON medical_assessment_history(person_id, assessed_on);
    `,
  },
  {
    version: 50,
    sql: `
      CREATE TABLE IF NOT EXISTS simulation_club_records (
        id TEXT PRIMARY KEY, club_id TEXT NOT NULL UNIQUE REFERENCES clubs(id), location_id TEXT NOT NULL REFERENCES locations(id), founded_on TEXT NOT NULL,
        ownership_type TEXT NOT NULL, initial_reputation REAL NOT NULL, supporter_base INTEGER NOT NULL, status TEXT NOT NULL,
        admission_status TEXT NOT NULL, venue_id TEXT REFERENCES venues(id), provenance_status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_simulation_clubs_location ON simulation_club_records(location_id, status);
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
