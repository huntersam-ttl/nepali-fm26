import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NationalTeamManagementRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { ensureNationalTeamStaffStructure, initializeFederationGovernanceForSave, createNepalSave, planNationalTeamOperations, recommendNationalTeamSelection } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => { const dir = mkdtempSync(join(tmpdir(), "national-team-management-phase-c-")); dirs.push(dir); const path = join(dir, "career.sqlite"); createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name }); return path; };
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("National team management phase C", () => {
  it("keeps staff roles, policy-based recommendations, watchlists, and operations deterministic", () => {
    const db = openGameDatabase(makeSave("national-team-management-c")); initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "national-team-management-c" });
    const federationId = (db.prepare("SELECT f.id FROM federations f JOIN countries c ON c.id = f.country_id WHERE c.iso_code IN ('NPL', 'NP') ORDER BY CASE WHEN c.iso_code = 'NPL' THEN 0 ELSE 1 END, f.id LIMIT 1").get() as { id: EntityId }).id; const teamId = (db.prepare("SELECT id FROM teams WHERE federation_id=? AND club_id IS NULL AND level='senior' AND gender='men' ORDER BY id LIMIT 1").get(federationId) as { id: EntityId }).id;
    expect(ensureNationalTeamStaffStructure(db, { federationId, nationalTeamId: teamId, date: "2026-08-01" })).toHaveLength(5); expect(ensureNationalTeamStaffStructure(db, { federationId, nationalTeamId: teamId, date: "2026-08-01" })).toHaveLength(5);
    const decision = recommendNationalTeamSelection(db, { federationId, nationalTeamId: teamId, date: "2026-09-01", programme: "Phase C window", seed: "national-team-management-c", policy: "DIASPORA_INCLUSIVE", tacticalStyle: "BALANCED" }); expect(decision.selectedPlayerIds.length).toBeGreaterThan(0); expect(new NationalTeamManagementRepository(db).watchlist(teamId).length).toBe(decision.selectedPlayerIds.length);
    const plan = planNationalTeamOperations(db, { federationId, nationalTeamId: teamId, campStart: "2026-09-01", campEnd: "2026-09-08", travelPlan: "Kathmandu base; regional travel", recoveryDaysBetweenFixtures: 3 }); expect(new NationalTeamManagementRepository(db).operationalPlans(teamId)[0].id).toBe(plan.id); db.close();
  });
});
