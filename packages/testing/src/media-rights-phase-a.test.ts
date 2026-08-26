import { describe, expect, it } from "vitest";
import { calculateMediaRightsOffer } from "@nepal-football-sim/simulation";

const broadcaster={id:"broadcaster",name:"SIMULATION_ONLY broadcaster",marketReach:60,reliability:80,financialStrength:70,productionCapability:65,domesticReach:75,internationalReach:20,provenanceStatus:"SIMULATION_ONLY"} as const;
const rightsPackage={id:"package",federationId:"fed",name:"Domestic Cup",category:"COMPETITION",availableFrom:"2027-01-01",availableTo:"2027-12-31",status:"AVAILABLE",retainedByFederation:false,provenanceStatus:"SIMULATION_ONLY"} as const;
const evidence={competitionReputation:50,nationalTeamRelevance:20,audience:10000,sponsorValue:40,internationalInterest:15};

describe("federation media rights phase A",()=>{it("prices offers from persisted audience and broadcaster state deterministically",()=>{const input={packageId:"package",federationId:"fed",broadcaster,rightsPackage,evidence,offeredOn:"2027-01-01"};expect(calculateMediaRightsOffer(input)).toEqual(calculateMediaRightsOffer(input));expect(calculateMediaRightsOffer(input)).toMatchObject({status:"OFFERED",productionQuality:65});});});
