import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TerritorialFootballRepository, WorldRepository, migrateDatabase, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  NEPAL_GEOGRAPHY,
  advanceTerritorialDevelopment,
  clubLocalityHubs,
  establishHomeFootballContext,
  founderLocationOptions,
  generateYouthCohort,
  homeLocationsOfKind,
  initializeTerritorialStructure,
  locationAncestry,
  nearestOfKind,
  nepalPack,
  owningCountryOf,
  presentClubLocation,
  registerCountryPack,
  seedGeographyLocations,
  type CountryPack,
  type PackGeography,
} from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 11J: administrative geography comes from the save's locations and the home pack's
 * geography. Nothing assumes Nepal's provinces, or that a country has provinces or districts at all.
 */

const memory = (): GameDatabase => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  return db;
};

const packFor = (packId: string, countryName: string, isoCode: string, geography?: PackGeography): CountryPack => ({
  packId,
  countryName,
  isoCodes: [isoCode],
  currency: "XXX",
  locale: "en-GB",
  federationAbbreviation: "FA",
  seasonRules: { seasonStart: "03-01", seasonEnd: "11-30", youthIntake: "03-15" },
  nationalTeams: [{ teamType: "SENIOR_MEN", level: "senior", gender: "men", label: "Senior Men", strengthMultiplier: 1 }],
  tierLabels: ["Premier"],
  namePool: nepalPack.namePool,
  geography,
});

const homeWorld = (pack: CountryPack, isoCode: string): { db: GameDatabase; countryId: EntityId } => {
  registerCountryPack(pack);
  const db = memory();
  const country = { id: createStableEntityId("country", `11j-${isoCode}`), name: pack.countryName, isoCode };
  const world = new WorldRepository(db);
  world.insertCountry(country);
  world.insertFederation({ id: createStableEntityId("federation", `11j-${isoCode}`), countryId: country.id, name: `${pack.countryName} FA` });
  establishHomeFootballContext(db, pack, "2026-08-01");
  return { db, countryId: country.id };
};

const place = (db: GameDatabase, countryId: EntityId, name: string, kind: string, parentId?: EntityId): EntityId => {
  const id = createStableEntityId("location", `11j-${countryId}-${kind}-${name}`);
  new WorldRepository(db).insertLocation({ id, countryId, name, kind: kind as never, parentLocationId: parentId });
  return id;
};

const count = (db: GameDatabase, sql: string): number => (db.prepare(sql).get() as { n: number }).n;

// A country that is not like Nepal: one province with districts, one whose cities sit directly under it.
const TESTLAND_GEOGRAPHY: PackGeography = {
  idNamespace: "testland",
  codePrefix: "TL",
  areas: [
    { name: "Uplands", kind: "province", children: [{ name: "Ridge", kind: "district", remote: true }, { name: "Vale", kind: "district" }] },
    { name: "Coast", kind: "province", children: [{ name: "Port Alba", kind: "city" }, { name: "Port Bel", kind: "city" }] },
  ],
  clubLocalityHubs: ["Ridge", "Port Alba"],
};

describe("Nepal's geography is pack data", () => {
  it("no production code refers to NEPAL_PROVINCE_DISTRICTS any more", () => {
    const dir = resolve("packages/simulation/src");
    const files = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(path, entry.name)) : entry.name.endsWith(".ts") ? [join(path, entry.name)] : []));
    const offenders = files(dir).filter((file) => readFileSync(file, "utf8").includes("NEPAL_PROVINCE_DISTRICTS"));
    expect(offenders).toEqual([]);
  });

  it("keeps the seven provinces, 77 districts and the chooser's order and ids", () => {
    const provinces = NEPAL_GEOGRAPHY.areas;
    expect(provinces.map((area) => area.name)).toEqual(["Koshi", "Madhesh", "Bagmati", "Gandaki", "Lumbini", "Karnali", "Sudurpashchim"]);
    expect(provinces.flatMap((area) => area.children ?? [])).toHaveLength(77);
    const options = founderLocationOptions({ geography: NEPAL_GEOGRAPHY, countryName: "Nepal" });
    expect(options).toHaveLength(77);
    expect(options[0]).toEqual({ id: createStableEntityId("location", "taplejung"), province: "Koshi", district: "Taplejung", locality: "Taplejung", provenanceStatus: "REPORTED" });
    expect(options.map((option) => option.district)).toEqual(provinces.flatMap((area) => (area.children ?? []).map((child) => child.name)));
  });

  it("builds the same territorial units and ids as before, and seeding is idempotent", () => {
    const { db } = homeWorld(nepalPack, "NP");
    const first = initializeTerritorialStructure(db, "2026-08-01");
    expect(first.provinces).toHaveLength(7);
    expect(first.districts).toHaveLength(77);
    const kaski = new TerritorialFootballRepository(db).district(createStableEntityId("nepal-district", "Kaski"));
    expect(kaski?.provinceId).toBe(createStableEntityId("nepal-province", "Gandaki"));
    expect(kaski?.remoteness).toBe(35);
    expect(new TerritorialFootballRepository(db).district(createStableEntityId("nepal-district", "Manang"))?.remoteness).toBe(80);
    seedGeographyLocations(db);
    const locations = count(db, "SELECT COUNT(*) AS n FROM locations");
    expect(locations).toBe(7 + 77);
    seedGeographyLocations(db);
    initializeTerritorialStructure(db, "2026-08-01");
    expect(count(db, "SELECT COUNT(*) AS n FROM locations")).toBe(locations);
    expect(new TerritorialFootballRepository(db).districts()).toHaveLength(77);
    const kaskiLocation = homeLocationsOfKind(db, "district").find((item) => item.name === "Kaski")!;
    expect(nearestOfKind(locationAncestry(db, kaskiLocation.id), "province")?.name).toBe("Gandaki");
    db.close();
  });
});

describe("a country whose hierarchy is not Nepal's", () => {
  it("gets its own places, and territorial units only where a district layer exists", () => {
    const { db, countryId } = homeWorld(packFor("testland-11j", "Testland", "TL", TESTLAND_GEOGRAPHY), "TL");
    seedGeographyLocations(db);
    const kinds = (db.prepare("SELECT kind, COUNT(*) AS n FROM locations GROUP BY kind ORDER BY kind").all() as Array<{ kind: string; n: number }>).map((row) => `${row.kind}:${row.n}`);
    expect(kinds).toEqual(["city:2", "district:2", "province:2"]);
    const port = homeLocationsOfKind(db, "city").find((item) => item.name === "Port Alba")!;
    expect(locationAncestry(db, port.id).map((node) => node.name)).toEqual(["Port Alba", "Coast"]);
    expect(owningCountryOf(db, port.id)).toBe(countryId);

    const state = initializeTerritorialStructure(db, "2027-03-01");
    expect(state.provinces.map((province) => province.name).sort()).toEqual(["Coast", "Uplands"]);
    expect(state.districts.map((district) => district.name).sort()).toEqual(["Ridge", "Vale"]);
    const coast = state.provinces.find((province) => province.name === "Coast")!;
    expect(coast.districtIds, "no district is made up for a province whose places are cities").toEqual([]);
    expect(state.districts.find((district) => district.name === "Ridge")?.remoteness).toBe(80);
    expect(state.districts[0]!.id).toBe(createStableEntityId("testland-district", state.districts[0]!.name));

    const again = initializeTerritorialStructure(db, "2027-03-01");
    expect(again.districts).toHaveLength(2);
    expect(again.provinces).toHaveLength(2);
    expect(founderLocationOptions({ geography: TESTLAND_GEOGRAPHY, countryName: "Testland" }).map((option) => `${option.province}/${option.district}`)).toEqual(["Uplands/Ridge", "Uplands/Vale"]);
    db.close();
  });

  it("with no province or district layer at all, territorial football simply does not start", () => {
    const flat: PackGeography = { idNamespace: "flat", codePrefix: "FL", areas: [{ name: "North", kind: "region", children: [{ name: "Alton", kind: "city" }, { name: "Brest", kind: "city" }] }] };
    const { db } = homeWorld(packFor("flatland-11j", "Flatland", "FL", flat), "FL");
    seedGeographyLocations(db);
    expect(homeLocationsOfKind(db, "region")).toHaveLength(1);
    expect(initializeTerritorialStructure(db, "2027-03-01")).toEqual({ districts: [], provinces: [] });
    expect(() => advanceTerritorialDevelopment(db, { date: "2027-08-01", seed: "11j" })).not.toThrow();
    expect(new TerritorialFootballRepository(db).districts()).toEqual([]);
    const options = founderLocationOptions({
      geography: flat,
      countryName: "Flatland",
      datasetLocations: [
        { key: "r", name: "North", kind: "region" },
        { key: "a", name: "Alton", kind: "city", parentKey: "r" },
        { key: "b", name: "Brest", kind: "city", parentKey: "r" },
      ],
    });
    expect(options.map((option) => `${option.province}/${option.district}`)).toEqual(["North/Alton", "North/Brest"]);
    db.close();
  });

  it("a pack with no geography builds territory from the save's own places and skips a district with no province", () => {
    const { db, countryId } = homeWorld(packFor("plain-11j", "Plainland", "PL"), "PL");
    const province = place(db, countryId, "Central", "province");
    const district = place(db, countryId, "Mid", "district", province);
    place(db, countryId, "Town", "city", district);
    place(db, countryId, "Orphan", "district");
    const state = initializeTerritorialStructure(db, "2027-03-01");
    expect(state.provinces.map((item) => item.name)).toEqual(["Central"]);
    expect(state.districts.map((item) => item.name)).toEqual(["Mid"]);
    expect(state.districts[0]!.locationId).toBe(district);
    db.close();
  });

  it("ancestry survives a missing parent and a cycle", () => {
    const { db, countryId } = homeWorld(packFor("plain-11j", "Plainland", "PL"), "PL");
    const a = place(db, countryId, "A", "district");
    const b = place(db, countryId, "B", "city", a);
    expect(locationAncestry(db, b).map((node) => node.name)).toEqual(["B", "A"]);
    db.prepare("UPDATE locations SET parent_location_id = ? WHERE id = ?").run(b, a);
    expect(locationAncestry(db, b).map((node) => node.name)).toEqual(["B", "A"]);
    db.prepare("PRAGMA foreign_keys = OFF").run();
    db.prepare("UPDATE locations SET parent_location_id = 'missing' WHERE id = ?").run(a);
    expect(locationAncestry(db, b).map((node) => node.name)).toEqual(["B", "A"]);
    expect(locationAncestry(db, undefined)).toEqual([]);
    expect(nearestOfKind(locationAncestry(db, b), "province")).toBeUndefined();
    db.close();
  });
});

describe("home-country geography in generation and display", () => {
  it("generated youth are born only in home-country places, deterministically", () => {
    const born = (): string[] => {
      const { db, countryId } = homeWorld(packFor("testland-11j", "Testland", "TL", TESTLAND_GEOGRAPHY), "TL");
      seedGeographyLocations(db);
      const abroad = createStableEntityId("country", "11j-abroad");
      new WorldRepository(db).insertCountry({ id: abroad, name: "Abroad", isoCode: "AB" });
      for (const name of ["Far", "Farther", "Farthest"]) place(db, abroad, name, "district");
      db.prepare("INSERT INTO clubs (id, name, country_id, ownership_type) VALUES ('yc', 'Youth Club', ?, 'PRIVATE')").run(countryId);
      db.prepare("INSERT INTO teams (id, club_id, name, level, gender) VALUES ('yt', 'yc', 'Youth Club Senior', 'senior', 'men')").run();
      generateYouthCohort({ db, countryId, clubId: "yc" as EntityId, teamId: "yt" as EntityId, date: "2027-03-15", seasonLabel: "2027", seed: "11j-youth", count: 40 });
      const rows = db.prepare("SELECT l.name AS place, l.country_id AS country FROM persons p JOIN locations l ON l.id = p.place_of_birth_location_id ORDER BY p.id").all() as Array<{ place: string; country: string }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.country).toBe(countryId);
      db.close();
      return rows.map((row) => row.place);
    };
    const first = born();
    expect(born()).toEqual(first);
  });

  it("a club with no recorded place is shown in one of the home pack's hubs, or honestly nowhere", () => {
    const { db, countryId } = homeWorld(packFor("testland-11j", "Testland", "TL", TESTLAND_GEOGRAPHY), "TL");
    expect(clubLocalityHubs(db)).toEqual(["Ridge", "Port Alba"]);
    db.prepare("INSERT INTO clubs (id, name, country_id, ownership_type) VALUES ('c1', 'Club One', ?, 'PRIVATE')").run(countryId);
    expect(presentClubLocation(db, "c1" as EntityId)).toMatch(/^(Ridge|Port Alba) \(estimated\)$/);
    expect(presentClubLocation(db, "c1" as EntityId)).toBe(presentClubLocation(db, "c1" as EntityId));
    const bare = homeWorld(packFor("bare-11j", "Bareland", "BL"), "BL");
    bare.db.prepare("INSERT INTO clubs (id, name, country_id, ownership_type) VALUES ('c2', 'Club Two', ?, 'PRIVATE')").run(bare.countryId);
    expect(presentClubLocation(bare.db, "c2" as EntityId)).toBe("Location not on record");
    db.close();
    bare.db.close();
  });
});
