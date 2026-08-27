import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TerritorialFootballRepository,
  loadSave,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import { SimulationClock, createNepalSave, initializeFederationGovernanceForSave } from "@nepal-football-sim/simulation";

const registry = join(process.cwd(), "data/nepal/2026-08/club-registry.json");

describe("territorial production activation", () => {
  it("initializes on save creation and advances through normal career progression", () => {
    const directory = mkdtempSync(join(tmpdir(), "territorial-production-"));
    const savePath = join(directory, "career.sqlite");
    createNepalSave({
      databasePath: savePath,
      dataset: JSON.parse(readFileSync(registry, "utf8")) as unknown,
      saveName: "territorial-production",
      gameVersion: "test",
      randomSeed: "territorial-production",
      worldDate: "2026-08-01",
    });
    const careerDb = openGameDatabase(savePath);
    migrateDatabase(careerDb);
    const initial = new TerritorialFootballRepository(careerDb);
    expect(initial.provinces()).toHaveLength(7);
    expect(initial.districts()).toHaveLength(77);
    careerDb.close();
    const simulationDb = openGameDatabase(savePath);
    initializeFederationGovernanceForSave({ db: simulationDb, worldDate: "2026-08-01", seed: "territorial-production" });
    const clock = new SimulationClock(simulationDb, loadSave(simulationDb));
    clock.advanceDays(27);
    simulationDb.close();
    const progressed = openGameDatabase(savePath);
    const repo = new TerritorialFootballRepository(progressed);
    expect(repo.districts().some((district) => district.history.some((event) => event.event === "DEVELOPMENT_REVIEW"))).toBe(true);
    expect(repo.projects()).toHaveLength(1);
    expect(repo.competitionSeasons()).toHaveLength(3);
    progressed.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
