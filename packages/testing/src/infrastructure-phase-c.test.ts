import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FederationGovernanceRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  advanceFederationProjects,
  createFederationProject,
  createNepalSave,
  fundFederationProject,
  initializeFederationGovernanceForSave,
} from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const save = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "infrastructure-phase-c-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: seed, gameVersion: "test", randomSeed: seed });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("infrastructure and institution building phase C", () => {
  it("persists national and regional ownership, components and funded completion", () => {
    const path = save("infrastructure-phase-c");
    const db = openGameDatabase(path);
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "infrastructure-phase-c" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    const national = createFederationProject(db, { federationId, projectType: "NATIONAL_TRAINING_CENTRE", name: "National Football Centre", date: "2026-08-01", seed: "infrastructure-phase-c", funding: { federationCash: 0 } });
    const regional = createFederationProject(db, { federationId, projectType: "REGIONAL_CENTRE", name: "Bagmati Development Centre", date: "2026-08-01", seed: "infrastructure-phase-c", ownership: "SHARED", siteRights: "LEASED" });
    expect(national.components).toContain("medical_suite");
    expect(regional.ownership).toBe("SHARED");
    expect(regional.siteRights).toBe("LEASED");
    advanceFederationProjects(db, { federationId, date: "2026-10-01", seed: "infrastructure-phase-c" });
    expect(new FederationGovernanceRepository(db).projects(federationId).find((item) => item.id === national.id)?.status).toBe("FINANCING");
    fundFederationProject(db, { projectId: national.id, date: "2026-10-02", source: "FIFA_GRANT", amount: national.capitalCost });
    advanceFederationProjects(db, { federationId, date: "2029-01-01", seed: "infrastructure-phase-c" });
    advanceFederationProjects(db, { federationId, date: "2030-01-01", seed: "infrastructure-phase-c" });
    const repo = new FederationGovernanceRepository(db);
    expect(repo.projects(federationId).find((item) => item.id === national.id)?.status).toBe("COMPLETED");
    expect(repo.assets(federationId).some((asset) => asset.ownership === "OWNED" && asset.assetType === "TRAINING_CENTRE")).toBe(true);
    expect(repo.ledgerEntries(federationId).some((entry) => entry.relatedEntityId === national.id && entry.category === "INFRASTRUCTURE")).toBe(true);
    db.close();
    const reloadedDb = openGameDatabase(path);
    const reloaded = new FederationGovernanceRepository(reloadedDb);
    expect(reloaded.projects(federationId).find((item) => item.id === national.id)?.components).toContain("national_pitches");
    reloadedDb.close();
  });
});
