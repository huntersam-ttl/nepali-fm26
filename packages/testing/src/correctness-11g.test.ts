import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TrainingCampRepository, WorldRepository, migrateDatabase, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  createTrainingCamp,
  eligibleForNationalTeamAge,
  ensureEngineCountry,
  establishHomeFootballContext,
  homeCountryId,
  homeFederationId,
  initializeInternationalFootballForSave,
  nepalPack,
  registerCountryPack,
  resolveCampDestination,
  type CountryPack,
} from "@nepal-football-sim/simulation";
import {
  SIMULATED_TEAM_LEVELS,
  createStableEntityId,
  isSeniorTeamLevel,
  isSimulatedTeamLevel,
  isValidTeamLevel,
  teamLevelAgeCap,
  teamLevelLabel,
  type EntityId,
  type Team,
} from "@nepal-football-sim/shared-types";

/*
 * Phase 11G: team levels and training-camp destinations are open vocabularies. Storage accepts a
 * level the built-in data does not know (u19); the simulation says which levels it plays.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterAll(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })));

const memory = (): GameDatabase => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  return db;
};

const testlandPack: CountryPack = {
  packId: "testland-11g",
  countryName: "Testland",
  isoCodes: ["TL"],
  currency: "TLC",
  locale: "en-GB",
  federationAbbreviation: "TFA",
  seasonRules: { seasonStart: "03-01", seasonEnd: "11-30", youthIntake: "03-15" },
  nationalTeams: [{ teamType: "SENIOR_MEN", level: "senior", gender: "men", label: "Senior Men", strengthMultiplier: 1 }],
  tierLabels: ["Premier"],
  namePool: nepalPack.namePool,
};

describe("team levels", () => {
  it("keeps the built-in levels and says which ones the simulation plays", () => {
    expect([...SIMULATED_TEAM_LEVELS]).toEqual(["senior", "u23", "u20", "u17"]);
    for (const level of ["senior", "u23", "u20", "u17"]) expect(isSimulatedTeamLevel(level)).toBe(true);
    for (const level of ["reserve", "academy", "u19", "futsal", "b_team", "olympic"]) expect(isSimulatedTeamLevel(level)).toBe(false);
    expect(isSeniorTeamLevel("senior")).toBe(true);
    expect(isSeniorTeamLevel("u19")).toBe(false);
  });

  it("derives age caps and labels from the level, and never treats an unknown level as senior", () => {
    expect([teamLevelAgeCap("u23"), teamLevelAgeCap("u20"), teamLevelAgeCap("u17"), teamLevelAgeCap("u19")]).toEqual([23, 20, 17, 19]);
    expect(teamLevelAgeCap("senior")).toBeUndefined();
    expect([teamLevelLabel("senior"), teamLevelLabel("u19"), teamLevelLabel("b_team")]).toEqual(["Senior", "U19", "b team"]);
    expect(eligibleForNationalTeamAge("2010-01-01", "u23", "2026-08-01")).toBe(true);
    expect(eligibleForNationalTeamAge("2004-01-01", "u17", "2026-08-01")).toBe(false);
    expect(eligibleForNationalTeamAge("2008-01-01", "u19", "2026-08-01")).toBe(true);
    expect(eligibleForNationalTeamAge("2005-01-01", "u19", "2026-08-01"), "a 21-year-old is over an under-19 cap").toBe(false);
  });

  it("accepts well-formed future levels and rejects malformed ones", () => {
    for (const level of ["u19", "b_team", "futsal", "olympic", "senior"]) expect(isValidTeamLevel(level)).toBe(true);
    for (const level of ["", " ", "U19", "u 19", "9lives", "senior!", "x".repeat(40)]) expect(isValidTeamLevel(level)).toBe(false);
  });

  it("stores and reads back a team whose level the built-in data does not define", () => {
    const db = memory();
    const world = new WorldRepository(db);
    const country = { id: createStableEntityId("country", "11g-TL"), name: "Testland", isoCode: "TL" };
    world.insertCountry(country);
    const federationId = createStableEntityId("federation", "11g-tfa");
    world.insertFederation({ id: federationId, countryId: country.id, name: "Testland FA" });
    const team: Team = { id: createStableEntityId("team", "11g-u19"), federationId, name: "Testland U19 Men", level: "u19", gender: "men" };
    world.insertTeam(team);
    const stored = db.prepare("SELECT level FROM teams WHERE id = ?").get(team.id) as { level: string };
    expect(stored.level).toBe("u19");
    expect(isSimulatedTeamLevel(stored.level)).toBe(false);
    db.close();
  });
});

describe("training-camp destinations", () => {
  registerCountryPack(testlandPack);

  const testland = (): { db: GameDatabase; countryId: EntityId; federationId: EntityId } => {
    const db = memory();
    const world = new WorldRepository(db);
    const country = { id: createStableEntityId("country", "11g-TL"), name: "Testland", isoCode: "TL" };
    world.insertCountry(country);
    const federationId = createStableEntityId("federation", "11g-tfa");
    world.insertFederation({ id: federationId, countryId: country.id, name: "Testland FA" });
    establishHomeFootballContext(db, testlandPack, "2030-03-01");
    return { db, countryId: country.id, federationId };
  };

  const camp = (db: GameDatabase, federationId: EntityId, destination: string) =>
    createTrainingCamp(db, { ownerType: "FEDERATION", ownerId: federationId, programmeType: "NATIONAL_TEAM", destination, startDate: "2030-05-01", endDate: "2030-05-10" });

  it("a home camp belongs to the home country, whichever country that is", () => {
    const { db, countryId, federationId } = testland();
    const home = resolveCampDestination(db, "HOME_COUNTRY");
    expect(home).toEqual({ destination: "HOME_COUNTRY", countryId, label: "Testland" });
    const created = camp(db, federationId, "HOME_COUNTRY");
    expect(created.destinationCountryId).toBe(countryId);
    expect(created.cost).toBe(18000);
    db.close();
  });

  it("a foreign destination resolves through the country row (any of its codes) and is idempotent", () => {
    const { db, federationId } = testland();
    expect(resolveCampDestination(db, "JAPAN")).toEqual({ destination: "JAPAN", countryId: undefined, label: "Japan" });
    const japan = ensureEngineCountry(db, { isoAlpha2: "JP", name: "Japan" });
    expect(resolveCampDestination(db, "JAPAN").countryId).toBe(japan);
    const first = camp(db, federationId, "JAPAN");
    const second = camp(db, federationId, "JAPAN");
    expect(second.id).toBe(first.id);
    expect(first.destinationCountryId).toBe(japan);
    expect(new TrainingCampRepository(db).camps(federationId)).toHaveLength(1);
    expect(resolveCampDestination(db, "EUROPE")).toEqual({ destination: "EUROPE", countryId: undefined, label: "Europe" });
    expect(() => camp(db, federationId, "MARS")).toThrow(/No training-camp profile/);
    db.close();
  });

  it("reads a camp saved under the old NEPAL destination as the home-country preset, and upgrades an old table", () => {
    const db = memory();
    db.exec(`CREATE TABLE training_camps (id TEXT PRIMARY KEY,owner_type TEXT NOT NULL,owner_id TEXT NOT NULL,programme_type TEXT NOT NULL,destination TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,cost INTEGER NOT NULL,facility_quality INTEGER NOT NULL,climate_fit INTEGER NOT NULL,opposition_access INTEGER NOT NULL,travel_burden INTEGER NOT NULL,logistics_difficulty INTEGER NOT NULL,commercial_exposure INTEGER NOT NULL,scouting_exposure INTEGER NOT NULL,status TEXT NOT NULL,participant_ids_json TEXT NOT NULL,provenance_status TEXT NOT NULL)`);
    db.prepare("INSERT INTO training_camps VALUES ('old','FEDERATION','f','NATIONAL_TEAM','NEPAL','2027-01-01','2027-01-08',18000,45,90,35,10,20,10,15,'BOOKED','[]','SIMULATION_ONLY')").run();
    const loaded = new TrainingCampRepository(db).camp("old" as EntityId)!;
    expect(loaded.destination).toBe("HOME_COUNTRY");
    expect(loaded.destinationCountryId).toBeUndefined();
    expect(loaded.cost).toBe(18000);
    db.close();
  });
});

describe("a Nepal save", () => {
  let savePath = "";
  beforeAll(() => {
    const directory = mkdtempSync(join(tmpdir(), "correctness-11g-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const created = service.createCareer({
      saveName: "correctness-11g",
      character: {
        fullName: "Level Tester",
        dateOfBirth: "1985-01-01",
        startingAge: 41,
        languages: ["en"],
        footballBackground: "COMMUNITY_COACHING",
        education: "SPORTS_RELATED_DEGREE",
        playingExperience: "AMATEUR_PLAYER",
        coachingExperience: "YOUTH_COACH",
        businessBackground: "SMALL_BUSINESS",
        startingReputationProfile: "LOCAL_RESPECTED",
      },
    });
    if (!created.ok) throw new Error(created.error.message);
    savePath = created.data.catalogEntry.filePath;
    service.closeCareer();
  }, 120000);

  it("keeps Nepal's five national teams and levels, and its home camp is Nepal's, deterministically", () => {
    const db = openGameDatabase(savePath);
    migrateDatabase(db);
    try {
      initializeInternationalFootballForSave({ db, worldDate: "2026-08-01", seed: "11g" });
      const teams = db.prepare("SELECT name, level, gender FROM teams WHERE federation_id = ? AND club_id IS NULL ORDER BY name").all(homeFederationId(db)) as Array<{ name: string; level: string; gender: string }>;
      expect(teams).toEqual([
        { name: "Nepal Senior Men", level: "senior", gender: "men" },
        { name: "Nepal Senior Women", level: "senior", gender: "women" },
        { name: "Nepal U17 Men", level: "u17", gender: "men" },
        { name: "Nepal U20 Men", level: "u20", gender: "men" },
        { name: "Nepal U23 Men", level: "u23", gender: "men" },
      ]);
      const home = resolveCampDestination(db, "HOME_COUNTRY");
      expect(home.countryId).toBe(homeCountryId(db));
      expect(home.label).toBe("Nepal");
      const input = { ownerType: "FEDERATION" as const, ownerId: homeFederationId(db), programmeType: "NATIONAL_TEAM" as const, destination: "HOME_COUNTRY", startDate: "2026-09-01", endDate: "2026-09-08" };
      expect(createTrainingCamp(db, input)).toEqual(createTrainingCamp(db, input));
      expect(new TrainingCampRepository(db).camps(homeFederationId(db))).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
