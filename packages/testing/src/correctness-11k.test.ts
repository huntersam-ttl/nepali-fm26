import { describe, expect, it } from "vitest";
import { ClubEconomyRepository, MediaPhaseBRepository, MediaRepository, WorldRepository, migrateDatabase, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  NEPAL_COMMERCIAL,
  NEPAL_MEDIA,
  establishHomeFootballContext,
  initializeClubFinanceMarkets,
  initializeFederationGovernanceForSave,
  initializeMediaForSave,
  initializeMediaJournalists,
  nepalPack,
  publishMediaForDate,
  registerCountryPack,
  seedSponsorPool,
  type CountryPack,
} from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 11K: banks, sponsors and media outlets are country-pack data. The economy still decides
 * reputations, tiers and contracts; the pack only says who exists. A pack that lists none has none.
 */

const memory = (): GameDatabase => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  return db;
};

const packFor = (packId: string, countryName: string, isoCode: string, extra: Partial<CountryPack> = {}): CountryPack => ({
  packId,
  countryName,
  isoCodes: [isoCode],
  currency: "XXX",
  locale: "en-GB",
  federationAbbreviation: "FA",
  seasonRules: { seasonStart: "08-01", seasonEnd: "07-31", youthIntake: "08-15" },
  nationalTeams: [{ teamType: "SENIOR_MEN", level: "senior", gender: "men", label: "Senior Men", strengthMultiplier: 1 }],
  tierLabels: ["Premier"],
  namePool: nepalPack.namePool,
  ...extra,
});

const initialise = (pack: CountryPack, isoCode: string): { db: GameDatabase; countryId: EntityId } => {
  registerCountryPack(pack);
  const db = memory();
  const country = { id: createStableEntityId("country", `11k-${isoCode}`), name: pack.countryName, isoCode };
  const world = new WorldRepository(db);
  world.insertCountry(country);
  world.insertFederation({ id: createStableEntityId("federation", `11k-${isoCode}`), countryId: country.id, name: `${pack.countryName} FA` });
  establishHomeFootballContext(db, pack, "2026-08-01");
  run(db);
  return { db, countryId: country.id };
};

const run = (db: GameDatabase): void => {
  seedSponsorPool(db, "2026-08-01", "11k");
  initializeClubFinanceMarkets(db);
  initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "11k" });
  initializeMediaForSave(db);
  initializeMediaJournalists(db);
};

const snapshot = (db: GameDatabase) => {
  const economy = new ClubEconomyRepository(db);
  return {
    sponsors: economy.sponsors().map((sponsor) => [sponsor.id, sponsor.name, sponsor.industry, sponsor.countryId, sponsor.identityProvenance, sponsor.sourceUrl, sponsor.reputation, sponsor.budgetTier]),
    lenders: economy.lenders().map((lender) => [lender.id, lender.name, lender.countryId, lender.institutionType]),
    outlets: new MediaRepository(db).outlets().map((outlet) => [outlet.id, outlet.name, outlet.scope]),
    journalists: new MediaPhaseBRepository(db).journalists().map((journalist) => [journalist.id, journalist.name, journalist.outletId]),
  };
};

const NEPAL_NAMES = [...(NEPAL_COMMERCIAL.sponsors ?? []).map((s) => s.name), ...(NEPAL_COMMERCIAL.lenders ?? []).map((l) => l.name), ...(NEPAL_COMMERCIAL.federationSponsors ?? []).map((s) => s.name), ...(NEPAL_MEDIA.outlets ?? []).map((o) => o.name), ...(NEPAL_MEDIA.journalists ?? []).map((j) => j.name)];

describe("Nepal's commercial and media identities are unchanged", () => {
  const { db, countryId } = initialise(nepalPack, "NP");

  it("has the same sponsors, banks, outlets and journalists, with the same stable ids", () => {
    const state = snapshot(db);
    const sponsorNames = state.sponsors.map((row) => row[1]);
    expect(sponsorNames).toEqual(expect.arrayContaining(["Nabil Bank Limited", "Nepal Telecom", "Ncell Axiata Limited", "Nepal Airlines Corporation", "Chaudhary Group", "Bagmati Community Foods", "Koshi Digital", "Lumbini Travel Cooperative", "Kathmandu Youth Education", "Everest Health Clinics", "Nepal Football Development Partner", "Himal Broadcast Network", "Regional Sports Education Trust"]));
    expect(state.sponsors).toHaveLength(16);
    expect(state.sponsors.find((row) => row[1] === "Nepal Telecom")![0]).toBe(createStableEntityId("sponsor-organisation", "Nepal Telecom"));
    expect(state.lenders.map((row) => row[1]).sort()).toEqual(["Agriculture Development Bank Limited", "Himalayan Bank Limited", "Muktinath Bikas Bank Limited", "Nabil Bank Limited", "Nepal Bank Limited"]);
    expect(state.lenders[0]![0]).toBe(createStableEntityId("club-lender", state.lenders[0]![1] as string));
    expect(state.outlets.map((row) => row[1]).sort()).toEqual(["ANFA Federation Bulletin", "Club Media Channel", "Kathmandu Football Desk", "Nepal Football Business Desk", "Nepal Football News", "South Asia Football Review"]);
    expect(state.outlets.find((row) => row[1] === "Nepal Football News")![0]).toBe(createStableEntityId("media-outlet", "Nepal Football News"));
    expect(state.journalists.map((row) => row[1]).sort()).toEqual(["Asha Shrestha", "Mina Rai", "Rijan Gurung"]);
    expect(state.journalists.find((row) => row[1] === "Mina Rai")![0]).toBe(createStableEntityId("media-journalist", "Mina Rai"));
  });

  it("links every sponsor and bank to the home country", () => {
    const state = snapshot(db);
    for (const row of state.sponsors) expect(row[3]).toBe(countryId);
    for (const row of state.lenders) expect(row[2]).toBe(countryId);
  });

  it("does not duplicate anything when initialised again", () => {
    const before = snapshot(db);
    run(db);
    expect(snapshot(db)).toEqual(before);
  });
});

describe("a second country has its own identities and none of Nepal's", () => {
  const testland = packFor("testland-11k", "Testland", "TL", {
    commercial: {
      lenders: [{ name: "Bank of Testland", institutionType: "COMMERCIAL_BANK", status: "SIMULATION_ONLY" }],
      sponsors: [
        { name: "Testco Telecom", industry: "Telecommunications", identityProvenance: "SIMULATION_ONLY" },
        { name: "Tessera Foods", industry: "Food and beverage", identityProvenance: "SIMULATION_ONLY" },
      ],
      federationSponsors: [{ name: "Testland Football Partner", industry: "Development services" }],
    },
    media: {
      outlets: [
        { name: "Testland Sports Daily", scope: "NATIONAL", reputation: 6, reach: 6, bias: "NEUTRAL", style: "WIRE", status: "SIMULATION_ONLY" },
        { name: "Tess FM Football", scope: "LOCAL", reputation: 4, reach: 3, bias: "CLUB_FOCUSED", style: "TABLOID", status: "SIMULATION_ONLY" },
      ],
      journalists: [{ name: "Ada Tester", beat: "Domestic football", temperament: "NEUTRAL", reputation: 6, status: "SIMULATION_ONLY" }],
    },
  });
  const { db, countryId } = initialise(testland, "TL");

  it("creates exactly the pack's entities, linked to the home country", () => {
    const state = snapshot(db);
    expect(state.sponsors.map((row) => row[1]).sort()).toEqual(["Tessera Foods", "Testco Telecom", "Testland Football Partner"]);
    for (const row of state.sponsors) expect(row[3]).toBe(countryId);
    expect(state.lenders.map((row) => [row[1], row[2]])).toEqual([["Bank of Testland", countryId]]);
    expect(state.outlets.map((row) => row[1]).sort()).toEqual(["Tess FM Football", "Testland Sports Daily"]);
    expect(state.journalists.map((row) => row[1])).toEqual(["Ada Tester"]);
  });

  it("leaks no Nepal name, and repeating initialisation changes nothing", () => {
    const state = JSON.stringify(snapshot(db));
    for (const name of NEPAL_NAMES) expect(state).not.toContain(name);
    const before = snapshot(db);
    run(db);
    expect(snapshot(db)).toEqual(before);
  });
});

describe("a country with no commercial or media data", () => {
  const { db } = initialise(packFor("bare-11k", "Bareland", "BL"), "BL");

  it("has none, and does not fall back to Nepal's", () => {
    expect(snapshot(db)).toEqual({ sponsors: [], lenders: [], outlets: [], journalists: [] });
  });

  it("publishes no stories and does not fail", () => {
    expect(publishMediaForDate(db, { date: "2026-09-01" })).toEqual([]);
    expect(initializeMediaJournalists(db)).toEqual([]);
    run(db);
    expect(snapshot(db)).toEqual({ sponsors: [], lenders: [], outlets: [], journalists: [] });
  });
});
