import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import {
  buildFederationRefereeContext,
  createNepalSave,
  initializeFederationGovernanceForSave,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "federation-referee-context-"));
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

describe("federation referee/coaching context", () => {
  it("returns a real, bounded governance summary and a non-negative referee pool size — never a raw error or a fabricated rating", () => {
    const db = openGameDatabase(makeSave("referee-context"));
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "referee-context" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    const context = buildFederationRefereeContext(db, federationId, "2026-08-01");
    expect(context.provenanceStatus).toBe("SIMULATION_ONLY");
    expect(context.poolSize).toBeGreaterThanOrEqual(0);
    expect(context.activeDevelopmentProgrammes).toBeGreaterThanOrEqual(0);
    expect(["LIMITED", "WORKING", "STRONG"]).toContain(context.governance.appointmentConfidence);
    expect(["LIMITED", "WORKING", "STRONG"]).toContain(context.governance.stakeholderTrust);
    expect(context.governance.recentAssignments).toBeGreaterThanOrEqual(0);
    expect(context.governance.recentMatchEvents.cards).toBeGreaterThanOrEqual(0);
    db.close();
  });

  it("is deterministic for the same real save state", () => {
    const first = openGameDatabase(makeSave("referee-context-det"));
    const second = openGameDatabase(makeSave("referee-context-det"));
    initializeFederationGovernanceForSave({ db: first, worldDate: "2026-08-01", seed: "referee-context-det" });
    initializeFederationGovernanceForSave({ db: second, worldDate: "2026-08-01", seed: "referee-context-det" });
    const federationId = (first.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    const a = buildFederationRefereeContext(first, federationId, "2026-08-01");
    const b = buildFederationRefereeContext(second, federationId, "2026-08-01");
    expect(a).toEqual(b);
    first.close();
    second.close();
  });
});
