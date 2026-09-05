import type {
  EntityId,
  ISODate,
  OwnershipAcquisitionOffer,
  OwnershipAcquisitionTransaction,
  OwnershipDealStructure,
  OwnershipNegotiationPendingParty,
  OwnershipNegotiationRound,
} from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const offer = (r: any): OwnershipAcquisitionOffer => ({
  id: r.id,
  clubId: r.club_id,
  buyerPersonId: r.buyer_person_id,
  sellerHolderId: r.seller_holder_id ?? undefined,
  percentage: r.percentage,
  offerAmount: r.offer_amount,
  counterAmount: r.counter_amount ?? undefined,
  counterPercentage: r.counter_percentage ?? undefined,
  status: r.status,
  createdOn: r.created_on,
  decidedOn: r.decided_on ?? undefined,
  rationale: r.rationale ?? undefined,
  investorType: r.investor_type ?? undefined,
  investorStance: r.investor_stance ?? undefined,
  negotiationRoundCount: r.negotiation_round_count ?? undefined,
  boardSeatRequested: r.board_seat_requested == null ? undefined : Boolean(r.board_seat_requested),
  respondBy: r.respond_by ?? undefined,
  pendingDecisionBy: r.pending_decision_by ?? undefined,
  dealStructure: r.deal_structure ?? undefined,
  ownerProceedsAmount: r.owner_proceeds_amount ?? undefined,
  capitalInjectionAmount: r.capital_injection_amount ?? undefined,
  dueDiligenceFindings: r.due_diligence_findings_json ? JSON.parse(r.due_diligence_findings_json) : undefined,
  boardStance: r.board_stance ?? undefined,
  boardStanceTier: r.board_stance_tier ?? undefined,
  provenanceStatus: r.provenance_status,
});
const transaction = (r: any): OwnershipAcquisitionTransaction => ({
  id: r.id,
  offerId: r.offer_id,
  clubId: r.club_id,
  buyerPersonId: r.buyer_person_id,
  sellerHolderId: r.seller_holder_id ?? undefined,
  date: r.transaction_date,
  amount: r.amount,
  percentage: r.percentage,
  status: r.status,
  provenanceStatus: r.provenance_status,
});
const round = (r: any): OwnershipNegotiationRound => ({
  id: r.id,
  offerId: r.offer_id,
  roundNumber: r.round_number,
  actor: r.actor,
  action: r.action,
  message: r.message,
  createdAt: r.created_at,
});

export class OwnershipRepository {
  constructor(private readonly db: GameDatabase) {}

  upsertOffer(value: OwnershipAcquisitionOffer): void {
    this.db
      .prepare(
        `INSERT INTO ownership_acquisition_offers
          (id,club_id,buyer_person_id,seller_holder_id,percentage,offer_amount,counter_amount,counter_percentage,status,created_on,decided_on,rationale,investor_type,investor_stance,negotiation_round_count,board_seat_requested,respond_by,pending_decision_by,deal_structure,owner_proceeds_amount,capital_injection_amount,due_diligence_findings_json,board_stance,board_stance_tier,provenance_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           percentage=excluded.percentage,
           offer_amount=excluded.offer_amount,
           counter_amount=excluded.counter_amount,
           counter_percentage=excluded.counter_percentage,
           status=excluded.status,
           decided_on=excluded.decided_on,
           rationale=excluded.rationale,
           investor_type=COALESCE(excluded.investor_type, ownership_acquisition_offers.investor_type),
           investor_stance=COALESCE(excluded.investor_stance, ownership_acquisition_offers.investor_stance),
           negotiation_round_count=excluded.negotiation_round_count,
           board_seat_requested=excluded.board_seat_requested,
           respond_by=excluded.respond_by,
           pending_decision_by=excluded.pending_decision_by,
           deal_structure=COALESCE(excluded.deal_structure, ownership_acquisition_offers.deal_structure),
           owner_proceeds_amount=excluded.owner_proceeds_amount,
           capital_injection_amount=excluded.capital_injection_amount,
           due_diligence_findings_json=excluded.due_diligence_findings_json,
           board_stance=excluded.board_stance,
           board_stance_tier=excluded.board_stance_tier`,
      )
      .run(
        value.id,
        value.clubId,
        value.buyerPersonId,
        value.sellerHolderId ?? null,
        value.percentage,
        value.offerAmount,
        value.counterAmount ?? null,
        value.counterPercentage ?? null,
        value.status,
        value.createdOn,
        value.decidedOn ?? null,
        value.rationale ?? null,
        value.investorType ?? null,
        value.investorStance ?? null,
        value.negotiationRoundCount ?? null,
        value.boardSeatRequested == null ? null : value.boardSeatRequested ? 1 : 0,
        value.respondBy ?? null,
        value.pendingDecisionBy ?? null,
        value.dealStructure ?? null,
        value.ownerProceedsAmount ?? null,
        value.capitalInjectionAmount ?? null,
        value.dueDiligenceFindings ? JSON.stringify(value.dueDiligenceFindings) : null,
        value.boardStance ?? null,
        value.boardStanceTier ?? null,
        value.provenanceStatus,
      );
  }

  offer(id: EntityId): OwnershipAcquisitionOffer | undefined {
    const row = this.db.prepare("SELECT * FROM ownership_acquisition_offers WHERE id=?").get(id) as any;
    return row ? offer(row) : undefined;
  }

  offers(clubId?: EntityId): OwnershipAcquisitionOffer[] {
    const rows = (
      clubId
        ? this.db.prepare("SELECT * FROM ownership_acquisition_offers WHERE club_id=? ORDER BY created_on,id").all(clubId)
        : this.db.prepare("SELECT * FROM ownership_acquisition_offers ORDER BY created_on,id").all()
    ) as any[];
    return rows.map(offer);
  }

  /** Offers with an owner or investor decision genuinely due — the driver
   * behind the delayed ownership-negotiation loop, mirroring
   * TransferMarketRepository.dueTransferOffers. */
  dueOffers(worldDate: ISODate): OwnershipAcquisitionOffer[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM ownership_acquisition_offers WHERE respond_by IS NOT NULL AND respond_by <= ? ORDER BY respond_by, id",
        )
        .all(worldDate) as any[]
    ).map(offer);
  }

  updatePendingDecision(
    id: EntityId,
    pending: { respondBy?: ISODate; pendingDecisionBy?: OwnershipNegotiationPendingParty },
  ): void {
    this.db
      .prepare("UPDATE ownership_acquisition_offers SET respond_by = ?, pending_decision_by = ? WHERE id = ?")
      .run(pending.respondBy ?? null, pending.pendingDecisionBy ?? null, id);
  }

  insertTransaction(value: OwnershipAcquisitionTransaction): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO ownership_acquisition_transactions (id,offer_id,club_id,buyer_person_id,seller_holder_id,transaction_date,amount,percentage,status,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        value.id,
        value.offerId,
        value.clubId,
        value.buyerPersonId,
        value.sellerHolderId ?? null,
        value.date,
        value.amount,
        value.percentage,
        value.status,
        value.provenanceStatus,
      );
  }

  transactions(clubId?: EntityId): OwnershipAcquisitionTransaction[] {
    const rows = (
      clubId
        ? this.db.prepare("SELECT * FROM ownership_acquisition_transactions WHERE club_id=? ORDER BY transaction_date,id").all(clubId)
        : this.db.prepare("SELECT * FROM ownership_acquisition_transactions ORDER BY transaction_date,id").all()
    ) as any[];
    return rows.map(transaction);
  }

  insertNegotiationRound(value: OwnershipNegotiationRound): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO ownership_negotiation_rounds (id,offer_id,round_number,actor,action,message,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(value.id, value.offerId, value.roundNumber, value.actor, value.action, value.message, value.createdAt);
  }

  negotiationRounds(offerId: EntityId): OwnershipNegotiationRound[] {
    return (
      this.db
        .prepare("SELECT * FROM ownership_negotiation_rounds WHERE offer_id=? ORDER BY round_number,id")
        .all(offerId) as any[]
    ).map(round);
  }
}
