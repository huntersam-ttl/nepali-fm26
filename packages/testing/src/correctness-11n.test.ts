import { describe, expect, it } from "vitest";
import {
  TransferMarketRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  assessFreeAgentSigning,
  calculateTransferValuation,
  establishHomeFootballContext,
  homeEconomicProfile,
  initializeTransferMarketForSave,
  nepalPack,
  registerCountryPack,
  type CountryPack,
} from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

/* Phase 11N: transfer-market nominal values are country-pack calibration, not Nepal branches. */

const testlandPack: CountryPack = {
  ...nepalPack,
  packId: "testland-11n",
  countryName: "Testland",
  isoCodes: ["TL"],
  currency: "TLC",
  federationAbbreviation: "TFA",
  economicProfile: {
    wageScale: 1.8,
    transferScale: 2.2,
    consumerPriceScale: 1.4,
    infrastructureScale: 1.6,
    playerMarketValueScale: 1.7,
    playerWageScale: 1.9,
  },
};

const unsupportedPack: CountryPack = {
  ...testlandPack,
  packId: "testland-11n-neutral",
  economicProfile: undefined,
};

const databaseFor = (pack: CountryPack) => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  const world = new WorldRepository(db);
  const countryId = createStableEntityId("country", "11n-country");
  const federationId = createStableEntityId("federation", "11n-federation");
  const clubId = createStableEntityId("club", "11n-club");
  const playerId = createStableEntityId("person", "11n-player");
  world.insertCountry({ id: countryId, name: pack.countryName, isoCode: pack.isoCodes[0]! });
  world.insertFederation({ id: federationId, countryId, name: `${pack.countryName} FA` });
  world.insertClub({
    id: clubId,
    name: `${pack.countryName} United`,
    countryId,
    ownershipType: "PRIVATE",
  });
  world.insertPerson({
    id: playerId,
    fullName: "Calibration Player",
    dateOfBirth: "2000-01-01",
    nationalityCountryId: countryId,
    languages: ["en"],
  });
  db.prepare(
    `INSERT INTO player_factual_profiles
      (id, player_id, canonical_external_id, current_club_id, factual_json, simulation_json,
       evidence_json, record_status, confidence_level, last_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    createStableEntityId("player-factual-profile", "11n-player"),
    playerId,
    "SIM-11N-PLAYER",
    clubId,
    JSON.stringify({
      nameVariants: ["Calibration Player"],
      factualSecondaryPositions: [],
      previousClubs: [],
    }),
    JSON.stringify({
      simulationPrimaryPosition: "ST",
      currentAbility: 8,
      potentialAbility: 10,
      reputation: 6,
    }),
    "[]",
    "VERIFIED",
    "HIGH",
    "2030-03-01",
  );
  establishHomeFootballContext(db, pack, "2030-03-01");
  return { db, clubId, playerId };
};

describe("country-pack transfer-market calibration", () => {
  it("keeps Nepal and packs without optional dimensions on neutral defaults", () => {
    registerCountryPack(unsupportedPack);
    const nepal = databaseFor(nepalPack);
    const unsupported = databaseFor(unsupportedPack);
    expect(homeEconomicProfile(nepal.db).playerMarketValueScale ?? 1).toBe(1);
    expect(homeEconomicProfile(nepal.db).playerWageScale ?? 1).toBe(1);
    expect(homeEconomicProfile(unsupported.db).playerMarketValueScale ?? 1).toBe(1);
    expect(homeEconomicProfile(unsupported.db).playerWageScale ?? 1).toBe(1);
    nepal.db.close();
    unsupported.db.close();
  });

  it("applies independent market-value calibration to domestic seller valuations", () => {
    registerCountryPack(testlandPack);
    registerCountryPack(unsupportedPack);
    const calibrated = databaseFor(testlandPack);
    const neutral = databaseFor(unsupportedPack);
    const calibratedValue = calculateTransferValuation(calibrated.db, {
      playerId: calibrated.playerId,
      sellingClubId: calibrated.clubId,
      worldDate: "2030-03-01",
    });
    const neutralValue = calculateTransferValuation(neutral.db, {
      playerId: neutral.playerId,
      sellingClubId: neutral.clubId,
      worldDate: "2030-03-01",
    });
    expect(calibratedValue.internalValue.min).toBeGreaterThan(neutralValue.internalValue.min);
    expect(calibratedValue.internalValue.min / neutralValue.internalValue.min).toBeCloseTo(1.7, 2);
    calibrated.db.prepare("UPDATE player_factual_profiles SET current_club_id = NULL").run();
    neutral.db.prepare("UPDATE player_factual_profiles SET current_club_id = NULL").run();
    const calibratedDemand = assessFreeAgentSigning(
      calibrated.db,
      calibrated.clubId,
      calibrated.playerId,
      "2030-03-01",
    );
    const neutralDemand = assessFreeAgentSigning(
      neutral.db,
      neutral.clubId,
      neutral.playerId,
      "2030-03-01",
    );
    expect(calibratedDemand.wageDemand / neutralDemand.wageDemand).toBeCloseTo(1.9, 2);
    calibrated.db.close();
    neutral.db.close();
  });

  it("calibrates transfer-market financial profiles without rewriting persisted rows", () => {
    registerCountryPack(testlandPack);
    const calibrated = databaseFor(testlandPack);
    initializeTransferMarketForSave({ db: calibrated.db, worldDate: "2030-03-01", seed: "11n" });
    const market = new TransferMarketRepository(calibrated.db);
    const before = market.clubFinancialProfile(calibrated.clubId)!;
    initializeTransferMarketForSave({
      db: calibrated.db,
      worldDate: "2030-03-02",
      seed: "different",
    });
    expect(market.clubFinancialProfile(calibrated.clubId)).toEqual(before);
    expect(before.wageBudget).toBeGreaterThan(0);
    expect(before.transferBudget).toBeGreaterThan(0);
    calibrated.db.close();
  });
});
