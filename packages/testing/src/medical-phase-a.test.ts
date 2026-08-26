import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlayerRepository, openGameDatabase } from "@nepal-football-sim/database";
import { assessPlayerMedical, createNepalSave, medicalCentreReadModel } from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId, type InjuryRecord } from "@nepal-football-sim/shared-types";

const dirs: string[] = []; const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => { const dir = mkdtempSync(join(tmpdir(), "medical-phase-a-")); dirs.push(dir); const path = join(dir, "career.sqlite"); createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name }); return path; };
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("Medical phase A", () => {
  it("derives deterministic rehab advice from recorded injury, load, staff, and facility state", () => {
    const db = openGameDatabase(makeSave("medical-phase-a")); const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId }; const team = db.prepare("SELECT id FROM teams WHERE club_id = ? ORDER BY id LIMIT 1").get(club.id) as { id: EntityId }; const state = db.prepare("SELECT person_id AS personId FROM team_person_assignments WHERE team_id = ? AND role = 'PLAYER' ORDER BY id LIMIT 1").get(team.id) as { personId: EntityId }; const players = new PlayerRepository(db); players.upsertAvailabilityState({ personId: state.personId, teamId: team.id, fitness: 48, moraleModifier: 0, formModifier: 0, availability: "INJURED", updatedOn: "2026-08-15" });
    const injury: InjuryRecord = { id: createStableEntityId("injury", "medical-phase-a"), personId: state.personId, injuryType: "recorded match injury", dateOccurred: "2026-08-01", expectedRecoveryDate: "2026-09-20", severity: "moderate" }; players.insertInjury(injury);
    const first = assessPlayerMedical(db, { clubId: club.id, personId: state.personId, date: "2026-08-15", workload: 82 }); const second = assessPlayerMedical(db, { clubId: club.id, personId: state.personId, date: "2026-08-15", workload: 82 });
    expect(first).toEqual(second); expect(first.availabilityRecommendation).toBe("UNAVAILABLE"); expect(first.workloadFlag).toBe("OVERLOADED"); expect(medicalCentreReadModel(db, { clubId: club.id, date: "2026-08-15" }).some((item) => item.personId === state.personId)).toBe(true); db.close();
  });
});
