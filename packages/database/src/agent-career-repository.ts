import type {
  AgentClientStrategy,
  AgentFeeSettlement,
  AgentStrategyObjective,
  EntityId,
} from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const mapStrategy = (row: any): AgentClientStrategy => ({
  id: row.id,
  agentId: row.agent_id,
  playerId: row.player_id,
  objective: row.objective as AgentStrategyObjective,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  status: row.status,
  outcomeSummary: row.outcome_summary ?? undefined,
  provenanceStatus: "SIMULATION_ONLY",
});

const mapSettlement = (row: any): AgentFeeSettlement => ({
  id: row.id,
  agentId: row.agent_id,
  playerId: row.player_id,
  payerClubId: row.payer_club_id,
  amount: row.amount,
  currency: row.currency,
  eventType: row.event_type,
  sourceEntityId: row.source_entity_id,
  settledOn: row.settled_on,
  personalLedgerEntryId: row.personal_ledger_entry_id,
  provenanceStatus: "SIMULATION_ONLY",
});

export class AgentCareerRepository {
  constructor(private readonly db: GameDatabase) {}

  upsertStrategy(strategy: AgentClientStrategy): void {
    this.db
      .prepare(
        `INSERT INTO agent_client_strategies
          (id, agent_id, player_id, objective, created_at, updated_at, status, outcome_summary, provenance_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET objective=excluded.objective,
           updated_at=excluded.updated_at, status=excluded.status,
           outcome_summary=excluded.outcome_summary`,
      )
      .run(
        strategy.id,
        strategy.agentId,
        strategy.playerId,
        strategy.objective,
        strategy.createdAt,
        strategy.updatedAt,
        strategy.status,
        strategy.outcomeSummary ?? null,
        strategy.provenanceStatus,
      );
  }

  activeStrategy(playerId: EntityId): AgentClientStrategy | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM agent_client_strategies WHERE player_id=? AND status='ACTIVE' ORDER BY updated_at DESC, id DESC LIMIT 1",
      )
      .get(playerId);
    return row ? mapStrategy(row) : undefined;
  }

  cancelActiveStrategies(playerId: EntityId, updatedAt: string): void {
    this.db
      .prepare(
        "UPDATE agent_client_strategies SET status='CANCELLED', updated_at=? WHERE player_id=? AND status='ACTIVE'",
      )
      .run(updatedAt, playerId);
  }

  strategies(playerId?: EntityId): AgentClientStrategy[] {
    const rows = playerId
      ? this.db
          .prepare(
            "SELECT * FROM agent_client_strategies WHERE player_id=? ORDER BY created_at, id",
          )
          .all(playerId)
      : this.db.prepare("SELECT * FROM agent_client_strategies ORDER BY created_at, id").all();
    return rows.map(mapStrategy);
  }

  insertFeeSettlement(settlement: AgentFeeSettlement): boolean {
    this.db
      .prepare(
        `INSERT INTO agent_fee_settlements
          (id, agent_id, player_id, payer_club_id, amount, currency, event_type,
           source_entity_id, settled_on, personal_ledger_entry_id, provenance_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_entity_id, event_type) DO NOTHING`,
      )
      .run(
        settlement.id,
        settlement.agentId,
        settlement.playerId,
        settlement.payerClubId,
        settlement.amount,
        settlement.currency,
        settlement.eventType,
        settlement.sourceEntityId,
        settlement.settledOn,
        settlement.personalLedgerEntryId,
        settlement.provenanceStatus,
      );
    return Number((this.db.prepare("SELECT changes() AS changes").get() as any).changes) === 1;
  }

  feeSettlements(agentId?: EntityId): AgentFeeSettlement[] {
    const rows = agentId
      ? this.db
          .prepare("SELECT * FROM agent_fee_settlements WHERE agent_id=? ORDER BY settled_on, id")
          .all(agentId)
      : this.db.prepare("SELECT * FROM agent_fee_settlements ORDER BY settled_on, id").all();
    return rows.map(mapSettlement);
  }
}
