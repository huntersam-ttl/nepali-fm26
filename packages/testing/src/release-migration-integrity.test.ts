import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CURRENT_DATABASE_VERSION,
  HIGHEST_KNOWN_SCHEMA_VERSION,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";

/**
 * Release-candidate migration integrity: the migration chain itself, not
 * gameplay behaviour. `createNepalSave` (used by essentially every other
 * test in this suite) already proves a fresh database reaches the latest
 * schema thousands of times over — this test isolates the migration runner's
 * own contract: gapless version chain, idempotent re-application, and a
 * real schema_migrations ledger a support engineer could inspect.
 */

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("release: migration chain integrity", () => {
  it("takes a brand-new empty database to the highest known schema version, recording every step", () => {
    const dir = mkdtempSync(join(tmpdir(), "migration-integrity-"));
    dirs.push(dir);
    const db = openGameDatabase(join(dir, "fresh.sqlite"));
    const result = migrateDatabase(db);
    expect(result).toBe(CURRENT_DATABASE_VERSION);

    const applied = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;
    expect(applied.length).toBe(HIGHEST_KNOWN_SCHEMA_VERSION);
    // No gaps, no duplicates, in strict ascending order — a broken chain
    // (a skipped or double-applied version) fails here immediately.
    const versions = applied.map((row) => row.version);
    expect(versions).toEqual(Array.from({ length: HIGHEST_KNOWN_SCHEMA_VERSION }, (_, i) => i + 1));
    db.close();
  });

  it("is idempotent — re-running the full chain on an already-migrated database applies nothing new", () => {
    const dir = mkdtempSync(join(tmpdir(), "migration-idempotent-"));
    dirs.push(dir);
    const db = openGameDatabase(join(dir, "twice.sqlite"));
    migrateDatabase(db);
    const beforeCount = (
      db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }
    ).c;
    const beforeTimestamps = db
      .prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version")
      .all();

    // Re-running must be a pure no-op: no re-applied SQL, no rewritten
    // applied_at timestamps, no duplicate rows.
    migrateDatabase(db);
    const afterCount = (
      db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }
    ).c;
    const afterTimestamps = db
      .prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version")
      .all();
    expect(afterCount).toBe(beforeCount);
    expect(afterTimestamps).toEqual(beforeTimestamps);
    db.close();
  });
});
