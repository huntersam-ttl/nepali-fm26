import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FederationGovernanceRepository, NationalTeamManagementRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { createNepalSave, initializeFederationGovernanceForSave, registerNationalTeamCampaign, selectManagedNationalTeamSquad } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => { const dir = mkdtempSync(join(tmpdir(), "national-team-management-phase-a-")); dirs.push(dir); const path = join(dir, "career.sqlite"); createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name }); return path; };
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("National team management phase A", () => {
  it("selects an available squad by team type, records captain/tactical state, and persists campaign foundations", () => {
    const db = openGameDatabase(makeSave("national-team-management")); initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "national-team-management" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id; const teamId = (db.prepare("SELECT id FROM teams WHERE federation_id=? AND level='senior' AND gender='men' ORDER BY id LIMIT 1").get(federationId) as { id: EntityId }).id;
    const decision = selectManagedNationalTeamSquad(db, { federationId, nationalTeamId: teamId, date: "2026-09-01", programme: "Phase A friendly", seed: "national-team-management", tacticalStyle: "BALANCED" });
    expect(decision.selectedPlayerIds.length).toBeGreaterThan(0); expect(decision.captainPlayerId).toBe(decision.selectedPlayerIds[0]); expect(new NationalTeamManagementRepository(db).decisions(teamId)[0].tacticalStyle).toBe("BALANCED");
    const campaign = registerNationalTeamCampaign(db, { federationId, nationalTeamId: teamId, name: "2026 friendly window", startedOn: "2026-09-01" }); expect(new NationalTeamManagementRepository(db).campaigns(teamId)[0].id).toBe(campaign.id); expect(new FederationGovernanceRepository(db).internationalEligibilities(federationId).length).toBeGreaterThan(0); db.close();
  });
});
