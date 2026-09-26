import { describe, expect, it } from "vitest";
import {
  YouthRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  establishHomeFootballContext,
  initializeYouthSystemForSave,
  nepalPack,
  registerCountryPack,
  type CountryPack,
} from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

/* Phase 11I: youth-development calibration is country-pack data, with a neutral fallback for packs without it. */

const testlandPack: CountryPack = {
  packId: "testland-11i",
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
  developmentProfile: (countryId, date) => ({
    id: createStableEntityId("country-development-profile", `${countryId}:${date.slice(0, 4)}`),
    countryId,
    effectiveFrom: date,
    footballPopularity: 0.8,
    grassrootsReach: 0.7,
    coachingQuality: 0.65,
    youthInfrastructure: 0.6,
    talentConversion: 0.55,
    status: "SIMULATION_ONLY",
    notes: "Testland calibration",
  }),
};

describe("country-pack youth-development profiles", () => {
  it("preserves Nepal's calibrated youth profile", () => {
    const countryId = createStableEntityId("country", "11i-nepal");

    expect(nepalPack.developmentProfile?.(countryId, "2026-08-01")).toEqual({
      id: createStableEntityId("country-development-profile", `${countryId}:2026`),
      countryId,
      effectiveFrom: "2026-08-01",
      footballPopularity: 0.58,
      grassrootsReach: 0.42,
      coachingQuality: 0.36,
      youthInfrastructure: 0.32,
      talentConversion: 0.34,
      status: "SIMULATION_ONLY",
      notes: "Calibrated Nepal youth environment for gameplay; not a researched score.",
    });
  });

  it("allows a second country pack to provide independent calibration", () => {
    registerCountryPack(testlandPack);
    const profile = testlandPack.developmentProfile?.(
      createStableEntityId("country", "11i-testland"),
      "2030-03-01",
    );

    expect(profile).toMatchObject({
      footballPopularity: 0.8,
      grassrootsReach: 0.7,
      coachingQuality: 0.65,
      youthInfrastructure: 0.6,
      talentConversion: 0.55,
      notes: "Testland calibration",
    });
  });

  it("leaves uncalibrated packs without a Nepal-specific profile", () => {
    const unsupportedPack = {
      ...testlandPack,
      packId: "testland-11i-neutral",
      developmentProfile: undefined,
    };

    registerCountryPack(unsupportedPack);
    expect(unsupportedPack.developmentProfile).toBeUndefined();

    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    const country = {
      id: createStableEntityId("country", "11i-neutral"),
      name: "Testland",
      isoCode: "TL",
    };
    new WorldRepository(db).insertCountry(country);
    const federationId = createStableEntityId("federation", "11i-neutral");
    new WorldRepository(db).insertFederation({
      id: federationId,
      countryId: country.id,
      name: "Neutralia FA",
    });
    establishHomeFootballContext(db, unsupportedPack, "2030-03-01");
    initializeYouthSystemForSave({ db, worldDate: "2030-03-01", seed: "11i-neutral" });

    expect(new YouthRepository(db).latestCountryDevelopmentProfile(country.id)).toMatchObject({
      countryId: country.id,
      footballPopularity: 0.5,
      grassrootsReach: 0.5,
      coachingQuality: 0.5,
      youthInfrastructure: 0.5,
      talentConversion: 0.5,
      notes: "Neutral youth environment used because this country pack has no calibration.",
    });
    db.close();
  });
});
