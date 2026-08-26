import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubCreationRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, createWomensFootballProgramme, establishYouthPathway, initializeClubEconomyForSave, reviewDevelopmentProgrammeSustainability, reviewYouthPromotions } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = []; const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => { const dir = mkdtempSync(join(tmpdir(), "womens-youth-phase-b-")); dirs.push(dir); const path = join(dir, "career.sqlite"); createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name }); return path; };
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("Women's football and youth pathways phase B", () => {
  it("keeps programme decisions deterministic across a long pathway horizon", () => {
    const db = openGameDatabase(makeSave("womens-youth-phase-b")); initializeClubEconomyForSave({ db, worldDate: "2027-07-01", seed: "womens-youth-phase-b" }); const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId }; createWomensFootballProgramme(db, { clubId: club.id, date: "2027-07-01", annualBudget: 50000 }); establishYouthPathway(db, { clubId: club.id, date: "2027-07-01", seed: "womens-youth-phase-b" }); const first = []; for (let year = 2027; year < 2037; year += 1) { first.push(reviewDevelopmentProgrammeSustainability(db, { date: `${year}-07-01` }).map((item) => item.status)); reviewYouthPromotions(db, { clubId: club.id, date: `${year}-07-01`, seed: "womens-youth-phase-b" }); } const second = new ClubCreationRepository(db).programmes(club.id).map((item) => item.status); expect(first.flat().every((item) => item === "SUSPENDED")).toBe(true); expect(second).toEqual(["SUSPENDED", "SUSPENDED"]); db.close();
  });
});
