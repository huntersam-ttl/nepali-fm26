import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase, OwnershipRepository } from "@nepal-football-sim/database";
import { calculateAcquisitionValuation, createNepalSave, createOwnershipEnquiry, decideOwnershipOffer, initializeClubEconomyForSave, submitOwnershipOffer } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => { const dir = mkdtempSync(join(tmpdir(), "ownership-phase-a-")); dirs.push(dir); const path = join(dir, "career.sqlite"); createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name }); return path; };
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("Chairman ownership phase A", () => {
  it("keeps acquisition affordability personal and persists accepted ownership", () => {
    const db = openGameDatabase(makeSave("ownership-phase-a")); initializeClubEconomyForSave({ db, worldDate: "2027-07-01", seed: "ownership-phase-a" });
    const club = db.prepare("SELECT id FROM clubs ORDER BY id LIMIT 1").get() as { id: EntityId }; const buyer = db.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get() as { id: EntityId }; const economy = new ClubEconomyRepository(db); const personalCash = 1_000_000_000; economy.upsertPersonalFinancialProfile({ personId: buyer.id, cash: personalCash, investments: 0, assets: 0, liabilities: 0, netWorth: personalCash, currency: "NPR", lastUpdatedAt: "2027-07-01", status: "SIMULATION_ONLY" });
    const clubCash = economy.financialAccount(club.id)!.cashBalance; const valuation = calculateAcquisitionValuation(db, club.id, "2027-07-01"); const purchaseAmount = valuation * 2; const enquiry = createOwnershipEnquiry(db, { clubId: club.id, buyerPersonId: buyer.id, percentage: 25, date: "2027-07-01" }); const offer = submitOwnershipOffer(db, { enquiryId: enquiry.id, amount: purchaseAmount, date: "2027-07-01" }); const accepted = decideOwnershipOffer(db, { offerId: offer.id, date: "2027-07-02" });
    expect(accepted.status).toBe("ACCEPTED"); expect(economy.personalFinancialProfile(buyer.id)!.cash).toBe(personalCash - purchaseAmount); expect(economy.financialAccount(club.id)!.cashBalance).toBe(clubCash); expect(new OwnershipRepository(db).transactions(club.id)[0]!.percentage).toBe(25); expect(economy.ownershipStakes(club.id).some((stake) => stake.holderId === buyer.id && stake.role === "MINORITY_OWNER")).toBe(true); db.close();
  });
});
