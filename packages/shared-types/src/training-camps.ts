import type { EntityId } from "./ids.js";
export type CampDestination="NEPAL"|"INDIA"|"THAILAND"|"JAPAN"|"SOUTH_KOREA"|"QATAR_UAE"|"AUSTRALIA"|"EUROPE";
export type CampOwnerType="CLUB"|"FEDERATION";
export type CampProgrammeType="CLUB"|"NATIONAL_TEAM"|"WOMENS_TEAM"|"YOUTH_TEAM";
export type TrainingCampStatus="PROPOSED"|"NEGOTIATED_PLANNED"|"BOOKED"|"TRAVELLING"|"ACTIVE"|"COMPLETED"|"CANCELLED";
export type TrainingCamp={id:EntityId;ownerType:CampOwnerType;ownerId:EntityId;programmeType:CampProgrammeType;destination:CampDestination;startDate:string;endDate:string;cost:number;facilityQuality:number;climateFit:number;oppositionAccess:number;travelBurden:number;logisticsDifficulty:number;commercialExposure:number;scoutingExposure:number;status:TrainingCampStatus;participantIds:EntityId[];provenanceStatus:"SIMULATION_ONLY"};
export type TrainingCampParticipant={id:EntityId;campId:EntityId;participantId:EntityId;participantType:"PLAYER"|"STAFF";role?:string;effectSummary:Record<string,number>;provenanceStatus:"SIMULATION_ONLY"};
