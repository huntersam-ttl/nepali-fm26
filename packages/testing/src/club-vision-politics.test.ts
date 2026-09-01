import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import {
  buildClubVision,
  createNepalSave,
  initializeClubEconomyForSave,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("club vision and board politics foundation", () => {
  it("derives a dynamic vision from the existing policy and finance records", () => {
    const directory = mkdtempSync(join(tmpdir(), "club-vision-politics-"));
    directories.push(directory);
    const databasePath = join(directory, "vision.sqlite");
    createNepalSave({
      databasePath,
      dataset: JSON.parse(readFileSync(resolve("data/nepal/2026-08/club-registry.json"), "utf8")),
      saveName: "Vision",
      gameVersion: "test",
      randomSeed: "vision-seed",
      globalSeedPath: null,
    });
    const db = openGameDatabase(databasePath);
    try {
      initializeClubEconomyForSave({ db, worldDate: "2027-07-01", seed: "vision-seed" });
      const club = db.prepare("SELECT id FROM clubs ORDER BY id LIMIT 1").get() as { id: EntityId };
      const vision = buildClubVision(db, club.id, "2027-07-01");
      expect(vision?.clubId).toBe(club.id);
      expect(vision?.objective).toBeTruthy();
      expect(vision?.provenanceStatus).toBe("SIMULATION_ONLY");
      expect(vision?.ownershipInfluence).toBeGreaterThanOrEqual(0);
      expect(vision?.ownershipInfluence).toBeLessThanOrEqual(100);
    } finally {
      db.close();
    }
  });
});
