import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave } from "./nepal-save.js";
import { runYouthDiagnostic } from "./youth-intake.js";

const invocationCwd = process.env.INIT_CWD ?? process.cwd();
const args = parseArgs(process.argv.slice(2));
const seed = args.seed ?? "nepal-youth-diagnostic";
const seasons = Number(args.seasons ?? "10");
const startDate = args["start-date"] ?? "2026-08-15";
const datasetPath = resolve(invocationCwd, args.dataset ?? "data/nepal/2026-08/club-registry.json");
const savePath = resolve(
  invocationCwd,
  args["save-path"] ?? join(tmpdir(), `nepal-youth-${seed}-${process.pid}.sqlite`),
);

if (!Number.isInteger(seasons) || seasons < 1) {
  throw new Error("--seasons must be a positive integer");
}

if (!existsSync(savePath)) {
  createNepalSave({
    databasePath: savePath,
    dataset: JSON.parse(readFileSync(datasetPath, "utf8")) as unknown,
    saveName: "Nepal Youth Diagnostic",
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
}

const db = openGameDatabase(savePath);
const report = runYouthDiagnostic({ db, seed, startDate, seasons });
db.close();

console.log(JSON.stringify({ savePath, ...report }, null, 2));

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
