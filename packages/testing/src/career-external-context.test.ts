import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GlobalFootballContextRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  createNepalSave,
  initializeForeignFootballWorldForSave,
  processCareerExternalWorldSeason,
} from "@nepal-football-sim/simulation";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

const createSave = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "nepal-career-external-context-"));
  tempDirs.push(directory);
  const databasePath = join(directory, "career.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: "Career external context",
    gameVersion: "test",
    randomSeed: "career-external-context",
  });
  const db = openGameDatabase(databasePath);
  try {
    initializeForeignFootballWorldForSave({ db, worldDate: "2026-08-01", seed: "foreign" });
  } finally {
    db.close();
  }
  return databasePath;
};

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("career external-context production phase", () => {
  it("persists the live season boundary once while keeping foreign entities context-only", () => {
    const databasePath = createSave();
    const seasonEndDate = "2027-07-31";
    const db = openGameDatabase(databasePath);
    try {
      const contexts = new GlobalFootballContextRepository(db);
      expect(contexts.seasons()).toHaveLength(0);

      processCareerExternalWorldSeason({ db, seasonEndDate, seed: "career:foreign-world:0" });
      const first = {
        seasons: contexts.seasons(),
        players: contexts.players(),
        interests: contexts.interests(),
        clubs: contexts.clubs(),
      };
      expect(first.seasons.length).toBeGreaterThan(0);
      expect(first.seasons.every((season) => season.completedOn === seasonEndDate)).toBe(true);
      expect(first.players.length).toBeGreaterThan(0);
      expect(first.interests.length).toBeGreaterThan(0);
      expect(first.clubs.length).toBeGreaterThan(0);
      expect(first.clubs.every((club) => club.simulationDepth === "CONTEXT_ONLY")).toBe(true);

      // Re-entering the same production phase is reload-safe and exact-once.
      processCareerExternalWorldSeason({ db, seasonEndDate, seed: "career:foreign-world:0" });
      expect({
        seasons: contexts.seasons(),
        players: contexts.players(),
        interests: contexts.interests(),
        clubs: contexts.clubs(),
      }).toEqual(first);
    } finally {
      db.close();
    }
  }, 300000);
});
