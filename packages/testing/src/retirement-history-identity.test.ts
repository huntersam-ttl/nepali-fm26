import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import {
  createNepalSave,
  runAnnualYouthAndRetirementCycle,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const seededDatabase = (label: string) => {
  const directory = mkdtempSync(join(tmpdir(), `nepal-retirement-history-${label}-`));
  tempDirs.push(directory);
  const databasePath = join(directory, "career.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Retirement history ${label}`,
    gameVersion: "test",
    randomSeed: `retirement-history-${label}`,
  });
  return openGameDatabase(databasePath);
};

/** Gives one player a second open PLAYER role and a second factual profile. */
const duplicateSourceRows = (db: ReturnType<typeof openGameDatabase>): EntityId => {
  const player = db
    .prepare(
      `SELECT p.id AS id FROM persons p
       JOIN person_roles pr ON pr.person_id = p.id AND pr.role = 'PLAYER' AND pr.active_to IS NULL
       JOIN player_attributes pa ON pa.person_id = p.id
       WHERE p.date_of_birth IS NOT NULL
       ORDER BY p.date_of_birth LIMIT 1`,
    )
    .get() as { id: EntityId };
  const role = db
    .prepare(
      "SELECT * FROM person_roles WHERE person_id = ? AND role = 'PLAYER' AND active_to IS NULL LIMIT 1",
    )
    .get(player.id) as Record<string, unknown>;
  db.prepare(
    "INSERT INTO person_roles (id, person_id, role, active_from, active_to) VALUES (?, ?, 'PLAYER', ?, NULL)",
  ).run(`${player.id}-duplicate-role`, player.id, String(role.active_from ?? "2026-08-01"));
  const country = db.prepare("SELECT id FROM countries LIMIT 1").get() as { id: EntityId };
  for (const suffix of ["a", "b"]) {
    db.prepare(
      `INSERT OR IGNORE INTO player_factual_profiles
       (id, player_id, canonical_external_id, factual_json, simulation_json, evidence_json,
        record_status, confidence_level, last_verified)
       VALUES (?, ?, ?, '{}', '{}', '{}', 'UNKNOWN', 'LOW', NULL)`,
    ).run(`${player.id}-profile-${suffix}`, player.id, `${player.id}-external-${suffix}`);
  }
  void country;
  return player.id;
};

describe("retirement history identity", () => {
  it("retires a player once even when their source rows are duplicated", () => {
    const db = seededDatabase("duplicate-rows");
    try {
      const playerId = duplicateSourceRows(db);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM person_roles WHERE person_id = ? AND role = 'PLAYER' AND active_to IS NULL",
          )
          .get(playerId),
      ).toEqual({ count: 2 });

      // Ageing the world forward is what pushes the oldest players into retirement.
      for (const year of ["2027", "2028", "2029", "2030"]) {
        expect(() =>
          runAnnualYouthAndRetirementCycle({
            db,
            worldDate: `${year}-08-15`,
            seed: "retirement-history",
          }),
        ).not.toThrow();
      }

      const duplicated = db
        .prepare(
          `SELECT id, COUNT(*) AS count FROM historical_events
           GROUP BY id HAVING COUNT(*) > 1`,
        )
        .all();
      expect(duplicated).toEqual([]);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  }, 300000);

  it("keeps one retirement record per player across the same season replayed", () => {
    const db = seededDatabase("replay");
    try {
      duplicateSourceRows(db);
      for (const attempt of [0, 1]) {
        void attempt;
        expect(() =>
          runAnnualYouthAndRetirementCycle({
            db,
            worldDate: "2029-08-15",
            seed: "retirement-history",
          }),
        ).not.toThrow();
      }
      const states = db
        .prepare(
          "SELECT player_id, COUNT(*) AS count FROM player_retirement_states GROUP BY player_id HAVING COUNT(*) > 1",
        )
        .all();
      expect(states).toEqual([]);
    } finally {
      db.close();
    }
  }, 300000);
});
