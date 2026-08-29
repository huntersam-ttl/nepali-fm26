import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import {
  createNepalSave,
  initializeClubEconomyForSave,
  runClubAiSeasonPlanning,
} from "@nepal-football-sim/simulation";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("club AI detailed-world scope", () => {
  it("does not run detailed planning for context-only clubs", () => {
    const directory = mkdtempSync(join(tmpdir(), "nepal-ai-context-scope-"));
    tempDirs.push(directory);
    const databasePath = join(directory, "career.sqlite");
    createNepalSave({
      databasePath,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "AI context scope",
      gameVersion: "test",
      randomSeed: "ai-context-scope",
    });
    const db = openGameDatabase(databasePath);
    try {
      initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "ai-context-scope" });
      const decisions = runClubAiSeasonPlanning(db, {
        date: "2026-08-28",
        seed: "ai-context-scope",
      });
      expect(decisions.length).toBeGreaterThan(0);
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM club_ai_decision_history d
             JOIN external_club_context ecc ON ecc.club_id = d.club_id
             WHERE ecc.simulation_depth = 'CONTEXT_ONLY'`,
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  }, 120000);
});
