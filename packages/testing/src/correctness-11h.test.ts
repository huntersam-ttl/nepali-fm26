import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DesktopApplicationService,
  nepalPack,
  registerCountryPack,
  type CountryPack,
} from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

/* Phase 11H: founder-location choices belong to the selected country pack, not to Nepal-only desktop code. */

const directories: string[] = [];
afterAll(() =>
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })),
);

const packWithFounderLocations: CountryPack = {
  packId: "testland-11h",
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
  founderLocations: [
    {
      id: createStableEntityId("location", "testland-alpha"),
      province: "North Province",
      district: "Alpha",
      locality: "Alpha",
      provenanceStatus: "SIMULATION_ONLY",
    },
  ],
};

const serviceFor = (countryPackId: string): DesktopApplicationService => {
  const savesDirectory = mkdtempSync(join(tmpdir(), "nepal-fm26-11h-"));
  directories.push(savesDirectory);
  return new DesktopApplicationService({
    savesDirectory,
    worldDatasetPath: "unused-for-founder-location-list",
    countryPackId,
  });
};

describe("country-pack founder locations", () => {
  it("preserves Nepal's canonical 77 reported founder locations", () => {
    const result = serviceFor(nepalPack.packId).listFounderLocations();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(77);
    expect(result.data).toContainEqual({
      id: expect.any(String),
      province: "Koshi",
      district: "Bhojpur",
      locality: "Bhojpur",
      provenanceStatus: "REPORTED",
    });
  });

  it("uses a second country's pack vocabulary without enabling Nepal's locations", () => {
    registerCountryPack(packWithFounderLocations);
    const result = serviceFor(packWithFounderLocations.packId).listFounderLocations();

    expect(result.data).toEqual(packWithFounderLocations.founderLocations);
  });

  it("returns no founder choices for a pack that does not support that career flow", () => {
    const unsupportedPackId = "testland-11h-no-founder-flow";
    registerCountryPack({
      ...packWithFounderLocations,
      packId: unsupportedPackId,
      founderLocations: undefined,
    });

    expect(serviceFor(unsupportedPackId).listFounderLocations()).toEqual({ ok: true, data: [] });
  });
});
