import { describe, expect, it } from "vitest";
import type { FederationElectionCandidate } from "@nepal-football-sim/shared-types";
import {
  campaignSupportEstimate,
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
});
