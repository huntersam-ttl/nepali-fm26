import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase } from "@nepal-football-sim/database";
import { buildOwnershipInvestorMarket, createInvestorStakeOffer, createNepalSave, decideInvestorBid, heldCareerRoles, initializeClubEconomyForSave, runChairmanDemo } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dataset = JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8"));

describe("ownership investor market", () => {
  it.each(["A", "B", "C"] as const)("supports a deterministic %s Division personal share sale and reload", (division) => {
    const dir = mkdtempSync(join(tmpdir(), `ownership-investor-${division.toLowerCase()}-`));
    const path = join(dir, "save.sqlite");
    createNepalSave({ databasePath: path, dataset, saveName: `investor-${division}`, gameVersion: "test", randomSeed: `investor-${division}` });
    const db = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2027-07-01", seed: `investor-${division}` });
    const row = db.prepare("SELECT DISTINCT c.id FROM clubs c JOIN club_memberships cm ON cm.club_id=c.id JOIN competition_seasons cs ON cs.id=cm.competition_season_id JOIN competitions comp ON comp.id=cs.competition_id WHERE lower(comp.name) LIKE ? AND cm.status='ACTIVE' LIMIT 1").get(`%${division.toLowerCase()}-division%`) as { id: EntityId };
    const demo = runChairmanDemo({ db, seed: `investor-${division}`, worldDate: "2027-07-01", clubId: row.id });
    const economy = new ClubEconomyRepository(db);
    const ownerStake = economy.ownershipStakes(row.id).find((stake) => stake.holderId === demo.chairmanPersonId && stake.status === "ACTIVE")!;
    economy.upsertOwnershipStake({ ...ownerStake, percentage: 51, votingPercentage: 51, role: "MAJORITY_OWNER", ownershipModel: "BUYABLE" });
    const beforeClubCash = economy.financialAccount(row.id)!.cashBalance;
    const beforePersonalCash = economy.personalFinancialProfile(demo.chairmanPersonId)!.cash;
    const market = createInvestorStakeOffer(db, { clubId: row.id, sellerHolderId: demo.chairmanPersonId, percentage: 10, date: "2027-07-02" });
    expect(market.bids).toHaveLength(3);
    const accepted = decideInvestorBid(db, { offerId: market.bids[0]!.offer.id, date: "2027-07-03", accept: true });
    expect(accepted.status).toBe("ACCEPTED");
    const after = new ClubEconomyRepository(db);
    expect(after.financialAccount(row.id)!.cashBalance).toBe(beforeClubCash);
    expect(after.personalFinancialProfile(demo.chairmanPersonId)!.cash).toBe(beforePersonalCash + market.bids[0]!.offer.offerAmount);
    expect(after.ownershipStakes(row.id).find((stake) => stake.holderId === demo.chairmanPersonId && stake.status === "ACTIVE")?.percentage).toBe(41);
    expect(after.ownershipStakes(row.id).find((stake) => stake.holderId === market.bids[0]!.offer.buyerPersonId && stake.status === "ACTIVE")?.percentage).toBe(10);
    expect(heldCareerRoles(db, demo.chairmanPersonId).some((role) => role.role === "CHAIRMAN_OWNER")).toBe(false);
    const rejectedMarket = createInvestorStakeOffer(db, { clubId: row.id, sellerHolderId: demo.chairmanPersonId, percentage: 5, date: "2027-07-04" });
    const sellerCashBeforeReject = after.personalFinancialProfile(demo.chairmanPersonId)!.cash;
    const rejection = rejectedMarket.bids.find((bid) => bid.offer.percentage === 5 && bid.offer.status === "OFFER")!;
    expect(decideInvestorBid(db, { offerId: rejection.offer.id, date: "2027-07-05", accept: false }).status).toBe("REJECTED");
    expect(after.personalFinancialProfile(demo.chairmanPersonId)!.cash).toBe(sellerCashBeforeReject);
    db.close();
    const reloaded = openGameDatabase(path);
    expect(buildOwnershipInvestorMarket(reloaded, row.id, "2027-07-03").bids.find((bid) => bid.offer.id === market.bids[0]!.offer.id)?.offer.status).toBe("ACCEPTED");
    reloaded.close();
    rmSync(dir, { recursive: true, force: true });
  }, 180_000);
});
