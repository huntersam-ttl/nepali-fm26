import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, lowerLeagueCoverageReport } from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("lower-league completion", () => {
  it("makes every imported B/C club playable, staffed or market-visible, and idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-football-lower-league-"));
    tempDirs.push(dir);
    const databasePath = join(dir, "lower-league.sqlite");
    createNepalSave({
      databasePath,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "Lower League Completion",
      gameVersion: "0.2.0",
      randomSeed: "lower-league-completion",
    });

    const db = openGameDatabase(databasePath);
    const first = lowerLeagueCoverageReport({ db, date: "2026-08-01" });
    const generatedAfterFirst = (db.prepare("SELECT COUNT(*) AS n FROM generated_player_origins").get() as { n: number }).n;
    const vacancies = (db.prepare("SELECT COUNT(*) AS n FROM staff_vacancies WHERE role='HEAD_COACH' AND status='VACANT'").get() as { n: number }).n;
    expect(first.clubs).toHaveLength(28);
    expect(first.clubs.every((club) => club.playableSquad)).toBe(true);
    expect(first.generatedStartingPlayers).toBeGreaterThan(0);
    expect(vacancies).toBe(28);

    const second = lowerLeagueCoverageReport({ db, date: "2026-08-01" });
    const generatedAfterSecond = (db.prepare("SELECT COUNT(*) AS n FROM generated_player_origins").get() as { n: number }).n;
    expect(second).toEqual(first);
    expect(generatedAfterSecond).toBe(generatedAfterFirst);
    db.close();
  });
});
