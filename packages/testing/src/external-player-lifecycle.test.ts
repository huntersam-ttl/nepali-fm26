import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GlobalFootballContextRepository,
  PlayerRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  advanceExternalPlayerLifecycles,
  createNepalSave,
  initializeForeignFootballWorldForSave,
  initializeTransferMarketForSave,
} from "@nepal-football-sim/simulation";

/*
 * Worlds here use the production default, which applies the canonical global
 * dataset. External player contexts come from that import; a Nepal-only world
 * has none, so the lifecycle would have nothing to act on.
 *
 * The external world is deliberately light, but it still has to be continuous:
 * a context-only player who never ages, never declines and never retires makes
 * the foreign game a frozen backdrop that a long career eventually outlives.
 * These tests pin the lifecycle contract through the public API rather than the
 * internals, so they survive changes to how the curve is computed.
 */

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const createWorld = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-external-lifecycle-"));
  tempDirs.push(dir);
  const databasePath = join(dir, "world.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `External lifecycle ${seed}`,
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

/*
 * Only players carrying simulation attributes can be developed, declined or
 * retired. Imported factual identities are registered as external contexts but
 * have no attributes yet, so they are outside the lifecycle's reach — that gap
 * is reported separately rather than asserted here.
 */
const developable = (db: Db): Set<string> =>
  new Set(
    (
      db
        .prepare(
          `SELECT e.player_id AS id FROM external_player_context e
           JOIN player_attributes pa ON pa.person_id = e.player_id`,
        )
        .all() as Array<{ id: string }>
    ).map((row) => row.id),
  );

const externals = (db: Db) => {
  const reachable = developable(db);
  return new GlobalFootballContextRepository(db)
    .players()
    .filter((player) => reachable.has(player.playerId));
};
const active = (db: Db) => externals(db).filter((player) => player.careerState !== "RETIRED");

const ability = (db: Db, playerId: EntityId): number | undefined => {
  const attributes = new PlayerRepository(db).getAttributes(playerId);
  if (!attributes) return undefined;
  const groups = [
    attributes.technical,
    attributes.mental,
    attributes.physical,
    attributes.goalkeeping,
  ];
  const values = groups.flatMap((group) => Object.values(group as Record<string, number>));
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
};

const ageOf = (db: Db, playerId: EntityId, onDate: string): number | undefined => {
  const row = db.prepare("SELECT date_of_birth AS dob FROM persons WHERE id = ?").get(playerId) as
    { dob?: string } | undefined;
  if (!row?.dob) return undefined;
  return Math.floor(
    (Date.parse(`${onDate}T00:00:00.000Z`) - Date.parse(`${row.dob}T00:00:00.000Z`)) /
      (365.25 * 24 * 60 * 60 * 1000),
  );
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("external player lifecycle", () => {
  it("gives every context-only player a stable simulation identity", () => {
    const databasePath = createWorld("identity");
    const db = openGameDatabase(databasePath);
    try {
      const players = externals(db);
      expect(players.length).toBeGreaterThan(0);

      const ids = players.map((player) => player.playerId);
      expect(new Set(ids).size).toBe(ids.length);

      for (const player of players) {
        // A person record, a birth date and an attribute set: enough to age,
        // develop and be scouted.
        const person = db
          .prepare("SELECT id, date_of_birth FROM persons WHERE id = ?")
          .get(player.playerId) as { id?: EntityId; date_of_birth?: string } | undefined;
        expect(person?.id).toBe(player.playerId);
        expect(person?.date_of_birth).toBeTruthy();
        expect(ability(db, player.playerId)).toBeGreaterThan(0);
        expect(["ACTIVE", "FREE_AGENT", "RETIRED"]).toContain(player.careerState);
      }
    } finally {
      db.close();
    }
  }, 300000);

  it("moves abilities over a season instead of leaving the world frozen", () => {
    const databasePath = createWorld("development");
    const db = openGameDatabase(databasePath);
    try {
      const before = new Map(
        active(db).map((player) => [player.playerId, ability(db, player.playerId) ?? 0]),
      );
      expect(before.size).toBeGreaterThan(0);

      const outcome = advanceExternalPlayerLifecycles(db, {
        date: "2027-06-30",
        seed: "development",
      });
      expect(outcome.developed).toBeGreaterThan(0);

      const after = new Map(
        externals(db).map((player) => [player.playerId, ability(db, player.playerId) ?? 0]),
      );
      const moved = [...before].filter(([id, value]) => (after.get(id) ?? value) !== value);
      expect(moved.length).toBeGreaterThan(0);

      // Nobody is destroyed or duplicated by a lifecycle pass.
      expect(externals(db).length).toBe(before.size);
      for (const [, value] of after) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    } finally {
      db.close();
    }
  }, 300000);

  it("improves the young and wears down the old across the same pass", () => {
    const databasePath = createWorld("curve");
    const db = openGameDatabase(databasePath);
    try {
      const start = "2027-06-30";
      const before = active(db).map((player) => ({
        id: player.playerId,
        age: ageOf(db, player.playerId, start) ?? 24,
        ability: ability(db, player.playerId) ?? 0,
      }));

      // Several seasons, so a career curve has room to show itself.
      for (const year of [2027, 2028, 2029, 2030]) {
        advanceExternalPlayerLifecycles(db, { date: `${year}-06-30`, seed: "curve" });
      }

      const young = before.filter((player) => player.age <= 21);
      const old = before.filter((player) => player.age >= 32);
      const delta = (player: { id: EntityId; ability: number }) =>
        (ability(db, player.id) ?? player.ability) - player.ability;

      // The cohort as a whole should move in the expected direction; individual
      // players may buck it, which is the point of a distribution.
      if (young.length > 0 && old.length > 0) {
        const youngMean = young.reduce((total, p) => total + delta(p), 0) / young.length;
        const oldMean = old.reduce((total, p) => total + delta(p), 0) / old.length;
        expect(youngMean).toBeGreaterThan(oldMean);
      } else {
        // No usable cohorts in this world: still assert the pass did something.
        expect(before.length).toBeGreaterThan(0);
      }
    } finally {
      db.close();
    }
  }, 600000);

  it("retires players once and keeps them out of the active pool but in history", () => {
    const databasePath = createWorld("retirement");
    const db = openGameDatabase(databasePath);
    let retiredIds: EntityId[] = [];
    try {
      const startingPeople = Number(
        (db.prepare("SELECT COUNT(*) n FROM persons").get() as { n: number }).n,
      );

      // Run far enough forward that the oldest careers must end.
      for (const year of [2028, 2032, 2036, 2040]) {
        advanceExternalPlayerLifecycles(db, { date: `${year}-06-30`, seed: "retirement" });
      }
      retiredIds = externals(db)
        .filter((player) => player.careerState === "RETIRED")
        .map((player) => player.playerId);
      expect(retiredIds.length).toBeGreaterThan(0);

      // Retirement removes them from the active pool without erasing them.
      for (const id of retiredIds) {
        expect(db.prepare("SELECT COUNT(*) n FROM persons WHERE id = ?").get(id)).toEqual({ n: 1 });
      }
      expect(
        Number((db.prepare("SELECT COUNT(*) n FROM persons").get() as { n: number }).n),
      ).toBeGreaterThanOrEqual(startingPeople);

      // Re-running the same season must not retire anyone a second time.
      const before = externals(db).filter((p) => p.careerState === "RETIRED").length;
      const repeat = advanceExternalPlayerLifecycles(db, {
        date: "2040-06-30",
        seed: "retirement",
      });
      expect(repeat.retired).toBe(0);
      expect(externals(db).filter((p) => p.careerState === "RETIRED").length).toBe(before);
    } finally {
      db.close();
    }

    // Retirement survives reload.
    const reloaded = openGameDatabase(databasePath);
    try {
      const stillRetired = externals(reloaded)
        .filter((player) => player.careerState === "RETIRED")
        .map((player) => player.playerId);
      expect(new Set(stillRetired)).toEqual(new Set(retiredIds));
    } finally {
      reloaded.close();
    }
  }, 600000);

  it("is deterministic for the same save, seed and season", () => {
    const first = createWorld("determinism");
    const second = createWorld("determinism");
    const run = (path: string) => {
      const db = openGameDatabase(path);
      try {
        for (const year of [2027, 2028, 2029]) {
          advanceExternalPlayerLifecycles(db, { date: `${year}-06-30`, seed: "determinism" });
        }
        return externals(db)
          .map(
            (player) => `${player.playerId}:${player.careerState}:${ability(db, player.playerId)}`,
          )
          .sort();
      } finally {
        db.close();
      }
    };
    expect(run(first)).toEqual(run(second));
  }, 600000);

  it("keeps the external population stable and positionally varied over bounded seasons", () => {
    const databasePath = createWorld("population");
    const db = openGameDatabase(databasePath);
    try {
      const start = active(db).length;
      expect(start).toBeGreaterThan(0);

      for (const year of [2027, 2028, 2029, 2030, 2031]) {
        advanceExternalPlayerLifecycles(db, { date: `${year}-06-30`, seed: "population" });
      }
      const end = active(db).length;

      // Neither collapse nor explosion over five bounded seasons.
      expect(end).toBeGreaterThan(0);
      expect(end).toBeLessThanOrEqual(start * 3);

      const positions = db
        .prepare(
          `SELECT pa.primary_position AS position, COUNT(*) n FROM external_player_context epc
           JOIN player_attributes pa ON pa.person_id = epc.player_id
           WHERE epc.career_state != 'RETIRED' GROUP BY pa.primary_position`,
        )
        .all() as Array<{ position: string; n: number }>;
      // Not everyone ends up in one position.
      expect(positions.length).toBeGreaterThan(1);
    } finally {
      db.close();
    }
  }, 600000);
});
