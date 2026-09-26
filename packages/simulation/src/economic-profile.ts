import type { GameDatabase } from "@nepal-football-sim/database";
import type { PackEconomy } from "./country-pack.js";
import { homeCountryPack } from "./home-context.js";

/*
 * How large football money is in the home country. This is scale, not currency: a currency code
 * says what the units are called; these levels say how many of them a wage, a ticket or a
 * stadium costs. 1 is the launch calibration (Nepal's magnitudes); 2 means twice as much money
 * for the same football. A level is applied only when a value is newly generated. Amounts already
 * in a save are never rescaled, and no exchange rate is involved.
 */
export type EconomicProfile = {
  /** Costs, budgets, opening cash, commercial and infrastructure values, transfer values. */
  priceLevel: number;
  /** Player and staff wages (follows priceLevel unless the pack says otherwise). */
  wageLevel: number;
  /** The price of a match ticket (follows priceLevel unless the pack says otherwise). */
  ticketPriceLevel: number;
};

export const NEUTRAL_ECONOMIC_PROFILE: EconomicProfile = { priceLevel: 1, wageLevel: 1, ticketPriceLevel: 1 };

const validLevel = (value: number | undefined, fallback: number): number =>
  value === undefined ? fallback : Number.isFinite(value) && value > 0 ? value : fallback;

/** A pack's economy resolved to concrete levels. A pack with none is neutral (1), never another country's. */
export const resolveEconomicProfile = (economy: PackEconomy | undefined): EconomicProfile => {
  if (!economy) return NEUTRAL_ECONOMIC_PROFILE;
  const priceLevel = validLevel(economy.priceLevel, 1);
  return { priceLevel, wageLevel: validLevel(economy.wageLevel, priceLevel), ticketPriceLevel: validLevel(economy.ticketPriceLevel, priceLevel) };
};

/**
 * A money amount at a level. At level 1 the amount is returned exactly as given, so the launch
 * calibration is untouched; at any other level the result is a whole number of minor units
 * (Math.round, half away from zero for positives), so the same input always gives the same output.
 */
export const scaleAmount = (level: number, amount: number): number => (level === 1 ? amount : Math.round(amount * level));

export const countryEconomicProfile = (db: GameDatabase): EconomicProfile => resolveEconomicProfile(homeCountryPack(db).economy);

export const scalePrice = (db: GameDatabase, amount: number): number => scaleAmount(countryEconomicProfile(db).priceLevel, amount);

export const scaleWage = (db: GameDatabase, amount: number): number => scaleAmount(countryEconomicProfile(db).wageLevel, amount);

export const scaleTicketPrice = (db: GameDatabase, amount: number): number => scaleAmount(countryEconomicProfile(db).ticketPriceLevel, amount);
