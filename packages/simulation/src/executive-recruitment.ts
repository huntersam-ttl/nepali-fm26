import { TransferMarketRepository, type GameDatabase } from "@nepal-football-sim/database";
import type {
  EntityId,
  ExecutiveAuthority,
  ExecutiveContractRow,
  ExecutiveLoanRow,
  ExecutiveRecruitmentDesk,
  ExecutiveRecruitmentRow,
  SaveMetadata,
} from "@nepal-football-sim/shared-types";
import { executiveHasAuthority } from "./executive-roles.js";

/**
 * The recruitment desk for a sporting director / director of football.
 *
 * These two roles hold RECRUITMENT_STRATEGY, TRANSFER_NEGOTIATION,
 * LOAN_STRATEGY, PLAYER_CONTRACTS and SQUAD_PLANNING, but until now the
 * executive landing screen only rendered CEO-shaped surfaces (budget, bank,
 * sponsor, facilities), so those authorities were listed and never usable.
 *
 * This is a READ MODEL over the canonical transfer/loan/contract records —
 * the same rows the manager's Transfer Centre reads — presented from the
 * club's side. It never creates a parallel transfer engine, and every
 * "can act" flag is resolved through `executiveHasAuthority`, the same
 * canonical delegation check the story actions use, never a role-name string.
 */

const nameOf = (db: GameDatabase, personId: EntityId): string => {
  const row = db.prepare("SELECT display_name, full_name FROM persons WHERE id = ?").get(personId) as
    | { display_name?: string; full_name?: string }
    | undefined;
  return row?.display_name ?? row?.full_name ?? "Unnamed player";
};

const clubLabel = (db: GameDatabase, clubId?: EntityId): string => {
  if (!clubId) return "Free agent";
  const row = db.prepare("SELECT name FROM clubs WHERE id = ?").get(clubId) as
    | { name?: string }
    | undefined;
  return row?.name ?? "Unlisted club";
};

/** Days from `date` — used to bound the squad-planning contract horizon. */
const addDays = (date: string, days: number): string => {
  const next = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

export const buildExecutiveRecruitmentDesk = (
  db: GameDatabase,
  save: SaveMetadata,
  clubId: EntityId,
  personId: EntityId,
): ExecutiveRecruitmentDesk => {
  const authorities: ExecutiveAuthority[] = (
    [
      "RECRUITMENT_STRATEGY",
      "TRANSFER_NEGOTIATION",
      "LOAN_STRATEGY",
      "PLAYER_CONTRACTS",
      "SQUAD_PLANNING",
    ] as const
  ).filter((authority) => executiveHasAuthority(db, clubId, personId, authority));

  const base = {
    clubId,
    clubName: clubLabel(db, clubId),
    authorities,
    negotiations: [] as ExecutiveRecruitmentRow[],
    loans: [] as ExecutiveLoanRow[],
    expiringContracts: [] as ExecutiveContractRow[],
    squadSize: 0,
  };
  if (authorities.length === 0) {
    return {
      ...base,
      blockedReason:
        "This role holds no recruitment authority at the club, so there is no recruitment desk to work from.",
    };
  }

  const market = new TransferMarketRepository(db);
  const canNegotiate = authorities.includes("TRANSFER_NEGOTIATION");
  const negotiations = market
    .transferOffers()
    .filter(
      (offer) =>
        (offer.buyingClubId === clubId || offer.sellingClubId === clubId) &&
        // Same-club offers are contract renewals, not recruitment.
        offer.buyingClubId !== offer.sellingClubId,
    )
    .map((offer) => {
      const incoming = offer.buyingClubId === clubId;
      return {
        offerId: offer.id,
        playerId: offer.playerId,
        playerName: nameOf(db, offer.playerId),
        direction: incoming ? ("IN" as const) : ("OUT" as const),
        otherClubName: clubLabel(db, incoming ? offer.sellingClubId : offer.buyingClubId),
        fee: offer.transferFee,
        status: offer.status,
        expiresAt: offer.expiresAt,
        canNegotiate,
      };
    })
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt) || a.playerName.localeCompare(b.playerName));

  const loans = authorities.includes("LOAN_STRATEGY")
    ? market
        .activeLoans(save.worldDate)
        .filter((loan) => loan.parentClubId === clubId || loan.loanClubId === clubId)
        .map((loan) => ({
          playerId: loan.playerId,
          playerName: nameOf(db, loan.playerId),
          direction: loan.parentClubId === clubId ? ("OUT" as const) : ("IN" as const),
          otherClubName: clubLabel(
            db,
            loan.parentClubId === clubId ? loan.loanClubId : loan.parentClubId,
          ),
          endDate: loan.endDate,
        }))
        .sort((a, b) => a.endDate.localeCompare(b.endDate))
    : [];

  // A one-year planning horizon: what the director has to solve this cycle.
  const expiringContracts = authorities.includes("SQUAD_PLANNING")
    ? market
        .contractsExpiringBetween(save.worldDate, addDays(save.worldDate, 365))
        .filter((contract) => contract.clubId === clubId)
        .map((contract) => ({
          playerId: contract.playerId,
          playerName: nameOf(db, contract.playerId),
          endDate: contract.endDate,
          monthlyWage: contract.salary,
        }))
        .sort((a, b) => a.endDate.localeCompare(b.endDate))
    : [];

  const squadSize = market.activeContractsForClub(clubId, save.worldDate).length;

  return { ...base, negotiations, loans, expiringContracts, squadSize };
};
