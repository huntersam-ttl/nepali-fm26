import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InternationalFootballRepository, WorldRepository, migrateDatabase, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  SIMULATED_NATIONAL_TEAM_TYPES,
  establishHomeFootballContext,
  homeCountryId,
  homeFederationId,
  homeIsoCodes,
  initializeInternationalFootballForSave,
  isSimulatedNationalTeamType,
  nationalTeamIdentities,
  nepalPack,
  registerCountryPack,
  type CountryPack,
} from "@nepal-football-sim/simulation";
import { createStableEntityId, type NationalTeamType } from "@nepal-football-sim/shared-types";

/*
 * Phase 11E: national teams and the international registry derive from the save's home country.
 * Nepal is unchanged; a synthetic second country exercises the same generic paths.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterAll(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })));

const testlandPack: CountryPack = {
  packId: "testland-11e",
  countryName: "Testland",
  isoCodes: ["TL"],
  nationalTeamCodePrefix: "TST",
  internationalProfile: { confederation: "AFC", region: "GLOBAL", strength: 40, reputation: 40, development: 40, homeAdvantage: 1.05, populationTalentBase: 40 },
  currency: "TLC",
  locale: "en-GB",
  federationAbbreviation: "TFA",
  seasonRules: { seasonStart: "03-01", seasonEnd: "11-30", youthIntake: "03-15" },
  nationalTeams: [
    { teamType: "SENIOR_MEN", level: "senior", gender: "men", label: "Senior Men", strengthMultiplier: 1 },
    { teamType: "U20", level: "u20", gender: "men", label: "U20 Men", strengthMultiplier: 0.86 },
    { teamType: "FUTSAL", level: "futsal", gender: "men", label: "Futsal Men", strengthMultiplier: 0.7 },
  ],
  tierLabels: ["Premier"],
  namePool: nepalPack.namePool,
};

describe("national-team identities come from the country", () => {
  it("builds team rows from a country name, code prefix and definitions", () => {
    const rows = nationalTeamIdentities({ federationId: createStableEntityId("federation", "x"), countryName: "Testland", codePrefix: "TST", definitions: testlandPack.nationalTeams });
    expect(rows.map((row) => row.name)).toEqual(["Testland Senior Men", "Testland U20 Men", "Testland Futsal Men"]);
    expect(rows.map((row) => row.canonicalExternalId)).toEqual(["TST-NT-SENIOR-MEN", "TST-NT-U20-MEN", "TST-NT-FUTSAL-MEN"]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
  });

  it("the simulation names the categories it can play; unknown ones are data only", () => {
    expect([...SIMULATED_NATIONAL_TEAM_TYPES]).toEqual(["SENIOR_MEN", "SENIOR_WOMEN", "U23", "U20", "U17"]);
    const future: NationalTeamType = "FUTSAL";
    expect(isSimulatedNationalTeamType(future)).toBe(false);
    expect(isSimulatedNationalTeamType("U20")).toBe(true);
  });
});

describe("a Nepal save", () => {
  let savePath = "";
  beforeAll(() => {
    const directory = mkdtempSync(join(tmpdir(), "correctness-11e-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    const created = service.createCareer({
      saveName: "correctness-11e",
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
    withDb((db) => initializeInternationalFootballForSave({ db, worldDate: "2026-08-01", seed: "11e" }));
  }, 120000);

  const withDb = <T,>(run: (db: GameDatabase) => T): T => {
    const db = openGameDatabase(savePath);
    migrateDatabase(db);
    try {
      return run(db);
    } finally {
      db.close();
    }
  };

  it("resolves home from the stored ISO code (NP) without needing NPL", () => {
    withDb((db) => {
      const row = db.prepare("SELECT iso_code AS iso FROM countries WHERE id = ?").get(homeCountryId(db)!) as { iso: string };
      expect(row.iso).toBe("NP");
      expect(homeIsoCodes(db)).toContain("NP");
    });
  });

  it("has exactly the five home national teams, linked to the home federation, named from the country row", () => {
    withDb((db) => {
      const teams = db
        .prepare("SELECT name, canonical_external_id AS code, level, gender FROM teams WHERE federation_id = ? AND club_id IS NULL ORDER BY name")
        .all(homeFederationId(db)) as Array<{ name: string; code: string; level: string; gender: string }>;
      expect(teams.map((team) => team.name)).toEqual(["Nepal Senior Men", "Nepal Senior Women", "Nepal U17 Men", "Nepal U20 Men", "Nepal U23 Men"]);
      expect(teams.map((team) => team.code).sort()).toEqual(["NEP-NT-SENIOR-MEN", "NEP-NT-SENIOR-WOMEN", "NEP-NT-U17-MEN", "NEP-NT-U20-MEN", "NEP-NT-U23-MEN"]);
      const country = db.prepare("SELECT c.name FROM federations f JOIN countries c ON c.id = f.country_id WHERE f.id = ?").get(homeFederationId(db)) as { name: string };
      expect(teams.every((team) => team.name.startsWith(country.name))).toBe(true);
    });
  });

  it("has an international profile for each supported team type, all linked to home teams", () => {
    withDb((db) => {
      const profiles = new InternationalFootballRepository(db).teamProfiles().filter((profile) => profile.countryId === homeCountryId(db));
      expect(profiles.map((profile) => profile.teamType).sort()).toEqual(["SENIOR_MEN", "SENIOR_WOMEN", "U17", "U20", "U23"]);
      for (const profile of profiles) {
        expect(profile.nationalTeamId).toBeTruthy();
        expect(profile.name).toBe(`Nepal ${{ SENIOR_MEN: "Senior Men", SENIOR_WOMEN: "Senior Women", U23: "U23 Men", U20: "U20 Men", U17: "U17 Men" }[profile.teamType as string]}`);
      }
    });
  });
});

describe("a synthetic second home country", () => {
  registerCountryPack(testlandPack);

  it("initialises its own national teams and registry entry, and ignores categories it cannot simulate", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const country = { id: createStableEntityId("country", "TL"), name: "Testland", isoCode: "TL" };
    world.insertCountry(country);
    const federationId = createStableEntityId("federation", "tfa");
    world.insertFederation({ id: federationId, countryId: country.id, name: "Testland Football Association" });
    const abroad = { id: createStableEntityId("country", "XL"), name: "Otherland", isoCode: "XL" };
    world.insertCountry(abroad);
    const abroadFederation = createStableEntityId("federation", "ofa");
    world.insertFederation({ id: abroadFederation, countryId: abroad.id, name: "Otherland Football Association" });
    establishHomeFootballContext(db, testlandPack, "2030-03-01");

    initializeInternationalFootballForSave({ db, worldDate: "2030-03-01", seed: "11e" });

    const teams = db.prepare("SELECT name, canonical_external_id AS code FROM teams WHERE federation_id = ? ORDER BY name").all(federationId) as Array<{ name: string; code: string }>;
    expect(teams.map((team) => team.name)).toEqual(["Testland Futsal Men", "Testland Senior Men", "Testland U20 Men"]);
    expect(teams.map((team) => team.code)).toContain("TST-NT-SENIOR-MEN");

    const profiles = new InternationalFootballRepository(db).teamProfiles().filter((profile) => profile.countryId === country.id);
    expect(profiles.map((profile) => profile.teamType).sort()).toEqual(["SENIOR_MEN", "U20"]);
    expect(profiles.map((profile) => profile.name).sort()).toEqual(["Testland Senior Men", "Testland U20 Men"]);
    expect(profiles.every((profile) => profile.nationalTeamId)).toBe(true);
    expect(homeCountryId(db)).toBe(country.id);
    const foreign = db.prepare("SELECT name, canonical_external_id AS code FROM teams WHERE federation_id = ? AND level = 'senior'").get(abroadFederation) as { name: string; code: string };
    expect(foreign).toEqual({ name: "Otherland Senior Men", code: "XL-NT-SENIOR-MEN" });
    db.close();
  });
});
