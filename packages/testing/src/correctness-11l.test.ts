import { describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  establishHomeFootballContext,
  initializeClubEconomyForSave,
  nepalPack,
  registerCountryPack,
  type CountryPack,
} from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

/* Phase 11L: sponsor pools are country-pack data, not Nepal-only simulation constants. */

const testlandPack: CountryPack = {
  packId: "testland-11l",
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
  sponsors: [
    {
      name: "Testland Telecom",
      industry: "Telecommunications",
      sourceUrl: "test://testland-telecom",
      identityProvenance: "SIMULATION_ONLY",
      status: "SIMULATION_ONLY",
    },
  ],
  federationSponsors: [{ name: "Testland Football Trust", industry: "Education" }],
};

const databaseFor = (pack: CountryPack, suffix: string) => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  const world = new WorldRepository(db);
  const country = {
    id: createStableEntityId("country", `11l-${suffix}`),
    name: pack.countryName,
    isoCode: pack.isoCodes[0]!,
  };
  world.insertCountry(country);
  world.insertFederation({
    id: createStableEntityId("federation", `11l-${suffix}`),
    countryId: country.id,
    name: `${pack.countryName} FA`,
  });
  establishHomeFootballContext(db, pack, "2030-03-01");
  return { db, country };
};

describe("country-pack sponsor pools", () => {
  it("keeps Nepal's canonical sponsor pools and stable identifiers", () => {
    expect(nepalPack.sponsors?.map((sponsor) => sponsor.name)).toEqual([
      "Nabil Bank Limited",
      "Nepal Telecom",
      "Ncell Axiata Limited",
      "Nepal Airlines Corporation",
      "Chaudhary Group",
      "Himal Local Partner",
      "Bagmati Community Foods",
      "Koshi Digital",
      "Lumbini Travel Cooperative",
      "Annapurna Training Supplies",
      "Kathmandu Youth Education",
      "Terai Agro Markets",
      "Everest Health Clinics",
    ]);
    expect(nepalPack.federationSponsors?.map((sponsor) => sponsor.name)).toEqual([
      "Nepal Football Development Partner",
      "Himal Broadcast Network",
      "Regional Sports Education Trust",
    ]);
    expect(
      nepalPack.sponsors?.map((sponsor) =>
        createStableEntityId("sponsor-organisation", sponsor.name),
      ),
    ).toHaveLength(13);
  });

  it("seeds only the selected second-country pack and remains idempotent", () => {
    registerCountryPack(testlandPack);
    const { db } = databaseFor(testlandPack, "testland");

    initializeClubEconomyForSave({ db, worldDate: "2030-03-01", seed: "11l-testland" });
    const economy = new ClubEconomyRepository(db);
    expect(economy.sponsors().map((sponsor) => sponsor.name)).toEqual(["Testland Telecom"]);
    expect(economy.sponsors()[0]).toMatchObject({
      countryId: expect.any(String),
      id: createStableEntityId("sponsor-organisation", "Testland Telecom"),
    });

    initializeClubEconomyForSave({ db, worldDate: "2030-03-01", seed: "11l-testland" });
    expect(economy.sponsors()).toHaveLength(1);
    expect(economy.sponsors().some((sponsor) => sponsor.name.includes("Nepal"))).toBe(false);
    db.close();
  });

  it("does not invent Nepal sponsors for an unsupported pack and preserves legacy rows", () => {
    const unsupportedPack = {
      ...testlandPack,
      packId: "testland-11l-unsupported",
      sponsors: undefined,
      federationSponsors: undefined,
    };
    registerCountryPack(unsupportedPack);
    const { db, country } = databaseFor(unsupportedPack, "unsupported");
    const economy = new ClubEconomyRepository(db);
    economy.upsertSponsor({
      id: createStableEntityId("sponsor-organisation", "Legacy Testland Sponsor"),
      name: "Legacy Testland Sponsor",
      industry: "Local services",
      countryId: country.id,
      reputation: 4,
      budgetTier: "LOCAL",
      status: "SIMULATION_ONLY",
    });

    initializeClubEconomyForSave({ db, worldDate: "2030-03-01", seed: "11l-unsupported" });
    expect(economy.sponsors().map((sponsor) => sponsor.name)).toEqual(["Legacy Testland Sponsor"]);
    db.close();
  });
});
