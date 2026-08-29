import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FederationGovernancePhaseBRepository, FederationPoliticsRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { createFederationElectionCycle, createNepalSave, createFederationGovernanceProposal, decideFederationGovernanceProposal, generateFederationCandidates, initializeFederationGovernanceForSave, implementFederationGovernanceProposal, reviewFederationGovernanceProposal, runFederationElection, submitFederationGovernanceProposalCommand, updateFederationConfidence } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => { const dir = mkdtempSync(join(tmpdir(), "federation-governance-phase-b-")); dirs.push(dir); const path = join(dir, "career.sqlite"); createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name }); return path; };
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("Federation governance phase B", () => {
  it("requires committee review, records policy history, tracks confidence, and persists", () => {
    const db = openGameDatabase(makeSave("governance-phase-b")); initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "governance-phase-b" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id; const cycle = createFederationElectionCycle(db, { federationId, electionDate: "2028-11-30" }); const candidates = generateFederationCandidates(db, { cycleId: cycle.id, federationId, date: "2028-09-01", seed: "governance-phase-b" }); const result = runFederationElection(db, { cycleId: cycle.id, date: "2028-11-30", seed: "governance-phase-b" });
    const proposal = createFederationGovernanceProposal(db, { federationId, proposedByPersonId: result.electedPersonId, title: "Regional development programme", policyArea: "DEVELOPMENT", payload: {}, proposedAt: "2029-01-01" });
    expect(() => implementFederationGovernanceProposal(db, proposal.id, "2029-01-02")).toThrow("approved");
    reviewFederationGovernanceProposal(db, proposal.id, "2029-01-02"); const decided = decideFederationGovernanceProposal(db, proposal.id, { date: "2029-01-03", seed: "governance-phase-b", approve: true }); expect(decided.status).toBe("APPROVED"); expect(implementFederationGovernanceProposal(db, proposal.id, "2029-01-04").status).toBe("IMPLEMENTED");
    expect(updateFederationConfidence(db, { federationId, date: "2029-02-01", outcome: "FAILURE" }).confidence).toBeLessThan(0.68); const replacement = candidates.find((item) => item.personId !== result.electedPersonId)!; expect(updateFederationConfidence(db, { federationId, date: "2029-03-01", outcome: "SUCCESS" }).status).toBe("CONFIDENT");
    expect(new FederationGovernancePhaseBRepository(db).events(federationId).length).toBeGreaterThan(2); expect(new FederationPoliticsRepository(db).results(federationId)[0].electedPersonId).toBe(result.electedPersonId); void replacement; db.close();
  });

  it("routes the federation-president command through the canonical proposal service", () => {
    const databasePath = makeSave("governance-command");
    const db = openGameDatabase(databasePath);
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "governance-command" });
    const federationId = (db.prepare("SELECT id FROM federations WHERE name = 'All Nepal Football Association'").get() as { id: EntityId }).id;
    const cycle = createFederationElectionCycle(db, { federationId, electionDate: "2028-11-30" });
    generateFederationCandidates(db, { cycleId: cycle.id, federationId, date: "2028-09-01", seed: "governance-command" });
    const elected = runFederationElection(db, { cycleId: cycle.id, date: "2028-11-30", seed: "governance-command" });
    const input = { federationId, proposedByPersonId: elected.electedPersonId, title: "Command-routed development proposal", policyArea: "DEVELOPMENT" as const, payload: {}, proposedAt: "2029-01-01" };
    const proposal = submitFederationGovernanceProposalCommand(db, { ...input, callerRole: "FEDERATION_PRESIDENT" });
    expect(proposal.status).toBe("PROPOSED");
    expect(new FederationGovernancePhaseBRepository(db).events(federationId).some((event) => event.subjectId === proposal.id)).toBe(true);
    expect(() => submitFederationGovernanceProposalCommand(db, { ...input, title: "Manager attempt", callerRole: "MANAGER" })).toThrow("Only the federation president");
    expect(() => submitFederationGovernanceProposalCommand(db, { ...input, title: "Chairman attempt", callerRole: "CHAIRMAN_OWNER" })).toThrow("Only the federation president");
    expect(() => submitFederationGovernanceProposalCommand(db, { ...input, federationId: "missing-federation" as EntityId, callerRole: "FEDERATION_PRESIDENT" })).toThrow("context-only federations");
    db.close();
    const reopened = openGameDatabase(databasePath);
    try {
      expect(new FederationGovernancePhaseBRepository(reopened).proposals().some((item) => item.id === proposal.id && item.status === "PROPOSED")).toBe(true);
      expect(new FederationGovernancePhaseBRepository(reopened).events(federationId).some((event) => event.subjectId === proposal.id)).toBe(true);
    } finally {
      reopened.close();
    }
  });
});
