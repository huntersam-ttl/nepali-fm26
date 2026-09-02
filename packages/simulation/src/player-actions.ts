import {
  PlayerRepository,
  TransferMarketRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import type {
  ActorPlayerActions,
  CareerRole,
  EntityId,
  PlayerActionId,
  SaveMetadata,
} from "@nepal-football-sim/shared-types";
import { responsibilityOwner } from "./staff-market.js";

export type {
  PlayerActionId,
  PlayerActionAvailability,
  ActorPlayerActions,
} from "@nepal-football-sim/shared-types";

const managerMayUse = (
  db: GameDatabase,
  save: SaveMetadata,
  clubId: EntityId | undefined,
  domain: "TRANSFERS" | "SCOUTING" | "CONTRACTS",
): boolean => {
  if (!clubId) return false;
  const owner = responsibilityOwner(db, clubId, domain);
  return (
    owner.ownerType === "MANAGER" ||
    (owner.ownerType === "BOARD" &&
      Boolean(owner.boardApprovalGrantedUntil && owner.boardApprovalGrantedUntil >= save.worldDate))
  );
};

export const buildActorPlayerActions = (
  db: GameDatabase,
  save: SaveMetadata,
  actorRole: CareerRole,
  actorPersonId: EntityId,
  playerId: EntityId,
): ActorPlayerActions => {
  const player = new PlayerRepository(db).getAttributes(playerId);
  if (!player) throw new Error(`Unknown player ${playerId}.`);
  const manager = db
    .prepare(
      "SELECT t.club_id FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id WHERE mc.person_id=? AND mc.status='ACTIVE' LIMIT 1",
    )
    .get(actorPersonId) as { club_id?: EntityId } | undefined;
  const owner = db
    .prepare(
      "SELECT club_id FROM club_ownership_stakes WHERE holder_id=? AND holder_type='PERSON' AND status='ACTIVE' AND percentage>=51 ORDER BY percentage DESC LIMIT 1",
    )
    .get(actorPersonId) as { club_id?: EntityId } | undefined;
  const playerClub = new TransferMarketRepository(db).activeContract(
    playerId,
    save.worldDate,
  )?.clubId;
  const footballClub = manager?.club_id ?? owner?.club_id;
  const managerOwnsPlayer =
    actorRole === "MANAGER" && Boolean(manager?.club_id && playerClub === manager.club_id);
  const managerClubId = manager?.club_id as EntityId | undefined;
  const transferActions = managerOwnsPlayer && managerMayUse(db, save, managerClubId, "TRANSFERS");
  const contractActions = managerOwnsPlayer && managerMayUse(db, save, managerClubId, "CONTRACTS");
  // Scouting is intentionally available for outside players: shortlist/scout
  // is the mechanism that turns an unknown player into a knowledge-limited
  // recruitment decision. The command still performs the canonical authority
  // check before mutating or persisting a report.
  const scoutingActions =
    actorRole === "MANAGER" &&
    Boolean(managerClubId) &&
    managerMayUse(db, save, managerClubId, "SCOUTING");
  const ownerReadOnly = actorRole === "CHAIRMAN_OWNER" && Boolean(owner?.club_id);
  const reason = ownerReadOnly
    ? "Owner view is read-only; football decisions must be routed through the Manager or delegated Director."
    : actorRole === "FEDERATION_PRESIDENT"
      ? "The President may view player context but cannot mutate club football decisions."
      : "The active role does not control this player's club.";
  const reasonFor = (id: PlayerActionId): string | undefined => {
    if (id === "SHORTLIST_SCOUT" && !scoutingActions && actorRole === "MANAGER")
      return "Scouting responsibility is not currently available to the Manager.";
    if (["RENEW_CONTRACT"].includes(id) && !contractActions)
      return "Contract responsibility is not currently available to the Manager.";
    if (["TRANSFER_LIST", "LOAN_LIST", "RELEASE"].includes(id) && !transferActions)
      return "Transfer responsibility is not currently available to the Manager.";
    return reason;
  };
  return {
    playerId,
    actorRole,
    clubId: footballClub,
    actions: (
      [
        "TRANSFER_LIST",
        "LOAN_LIST",
        "RELEASE",
        "RENEW_CONTRACT",
        "SQUAD_ROLE",
        "PROMISES",
        "SHORTLIST_SCOUT",
      ] as PlayerActionId[]
    ).map((id) => {
      const available =
        id === "SHORTLIST_SCOUT"
          ? scoutingActions
          : id === "RENEW_CONTRACT"
            ? contractActions
            : ["TRANSFER_LIST", "LOAN_LIST", "RELEASE"].includes(id)
              ? transferActions
              : managerOwnsPlayer;
      return { id, available, ...(available ? {} : { reason: reasonFor(id) }) };
    }),
  };
};
