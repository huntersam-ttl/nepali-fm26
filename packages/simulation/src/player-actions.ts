import { PlayerRepository, TransferMarketRepository, type GameDatabase } from "@nepal-football-sim/database";
import type { CareerRole, EntityId, SaveMetadata } from "@nepal-football-sim/shared-types";

export type PlayerActionId = "TRANSFER_LIST" | "LOAN_LIST" | "RELEASE" | "RENEW_CONTRACT" | "SQUAD_ROLE" | "PROMISES" | "SHORTLIST_SCOUT";
export type PlayerActionAvailability = { id: PlayerActionId; available: boolean; reason?: string };
export type ActorPlayerActions = { playerId: EntityId; actorRole: CareerRole; clubId?: EntityId; actions: PlayerActionAvailability[] };

export const buildActorPlayerActions = (db: GameDatabase, save: SaveMetadata, actorRole: CareerRole, actorPersonId: EntityId, playerId: EntityId): ActorPlayerActions => {
  const player = new PlayerRepository(db).getAttributes(playerId);
  if (!player) throw new Error(`Unknown player ${playerId}.`);
  const manager = db.prepare("SELECT t.club_id FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id WHERE mc.person_id=? AND mc.status='ACTIVE' LIMIT 1").get(actorPersonId) as { club_id?: EntityId } | undefined;
  const owner = db.prepare("SELECT club_id FROM club_ownership_stakes WHERE holder_id=? AND holder_type='PERSON' AND status='ACTIVE' AND percentage>=51 ORDER BY percentage DESC LIMIT 1").get(actorPersonId) as { club_id?: EntityId } | undefined;
  const playerClub = new TransferMarketRepository(db).activeContract(playerId, save.worldDate)?.clubId;
  const footballClub = manager?.club_id ?? owner?.club_id;
  const managerCanAct = actorRole === "MANAGER" && Boolean(manager?.club_id && playerClub === manager.club_id);
  const ownerReadOnly = actorRole === "CHAIRMAN_OWNER" && Boolean(owner?.club_id);
  const reason = ownerReadOnly ? "Owner view is read-only; football decisions must be routed through the Manager or delegated Director." : actorRole === "FEDERATION_PRESIDENT" ? "The President may view player context but cannot mutate club football decisions." : "The active role does not control this player's club.";
  return {
    playerId,
    actorRole,
    clubId: footballClub,
    actions: (["TRANSFER_LIST", "LOAN_LIST", "RELEASE", "RENEW_CONTRACT", "SQUAD_ROLE", "PROMISES", "SHORTLIST_SCOUT"] as PlayerActionId[]).map((id) => ({ id, available: managerCanAct, ...(managerCanAct ? {} : { reason }) })),
  };
};
