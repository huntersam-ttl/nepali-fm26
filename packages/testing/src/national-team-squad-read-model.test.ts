import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FederationGovernanceRepository, NationalTeamManagementRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { buildNationalTeamSquad, createNepalSave, ensureNationalTeamStaffStructure, initializeFederationGovernanceForSave, selectManagedNationalTeamSquad, startNationalTeamCampLifecycle } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => { const dir = mkdtempSync(join(tmpdir(), "national-team-squad-read-model-")); dirs.push(dir); const path = join(dir, "career.sqlite"); createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name }); return path; };
const getTeam = (db: ReturnType<typeof openGameDatabase>, federationId: EntityId, level: string, gender: string): EntityId => (db.prepare("SELECT id FROM teams WHERE federation_id=? AND club_id IS NULL AND level=? AND gender=? ORDER BY id LIMIT 1").get(federationId, level, gender) as { id: EntityId }).id;
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("national-team squad read model", () => {
  it("exposes current context, refs, coach, club distribution, and bounded selection history", () => {
    const db = openGameDatabase(makeSave("national-team-squad-read-model"));
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "national-team-squad-read-model" });
    const federationId = (db.prepare("SELECT f.id FROM federations f JOIN countries c ON c.id=f.country_id WHERE c.iso_code IN ('NPL','NP') ORDER BY f.id LIMIT 1").get() as { id: EntityId }).id;
    const teamId = getTeam(db, federationId, "senior", "men");
    ensureNationalTeamStaffStructure(db, { federationId, nationalTeamId: teamId, date: "2026-08-01" });
    const selection = selectManagedNationalTeamSquad(db, { federationId, nationalTeamId: teamId, date: "2026-09-01", programme: "Read model window", seed: "read-model", size: 5 });
    startNationalTeamCampLifecycle(db, { federationId, nationalTeamId: teamId, playerIds: selection.selectedPlayerIds, callupDate: "2026-09-01" });
    const model = buildNationalTeamSquad(db, teamId, "2026-09-02", "FEDERATION_PRESIDENT");
    expect(model.nationalTeam.entityReference.entityType).toBe("NATIONAL_TEAM");
    expect(model.programme).toBe("SENIOR_MENS");
    expect(model.squadSize).toBeGreaterThan(0);
    expect(model.selectedCount).toBe(model.squadSize);
    expect(model.currentWindow?.campId).toBeDefined();
    expect(model.headCoach?.entityType).toBe("STAFF");
    expect(model.clubDistribution.reduce((sum, item) => sum + item.count, 0)).toBe(model.squadSize);
    expect(model.players.every((player) => player.player.entityType === "PLAYER")).toBe(true);
    expect(model.selectionHistory[0]?.id).toBeDefined();
    expect(model.selectionHistory.length).toBeLessThanOrEqual(50);
    expect(new FederationGovernanceRepository(db).nationalTeamCallups(teamId).length).toBeGreaterThan(0);
    expect(new NationalTeamManagementRepository(db).campLifecycles(teamId).length).toBe(1);
    db.close();
  });

  it("derives WOMENS_GIRLS and YOUTH programmes from the real gender/level values, not the placeholder ones", () => {
    const db = openGameDatabase(makeSave("national-team-squad-programme-mapping"));
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "national-team-squad-programme-mapping" });
    const federationId = (db.prepare("SELECT f.id FROM federations f JOIN countries c ON c.id=f.country_id WHERE c.iso_code IN ('NPL','NP') ORDER BY f.id LIMIT 1").get() as { id: EntityId }).id;
    const womenTeamId = getTeam(db, federationId, "senior", "women");
    const u17TeamId = getTeam(db, federationId, "u17", "men");
    const u20TeamId = getTeam(db, federationId, "u20", "men");
    const u23TeamId = getTeam(db, federationId, "u23", "men");
    expect(buildNationalTeamSquad(db, womenTeamId, "2026-09-02", "FEDERATION_PRESIDENT").programme).toBe("WOMENS_GIRLS");
    expect(buildNationalTeamSquad(db, u17TeamId, "2026-09-02", "FEDERATION_PRESIDENT").programme).toBe("YOUTH");
    expect(buildNationalTeamSquad(db, u20TeamId, "2026-09-02", "FEDERATION_PRESIDENT").programme).toBe("YOUTH");
    expect(buildNationalTeamSquad(db, u23TeamId, "2026-09-02", "FEDERATION_PRESIDENT").programme).toBe("YOUTH");
    db.close();
  });
});
