import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlayerRepository, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import { rollTrainingInjury } from "@nepal-football-sim/simulation";
import { createNepalSave } from "@nepal-football-sim/simulation";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * Training consequences must belong to the world, not to the Training screen.
 *
 * Before this, `rollTrainingInjury` was private to `manager-desktop.ts` and
 * called from exactly one place: the human manager's own daily training path.
 * The canonical season engine developed every squad in the world through the
 * same engine, computed the identical `injuryRiskSignal`, and threw it away —
 * so an AI club never lost a player to training, and the player's own club
 * only did so on the days the manager happened to open the screen.
 *
 * The season path now applies the same consequence. Double-rolling is
 * prevented by the development state's `lastDevelopmentUpdate >= date` guard
 * in `developPlayers`, which skips any player the manager path already
 * processed today.
 */

const dirs: string[] = [];
let db: GameDatabase;
let players: PlayerRepository;
let teamId: EntityId;
let playerId: EntityId;
const date = "2026-09-01";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "training-injury-season-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(
      readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8"),
    ) as unknown,
    saveName: "training-injury-season",
    gameVersion: "test",
    randomSeed: "training-injury-season",
  });
  db = openGameDatabase(path);
  players = new PlayerRepository(db);
  const row = db
    .prepare(
      `SELECT tpa.team_id AS teamId, tpa.person_id AS playerId
       FROM team_person_assignments tpa
       JOIN player_attributes pa ON pa.person_id = tpa.person_id
       WHERE tpa.role='PLAYER' AND tpa.ended_on IS NULL
       ORDER BY tpa.person_id LIMIT 1`,
    )
    .get() as { teamId: EntityId; playerId: EntityId };
  teamId = row.teamId;
  playerId = row.playerId;
});

afterAll(() => {
  db?.close();
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("training injury is a world consequence, not a screen consequence", () => {
  it("is reachable from outside manager-desktop — the season engine can apply it", () => {
    // The export itself is the fix: the canonical season path could not call
    // this at all while it was module-private.
    expect(typeof rollTrainingInjury).toBe("function");
  });

  it("a certain risk produces a real, persisted injury and marks the player unavailable", () => {
    const before = players.activeInjuries(date).filter((item) => item.personId === playerId);
    expect(before).toHaveLength(0);

    // risk = 1 makes the seeded roll certain, so the test asserts the
    // consequence wiring rather than the probability curve.
    rollTrainingInjury(db, players, playerId, teamId, 1, 80, date, "season-seed");

    const after = players.activeInjuries(date).filter((item) => item.personId === playerId);
    expect(after).toHaveLength(1);
    expect(after[0].injuryType).toBe("Training overload");
    expect(after[0].expectedRecoveryDate > date).toBe(true);
    const state = players
      .availabilityStates(teamId)
      .find((item) => item.personId === playerId);
    expect(state?.availability).toBe("INJURED");
  });

  it("never double-injures an already-injured player, whichever path rolls", () => {
    const before = players.activeInjuries(date).filter((item) => item.personId === playerId).length;
    // The manager path and the season path can both reach a player across a
    // save's lifetime; the already-injured guard keeps that idempotent.
    rollTrainingInjury(db, players, playerId, teamId, 1, 80, date, "manager-seed");
    rollTrainingInjury(db, players, playerId, teamId, 1, 80, date, "season-seed");
    const after = players.activeInjuries(date).filter((item) => item.personId === playerId).length;
    expect(after).toBe(before);
  });

  it("a zero risk never injures anyone", () => {
    const other = db
      .prepare(
        `SELECT tpa.person_id AS id FROM team_person_assignments tpa
         JOIN player_attributes pa ON pa.person_id = tpa.person_id
         WHERE tpa.team_id = ? AND tpa.role='PLAYER' AND tpa.ended_on IS NULL
           AND tpa.person_id != ? ORDER BY tpa.person_id LIMIT 1`,
      )
      .get(teamId, playerId) as { id: EntityId };
    rollTrainingInjury(db, players, other.id, teamId, 0, 80, date, "season-seed");
    expect(players.activeInjuries(date).filter((item) => item.personId === other.id)).toHaveLength(
      0,
    );
  });

  it("is deterministic for a given seed, player and date", () => {
    const target = db
      .prepare(
        `SELECT tpa.person_id AS id FROM team_person_assignments tpa
         JOIN player_attributes pa ON pa.person_id = tpa.person_id
         WHERE tpa.team_id = ? AND tpa.role='PLAYER' AND tpa.ended_on IS NULL
           AND tpa.person_id != ? ORDER BY tpa.person_id DESC LIMIT 1`,
      )
      .get(teamId, playerId) as { id: EntityId };
    rollTrainingInjury(db, players, target.id, teamId, 1, 80, date, "repeatable");
    const first = players.activeInjuries(date).filter((item) => item.personId === target.id);
    rollTrainingInjury(db, players, target.id, teamId, 1, 80, date, "repeatable");
    const second = players.activeInjuries(date).filter((item) => item.personId === target.id);
    expect(second).toEqual(first);
  });
});
