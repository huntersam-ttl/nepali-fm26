import { describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  establishHomeFootballContext,
  initializeClubFinanceMarkets,
  nepalPack,
  registerCountryPack,
  type CountryPack,
} from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

/* Phase 11J: club lenders are country-pack data, not a Nepal-only simulation constant. */

const testlandPack: CountryPack = {
  packId: "testland-11j",
  countryName: "Testland",
  isoCodes: ["TL"],
  currency: "TLC",
  locale: "en-GB",
  federationAbbreviation: "TFA",
  seasonRules: { seasonStart: "03-01", seasonEnd: "11-30", youthIntake: "03-15" },
  nationalTeams: [
    {
      teamType: "SENIOR_MEN",
      level: "senior",
      gender: "men",
      label: "Senior Men",
      strengthMultiplier: 1,
    },
  ],
  tierLabels: ["Premier"],
  namePool: nepalPack.namePool,
  lenders: [
    {
      name: "Testland Community Bank",
      institutionType: "COMMERCIAL_BANK",
      sourceUrl: "test://testland-bank",
      status: "SIMULATION_ONLY",
    },
  ],
};

const databaseFor = (pack: CountryPack, suffix: string) => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  const world = new WorldRepository(db);
  const country = {
    id: createStableEntityId("country", `11j-${suffix}`),
    name: pack.countryName,
    isoCode: pack.isoCodes[0]!,
  };
  world.insertCountry(country);
  world.insertFederation({
    id: createStableEntityId("federation", `11j-${suffix}`),
    countryId: country.id,
    name: `${pack.countryName} FA`,
  });
  establishHomeFootballContext(db, pack, "2030-03-01");
  return { db, country };
};

describe("country-pack club lenders", () => {
  it("keeps Nepal's five canonical lenders and stable lender IDs", () => {
    expect(nepalPack.lenders?.map((lender) => lender.name)).toEqual([
      "Nabil Bank Limited",
      "Nepal Bank Limited",
      "Agriculture Development Bank Limited",
      "Himalayan Bank Limited",
      "Muktinath Bikas Bank Limited",
    ]);
    expect(
      nepalPack.lenders?.map((lender) => createStableEntityId("club-lender", lender.name)),
    ).toHaveLength(5);
  });

  it("seeds only the selected second-country pack's lenders", () => {
    registerCountryPack(testlandPack);
    const { db } = databaseFor(testlandPack, "testland");

    const lenders = initializeClubFinanceMarkets(db);
    expect(lenders.map((lender) => lender.name)).toEqual(["Testland Community Bank"]);
    expect(lenders[0]).toMatchObject({
      countryId: expect.any(String),
      institutionType: "COMMERCIAL_BANK",
    });
    expect(lenders.some((lender) => lender.name.includes("Nepal"))).toBe(false);
    db.close();
  });

  it("does not invent Nepal lenders for an unsupported pack and preserves legacy rows", () => {
    const unsupportedPack = {
      ...testlandPack,
      packId: "testland-11j-unsupported",
      lenders: undefined,
    };
    registerCountryPack(unsupportedPack);
    const { db, country } = databaseFor(unsupportedPack, "unsupported");
    const economy = new ClubEconomyRepository(db);
    economy.upsertLender({
      id: createStableEntityId("club-lender", "legacy-lender"),
      countryId: country.id,
      name: "Legacy Testland Bank",
      institutionType: "COMMERCIAL_BANK",
      sourceUrl: "legacy://testland-bank",
      status: "SIMULATION_ONLY",
    });

    expect(initializeClubFinanceMarkets(db).map((lender) => lender.name)).toEqual([
      "Legacy Testland Bank",
    ]);
    db.close();
  });
});
