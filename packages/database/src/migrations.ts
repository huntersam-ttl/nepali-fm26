import type { GameDatabase } from "./connection.js";

export const CURRENT_DATABASE_VERSION = 2;

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
