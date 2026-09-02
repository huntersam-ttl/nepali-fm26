import { TransferMarketRepository, type GameDatabase } from "@nepal-football-sim/database";
import type { EntityId, PlayerContractContext, PlayerTransferContext, SaveMetadata } from "@nepal-football-sim/shared-types";

export type { PlayerContractContext, PlayerTransferContext } from "@nepal-football-sim/shared-types";

export const buildPlayerContractContext = (db: GameDatabase, save: SaveMetadata, playerId: EntityId): PlayerContractContext => {
  const contract = new TransferMarketRepository(db).activeContract(playerId, save.worldDate);
  const club = contract ? db.prepare("SELECT name FROM clubs WHERE id=?").get(contract.clubId) as { name?: string } | undefined : undefined;
  return { playerId, contract: contract ? { ...contract } : undefined, clubName: club?.name, asOf: save.worldDate };
};

export const buildPlayerTransferContext = (db: GameDatabase, save: SaveMetadata, playerId: EntityId): PlayerTransferContext => {
  const market = new TransferMarketRepository(db);
  const status = market.transferStatus(playerId);
  const contract = market.activeContract(playerId, save.worldDate);
  const offers = db.prepare("SELECT status, offer_type FROM transfer_offers WHERE player_id=? ORDER BY submitted_at DESC, id DESC LIMIT 20").all(playerId) as Array<{ status?: string; offer_type?: string }>;
  return {
    playerId,
    currentClubId: contract?.clubId,
    transferStatus: status?.status ?? "NOT_FOR_SALE",
    transferReason: status?.reason,
    activeOfferCount: offers.filter((offer) => !["COMPLETED", "REJECTED", "EXPIRED", "WITHDRAWN"].includes(offer.status ?? "")).length,
    recentOfferTypes: offers.map((offer) => offer.offer_type).filter((type): type is string => Boolean(type)),
    asOf: save.worldDate,
  };
};
