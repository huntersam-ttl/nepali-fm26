import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubCreationRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, createSimulationClub, evaluateSimulationClubSurvival, reviveSimulationClub } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = []; const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => { const dir = mkdtempSync(join(tmpdir(), "club-creation-phase-b-")); dirs.push(dir); const path = join(dir, "career.sqlite"); createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name }); return path; };
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("Club creation phase B", () => {
  it("moves a failed local club to dormancy and revives it without losing history", () => {
    const db = openGameDatabase(makeSave("club-creation-phase-b")); const location = db.prepare("SELECT l.id FROM locations l JOIN countries c ON c.id = l.country_id WHERE c.iso_code = 'NP' AND l.kind IN ('district','municipality','city') ORDER BY l.id LIMIT 1").get() as { id: EntityId }; const club = createSimulationClub(db, { name: "Revival Community FC", locationId: location.id, foundedOn: "2027-07-01", seed: "club-creation-phase-b" });
    evaluateSimulationClubSurvival(db, { date: "2029-01-01" }); expect(new ClubCreationRepository(db).get(club.clubId)?.status).toBe("DORMANT"); const season = db.prepare("SELECT id FROM competition_seasons ORDER BY start_date DESC, id LIMIT 1").get() as { id: EntityId }; const revived = reviveSimulationClub(db, { clubId: club.clubId, competitionSeasonId: season.id, date: "2029-02-01", seed: "club-creation-phase-b" });
    expect(revived.status).toBe("ACTIVE"); expect(new ClubCreationRepository(db).history(club.clubId).map((event) => event.eventType)).toEqual(["FOUNDED", "DORMANT", "ADMITTED", "REVIVED"]); db.close();
  });
});
