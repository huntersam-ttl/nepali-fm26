import { createStableEntityId, type EntityId, type MacroEconomicIndex, type MacroEconomicState } from "@nepal-football-sim/shared-types";
import { MacroEconomyRepository, type GameDatabase } from "@nepal-football-sim/database";
import { SeededRandom } from "./rng.js";

const clamp = (value: number, min = 0.65, max = 4): number => Number(Math.max(min, Math.min(max, value)).toFixed(4));
const nextIndex = (previous: number, annualDrift: number, noise: number): number => clamp(previous + (1 - previous) * 0.006 + annualDrift + noise);

export const nextMacroEconomicState = (previous: MacroEconomicState | undefined, input: { countryId: EntityId; year: number; seed: string; footballDevelopment?: number; worldEconomicPressure?: number; snapshotDate?: string }): MacroEconomicState => {
  const base = previous ?? { inflationIndex: 1, wageInflationIndex: 1, playerValueIndex: 1, landPriceIndex: 1, constructionCostIndex: 1, sponsorMarketStrength: 1, broadcastMarketStrength: 1, footballCommercialStrength: 1, exchangeRateToNpr: 1 };
  const rng = new SeededRandom(`macro-economy:${input.seed}:${input.countryId}:${input.year}`);
  const football = Math.max(0, Math.min(10, input.footballDevelopment ?? 0));
  const pressure = Math.max(-1, Math.min(1, input.worldEconomicPressure ?? 0));
  const drift = 0.018 + pressure * 0.006;
  const noise = () => (rng.next() - 0.5) * 0.012;
  const footballLift = football * 0.0009;
  return {
    id: createStableEntityId("macro-economic-state", `${input.countryId}:${input.year}`), countryId: input.countryId, year: input.year,
    snapshotDate: input.snapshotDate ?? `${input.year}-01-01`, status: "SIMULATION_ONLY",
    inflationIndex: nextIndex(base.inflationIndex, drift, noise()), wageInflationIndex: nextIndex(base.wageInflationIndex, drift * 1.08 + footballLift, noise()),
    playerValueIndex: nextIndex(base.playerValueIndex, drift * 0.92 + footballLift * 1.5, noise()), landPriceIndex: nextIndex(base.landPriceIndex, drift * 1.12 + footballLift * 0.5, noise()),
    constructionCostIndex: nextIndex(base.constructionCostIndex, drift * 1.16 + footballLift * 0.5, noise()), sponsorMarketStrength: nextIndex(base.sponsorMarketStrength, drift * 0.65 + footballLift * 2, noise()),
    broadcastMarketStrength: nextIndex(base.broadcastMarketStrength, drift * 0.6 + footballLift * 1.8, noise()), footballCommercialStrength: nextIndex(base.footballCommercialStrength, drift * 0.7 + footballLift * 2.2, noise()),
    exchangeRateToNpr: clamp(base.exchangeRateToNpr * (1 + drift * 0.25 + noise() * 0.4)),
  };
};

export const advanceMacroEconomy = (db: GameDatabase, input: Parameters<typeof nextMacroEconomicState>[1]): MacroEconomicState => {
  const repository = new MacroEconomyRepository(db);
  const existing = repository.state(input.countryId, input.year);
  if (existing) return existing;
  const state = nextMacroEconomicState(repository.state(input.countryId), input);
  repository.upsert(state);
  return state;
};

export const macroEconomyForCountry = (db: GameDatabase, countryId: EntityId, year?: number): MacroEconomicState | undefined => new MacroEconomyRepository(db).state(countryId, year);

export const adjustForMacro = (amount: number, state: MacroEconomicState | undefined, index: MacroEconomicIndex): number => Math.round(amount * (state?.[index] ?? 1));
