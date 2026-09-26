import { describe, expect, it } from "vitest";
import { ClubEconomyRepository, WorldRepository, migrateDatabase, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  NEUTRAL_ECONOMIC_PROFILE,
  clubLoanCeilings,
  computeAttendanceDemand,
  countryEconomicProfile,
  createInfrastructureProject,
  establishHomeFootballContext,
  estimateSalaryExpectation,
  initializeClubEconomyForSave,
  initializeFederationGovernanceForSave,
  nepalPack,
  registerCountryPack,
  resolveEconomicProfile,
  scaleAmount,
  scalePrice,
  scaleTicketPrice,
  scaleWage,
  type CountryPack,
  type PackEconomy,
} from "@nepal-football-sim/simulation";
import { FederationGovernanceRepository } from "@nepal-football-sim/database";
import { createStableEntityId, type EntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 11L: money scale by country. A pack's economy says how large football money is there
 * (1 = the launch calibration). It applies to newly generated amounts only, and it changes nothing
 * but money: abilities, reputations, attendance and identities are the same at any level.
 */

const memory = (): GameDatabase => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  return db;
};

const packFor = (packId: string, economy: PackEconomy | undefined): CountryPack => ({
  packId,
  countryName: "Testland",
  isoCodes: ["TL"],
  currency: "TLC",
  locale: "en-GB",
  federationAbbreviation: "TFA",
  seasonRules: { seasonStart: "08-01", seasonEnd: "07-31", youthIntake: "08-15" },
  nationalTeams: [{ teamType: "SENIOR_MEN", level: "senior", gender: "men", label: "Senior Men", strengthMultiplier: 1 }],
  tierLabels: ["Premier"],
  namePool: nepalPack.namePool,
  economy,
});

// The same country, club and seed under a pack with the given economy.
const world = (economy: PackEconomy | undefined, packId = `testland-11l-${JSON.stringify(economy ?? "none")}`) => {
  const pack = packFor(packId, economy);
  registerCountryPack(pack);
  const db = memory();
  const country = { id: createStableEntityId("country", "11l-TL"), name: "Testland", isoCode: "TL" };
  const worldRepo = new WorldRepository(db);
  worldRepo.insertCountry(country);
  worldRepo.insertFederation({ id: createStableEntityId("federation", "11l-tfa"), countryId: country.id, name: "Testland FA" });
  worldRepo.insertClub({ id: createStableEntityId("club", "11l-club"), name: "Testland FC", countryId: country.id, ownershipType: "PRIVATE" });
  establishHomeFootballContext(db, pack, "2026-08-01");
  return { db, pack, clubId: createStableEntityId("club", "11l-club") as EntityId };
};

const generate = (economy: PackEconomy | undefined) => {
  const w = world(economy);
  initializeClubEconomyForSave({ db: w.db, worldDate: "2026-08-01", seed: "11l" });
  initializeFederationGovernanceForSave({ db: w.db, worldDate: "2026-08-01", seed: "11l" });
  const repo = new ClubEconomyRepository(w.db);
  const account = repo.financialAccount(w.clubId)!;
  const budgets = Object.fromEntries(repo.budgets(w.clubId).map((budget) => [budget.category, budget.amount]));
  const supporter = repo.supporterProfile(w.clubId)!;
  const facility = repo.facilityProfile(w.clubId)!;
  const commercial = repo.commercialProfile(w.clubId)!;
  const federation = new FederationGovernanceRepository(w.db).financialAccount(
    (w.db.prepare("SELECT id FROM federations").get() as { id: EntityId }).id,
  )!;
  return { ...w, account, budgets, supporter, facility, commercial, federation };
};

describe("the economic profile", () => {
  it("is neutral without a pack economy, and the launch calibration is 1", () => {
    expect(resolveEconomicProfile(undefined)).toEqual(NEUTRAL_ECONOMIC_PROFILE);
    expect(resolveEconomicProfile({ priceLevel: 1 })).toEqual({ priceLevel: 1, wageLevel: 1, ticketPriceLevel: 1 });
    expect(nepalPack.economy).toEqual({ priceLevel: 1, wageLevel: 1, ticketPriceLevel: 1 });
    const { db } = world(undefined);
    expect(countryEconomicProfile(db)).toEqual(NEUTRAL_ECONOMIC_PROFILE);
    db.close();
  });

  it("wages and tickets follow the price level unless the pack says otherwise; bad levels are ignored", () => {
    expect(resolveEconomicProfile({ priceLevel: 2 })).toEqual({ priceLevel: 2, wageLevel: 2, ticketPriceLevel: 2 });
    expect(resolveEconomicProfile({ priceLevel: 2, wageLevel: 3, ticketPriceLevel: 0.5 })).toEqual({ priceLevel: 2, wageLevel: 3, ticketPriceLevel: 0.5 });
    expect(resolveEconomicProfile({ priceLevel: 0 })).toEqual(NEUTRAL_ECONOMIC_PROFILE);
    expect(resolveEconomicProfile({ priceLevel: Number.NaN, wageLevel: -1 })).toEqual(NEUTRAL_ECONOMIC_PROFILE);
  });

  it("scales deterministically, in whole minor units, and leaves level 1 untouched", () => {
    expect(scaleAmount(1, 123.456)).toBe(123.456);
    expect(scaleAmount(2, 250)).toBe(500);
    expect(scaleAmount(1.5, 333)).toBe(500);
    expect(scaleAmount(0.25, 999)).toBe(250);
    for (const level of [0.3, 1.7, 2, 9.99]) for (const amount of [1, 17, 250_001, 4_200_000]) {
      expect(Number.isInteger(scaleAmount(level, amount))).toBe(true);
      expect(scaleAmount(level, amount)).toBe(scaleAmount(level, amount));
    }
    const { db } = world({ priceLevel: 2, wageLevel: 3, ticketPriceLevel: 4 });
    expect([scalePrice(db, 1000), scaleWage(db, 1000), scaleTicketPrice(db, 1000)]).toEqual([2000, 3000, 4000]);
    db.close();
  });
});

describe("a 2x country against the launch calibration, everything else equal", () => {
  const base = generate({ priceLevel: 1 });
  const twice = generate({ priceLevel: 2 });
  const none = generate(undefined);

  it("a pack without an economy generates exactly what level 1 does", () => {
    expect(none.account).toEqual(base.account);
    expect(none.budgets).toEqual(base.budgets);
    expect(none.supporter).toEqual(base.supporter);
    expect(none.facility).toEqual(base.facility);
    expect(none.federation.cashBalance).toBe(base.federation.cashBalance);
  });

  it("scales opening cash, budgets, ticket price and operating cost", () => {
    expect(twice.account.cashBalance).toBe(2 * base.account.cashBalance);
    expect(twice.account.debtBalance).toBe(2 * base.account.debtBalance);
    for (const category of Object.keys(base.budgets)) expect(Math.abs(twice.budgets[category]! - 2 * base.budgets[category]!)).toBeLessThanOrEqual(1);
    expect(twice.supporter.standardTicketPrice).toBe(2 * base.supporter.standardTicketPrice);
    expect(twice.facility.monthlyOperatingCost).toBe(2 * base.facility.monthlyOperatingCost);
    expect(twice.federation.cashBalance).toBe(2 * base.federation.cashBalance);
  });

  it("changes nothing but money", () => {
    const withoutMoney = <T extends object>(row: T, key: keyof T): Partial<T> => {
      const copy = { ...row };
      delete copy[key];
      return copy;
    };
    expect(withoutMoney(twice.supporter, "standardTicketPrice")).toEqual(withoutMoney(base.supporter, "standardTicketPrice"));
    expect(withoutMoney(twice.facility, "monthlyOperatingCost")).toEqual(withoutMoney(base.facility, "monthlyOperatingCost"));
    expect(twice.commercial).toEqual(base.commercial);
    expect(twice.account.financialHealth).toBe(base.account.financialHealth);
    expect(twice.account.restrictedCash).toBeGreaterThan(0);
    expect(twice.account.currency).toBe(base.account.currency);
    expect(twice.federation.financialHealth).toBe(base.federation.financialHealth);
  });

  it("scales an infrastructure project's cost and a loan's floors", () => {
    const cost = (w: typeof base) => createInfrastructureProject(w.db, { clubId: w.clubId, projectType: "TRAINING_GROUND", date: "2026-09-01", seed: "11l", dryRun: true }).capitalCost;
    expect(cost(base)).toBeGreaterThan(0);
    expect(Math.abs(cost(twice) - 2 * cost(base))).toBeLessThanOrEqual(2);
    expect(clubLoanCeilings(0, 0, 2).maxNewPrincipal).toBe(2 * clubLoanCeilings(0, 0).maxNewPrincipal);
    expect(clubLoanCeilings(10_000_000, 0, 2).maxNewPrincipal, "a large valuation is not floored").toBe(clubLoanCeilings(10_000_000, 0).maxNewPrincipal);
  });

  it("scales a wage expectation by role, licence and reputation alike", () => {
    for (const role of ["HEAD_COACH", "SCOUT", "PHYSIO"] as const) {
      expect(estimateSalaryExpectation(role, [], "HIGH", 2)).toBe(2 * estimateSalaryExpectation(role, [], "HIGH", 1));
    }
    expect(estimateSalaryExpectation("HEAD_COACH", [], "HIGH")).toBeGreaterThan(estimateSalaryExpectation("HEAD_COACH", [], "LOW"));
  });

  it("does not change attendance when ticket price and its reference scale together", () => {
    const demand = (price: number, reference: number) =>
      computeAttendanceDemand({
        matchgoingBase: 3000, seasonTicketBase: 800, passion: 60, loyalty: 55, matchgoingCulture: 50, familyAttendance: 40, homeMood: 50,
        awayMatchgoingBase: 500, awaySupport: 20, ticketPrice: price, referenceTicketPrice: reference, capacity: 20000,
      }).attendance;
    expect(demand(500, 500)).toBe(demand(250, 250));
    expect(demand(500, 250), "a fan who pays twice the ordinary price is put off").toBeLessThan(demand(250, 250));
  });
});

describe("amounts already in a save are never rescaled", () => {
  it("does not rewrite an existing club's money when the country's economy changes", () => {
    const w = world({ priceLevel: 1 }, "testland-11l-persist");
    initializeClubEconomyForSave({ db: w.db, worldDate: "2026-08-01", seed: "11l" });
    const repo = new ClubEconomyRepository(w.db);
    const before = { account: repo.financialAccount(w.clubId), budgets: repo.budgets(w.clubId), supporter: repo.supporterProfile(w.clubId) };
    const richer = packFor("testland-11l-persist-richer", { priceLevel: 5 });
    registerCountryPack(richer);
    establishHomeFootballContext(w.db, richer, "2026-08-01");
    initializeClubEconomyForSave({ db: w.db, worldDate: "2026-08-01", seed: "11l" });
    expect({ account: repo.financialAccount(w.clubId), budgets: repo.budgets(w.clubId), supporter: repo.supporterProfile(w.clubId) }).toEqual(before);
    w.db.close();
  });
});
