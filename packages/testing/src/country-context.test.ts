import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CareerWorldRepository,
  ClubEconomyRepository,
  ManagerRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  NEPAL_NAME_POOL,
  NEPAL_PACK_ID,
  SeededRandom,
  countryPack,
  createCountrySave,
  createNepalSave,
  ensureAiManagersAssigned,
  establishHomeFootballContext,
  findHomeFootballContext,
  generateAiManager,
  homeCountryId,
  homeCurrency,
  homeFederation,
  homeFederationAbbreviation,
  homeFootballContext,
  homeIsoCodes,
  homeLocale,
  homeNamePool,
  homeNationalTeams,
  isHomeCountry,
  isHomeFederation,
  registerCountryPack,
  repairPreseasonContinuity,
  seasonEndDate,
  seasonEndInYear,
  seasonPeriodMonthsFor,
  seasonStartDate,
  type CountryPack,
} from "@nepal-football-sim/simulation";
import { createStableEntityId, type Club, type EntityId, type Team } from "@nepal-football-sim/shared-types";

/*
 * Phase 11C: the engine asks the save's home football context who the country is instead of
 * assuming Nepal. Nepal resolves exactly as before; a synthetic country (test-only) resolves
 * through the same code with no Nepal id or name anywhere.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterAll(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })));

const character = {
  fullName: "Context Tester",
  dateOfBirth: "1985-01-01",
  startingAge: 41,
  languages: ["en"],
  footballBackground: "COMMUNITY_COACHING",
  education: "SPORTS_RELATED_DEGREE",
  playingExperience: "AMATEUR_PLAYER",
  coachingExperience: "YOUTH_COACH",
  businessBackground: "SMALL_BUSINESS",
  startingReputationProfile: "LOCAL_RESPECTED",
};

const withDb = <T,>(path: string, run: (db: GameDatabase) => T): T => {
  const db = openGameDatabase(path);
  migrateDatabase(db);
  try {
    return run(db);
  } finally {
    db.close();
  }
};

let savePath = "";
beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), "country-context-"));
  dirs.push(directory);
  const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
  const created = service.createCareer({ saveName: "context", character });
  if (!created.ok) throw new Error(created.error.message);
  savePath = created.data.catalogEntry.filePath;
  service.closeCareer();
}, 240_000);

/** A working copy of the Nepal save, so a test can alter it freely. */
const copyOfSave = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "country-context-copy-"));
  dirs.push(directory);
  const path = join(directory, "copy.sqlite");
  copyFileSync(savePath, path);
  return path;
};

describe("the Nepal save's home football context", () => {
  it("is recorded at creation from the Nepal pack", () => {
    withDb(savePath, (db) => {
      const context = homeFootballContext(db);
      expect(context).toMatchObject({
        packId: "nepal-v1",
        countryName: "Nepal",
        federationName: "All Nepal Football Association",
        federationAbbreviation: "ANFA",
        currency: "NPR",
        locale: "en-IN",
      });
      expect(context.seasonRules).toEqual({ seasonStart: "08-01", seasonEnd: "07-31", youthIntake: "08-15" });
      expect(context.nationalTeams.map((team) => team.teamType)).toEqual(["SENIOR_MEN", "SENIOR_WOMEN", "U23", "U20", "U17"]);
      expect(homeCurrency(db)).toBe("NPR");
      expect(homeLocale(db)).toBe("en-IN");
      expect(homeFederationAbbreviation(db)).toBe("ANFA");
      expect(homeIsoCodes(db)).toEqual(["NPL", "NP"]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM home_football_contexts").get()).toEqual({ n: 1 });
    });
  });

  it("is inferred for a save made before the context existed, without recreating it", () => {
    const path = copyOfSave();
    const before = withDb(path, (db) => homeFootballContext(db));
    // Make it look like an older save: no context table, no view, no migration record.
    const raw = openGameDatabase(path);
    raw.exec("DROP VIEW home_football_country; DROP VIEW competition_tiers; DROP TABLE home_football_contexts; DELETE FROM schema_migrations WHERE version = 103;");
    raw.close();
    const after = withDb(path, (db) => homeFootballContext(db));
    expect(after.countryId).toBe(before.countryId);
    expect(after.federationId).toBe(before.federationId);
    expect(after).toMatchObject({ packId: "nepal-v1", currency: "NPR", locale: "en-IN", federationAbbreviation: "ANFA" });
    expect(after.seasonRules).toEqual(before.seasonRules);
    expect(after.nationalTeams).toEqual(before.nationalTeams);
  });

  it("finds the federation and the country by id, never by name", () => {
    const path = copyOfSave();
    withDb(path, (db) => {
      const home = homeFootballContext(db);
      db.prepare("UPDATE federations SET name = 'Renamed Association' WHERE id = ?").run(home.federationId);
      db.prepare("UPDATE countries SET name = 'Renamed Country' WHERE id = ?").run(home.countryId);
    });
    withDb(path, (db) => {
      const federation = homeFederation(db);
      expect(federation.name).toBe("Renamed Association");
      expect(federation.id).toBe(homeFootballContext(db).federationId);
      expect(isHomeFederation(db, federation.id)).toBe(true);
      expect(isHomeCountry(db, homeCountryId(db))).toBe(true);
      const foreign = db.prepare("SELECT id FROM federations WHERE id != ? LIMIT 1").get(federation.id) as { id: EntityId } | undefined;
      if (foreign) expect(isHomeFederation(db, foreign.id)).toBe(false);
    });
  });

  it("takes currency, locale and season rules from the stored configuration", () => {
    const path = copyOfSave();
    withDb(path, (db) => {
      db.prepare("UPDATE home_football_contexts SET currency = 'XYZ', locale = 'en-GB', config_json = ? WHERE id = 1").run(
        JSON.stringify({
          federationAbbreviation: "XFA",
          seasonRules: { seasonStart: "01-15", seasonEnd: "12-20", youthIntake: "02-01" },
          nationalTeams: [{ teamType: "SENIOR_MEN", level: "senior", gender: "men", label: "Senior Men", strengthMultiplier: 1 }],
          tierLabels: ["Premier", "Championship"],
        }),
      );
    });
    withDb(path, (db) => {
      expect(homeCurrency(db)).toBe("XYZ");
      expect(homeLocale(db)).toBe("en-GB");
      expect(homeFederationAbbreviation(db)).toBe("XFA");
      expect(seasonStartDate(db, 2030)).toBe("2030-01-15");
      expect(seasonEndDate(db, 2030)).toBe("2030-12-20");
      expect(seasonEndInYear(db, 2031)).toBe("2031-12-20");
      expect(seasonPeriodMonthsFor(db, 2030)).toEqual(["2030-01", "2030-02", "2030-03", "2030-04", "2030-05", "2030-06", "2030-07", "2030-08", "2030-09", "2030-10", "2030-11", "2030-12"]);
      expect(homeNationalTeams(db).map((team) => team.teamType)).toEqual(["SENIOR_MEN"]);
    });
  });

  it("keeps Nepal's season rules exactly as they were", () => {
    withDb(savePath, (db) => {
      expect(seasonStartDate(db, 2026)).toBe("2026-08-01");
      expect(seasonEndDate(db, 2026)).toBe("2027-07-31");
      expect(seasonEndInYear(db, 2027)).toBe("2027-07-31");
      expect(seasonPeriodMonthsFor(db, 2027)).toEqual(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07"]);
    });
  });
});

describe("competition behaviour does not depend on display names", () => {
  it("reads pyramid tiers from the relationships, so renaming divisions changes nothing", () => {
    const path = copyOfSave();
    const tiers = () =>
      withDb(path, (db) =>
        (db.prepare("SELECT competition_id AS id, tier FROM competition_tiers ORDER BY tier, competition_id").all() as Array<{ id: string; tier: number }>).map((row) => `${row.tier}:${row.id}`),
      );
    const before = tiers();
    expect(before).toHaveLength(3);
    withDb(path, (db) => db.exec("UPDATE competitions SET name = 'Renamed ' || id"));
    expect(tiers()).toEqual(before);
  });

  it("still repairs the core leagues' squads after their names change", () => {
    const path = copyOfSave();
    withDb(path, (db) => {
      const season = db
        .prepare("SELECT cs.id AS id FROM competition_seasons cs JOIN competitions c ON c.id = cs.competition_id WHERE c.category = 'SPECIAL_NATIONAL_LEAGUE' LIMIT 1")
        .get() as { id: EntityId };
      db.exec("UPDATE competitions SET name = 'A League With A New Name'");
      const reports = repairPreseasonContinuity({ db, competitionSeasonIds: [season.id], date: "2026-07-01", seed: "renamed" });
      expect(reports).toHaveLength(1);
    });
  });
});

describe("names come from the country's name pool", () => {
  it("Nepal's pool reproduces the previous generator output exactly", () => {
    const legacyManagers = ["Bikash Thapa", "Suman Gurung", "Nirajan Rai", "Sagar Khadka", "Prakash Basnet", "Rohit Chettri", "Deepak Shrestha", "Milan Tamang", "Kiran Magar", "Anup Karki", "Bishal Lama", "Ramesh Bhandari"];
    expect([...NEPAL_NAME_POOL.managerFullNames]).toEqual(legacyManagers);
    for (const seed of ["ai-manager:a:2026-08-01", "ai-manager:b:2027-03-04", "career:x:owner-candidate:3"]) {
      const generated = generateAiManager(seed, "2026-08-01", "country-id" as EntityId, NEPAL_NAME_POOL);
      expect(generated.person.fullName).toBe(new SeededRandom(seed).pick(legacyManagers));
      expect(generated.person.languages).toEqual(["ne"]);
    }
  });

  it("the home pool of a Nepal save is Nepal's", () => {
    withDb(savePath, (db) => expect(homeNamePool(db)).toBe(NEPAL_NAME_POOL));
  });
});

describe("save creation goes through one country path", () => {
  it("rejects a country pack that is not registered", () => {
    expect(() => countryPack("nowhere-v1")).toThrow(/No country pack is registered/);
    expect(() => createCountrySave({ packId: "nowhere-v1", databasePath: join(tmpdir(), "never.sqlite"), dataset: {}, gameVersion: "test", randomSeed: "x" })).toThrow(/No country pack is registered/);
  });

  it("createNepalSave is the generic path with the Nepal pack", () => {
    const directory = mkdtempSync(join(tmpdir(), "country-save-"));
    dirs.push(directory);
    const dataset = JSON.parse(readFileSync(resolve("data/fixtures/testing-only-nepal-world.json"), "utf8")) as unknown;
    const path = join(directory, "nepal.sqlite");
    createNepalSave({ databasePath: path, dataset, gameVersion: "test", randomSeed: "country-path", globalSeedPath: null });
    withDb(path, (db) => {
      const context = findHomeFootballContext(db);
      expect(context?.packId).toBe(NEPAL_PACK_ID);
      expect(context?.countryIso).toBeDefined();
      expect(homeCountryId(db)).toBe(context?.countryId);
    });
  }, 240_000);
});

/*
 * COUNTRY #2 DRY RUN. "Testland" exists only in this file. Nothing below refers to a Nepal id,
 * name, ISO code or currency, yet the engine resolves its identity, money, calendar, national
 * teams and names, and an AI club hires a manager from its own name pool.
 */
const TESTLAND_NAMES = {
  id: "testland-names",
  languageCodes: ["tl"],
  languageNames: ["Testish"],
  managerFullNames: ["Ada Testov", "Bo Testova", "Cy Testman"],
  staffFullNames: ["Di Staffov"],
  officials: { maleFirst: ["Ed"], femaleFirst: ["Fay"], surnames: ["Refov"] },
  players: { maleFirst: ["Gus"], femaleFirst: ["Hana"], maleMiddle: ["Ian"], femaleMiddle: ["Jo"], surnames: ["Playov"] },
};
const testlandPack: CountryPack = {
  packId: "testland-v0",
  countryName: "Testland",
  isoCodes: ["TLD"],
  currency: "TLC",
  locale: "en-GB",
  federationAbbreviation: "TFA",
  seasonRules: { seasonStart: "03-01", seasonEnd: "11-30", youthIntake: "03-15" },
  nationalTeams: [
    { teamType: "SENIOR_MEN", level: "senior", gender: "men", label: "Senior Men", strengthMultiplier: 1 },
    { teamType: "U20", level: "u20", gender: "men", label: "U20 Men", strengthMultiplier: 0.86 },
  ],
  tierLabels: ["Premier", "Second Tier"],
  namePool: TESTLAND_NAMES,
};

describe("a synthetic second country (test-only)", () => {
  registerCountryPack(testlandPack);

  const buildTestland = (): { db: GameDatabase; teams: Team[] } => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const country = { id: createStableEntityId("country", "TLD"), name: "Testland", isoCode: "TLD" };
    world.insertCountry(country);
    world.insertFederation({ id: createStableEntityId("federation", "tfa"), countryId: country.id, name: "Testland Football Association" });
    const competitionId = createStableEntityId("competition", "testland-premier");
    const lowerId = createStableEntityId("competition", "testland-second");
    const seasonId = createStableEntityId("season", "testland-premier-2030");
    world.insertCompetition({ id: competitionId, name: "Testland Premier", scope: "domestic", category: "PYRAMID_LEAGUE" });
    world.insertCompetition({ id: lowerId, name: "Testland Second", scope: "domestic", category: "PYRAMID_LEAGUE" });
    world.insertCompetitionSeason({ id: seasonId, competitionId, name: "2030 Testland Premier", startDate: "2030-03-01", endDate: "2030-11-30" });
    db.prepare("INSERT INTO competition_relationships (id, from_competition_id, to_competition_id, movement_type, number_of_teams, selection_method) VALUES (?, ?, ?, 'RELEGATION', 1, 'BOTTOM_TABLE')").run("r1", competitionId, lowerId);
    db.prepare("INSERT INTO competition_relationships (id, from_competition_id, to_competition_id, movement_type, number_of_teams, selection_method) VALUES (?, ?, ?, 'PROMOTION', 1, 'TOP_TABLE')").run("r2", lowerId, competitionId);
    const teams: Team[] = [];
    for (let index = 0; index < 2; index += 1) {
      const club: Club = { id: createStableEntityId("club", `testland-${index}`), name: `Testland FC ${index}`, countryId: country.id, ownershipType: "PRIVATE" };
      const team: Team = { id: createStableEntityId("team", `testland-${index}`), clubId: club.id, name: club.name, level: "senior", gender: "men" };
      world.insertClub(club);
      world.insertTeam(team);
      world.insertClubMembership({ id: createStableEntityId("membership", `testland-${index}`), clubId: club.id, teamId: team.id, competitionId, competitionSeasonId: seasonId, membershipType: "LEAGUE_MEMBER", status: "ACTIVE" });
      new ClubEconomyRepository(db).upsertBoardPolicy({
        clubId: club.id,
        financialRiskTolerance: "BALANCED",
        transferPhilosophy: "BALANCED",
        youthPriority: 0.5,
        commercialPriority: 0.5,
        infrastructurePriority: 0.5,
        strategicObjective: "SURVIVE",
        updatedAt: "2030-03-01",
        status: "SIMULATION_ONLY",
      });
      teams.push(team);
    }
    establishHomeFootballContext(db, countryPack("testland-v0"), "2030-03-01");
    return { db, teams };
  };

  it("resolves identity, money, calendar, national teams and names from its own pack", () => {
    const { db } = buildTestland();
    const context = homeFootballContext(db);
    expect(context).toMatchObject({ packId: "testland-v0", countryIso: "TLD", countryName: "Testland", currency: "TLC", locale: "en-GB", federationAbbreviation: "TFA" });
    expect(homeFederation(db).name).toBe("Testland Football Association");
    expect(isHomeFederation(db, homeFederation(db).id)).toBe(true);
    expect(seasonStartDate(db, 2030)).toBe("2030-03-01");
    expect(seasonEndDate(db, 2030)).toBe("2030-11-30");
    expect(seasonPeriodMonthsFor(db, 2030)).toEqual(["2030-03", "2030-04", "2030-05", "2030-06", "2030-07", "2030-08", "2030-09", "2030-10", "2030-11"]);
    expect(homeNationalTeams(db).map((team) => team.teamType)).toEqual(["SENIOR_MEN", "U20"]);
    expect(homeNamePool(db)).toBe(TESTLAND_NAMES);
    expect((db.prepare("SELECT COUNT(*) AS n FROM competition_tiers").get() as { n: number }).n).toBe(2);
    expect(db.prepare("SELECT tier FROM competition_tiers WHERE competition_id = ?").get(createStableEntityId("competition", "testland-second"))).toEqual({ tier: 2 });
    db.close();
  });

  it("an AI club hires a manager from Testland's names, in Testland, with Testland's language", () => {
    const { db, teams } = buildTestland();
    const managers = new ManagerRepository(db);
    let day = "2030-03-01";
    for (let step = 0; step < 120 && managers.allActiveContracts().length < teams.length; step += 1) {
      ensureAiManagersAssigned(db, { id: createStableEntityId("save", "tl"), name: "TL", worldDate: day, databaseVersion: 1, gameVersion: "test", randomSeed: "tl", createdAt: "2030-01-01T00:00:00.000Z", lastSavedAt: "2030-01-01T00:00:00.000Z" }, undefined);
      const next = new Date(`${day}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      day = next.toISOString().slice(0, 10);
    }
    expect(managers.allActiveContracts().length).toBe(teams.length);
    const people = db.prepare("SELECT full_name AS name, nationality_country_id AS country, languages_json AS languages FROM persons").all() as Array<{ name: string; country: string; languages: string }>;
    expect(people.length).toBeGreaterThan(0);
    for (const person of people) {
      expect(TESTLAND_NAMES.managerFullNames).toContain(person.name);
      expect(person.country).toBe(createStableEntityId("country", "TLD"));
      expect(JSON.parse(person.languages)).toEqual(["tl"]);
    }
    expect(new CareerWorldRepository(db).openVacancies()).toHaveLength(0);
    db.close();
  });
});
