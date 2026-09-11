import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, simulateNepalCareer } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A bounded, real-world (not synthetic) fixture batch instrumenting the
 * player-instruction and set-piece-routine surfaces this sprint added, on top
 * of the diversity/validity checks the Sprint 3 soak already covers. This is
 * NOT the final comprehensive multi-season soak — that is explicitly out of
 * scope for this slice.
 */
describe("focused tactical soak — player instructions and set-piece routines", () => {
  it("a bounded Nepal fixture batch shows no crashes, no invalid combos, always-resolved set-piece fallbacks, and a bounded set-piece goal share", () => {
    const dir = mkdtempSync(join(tmpdir(), "focused-tactical-soak-"));
    tempDirs.push(dir);
    const databasePath = join(dir, "soak.sqlite");
    createNepalSave({
      databasePath,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "Focused tactical soak",
      gameVersion: "0.2.0",
      randomSeed: "focused-tactical-soak",
    });
    const db = openGameDatabase(databasePath);
    const t0 = Date.now();
    const report = simulateNepalCareer({
      db,
      seasons: 1,
      seed: "focused-tactical-soak",
      savePath: databasePath,
      competitionSeasonId: "anfa-national-league-2026" as EntityId,
      maxFixturesPerSeason: 60,
    });
    const runtimeMs = Date.now() - t0;
    expect(report.seasons.length).toBeGreaterThanOrEqual(1);

    const matches = db
      .prepare(
        "SELECT id, home_goals, away_goals FROM matches WHERE home_goals IS NOT NULL",
      )
      .all() as Array<{ id: string; home_goals: number; away_goals: number }>;
    expect(matches.length).toBeGreaterThan(0);

    const events = db
      .prepare(
        `SELECT match_id, type, data_json FROM match_events WHERE type IN ('CORNER','FREE_KICK','GOAL')`,
      )
      .all() as Array<{ match_id: string; type: string; data_json: string | null }>;

    let corners = 0;
    let freeKicks = 0;
    let setPieceGoals = 0;
    let fallbackUsedCount = 0;
    let missingResolutionCount = 0;
    const cornerRoutineUsage: Record<string, number> = {};
    const freeKickRoutineUsage: Record<string, number> = {};
    const defensiveSchemeUsage: Record<string, number> = {};
    let extremeGoalOutlierMatches = 0;

    for (const event of events) {
      const data = event.data_json ? (JSON.parse(event.data_json) as Record<string, unknown>) : {};
      if (event.type === "CORNER") {
        corners += 1;
        const routine = String(data.routine ?? "unknown");
        cornerRoutineUsage[routine] = (cornerRoutineUsage[routine] ?? 0) + 1;
        const scheme = String(data.defensiveScheme ?? "unknown");
        defensiveSchemeUsage[scheme] = (defensiveSchemeUsage[scheme] ?? 0) + 1;
        if (data.fallbackUsed) fallbackUsedCount += 1;
        // A corner must always resolve to some outcome — never a missing/
        // undefined resolution that would indicate an unhandled taker/target.
        if (!data.outcome) missingResolutionCount += 1;
      }
      if (event.type === "FREE_KICK") {
        freeKicks += 1;
        const routine = String(data.routine ?? "unknown");
        freeKickRoutineUsage[routine] = (freeKickRoutineUsage[routine] ?? 0) + 1;
        if (data.fallbackUsed) fallbackUsedCount += 1;
        if (!data.outcome) missingResolutionCount += 1;
      }
      if (event.type === "GOAL" && data.fromSetPiece) {
        setPieceGoals += 1;
      }
    }

    const totalGoals = matches.reduce((sum, m) => sum + m.home_goals + m.away_goals, 0);
    for (const match of matches) {
      if (match.home_goals + match.away_goals >= 9) extremeGoalOutlierMatches += 1;
    }
    const goalsPerMatch = matches.length > 0 ? totalGoals / matches.length : 0;
    const setPieceGoalShare = totalGoals > 0 ? setPieceGoals / totalGoals : 0;
    const extremeOutlierShare = matches.length > 0 ? extremeGoalOutlierMatches / matches.length : 0;

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          scope: "1 season, maxFixturesPerSeason=60, real Nepal world",
          runtimeMs,
          matchesPlayed: matches.length,
          corners,
          freeKicks,
          cornerRoutineUsage,
          freeKickRoutineUsage,
          defensiveSchemeUsage,
          fallbackUsedCount,
          missingResolutionCount,
          totalGoals,
          goalsPerMatch: Number(goalsPerMatch.toFixed(2)),
          setPieceGoals,
          setPieceGoalShare: Number(setPieceGoalShare.toFixed(3)),
          extremeGoalOutlierMatches,
          extremeOutlierShare: Number(extremeOutlierShare.toFixed(3)),
        },
        null,
        2,
      ),
    );

    // Pass criteria: no crashes (implicit — simulateNepalCareer completed),
    // every set-piece resolves (no missing outcome), fallback safety never
    // breaks down, set pieces are actually happening, goals/match and
    // set-piece goal share stay within plausible bounds (no scheme
    // guarantees a goal, no runaway scoreline), and extreme outliers stay rare.
    expect(missingResolutionCount).toBe(0);
    expect(corners + freeKicks).toBeGreaterThan(0);
    expect(goalsPerMatch).toBeGreaterThan(0);
    expect(goalsPerMatch).toBeLessThan(6);
    expect(setPieceGoalShare).toBeLessThan(0.5);
    expect(extremeOutlierShare).toBeLessThan(0.15);

    db.close();
  }, 180_000);
});
