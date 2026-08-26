import { createStableEntityId, type EntityId, type ProcurementCategory, type ProcurementOffer, type ProcurementOrder, type ProcurementRequest, type ProcurementSupplier } from "@nepal-football-sim/shared-types";
import { ClubEconomyRepository, ProcurementRepository, type GameDatabase } from "@nepal-football-sim/database";
import { postClubTransaction } from "./club-economy.js";
import { SeededRandom } from "./rng.js";

const currency = "NPR";
const addDays = (date: string, days: number): string => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const budgetFor = (category: ProcurementCategory): "ACADEMY_BUDGET" | "FACILITY_BUDGET" | "SCOUTING_BUDGET" => category === "ANALYSIS_SCOUTING" ? "SCOUTING_BUDGET" : category === "KITS_TRAINING_WEAR" || category === "FOOTBALL_EQUIPMENT" ? "ACADEMY_BUDGET" : "FACILITY_BUDGET";
const suppliers: Array<Omit<ProcurementSupplier, "id">> = [
  { name: "Kathmandu Football Supply", region: "Nepal", reputation: 6.4, priceLevel: 0.92, reliability: 0.86, foreign: false, status: "SIMULATION_ONLY" },
  { name: "Himalayan Sports Cooperative", region: "Nepal", reputation: 5.8, priceLevel: 0.78, reliability: 0.72, foreign: false, status: "SIMULATION_ONLY" },
  { name: "South Asia Performance Group", region: "South Asia", reputation: 7.2, priceLevel: 1.08, reliability: 0.82, foreign: true, status: "SIMULATION_ONLY" },
  { name: "AsiaPro Football Systems", region: "Wider Asia", reputation: 8.1, priceLevel: 1.24, reliability: 0.91, foreign: true, status: "SIMULATION_ONLY" },
];

export const initializeClubMartForSave = (db: GameDatabase): ProcurementSupplier[] => {
  const repo = new ProcurementRepository(db);
  for (const supplier of suppliers) repo.upsertSupplier({ ...supplier, id: createStableEntityId("procurement-supplier", supplier.name) });
  return repo.suppliers();
};

const basePrice = (category: ProcurementCategory): number => ({ KITS_TRAINING_WEAR: 1800, FOOTBALL_EQUIPMENT: 4200, GYM_PERFORMANCE: 48000, MEDICAL_SUPPLIES: 22000, ANALYSIS_SCOUTING: 65000, GROUNDS_STADIUM: 38000 })[category];

export const createProcurementRequest = (db: GameDatabase, input: { clubId: EntityId; category: ProcurementCategory; quantity: number; date: string; seed: string }): { request: ProcurementRequest; offers: ProcurementOffer[] } => {
  const repo = new ProcurementRepository(db); initializeClubMartForSave(db);
  const quantity = Math.max(1, Math.round(input.quantity));
  const request: ProcurementRequest = { id: createStableEntityId("procurement-request", `${input.clubId}:${input.category}:${input.date}`), clubId: input.clubId, category: input.category, quantity, requestedOn: input.date, status: "REQUESTED", budgetCategory: budgetFor(input.category), statusText: "Request issued to approved suppliers" };
  repo.upsertRequest(request);
  const offers = repo.suppliers().map((supplier, index) => {
    const rng = new SeededRandom(`${input.seed}:procurement-offer:${request.id}:${supplier.id}`);
    const shippingCost = supplier.foreign ? Math.round(basePrice(input.category) * quantity * 0.14) : 0;
    return { id: createStableEntityId("procurement-offer", `${request.id}:${supplier.id}`), requestId: request.id, supplierId: supplier.id, unitPrice: Math.max(1, Math.round(basePrice(input.category) * supplier.priceLevel * (0.96 + rng.next() * 0.08))), shippingCost, quality: Math.max(1, Math.min(10, supplier.reputation * 0.62 + rng.next() * 2)), deliveryDays: (supplier.foreign ? 18 : 5) + rng.integer(0, index + 5), reliability: supplier.reliability, expiresOn: addDays(input.date, 30), status: "OFFERED" } satisfies ProcurementOffer;
  });
  for (const offer of offers) repo.upsertOffer(offer);
  repo.upsertRequest({ ...request, status: "OFFERED" });
  return { request: { ...request, status: "OFFERED" }, offers };
};

export const selectProcurementOffer = (db: GameDatabase, input: { offerId: EntityId; date: string }): ProcurementOrder => {
  const repo = new ProcurementRepository(db);
  const offer = repo.offers().find((item) => item.id === input.offerId);
  if (!offer || offer.status !== "OFFERED" || offer.expiresOn < input.date) throw new Error("Procurement offer is unavailable");
  const request = repo.requests().find((item) => item.id === offer.requestId);
  if (!request) throw new Error("Procurement request not found");
  const totalCost = offer.unitPrice * request.quantity + offer.shippingCost;
  const economy = new ClubEconomyRepository(db);
  const account = economy.financialAccount(request.clubId);
  const budget = economy.budgets(request.clubId).find((item) => item.seasonLabel === input.date.slice(0, 4) && item.category === request.budgetCategory);
  if (!account || account.cashBalance - totalCost < 500000 || (budget && budget.amount - budget.usedAmount < totalCost)) throw new Error("Procurement is not affordable");
  repo.upsertOffer({ ...offer, status: "ACCEPTED" });
  for (const other of repo.offers(request.id).filter((item) => item.id !== offer.id)) repo.upsertOffer({ ...other, status: "REJECTED" });
  repo.upsertRequest({ ...request, status: "ORDERED", statusText: "Offer accepted and order placed" });
  const order: ProcurementOrder = { id: createStableEntityId("procurement-order", offer.id), requestId: request.id, offerId: offer.id, clubId: request.clubId, orderedOn: input.date, expectedDelivery: addDays(input.date, offer.deliveryDays), quantity: request.quantity, totalCost, category: request.category, status: "IN_TRANSIT", quality: offer.quality, provenanceStatus: "SIMULATION_ONLY" };
  repo.upsertOrder(order);
  postClubTransaction(db, { clubId: request.clubId, date: input.date, category: "OTHER", direction: "DEBIT", amount: totalCost, description: `ClubMart order: ${request.category}`, relatedEntityId: order.id, idempotencyKey: `procurement-order:${order.id}` });
  if (budget) economy.addBudgetUsage(request.clubId, budget.seasonLabel, request.budgetCategory, totalCost);
  return order;
};

export const advanceProcurementOrders = (db: GameDatabase, input: { date: string; seed: string }): ProcurementOrder[] => {
  const repo = new ProcurementRepository(db); const updated: ProcurementOrder[] = [];
  for (const order of repo.orders().filter((item) => item.status === "IN_TRANSIT" && item.expectedDelivery <= input.date)) {
    const offer = repo.offers().find((item) => item.id === order.offerId); const rng = new SeededRandom(`${input.seed}:procurement-delivery:${order.id}`);
    const delivered = Boolean(offer && rng.next() <= offer.reliability);
    const next = delivered ? { ...order, status: "DELIVERED" as const, deliveredOn: input.date } : { ...order, status: "FAILED" as const };
    repo.upsertOrder(next); repo.upsertRequest({ ...repo.requests().find((item) => item.id === order.requestId)!, status: delivered ? "DELIVERED" : "FAILED", statusText: delivered ? "Delivered" : "Delivery failed" });
    if (delivered) new ClubEconomyRepository(db).upsertAsset({ id: createStableEntityId("procurement-asset", order.id), clubId: order.clubId, assetType: "EQUIPMENT", ownership: "OWNED", estimatedValue: Math.round(order.totalCost * order.quality / 10), currency, status: "SIMULATION_ONLY" });
    updated.push(next);
  }
  return updated;
};
