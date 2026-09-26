import { describe, expect, it } from "vitest";
import {
  FederationGovernanceRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  createFederationProject,
  establishHomeFootballContext,
  getFederationFinances,
  homeEconomicProfile,
  initializeFederationGovernanceForSave,
  nepalPack,
  postFederationTransaction,
  processFederationMonth,
  receiveFederationGrant,
  registerCountryPack,
  runCoachEducationProgramme,
  type CountryPack,
} from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

/* Phase 11O: federation nominal values are country-pack calibration, not club economics. */

const testlandPack: CountryPack = {
  ...nepalPack,
  packId: "testland-11o",
  countryName: "Testland",
  isoCodes: ["TL"],
  currency: "TLC",
  federationAbbreviation: "TFA",
  economicProfile: {
    wageScale: 1,
    transferScale: 1,
    consumerPriceScale: 1,
    infrastructureScale: 1,
    federationBudgetScale: 1.8,
    federationProjectCostScale: 2.4,
  },
};

const unsupportedPack: CountryPack = {
  ...testlandPack,
  packId: "testland-11o-neutral",
  economicProfile: undefined,
};

const databaseFor = (pack: CountryPack) => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  const world = new WorldRepository(db);
  const countryId = createStableEntityId("country", "11o-country");
  const federationId = createStableEntityId("federation", "11o-federation");
  world.insertCountry({ id: countryId, name: pack.countryName, isoCode: pack.isoCodes[0]! });
  world.insertFederation({ id: federationId, countryId, name: `${pack.countryName} FA` });
  establishHomeFootballContext(db, pack, "2030-03-01");
  return { db, federationId };
};

describe("country-pack federation economic calibration", () => {
  it("keeps Nepal and unsupported packs on neutral federation defaults", () => {
    registerCountryPack(unsupportedPack);
    const nepal = databaseFor(nepalPack);
    const unsupported = databaseFor(unsupportedPack);
    expect(homeEconomicProfile(nepal.db).federationBudgetScale ?? 1).toBe(1);
    expect(homeEconomicProfile(nepal.db).federationProjectCostScale ?? 1).toBe(1);
    initializeFederationGovernanceForSave({ db: nepal.db, worldDate: "2030-03-01", seed: "11o" });
    initializeFederationGovernanceForSave({
      db: unsupported.db,
      worldDate: "2030-03-01",
      seed: "11o",
    });
    expect(getFederationFinances(nepal.db, nepal.federationId).account.cashBalance).toBe(
      getFederationFinances(unsupported.db, unsupported.federationId).account.cashBalance,
    );
    nepal.db.close();
    unsupported.db.close();
  });

  it("calibrates federation budgets and projects independently of club economics", () => {
    registerCountryPack(testlandPack);
    registerCountryPack(unsupportedPack);
    const calibrated = databaseFor(testlandPack);
    const neutral = databaseFor(unsupportedPack);
    initializeFederationGovernanceForSave({
      db: calibrated.db,
      worldDate: "2030-03-01",
      seed: "11o",
    });
    initializeFederationGovernanceForSave({ db: neutral.db, worldDate: "2030-03-01", seed: "11o" });
    const calibratedAccount = getFederationFinances(calibrated.db, calibrated.federationId).account;
    const neutralAccount = getFederationFinances(neutral.db, neutral.federationId).account;
    expect(calibratedAccount.cashBalance / neutralAccount.cashBalance).toBeCloseTo(1.8, 2);
    const calibratedBudget = new FederationGovernanceRepository(calibrated.db).budgets(
      calibrated.federationId,
    )[0]!;
    const neutralBudget = new FederationGovernanceRepository(neutral.db).budgets(
      neutral.federationId,
    )[0]!;
    expect(calibratedBudget.amount / neutralBudget.amount).toBeCloseTo(1.8, 2);

    const calibratedProject = createFederationProject(calibrated.db, {
      federationId: calibrated.federationId,
      projectType: "NATIONAL_TRAINING_CENTRE",
      name: "National Centre",
      date: "2030-03-01",
      seed: "same-project",
    });
    const neutralProject = createFederationProject(neutral.db, {
      federationId: neutral.federationId,
      projectType: "NATIONAL_TRAINING_CENTRE",
      name: "National Centre",
      date: "2030-03-01",
      seed: "same-project",
    });
    expect(calibratedProject.capitalCost / neutralProject.capitalCost).toBeCloseTo(2.4, 2);

    const calibratedCourse = runCoachEducationProgramme(calibrated.db, {
      federationId: calibrated.federationId,
      licenceLevel: "AFC B",
      startDate: "2030-04-01",
      seed: "same-course",
      capacity: 10,
    });
    const neutralCourse = runCoachEducationProgramme(neutral.db, {
      federationId: neutral.federationId,
      licenceLevel: "AFC B",
      startDate: "2030-04-01",
      seed: "same-course",
      capacity: 10,
    });
    expect(calibratedCourse.cost / neutralCourse.cost).toBeCloseTo(1.8, 2);
    calibrated.db.close();
    neutral.db.close();
  });

  it("does not rescale explicit or persisted federation ledger values", () => {
    registerCountryPack(testlandPack);
    const calibrated = databaseFor(testlandPack);
    initializeFederationGovernanceForSave({
      db: calibrated.db,
      worldDate: "2030-03-01",
      seed: "11o",
    });
    const grant = receiveFederationGrant(calibrated.db, {
      federationId: calibrated.federationId,
      date: "2030-04-01",
      source: "FIFA_GRANT",
      amount: 123456,
    });
    const entry = postFederationTransaction(calibrated.db, {
      federationId: calibrated.federationId,
      date: "2030-04-02",
      category: "ADMINISTRATION",
      direction: "DEBIT",
      amount: 654321,
      description: "Persisted federation test expense",
      idempotencyKey: "11o-persisted-expense",
    });
    const before = getFederationFinances(calibrated.db, calibrated.federationId);
    initializeFederationGovernanceForSave({
      db: calibrated.db,
      worldDate: "2030-04-03",
      seed: "different",
    });
    const after = getFederationFinances(calibrated.db, calibrated.federationId);
    expect(after.ledgerEntries.find((item) => item.id === grant.id)?.amount).toBe(123456);
    expect(after.ledgerEntries.find((item) => item.id === entry.id)?.amount).toBe(654321);
    expect(after.ledgerEntries).toEqual(before.ledgerEntries);
    expect(after.account).toEqual(before.account);
    calibrated.db.close();
  });

  it("calibrates generated annual grant inflows exactly once", () => {
    registerCountryPack(testlandPack);
    registerCountryPack(unsupportedPack);
    const calibrated = databaseFor(testlandPack);
    const neutral = databaseFor(unsupportedPack);
    processFederationMonth(calibrated.db, { date: "2030-02-28", seed: "11o-grant" });
    processFederationMonth(neutral.db, { date: "2030-02-28", seed: "11o-grant" });
    const calibratedGrant = getFederationFinances(
      calibrated.db,
      calibrated.federationId,
    ).ledgerEntries.find((entry) => entry.category === "FIFA_GRANT")!;
    const neutralGrant = getFederationFinances(neutral.db, neutral.federationId).ledgerEntries.find(
      (entry) => entry.category === "FIFA_GRANT",
    )!;
    expect(calibratedGrant.amount / neutralGrant.amount).toBeCloseTo(1.8, 2);
    calibrated.db.close();
    neutral.db.close();
  });
});
