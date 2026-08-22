import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  validateNepalWorldDataset,
  validateNepalWorldReferences,
} from "@nepal-football-sim/data-import";
import {
  CURRENT_DATABASE_VERSION,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  buildMatchEnvironmentFromVenue,
  createNepalSave,
  inspectNepalSave,
} from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const fixturePath = resolve(process.cwd(), "data/fixtures/testing-only-nepal-world.json");
const clubRegistryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-stage-two-"));
  tempDirs.push(dir);
  return join(dir, "nepal-save.sqlite");
};

const loadFixture = (): unknown => JSON.parse(readFileSync(fixturePath, "utf8"));
const loadClubRegistry = (): unknown => JSON.parse(readFileSync(clubRegistryPath, "utf8"));

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("stage two Nepal world data pipeline", () => {
  it("applies the additive Stage 2 migration", () => {
    const db = openGameDatabase(":memory:");
    expect(migrateDatabase(db)).toBe(CURRENT_DATABASE_VERSION);
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('venues', 'team_person_assignments', 'entity_provenance',
            'club_aliases', 'club_memberships', 'club_relationships', 'academies',
            'venue_relationships', 'competition_relationships', 'competition_movements',
            'location_travel_contexts', 'staff_profiles', 'staff_appointments',
            'staff_vacancies', 'staff_licences', 'referee_profiles', 'staff_history_events',
            'training_plans', 'individual_development_plans', 'player_development_states',
            'player_potentials', 'player_playing_time_snapshots',
            'competition_development_multipliers', 'staff_simulation_profiles',
            'training_facility_profiles', 'training_history_events')
        ORDER BY name`,
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      "academies",
      "club_aliases",
      "club_memberships",
      "club_relationships",
      "competition_development_multipliers",
      "competition_movements",
      "competition_relationships",
      "entity_provenance",
      "individual_development_plans",
      "location_travel_contexts",
      "player_development_states",
      "player_playing_time_snapshots",
      "player_potentials",
      "referee_profiles",
      "staff_appointments",
      "staff_history_events",
      "staff_licences",
      "staff_profiles",
      "staff_simulation_profiles",
      "staff_vacancies",
      "team_person_assignments",
      "training_facility_profiles",
      "training_history_events",
      "training_plans",
      "venue_relationships",
      "venues",
    ]);
    db.close();
  });

  it("validates a complete testing-only Nepal world dataset", () => {
    const dataset = validateNepalWorldDataset(loadFixture());

    expect(dataset.meta.targetDatabaseDate).toBe("2026-08");
    expect(validateNepalWorldReferences(dataset)).toEqual([]);
  });

  it("rejects unavailable facts that pretend to have unknown values", () => {
    const dataset = loadFixture() as any;
    dataset.venues[0].capacity = {
      value: 15000,
      status: "UNKNOWN",
    };

    expect(() => validateNepalWorldDataset(dataset)).toThrow();
  });

  it("reports broken dataset references before importing", () => {
    const dataset = validateNepalWorldDataset(loadFixture());
    dataset.teams[0]!.clubKey = {
      value: "missing-club",
      status: "REPORTED",
    };

    expect(validateNepalWorldReferences(dataset)).toEqual([
      {
        path: "teams.0.clubKey",
        message: "Unknown reference: missing-club",
      },
    ]);
  });

  it("creates, reloads and inspects a Nepal save from an importable dataset", () => {
    const databasePath = tempDbPath();
    const created = createNepalSave({
      databasePath,
      dataset: loadFixture(),
      saveName: "Testing-only Nepal August 2026",
      gameVersion: "0.2.0",
      randomSeed: "stage-two-seed",
    });

    expect(created.worldDate).toBe("2026-08-01");
    expect(created.inspection).toMatchObject({
      countries: 2,
      locations: 1,
      venues: 1,
      federations: 1,
      competitions: 1,
      competitionSeasons: 1,
      clubs: 1,
      teams: 2,
      persons: 4,
      personRoles: 5,
      teamPersonAssignments: 2,
      staffProfiles: 1,
      staffAppointments: 6,
      staffVacancies: 1,
      staffLicences: 1,
      refereeProfiles: 1,
      staffHistoryEvents: 1,
      entityProvenance: 32,
    });

    expect(inspectNepalSave(databasePath)).toEqual(created);
  });

  it("imports the testing-only football workforce without duplicate people", () => {
    const databasePath = tempDbPath();
    createNepalSave({
      databasePath,
      dataset: loadFixture(),
      saveName: "Testing-only Staff Workforce",
      gameVersion: "0.2.0",
      randomSeed: "staff-workforce-seed",
    });

    const db = openGameDatabase(databasePath);
    migrateDatabase(db);

    const playerCoach = db
      .prepare(
        `SELECT p.full_name, GROUP_CONCAT(DISTINCT pr.role) AS roles,
          COUNT(DISTINCT sa.id) AS appointments
        FROM persons p
        JOIN person_roles pr ON pr.person_id = p.id
        JOIN staff_appointments sa ON sa.person_id = p.id
        WHERE p.full_name = 'Testing-only Player'
        GROUP BY p.id`,
      )
      .get();
    expect(playerCoach).toEqual({
      full_name: "Testing-only Player",
      roles: "PLAYER,STAFF",
      appointments: 1,
    });

    const multiRoleStaff = db
      .prepare(
        `SELECT COUNT(*) AS count
        FROM staff_appointments sa
        JOIN persons p ON p.id = sa.person_id
        WHERE p.full_name = 'Testing-only Staff'`,
      )
      .get() as { count: number };
    expect(multiRoleStaff.count).toBe(3);

    const workforce = db
      .prepare(
        `SELECT role, employment_status
        FROM staff_appointments
        WHERE role IN ('HEAD_COACH', 'ASSISTANT_COACH', 'NATIONAL_TEAM_HEAD_COACH',
          'FEDERATION_GENERAL_SECRETARY', 'REFEREE')
        ORDER BY role, employment_status`,
      )
      .all();
    expect(workforce).toEqual([
      { role: "ASSISTANT_COACH", employment_status: "FORMER" },
      { role: "FEDERATION_GENERAL_SECRETARY", employment_status: "ACTIVE" },
      { role: "HEAD_COACH", employment_status: "ACTIVE" },
      { role: "HEAD_COACH", employment_status: "INTERIM" },
      { role: "NATIONAL_TEAM_HEAD_COACH", employment_status: "ACTIVE" },
      { role: "REFEREE", employment_status: "ACTIVE" },
    ]);

    const vacancy = db
      .prepare("SELECT role, required, assigned_person_id, status FROM staff_vacancies")
      .get();
    expect(vacancy).toEqual({
      role: "PHYSIO",
      required: 0,
      assigned_person_id: null,
      status: "VACANT",
    });

    const licence = db
      .prepare(
        `SELECT sl.licence_type, sl.issuer, sl.status
        FROM staff_licences sl
        JOIN persons p ON p.id = sl.person_id
        WHERE p.full_name = 'Testing-only Foreign Coach'`,
      )
      .get();
    expect(licence).toEqual({
      licence_type: "AFC A",
      issuer: "Asian Football Confederation",
      status: "REPORTED",
    });

    const foreignStaff = db
      .prepare(
        `SELECT c.iso_code AS nationality, sc.iso_code AS second_nationality, sp.work_eligibility_status
        FROM persons p
        JOIN countries c ON c.id = p.nationality_country_id
        LEFT JOIN countries sc ON sc.id = p.second_nationality_country_id
        JOIN staff_profiles sp ON sp.person_id = p.id
        WHERE p.full_name = 'Testing-only Foreign Coach'`,
      )
      .get();
    expect(foreignStaff).toEqual({
      nationality: "AU",
      second_nationality: "NP",
      work_eligibility_status: "ELIGIBLE",
    });

    const referee = db
      .prepare(
        `SELECT rp.primary_role, rp.fifa_listed, rp.competitions_eligible_json
        FROM referee_profiles rp
        JOIN persons p ON p.id = rp.person_id
        WHERE p.full_name = 'Testing-only Referee'`,
      )
      .get() as {
      primary_role: string;
      fifa_listed: number | null;
      competitions_eligible_json: string;
    };
    expect(referee.primary_role).toBe("REFEREE");
    expect(referee.fifa_listed).toBeNull();
    expect(JSON.parse(referee.competitions_eligible_json)).toHaveLength(1);

    const history = db.prepare("SELECT event_type, description FROM staff_history_events").get();
    expect(history).toEqual({
      event_type: "MANAGER_APPOINTED",
      description: "Testing-only retired player became head coach.",
    });

    const duplicateNames = db
      .prepare(
        `SELECT full_name, COUNT(*) AS count
        FROM persons
        GROUP BY full_name
        HAVING COUNT(*) > 1`,
      )
      .all();
    expect(duplicateNames).toEqual([]);
    db.close();
  });

  it("validates the canonical Nepal club registry without players", () => {
    const dataset = validateNepalWorldDataset(loadClubRegistry());

    expect(validateNepalWorldReferences(dataset)).toEqual([]);
    expect(dataset.clubs).toHaveLength(53);
    expect(dataset.clubs.filter((club) => club.key.startsWith("NEP-NSL-"))).toHaveLength(9);
    expect(dataset.clubs.filter((club) => club.key.startsWith("NEP-DEP-"))).toHaveLength(3);
    expect(dataset.competitions).toHaveLength(5);
    expect(dataset.competitionRules).toHaveLength(5);
    expect(dataset.competitionRelationships).toHaveLength(5);
    expect(dataset.clubMemberships).toHaveLength(51);
    expect(dataset.teams.filter((team) => team.gender === "women")).toHaveLength(10);
    expect(dataset.academies).toHaveLength(8);
    expect(dataset.persons).toEqual([]);
    expect(dataset.playerAttributes).toEqual([]);

    const nslJhapa = dataset.clubs.find((club) => club.key === "NEP-NSL-JHA");
    const pyramidJhapa = dataset.clubs.find((club) => club.key === "NEP-DIVB-JHA");
    expect(nslJhapa?.name).toBe("Jhapa FC (NSL)");
    expect(pyramidJhapa?.name).toBe("Jhapa Football Club (ANFA pyramid)");
  });

  it("persists the Nepal club registry into a reloadable save", () => {
    const databasePath = tempDbPath();
    const created = createNepalSave({
      databasePath,
      dataset: loadClubRegistry(),
      saveName: "Nepal Club Registry August 2026",
      gameVersion: "0.2.0",
      randomSeed: "club-registry-seed",
    });

    expect(created.inspection).toMatchObject({
      countries: 1,
      locations: 43,
      venues: 8,
      federations: 1,
      competitions: 5,
      competitionSeasons: 5,
      competitionRelationships: 5,
      competitionMovements: 0,
      clubs: 53,
      clubAliases: 18,
      clubMemberships: 51,
      teams: 61,
      academies: 8,
      venueRelationships: 8,
      locationTravelContexts: 3,
      persons: 0,
      playerAttributes: 0,
      entityProvenance: 335,
    });
    expect(inspectNepalSave(databasePath)).toEqual(created);

    const db = openGameDatabase(databasePath);
    migrateDatabase(db);
    const jhapaRows = db
      .prepare(
        "SELECT canonical_external_id, name FROM clubs WHERE canonical_external_id IN ('NEP-NSL-JHA', 'NEP-DIVB-JHA') ORDER BY canonical_external_id",
      )
      .all();
    expect(jhapaRows).toEqual([
      { canonical_external_id: "NEP-DIVB-JHA", name: "Jhapa Football Club (ANFA pyramid)" },
      { canonical_external_id: "NEP-NSL-JHA", name: "Jhapa FC (NSL)" },
    ]);

    const apfWomen = db
      .prepare(
        `SELECT cr.relationship_type
        FROM club_relationships cr
        JOIN teams t ON t.id = cr.child_team_id
        JOIN clubs c ON c.id = cr.parent_club_id
        WHERE c.canonical_external_id = 'NEP-DEP-APF'
          AND t.canonical_external_id = 'NEP-WOM-APF'`,
      )
      .get();
    expect(apfWomen).toEqual({ relationship_type: "WOMENS_BRANCH" });

    const aliasCount = db
      .prepare("SELECT COUNT(*) AS count FROM club_aliases WHERE alias IN ('NRT', 'MMC', 'APF FC')")
      .get() as { count: number };
    expect(aliasCount.count).toBe(3);
    db.close();
  });

  it("models Nepal venue geography, climate and travel without invented venue precision", () => {
    const databasePath = tempDbPath();
    createNepalSave({
      databasePath,
      dataset: loadClubRegistry(),
      saveName: "Nepal Venue Geography August 2026",
      gameVersion: "0.2.0",
      randomSeed: "venue-geography-seed",
    });

    const db = openGameDatabase(databasePath);
    migrateDatabase(db);

    const provinceCount = db
      .prepare("SELECT COUNT(*) AS count FROM locations WHERE kind = 'province'")
      .get() as {
      count: number;
    };
    expect(provinceCount.count).toBe(7);

    const kathmanduHierarchy = db
      .prepare(
        `SELECT city.name AS city, district.name AS district, province.name AS province
        FROM locations city
        JOIN locations district ON district.id = city.parent_location_id
        JOIN locations province ON province.id = district.parent_location_id
        WHERE city.canonical_external_id = 'NP-CITY-KATHMANDU'`,
      )
      .get();
    expect(kathmanduHierarchy).toEqual({
      city: "Kathmandu",
      district: "Kathmandu District",
      province: "Bagmati",
    });

    const dasharath = db
      .prepare(
        `SELECT v.capacity, v.venue_type, v.status, v.surface_type, v.altitude_meters,
          city.name AS city, district.name AS district, province.name AS province
        FROM venues v
        JOIN locations city ON city.id = v.city_id
        JOIN locations district ON district.id = v.district_id
        JOIN locations province ON province.id = v.province_id
        WHERE v.canonical_external_id = 'NEP-VEN-DASHARATH-RANGASALA'`,
      )
      .get();
    expect(dasharath).toEqual({
      capacity: 15000,
      venue_type: "MULTI_SPORT_STADIUM",
      status: "ACTIVE",
      surface_type: "UNKNOWN",
      altitude_meters: null,
      city: "Kathmandu",
      district: "Kathmandu District",
      province: "Bagmati",
    });

    const anfaComplex = db
      .prepare(
        `SELECT v.surface_type, l.climate_profile_json
        FROM venues v
        JOIN locations l ON l.id = v.location_id
        WHERE v.canonical_external_id = 'NEP-VEN-ANFA-COMPLEX-GROUND'`,
      )
      .get() as { surface_type: string; climate_profile_json: string };
    expect(anfaComplex.surface_type).toBe("ARTIFICIAL_TURF");
    expect(JSON.parse(anfaComplex.climate_profile_json)).toMatchObject({
      seasonalHeatRisk: "UNKNOWN",
      monsoonRisk: "UNKNOWN",
      coldRisk: "UNKNOWN",
      humidityRisk: "UNKNOWN",
    });

    const travel = db
      .prepare(
        `SELECT road_distance_km, estimated_road_travel_hours, air_travel_available
        FROM location_travel_contexts
        WHERE from_location_id = (
          SELECT id FROM locations WHERE canonical_external_id = 'NP-CITY-KATHMANDU'
        )
        AND to_location_id = (
          SELECT id FROM locations WHERE canonical_external_id = 'NP-CITY-POKHARA'
        )`,
      )
      .get();
    expect(travel).toEqual({
      road_distance_km: null,
      estimated_road_travel_hours: null,
      air_travel_available: null,
    });

    db.close();
  });

  it("distinguishes venue operators, national-team use, academy use and temporary club use", () => {
    const databasePath = tempDbPath();
    createNepalSave({
      databasePath,
      dataset: loadClubRegistry(),
      saveName: "Nepal Venue Relationships August 2026",
      gameVersion: "0.2.0",
      randomSeed: "venue-relationships-seed",
    });

    const db = openGameDatabase(databasePath);
    migrateDatabase(db);

    const relationships = db
      .prepare(
        `SELECT v.canonical_external_id AS venue, c.canonical_external_id AS club,
          t.canonical_external_id AS team, a.canonical_external_id AS academy,
          f.name AS federation, vr.relationship_type, vr.status
        FROM venue_relationships vr
        JOIN venues v ON v.id = vr.venue_id
        LEFT JOIN clubs c ON c.id = vr.club_id
        LEFT JOIN teams t ON t.id = vr.team_id
        LEFT JOIN academies a ON a.id = vr.academy_id
        LEFT JOIN federations f ON f.id = vr.federation_id
        ORDER BY vr.relationship_type, venue`,
      )
      .all();

    expect(relationships).toContainEqual(
      expect.objectContaining({
        venue: "NEP-VEN-DASHARATH-RANGASALA",
        federation: "All Nepal Football Association",
        relationship_type: "NATIONAL_TEAM_USER",
        status: "federationAssigned",
      }),
    );
    expect(relationships).toContainEqual(
      expect.objectContaining({
        venue: "NEP-VEN-ANFA-COMPLEX-GROUND",
        academy: "NEP-ACA-ANF1",
        relationship_type: "ACADEMY_USER",
        status: "available",
      }),
    );
    expect(relationships).toContainEqual(
      expect.objectContaining({
        venue: "NEP-VEN-HALCHOWK-STADIUM",
        club: "NEP-DEP-APF",
        team: "NEP-DEP-APF-MEN",
        relationship_type: "TRAINING_USER",
      }),
    );
    expect(relationships).toContainEqual(
      expect.objectContaining({
        venue: "NEP-VEN-DOMALAL-RAJBANSHI-STADIUM",
        club: "NEP-NSL-JHA",
        relationship_type: "TEMPORARY_USER",
      }),
    );

    const ownerRows = relationships.filter(
      (relationship: any) => relationship.relationship_type === "OWNER",
    );
    expect(ownerRows).toEqual([]);
    db.close();
  });

  it("keeps venue facts available for future match environment derivation", () => {
    const environment = buildMatchEnvironmentFromVenue(
      {
        id: "venue-1" as any,
        countryId: "np" as any,
        locationId: "location-1" as any,
        name: "Testing Venue",
        surfaceType: "NATURAL_GRASS",
        pitchQuality: "UNKNOWN",
      },
      {
        id: "location-1" as any,
        countryId: "np" as any,
        name: "Testing City",
        kind: "city",
        altitudeMeters: 1400,
        climateProfile: {
          seasonalHeatRisk: "MEDIUM",
          monsoonRisk: "HIGH",
          coldRisk: "LOW",
          humidityRisk: "MEDIUM",
        },
      },
    );

    expect(environment.environment).toMatchObject({
      matchTempo: 1,
      pitchQuality: 1,
      weatherImpact: 0,
      altitudeImpact: 0,
      heatImpact: 0,
    });
    expect(environment.signals).toMatchObject({
      venueId: "venue-1",
      locationId: "location-1",
      altitudeMeters: 1400,
      surfaceType: "NATURAL_GRASS",
      pitchQuality: "UNKNOWN",
      seasonalHeatRisk: "MEDIUM",
      monsoonRisk: "HIGH",
    });
  });
});
