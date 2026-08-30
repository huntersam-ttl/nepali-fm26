import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorldRepository, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, simulateNepalCareer } from "@nepal-football-sim/simulation";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const seed = process.env.LONG_SAVE_SEED ?? "long-save-post-freeze-2026";
const targetSeasons = Number(process.env.LONG_SAVE_SEASONS ?? "20");
const checkpointInterval = Number(process.env.LONG_SAVE_CHECKPOINT ?? "5");
const outputPath = process.env.LONG_SAVE_OUTPUT;
const diagnosticRun = process.env.LONG_SAVE_DIAGNOSTIC === "1";
const temporaryDirectories: string[] = [];

type ScalarRow = { count: number };
type Snapshot = {
  season: number;
  worldDate: string;
  elapsedMs: number;
  rssBytes: number;
  databaseBytes: number;
  inspection: ReturnType<WorldRepository["inspectWorld"]>;
  tableCounts: Record<string, number>;
  duplicateIds: Record<string, number>;
  finiteFinancialValues: boolean;
  competitionState: { completed: number; rolledOver: number; suspended: number };
  squadHealth: { emergencyLineupCases: number; positionShortages: number };
  phaseTimings: Record<string, number>;
};

const count = (db: GameDatabase, table: string): number =>
  Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as ScalarRow).count);

const snapshot = (db: GameDatabase, databasePath: string, season: number, startedAt: number, report: ReturnType<typeof simulateNepalCareer>): Snapshot => {
  const tables = [
    "persons", "player_attributes", "player_factual_profiles", "player_retirement_states",
    "staff_profiles", "referee_profiles", "clubs", "fixtures", "matches", "competition_season_states",
    "financial_transactions", "training_history_events", "football_history_events", "club_ownership_history",
    "federation_leadership_tenures", "territorial_development_projects", "foreign_player_profiles",
  ];
  const tableCounts = Object.fromEntries(tables.filter((table) => tableExists(db, table)).map((table) => [table, count(db, table)]));
  const duplicateIds = Object.fromEntries(
    ["persons", "clubs", "fixtures", "matches", "training_history_events"]
      .filter((table) => tableExists(db, table))
      .map((table) => [table, Number((db.prepare(`SELECT COUNT(*) - COUNT(DISTINCT id) AS count FROM ${table}`).get() as ScalarRow).count)]),
  );
  const financialValues = db.prepare("SELECT amount_minor FROM financial_transactions WHERE amount_minor IS NOT NULL").all() as Array<{ amount_minor: number }>;
  const stateRows = db.prepare("SELECT status, COUNT(*) AS count FROM competition_season_states GROUP BY status").all() as Array<{ status: string; count: number }>;
  const stateCount = (status: string): number => Number(stateRows.find((row) => row.status === status)?.count ?? 0);
  const squadHealth = report.seasons.reduce(
    (total, item) => ({ emergencyLineupCases: total.emergencyLineupCases + item.squadHealth.emergencyLineupCases, positionShortages: total.positionShortages + item.squadHealth.clubsWithPositionShortages }),
    { emergencyLineupCases: 0, positionShortages: 0 },
  );
  return {
    season,
    worldDate: report.worldDate,
    elapsedMs: Date.now() - startedAt,
    rssBytes: process.memoryUsage().rss,
    databaseBytes: statSync(databasePath).size,
    inspection: new WorldRepository(db).inspectWorld(),
    tableCounts,
    duplicateIds,
    finiteFinancialValues: financialValues.every((row) => Number.isFinite(Number(row.amount_minor))),
    competitionState: { completed: stateCount("COMPLETED"), rolledOver: stateCount("ROLLED_OVER"), suspended: stateCount("SUSPENDED") },
    squadHealth,
    phaseTimings: report.phaseTimings.at(-1)?.phases ?? {},
  };
};

const tableExists = (db: GameDatabase, table: string): boolean =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));

const runLongSave = (seasons: number): { snapshots: Snapshot[]; final: Snapshot } => {
  const directory = mkdtempSync(join(tmpdir(), "nepal-long-save-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "long-save.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Long save ${seasons} seasons`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  const snapshots: Snapshot[] = [];
  const writeProgress = (): void => {
    if (!outputPath) return;
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify({ seed, seasons, databasePath, snapshots, final: snapshots.at(-1) ?? null }, null, 2));
  };
  const startedAt = Date.now();
  let completed = 0;
  while (completed < seasons) {
    let db = openGameDatabase(databasePath);
    const chunk = Math.min(checkpointInterval, seasons - completed);
    const report = simulateNepalCareer({ db, seasons: chunk, seed, savePath: databasePath });
    const season = completed + chunk;
    if (season === 0) throw new Error(`Long-save progression stopped at chunk ${completed}`);
    db.close();
    db = openGameDatabase(databasePath);
    if (season >= checkpointInterval || season === seasons) {
      const current = snapshot(db, databasePath, season, startedAt, report);
      snapshots.push(current);
      process.stdout.write(`${JSON.stringify({ type: "long-save-checkpoint", ...current })}\n`);
      writeProgress();
    }
    db.close();
    completed = season;
  }
  const final = snapshots.at(-1)!;
  writeProgress();
  return { snapshots, final };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const longSaveDescribe = process.env.LONG_SAVE_RUN === "1" ? describe : describe.skip;

longSaveDescribe("post-freeze long-save structural validation", () => {
  it(`completes ${targetSeasons} seasons through production progression and reload checkpoints`, () => {
    expect(targetSeasons).toBeGreaterThanOrEqual(diagnosticRun ? 1 : 20);
    expect(checkpointInterval).toBeGreaterThan(0);
    const result = runLongSave(targetSeasons);
    expect(result.final.season).toBe(targetSeasons);
    expect(Object.values(result.final.duplicateIds).every((duplicates) => duplicates === 0)).toBe(true);
    expect(result.final.finiteFinancialValues).toBe(true);
    expect(result.final.squadHealth.emergencyLineupCases).toBe(0);
    expect(result.final.squadHealth.positionShortages).toBe(0);
    expect(result.final.competitionState.completed).toBeGreaterThan(0);
    expect(result.snapshots.length).toBeGreaterThanOrEqual(Math.floor(targetSeasons / checkpointInterval));
    if (outputPath) expect(existsSync(outputPath)).toBe(true);
  }, 1_800_000);
});
