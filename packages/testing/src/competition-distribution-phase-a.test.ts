import { describe, expect, it } from "vitest";
import { calculateCompetitionDistribution, validateDistributionPolicy } from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

const policy={id:createStableEntityId("distribution-policy","policy"),federationId:createStableEntityId("federation","fed"),competitionSeasonId:createStableEntityId("season","season"),version:1,poolAmount:100000,championPrize:.2,runnerUpPrize:.1,placementPrizes:.1,participationPayments:.2,equalSharePayments:.1,performanceSharePayments:.1,audienceShare:.05,youthDevelopmentIncentives:.05,womensFootballIncentives:.05,infrastructureGrants:.05,status:"APPROVED",provenanceStatus:"SIMULATION_ONLY"} as const;
const clubA=createStableEntityId("club","a");
const standings=[{clubId:clubA,position:1,performance:60,audience:100,youthEligible:true},{clubId:createStableEntityId("club","b"),position:2,performance:30,audience:50,womensEligible:true},{clubId:createStableEntityId("club","c"),position:3,performance:10,audience:25,infrastructureEligible:true}];

describe("competition distribution phase A",()=>{it("calculates deterministic, policy-bounded incentives",()=>{validateDistributionPolicy(policy);const first=calculateCompetitionDistribution({policy,standings});expect(first).toEqual(calculateCompetitionDistribution({policy,standings}));expect(first.find((line)=>line.clubId===clubA)?.reason).toContain("champion prize");expect(first.reduce((sum,line)=>sum+line.amount,0)).toBeLessThanOrEqual(policy.poolAmount);});it("rejects policies that over-allocate funds",()=>{expect(()=>validateDistributionPolicy({...policy,championPrize:1.1})).toThrow();});});
