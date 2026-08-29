import type { EntityId } from "./ids.js";
export type OwnershipNetworkStrategy="FLAGSHIP_CLUB"|"DEVELOPMENT_CLUB"|"PATHWAY_CLUB"|"COMMERCIAL_MARKET_CLUB"|"ACADEMY_TECHNICAL_PARTNER";
export type OwnershipNetworkRelationshipStatus="ACTIVE"|"REVIEW"|"DISSOLVED";
export type MultiClubOwnershipRecord={id:EntityId;ownerGroupId:EntityId;clubId:EntityId;stakePercentage:number;controlLevel:"NONE"|"MINORITY"|"JOINT"|"MAJORITY";acquisitionDate:string;boardInfluence:number;strategy:OwnershipNetworkStrategy;relationshipStatus:OwnershipNetworkRelationshipStatus;provenanceStatus:"SIMULATION_ONLY"};
export type InternationalClubPartnershipType="SCOUTING"|"TECHNICAL"|"YOUTH_DEVELOPMENT"|"ACADEMY"|"STAFF_EXCHANGE"|"TRAINING"|"LOAN_PLAYER_PATHWAY"|"LOAN"|"PREFERRED_TRANSFER"|"COMMERCIAL"|"FRIENDLY_TOUR";
export type InternationalClubPartnership={id:EntityId;fromClubId:EntityId;toClubId:EntityId;partnershipType:InternationalClubPartnershipType;relationshipStrength:number;startDate:string;endDate?:string;status:"PROPOSED"|"NEGOTIATED"|"ACTIVE"|"SUSPENDED"|"EXPIRED"|"TERMINATED";provenanceStatus:"SIMULATION_ONLY"};
export const isInternationalClubPartnershipActive=(partnership:InternationalClubPartnership,simulationDate:string):boolean=>partnership.status==="ACTIVE"&&partnership.startDate<=simulationDate&&(!partnership.endDate||partnership.endDate>=simulationDate);
export type ClubNetworkConflict={type:"RELATED_OWNERSHIP"|"VOTING_CONTROL"|"SAME_COMPETITION"|"TRANSFER_DEPENDENCY";clubIds:EntityId[];severity:"LOW"|"MEDIUM"|"HIGH";reason:string;provenanceStatus:"SIMULATION_ONLY"};
