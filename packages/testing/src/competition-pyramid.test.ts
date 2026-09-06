import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import { buildCompetitionPyramid, createNepalSave, initializeFederationGovernanceForSave } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "competition-pyramid-"));
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

describe("competition pyramid read model", () => {
  it("only surfaces real domestic tiers that exist in the dataset, in ascending level order, never an invented division", () => {
    const db = openGameDatabase(makeSave("pyramid-real"));
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "pyramid-real" });
    const federationId = (
      db
        .prepare(
          "SELECT f.id FROM federations f JOIN countries c ON c.id=f.country_id WHERE c.iso_code IN ('NP','NPL') ORDER BY f.id LIMIT 1",
        )
        .get() as { id: EntityId }
    ).id;
    const pyramid = buildCompetitionPyramid(db, federationId, "FEDERATION_PRESIDENT", "2026-08-01");
    expect(pyramid.provenanceStatus).toBe("SIMULATION_ONLY");
    expect(pyramid.tiers.length).toBeGreaterThan(0);
    const levels = pyramid.tiers.map((tier) => tier.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    for (const tier of pyramid.tiers) {
      expect(tier.competition.visible).toBe(true);
      expect(tier.competition.label.toLowerCase()).not.toContain("unknown");
      expect(tier.teamCount).toBeGreaterThanOrEqual(0);
    }
    const aDivision = pyramid.tiers.find((tier) => tier.level === 1);
    expect(aDivision?.label).toBe("A Division");
    db.close();
  });

  it("is deterministic for the same real save state", () => {
    const first = openGameDatabase(makeSave("pyramid-det"));
    const second = openGameDatabase(makeSave("pyramid-det"));
    initializeFederationGovernanceForSave({ db: first, worldDate: "2026-08-01", seed: "pyramid-det" });
    initializeFederationGovernanceForSave({ db: second, worldDate: "2026-08-01", seed: "pyramid-det" });
    const federationId = (first.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    const a = buildCompetitionPyramid(first, federationId, "FEDERATION_PRESIDENT", "2026-08-01");
    const b = buildCompetitionPyramid(second, federationId, "FEDERATION_PRESIDENT", "2026-08-01");
    expect(a.tiers.map((t) => t.level)).toEqual(b.tiers.map((t) => t.level));
    expect(a.tiers.map((t) => t.competition.id)).toEqual(b.tiers.map((t) => t.competition.id));
    first.close();
    second.close();
  });
});
