import type { EntityId } from "./ids.js";

export type MacroEconomicIndex =
  | "inflationIndex"
  | "wageInflationIndex"
  | "playerValueIndex"
  | "landPriceIndex"
  | "constructionCostIndex"
  | "sponsorMarketStrength"
  | "broadcastMarketStrength"
  | "footballCommercialStrength";

export type MacroEconomicState = {
  id: EntityId;
  countryId: EntityId;
  year: number;
  snapshotDate: string;
  inflationIndex: number;
  wageInflationIndex: number;
  playerValueIndex: number;
  landPriceIndex: number;
  constructionCostIndex: number;
  sponsorMarketStrength: number;
  broadcastMarketStrength: number;
  footballCommercialStrength: number;
  exchangeRateToNpr: number;
  status: "SIMULATION_ONLY";
};
