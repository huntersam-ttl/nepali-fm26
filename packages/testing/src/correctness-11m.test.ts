import { describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  establishHomeFootballContext,
  homeEconomicProfile,
  initializeClubEconomyForSave,
  nepalPack,
  registerCountryPack,
  type CountryPack,
} from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

/* Phase 11M: nominal economic calibration is country-pack data, not currency display. */

const testlandPack: CountryPack = {
  ...nepalPack,
  packId: "testland-11m",
  countryName: "Testland",
  isoCodes: ["TL"],
  currency: "TLC",
  federationAbbreviation: "TFA",
  economicProfile: {
    wageScale: 1.8,
    transferScale: 2.2,
    consumerPriceScale: 1.4,
    infrastructureScale: 1.6,
  },
};

const databaseFor = (pack: CountryPack, suffix: string) => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  const world = new WorldRepository(db);
  const countryId = createStableEntityId("country", `11m-${suffix}`);
  world.insertCountry({ id: countryId, name: pack.countryName, isoCode: pack.isoCodes[0]! });
  world.insertFederation({
    id: createStableEntityId("federation", `11m-${suffix}`),
    countryId,
    name: `${pack.countryName} FA`,
  });
  world.insertClub({
    id: createStableEntityId("club", `11m-${suffix}`),
    name: `${pack.countryName} United`,
    countryId,
    ownershipType: "PRIVATE",
  });
  establishHomeFootballContext(db, pack, "2030-03-01");
  return db;
};

describe("country-pack economic calibration", () => {
  it("keeps Nepal neutral and independent from currency display", () => {
    const db = databaseFor(nepalPack, "nepal");
    expect(homeEconomicProfile(db)).toEqual({
      wageScale: 1,
      transferScale: 1,
      consumerPriceScale: 1,
      infrastructureScale: 1,
    });
    expect(nepalPack.currency).toBe("NPR");
    db.close();
  });

  it("applies independent calibration only to newly generated domestic values", () => {
    registerCountryPack(testlandPack);
    const neutralPack = {
      ...testlandPack,
      packId: "testland-11m-neutral-comparison",
      economicProfile: undefined,
    };
    registerCountryPack(neutralPack);
    const db = databaseFor(testlandPack, "testland");
    const neutralDb = databaseFor(neutralPack, "testland");
    initializeClubEconomyForSave({ db, worldDate: "2030-03-01", seed: "11m" });
    initializeClubEconomyForSave({ db: neutralDb, worldDate: "2030-03-01", seed: "11m" });
    const economy = new ClubEconomyRepository(db);
    const neutralEconomy = new ClubEconomyRepository(neutralDb);
    const clubId = economy.financialAccounts()[0]!.clubId;
    const wage = economy.budgets(clubId).find((budget) => budget.category === "WAGE_BUDGET")!;
    const neutralWage = neutralEconomy
      .budgets(clubId)
      .find((budget) => budget.category === "WAGE_BUDGET")!;
    const transfer = economy
      .budgets(clubId)
      .find((budget) => budget.category === "TRANSFER_BUDGET")!;
    const neutralTransfer = neutralEconomy
      .budgets(clubId)
      .find((budget) => budget.category === "TRANSFER_BUDGET")!;
    const ticketPrice = economy.supporterProfile(clubId)!.standardTicketPrice;
    const neutralTicketPrice = neutralEconomy.supporterProfile(clubId)!.standardTicketPrice;
    const facility = economy.facilityProfile(clubId)!;
    const neutralFacility = neutralEconomy.facilityProfile(clubId)!;
    expect(Math.abs(wage.amount - neutralWage.amount * 1.8)).toBeLessThanOrEqual(1);
    expect(Math.abs(transfer.amount - neutralTransfer.amount * 2.2)).toBeLessThanOrEqual(1);
    expect(Math.abs(ticketPrice - neutralTicketPrice * 1.4)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(facility.monthlyOperatingCost - neutralFacility.monthlyOperatingCost * 1.6),
    ).toBeLessThanOrEqual(1);
    expect(wage.currency).toBe("TLC");
    expect(homeEconomicProfile(db)).toEqual(testlandPack.economicProfile);
    db.close();
    neutralDb.close();
  });

  it("uses neutral defaults for unsupported packs and preserves existing generated rows", () => {
    const unsupportedPack = {
      ...testlandPack,
      packId: "testland-11m-neutral",
      economicProfile: undefined,
    };
    registerCountryPack(unsupportedPack);
    const db = databaseFor(unsupportedPack, "neutral");
    expect(homeEconomicProfile(db)).toEqual({
      wageScale: 1,
      transferScale: 1,
      consumerPriceScale: 1,
      infrastructureScale: 1,
    });
    initializeClubEconomyForSave({ db, worldDate: "2030-03-01", seed: "11m-neutral" });
    const economy = new ClubEconomyRepository(db);
    const before = economy.budgets()[0]!;
    initializeClubEconomyForSave({ db, worldDate: "2030-03-02", seed: "different" });
    expect(economy.budgets()[0]).toEqual(before);
    expect(economy.budgets()).toHaveLength(7);
    db.close();
  });
});
