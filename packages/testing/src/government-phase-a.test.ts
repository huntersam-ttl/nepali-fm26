import { evaluateGovernmentFunding } from "@nepal-football-sim/simulation";
import { describe, expect, it } from "vitest";
import type { EntityId } from "@nepal-football-sim/shared-types";

const id = (value: string) => value as EntityId;
const institution = { id:id("nsc"), name:"National Sports Council", institutionType:"NATIONAL_SPORTS_COUNCIL", profile:{budgetCapacity:100000,committedBudget:10000,footballPriority:80,credibilityTowardFederation:70,infrastructurePriority:90,youthWomenPriority:60}, provenanceStatus:"SIMULATION_ONLY" } as const;

describe("government funding phase A", () => {
  it("makes deterministic capacity- and evidence-based conditional decisions", () => {
    const input={institution,requestedAmount:30000,fundingType:"INFRASTRUCTURE" as const,evidence:{federationCredibility:70,projectQuality:80,footballPerformance:60,existingCommitments:10}};
    expect(evaluateGovernmentFunding(input)).toEqual(evaluateGovernmentFunding(input));
    expect(evaluateGovernmentFunding(input)).toMatchObject({status:"APPROVED",approvedAmount:30000,conditions:["annual reporting","auditable use of funds","community access"]});
  });
  it("rejects requests when real commitments exhaust capacity", () => {
    expect(evaluateGovernmentFunding({institution:{...institution,profile:{...institution.profile,committedBudget:100000}},requestedAmount:1,fundingType:"YOUTH_GRASSROOTS",evidence:{federationCredibility:100,projectQuality:100,footballPerformance:100,existingCommitments:0}}).status).toBe("REJECTED");
  });
});
