import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";

export type GameDatabase = DatabaseSync;

const require = createRequire(import.meta.url);
const { DatabaseSync: SqliteDatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => DatabaseSync;
};

export const openGameDatabase = (filePath: string): GameDatabase => {
  if (filePath !== ":memory:") {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  const db = new SqliteDatabaseSync(filePath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  // In WAL mode NORMAL cannot corrupt the file: a crash can lose only the most
  // recent commits, never leave a half-written state. FULL fsyncs after every
  // statement, which made a full simulated season about six times slower.
  db.exec("PRAGMA synchronous = NORMAL;");
  // Memory only, no durability effect: a 64 MB page cache (the default is 2 MB, far
  // smaller than a multi-season save) and in-memory temporary sort/group structures.
  // Measured on a real save: about 8% off season play and 30% off the season transition.
  db.exec("PRAGMA cache_size = -65536;");
  db.exec("PRAGMA temp_store = MEMORY;");
  return db;
};
