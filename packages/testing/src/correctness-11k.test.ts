import { describe, expect, it } from "vitest";
import {
  MediaRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  establishHomeFootballContext,
  initializeMediaForSave,
  initializeMediaJournalists,
  nepalPack,
  publishMediaForDate,
  registerCountryPack,
  type CountryPack,
} from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

/* Phase 11K: media outlets and journalists are country-pack data, not a Nepal-only global pool. */

const testlandPack: CountryPack = {
  packId: "testland-11k",
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
  mediaOutlets: [
    {
      name: "Testland Football Desk",
      scope: "NATIONAL",
      reputation: 6,
      reach: 5,
      bias: "NEUTRAL",
      style: "WIRE",
      status: "SIMULATION_ONLY",
    },
  ],
  mediaJournalists: [
    {
      name: "Tessa Reporter",
      beat: "Domestic football",
      temperament: "NEUTRAL",
      reputation: 6,
      status: "SIMULATION_ONLY",
    },
  ],
};

const databaseFor = (pack: CountryPack, suffix: string) => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  const world = new WorldRepository(db);
  const country = {
    id: createStableEntityId("country", `11k-${suffix}`),
    name: pack.countryName,
    isoCode: pack.isoCodes[0]!,
  };
  world.insertCountry(country);
  world.insertFederation({
    id: createStableEntityId("federation", `11k-${suffix}`),
    countryId: country.id,
    name: `${pack.countryName} FA`,
  });
  establishHomeFootballContext(db, pack, "2030-03-01");
  return { db, country };
};

describe("country-pack media pools", () => {
  it("preserves Nepal's expected outlet and journalist pools with stable IDs", () => {
    const { db } = databaseFor(nepalPack, "nepal");
    const outlets = initializeMediaForSave(db);
    const journalists = initializeMediaJournalists(db);

    expect(outlets.map((outlet) => outlet.name)).toContain("Nepal Football News");
    expect(journalists.map((journalist) => journalist.name)).toContain("Asha Shrestha");
    expect(outlets.find((outlet) => outlet.name === "Nepal Football News")?.id).toBe(
      createStableEntityId("media-outlet", "Nepal Football News"),
    );
    db.close();
  });

  it("initializes only an independent second-country media pool", () => {
    registerCountryPack(testlandPack);
    const { db } = databaseFor(testlandPack, "testland");
    const outlets = initializeMediaForSave(db);
    const journalists = initializeMediaJournalists(db);

    expect(outlets.map((outlet) => outlet.name)).toEqual(["Testland Football Desk"]);
    expect(journalists.map((journalist) => journalist.name)).toEqual(["Tessa Reporter"]);
    expect(outlets.some((outlet) => outlet.name.includes("Nepal"))).toBe(false);
    expect(journalists.some((journalist) => journalist.name === "Asha Shrestha")).toBe(false);
    db.close();
  });

  it("does not inherit Nepal media for an unsupported pack and preserves legacy rows", () => {
    const unsupportedPack = {
      ...testlandPack,
      packId: "testland-11k-unsupported",
      mediaOutlets: undefined,
      mediaJournalists: undefined,
    };
    registerCountryPack(unsupportedPack);
    const { db } = databaseFor(unsupportedPack, "unsupported");
    const repo = new MediaRepository(db);
    const legacyId = createStableEntityId("media-outlet", "Legacy Testland Desk");
    repo.upsertOutlet({
      id: legacyId,
      name: "Legacy Testland Desk",
      scope: "LOCAL",
      reputation: 4,
      reach: 3,
      bias: "CLUB_FOCUSED",
      style: "ANALYSIS",
      status: "SIMULATION_ONLY",
    });

    expect(initializeMediaForSave(db).map((outlet) => outlet.name)).toEqual([
      "Legacy Testland Desk",
    ]);
    expect(initializeMediaForSave(db)).toHaveLength(1);
    expect(publishMediaForDate(db, { date: "2030-03-02" })).toEqual([]);
    db.close();
  });
});
