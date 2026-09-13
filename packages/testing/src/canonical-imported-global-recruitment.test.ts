import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import {
  countryToRecruitmentRegion,
  createNepalSave,
  createScoutingAssignment,
  initializeForeignFootballWorldForSave,
  initializeRecruitmentForSave,
  marketRegionForPlayer,
  searchRegionalCandidatesForClub,
  simulateScoutingDay,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const fixturePath = resolve(process.cwd(), "data/global/football_world_import_v16_reconciled_fixture.json");
const tempDirs: string[] = [];

const createImportedWorld = (seed: string): string => {
  const directory = mkdtempSync(join(tmpdir(), "nepal-canonical-global-import-"));
  tempDirs.push(directory);
  const databasePath = join(directory, "world.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Canonical global import ${seed}`,
    gameVersion: "test",
    randomSeed: seed,
    globalSeedPath: fixturePath,
  });
  const db = openGameDatabase(databasePath);
  try {
    expect(db.prepare("SELECT COUNT(*) AS count FROM player_factual_profiles WHERE canonical_external_id IN ('PLY-000130','PLY-000614','PLY-001259')").get()).toEqual({ count: 3 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM clubs WHERE canonical_external_id IN ('CLB-000031','CLB-000088','CLB-000396')").get()).toEqual({ count: 3 });
    initializeForeignFootballWorldForSave({ db, worldDate: "2026-08-01", seed });
    initializeRecruitmentForSave({ db, worldDate: "2026-08-01", seed });
  } finally {
    db.close();
  }
  return databasePath;
};

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("canonical imported global recruitment", () => {
  it("loads the committed plan through the production importer and preserves evidence", () => {
    const databasePath = createImportedWorld("canonical-load");
    const db = openGameDatabase(databasePath);
    try {
      const imported = db
        .prepare("SELECT canonical_external_id, record_status, confidence_level, factual_json, evidence_json FROM player_factual_profiles WHERE canonical_external_id IN ('PLY-000130','PLY-000614','PLY-000617','PLY-001258','PLY-001259') ORDER BY canonical_external_id")
        .all() as Array<{ canonical_external_id: string; record_status: string; confidence_level: string; factual_json: string; evidence_json: string }>;
      expect(imported).toHaveLength(5);
      expect(imported.every((row) => row.record_status === "VERIFIED" && row.confidence_level === "HIGH")).toBe(true);
      expect(imported.map((row) => JSON.parse(row.evidence_json).sourceIds).flat()).toContain("SRC-000005");
      expect(JSON.parse(imported[0]!.factual_json).provenance).toBe("VERIFIED");
      expect(db.prepare("SELECT status FROM global_dataset_imports WHERE dataset_version=?").get("football_world_import_v16_reconciled_final_fixture")).toEqual({ status: "ACTIVE" });
      expect(db.prepare("SELECT COUNT(*) AS count FROM external_club_context WHERE simulation_depth <> 'CONTEXT_ONLY'").get()).toEqual({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM external_league_context WHERE simulation_depth <> 'CONTEXT_ONLY'").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  }, 300000);

  it("proves imported Africa and South Asia candidates use the bounded corridor with generated parity", () => {
    expect(countryToRecruitmentRegion("NGA")).toBe("AFRICA");
    expect(countryToRecruitmentRegion("IND")).toBe("SOUTH_ASIA");
    expect(countryToRecruitmentRegion("DEU")).toBe("EUROPE");

    const databasePath = createImportedWorld("canonical-recruitment");
    const db = openGameDatabase(databasePath);
    try {
      const nepalClub = db.prepare("SELECT id FROM clubs WHERE canonical_external_id LIKE 'NEP-NSL-%' ORDER BY id LIMIT 1").get() as { id: EntityId };
      const imported = db.prepare("SELECT pfp.canonical_external_id, pfp.player_id FROM player_factual_profiles pfp WHERE pfp.canonical_external_id IN ('PLY-000130','PLY-000614','PLY-000617','PLY-001258','PLY-001259') ORDER BY pfp.canonical_external_id").all() as Array<{ canonical_external_id: string; player_id: EntityId }>;
      const byExternal = new Map(imported.map((row) => [row.canonical_external_id, row.player_id]));
      const africaId = byExternal.get("PLY-001259")!;
      const africaPositionNegativeId = byExternal.get("PLY-001258")!;
      const southAsiaId = byExternal.get("PLY-000614")!;
      const southAsiaPositionNegativeId = byExternal.get("PLY-000617")!;
      const europeNegativeId = byExternal.get("PLY-000130")!;
      expect(marketRegionForPlayer(db, africaId)).toBe("AFRICA");
      expect(marketRegionForPlayer(db, southAsiaId)).toBe("SOUTH_ASIA");
      expect(marketRegionForPlayer(db, europeNegativeId)).toBe("EUROPE");

      for (const playerId of [africaId, southAsiaId]) {
        createScoutingAssignment(db, { clubId: nepalClub.id, targetPlayerId: playerId, startedAt: "2026-08-01", priority: "HIGH" });
      }
      expect(simulateScoutingDay({ db, worldDate: "2026-08-08", seed: "canonical-recruitment" }).assignmentsCompleted).toBe(2);

      const candidates = searchRegionalCandidatesForClub(db, nepalClub.id, {}, "2026-08-08", 12);
      const importedCandidates = candidates.filter((candidate) => [africaId, southAsiaId].includes(candidate.playerId));
      expect(importedCandidates.map((candidate) => candidate.marketRegion)).toEqual(expect.arrayContaining(["AFRICA", "SOUTH_ASIA"]));
      expect(importedCandidates.every((candidate) => candidate.playerId !== europeNegativeId)).toBe(true);
      expect(importedCandidates.every((candidate) => {
        const row = db.prepare("SELECT factual_json FROM player_factual_profiles WHERE player_id=?").get(candidate.playerId) as { factual_json: string };
        return JSON.parse(row.factual_json).provenance !== "SIMULATION_ONLY";
      })).toBe(true);
      expect(candidates.some((candidate) => candidate.playerId === europeNegativeId)).toBe(false);
      expect(candidates.length).toBeLessThanOrEqual(12);
      expect(marketRegionForPlayer(db, africaPositionNegativeId)).toBe("AFRICA");
      expect(marketRegionForPlayer(db, southAsiaPositionNegativeId)).toBe("SOUTH_ASIA");
      // Exact position is only revealed at GOOD knowledge, and since scouting
      // gains depend on scout quality (a05b0e0) one pass may stop at BASIC.
      // A second HIGH pass on the same two targets reaches GOOD regardless.
      for (const playerId of [africaId, southAsiaId]) {
        createScoutingAssignment(db, { clubId: nepalClub.id, targetPlayerId: playerId, startedAt: "2026-08-02", priority: "HIGH" });
      }
      expect(simulateScoutingDay({ db, worldDate: "2026-08-09", seed: "canonical-recruitment-second-pass" }).assignmentsCompleted).toBe(2);
      const africaForwards = searchRegionalCandidatesForClub(db, nepalClub.id, { position: "ST" }, "2026-08-08", 12);
      expect(africaForwards.some((candidate) => candidate.playerId === africaId)).toBe(true);
      expect(africaForwards.some((candidate) => candidate.playerId === africaPositionNegativeId)).toBe(false);
      const southAsiaMidfielders = searchRegionalCandidatesForClub(db, nepalClub.id, { position: "AM" }, "2026-08-08", 12);
      expect(southAsiaMidfielders.some((candidate) => candidate.playerId === southAsiaId)).toBe(true);
      expect(southAsiaMidfielders.some((candidate) => candidate.playerId === southAsiaPositionNegativeId)).toBe(false);

      const generatedAfrica = db.prepare("SELECT tpa.person_id AS player_id FROM team_person_assignments tpa JOIN teams t ON t.id=tpa.team_id JOIN clubs c ON c.id=t.club_id JOIN countries co ON co.id=c.country_id WHERE tpa.role='PLAYER' AND c.canonical_external_id LIKE 'SIM-FOREIGN-%' AND co.iso_code IN ('NG','NGA') ORDER BY tpa.person_id LIMIT 1").get() as { player_id: EntityId } | undefined;
      expect(generatedAfrica).toBeDefined();
      createScoutingAssignment(db, { clubId: nepalClub.id, targetPlayerId: generatedAfrica!.player_id, startedAt: "2026-08-08", priority: "HIGH" });
      expect(simulateScoutingDay({ db, worldDate: "2026-08-15", seed: "canonical-recruitment-generated" }).assignmentsCompleted).toBe(1);
      const parity = searchRegionalCandidatesForClub(db, nepalClub.id, {}, "2026-08-15", 12).filter((candidate) => [africaId, generatedAfrica!.player_id].includes(candidate.playerId));
      expect(parity).toHaveLength(2);
      expect(parity.every((candidate) => candidate.discoveryStatus === "SCOUTED" && candidate.marketRegion === "AFRICA")).toBe(true);
    } finally {
      db.close();
    }
  }, 300000);
});
