import { describe, expect, it } from "vitest";
import { quoteInsurancePolicy } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const id = (value: string) => value as EntityId;
const insurer={id:id("insurer"),name:"SIMULATION_ONLY insurer",financialStrength:80,reliability:75,premiumLevel:100,coverageQuality:70,exclusions:[] as string[],claimReputation:70,provenanceStatus:"SIMULATION_ONLY"} as const;
const coverage={matchInjury:true,trainingInjury:true,rehabilitation:true,majorTreatment:true,travel:false,nationalTeamDuty:false,careerEnding:false};
describe("insurance phase A",()=>{it("quotes deterministic bounded club cover",()=>{const input={ownerType:"CLUB" as const,ownerId:id("club"),insurer,coverage,startDate:"2027-01-01",endDate:"2027-12-31",riskScore:30};const first=quoteInsurancePolicy(input);expect(first).toEqual(quoteInsurancePolicy(input));expect(first.premium).toBeGreaterThan(0);expect(first.coverageCap).toBeGreaterThan(first.deductible);});it("keeps national-team duty separate from club cover",()=>{const policy=quoteInsurancePolicy({ownerType:"FEDERATION",ownerId:id("fed"),insurer,coverage:{...coverage,nationalTeamDuty:true},startDate:"2027-01-01",endDate:"2027-12-31",riskScore:20});expect(policy.ownerType).toBe("FEDERATION");expect(policy.coverage.nationalTeamDuty).toBe(true);});});
