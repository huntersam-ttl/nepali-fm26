import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateNepalWorldDataset } from "@nepal-football-sim/data-import";
import { NEPAL_GEOGRAPHY, startingClubOptions } from "@nepal-football-sim/simulation";

/**
 * The starting-club setup screen must never show a bare "Location unknown"
 * for a club the real dataset has no locationKey for (true of most clubs in
 * the current registry) — a believable, bounded, deterministic Nepal-scale
 * estimate should appear instead, per the SIMULATION_ONLY fallback rule.
 */
describe("starting-club locality fallback", () => {
  const dataset = validateNepalWorldDataset(
    JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8")) as unknown,
  );

  it("gives every starting-club option a defined, non-'unknown' location label", () => {
    const options = startingClubOptions(dataset);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.locationName).toBeDefined();
      expect(option.locationName).not.toMatch(/unknown/i);
    }
  });

  it("labels a generated estimate honestly and bounds it to a real, known Nepal hub", () => {
    const options = startingClubOptions(dataset);
    const estimated = options.filter((option) => option.locationName?.endsWith("(estimated)"));
    // The real registry has real locationKeys for only a minority of clubs, so
    // this fallback path must actually be exercised by this test, not vacuous.
    expect(estimated.length).toBeGreaterThan(0);
    for (const option of estimated) {
      const hub = option.locationName!.replace(/ \(estimated\)$/, "");
      expect(NEPAL_GEOGRAPHY.clubLocalityHubs).toContain(hub);
    }
  });

  it("is deterministic — the same club always gets the same estimate across calls", () => {
    const first = startingClubOptions(dataset).map((option) => [option.clubName, option.locationName]);
    const second = startingClubOptions(dataset).map((option) => [option.clubName, option.locationName]);
    expect(second).toEqual(first);
  });

  it("keeps a real, dataset-supplied locationKey unchanged rather than overriding it with an estimate", () => {
    const options = startingClubOptions(dataset);
    const realClub = dataset.clubs.find((club) => club.locationKey?.value);
    if (!realClub) return;
    const option = options.find((item) => item.clubName === realClub.name);
    if (!option) return;
    expect(option.locationName).not.toMatch(/\(estimated\)$/);
  });
});
