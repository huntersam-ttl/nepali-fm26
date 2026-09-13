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
import { executiveHasAuthority } from "./executive-roles.js";
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
  const isDelegatedExecutive = (
    ["CEO", "GENERAL_SECRETARY", "SPORTING_DIRECTOR", "DIRECTOR_OF_FOOTBALL"] as CareerRole[]
  ).includes(actorRole);
  // The generic fallback reason is actor-aware by construction: an Owner is
  // told football authority sits with the Manager, a President is told this
  // is outside federation authority over a club, and a delegated executive
  // is told their delegation doesn't extend to direct player control. Only
  // the Manager gets the more specific "which responsibility, and why"
  // reasons below, since only the Manager can actually hold (or be denied)
  // one of those responsibilities in the first place. An executive who
  // genuinely holds recruitment/contract authority at this player's club is
  // pointed at their recruitment desk instead of being dead-ended.
  const executiveRecruits =
    isDelegatedExecutive &&
    playerClub !== undefined &&
    (
      ["RECRUITMENT_STRATEGY", "TRANSFER_NEGOTIATION", "LOAN_STRATEGY", "PLAYER_CONTRACTS"] as const
    ).some((authority) => executiveHasAuthority(db, playerClub, actorPersonId, authority));
  const reason = ownerReadOnly
    ? "Owner view is read-only; football decisions must be routed through the Manager or delegated Director."
    : actorRole === "FEDERATION_PRESIDENT"
      ? "The President may view player context but cannot mutate club football decisions."
      : executiveRecruits
        ? "On-pitch decisions for this player stay with the Manager. Recruitment, contract and loan business runs through your own recruitment desk."
        : isDelegatedExecutive
          ? "This delegated role does not carry direct control over players; football decisions remain with the Manager."
          : "The active role does not control this player's club.";
  const reasonFor = (id: PlayerActionId): string | undefined => {
    if (actorRole !== "MANAGER") return reason;
    if (id === "SHORTLIST_SCOUT" && !scoutingActions)
      return "Scouting responsibility is not currently available to the Manager.";
    if (id === "RENEW_CONTRACT" && !contractActions)
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
