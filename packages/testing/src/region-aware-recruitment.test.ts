import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import {
  ISO_ALPHA3_BY_ALPHA2,
  countryToRecruitmentRegion,
  createNepalSave,
  createScoutingAssignment,
  initializeForeignFootballWorldForSave,
  initializeRecruitmentForSave,
  searchRegionalCandidatesForClub,
  simulateScoutingDay,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const createWorld = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-regions-"));
  dirs.push(dir);
  const path = join(dir, "world.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: seed, gameVersion: "0.2.0", randomSeed: seed });
  const db = openGameDatabase(path);
  initializeForeignFootballWorldForSave({ db, worldDate: "2026-08-01", seed });
  initializeRecruitmentForSave({ db, worldDate: "2026-08-01", seed });
  db.close();
  return path;
};

const playerFromMarket = (db: ReturnType<typeof openGameDatabase>, iso: string): EntityId =>
  (db.prepare(`
    SELECT tpa.person_id AS player_id
    FROM team_person_assignments tpa
    JOIN teams t ON t.id = tpa.team_id
    JOIN clubs c ON c.id = t.club_id
    JOIN countries co ON co.id = c.country_id
    WHERE tpa.role = 'PLAYER' AND tpa.ended_on IS NULL AND co.iso_code IN (?, ?)
    ORDER BY tpa.person_id LIMIT 1
  `).get(iso, ISO_ALPHA3_BY_ALPHA2[iso]!) as { player_id: EntityId }).player_id;

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("bounded region-aware recruitment", () => {
  it("resolves canonical countries and reaches Africa and South Asia through scouting", () => {
    expect(countryToRecruitmentRegion("NG")).toBe("AFRICA");
    expect(countryToRecruitmentRegion("IN")).toBe("SOUTH_ASIA");
    expect(countryToRecruitmentRegion("DE")).toBe("EUROPE");

    const path = createWorld("region-recruitment");
    const db = openGameDatabase(path);
    const nepalClub = db.prepare("SELECT id FROM clubs WHERE canonical_external_id LIKE 'NEP-NSL-%' ORDER BY id LIMIT 1").get() as { id: EntityId };
    const africaPlayer = playerFromMarket(db, "NG");
    const southAsiaPlayer = playerFromMarket(db, "IN");
    for (const playerId of [africaPlayer, southAsiaPlayer]) {
      createScoutingAssignment(db, { clubId: nepalClub.id, targetPlayerId: playerId, startedAt: "2026-08-01", priority: "HIGH" });
    }
    expect(simulateScoutingDay({ db, worldDate: "2026-08-08", seed: "region-recruitment" }).assignmentsCompleted).toBe(2);

    const candidates = searchRegionalCandidatesForClub(db, nepalClub.id, {}, "2026-08-08", 12);
    expect(candidates.filter((candidate) => candidate.marketRegion === "AFRICA").map((candidate) => candidate.playerId)).toContain(africaPlayer);
    expect(candidates.filter((candidate) => candidate.marketRegion === "SOUTH_ASIA").map((candidate) => candidate.playerId)).toContain(southAsiaPlayer);
    expect(candidates.length).toBeLessThanOrEqual(12);
    expect(searchRegionalCandidatesForClub(db, nepalClub.id, { positionGroup: "NOT_A_POSITION" }, "2026-08-08", 12)).toHaveLength(0);
    db.close();
  }, 300000);
});
