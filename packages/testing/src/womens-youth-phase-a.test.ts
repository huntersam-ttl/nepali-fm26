import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubCreationRepository, ClubEconomyRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, createWomensFootballProgramme, establishYouthPathway, initializeClubEconomyForSave } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = []; const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => { const dir = mkdtempSync(join(tmpdir(), "womens-youth-phase-a-")); dirs.push(dir); const path = join(dir, "career.sqlite"); createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name }); return path; };
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("Women's football and youth pathways phase A", () => {
  it("creates funded women and youth pathways through existing team and youth systems", () => {
    const db = openGameDatabase(makeSave("womens-youth-phase-a")); initializeClubEconomyForSave({ db, worldDate: "2027-07-01", seed: "womens-youth-phase-a" }); const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId }; const women = createWomensFootballProgramme(db, { clubId: club.id, date: "2027-07-01", annualBudget: 50000 }); const pathway = establishYouthPathway(db, { clubId: club.id, date: "2027-07-01", seed: "womens-youth-phase-a" });
    expect(women.provenanceStatus).toBe("SIMULATION_ONLY"); expect(db.prepare("SELECT COUNT(*) AS count FROM teams WHERE club_id = ? AND gender = 'women'").get(club.id)).toEqual({ count: 1 }); expect(db.prepare("SELECT COUNT(*) AS count FROM teams WHERE club_id = ? AND level IN ('u20','u17')").get(club.id)).toEqual({ count: 2 }); expect(pathway.intake.seasonLabel).toBe("2027"); expect(new ClubCreationRepository(db).programmes(club.id)).toHaveLength(2); expect(new ClubEconomyRepository(db).facilityProfile(club.id)).toBeDefined(); db.close();
  });
});
