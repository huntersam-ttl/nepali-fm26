import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FederationPoliticsRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { createFederationElectionCycle, createNepalSave, generateFederationCandidates, initializeFederationGovernanceForSave, runFederationElection } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => { const dir = mkdtempSync(join(tmpdir(), "federation-governance-phase-a-")); dirs.push(dir); const path = join(dir, "career.sqlite"); createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name }); return path; };
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("Federation governance phase A", () => {
  it("runs a deterministic eligible-candidate election and persists a peaceful transition", () => {
    const first = openGameDatabase(makeSave("governance-deterministic")); const second = openGameDatabase(makeSave("governance-deterministic"));
    initializeFederationGovernanceForSave({ db: first, worldDate: "2026-08-01", seed: "governance-deterministic" }); initializeFederationGovernanceForSave({ db: second, worldDate: "2026-08-01", seed: "governance-deterministic" });
    const federationId = (first.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    const run = (db: typeof first) => { const cycle = createFederationElectionCycle(db, { federationId, electionDate: "2028-11-30" }); generateFederationCandidates(db, { cycleId: cycle.id, federationId, date: "2028-09-01", seed: "governance-deterministic" }); const result = runFederationElection(db, { cycleId: cycle.id, date: "2028-11-30", seed: "governance-deterministic" }); const repo = new FederationPoliticsRepository(db); return { result, candidates: repo.candidates(cycle.id), cycles: repo.cycles(federationId) }; };
    const a = run(first); const b = run(second);
    expect(a.result).toEqual(b.result); expect(a.candidates.map((item) => item.status)).toContain("ELECTED"); expect(a.cycles[0].status).toBe("COMPLETED");
    first.close(); second.close();
  });
});
