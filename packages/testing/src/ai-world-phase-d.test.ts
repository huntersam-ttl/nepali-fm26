import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExternalFootballRepository, FederationGovernanceRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { createNepalSave, initializeClubEconomyForSave, initializeFederationGovernanceForSave, processExternalFootballWorldSeason } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "ai-world-phase-d-")); dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: seed, gameVersion: "test", randomSeed: seed });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("AI world phase D", () => {
  it("evolves foreign regions deterministically across 20, 30 and 50 years and reloads", () => {
    const path = makeSave("external-world");
    const db = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "external-world" });
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "external-world" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    for (const year of [2026, 2046, 2056, 2076]) processExternalFootballWorldSeason(db, { seasonLabel: String(year), seed: "external-world" });
    const profiles = new ExternalFootballRepository(db).profiles();
    expect(new Set(profiles.map((profile) => profile.region)).size).toBe(5);
    expect(profiles).toHaveLength(20);
    expect(profiles.some((profile) => profile.region === "SOUTH_ASIA" && profile.transferDemand > 0)).toBe(true);
    expect(new FederationGovernanceRepository(db).financialAccount(federationId)?.cashBalance).toBeGreaterThan(0);
    db.close();
    const reloaded = openGameDatabase(path);
    expect(new ExternalFootballRepository(reloaded).profiles()).toEqual(profiles);
    reloaded.close();
  });
});
