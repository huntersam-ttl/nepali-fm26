import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubCreationRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, createSimulationClub } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = []; const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => { const dir = mkdtempSync(join(tmpdir(), "club-creation-phase-a-")); dirs.push(dir); const path = join(dir, "career.sqlite"); createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name }); return path; };
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("Club creation phase A", () => {
  it("creates a deterministic simulation-only local club with low-scale operations", () => {
    const first = openGameDatabase(makeSave("club-creation")); const location = first.prepare("SELECT l.id FROM locations l JOIN countries c ON c.id = l.country_id WHERE c.iso_code = 'NP' AND l.kind IN ('district','municipality','city') ORDER BY l.id LIMIT 1").get() as { id: EntityId }; const record = createSimulationClub(first, { name: "Karnali Community FC", locationId: location.id, foundedOn: "2027-07-01", seed: "club-creation" });
    expect(record.provenanceStatus).toBe("SIMULATION_ONLY"); expect(record.admissionStatus).toBe("PENDING"); expect(first.prepare("SELECT COUNT(*) AS count FROM staff_vacancies WHERE club_id = ?").get(record.clubId)).toEqual({ count: 4 }); expect((first.prepare("SELECT cash_balance FROM club_financial_accounts WHERE club_id = ?").get(record.clubId) as { cash_balance: number }).cash_balance).toBe(350000); expect(new ClubCreationRepository(first).get(record.clubId)).toEqual(record); first.close();
  });
});
