import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, simulateNepalCareer } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * Release-candidate determinism: the same seed run twice from the same
 * starting state must reach the same deterministic outputs — competition
 * outcomes, AI facility/sponsor choices, player/finance totals. This is
 * already proven per-system elsewhere (ai-commercial-variety.test.ts,
 * ai-facility-variety.test.ts's reload test, stage-twelve's own
 * "deterministic for same-seed diagnostics" case); this consolidates it
 * across a real multi-season run of every system together.
 */

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const runOnce = (seed: string) => {
  const dir = mkdtempSync(join(tmpdir(), `${seed}-`));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: seed,
    gameVersion: "test",
    randomSeed: seed,
  });
  const db = openGameDatabase(path);
  simulateNepalCareer({
    db,
    seasons: 2,
    seed,
    economyEnabled: true,
    transfersEnabled: true,
    youthEnabled: true,
  });
  const economy = new ClubEconomyRepository(db);
  const clubs = (
    db
      .prepare(
        `SELECT c.id FROM clubs c
         WHERE NOT EXISTS (
           SELECT 1 FROM external_club_context ecc
           WHERE ecc.club_id = c.id AND ecc.simulation_depth = 'CONTEXT_ONLY'
         )
         ORDER BY c.id`,
      )
      .all() as Array<{ id: EntityId }>
  ).map((row) => row.id);

  const snapshot = {
    playerCount: (db.prepare("SELECT COUNT(*) AS c FROM player_attributes").get() as { c: number }).c,
    champions: db
      .prepare(
        "SELECT competition_season_id, champion_club_id FROM competition_season_states WHERE champion_club_id IS NOT NULL ORDER BY competition_season_id",
      )
      .all(),
    movements: db
      .prepare("SELECT club_id, movement_type FROM competition_movements ORDER BY club_id, movement_type")
      .all(),
    facilityProjects: clubs.flatMap((clubId) =>
      economy.infrastructureProjects(clubId).map((project) => ({
        clubId,
        type: project.projectType,
        capitalCost: project.capitalCost,
      })),
    ),
    sponsorships: clubs.flatMap((clubId) =>
      economy
        .sponsorships(clubId)
        .filter((item) => item.status === "ACTIVE")
        .map((item) => ({ clubId, type: item.type, sponsorId: item.sponsorId, annualValue: item.annualValue })),
    ),
    totalClubCash: clubs.reduce((sum, clubId) => sum + (economy.financialAccount(clubId)?.cashBalance ?? 0), 0),
  };
  db.close();
  return snapshot;
};

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("release: determinism across a full multi-system run", () => {
  it("produces identical competition, facility, sponsor, and finance outcomes for the same seed run twice", () => {
    const first = runOnce("release-determinism-seed");
    const second = runOnce("release-determinism-seed");
    expect(second).toEqual(first);
    // Sanity: the run actually did something, so this isn't a vacuous match
    // on two empty worlds.
    expect(first.playerCount).toBeGreaterThan(0);
  }, 120_000);
});
