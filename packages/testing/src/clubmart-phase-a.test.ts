import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, ProcurementRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { advanceProcurementOrders, createNepalSave, createProcurementRequest, initializeClubEconomyForSave, selectProcurementOffer } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "clubmart-phase-a-")); dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: seed, gameVersion: "test", randomSeed: seed });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("ClubMart procurement phase A", () => {
  it("generates local and foreign offers, records affordable orders, and resolves delivery deterministically", () => {
    const first = openGameDatabase(makeSave("clubmart-deterministic"));
    const second = openGameDatabase(makeSave("clubmart-deterministic"));
    initializeClubEconomyForSave({ db: first, worldDate: "2026-08-01", seed: "clubmart-deterministic" });
    initializeClubEconomyForSave({ db: second, worldDate: "2026-08-01", seed: "clubmart-deterministic" });
    const clubId = (first.prepare("SELECT id FROM clubs ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    const run = (db: typeof first) => {
      const request = createProcurementRequest(db, { clubId, category: "MEDICAL_SUPPLIES", quantity: 4, date: "2026-08-28", seed: "clubmart-deterministic" });
      expect(request.offers.some((offer) => offer.shippingCost > 0)).toBe(true);
      const selected = [...request.offers].sort((a, b) => a.unitPrice - b.unitPrice)[0];
      selectProcurementOffer(db, { offerId: selected.id, date: "2026-08-28" });
      advanceProcurementOrders(db, { date: "2027-08-28", seed: "clubmart-deterministic" });
      return new ProcurementRepository(db).orders(clubId)[0];
    };
    const a = run(first); const b = run(second);
    expect({ status: a.status, totalCost: a.totalCost, quality: a.quality }).toEqual({ status: b.status, totalCost: b.totalCost, quality: b.quality });
    expect(new ClubEconomyRepository(first).ledgerEntries(clubId).some((entry) => entry.relatedEntityId === a.id)).toBe(true);
    if (a.status === "DELIVERED") expect(new ClubEconomyRepository(first).assets(clubId).some((asset) => asset.assetType === "EQUIPMENT")).toBe(true);
    first.close(); second.close();
  });
});
