import { describe, expect, it } from "vitest";
import { CountryCodeRepository, WorldRepository, migrateDatabase, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  LEGACY_CORRIDOR_DESTINATIONS,
  LEGACY_CORRIDOR_KEYS,
  MARKET_REGIONS,
  MARKET_REGION_COUNTRIES,
  countryToRecruitmentRegion,
  establishHomeFootballContext,
  evaluateForeignRecruitmentCorridor,
  homeMarketRegion,
  isoAlpha2Of,
  marketRegionForCode,
  marketRegionForCountry,
  marketRegionsByCountry,
  nepalPack,
  registerCountryPack,
  sameCountryIdentity,
  type CountryPack,
} from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 11I: market geography follows country identity. A country is placed in a market region
 * by any of its codes, the home country is whichever country the save is played in, and a
 * recruitment corridor ends at "the home country", never at a named one.
 */

const memory = (): GameDatabase => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  return db;
};

const addCountry = (db: GameDatabase, name: string, isoCode: string) => {
  const country = { id: createStableEntityId("country", `11i-${isoCode}`), name, isoCode };
  new WorldRepository(db).insertCountry(country);
  return country;
};

const packFor = (packId: string, countryName: string, isoCodes: string[]): CountryPack => ({
  packId,
  countryName,
  isoCodes,
  currency: "XXX",
  locale: "en-GB",
  federationAbbreviation: "FA",
  seasonRules: { seasonStart: "08-01", seasonEnd: "07-31", youthIntake: "08-15" },
  nationalTeams: [{ teamType: "SENIOR_MEN", level: "senior", gender: "men", label: "Senior Men", strengthMultiplier: 1 }],
  tierLabels: ["Premier"],
  namePool: nepalPack.namePool,
});

const homeIn = (pack: CountryPack, isoCode: string, name: string) => {
  registerCountryPack(pack);
  const db = memory();
  const country = addCountry(db, name, isoCode);
  new WorldRepository(db).insertFederation({ id: createStableEntityId("federation", `11i-${isoCode}`), countryId: country.id, name: `${name} FA` });
  establishHomeFootballContext(db, pack, "2026-08-01");
  return { db, country };
};

describe("one market region per country, whatever its code", () => {
  it("lists each country once, by ISO alpha-2, and pairs the alpha-3 form through country identity", () => {
    const listed = MARKET_REGIONS.flatMap((region) => MARKET_REGION_COUNTRIES[region]);
    expect(new Set(listed).size).toBe(listed.length);
    for (const code of listed) expect(code).toMatch(/^[A-Z]{2}$/);
    for (const [alpha2, alpha3, region] of [["NP", "NPL", "SOUTH_ASIA"], ["IN", "IND", "SOUTH_ASIA"], ["AE", "ARE", "MIDDLE_EAST"], ["NG", "NGA", "AFRICA"], ["DE", "DEU", "EUROPE"]] as const) {
      expect(marketRegionForCode(alpha2)).toBe(region);
      expect(marketRegionForCode(alpha3)).toBe(region);
      expect(marketRegionForCode(alpha3.toLowerCase())).toBe(region);
      expect(isoAlpha2Of(alpha3)).toBe(alpha2);
      expect(countryToRecruitmentRegion(alpha3)).toBe(region);
    }
  });

  it("IN and IND, stored either way or as an alias, are one classification", () => {
    const db = memory();
    const stored = addCountry(db, "India", "IND");
    const twoLetter = addCountry(db, "India (registry)", "IN");
    const bharat = addCountry(db, "Bharat", "X-BHARAT");
    expect(marketRegionForCountry(db, stored.id)).toBe("SOUTH_ASIA");
    expect(marketRegionForCountry(db, twoLetter.id)).toBe("SOUTH_ASIA");
    expect(marketRegionForCountry(db, bharat.id), "no code the market map knows yet").toBeUndefined();
    new CountryCodeRepository(db).addAlias({ countryId: bharat.id, code: "BD", system: "ISO_ALPHA2" });
    expect(marketRegionForCountry(db, bharat.id)).toBe("SOUTH_ASIA");
    db.close();
  });

  it("a synthetic country's alias is enough to place it, and its rows resolve in one pass", () => {
    const db = memory();
    const testland = addCountry(db, "Testland", "TESTLAND-1");
    const other = addCountry(db, "Otherland", "OL");
    expect(marketRegionForCountry(db, testland.id)).toBeUndefined();
    new CountryCodeRepository(db).addAlias({ countryId: testland.id, code: "JP", system: "ISO_ALPHA2" });
    expect(marketRegionForCountry(db, testland.id)).toBe("WIDER_ASIA");
    const all = marketRegionsByCountry(db);
    expect(all.get(testland.id)).toBe("WIDER_ASIA");
    expect(all.has(other.id)).toBe(false);
    expect(marketRegionsByCountry(db)).toEqual(all);
    db.close();
  });

  it("an unclassified country has no region and is not taken for the home country", () => {
    const { db, country } = homeIn(packFor("nepal-11i", "Nepal", ["NPL", "NP"]), "NP", "Nepal");
    const unknown = addCountry(db, "Nowhere", "X-NOWHERE");
    expect(marketRegionForCountry(db, unknown.id)).toBeUndefined();
    expect(marketRegionForCode("ZZ")).toBeUndefined();
    expect(marketRegionForCode(undefined)).toBeUndefined();
    expect(marketRegionForCountry(db, undefined)).toBeUndefined();
    expect(sameCountryIdentity(db, unknown.id, country.id)).toBe(false);
    db.close();
  });
});

describe("the home country decides what is domestic", () => {
  it("Nepal as home: NP and NPL are the same country, in the South Asia market", () => {
    registerCountryPack(nepalPack);
    const db = memory();
    const nepal = addCountry(db, "Nepal", "NP");
    new WorldRepository(db).insertFederation({ id: createStableEntityId("federation", "11i-np"), countryId: nepal.id, name: "ANFA" });
    establishHomeFootballContext(db, nepalPack, "2026-08-01");
    const npl = addCountry(db, "Nepal (import)", "NPL");
    expect(homeMarketRegion(db)).toBe("SOUTH_ASIA");
    expect(sameCountryIdentity(db, nepal.id, npl.id)).toBe(true);
    db.close();
  });

  it("changing the home country changes the home market and nothing else", () => {
    const nepal = homeIn(packFor("nepal-11i", "Nepal", ["NPL", "NP"]), "NP", "Nepal");
    const japan = homeIn(packFor("japan-11i", "Japan", ["JP"]), "JP", "Japan");
    const testland = homeIn(packFor("testland-11i", "Testland", ["TL"]), "TL", "Testland");
    expect(homeMarketRegion(nepal.db)).toBe("SOUTH_ASIA");
    expect(homeMarketRegion(japan.db)).toBe("WIDER_ASIA");
    expect(homeMarketRegion(testland.db), "an unclassified home country has no home region").toBeUndefined();
    // The same foreign nation keeps its own classification under every home country.
    for (const { db } of [nepal, japan, testland]) {
      const germany = addCountry(db, "Germany", "DE");
      expect(marketRegionForCountry(db, germany.id)).toBe("EUROPE");
      db.close();
    }
  });
});

describe("recruitment corridors end at the home country", () => {
  const base = { playerReputation: 55, clubReputation: 45, scoutingReach: 60 };

  it("Africa to the home country is one corridor, whichever country is home", () => {
    const toHome = evaluateForeignRecruitmentCorridor({ ...base, sourceRegion: "AFRICA", destinationRegion: "HOME_COUNTRY" });
    expect(toHome.corridor).toEqual({ sourceRegion: "AFRICA", destination: "HOME_COUNTRY", key: "AFRICA_TO_HOME_COUNTRY" });
    expect(toHome.score).toBeCloseTo(55 * 0.35 + 45 * 0.25 + 60 * 0.25 + 16, 10);
    expect(toHome.eligible).toBe(true);
  });

  it("the legacy Nepal destination reads as the home country, and old keys map to the new ones", () => {
    const legacy = evaluateForeignRecruitmentCorridor({ ...base, sourceRegion: "AFRICA", destinationRegion: "NEPAL" });
    const current = evaluateForeignRecruitmentCorridor({ ...base, sourceRegion: "AFRICA", destinationRegion: "HOME_COUNTRY" });
    expect(legacy).toEqual(current);
    expect(LEGACY_CORRIDOR_DESTINATIONS.NEPAL).toBe("HOME_COUNTRY");
    expect(LEGACY_CORRIDOR_KEYS.AFRICA_TO_NEPAL).toBe(current.corridor.key);
  });

  it("the home region's own corridor is the region the home country is in", () => {
    const asia = evaluateForeignRecruitmentCorridor({ ...base, sourceRegion: "WIDER_ASIA", destinationRegion: "HOME_COUNTRY", homeRegion: "WIDER_ASIA" });
    expect(asia.corridor.key).toBe("HOME_REGION");
    expect(asia.score).toBeCloseTo(55 * 0.35 + 45 * 0.25 + 60 * 0.25 + 12, 10);
    const none = evaluateForeignRecruitmentCorridor({ ...base, sourceRegion: "WIDER_ASIA", destinationRegion: "HOME_COUNTRY" });
    expect(none.corridor.key).toBe("GENERAL");
    expect(evaluateForeignRecruitmentCorridor({ ...base, sourceRegion: "EUROPE", destinationRegion: "WIDER_ASIA" }).corridor.key).toBe("HOME_COUNTRY_TO_WIDER_ASIA");
  });
});

describe("classification is deterministic", () => {
  it("repeated lookups give the same answer and write nothing", () => {
    const { db, country } = homeIn(packFor("nepal-11i", "Nepal", ["NPL", "NP"]), "NP", "Nepal");
    const before = (db.prepare("SELECT COUNT(*) AS n FROM country_codes").get() as { n: number }).n;
    const results = [1, 2, 3].map(() => [marketRegionForCountry(db, country.id), homeMarketRegion(db), [...marketRegionsByCountry(db)]]);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM country_codes").get() as { n: number }).n).toBe(before);
    db.close();
  });
});
