import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FederationGovernanceRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  createNepalSave,
  initializeFederationGovernanceForSave,
  processFederationMonth,
} from "@nepal-football-sim/simulation";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("federation national-team appearance integrity", () => {
  it("persists only canonical players and keeps the monthly friendly exact-once", () => {
    const directory = mkdtempSync(join(tmpdir(), "nepal-national-appearance-"));
    tempDirs.push(directory);
    const databasePath = join(directory, "career.sqlite");
    createNepalSave({
      databasePath,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "National appearance integrity",
      gameVersion: "test",
      randomSeed: "national-appearance-integrity",
    });
    const db = openGameDatabase(databasePath);
    try {
      initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "appearance" });
      processFederationMonth(db, { date: "2026-11-28", seed: "appearance" });
      const firstCount = new FederationGovernanceRepository(db).nationalTeamAppearances().length;
      expect(firstCount).toBeGreaterThan(0);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM national_team_appearances a
             LEFT JOIN persons p ON p.id = a.player_id
             WHERE p.id IS NULL OR a.player_id LIKE '%:replacement:%'`,
          )
          .get(),
      ).toEqual({ count: 0 });

      processFederationMonth(db, { date: "2026-11-28", seed: "appearance" });
      expect(new FederationGovernanceRepository(db).nationalTeamAppearances().length).toBe(firstCount);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  }, 120000);
});
