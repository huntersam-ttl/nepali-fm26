import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import {
  FAMILIARITY_CAP,
  FAMILIARITY_FLOOR,
  createNepalSave,
  dutyIsLegalForRole,
  simulateNepalCareer,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * The final Deep Tactics closure soak: 3 real-world seasons (not synthetic
 * match loops), instrumenting every tactical surface this sprint series
 * touched. This supersedes the single-season focused soak as the
 * comprehensive multi-season proof, but does not replace it as a fast
 * regression check (that one stays, and stays smaller).
 */
describe("final multi-season tactical soak", () => {
  it("3 real Nepal seasons: diverse, valid, stable tactics across the whole tactical stack", () => {
    const dir = mkdtempSync(join(tmpdir(), "multi-season-tactical-soak-"));
    tempDirs.push(dir);
    const databasePath = join(dir, "soak.sqlite");
    createNepalSave({
      databasePath,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "Multi-season tactical soak",
      gameVersion: "0.2.0",
      randomSeed: "multi-season-soak",
    });
    const db = openGameDatabase(databasePath);

    // Run season-by-season (not one seasons:3 call) so familiarity can be
    // snapshotted between seasons and manager-change/tactical-switch drops
    // are visible, not just the end state.
    const t0 = Date.now();
    const seasonTimings: number[] = [];
    const familiaritySnapshotsBySeason: Array<{ min: number; median: number; max: number }> = [];

    const familiaritySnapshot = () => {
      const rows = db
        .prepare("SELECT familiarity_json FROM tactical_setups")
        .all() as Array<{ familiarity_json: string }>;
      const values = rows.flatMap((row) => Object.values(JSON.parse(row.familiarity_json) as Record<string, number>));
      const sorted = [...values].sort((a, b) => a - b);
      return {
        min: sorted[0] ?? 0,
        median: sorted[Math.floor(sorted.length / 2)] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
      };
    };

    for (let season = 0; season < 3; season += 1) {
      const seasonStart = Date.now();
      simulateNepalCareer({
        db,
        seasons: 1,
        seed: `multi-season-soak:${season}`,
        savePath: databasePath,
        competitionSeasonId: "anfa-national-league-2026" as EntityId,
        maxFixturesPerSeason: 50,
      });
      seasonTimings.push(Date.now() - seasonStart);
      familiaritySnapshotsBySeason.push(familiaritySnapshot());
    }
    const runtimeMs = Date.now() - t0;

    // ---------------------------------------------------------------------
    // Tactical identity
    // ---------------------------------------------------------------------
    const setups = db
      .prepare(
        "SELECT team_id, style, formation_json, assignments_json, familiarity_json, instructions_json FROM tactical_setups",
      )
      .all() as Array<{
      team_id: string;
      style: string;
      formation_json: string;
      assignments_json: string;
      familiarity_json: string;
      instructions_json: string;
    }>;
    expect(setups.length).toBeGreaterThan(0);

    const formations = new Set(setups.map((row) => (JSON.parse(row.formation_json) as { name: string }).name));
    const styles = new Set(setups.map((row) => row.style));
    const mentalities = new Set(
      setups.map((row) => (JSON.parse(row.instructions_json) as { mentality: string }).mentality),
    );
    const widthValues = setups.map(
      (row) => (JSON.parse(row.instructions_json) as { inPossession: { width: number } }).inPossession.width,
    );
    const pressingValues = setups.map(
      (row) =>
        (JSON.parse(row.instructions_json) as { outOfPossession: { pressingIntensity: number } }).outOfPossession
          .pressingIntensity,
    );

    // ---------------------------------------------------------------------
    // Roles / duties / player instructions / familiarity bounds
    // ---------------------------------------------------------------------
    let illegalDuty = 0;
    let missingGk = 0;
    let duplicatePlayers = 0;
    let familiarityOutOfBounds = 0;
    let slotsWithInstructions = 0;
    let totalSlots = 0;
    let contradictionsReachingEngine = 0;
    const roleFamilyUsage: Record<string, number> = {};
    const dutyUsage: Record<string, number> = {};
    const instructionUsage: Record<string, number> = {};
    const CONTRADICTION_PAIRS: Array<[string, string]> = [
      ["GET_FURTHER_FORWARD", "HOLD_POSITION"],
      ["STAY_WIDER", "SIT_NARROWER"],
      ["TAKE_MORE_RISKS", "TAKE_FEWER_RISKS"],
      ["SHORTER_PASSING", "MORE_DIRECT_PASSING"],
      ["CROSS_MORE", "CROSS_LESS"],
      ["PRESS_MORE", "PRESS_LESS"],
      ["SHOOT_MORE", "SHOOT_LESS"],
    ];

    for (const row of setups) {
      const assignments = JSON.parse(row.assignments_json) as Array<{
        slotId: string;
        playerId?: string;
        roleId: string;
        duty?: string;
        instructions?: string[];
      }>;
      const formation = JSON.parse(row.formation_json) as { slots: Array<{ id: string; zone: string }> };
      const ids = assignments.flatMap((a) => (a.playerId ? [a.playerId] : []));
      if (new Set(ids).size !== ids.length) duplicatePlayers += 1;
      const gk = assignments.filter((a) => {
        const slot = formation.slots.find((s) => s.id === a.slotId);
        return slot?.zone === "goalkeeper" && a.playerId;
      });
      if (gk.length !== 1) missingGk += 1;
      for (const assignment of assignments) {
        totalSlots += 1;
        if (!assignment.duty || !dutyIsLegalForRole(assignment.roleId, assignment.duty as never)) {
          illegalDuty += 1;
        }
        dutyUsage[assignment.duty ?? "none"] = (dutyUsage[assignment.duty ?? "none"] ?? 0) + 1;
        const family = assignment.roleId.split("_")[0] ?? assignment.roleId;
        roleFamilyUsage[family] = (roleFamilyUsage[family] ?? 0) + 1;
        const instructions = assignment.instructions ?? [];
        if (instructions.length > 0) slotsWithInstructions += 1;
        for (const instruction of instructions) {
          instructionUsage[instruction] = (instructionUsage[instruction] ?? 0) + 1;
        }
        for (const [a, b] of CONTRADICTION_PAIRS) {
          if (instructions.includes(a) && instructions.includes(b)) contradictionsReachingEngine += 1;
        }
      }
      const familiarity = JSON.parse(row.familiarity_json) as Record<string, number>;
      for (const value of Object.values(familiarity)) {
        if (value < FAMILIARITY_FLOOR || value > FAMILIARITY_CAP) familiarityOutOfBounds += 1;
      }
    }

    // ---------------------------------------------------------------------
    // Set pieces + match distribution (from persisted events, all 3 seasons)
    // ---------------------------------------------------------------------
    const matches = db
      .prepare("SELECT id, home_goals, away_goals FROM matches WHERE home_goals IS NOT NULL")
      .all() as Array<{ id: string; home_goals: number; away_goals: number }>;
    expect(matches.length).toBeGreaterThan(0);

    const events = db
      .prepare(
        `SELECT type, data_json FROM match_events WHERE type IN ('CORNER','FREE_KICK','GOAL','TACTICAL_CHANGE','SHOT')`,
      )
      .all() as Array<{ type: string; data_json: string | null }>;

    const cornerRoutineUsage: Record<string, number> = {};
    const freeKickRoutineUsage: Record<string, number> = {};
    const defensiveSchemeUsage: Record<string, number> = {};
    let missingResolutionCount = 0;
    let setPieceGoals = 0;
    let shots = 0;
    let aiAdaptationEvents = 0;
    let redCardAdaptations = 0;
    let losingLateAdaptations = 0;
    let winningLateAdaptations = 0;

    for (const event of events) {
      const data = event.data_json ? (JSON.parse(event.data_json) as Record<string, unknown>) : {};
      if (event.type === "SHOT") shots += 1;
      if (event.type === "CORNER") {
        const routine = String(data.routine ?? "unknown");
        cornerRoutineUsage[routine] = (cornerRoutineUsage[routine] ?? 0) + 1;
        const scheme = String(data.defensiveScheme ?? "unknown");
        defensiveSchemeUsage[scheme] = (defensiveSchemeUsage[scheme] ?? 0) + 1;
        if (!data.outcome) missingResolutionCount += 1;
      }
      if (event.type === "FREE_KICK") {
        const routine = String(data.routine ?? "unknown");
        freeKickRoutineUsage[routine] = (freeKickRoutineUsage[routine] ?? 0) + 1;
        if (!data.outcome) missingResolutionCount += 1;
      }
      if (event.type === "GOAL" && data.fromSetPiece) setPieceGoals += 1;
      if (event.type === "TACTICAL_CHANGE" && data.decidedBy === "AI") {
        aiAdaptationEvents += 1;
        if (data.mentality === "DEFENSIVE" || data.mentality === "VERY_DEFENSIVE") redCardAdaptations += 1;
        if (data.mentality === "ATTACKING" || data.mentality === "VERY_ATTACKING") losingLateAdaptations += 1;
        if (data.mentality === "CAUTIOUS") winningLateAdaptations += 1;
      }
    }

    const totalGoals = matches.reduce((sum, m) => sum + m.home_goals + m.away_goals, 0);
    const goalsPerMatch = totalGoals / matches.length;
    const shotsPerTeamPerMatch = shots / (matches.length * 2);
    const setPieceGoalShare = totalGoals > 0 ? setPieceGoals / totalGoals : 0;
    const extremeOutlierMatches = matches.filter((m) => m.home_goals + m.away_goals >= 9).length;
    const extremeOutlierShare = extremeOutlierMatches / matches.length;

    // ---------------------------------------------------------------------
    // Stability: save/reload/reopen, no duplicate tactical rows, historical
    // snapshots not corrupted.
    // ---------------------------------------------------------------------
    const duplicateTacticalRows = db
      .prepare("SELECT team_id, COUNT(*) AS n FROM tactical_setups GROUP BY team_id HAVING n > 1")
      .all() as Array<{ team_id: string; n: number }>;
    db.close();
    const reopened = openGameDatabase(databasePath);
    const reopenedSetupCount = (
      reopened.prepare("SELECT COUNT(*) AS n FROM tactical_setups").get() as { n: number }
    ).n;
    expect(reopenedSetupCount).toBe(setups.length);
    const snapshotRows = reopened
      .prepare("SELECT tactical_snapshot_json FROM matches WHERE tactical_snapshot_json IS NOT NULL")
      .all() as Array<{ tactical_snapshot_json: string }>;
    let corruptedSnapshots = 0;
    for (const row of snapshotRows) {
      try {
        const snapshot = JSON.parse(row.tactical_snapshot_json) as {
          home: { formationName: string; mentality: string };
          away: { formationName: string; mentality: string };
        };
        if (!snapshot.home?.formationName || !snapshot.away?.formationName) corruptedSnapshots += 1;
      } catch {
        corruptedSnapshots += 1;
      }
    }
    reopened.close();

    const report = {
      seasons: 3,
      runtimeMs,
      seasonTimingsMs: seasonTimings,
      matches: matches.length,
      persistedTacticalTeams: setups.length,
      formations: [...formations],
      styles: [...styles],
      mentalities: [...mentalities],
      widthMin: Math.min(...widthValues),
      widthMax: Math.max(...widthValues),
      pressingMin: Math.min(...pressingValues),
      pressingMax: Math.max(...pressingValues),
      roleFamilyUsage,
      dutyUsage,
      illegalDuty,
      slotsWithInstructions,
      totalSlots,
      instructionUsage,
      contradictionsReachingEngine,
      familiarityBySeason: familiaritySnapshotsBySeason,
      familiarityOutOfBounds,
      cornerRoutineUsage,
      freeKickRoutineUsage,
      defensiveSchemeUsage,
      missingResolutionCount,
      aiAdaptationEvents,
      redCardAdaptations,
      losingLateAdaptations,
      winningLateAdaptations,
      missingGk,
      duplicatePlayers,
      duplicateTacticalRows: duplicateTacticalRows.length,
      corruptedSnapshots,
      goalsPerMatch: Number(goalsPerMatch.toFixed(2)),
      shotsPerTeamPerMatch: Number(shotsPerTeamPerMatch.toFixed(2)),
      setPieceGoalShare: Number(setPieceGoalShare.toFixed(3)),
      extremeOutlierMatches,
      extremeOutlierShare: Number(extremeOutlierShare.toFixed(3)),
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));

    // -------------------- pass criteria --------------------
    expect(formations.size).toBeGreaterThanOrEqual(2);
    expect(styles.size).toBeGreaterThanOrEqual(2);
    expect(mentalities.size).toBeGreaterThanOrEqual(1);
    expect(Object.keys(roleFamilyUsage).length).toBeGreaterThan(3);
    expect(illegalDuty).toBe(0);
    expect(contradictionsReachingEngine).toBe(0);
    expect(familiarityOutOfBounds).toBe(0);
    expect(missingGk).toBe(0);
    expect(duplicatePlayers).toBe(0);
    expect(duplicateTacticalRows.length).toBe(0);
    expect(corruptedSnapshots).toBe(0);
    expect(missingResolutionCount).toBe(0);
    expect(goalsPerMatch).toBeGreaterThan(0);
    expect(goalsPerMatch).toBeLessThan(6);
    expect(setPieceGoalShare).toBeLessThan(0.5);
    expect(extremeOutlierShare).toBeLessThan(0.15);
    // AI/background familiarity must genuinely move from the raw, never-
    // played-a-match DEFAULT_FAMILIARITY (median 68 — confirmed the flat
    // value the previous pass permanently left it at) once real matches are
    // played — this was the confirmed gap from the previous pass. It is
    // legitimate for the gain to converge/plateau across later seasons
    // (diminishing headroom as a dimension nears mastery), so seasons only
    // need to hold that gain, not keep climbing indefinitely.
    const DEFAULT_FAMILIARITY_MEDIAN = 68;
    for (const snapshot of familiaritySnapshotsBySeason) {
      expect(snapshot.median).toBeGreaterThan(DEFAULT_FAMILIARITY_MEDIAN);
    }
    const lastMedian = familiaritySnapshotsBySeason[familiaritySnapshotsBySeason.length - 1]!.median;
    const firstMedian = familiaritySnapshotsBySeason[0]!.median;
    expect(lastMedian).toBeGreaterThanOrEqual(firstMedian);
  }, 600_000);
});
