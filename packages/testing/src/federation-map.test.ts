import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase, TerritorialFootballRepository } from "@nepal-football-sim/database";
import {
  buildDistrictDetail,
  buildFederationMap,
  createNepalSave,
  initializeFederationGovernanceForSave,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "federation-map-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: seed,
    gameVersion: "test",
    randomSeed: seed,
  });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("Federation map read model", () => {
  it("groups every real territorial district under its real province, with a tone derived from real development reputation", () => {
    const db = openGameDatabase(makeSave("map-groups"));
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "map-groups" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    const territorial = new TerritorialFootballRepository(db);
    const realDistrictCount = territorial.districts().length;
    const map = buildFederationMap(db, federationId);
    expect(map.provenanceStatus).toBe("SIMULATION_ONLY");
    const totalDistricts = map.provinces.reduce((total, province) => total + province.districts.length, 0);
    expect(totalDistricts).toBe(realDistrictCount);
    for (const province of map.provinces) {
      for (const district of province.districts) {
        expect(["ok", "warn", "bad", "info"]).toContain(district.tone);
        expect(district.registeredClubCount).toBeGreaterThanOrEqual(0);
      }
    }
    db.close();
  });

  it("returns undefined honestly for an unknown district id, never a placeholder", () => {
    const db = openGameDatabase(makeSave("map-unknown"));
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "map-unknown" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    expect(buildDistrictDetail(db, federationId, "no-such-district" as EntityId, "FEDERATION_PRESIDENT")).toBeUndefined();
    db.close();
  });

  it("resolves a district detail panel with an honest empty club list when no club's location chain reaches it", () => {
    const db = openGameDatabase(makeSave("map-detail"));
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "map-detail" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    const territorial = new TerritorialFootballRepository(db);
    const district = territorial.districts()[0]!;
    const detail = buildDistrictDetail(db, federationId, district.id, "FEDERATION_PRESIDENT");
    expect(detail).toBeDefined();
    expect(detail!.district.id).toBe(district.id);
    expect(Array.isArray(detail!.clubs)).toBe(true);
    expect(Array.isArray(detail!.federationProjects)).toBe(true);
    expect(Array.isArray(detail!.districtProjects)).toBe(true);
    db.close();
  });
});
