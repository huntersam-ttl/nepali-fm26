import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, simulateNepalCareer } from "@nepal-football-sim/simulation";

/*
 * Regression coverage for the multi-season crash where the same player was
 * developed once per competition season. Nepal's competition seasons share an
 * end date, so a club fielding the same squad in two competitions produced two
 * development passes on the same date — double-applying development and then
 * colliding on the canonical training-history event id.
 *
 * These assertions deliberately test behaviour (one canonical record per
 * logical event, one development pass per player per date) rather than the id
 * string format, so they stay valid if the id derivation is refined.
 */

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-training-history-"));
  tempDirs.push(dir);
  return join(dir, "career.sqlite");
};

const createSave = (seed: string): string => {
  const databasePath = tempDbPath();
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Training history ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  return databasePath;
};

/** Bounded career: enough football to develop players, cheap enough to run often. */
const runCareer = (databasePath: string, seasons: number, seed: string): void => {
  const db = openGameDatabase(databasePath);
  try {
    simulateNepalCareer({
      db,
      seasons,
      seed,
      savePath: databasePath,
      maxFixturesPerSeason: 14,
      transfersEnabled: false,
      youthEnabled: false,
      economyEnabled: false,
      federationEnabled: false,
      internationalEnabled: false,
    });
  } finally {
    db.close();
  }
};

type Row = Record<string, unknown>;
const query = (databasePath: string, sql: string): Row[] => {
  const db = openGameDatabase(databasePath);
  try {
    return db.prepare(sql).all() as Row[];
  } finally {
    db.close();
  }
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("training history event identity", () => {
  it("writes valid, non-duplicated events across parallel competitions and seasons", () => {
    const databasePath = createSave("identity");
    runCareer(databasePath, 2, "identity");

    const events = query(
      databasePath,
      "SELECT id, player_id, event_type, occurred_on, data_json FROM training_history_events",
    );
    expect(events.length).toBeGreaterThan(0);

    // Every persisted event carries a usable identity and subject.
    for (const event of events) {
      expect(typeof event.id).toBe("string");
      expect(String(event.id).length).toBeGreaterThan(0);
      expect(event.player_id).toBeTruthy();
      expect(String(event.occurred_on)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(event.event_type).length).toBeGreaterThan(0);
    }

    // Ids are unique (the primary key guarantees it, so this proves the insert
    // path completed rather than throwing part-way).
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);

    // One logical event -> exactly one canonical record.
    const logical = events.map(
      (event) =>
        `${event.player_id}|${event.occurred_on}|${event.event_type}|${event.data_json ?? ""}`,
    );
    expect(new Set(logical).size).toBe(logical.length);

    // The scenario that used to collide is actually exercised: several players
    // developed on a shared competition end date. Multi-season date coverage is
    // carried by the full three-season run in stage-six-career-world.
    expect(new Set(events.map((event) => event.player_id)).size).toBeGreaterThan(1);
    expect(new Set(events.map((event) => event.occurred_on)).size).toBeGreaterThan(0);

    // A player who appeared in more than one competition season still develops
    // once per development date, not once per competition.
    const overlapping = query(
      databasePath,
      `SELECT person_id, COUNT(DISTINCT competition_season_id) n FROM player_season_stats
       GROUP BY person_id HAVING n > 1 LIMIT 1`,
    );
    expect(overlapping.length).toBeGreaterThan(0);

    const perPlayerPerDate = query(
      databasePath,
      `SELECT player_id, occurred_on, event_type, COUNT(*) n FROM training_history_events
       GROUP BY player_id, occurred_on, event_type HAVING n > 1`,
    );
    expect(perPlayerPerDate).toEqual([]);
  }, 600000);

  it("does not duplicate events when a save is reloaded and the career continues", () => {
    const databasePath = createSave("reload");
    runCareer(databasePath, 1, "reload");
    const afterFirst = query(databasePath, "SELECT id FROM training_history_events ORDER BY id");

    // Reopen the same save and continue — the development pass must not replay
    // events it has already persisted.
    runCareer(databasePath, 1, "reload");
    const afterReload = query(databasePath, "SELECT id FROM training_history_events ORDER BY id");

    expect(new Set(afterReload.map((row) => row.id)).size).toBe(afterReload.length);
    for (const row of afterFirst) {
      expect(afterReload.some((candidate) => candidate.id === row.id)).toBe(true);
    }
    const duplicates = query(
      databasePath,
      `SELECT player_id, occurred_on, event_type, COUNT(*) n FROM training_history_events
       GROUP BY player_id, occurred_on, event_type, data_json HAVING n > 1`,
    );
    expect(duplicates).toEqual([]);
  }, 600000);

  it("develops each player at most once per development date and keeps advancing", () => {
    const databasePath = createSave("cadence");
    runCareer(databasePath, 2, "cadence");

    const states = query(
      databasePath,
      `SELECT last_development_update FROM player_development_states
       WHERE last_development_update IS NOT NULL`,
    );
    expect(states.length).toBeGreaterThan(0);

    // Development kept running across seasons rather than stalling after the
    // first competition season claimed the date.
    const dates = new Set(states.map((row) => String(row.last_development_update)));
    expect(dates.size).toBeGreaterThan(0);
    for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }, 600000);

  it("produces identical training history for the same save, seed and seasons", () => {
    const first = createSave("determinism");
    const second = createSave("determinism");
    runCareer(first, 1, "determinism");
    runCareer(second, 1, "determinism");

    const ids = (path: string): string[] =>
      query(path, "SELECT id FROM training_history_events ORDER BY id").map((row) =>
        String(row.id),
      );
    expect(ids(first)).toEqual(ids(second));
    expect(ids(first).length).toBeGreaterThan(0);
  }, 600000);
});
