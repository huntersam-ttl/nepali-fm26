import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GlobalFootballContextRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  advanceExternalPlayerLifecycles,
  createNepalSave,
  initializeForeignFootballWorldForSave,
  initializeTransferMarketForSave,
  processForeignFootballWorldSeason,
} from "@nepal-football-sim/simulation";

/*
 * External reputation is the standing the rest of the world holds a player in.
 * It has to move — otherwise a long career runs against a frozen backdrop — but
 * it must move slowly, stay inside its scale, and never apply twice for the
 * same season. These tests pin that contract, and the shape of how a generated
 * player can grow into a well-regarded one.
 */

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const createWorld = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-external-reputation-"));
  tempDirs.push(dir);
  const databasePath = join(dir, "world.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Reputation ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  const db = openGameDatabase(databasePath);
  try {
    initializeTransferMarketForSave({ db, worldDate: "2026-08-01", seed });
    initializeForeignFootballWorldForSave({ db, worldDate: "2026-08-01", seed });
  } finally {
    db.close();
  }
  return databasePath;
};

type Db = ReturnType<typeof openGameDatabase>;
const contexts = (db: Db) => new GlobalFootballContextRepository(db).players();
const reputations = (db: Db) => new Map(contexts(db).map((p) => [p.playerId, p.reputation]));
const changed = (before: Map<EntityId, number>, after: Map<EntityId, number>): number =>
  [...before].filter(([id, value]) => (after.get(id) ?? value) !== value).length;

/** Players the world generated, as opposed to imported factual identities. */
const generatedIds = (db: Db): Set<string> =>
  new Set(
    (
      db.prepare("SELECT player_id AS id FROM generated_player_origins").all() as Array<{
        id: string;
      }>
    ).map((row) => row.id),
  );

const season = (db: Db, year: number, seed: string): void => {
  processForeignFootballWorldSeason({ db, seasonEndDate: `${year}-06-30`, seed });
  advanceExternalPlayerLifecycles(db, { date: `${year}-06-30`, seed });
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("external reputation progression", () => {
  it("moves reputation across a season and keeps it inside the scale", () => {
    const databasePath = createWorld("progress");
    const db = openGameDatabase(databasePath);
    try {
      const before = reputations(db);
      expect(before.size).toBeGreaterThan(0);

      season(db, 2027, "progress");
      const after = reputations(db);

      expect(changed(before, after)).toBeGreaterThan(0);
      for (const value of after.values()) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    } finally {
      db.close();
    }
  }, 600000);

  it("applies a season exactly once, however often it is replayed", () => {
    const databasePath = createWorld("once");
    const db = openGameDatabase(databasePath);
    try {
      const before = reputations(db);
      advanceExternalPlayerLifecycles(db, { date: "2027-06-30", seed: "once" });
      const afterFirst = reputations(db);
      expect(changed(before, afterFirst)).toBeGreaterThan(0);

      // Replaying the same season — a resumed career, a re-entered tick — must
      // not move anyone a second time.
      advanceExternalPlayerLifecycles(db, { date: "2027-06-30", seed: "once" });
      advanceExternalPlayerLifecycles(db, { date: "2027-06-30", seed: "once" });
      expect(changed(afterFirst, reputations(db))).toBe(0);

      // A later season is a new one and may move players again.
      advanceExternalPlayerLifecycles(db, { date: "2028-06-30", seed: "once" });
      expect(changed(afterFirst, reputations(db))).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  }, 600000);

  it("stops progressing a player once they retire, without losing them", () => {
    const databasePath = createWorld("retired");
    const db = openGameDatabase(databasePath);
    try {
      for (const year of [2028, 2032, 2036]) season(db, year, "retired");
      const retired = contexts(db).filter((player) => player.careerState === "RETIRED");
      expect(retired.length).toBeGreaterThan(0);

      const before = new Map(retired.map((player) => [player.playerId, player.reputation]));
      season(db, 2038, "retired");
      const after = reputations(db);

      // Their final standing is fixed, and they remain readable.
      for (const [id, value] of before) {
        expect(after.get(id)).toBe(value);
        expect(db.prepare("SELECT COUNT(*) n FROM persons WHERE id = ?").get(id)).toEqual({ n: 1 });
      }
    } finally {
      db.close();
    }
  }, 900000);

  it("progresses imported and generated players through the same path", () => {
    const databasePath = createWorld("parity");
    const db = openGameDatabase(databasePath);
    try {
      const generated = generatedIds(db);
      const before = reputations(db);
      season(db, 2027, "parity");
      const after = reputations(db);

      const movedGenerated = [...before].filter(
        ([id, value]) => generated.has(id) && (after.get(id) ?? value) !== value,
      ).length;
      const movedImported = [...before].filter(
        ([id, value]) => !generated.has(id) && (after.get(id) ?? value) !== value,
      ).length;

      // Neither origin is excluded from the progression path.
      expect(movedGenerated).toBeGreaterThan(0);
      expect(movedImported).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  }, 600000);

  it("preserves reputation across reload and resumes from it", () => {
    const databasePath = createWorld("reload");
    let saved: Map<EntityId, number>;
    const db = openGameDatabase(databasePath);
    try {
      season(db, 2027, "reload");
      saved = reputations(db);
    } finally {
      db.close();
    }

    const reloaded = openGameDatabase(databasePath);
    try {
      expect(reputations(reloaded)).toEqual(saved!);
      // Replaying the season just completed is still a no-op after reload.
      advanceExternalPlayerLifecycles(reloaded, { date: "2027-06-30", seed: "reload" });
      expect(reputations(reloaded)).toEqual(saved!);
      // The next season resumes from the persisted values.
      season(reloaded, 2028, "reload");
      expect(changed(saved!, reputations(reloaded))).toBeGreaterThan(0);
    } finally {
      reloaded.close();
    }
  }, 900000);

  it("lets a generated player grow into a well-regarded one without minting stars", () => {
    const databasePath = createWorld("emergence");
    const db = openGameDatabase(databasePath);
    try {
      const generated = generatedIds(db);
      const start = new Map(
        contexts(db)
          .filter((player) => generated.has(player.playerId))
          .map((player) => [player.playerId, player.reputation]),
      );
      expect(start.size).toBeGreaterThan(0);

      for (const year of [2027, 2028, 2029, 2030, 2031, 2032]) season(db, year, "emergence");

      const end = contexts(db).filter(
        (player) => generated.has(player.playerId) && player.careerState !== "RETIRED",
      );
      const risen = end.filter((player) => player.reputation > (start.get(player.playerId) ?? 0));
      // Standing is earned over seasons rather than granted at generation.
      expect(risen.length).toBeGreaterThan(0);

      // Growth stays gradual: nobody vaults the scale in six seasons.
      for (const player of end) {
        const from = start.get(player.playerId) ?? 0;
        expect(player.reputation - from).toBeLessThan(40);
        expect(player.reputation).toBeLessThanOrEqual(100);
      }

      // And the cohort stays ordinary in the main: a high tier is the exception.
      const all = contexts(db).filter((player) => player.careerState !== "RETIRED");
      const sorted = all.map((player) => player.reputation).sort((a, b) => b - a);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const elite = all.filter((player) => player.reputation >= 70).length;
      expect(median).toBeLessThan(50);
      expect(elite).toBeLessThan(all.length * 0.1);
    } finally {
      db.close();
    }
  }, 1200000);

  it("keeps the external population and reputation spread stable over five seasons", () => {
    const databasePath = createWorld("structure");
    const db = openGameDatabase(databasePath);
    try {
      const startActive = contexts(db).filter((p) => p.careerState !== "RETIRED").length;
      const before = reputations(db);
      for (const year of [2027, 2028, 2029, 2030, 2031]) season(db, year, "structure");

      const active = contexts(db).filter((player) => player.careerState !== "RETIRED");
      const after = reputations(db);
      expect(active.length).toBeGreaterThan(0);
      expect(active.length).toBeLessThanOrEqual(startActive * 2);

      // A world where everyone moves the same way is not a distribution.
      const up = [...before].filter(([id, v]) => (after.get(id) ?? v) > v).length;
      const flat = [...before].filter(([id, v]) => (after.get(id) ?? v) === v).length;
      expect(up).toBeGreaterThan(0);
      expect(flat).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  }, 1200000);
});
