import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase } from "@nepal-football-sim/database";
import { advanceProcurementOrders, applyForClubLoan, createNepalSave, createProcurementRequest, initializeClubEconomyForSave, initializeClubFinanceMarkets, repayClubLoan, selectProcurementOffer } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "club-finance-markets-")); dirs.push(dir);
  const path = join(dir, "save.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")), saveName: name, gameVersion: "test", randomSeed: name });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("club finance markets", () => {
  it("keeps loan drawdown/repayment and equipment effects cash-backed and reload-safe", () => {
    const path = makeSave("finance-market");
    const db = openGameDatabase(path); initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "finance-market" }); initializeClubFinanceMarkets(db);
    const club = db.prepare("SELECT id FROM clubs WHERE name='Machhindra FC'").get() as { id: EntityId };
    const lender = new ClubEconomyRepository(db).lenders()[0]!;
    const before = new ClubEconomyRepository(db).financialAccount(club.id)!;
    const application = applyForClubLoan(db, { clubId: club.id, lenderId: lender.id, principal: 100000, termMonths: 12, purpose: "working capital", date: "2026-08-01" });
    expect(application.status).toBe("APPROVED");
    const debt = new ClubEconomyRepository(db).debts(club.id).find((item) => item.lenderId === lender.id)!;
    expect(new ClubEconomyRepository(db).financialAccount(club.id)!.cashBalance).toBe(before.cashBalance + 100000);
    repayClubLoan(db, { debtId: debt.id, date: "2026-08-02", amount: debt.scheduledPayment });
    const request = createProcurementRequest(db, { clubId: club.id, category: "FOOTBALL_EQUIPMENT", quantity: 1, date: "2026-08-01", seed: "finance-market" });
    const order = selectProcurementOffer(db, { offerId: request.offers[0]!.id, date: "2026-08-01", chairmanApproved: true });
    advanceProcurementOrders(db, { date: "2026-09-01", seed: "finance-market" });
    expect(new ClubEconomyRepository(db).assets(club.id).some((asset) => asset.effect?.trainingEffectiveness)).toBe(true);
    db.close();
    const reloaded = openGameDatabase(path);
    expect(new ClubEconomyRepository(reloaded).lenders().some((item) => item.status === "VERIFIED")).toBe(true);
    expect(new ClubEconomyRepository(reloaded).ledgerEntries(club.id).filter((entry) => entry.relatedEntityId === debt.id).length).toBeGreaterThan(0);
    reloaded.close();
  }, 180_000);
});
