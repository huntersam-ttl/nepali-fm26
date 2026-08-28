import type { ISODate } from "./domain.js";
import type { EntityId } from "./ids.js";

export type InternationalTrialInvitationStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "COMPLETED"
  | "EXPIRED"
  | "CANCELLED";

export type InternationalTrialPlayerResponse = "PENDING" | "ACCEPTED" | "REJECTED";

export type InternationalTrialState =
  | "INVITED"
  | "ACTIVE"
  | "COMPLETED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";

export type InternationalTrialSource =
  | "SCOUTING"
  | "AI_RECRUITMENT"
  | "EXTERNAL_SCOUTING"
  | "MANUAL";

/**
 * A temporary evaluation relationship. The current data model intentionally
 * uses playerId as the canonical person/player identity; it does not create a
 * second temporary player entity.
 */
export type InternationalTrialRecord = {
  id: EntityId;
  playerId: EntityId;
  hostClubId: EntityId;
  currentClubIdAtInvitation?: EntityId;
  parentClubPermissionGranted: boolean;
  invitedOn: ISODate;
  startDate: ISODate;
  endDate: ISODate;
  invitationStatus: InternationalTrialInvitationStatus;
  playerResponse: InternationalTrialPlayerResponse;
  state: InternationalTrialState;
  source: InternationalTrialSource;
  reason?: string;
  decidedOn?: ISODate;
  completedOn?: ISODate;
};
