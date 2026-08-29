import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GlobalFootballContextRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  advanceExternalPlayerLifecycles,
  createNepalSave,
  initialExternalPlayerReputation,
  initializeForeignFootballWorldForSave,
  initializeTransferMarketForSave,
  processForeignFootballWorldSeason,
} from "@nepal-football-sim/simulation";

/*
 * Registration used to copy the club's reputation onto the player, so every
 * fifteen-year-old at a strong context club started as famous as the club. A
 * player's standing is now their own: ability carries it, career stage damps
 * it, and the club contributes a bounded share of visibility.
 */

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const createWorld = (seed: string, withGlobalSeed = false): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-start-reputation-"));
  tempDirs.push(dir);
  const databasePath = join(dir, "world.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Starting reputation ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
    ...(withGlobalSeed ? {} : { globalSeedPath: null }),
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

type Registered = { playerId: EntityId; reputation: number; clubReputation: number; age: number };

const registered = (db: Db): Registered[] => {
  const contexts = new GlobalFootballContextRepository(db);
  const clubs = new Map(contexts.clubs().map((club) => [club.clubId, club]));
  return contexts.players().flatMap((player) => {
    const club = player.clubId ? clubs.get(player.clubId) : undefined;
    if (!club) return [];
    const dob = (
      db.prepare("SELECT date_of_birth AS dob FROM persons WHERE id = ?").get(player.playerId) as
        { dob?: string } | undefined
    )?.dob;
    if (!dob) return [];
    return [
      {
        playerId: player.playerId,
        reputation: player.reputation,
        clubReputation: club.reputation,
        age: 2026 - Number(dob.slice(0, 4)),
      },
    ];
  });
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("generated external starting reputation", () => {
  it("is deterministic for the same player, age, ability and club", () => {
    const input = { ability: 9, age: 19, clubReputation: 60, seedKey: "player-a" };
    expect(initialExternalPlayerReputation(input)).toBe(initialExternalPlayerReputation(input));
    // Different players at the same club do not all land on one value.
    expect(initialExternalPlayerReputation(input)).not.toBe(
      initialExternalPlayerReputation({ ...input, seedKey: "player-b" }),
    );
  });

  it("starts a prospect far below their club's standing", () => {
    const databasePath = createWorld("youth");
    const db = openGameDatabase(databasePath);
    try {
      const youth = registered(db).filter((player) => player.age <= 18);
      expect(youth.length).toBeGreaterThan(0);
      for (const player of youth) {
        // Fame is earned, not inherited from the badge.
        expect(player.reputation).toBeLessThan(player.clubReputation);
        expect(player.reputation).toBeGreaterThan(0);
      }
      // And a strong club does not simply stamp its own number on everyone.
      const strong = youth.filter((player) => player.clubReputation >= 65);
      if (strong.length > 0) {
        for (const player of strong) {
          expect(player.reputation).toBeLessThan(player.clubReputation * 0.6);
        }
      }
    } finally {
      db.close();
    }
  }, 600000);

  it("still lets club standing lift a prospect above their peers elsewhere", () => {
    const databasePath = createWorld("context");
    const db = openGameDatabase(databasePath);
    try {
      const youth = registered(db).filter((player) => player.age <= 18);
      const strong = youth.filter((player) => player.clubReputation >= 65);
      const modest = youth.filter((player) => player.clubReputation <= 50);
      expect(strong.length).toBeGreaterThan(0);
      expect(modest.length).toBeGreaterThan(0);

      const mean = (players: Registered[]) =>
        players.reduce((total, player) => total + player.reputation, 0) / players.length;
      // Being at a better-known club is worth something — just not everything.
      expect(mean(strong)).toBeGreaterThan(mean(modest));
    } finally {
      db.close();
    }
  }, 600000);

  it("lets ability outweigh a modest club, and never lets a club flatten a squad", () => {
    // An exceptional player at an unfashionable club outranks an ordinary one
    // at a famous club.
    const exceptional = initialExternalPlayerReputation({
      ability: 15,
      age: 26,
      clubReputation: 40,
      seedKey: "exceptional",
    });
    const ordinaryAtBigClub = initialExternalPlayerReputation({
      ability: 6,
      age: 26,
      clubReputation: 80,
      seedKey: "ordinary",
    });
    expect(exceptional).toBeGreaterThan(ordinaryAtBigClub);

    // Age damps recognition for equal ability.
    const teenager = initialExternalPlayerReputation({
      ability: 10,
      age: 16,
      clubReputation: 50,
      seedKey: "same",
    });
    const established = initialExternalPlayerReputation({
      ability: 10,
      age: 26,
      clubReputation: 50,
      seedKey: "same",
    });
    expect(established).toBeGreaterThan(teenager);

    const databasePath = createWorld("spread");
    const db = openGameDatabase(databasePath);
    try {
      // Within one club, players differ — the value is not the club's.
      const byClub = new Map<number, number[]>();
      for (const player of registered(db)) {
        byClub.set(player.clubReputation, [
          ...(byClub.get(player.clubReputation) ?? []),
          player.reputation,
        ]);
      }
      for (const values of byClub.values()) {
        if (values.length > 3) expect(new Set(values).size).toBeGreaterThan(1);
      }
    } finally {
      db.close();
    }
  }, 600000);

  it("leaves an already-registered player's earned standing alone", () => {
    const databasePath = createWorld("earned");
    const db = openGameDatabase(databasePath);
    try {
      const contexts = new GlobalFootballContextRepository(db);
      const before = new Map(contexts.players().map((p) => [p.playerId, p.reputation]));
      expect(before.size).toBeGreaterThan(0);

      // Re-running registration must not reset anyone to a fresh initial value.
      initializeForeignFootballWorldForSave({ db, worldDate: "2026-08-01", seed: "earned" });
      const after = new Map(contexts.players().map((p) => [p.playerId, p.reputation]));
      for (const [id, value] of before) expect(after.get(id)).toBe(value);
    } finally {
      db.close();
    }
  }, 600000);

  it("still allows a modest starter to become well regarded over seasons", () => {
    const databasePath = createWorld("emergence");
    const db = openGameDatabase(databasePath);
    try {
      const contexts = new GlobalFootballContextRepository(db);
      const start = new Map(contexts.players().map((p) => [p.playerId, p.reputation]));
      // Everyone begins modest — no generated player starts elite.
      for (const value of start.values()) expect(value).toBeLessThan(60);

      for (const year of [2027, 2028, 2029, 2030, 2031, 2032]) {
        processForeignFootballWorldSeason({
          db,
          seasonEndDate: `${year}-06-30`,
          seed: "emergence",
        });
        advanceExternalPlayerLifecycles(db, { date: `${year}-06-30`, seed: "emergence" });
      }

      const end = contexts.players().filter((player) => player.careerState !== "RETIRED");
      const risen = end.filter((player) => player.reputation > (start.get(player.playerId) ?? 0));
      expect(risen.length).toBeGreaterThan(0);

      // Emergence is possible without becoming the norm.
      const sorted = end.map((player) => player.reputation).sort((a, b) => b - a);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      expect(median).toBeLessThan(60);
      for (const value of sorted) expect(value).toBeLessThanOrEqual(100);
    } finally {
      db.close();
    }
  }, 1200000);

  it("does not touch imported factual starting reputation", () => {
    const databasePath = createWorld("imported", true);
    const db = openGameDatabase(databasePath);
    try {
      const generated = new Set(
        (
          db.prepare("SELECT player_id AS id FROM generated_player_origins").all() as Array<{
            id: string;
          }>
        ).map((row) => row.id),
      );
      const imported = new GlobalFootballContextRepository(db)
        .players()
        .filter((player) => !generated.has(player.playerId));
      expect(imported.length).toBeGreaterThan(0);

      /*
       * The importer registers most imported players itself and sets their
       * starting value; those are left exactly as imported. The remainder —
       * players whose club did not resolve at import time — are picked up when
       * context clubs are synchronized, and get the player-level initializer
       * rather than the club's reputation they used to inherit.
       */
      const atImportedValue = imported.filter((player) => player.reputation === 30);
      expect(atImportedValue.length).toBeGreaterThan(imported.length * 0.85);
      for (const player of imported) {
        expect(player.reputation).toBeGreaterThan(0);
        expect(player.reputation).toBeLessThanOrEqual(100);
      }

      // Factual identity provenance is never rewritten by any of this.
      const downgraded = db
        .prepare(
          "SELECT COUNT(*) n FROM player_factual_profiles WHERE record_status = 'SIMULATION_ONLY'",
        )
        .get() as { n: number };
      expect(downgraded.n).toBe(0);
    } finally {
      db.close();
    }
  }, 900000);
});
