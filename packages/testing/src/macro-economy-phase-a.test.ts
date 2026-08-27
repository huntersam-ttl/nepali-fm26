import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adjustForMacro,
  createTestWorld,
  SimulationClock,
  nextMacroEconomicState,
} from "@nepal-football-sim/simulation";
import { MacroEconomyRepository, openGameDatabase, loadSave } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";

describe("macro football economy phase A", () => {
  it("is seed-stable, moves costs and revenues, and remains bounded over 50 years", () => {
    const countryId = "country:nepal" as EntityId;
    let first = nextMacroEconomicState(undefined, {
      countryId,
      year: 2027,
      seed: "macro-test",
      footballDevelopment: 4,
    });
    let second = first;
    for (let year = 2028; year <= 2077; year += 1)
      second = nextMacroEconomicState(second, {
        countryId,
        year,
        seed: "macro-test",
        footballDevelopment: 4,
      });
    let replay = nextMacroEconomicState(undefined, {
      countryId,
      year: 2027,
      seed: "macro-test",
      footballDevelopment: 4,
    });
    for (let year = 2028; year <= 2077; year += 1)
      replay = nextMacroEconomicState(replay, {
        countryId,
        year,
        seed: "macro-test",
        footballDevelopment: 4,
      });
    expect(replay).toEqual(second);
    expect(second.constructionCostIndex).toBeGreaterThan(first.constructionCostIndex);
    expect(second.sponsorMarketStrength).toBeGreaterThan(first.sponsorMarketStrength);
    expect(second.constructionCostIndex).toBeLessThanOrEqual(4);
    expect(second.sponsorMarketStrength).toBeLessThanOrEqual(4);
    expect(adjustForMacro(100, second, "wageInflationIndex")).toBeGreaterThan(100);
  });

  it("persists country snapshots without mixing entity finances", () => {
    const db = openGameDatabase(":memory:");
    const state = nextMacroEconomicState(undefined, {
      countryId: "country:nepal" as EntityId,
      year: 2027,
      seed: "persist",
    });
    const repository = new MacroEconomyRepository(db);
    repository.upsert(state);
    expect(repository.state(state.countryId, state.year)).toEqual(state);
    db.close();
  });

  it("reaches macro production through normal calendar progression", () => {
    const directory = mkdtempSync(join(tmpdir(), "macro-production-"));
    const databasePath = join(directory, "save.sqlite");
    try {
      const world = createTestWorld(databasePath);
      const db = openGameDatabase(databasePath);
      const repository = new MacroEconomyRepository(db);
      const before = repository.states();
      expect(before.map((state) => state.year)).toEqual([2026, 2027]);
      const save = loadSave(db);
      new SimulationClock(db, save).advanceDays(30);
      expect(repository.states()).toEqual(before);
      expect(world.worldDate).toBe("2027-01-31");
      db.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
