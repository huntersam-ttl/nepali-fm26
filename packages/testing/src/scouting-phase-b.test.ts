import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ScoutingPhaseBRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, initializeRecruitmentForSave, progressScoutingReport, requestScoutingReport, scoutingReport } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";
describe("scouting phase B", () => { it("persists a deterministic report lifecycle without exposing hidden ratings", () => {
  const dir=mkdtempSync(join(tmpdir(), "scouting-phase-b-")); const path=join(dir, "save.sqlite"); createNepalSave({databasePath:path,dataset:JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8")),saveName:"scouting-b",gameVersion:"test",randomSeed:"scouting-b"}); let db=openGameDatabase(path); initializeRecruitmentForSave({db,worldDate:"2027-07-01",seed:"scouting-b"}); const club=db.prepare("SELECT id FROM clubs ORDER BY id LIMIT 1").get() as {id:EntityId}; const player=db.prepare("SELECT player_id AS id FROM player_factual_profiles WHERE current_club_id<>? ORDER BY player_id LIMIT 1").get(club.id) as {id:EntityId}; const requested=requestScoutingReport(db,{clubId:club.id,playerId:player.id,requestedAt:"2027-07-01"}); expect(requested.record?.status).toBe("REQUESTED"); const done=progressScoutingReport(db,{reportId:requested.record!.id,date:"2027-07-20",seed:"scouting-b"}); expect(done.record?.status).toBe("COMPLETED"); expect(done.report && "currentAbility" in done.report).toBe(false); db.close(); db=openGameDatabase(path); expect(scoutingReport(db,requested.record!.id,"2027-08-01").record?.status).toBe("COMPLETED"); expect(new ScoutingPhaseBRepository(db).reports(club.id)).toHaveLength(1); db.close(); rmSync(dir,{recursive:true,force:true});
}); });
