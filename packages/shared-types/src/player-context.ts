import type { EntityId } from "./ids.js";
import type { PlayerContractRecord } from "./domain.js";

// Duplicated from desktop-contract.ts's CareerRole rather than imported, to
// avoid a circular import (desktop-contract.ts itself imports the player
// action/context types below).
type ActorRole =
  | "MANAGER"
  | "CHAIRMAN_OWNER"
  | "FEDERATION_PRESIDENT"
  | "SPORTING_DIRECTOR"
  | "DIRECTOR_OF_FOOTBALL"
  | "CEO"
  | "GENERAL_SECRETARY";

/**
 * Actor-aware player action availability — the same real authority check
 * every mutating player command itself uses (a Manager only controlling
 * their own squad, an Owner/President never mutating football decisions),
 * surfaced so a profile screen can grey out or hide a button honestly
 * instead of letting the command itself reject it after the click.
 */
export type PlayerActionId =
  | "TRANSFER_LIST"
  | "LOAN_LIST"
  | "RELEASE"
  | "RENEW_CONTRACT"
  | "SQUAD_ROLE"
  | "PROMISES"
  | "SHORTLIST_SCOUT";

export type PlayerActionAvailability = { id: PlayerActionId; available: boolean; reason?: string };

export type ActorPlayerActions = {
  playerId: EntityId;
  actorRole: ActorRole;
  clubId?: EntityId;
  actions: PlayerActionAvailability[];
};

/** Real active contract + club name, as of the save's current world date. */
export type PlayerContractContext = {
  playerId: EntityId;
  contract?: PlayerContractRecord;
  clubName?: string;
  asOf: string;
};

/** Real transfer-market status + recent offer activity, never a hidden score. */
export type PlayerTransferContext = {
  playerId: EntityId;
  currentClubId?: EntityId;
  transferStatus: string;
  transferReason?: string;
  activeOfferCount: number;
  recentOfferTypes: string[];
  asOf: string;
};
