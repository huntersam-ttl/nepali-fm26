import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FederationGovernanceRepository, NationalTeamManagementRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { advanceNationalTeamCampLifecycle, createNepalSave, initializeFederationGovernanceForSave, recordNationalTeamCampaignResult, registerNationalTeamCampaign, selectManagedNationalTeamSquad, setInternationalCommitment, startNationalTeamCampLifecycle } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => { const dir = mkdtempSync(join(tmpdir(), "national-team-management-phase-b-")); dirs.push(dir); const path = join(dir, "career.sqlite"); createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name }); return path; };
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("National team management phase B", () => {
  it("persists campaign results, camp duty lifecycle, and international commitment state", () => {
    const db = openGameDatabase(makeSave("national-team-management-b")); initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "national-team-management-b" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id; const teamId = (db.prepare("SELECT id FROM teams WHERE federation_id=? AND level='senior' AND gender='men' ORDER BY id LIMIT 1").get(federationId) as { id: EntityId }).id;
    const selection = selectManagedNationalTeamSquad(db, { federationId, nationalTeamId: teamId, date: "2026-09-01", programme: "Qualifier", seed: "national-team-management-b" }); const camp = startNationalTeamCampLifecycle(db, { federationId, nationalTeamId: teamId, playerIds: selection.selectedPlayerIds.slice(0, 3), callupDate: "2026-09-01" });
    expect(advanceNationalTeamCampLifecycle(db, { campId: camp.id, phase: "ARRIVED", date: "2026-09-02" }).status).toBe("ARRIVED"); expect(advanceNationalTeamCampLifecycle(db, { campId: camp.id, phase: "TRAINING", date: "2026-09-04" }).status).toBe("TRAINING"); expect(advanceNationalTeamCampLifecycle(db, { campId: camp.id, phase: "MATCH", date: "2026-09-08" }).status).toBe("MATCH"); expect(advanceNationalTeamCampLifecycle(db, { campId: camp.id, phase: "RELEASED", date: "2026-09-09" }).status).toBe("RELEASED");
    const campaign = registerNationalTeamCampaign(db, { federationId, nationalTeamId: teamId, name: "Qualifier campaign", startedOn: "2026-09-01", objectives: { wins: 2 } }); recordNationalTeamCampaignResult(db, { campaignId: campaign.id, date: "2026-09-08", nationalTeamWon: true, draw: false, qualificationStatus: "ACTIVE" }); expect(new NationalTeamManagementRepository(db).campaigns(teamId)[0].wins).toBe(1);
    const playerId = selection.selectedPlayerIds[0]; setInternationalCommitment(db, { playerId, federationId, status: "TEMPORARILY_RELUCTANT", decidedOn: "2026-09-01", reason: "club schedule", provenanceStatus: "SIMULATION_ONLY" }); expect(new NationalTeamManagementRepository(db).commitments(federationId)[0].status).toBe("TEMPORARILY_RELUCTANT"); expect(new FederationGovernanceRepository(db).nationalTeamAppearances(teamId)).toEqual([]); db.close();
  });
});
