import type { EntityId } from "./ids.js";
export type OwnershipNetworkStrategy="FLAGSHIP_CLUB"|"DEVELOPMENT_CLUB"|"PATHWAY_CLUB"|"COMMERCIAL_MARKET_CLUB"|"ACADEMY_TECHNICAL_PARTNER";
export type OwnershipNetworkRelationshipStatus="ACTIVE"|"REVIEW"|"DISSOLVED";
export type MultiClubOwnershipRecord={id:EntityId;ownerGroupId:EntityId;clubId:EntityId;stakePercentage:number;controlLevel:"NONE"|"MINORITY"|"JOINT"|"MAJORITY";acquisitionDate:string;boardInfluence:number;strategy:OwnershipNetworkStrategy;relationshipStatus:OwnershipNetworkRelationshipStatus;provenanceStatus:"SIMULATION_ONLY"};
export type InternationalClubPartnershipType="SCOUTING"|"YOUTH_DEVELOPMENT"|"STAFF_EXCHANGE"|"TRAINING"|"LOAN_PLAYER_PATHWAY"|"COMMERCIAL";
export type InternationalClubPartnership={id:EntityId;fromClubId:EntityId;toClubId:EntityId;partnershipType:InternationalClubPartnershipType;relationshipStrength:number;startDate:string;endDate?:string;status:"PROPOSED"|"NEGOTIATED"|"ACTIVE"|"SUSPENDED"|"EXPIRED"|"TERMINATED";provenanceStatus:"SIMULATION_ONLY"};
export type ClubNetworkConflict={type:"RELATED_OWNERSHIP"|"VOTING_CONTROL"|"SAME_COMPETITION"|"TRANSFER_DEPENDENCY";clubIds:EntityId[];severity:"LOW"|"MEDIUM"|"HIGH";reason:string;provenanceStatus:"SIMULATION_ONLY"};
