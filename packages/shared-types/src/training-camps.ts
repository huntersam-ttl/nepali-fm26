import type { EntityId } from "./ids.js";
/** The destination presets the built-in camp profiles cover. HOME_COUNTRY is the save's own country; the others are places. A camp's actual country is destinationCountryId. */
export type KnownCampDestination="HOME_COUNTRY"|"INDIA"|"THAILAND"|"JAPAN"|"SOUTH_KOREA"|"QATAR_UAE"|"AUSTRALIA"|"EUROPE";
export type CampDestination=KnownCampDestination|(string&{});
export type CampOwnerType="CLUB"|"FEDERATION";
export type CampProgrammeType="CLUB"|"NATIONAL_TEAM"|"WOMENS_TEAM"|"YOUTH_TEAM";
export type TrainingCampStatus="PROPOSED"|"NEGOTIATED_PLANNED"|"BOOKED"|"TRAVELLING"|"ACTIVE"|"COMPLETED"|"CANCELLED";
export type TrainingCamp={id:EntityId;ownerType:CampOwnerType;ownerId:EntityId;programmeType:CampProgrammeType;destination:CampDestination;destinationCountryId?:EntityId;startDate:string;endDate:string;cost:number;facilityQuality:number;climateFit:number;oppositionAccess:number;travelBurden:number;logisticsDifficulty:number;commercialExposure:number;scoutingExposure:number;status:TrainingCampStatus;participantIds:EntityId[];provenanceStatus:"SIMULATION_ONLY"};
export type TrainingCampParticipant={id:EntityId;campId:EntityId;participantId:EntityId;participantType:"PLAYER"|"STAFF";role?:string;effectSummary:Record<string,number>;provenanceStatus:"SIMULATION_ONLY"};
