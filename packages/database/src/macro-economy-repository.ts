import type { EntityId, MacroEconomicState } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const mapState = (row: any): MacroEconomicState => ({
  id: row.id, countryId: row.country_id, year: row.year, snapshotDate: row.snapshot_date,
  inflationIndex: row.inflation_index, wageInflationIndex: row.wage_inflation_index,
  playerValueIndex: row.player_value_index, landPriceIndex: row.land_price_index,
  constructionCostIndex: row.construction_cost_index, sponsorMarketStrength: row.sponsor_market_strength,
  broadcastMarketStrength: row.broadcast_market_strength, footballCommercialStrength: row.football_commercial_strength,
  exchangeRateToNpr: row.exchange_rate_to_npr, status: row.status,
});

export class MacroEconomyRepository {
  constructor(private readonly db: GameDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS macro_economic_states (
      id TEXT PRIMARY KEY, country_id TEXT NOT NULL, year INTEGER NOT NULL, snapshot_date TEXT NOT NULL,
      inflation_index REAL NOT NULL, wage_inflation_index REAL NOT NULL, player_value_index REAL NOT NULL,
      land_price_index REAL NOT NULL, construction_cost_index REAL NOT NULL, sponsor_market_strength REAL NOT NULL,
      broadcast_market_strength REAL NOT NULL, football_commercial_strength REAL NOT NULL,
      exchange_rate_to_npr REAL NOT NULL, status TEXT NOT NULL, UNIQUE(country_id, year)
    )`);
  }
  upsert(state: MacroEconomicState): void {
    this.db.prepare(`INSERT INTO macro_economic_states
      (id,country_id,year,snapshot_date,inflation_index,wage_inflation_index,player_value_index,land_price_index,construction_cost_index,sponsor_market_strength,broadcast_market_strength,football_commercial_strength,exchange_rate_to_npr,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(country_id,year) DO UPDATE SET
      snapshot_date=excluded.snapshot_date,inflation_index=excluded.inflation_index,wage_inflation_index=excluded.wage_inflation_index,player_value_index=excluded.player_value_index,land_price_index=excluded.land_price_index,construction_cost_index=excluded.construction_cost_index,sponsor_market_strength=excluded.sponsor_market_strength,broadcast_market_strength=excluded.broadcast_market_strength,football_commercial_strength=excluded.football_commercial_strength,exchange_rate_to_npr=excluded.exchange_rate_to_npr,status=excluded.status`).run(
      state.id,state.countryId,state.year,state.snapshotDate,state.inflationIndex,state.wageInflationIndex,state.playerValueIndex,state.landPriceIndex,state.constructionCostIndex,state.sponsorMarketStrength,state.broadcastMarketStrength,state.footballCommercialStrength,state.exchangeRateToNpr,state.status);
  }
  state(countryId: EntityId, year?: number): MacroEconomicState | undefined {
    const row = (year === undefined ? this.db.prepare("SELECT * FROM macro_economic_states WHERE country_id=? ORDER BY year DESC LIMIT 1").get(countryId) : this.db.prepare("SELECT * FROM macro_economic_states WHERE country_id=? AND year=?").get(countryId,year)) as any;
    return row ? mapState(row) : undefined;
  }
  states(countryId?: EntityId): MacroEconomicState[] {
    const rows = (countryId ? this.db.prepare("SELECT * FROM macro_economic_states WHERE country_id=? ORDER BY year").all(countryId) : this.db.prepare("SELECT * FROM macro_economic_states ORDER BY country_id,year").all()) as any[];
    return rows.map(mapState);
  }
}
