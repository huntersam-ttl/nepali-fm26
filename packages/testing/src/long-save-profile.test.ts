import { copyFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, it } from "vitest";
import { openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";

/*
 * Measurement harness for save growth and season cost (Phase 11B). Opt-in:
 * it plays real seasons through Continue / Quick Sim / the staged transition
 * and writes one JSON report. It asserts nothing about numbers.
 *
 *   NEPAL_PROFILE_SEASONS=3 NEPAL_PROFILE_OUT=<file> vitest run long-save-profile
 */

const seasons = Number(process.env.NEPAL_PROFILE_SEASONS ?? 0);
const outFile = process.env.NEPAL_PROFILE_OUT ?? join(tmpdir(), "long-save-profile.json");
const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterAll(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })));

const character = {
  fullName: "Profile Tester",
  dateOfBirth: "1985-01-01",
  startingAge: 41,
  languages: ["en"],
  footballBackground: "COMMUNITY_COACHING",
  education: "SPORTS_RELATED_DEGREE",
  playingExperience: "AMATEUR_PLAYER",
  coachingExperience: "YOUTH_COACH",
  businessBackground: "SMALL_BUSINESS",
  startingReputationProfile: "LOCAL_RESPECTED",
};

type DatabaseSync = { prepare: (sql: string) => unknown };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: { prototype: DatabaseSync } };
type QueryStat = { calls: number; ms: number };
let phase = "setup";
const stats = new Map<string, Map<string, QueryStat>>();
const HIRING_SQL = /manager_job_|universal_interactions|interaction_memories|manager_contracts|manager_profiles|manager_job_negotiations/i;
const hiringStats = new Map<string, QueryStat>();
const originalPrepare = DatabaseSync.prototype.prepare;
const normalise = (sql: string): string => sql.replace(/\s+/g, " ").trim().slice(0, 160);
if (seasons > 0) DatabaseSync.prototype.prepare = function patched(this: DatabaseSync, sql: string): unknown {
  const statement = originalPrepare.call(this, sql);
  const key = normalise(sql);
  for (const method of ["run", "get", "all"] as const) {
    const original = (statement as unknown as Record<string, (...args: unknown[]) => unknown>)[method]!.bind(statement);
    (statement as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      const started = performance.now();
      try {
        return original(...args);
      } finally {
        if (HIRING_SQL.test(key)) {
          const hiring = hiringStats.get(phase) ?? { calls: 0, ms: 0 };
          hiring.calls += 1;
          hiring.ms += performance.now() - started;
          hiringStats.set(phase, hiring);
        }
        const bucket = stats.get(phase) ?? new Map<string, QueryStat>();
        stats.set(phase, bucket);
        const entry = bucket.get(key) ?? { calls: 0, ms: 0 };
        entry.calls += 1;
        entry.ms += performance.now() - started;
        bucket.set(key, entry);
      }
    };
  }
  return statement;
};

const topQueries = (name: string, limit = 25) =>
  [...(stats.get(name) ?? new Map<string, QueryStat>()).entries()]
    .map(([sql, stat]) => ({ sql, calls: stat.calls, ms: Math.round(stat.ms) }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit);

const snapshot = (savePath: string) => {
  const db = openGameDatabase(savePath);
  try {
    const pragma = (name: string) => Object.values(db.prepare(`PRAGMA ${name}`).get() as Record<string, number>)[0]!;
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((row) => row.name);
    const bytes = new Map<string, number>();
    let dbstat = true;
    try {
      for (const row of db.prepare("SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name").all() as Array<{ name: string; bytes: number }>) bytes.set(row.name, row.bytes);
    } catch {
      dbstat = false;
    }
    const indexes = db.prepare("SELECT name, tbl_name AS tbl FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all() as Array<{ name: string; tbl: string }>;
    const rows: Record<string, { rows: number; bytes: number; indexBytes: number }> = {};
    for (const table of tables) {
      const n = (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
      const indexBytes = indexes.filter((index) => index.tbl === table).reduce((sum, index) => sum + (bytes.get(index.name) ?? 0), 0);
      rows[table] = { rows: n, bytes: bytes.get(table) ?? 0, indexBytes };
    }
    const largestIndexes = indexes
      .map((index) => ({ name: index.name, table: index.tbl, bytes: bytes.get(index.name) ?? 0 }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 20);
    const one = (sql: string) => Object.values(db.prepare(sql).get() as Record<string, number | null>)[0] ?? 0;
    const hiring = {
      vacancies: one("SELECT COUNT(*) FROM manager_job_vacancies"),
      filled: one("SELECT COUNT(*) FROM manager_job_vacancies WHERE status = 'FILLED'"),
      open: one("SELECT COUNT(*) FROM manager_job_vacancies WHERE status = 'OPEN'"),
      avgDaysToFill: one("SELECT ROUND(AVG(julianday(filled_on) - julianday(opened_on)), 1) FROM manager_job_vacancies WHERE status = 'FILLED'"),
      applications: one("SELECT COUNT(*) FROM manager_job_applications"),
      applicationsByStatus: db.prepare("SELECT status, COUNT(*) AS n FROM manager_job_applications GROUP BY status").all(),
      maxApplicationsPerVacancyCandidate: one("SELECT MAX(n) FROM (SELECT COUNT(*) AS n FROM manager_job_applications GROUP BY vacancy_id, manager_profile_id)"),
      candidates: one("SELECT COUNT(DISTINCT manager_profile_id) FROM manager_job_applications"),
      profiles: one("SELECT COUNT(*) FROM manager_profiles"),
      activeContracts: one("SELECT COUNT(*) FROM manager_contracts WHERE status = 'ACTIVE'"),
      teamsWithMultipleActive: one("SELECT COUNT(*) FROM (SELECT team_id FROM manager_contracts WHERE status = 'ACTIVE' GROUP BY team_id HAVING COUNT(*) > 1)"),
      profilesWithMultipleActive: one("SELECT COUNT(*) FROM (SELECT manager_profile_id FROM manager_contracts WHERE status = 'ACTIVE' GROUP BY manager_profile_id HAVING COUNT(*) > 1)"),
      filledWithoutActiveContract: one("SELECT COUNT(*) FROM manager_job_vacancies v WHERE v.status = 'FILLED' AND NOT EXISTS (SELECT 1 FROM manager_contracts c WHERE c.id = v.filled_by_contract_id)"),
    };
    return {
      hiring,
      fileMB: +(statSync(savePath).size / 1048576).toFixed(1),
      pageSize: pragma("page_size"),
      pageCount: pragma("page_count"),
      freelistCount: pragma("freelist_count"),
      dbstat,
      tables: rows,
      largestIndexes,
    };
  } finally {
    db.close();
  }
};

const play = (service: DesktopApplicationService): void => {
  for (let guard = 0; guard < 700; guard += 1) {
    const status = service.getSeasonStatus();
    if (!status.ok) throw new Error(status.error.message);
    if (status.data.phase !== "IN_PROGRESS") return;
    const step = service.continueCareer();
    if (!step.ok) throw new Error(`continue: ${step.error.code} ${step.error.message}`);
    service.quickSimMatch();
  }
  throw new Error("The season never completed.");
};

const transition = (service: DesktopApplicationService) => {
  const stages: Array<{ key: string; durationMs?: number }> = [];
  for (let guard = 0; guard < 40; guard += 1) {
    const step = service.advanceSeasonTransition();
    if (!step.ok) throw new Error(`${step.error.code}: ${step.error.message}`);
    if (step.data.seasonStatus.phase === "TRANSITION_FAILED") throw new Error(step.data.seasonStatus.transition?.error ?? "failed");
    if (step.data.finished) {
      for (const stage of step.data.seasonStatus.stages) stages.push({ key: stage.key, durationMs: stage.durationMs });
      return stages;
    }
  }
  throw new Error("The transition never finished.");
};

describe.skipIf(seasons === 0)("long save profile", () => {
  it(`plays ${seasons} seasons and records size, rows and timings`, () => {
    const directory = mkdtempSync(join(tmpdir(), "profile-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
    phase = "create";
    const created = service.createCareer({ saveName: process.env.NEPAL_PROFILE_NAME ?? "profile", character: process.env.NEPAL_PROFILE_NAME ? { ...character, fullName: "Storage Tester" } : character });
    if (!created.ok) throw new Error(created.error.message);
    const savePath = created.data.catalogEntry.filePath;
    const report: Record<string, unknown> = { checkpoints: [] as unknown[] };
    const checkpoints = report.checkpoints as unknown[];
    service.closeCareer();
    checkpoints.push({ label: "start", ...snapshot(savePath) });
    service.loadCareerByPath(savePath);

    for (let season = 1; season <= seasons; season += 1) {
      phase = `play-${season}`;
      const playStart = Date.now();
      play(service);
      const playSeconds = (Date.now() - playStart) / 1000;
      service.closeCareer();
      checkpoints.push({ label: `S${season}-played`, playSeconds, ...snapshot(savePath) });
      service.loadCareerByPath(savePath);

      phase = `transition-${season}`;
      const transitionStart = Date.now();
      const stages = transition(service);
      const transitionSeconds = (Date.now() - transitionStart) / 1000;
      service.closeCareer();
      checkpoints.push({ label: `S${season}-rolled`, transitionSeconds, stages, ...snapshot(savePath) });
      service.loadCareerByPath(savePath);
      report[`hiringStatements-play-${season}`] = { ...(hiringStats.get(`play-${season}`) ?? { calls: 0, ms: 0 }), ms: Math.round(hiringStats.get(`play-${season}`)?.ms ?? 0) };
      report[`hiringStatements-transition-${season}`] = { ...(hiringStats.get(`transition-${season}`) ?? { calls: 0, ms: 0 }), ms: Math.round(hiringStats.get(`transition-${season}`)?.ms ?? 0) };
      report[`topQueries-play-${season}`] = topQueries(`play-${season}`);
      report[`topQueries-transition-${season}`] = topQueries(`transition-${season}`);
      writeFileSync(outFile, JSON.stringify(report));
    }
    service.closeCareer();
    writeFileSync(outFile, JSON.stringify(report));
    if (process.env.NEPAL_PROFILE_KEEP) copyFileSync(savePath, process.env.NEPAL_PROFILE_KEEP);
  }, 7_200_000);
});

export type { GameDatabase };
