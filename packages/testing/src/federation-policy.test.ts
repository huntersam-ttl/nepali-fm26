import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { FederationElectionCandidate } from "@nepal-football-sim/shared-types";
import { FederationPolicyRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  advanceFederationPolicies,
  campaignSupportEstimate,
  createFederationPolicy,
  createNepalSave,
  federationDevelopmentSummary,
  policyCategoryForManifesto,
} from "@nepal-football-sim/simulation";

const candidate: FederationElectionCandidate = {
  id: "candidate" as FederationElectionCandidate["id"],
  cycleId: "cycle" as FederationElectionCandidate["cycleId"],
  federationId: "federation" as FederationElectionCandidate["federationId"],
  personId: "person" as FederationElectionCandidate["personId"],
  reputation: 6,
  supportBase: 5,
  committeeInfluence: 0.5,
  votingBlocs: { clubs: 0.6, districts: 0.5, regions: 0.4 },
  manifesto: { YOUTH_ELITE_DEVELOPMENT: 0.8 },
  incumbent: false,
  status: "ELIGIBLE",
  provenanceStatus: "SIMULATION_ONLY",
};

describe("federation campaigning and policy foundation", () => {
  it("derives deterministic bounded campaign support", () => {
    const input = {
      candidate,
      previousPerformance: 55,
      policyAlignment: 70,
      promiseRecord: { fulfilled: 2, broken: 0 },
    };
    expect(campaignSupportEstimate(input)).toBe(campaignSupportEstimate(input));
    expect(campaignSupportEstimate(input)).toBeGreaterThanOrEqual(0);
    expect(campaignSupportEstimate(input)).toBeLessThanOrEqual(100);
  });

  it("maps only supported manifesto priorities to policy categories", () => {
    expect(policyCategoryForManifesto("YOUTH_ELITE_DEVELOPMENT")).toBe("YOUTH_DEVELOPMENT");
    expect(policyCategoryForManifesto("WOMENS_FOOTBALL")).toBe("WOMENS_DEVELOPMENT");
    expect(policyCategoryForManifesto("UNSUPPORTED_PLATFORM")).toBeUndefined();
  });

  it("advances only funded policies and keeps proposed commitments pending", () => {
    const directory = mkdtempSync(join(tmpdir(), "federation-policy-season-"));
    const path = join(directory, "career.sqlite");
    const datasetPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(datasetPath, "utf8")) as unknown,
      saveName: "federation-policy-season",
      gameVersion: "test",
      randomSeed: "federation-policy-season",
    });
    const db = openGameDatabase(path);
    const federationId = (
      db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: string }
    ).id as typeof candidate.federationId;
    const proposed = createFederationPolicy(db, {
      federationId,
      category: "YOUTH_DEVELOPMENT",
      title: "Pending youth plan",
      status: "PROPOSED",
      startDate: "2026-08-01",
      fundingCommitted: 0,
      implementationProgress: 0,
      targetValue: 100,
      effects: {},
    });
    const funded = createFederationPolicy(db, {
      federationId,
      category: "COACHING_EDUCATION",
      title: "Funded coaching plan",
      status: "FUNDED",
      startDate: "2026-08-01",
      fundingCommitted: 100,
      implementationProgress: 0,
      targetValue: 100,
      effects: {},
    });

    advanceFederationPolicies(db, { federationId, date: "2027-07-31" });
    const repository = new FederationPolicyRepository(db);
    const policy = (id: typeof proposed.id) =>
      repository.policies(federationId).find((item) => item.id === id);
    expect(policy(proposed.id)?.implementationProgress).toBe(0);
    expect(policy(proposed.id)?.status).toBe("PROPOSED");
    expect(policy(funded.id)?.implementationProgress).toBe(12);
    expect(policy(funded.id)?.status).toBe("IMPLEMENTING");
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("aggregates policy outcomes into explainable dimension bands", () => {
    const directory = mkdtempSync(join(tmpdir(), "federation-development-summary-"));
    const path = join(directory, "career.sqlite");
    const datasetPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(datasetPath, "utf8")) as unknown,
      saveName: "federation-development-summary",
      gameVersion: "test",
      randomSeed: "federation-development-summary",
    });
    const db = openGameDatabase(path);
    const federationId = (
      db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: string }
    ).id as typeof candidate.federationId;
    createFederationPolicy(db, {
      federationId,
      category: "REFEREE_DEVELOPMENT",
      title: "Referee pathway",
      status: "IMPLEMENTING",
      startDate: "2026-08-01",
      fundingCommitted: 100,
      implementationProgress: 50,
      targetValue: 100,
      effects: {},
    });
    const first = federationDevelopmentSummary(db, federationId, "2027-07-31");
    const second = federationDevelopmentSummary(db, federationId, "2027-07-31");
    expect(first).toEqual(second);
    expect(first.dimensions.refereeing).toBeDefined();
    expect(first.impactSummaries).toContain("REFEREE_DEVELOPMENT: 50% implemented");
    expect(first.trend).toBe("IMPROVING");
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
