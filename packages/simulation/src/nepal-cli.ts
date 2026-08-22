import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createNepalSave } from "./nepal-save.js";

const [, , datasetPath, databasePath, saveName] = process.argv;
const invocationCwd = process.env.INIT_CWD ?? process.cwd();

if (!datasetPath || !databasePath) {
  console.error(
    "Usage: nepal-football-create-save <dataset-json-path> <sqlite-save-path> [save-name]",
  );
  process.exit(1);
}

const dataset = JSON.parse(readFileSync(resolve(invocationCwd, datasetPath), "utf8")) as unknown;
const result = createNepalSave({
  databasePath: resolve(invocationCwd, databasePath),
  dataset,
  saveName,
  gameVersion: "0.2.0",
  randomSeed: "nepal-stage-two",
});

console.log(JSON.stringify(result, null, 2));
