import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import {
  buildNationDevelopmentScorecard,
  createNepalSave,
  initializeFederationGovernanceForSave,
  processFederationMonth,
  recordFederationDevelopmentSnapshot,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "federation-scorecard-"));
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

describe("Build-a-Nation development scorecard", () => {
  it("derives every category from the real, already-persisted FederationSimulationProfile — never a fabricated rating", () => {
    const db = openGameDatabase(makeSave("scorecard-derive"));
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "scorecard-derive" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    const scorecard = buildNationDevelopmentScorecard(db, federationId, "2026-08-01");
    expect(scorecard).toBeDefined();
    expect(scorecard!.categories).toHaveLength(10);
    for (const category of scorecard!.categories) {
      expect(category.score).toBeGreaterThanOrEqual(0);
      expect(category.score).toBeLessThanOrEqual(100);
    }
    expect(scorecard!.overallScore).toBeGreaterThanOrEqual(0);
    expect(scorecard!.overallScore).toBeLessThanOrEqual(100);
    expect(scorecard!.strongest.score).toBeGreaterThanOrEqual(scorecard!.weakest.score);
    expect(scorecard!.provenanceStatus).toBe("SIMULATION_ONLY");
    db.close();
  });

  it("returns undefined honestly rather than a placeholder for a federation with no profile on record", () => {
    const db = openGameDatabase(makeSave("scorecard-none"));
    const scorecard = buildNationDevelopmentScorecard(db, "no-such-federation" as EntityId, "2026-08-01");
    expect(scorecard).toBeUndefined();
    db.close();
  });

  it("records exactly one snapshot per federation per season, never one per tick", () => {
    const db = openGameDatabase(makeSave("scorecard-snapshot"));
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "scorecard-snapshot" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    recordFederationDevelopmentSnapshot(db, federationId, "2026-08-01");
    recordFederationDevelopmentSnapshot(db, federationId, "2026-08-01");
    recordFederationDevelopmentSnapshot(db, federationId, "2026-09-15");
    const withHistory = buildNationDevelopmentScorecard(db, federationId, "2026-09-15");
    expect(withHistory!.history).toHaveLength(1);
    expect(withHistory!.history[0]!.seasonLabel).toBe("2026");
    // A later year adds a second row, never replacing or duplicating the first.
    recordFederationDevelopmentSnapshot(db, federationId, "2027-08-01");
    const nextYear = buildNationDevelopmentScorecard(db, federationId, "2027-08-01");
    expect(nextYear!.history).toHaveLength(2);
    db.close();
  });

  it("computes a trend against the most recent prior snapshot once history exists", () => {
    const db = openGameDatabase(makeSave("scorecard-trend"));
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "scorecard-trend" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    const first = buildNationDevelopmentScorecard(db, federationId, "2026-08-01");
    expect(first!.trend).toBeUndefined();
    recordFederationDevelopmentSnapshot(db, federationId, "2026-08-01");
    const second = buildNationDevelopmentScorecard(db, federationId, "2027-08-01");
    expect(second!.trend).toBe("STABLE");
    db.close();
  });

  it("is wired into the monthly federation tick and never duplicates a snapshot when the tick reruns the same month", () => {
    const db = openGameDatabase(makeSave("scorecard-tick"));
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "scorecard-tick" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    processFederationMonth(db, { date: "2026-08-01", seed: "scorecard-tick", aiEnabled: false });
    processFederationMonth(db, { date: "2026-08-01", seed: "scorecard-tick", aiEnabled: false });
    processFederationMonth(db, { date: "2026-09-01", seed: "scorecard-tick", aiEnabled: false });
    const scorecard = buildNationDevelopmentScorecard(db, federationId, "2026-09-01");
    expect(scorecard!.history).toHaveLength(1);
    db.close();
  });
});
