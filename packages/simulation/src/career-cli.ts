import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { createNepalSave } from "./nepal-save.js";
import { simulateNepalCareer } from "./career-world.js";

const invocationCwd = process.env.INIT_CWD ?? process.cwd();
const args = parseArgs(process.argv.slice(2));
const seasons = Number(args.seasons ?? "3");
const seed = args.seed ?? "nepal-career-default";
const datasetPath = resolve(invocationCwd, args.dataset ?? "data/nepal/2026-08/club-registry.json");
const savePath = resolve(
  invocationCwd,
  args["save-path"] ?? join(tmpdir(), `nepal-career-${seed}-${seasons}.sqlite`),
);

if (!Number.isInteger(seasons) || seasons < 1) {
  throw new Error("--seasons must be a positive integer");
}

if (!existsSync(savePath)) {
  createNepalSave({
    databasePath: savePath,
    dataset: JSON.parse(readFileSync(datasetPath, "utf8")) as unknown,
    saveName: `Nepal Career ${seasons} seasons`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
}

const db = openGameDatabase(savePath);
const report = simulateNepalCareer({
  db,
  seasons,
  seed,
  competitionSeasonId: args.competition as EntityId | undefined,
  savePath,
});
db.close();

console.log(JSON.stringify(report, null, 2));

function parseArgs(values: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!value.startsWith("--")) {
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    parsed[key] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) {
      index += 1;
    }
  }
  return parsed;
}
