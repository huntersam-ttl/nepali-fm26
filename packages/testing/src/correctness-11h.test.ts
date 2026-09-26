import { describe, expect, it } from "vitest";
import { InternationalFootballRepository, WorldRepository, migrateDatabase, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  INTERNATIONAL_COMPETITION_CONFIGS,
  competitionAppliesToHome,
  createInternationalCompetitionEdition,
  establishHomeFootballContext,
  findEngineCountry,
  homeCountryId,
  homeFederationId,
  initializeInternationalFootballForSave,
  internationalCompetitionConfig,
  nepalPack,
  registerCountryPack,
  scheduledCompetitions,
  type CountryPack,
  type InternationalCompetitionConfig,
} from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 11H: the international calendar is configuration. A home country enters the competitions
 * its own international profile is in scope for; no country's name is consulted.
 */

const memory = (): GameDatabase => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  return db;
};

const SENIOR = { teamType: "SENIOR_MEN", level: "senior", gender: "men", label: "Senior Men", strengthMultiplier: 1 } as const;
const packFor = (packId: string, countryName: string, isoCodes: string[], extra: Partial<CountryPack> = {}): CountryPack => ({
  packId,
  countryName,
  isoCodes,
  currency: "XXX",
  locale: "en-GB",
  federationAbbreviation: "FA",
  seasonRules: { seasonStart: "08-01", seasonEnd: "07-31", youthIntake: "08-15" },
  nationalTeams: [SENIOR],
  tierLabels: ["Premier"],
  namePool: nepalPack.namePool,
  ...extra,
});

const homeWorld = (pack: CountryPack, isoCode: string): GameDatabase => {
  registerCountryPack(pack);
  const db = memory();
  const world = new WorldRepository(db);
  const country = { id: createStableEntityId("country", `11h-${isoCode}`), name: pack.countryName, isoCode };
  world.insertCountry(country);
  world.insertFederation({ id: createStableEntityId("federation", `11h-${isoCode}`), countryId: country.id, name: `${pack.countryName} Football Association` });
  establishHomeFootballContext(db, pack, "2026-08-01");
  initializeInternationalFootballForSave({ db, worldDate: "2026-08-01", seed: "11h" });
  return db;
};

const keysFor = (db: GameDatabase, endYear: number): string[] =>
  scheduledCompetitions(endYear)
    .filter(({ config }) => competitionAppliesToHome(db, config))
    .map(({ config }) => config.key);

const nepalPackAllTeams = registerCountryPack({ ...nepalPack, packId: "nepal-11h" });

describe("the built-in calendar is data", () => {
  it("keeps every existing key, name and cycle", () => {
    expect(INTERNATIONAL_COMPETITION_CONFIGS.map((config) => [config.key, config.name])).toEqual([
      ["SAFF", "SAFF Championship"],
      ["SAFF_WOMEN", "SAFF Women's Championship"],
      ["SAFF_U23", "SAFF U23 Championship"],
      ["SAFF_U20", "SAFF U20 Championship"],
      ["SAFF_U17", "SAFF U17 Championship"],
      ["ASIAN_CUP_QUALIFICATION", "AFC Asian Cup Qualification"],
      ["AFC_WOMENS_ASIAN_CUP_QUALIFICATION", "AFC Women's Asian Cup Qualification"],
      ["ASIAN_CUP", "AFC Asian Cup"],
      ["AFC_WORLD_CUP_QUALIFICATION", "AFC World Cup Qualification"],
      ["WORLD_CUP", "World Championship"],
    ]);
    expect(() => internationalCompetitionConfig("NOT_A_KEY")).toThrow(/No international competition is configured/);
    const cycles = (year: number) => scheduledCompetitions(year).map(({ config, cycle, startDate }) => `${config.key}:${cycle}:${startDate}`);
    expect(cycles(2026)).toEqual(["SAFF:2026:2026-09-01", "SAFF_WOMEN:2026:2026-10-04", "SAFF_U23:2026:2026-07-07"]);
    expect(cycles(2027)).toEqual([
      "SAFF_U20:2027:2027-07-07",
      "SAFF_U17:2027:2027-10-04",
      "ASIAN_CUP_QUALIFICATION:2028:2027-03-20",
      "AFC_WOMENS_ASIAN_CUP_QUALIFICATION:2028:2027-05-20",
    ]);
    expect(cycles(2028)).toEqual(["SAFF:2028:2028-09-01", "SAFF_WOMEN:2028:2028-10-04", "SAFF_U23:2028:2028-07-07", "ASIAN_CUP:2028:2028-06-10"]);
    expect(cycles(2029)).toEqual(["SAFF_U20:2029:2029-07-07", "SAFF_U17:2029:2029-10-04", "AFC_WORLD_CUP_QUALIFICATION:2030:2029-10-08"]);
  });
});

describe("a home country in SAFF and AFC (Nepal)", () => {
  const db = homeWorld(nepalPackAllTeams, "NP");

  it("enters the regional, continental and qualifying competitions of its five teams", () => {
    expect(keysFor(db, 2026)).toEqual(["SAFF", "SAFF_WOMEN", "SAFF_U23"]);
    expect(keysFor(db, 2027)).toEqual(["SAFF_U20", "SAFF_U17", "ASIAN_CUP_QUALIFICATION", "AFC_WOMENS_ASIAN_CUP_QUALIFICATION"]);
    expect(keysFor(db, 2028)).toEqual(["SAFF", "SAFF_WOMEN", "SAFF_U23", "ASIAN_CUP"]);
    expect(keysFor(db, 2029)).toEqual(["SAFF_U20", "SAFF_U17", "AFC_WORLD_CUP_QUALIFICATION"]);
  });

  it("each competition is played by the team type it is configured for, and only that team takes part", () => {
    const repo = new InternationalFootballRepository(db);
    const women = createInternationalCompetitionEdition(db, { competitionKey: "SAFF_WOMEN", cycle: "2028", startDate: "2028-10-04", seed: "11h" });
    const participants = repo.participants(women.id).map((participant) => repo.teamProfile(participant.teamProfileId)!);
    expect(participants.every((profile) => profile.teamType === "SENIOR_WOMEN")).toBe(true);
    const home = participants.find((profile) => profile.countryId === homeCountryId(db));
    expect(home?.nationalTeamId).toBeTruthy();
    const team = db.prepare("SELECT federation_id AS f, gender FROM teams WHERE id = ?").get(home!.nationalTeamId!) as { f: string; gender: string };
    expect(team).toEqual({ f: homeFederationId(db), gender: "women" });
  });

  it("hosts follow the competition's policy: home for regional, Qatar for the Asian Cup, US for the world event, none for qualifiers", () => {
    const repo = new InternationalFootballRepository(db);
    const host = (key: string, cycle: string, start: string) => createInternationalCompetitionEdition(db, { competitionKey: key, cycle, startDate: start, seed: "11h" }).hostCountryIds;
    expect(host("SAFF", "2028", "2028-09-01")).toEqual([homeCountryId(db)]);
    expect(host("ASIAN_CUP", "2028", "2028-06-10")).toEqual([findEngineCountry(db, "QA")]);
    expect(host("WORLD_CUP", "2030", "2030-06-10")).toEqual([findEngineCountry(db, "US")]);
    expect(host("ASIAN_CUP_QUALIFICATION", "2028", "2027-03-20")).toEqual([]);
    expect(repo.competitions().map((competition) => competition.name)).toContain("SAFF Championship");
  });

  it("re-initialising and re-creating an edition changes nothing", () => {
    const repo = new InternationalFootballRepository(db);
    const before = { competitions: repo.competitions().length, editions: repo.editions().length, profiles: repo.teamProfiles().length };
    initializeInternationalFootballForSave({ db, worldDate: "2026-08-01", seed: "11h" });
    createInternationalCompetitionEdition(db, { competitionKey: "SAFF", cycle: "2028", startDate: "2028-09-01", seed: "11h" });
    expect({ competitions: repo.competitions().length, editions: repo.editions().length, profiles: repo.teamProfiles().length }).toEqual(before);
    expect(repo.competitions().map((competition) => competition.id)).toContain(createStableEntityId("international-competition", "SAFF"));
  });
});

describe("a home country in AFC but not in SAFF (Japan)", () => {
  const db = homeWorld(packFor("japan-11h", "Japan", ["JP"]), "JP");

  it("gets the AFC competitions and none of SAFF's", () => {
    expect(keysFor(db, 2026)).toEqual([]);
    expect(keysFor(db, 2027)).toEqual(["ASIAN_CUP_QUALIFICATION"]);
    expect(keysFor(db, 2028)).toEqual(["ASIAN_CUP"]);
    expect(keysFor(db, 2029)).toEqual(["AFC_WORLD_CUP_QUALIFICATION"]);
    for (let year = 2026; year < 2040; year += 1) expect(keysFor(db, year).some((key) => key.startsWith("SAFF"))).toBe(false);
  });

  it("enters its own national team, of its own federation and country, into the Asian Cup", () => {
    const repo = new InternationalFootballRepository(db);
    const edition = createInternationalCompetitionEdition(db, { competitionKey: "ASIAN_CUP", cycle: "2028", startDate: "2028-06-10", seed: "11h" });
    const profiles = repo.participants(edition.id).map((participant) => repo.teamProfile(participant.teamProfileId)!);
    const own = profiles.filter((profile) => profile.nationalTeamId);
    expect(own).toHaveLength(1);
    expect(own[0]!.countryId).toBe(homeCountryId(db));
    expect(own[0]!.name).toBe("Japan Senior Men");
    const team = db.prepare("SELECT federation_id AS f FROM teams WHERE id = ?").get(own[0]!.nationalTeamId!) as { f: string };
    expect(team.f).toBe(homeFederationId(db));
    expect(profiles.every((profile) => profile.confederation === "AFC")).toBe(true);
  });
});

describe("selection reads the home profile, not the country's name", () => {
  const profile = { strength: 40, reputation: 40, development: 40, homeAdvantage: 1.05, populationTalentBase: 40 };

  it("an unknown country whose profile says SAFF gets SAFF; one that says UEFA gets nothing of AFC", () => {
    const inSaff = homeWorld(packFor("zedland-11h", "Zedland", ["ZL"], { internationalProfile: { confederation: "AFC", region: "SAFF", ...profile } }), "ZL");
    expect(keysFor(inSaff, 2028)).toEqual(["SAFF", "ASIAN_CUP"]);
    const inEurope = homeWorld(packFor("ordland-11h", "Ordland", ["OL"], { internationalProfile: { confederation: "UEFA", region: "EUROPE", ...profile } }), "OL");
    for (let year = 2026; year < 2040; year += 1) expect(keysFor(inEurope, year)).toEqual([]);
  });

  it("a team type the structure lacks, or one the simulation does not play, enters no competition", () => {
    const db = homeWorld(
      packFor("futsalia-11h", "Futsalia", ["FS"], {
        internationalProfile: { confederation: "AFC", region: "SAFF", ...profile },
        nationalTeams: [SENIOR, { teamType: "FUTSAL", level: "futsal", gender: "men", label: "Futsal Men", strengthMultiplier: 0.7 }],
      }),
      "FS",
    );
    const futsal: InternationalCompetitionConfig = { ...internationalCompetitionConfig("SAFF"), key: "SAFF_FUTSAL", teamType: "FUTSAL" };
    expect(competitionAppliesToHome(db, futsal)).toBe(false);
    const women = internationalCompetitionConfig("SAFF_WOMEN");
    expect(competitionAppliesToHome(db, women), "a structure without a women's team").toBe(false);
    expect(new InternationalFootballRepository(db).teamProfiles().some((item) => item.teamType === "FUTSAL")).toBe(false);
  });
});
