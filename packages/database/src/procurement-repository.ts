import type { EntityId, ProcurementOffer, ProcurementOrder, ProcurementRequest, ProcurementSupplier } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

export class ProcurementRepository {
  constructor(private readonly db: GameDatabase) {}

  upsertSupplier(supplier: ProcurementSupplier): void {
    this.db.prepare(`INSERT INTO procurement_suppliers (id,name,region,reputation,price_level,reliability,foreign_supplier,status) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET reputation=excluded.reputation, price_level=excluded.price_level, reliability=excluded.reliability`).run(supplier.id, supplier.name, supplier.region, supplier.reputation, supplier.priceLevel, supplier.reliability, supplier.foreign ? 1 : 0, supplier.status);
  }
  suppliers(): ProcurementSupplier[] {
    return (this.db.prepare("SELECT * FROM procurement_suppliers ORDER BY id").all() as any[]).map((row) => ({ id: row.id, name: row.name, region: row.region, reputation: row.reputation, priceLevel: row.price_level, reliability: row.reliability, foreign: Boolean(row.foreign_supplier), status: row.status }));
  }
  upsertRequest(request: ProcurementRequest): void {
    this.db.prepare(`INSERT INTO procurement_requests (id,club_id,category,quantity,requested_on,status,budget_category,status_text) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,status_text=excluded.status_text`).run(request.id, request.clubId, request.category, request.quantity, request.requestedOn, request.status, request.budgetCategory, request.statusText ?? null);
  }
  requests(clubId?: EntityId): ProcurementRequest[] {
    const rows = (clubId ? this.db.prepare("SELECT * FROM procurement_requests WHERE club_id = ? ORDER BY requested_on, id").all(clubId) : this.db.prepare("SELECT * FROM procurement_requests ORDER BY requested_on, id").all()) as any[];
    return rows.map((row) => ({ id: row.id, clubId: row.club_id, category: row.category, quantity: row.quantity, requestedOn: row.requested_on, status: row.status, budgetCategory: row.budget_category, statusText: row.status_text ?? undefined }));
  }
  upsertOffer(offer: ProcurementOffer): void {
    this.db.prepare(`INSERT INTO procurement_offers (id,request_id,supplier_id,unit_price,shipping_cost,quality,delivery_days,reliability,expires_on,status) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status`).run(offer.id, offer.requestId, offer.supplierId, offer.unitPrice, offer.shippingCost, offer.quality, offer.deliveryDays, offer.reliability, offer.expiresOn, offer.status);
  }
  offers(requestId?: EntityId): ProcurementOffer[] {
    const rows = (requestId ? this.db.prepare("SELECT * FROM procurement_offers WHERE request_id = ? ORDER BY id").all(requestId) : this.db.prepare("SELECT * FROM procurement_offers ORDER BY id").all()) as any[];
    return rows.map((row) => ({ id: row.id, requestId: row.request_id, supplierId: row.supplier_id, unitPrice: row.unit_price, shippingCost: row.shipping_cost, quality: row.quality, deliveryDays: row.delivery_days, reliability: row.reliability, expiresOn: row.expires_on, status: row.status }));
  }
  upsertOrder(order: ProcurementOrder): void {
    this.db.prepare(`INSERT INTO procurement_orders (id,request_id,offer_id,club_id,ordered_on,expected_delivery,delivered_on,quantity,total_cost,category,status,quality,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET delivered_on=excluded.delivered_on,status=excluded.status`).run(order.id, order.requestId, order.offerId, order.clubId, order.orderedOn, order.expectedDelivery, order.deliveredOn ?? null, order.quantity, order.totalCost, order.category, order.status, order.quality, order.provenanceStatus);
  }
  orders(clubId?: EntityId): ProcurementOrder[] {
    const rows = (clubId ? this.db.prepare("SELECT * FROM procurement_orders WHERE club_id = ? ORDER BY ordered_on, id").all(clubId) : this.db.prepare("SELECT * FROM procurement_orders ORDER BY ordered_on, id").all()) as any[];
    return rows.map((row) => ({ id: row.id, requestId: row.request_id, offerId: row.offer_id, clubId: row.club_id, orderedOn: row.ordered_on, expectedDelivery: row.expected_delivery, deliveredOn: row.delivered_on ?? undefined, quantity: row.quantity, totalCost: row.total_cost, category: row.category, status: row.status, quality: row.quality, provenanceStatus: row.provenance_status }));
  }
}
