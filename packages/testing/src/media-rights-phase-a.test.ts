import { describe, expect, it } from "vitest";
import { calculateMediaRightsOffer } from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

const broadcaster={id:createStableEntityId("broadcaster","broadcaster"),name:"SIMULATION_ONLY broadcaster",marketReach:60,reliability:80,financialStrength:70,productionCapability:65,domesticReach:75,internationalReach:20,provenanceStatus:"SIMULATION_ONLY"} as const;
const rightsPackage={id:createStableEntityId("media-package","package"),federationId:createStableEntityId("federation","fed"),name:"Domestic Cup",category:"COMPETITION",availableFrom:"2027-01-01",availableTo:"2027-12-31",status:"AVAILABLE",retainedByFederation:false,provenanceStatus:"SIMULATION_ONLY"} as const;
const evidence={competitionReputation:50,nationalTeamRelevance:20,audience:10000,sponsorValue:40,internationalInterest:15};

describe("federation media rights phase A",()=>{it("prices offers from persisted audience and broadcaster state deterministically",()=>{const input={packageId:rightsPackage.id,federationId:rightsPackage.federationId,broadcaster,rightsPackage,evidence,offeredOn:"2027-01-01"};expect(calculateMediaRightsOffer(input)).toEqual(calculateMediaRightsOffer(input));expect(calculateMediaRightsOffer(input)).toMatchObject({status:"OFFERED",productionQuality:65});});});
