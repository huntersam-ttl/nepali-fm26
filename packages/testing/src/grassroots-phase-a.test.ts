import { describe, expect, it } from "vitest";
import { delayedGrassrootsImpact } from "@nepal-football-sim/simulation";

const programme = { id:"programme",name:"SIMULATION_ONLY school league",programmeType:"SCHOOL_LEAGUE",locationId:"municipality-1",locationKind:"MUNICIPALITY",annualFunding:20000,coachingAccess:70,facilityAccess:60,regionalParticipation:80,localFootballPriority:90,yearsActive:0,status:"ACTIVE",provenanceStatus:"SIMULATION_ONLY" } as const;

describe("grassroots phase A", () => { it("delays youth-pool impact until programmes mature", () => { expect(delayedGrassrootsImpact(programme).playerPoolMultiplier).toBe(0); expect(delayedGrassrootsImpact({...programme,yearsActive:3}).playerPoolMultiplier).toBeGreaterThan(0); expect(delayedGrassrootsImpact({...programme,yearsActive:3})).toEqual(delayedGrassrootsImpact({...programme,yearsActive:3})); }); it("does not generate impact for suspended programmes", () => { expect(delayedGrassrootsImpact({...programme,yearsActive:10,status:"SUSPENDED"}).participationMultiplier).toBe(0); }); });
