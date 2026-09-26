import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CountryCodeError,
  CountryCodeRepository,
  InternationalFootballRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  ensureEngineCountry,
  establishHomeFootballContext,
  homeCountryId,
  initializeInternationalFootballForSave,
  nepalPack,
  registerCountryPack,
  type CountryPack,
} from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 11F: one country has one row, however many code systems name it. countries.iso_code keeps
 * the code a row was created with; country_codes holds the rest; one resolver reads both.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterAll(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })));

const memory = (): GameDatabase => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  return db;
};

const addCountry = (db: GameDatabase, name: string, isoCode: string) => {
  const country = { id: createStableEntityId("country", `11f-${isoCode}`), name, isoCode };
  new WorldRepository(db).insertCountry(country);
  return country;
};

const count = (db: GameDatabase, sql: string): number => (db.prepare(sql).get() as { n: number }).n;

const testlandPack: CountryPack = {
  packId: "testland-11f",
  countryName: "Testland",
  isoCodes: ["TL", "TST"],
  internationalProfile: { confederation: "AFC", region: "GLOBAL", strength: 40, reputation: 40, development: 40, homeAdvantage: 1.05, populationTalentBase: 40 },
  currency: "TLC",
  locale: "en-GB",
  federationAbbreviation: "TFA",
  seasonRules: { seasonStart: "03-01", seasonEnd: "11-30", youthIntake: "03-15" },
  nationalTeams: [{ teamType: "SENIOR_MEN", level: "senior", gender: "men", label: "Senior Men", strengthMultiplier: 1 }],
  tierLabels: ["Premier"],
  namePool: nepalPack.namePool,
};

describe("one country, several codes", () => {
  it("resolves the stored code and every registered alias to the same country id", () => {
    const db = memory();
    const testland = addCountry(db, "Testland", "TL");
    const other = addCountry(db, "Otherland", "OL");
    const codes = new CountryCodeRepository(db);
    expect(codes.addAlias({ countryId: testland.id, code: "TST", system: "ISO_ALPHA3", source: "test" })).toBe(true);
    expect(codes.addAlias({ countryId: testland.id, code: "TSL", system: "FIFA" })).toBe(true);
    for (const code of ["TL", "tl", "TST", "TSL", " tst "]) expect(codes.resolveByCode(code)).toBe(testland.id);
    expect(codes.resolveByCode("OL")).toBe(other.id);
    expect(codes.resolveByCode("ZZ")).toBeUndefined();
    expect(codes.resolveByAnyCode(["ZZ", "TSL", "OL"])).toBe(testland.id);
    expect(codes.aliases(testland.id).map((alias) => `${alias.system}:${alias.code}`)).toEqual(["FIFA:TSL", "ISO_ALPHA3:TST"]);
    expect(codes.addAlias({ countryId: testland.id, code: "TST", system: "ISO_ALPHA3" })).toBe(false);
    expect(codes.addAlias({ countryId: testland.id, code: "TL", system: "ISO_ALPHA2" }), "the stored code needs no alias").toBe(false);
    expect(count(db, "SELECT COUNT(*) AS n FROM country_codes")).toBe(2);
    db.close();
  });

  it("refuses a code that would name two countries", () => {
    const db = memory();
    const a = addCountry(db, "Alpha", "AA");
    const b = addCountry(db, "Beta", "BB");
    const codes = new CountryCodeRepository(db);
    codes.addAlias({ countryId: a.id, code: "SHARED", system: "DATASET" });
    expect(() => codes.addAlias({ countryId: b.id, code: "shared", system: "FIFA" })).toThrow(CountryCodeError);
    expect(() => codes.addAlias({ countryId: b.id, code: "AA", system: "FIFA" }), "another country's stored code").toThrow(CountryCodeError);
    expect(codes.addAliasIfFree({ countryId: b.id, code: "SHARED", system: "FIFA" })).toBe(false);
    expect(() => db.prepare("INSERT INTO country_codes (country_id, code, code_system) VALUES (?, 'SHARED', 'DATASET')").run(b.id)).toThrow();
    db.prepare("INSERT INTO country_codes (country_id, code, code_system) VALUES (?, 'SHARED', 'FIFA')").run(b.id);
    expect(() => codes.resolveByCode("SHARED"), "raw rows that conflict are reported, not guessed").toThrow(/ambiguous/);
    db.close();
  });

  it("resolves by exact name only when the name is unique", () => {
    const db = memory();
    addCountry(db, "Alpha", "AA");
    const codes = new CountryCodeRepository(db);
    expect(codes.resolveByExactName("alpha")).toBeDefined();
    expect(codes.resolveByExactName("Alph")).toBeUndefined();
    db.prepare("INSERT INTO countries (id, name, iso_code) VALUES ('dup', 'Alpha', 'AB')").run();
    expect(() => codes.resolveByExactName("Alpha")).toThrow(CountryCodeError);
    db.close();
  });
});

describe("the registry reuses a country stored under another code", () => {
  registerCountryPack(testlandPack);

  const buildWorld = (): GameDatabase => {
    const db = memory();
    const testland = addCountry(db, "Testland", "TL");
    new WorldRepository(db).insertFederation({ id: createStableEntityId("federation", "11f-tfa"), countryId: testland.id, name: "Testland FA" });
    establishHomeFootballContext(db, testlandPack, "2030-03-01");
    return db;
  };

  it("India stored as IND is not duplicated by the registry's IN, and is initialised idempotently", () => {
    const db = buildWorld();
    const india = addCountry(db, "India", "IND");
    const uae = addCountry(db, "United Arab Emirates", "ARE");
    initializeInternationalFootballForSave({ db, worldDate: "2030-03-01", seed: "11f" });

    expect(count(db, "SELECT COUNT(*) AS n FROM countries WHERE name = 'India'")).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM countries WHERE iso_code = 'IN'")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS n FROM countries WHERE name = 'United Arab Emirates'")).toBe(1);
    const profiles = new InternationalFootballRepository(db).teamProfiles();
    expect(profiles.some((profile) => profile.countryId === india.id)).toBe(true);
    expect(profiles.some((profile) => profile.countryId === uae.id)).toBe(true);
    expect(new CountryCodeRepository(db).resolveByCode("IN")).toBe(india.id);

    const before = { countries: count(db, "SELECT COUNT(*) AS n FROM countries"), aliases: count(db, "SELECT COUNT(*) AS n FROM country_codes"), profiles: profiles.length };
    initializeInternationalFootballForSave({ db, worldDate: "2030-03-01", seed: "11f" });
    expect(count(db, "SELECT COUNT(*) AS n FROM countries")).toBe(before.countries);
    expect(count(db, "SELECT COUNT(*) AS n FROM country_codes")).toBe(before.aliases);
    expect(new InternationalFootballRepository(db).teamProfiles().length).toBe(before.profiles);
    db.close();
  });

  it("a country the world does not have is created once, with its codes recorded", () => {
    const db = buildWorld();
    initializeInternationalFootballForSave({ db, worldDate: "2030-03-01", seed: "11f" });
    const row = db.prepare("SELECT id, iso_code FROM countries WHERE name = 'Japan'").all() as Array<{ id: string; iso_code: string }>;
    expect(row).toHaveLength(1);
    expect(row[0]!.iso_code).toBe("JP");
    expect(new CountryCodeRepository(db).resolveByCode("JPN")).toBe(row[0]!.id);
    expect(ensureEngineCountry(db, { isoAlpha2: "JP", name: "Japan" })).toBe(row[0]!.id);
    db.close();
  });

  it("a save that already holds both IN and IND keeps both and resolves each to its own row", () => {
    const db = buildWorld();
    const two = addCountry(db, "India", "IN");
    const three = addCountry(db, "India", "IND");
    initializeInternationalFootballForSave({ db, worldDate: "2030-03-01", seed: "11f" });
    const codes = new CountryCodeRepository(db);
    expect(codes.resolveByCode("IN")).toBe(two.id);
    expect(codes.resolveByCode("IND")).toBe(three.id);
    expect(count(db, "SELECT COUNT(*) AS n FROM countries WHERE name = 'India'")).toBe(2);
    db.close();
  });
});

describe("a Nepal save", () => {
  let savePath = "";
  beforeAll(() => {
    const directory = mkdtempSync(join(tmpdir(), "correctness-11f-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const created = service.createCareer({
      saveName: "correctness-11f",
      character: {
        fullName: "Identity Tester",
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

  it("keeps Nepal's row and id, resolves NP and NPL to it, and duplicates no country after initialisation", () => {
    const db = openGameDatabase(savePath);
    migrateDatabase(db);
    try {
      const nepalId = homeCountryId(db)!;
      const codes = new CountryCodeRepository(db);
      expect(codes.resolveByCode("NP")).toBe(nepalId);
      expect(codes.resolveByCode("NPL")).toBe(nepalId);
      initializeInternationalFootballForSave({ db, worldDate: "2026-08-01", seed: "11f" });
      initializeInternationalFootballForSave({ db, worldDate: "2026-08-01", seed: "11f" });
      expect(homeCountryId(db)).toBe(nepalId);
      expect(codes.resolveByCode("NP")).toBe(nepalId);
      expect(count(db, "SELECT COUNT(*) AS n FROM (SELECT lower(name) FROM countries GROUP BY lower(name) HAVING COUNT(*) > 1)")).toBe(0);
      expect(count(db, "SELECT COUNT(*) AS n FROM teams WHERE club_id IS NULL AND name LIKE 'Nepal %'")).toBe(5);
    } finally {
      db.close();
    }
  });
});
