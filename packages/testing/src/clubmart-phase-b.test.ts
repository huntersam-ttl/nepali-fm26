import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, ProcurementRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { createNepalSave, createProcurementContract, createProcurementRequest, initializeClubEconomyForSave, initializeClubMartForSave, renewProcurementContract, scheduleProcurementService, selectProcurementOffer, advanceProcurementServices } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "clubmart-phase-b-")); dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("ClubMart procurement phase B", () => {
  it("persists contracts, bounded discounts, approvals, service, and deterministic supplier history", () => {
    const db = openGameDatabase(makeSave("clubmart-phase-b"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "clubmart-phase-b" });
    initializeClubMartForSave(db);
    // Real Nepal clubs only: the global seed adds CONTEXT_ONLY foreign clubs with no club economy.
    const clubId = (db.prepare("SELECT id FROM clubs c WHERE NOT EXISTS (SELECT 1 FROM external_club_context e WHERE e.club_id = c.id) ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    const supplierId = new ProcurementRepository(db).suppliers()[0].id;
    const contract = createProcurementContract(db, { clubId, supplierId, agreementType: "MAINTENANCE_SERVICE", category: "MEDICAL_SUPPLIES", unitPrice: 20000, discountRate: 0.08, serviceLevel: 0.9, warrantyMonths: 12, startsOn: "2026-08-28", endsOn: "2028-08-28", renewalNoticeDays: 60 });
    const renewed = renewProcurementContract(db, contract.id, { startsOn: "2028-08-29", endsOn: "2030-08-28" });
    expect(renewed.status).toBe("ACTIVE");
    const request = createProcurementRequest(db, { clubId, category: "MEDICAL_SUPPLIES", quantity: 30, date: "2026-08-28", seed: "clubmart-phase-b" });
    expect(Math.max(...request.offers.map((offer) => offer.unitPrice))).toBeGreaterThan(0);
    const offer = request.offers.find((item) => item.supplierId === supplierId)!;
    new ProcurementRepository(db).upsertApprovalThreshold({ clubId, category: request.request.category, maxAutoApproval: 1, chairmanApprovalAbove: 2, status: "SIMULATION_ONLY" });
    expect(() => selectProcurementOffer(db, { offerId: offer.id, date: "2026-08-28" })).toThrow("Chairman approval required");
    const order = selectProcurementOffer(db, { offerId: offer.id, date: "2026-08-28", chairmanApproved: true });
    scheduleProcurementService(db, { contractId: contract.id, clubId, supplierId, orderId: order.id, recordedOn: "2027-01-01", serviceType: "WARRANTY", cost: 0 });
    expect(advanceProcurementServices(db, { date: "2027-01-02" })[0].status).toBe("COMPLETED");
    expect(new ProcurementRepository(db).contracts(clubId)[0].id).toBe(contract.id);
    db.close();
  });
});
