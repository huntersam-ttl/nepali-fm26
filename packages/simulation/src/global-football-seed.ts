import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GameDatabase } from "@nepal-football-sim/database";
import type { GlobalImportPlan } from "@nepal-football-sim/data-import";
import { applyGlobalFootballImportToDatabase } from "./global-football-import.js";

/**
 * Where the committed global dataset lives, relative to the repository root.
 * Runtime reads this artifact and nothing else — never the research workbook it
 * was generated from, and never a developer's local files.
 */
export const CANONICAL_GLOBAL_SEED_PATH = "data/global/football-world-v16.seed.json";

export type GlobalSeedOutcome = {
  applied: boolean;
  datasetVersion?: string;
  reason?: "ALREADY_APPLIED" | "SEED_UNAVAILABLE";
  counts?: Record<string, number>;
};

const seedFile = (seedPath?: string): string | undefined => {
  const candidate = resolve(process.cwd(), seedPath ?? CANONICAL_GLOBAL_SEED_PATH);
  return existsSync(candidate) ? candidate : undefined;
};

/** The dataset version already recorded as active on this world, if any. */
const activeDatasetVersion = (db: GameDatabase, datasetVersion: string): boolean =>
  Boolean(
    db
      .prepare(
        "SELECT 1 FROM global_dataset_imports WHERE dataset_version = ? AND status = 'ACTIVE' LIMIT 1",
      )
      .get(datasetVersion),
  );

/**
 * Applies the committed global dataset to a world exactly once.
 *
 * Idempotent by dataset version: re-running against the same world is a no-op,
 * so repeated initialization cannot duplicate people, clubs or leagues. A world
 * built without the artifact present stays Nepal-only rather than failing.
 */
export const applyCanonicalGlobalDatasetSeed = (
  db: GameDatabase,
  options: { seedPath?: string } = {},
): GlobalSeedOutcome => {
  const file = seedFile(options.seedPath);
  if (!file) return { applied: false, reason: "SEED_UNAVAILABLE" };
  const plan = JSON.parse(readFileSync(file, "utf8")) as GlobalImportPlan;
  if (activeDatasetVersion(db, plan.datasetVersion)) {
    return { applied: false, datasetVersion: plan.datasetVersion, reason: "ALREADY_APPLIED" };
  }
  const counts = applyGlobalFootballImportToDatabase(db, plan);
  return { applied: true, datasetVersion: plan.datasetVersion, counts };
};
