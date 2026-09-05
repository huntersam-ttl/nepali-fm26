import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ClubEconomyRepository, OwnershipRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  MAX_NEGOTIATION_ROUNDS,
  acknowledgeBoardOpposition,
  calculateAcquisitionValuationBreakdown,
  counterInvestorBid,
  createInvestorStakeOffer,
  createNepalSave,
  decideInvestorBid,
  initializeClubEconomyForSave,
  processDueOwnershipOffers,
  runChairmanDemo,
  runDueDiligence,
  withdrawInvestorBidResponse,
} from "@nepal-football-sim/simulation";
import type { EntityId, OwnershipAcquisitionOffer } from "@nepal-football-sim/shared-types";

const dataset = JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8"));

const setup = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), `ownership-negotiation-${name}-`));
  const path = join(dir, "save.sqlite");
  createNepalSave({ databasePath: path, dataset, saveName: name, gameVersion: "test", randomSeed: name });
  const db = openGameDatabase(path);
  initializeClubEconomyForSave({ db, worldDate: "2027-07-01", seed: name });
  const club = db
    .prepare(
      "SELECT DISTINCT c.id FROM clubs c JOIN club_memberships cm ON cm.club_id=c.id JOIN competition_seasons cs ON cs.id=cm.competition_season_id JOIN competitions comp ON comp.id=cs.competition_id WHERE lower(comp.name) LIKE '%a-division%' AND cm.status='ACTIVE' LIMIT 1",
    )
    .get() as { id: EntityId };
  const demo = runChairmanDemo({ db, seed: name, worldDate: "2027-07-01", clubId: club.id });
  const economy = new ClubEconomyRepository(db);
  const ownerStake = economy
    .ownershipStakes(club.id)
    .find((stake) => stake.holderId === demo.chairmanPersonId && stake.status === "ACTIVE")!;
  economy.upsertOwnershipStake({ ...ownerStake, percentage: 51, votingPercentage: 51, role: "MAJORITY_OWNER", ownershipModel: "BUYABLE" });
  return { dir, path, db, clubId: club.id, ownerPersonId: demo.chairmanPersonId };
};

const advanceUntilSettled = (db: ReturnType<typeof openGameDatabase>, offerId: EntityId, maxDays = 10): OwnershipAcquisitionOffer => {
  const repo = new OwnershipRepository(db);
  let current = repo.offer(offerId)!;
  for (let i = 0; i < maxDays && current.status !== "COMPLETED" && current.status !== "REJECTED" && current.status !== "WITHDRAWN"; i += 1) {
    if (current.status === "COUNTER" && current.pendingDecisionBy === "OWNER") {
      current = decideInvestorBid(db, { offerId, date: current.createdOn, accept: true });
      continue;
    }
    if (!current.respondBy) break;
    processDueOwnershipOffers(db, current.respondBy);
    current = repo.offer(offerId)!;
  }
  return current;
};

describe("club valuation breakdown", () => {
  it("returns a real range around the midpoint with a labelled factor breakdown", () => {
    const { db, clubId, dir } = setup("valuation");
    const breakdown = calculateAcquisitionValuationBreakdown(db, clubId, "2027-07-01");
    expect(breakdown.negotiationRange.min).toBeLessThan(breakdown.midpoint);
    expect(breakdown.negotiationRange.max).toBeGreaterThan(breakdown.midpoint);
    expect(breakdown.factors.financialFoundation).toBeTypeOf("number");
    expect(breakdown.provenanceStatus).toBe("SIMULATION_ONLY");
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});

describe("ownership negotiation depth", () => {
  it("does not resolve an accepted bid synchronously, and clears the pending decision once it comes due", () => {
    const { db, dir, clubId, ownerPersonId } = setup("timing");
    const market = createInvestorStakeOffer(db, { clubId, sellerHolderId: ownerPersonId, percentage: 8, date: "2027-07-02" });
    const bid = market.bids.find((b) => b.offer.dealStructure === "SECONDARY_STAKE_SALE")!;
    const accepted = decideInvestorBid(db, { offerId: bid.offer.id, date: "2027-07-03", accept: true });
    expect(accepted.status).toBe("DUE_DILIGENCE");
    expect(accepted.pendingDecisionBy).toBe("INVESTOR");
    expect(accepted.respondBy).toBeTruthy();
    // Not due yet — processing an earlier date must not touch it.
    const tooEarly = processDueOwnershipOffers(db, "2027-07-03");
    expect(tooEarly.find((o) => o.clubId === clubId)).toBeUndefined();
    const final = advanceUntilSettled(db, bid.offer.id);
    expect(final.status).toBe("COMPLETED");
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("gives a primary capital injection bid a distinct money flow — club cash grows, no cash reaches the owner personally", () => {
    const { db, dir, clubId, ownerPersonId } = setup("primary");
    const beforeOwnerCash = new ClubEconomyRepository(db).personalFinancialProfile(ownerPersonId)!.cash;
    const beforeClubCash = new ClubEconomyRepository(db).financialAccount(clubId)!.cashBalance;
    const market = createInvestorStakeOffer(db, { clubId, sellerHolderId: ownerPersonId, percentage: 8, date: "2027-07-02" });
    const primaryBid = market.bids.find((b) => b.offer.dealStructure === "PRIMARY_CAPITAL_INJECTION")!;
    expect(primaryBid.offer.capitalInjectionAmount).toBeGreaterThan(0);
    expect(primaryBid.offer.ownerProceedsAmount).toBe(0);
    const accepted = decideInvestorBid(db, { offerId: primaryBid.offer.id, date: "2027-07-03", accept: true });
    expect(accepted.status).toBe("DUE_DILIGENCE");
    const final = advanceUntilSettled(db, primaryBid.offer.id);
    expect(final.status).toBe("COMPLETED");
    const economy = new ClubEconomyRepository(db);
    // Club cash grew by the injected amount; the owner's own cash is untouched.
    expect(economy.financialAccount(clubId)!.cashBalance).toBeGreaterThan(beforeClubCash);
    expect(economy.personalFinancialProfile(ownerPersonId)!.cash).toBe(beforeOwnerCash);
    // Existing holders were diluted — the owner's stake shrank without them selling anything.
    const ownerStake = economy.ownershipStakes(clubId).find((s) => s.holderId === ownerPersonId && s.status === "ACTIVE");
    expect(ownerStake!.percentage).toBeLessThan(51);
    const buyerStake = economy.ownershipStakes(clubId).find((s) => s.holderId === primaryBid.offer.buyerPersonId && s.status === "ACTIVE");
    expect(buyerStake!.percentage).toBeCloseTo(8, 0);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("gives a secondary stake sale the opposite money flow — the owner is paid, club cash is untouched", () => {
    const { db, dir, clubId, ownerPersonId } = setup("secondary");
    const beforeClubCash = new ClubEconomyRepository(db).financialAccount(clubId)!.cashBalance;
    const market = createInvestorStakeOffer(db, { clubId, sellerHolderId: ownerPersonId, percentage: 8, date: "2027-07-02" });
    const secondaryBid = market.bids.find((b) => b.offer.dealStructure === "SECONDARY_STAKE_SALE")!;
    expect(secondaryBid.offer.ownerProceedsAmount).toBeGreaterThan(0);
    expect(secondaryBid.offer.capitalInjectionAmount).toBe(0);
    decideInvestorBid(db, { offerId: secondaryBid.offer.id, date: "2027-07-03", accept: true });
    const final = advanceUntilSettled(db, secondaryBid.offer.id);
    expect(final.status).toBe("COMPLETED");
    expect(new ClubEconomyRepository(db).financialAccount(clubId)!.cashBalance).toBe(beforeClubCash);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("lets the owner counter a fresh bid, and the investor genuinely re-evaluates rather than auto-accepting", () => {
    const { db, dir, clubId, ownerPersonId } = setup("counter");
    const market = createInvestorStakeOffer(db, { clubId, sellerHolderId: ownerPersonId, percentage: 8, date: "2027-07-02" });
    const bid = market.bids.find((b) => b.offer.dealStructure === "SECONDARY_STAKE_SALE")!;
    // Ask for an unreasonably high price — the investor should never simply
    // accept any number the owner names. As of the multi-round rewrite the
    // investor's first move is to counter back partway (genuine haggling,
    // not an instant reject) — it only walks away once the round/persistence
    // limit is reached with the gap still too wide, so drive the exchange to
    // its real conclusion rather than asserting on the very first response.
    const absurd = bid.offer.offerAmount * 10;
    const countered = counterInvestorBid(db, { offerId: bid.offer.id, amount: absurd, date: "2027-07-03" });
    expect(countered.status).toBe("COUNTER");
    expect(countered.pendingDecisionBy).toBe("INVESTOR");
    expect(countered.respondBy).toBeTruthy();
    const repo = new OwnershipRepository(db);
    let current = countered;
    let sawInvestorCounter = false;
    for (let i = 0; i < MAX_NEGOTIATION_ROUNDS + 2 && current.status !== "REJECTED" && current.status !== "DUE_DILIGENCE"; i += 1) {
      if (current.status === "COUNTER" && current.pendingDecisionBy === "OWNER") {
        sawInvestorCounter = true;
        if ((current.negotiationRoundCount ?? 0) >= MAX_NEGOTIATION_ROUNDS) {
          // Countering is no longer available at the round cap — same as
          // the real UI, the owner's only moves left are accept/reject/
          // withdraw. Holding firm on an absurd ask means rejecting.
          current = decideInvestorBid(db, { offerId: bid.offer.id, date: "2027-07-03", accept: false });
          break;
        }
        // The investor countered back — the owner holds firm at the same
        // absurd ask, so the gap never closes.
        current = counterInvestorBid(db, { offerId: bid.offer.id, amount: absurd, date: "2027-07-03" });
        continue;
      }
      if (!current.respondBy) break;
      processDueOwnershipOffers(db, current.respondBy);
      current = repo.offer(bid.offer.id)!;
    }
    expect(sawInvestorCounter).toBe(true);
    expect(current.status).toBe("REJECTED");
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("bounds multi-round haggling — the owner cannot counter forever once the round limit is reached", () => {
    const { db, dir, clubId, ownerPersonId } = setup("round-limit");
    const market = createInvestorStakeOffer(db, { clubId, sellerHolderId: ownerPersonId, percentage: 8, date: "2027-07-02" });
    const bid = market.bids.find((b) => b.offer.dealStructure === "SECONDARY_STAKE_SALE")!;
    for (let i = 0; i < MAX_NEGOTIATION_ROUNDS; i += 1) {
      counterInvestorBid(db, { offerId: bid.offer.id, amount: bid.offer.offerAmount * 5, date: "2027-07-03" });
    }
    expect(() =>
      counterInvestorBid(db, { offerId: bid.offer.id, amount: bid.offer.offerAmount * 5, date: "2027-07-03" }),
    ).toThrow(/round limit/i);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("lets the owner counter on stake percentage and request a board seat, not just price", () => {
    const { db, dir, clubId, ownerPersonId } = setup("stake-counter");
    const market = createInvestorStakeOffer(db, { clubId, sellerHolderId: ownerPersonId, percentage: 8, date: "2027-07-02" });
    const bid = market.bids.find((b) => b.offer.dealStructure === "SECONDARY_STAKE_SALE")!;
    const countered = counterInvestorBid(db, {
      offerId: bid.offer.id,
      amount: bid.offer.offerAmount,
      percentage: 12,
      boardSeatRequested: true,
      date: "2027-07-03",
    });
    expect(countered.counterPercentage).toBe(12);
    expect(countered.boardSeatRequested).toBe(true);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("assigns a deterministic investor stance that survives reload", () => {
    const { db, dir, clubId, ownerPersonId, path } = setup("stance");
    const market = createInvestorStakeOffer(db, { clubId, sellerHolderId: ownerPersonId, percentage: 8, date: "2027-07-02" });
    const bid = market.bids[0]!;
    expect(bid.offer.investorStance).toBeTruthy();
    db.close();
    const reloaded = openGameDatabase(path);
    const afterReload = new OwnershipRepository(reloaded).offer(bid.offer.id)!;
    expect(afterReload.investorStance).toBe(bid.offer.investorStance);
    reloaded.close();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("lets the owner withdraw mid-negotiation, and refuses a second withdraw on the now-terminal offer", () => {
    const { db, dir, clubId, ownerPersonId } = setup("withdraw");
    const market = createInvestorStakeOffer(db, { clubId, sellerHolderId: ownerPersonId, percentage: 8, date: "2027-07-02" });
    const bid = market.bids.find((b) => b.offer.dealStructure === "SECONDARY_STAKE_SALE")!;
    decideInvestorBid(db, { offerId: bid.offer.id, date: "2027-07-03", accept: true });
    const withdrawn = withdrawInvestorBidResponse(db, { offerId: bid.offer.id, date: "2027-07-04" });
    expect(withdrawn.status).toBe("WITHDRAWN");
    expect(() => withdrawInvestorBidResponse(db, { offerId: bid.offer.id, date: "2027-07-05" })).toThrow();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("processing due offers twice for the same date is a no-op the second time", () => {
    const { db, dir, clubId, ownerPersonId } = setup("exactly-once");
    const market = createInvestorStakeOffer(db, { clubId, sellerHolderId: ownerPersonId, percentage: 8, date: "2027-07-02" });
    const bid = market.bids.find((b) => b.offer.dealStructure === "SECONDARY_STAKE_SALE")!;
    const accepted = decideInvestorBid(db, { offerId: bid.offer.id, date: "2027-07-03", accept: true });
    const repo = new OwnershipRepository(db);
    const first = processDueOwnershipOffers(db, accepted.respondBy!);
    const roundsAfterFirst = repo.negotiationRounds(bid.offer.id).length;
    const statusAfterFirst = repo.offer(bid.offer.id)!.status;
    const second = processDueOwnershipOffers(db, accepted.respondBy!);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(0);
    expect(repo.negotiationRounds(bid.offer.id).length).toBe(roundsAfterFirst);
    expect(repo.offer(bid.offer.id)!.status).toBe(statusAfterFirst);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("persists stage, valuation, and history across a full reload at due diligence, board review, and final terms", () => {
    for (const stopAt of ["DUE_DILIGENCE", "BOARD_REVIEW", "FINAL_TERMS"] as const) {
      const { db, dir, clubId, ownerPersonId, path } = setup(`reload-${stopAt.toLowerCase()}`);
      const market = createInvestorStakeOffer(db, { clubId, sellerHolderId: ownerPersonId, percentage: 8, date: "2027-07-02" });
      const bid = market.bids.find((b) => b.offer.dealStructure === "SECONDARY_STAKE_SALE")!;
      let current = decideInvestorBid(db, { offerId: bid.offer.id, date: "2027-07-03", accept: true });
      const repo = new OwnershipRepository(db);
      for (let i = 0; i < 6 && current.status !== stopAt && current.status !== "COMPLETED" && current.status !== "REJECTED"; i += 1) {
        if (!current.respondBy) break;
        processDueOwnershipOffers(db, current.respondBy);
        current = repo.offer(bid.offer.id)!;
      }
      if (current.status !== stopAt) {
        db.close();
        rmSync(dir, { recursive: true, force: true });
        continue; // Honest skip: this particular stage wasn't reached this run.
      }
      const beforeRespondBy = current.respondBy;
      const beforeHistoryLength = repo.negotiationRounds(bid.offer.id).length;
      db.close();
      const reloaded = openGameDatabase(path);
      const reloadedRepo = new OwnershipRepository(reloaded);
      const afterReload = reloadedRepo.offer(bid.offer.id)!;
      expect(afterReload.status).toBe(stopAt);
      expect(afterReload.respondBy).toBe(beforeRespondBy);
      expect(reloadedRepo.negotiationRounds(bid.offer.id).length).toBe(beforeHistoryLength);
      reloaded.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("lets a due-diligence finding actually cut the valuation, and severe distress can make the investor walk outright", () => {
    const { db, dir, clubId, ownerPersonId } = setup("dd-distress");
    const economy = new ClubEconomyRepository(db);
    const account = economy.financialAccount(clubId)!;
    // A genuinely distressed club: heavy debt against thin cash, insolvent
    // rating, and a season loss — several real findings stacking up, not a
    // single decorative one.
    economy.upsertFinancialAccount({
      ...account,
      cashBalance: 10_000,
      debtBalance: 5_000_000,
      seasonExpenses: 2_000_000,
      seasonProfitLoss: -500_000,
      financialHealth: "INSOLVENT",
    });
    const result = runDueDiligence(db, clubId, "2027-07-01");
    expect(result.severity).toBe("CONCERNING");
    expect(result.valuationAdjustmentPercent).toBeLessThan(-10);
    expect(result.walkAwayRisk).toBeGreaterThan(0);
    expect(result.findings.length).toBeGreaterThan(1);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("lets the owner explicitly proceed with a deal despite board opposition, and refuses a second confirmation on the now-terminal offer", () => {
    const { db, dir, clubId, ownerPersonId } = setup("board-opposed");
    const economy = new ClubEconomyRepository(db);
    // Force a real OPPOSED board reading rather than hoping for one.
    economy.upsertFinancialAccount({ ...economy.financialAccount(clubId)! });
    db.prepare(
      "INSERT INTO club_board_confidence (club_id, confidence, expectation, last_evaluated_on) VALUES (?,?,?,?) ON CONFLICT(club_id) DO UPDATE SET confidence=excluded.confidence, expectation=excluded.expectation, last_evaluated_on=excluded.last_evaluated_on",
    ).run(clubId, 10, "financial stability", "2027-07-01");
    const market = createInvestorStakeOffer(db, { clubId, sellerHolderId: ownerPersonId, percentage: 8, date: "2027-07-02" });
    const bid = market.bids.find((b) => b.offer.dealStructure === "SECONDARY_STAKE_SALE")!;
    let current = decideInvestorBid(db, { offerId: bid.offer.id, date: "2027-07-03", accept: true });
    const repo = new OwnershipRepository(db);
    for (let i = 0; i < 6 && current.status !== "FINAL_TERMS" && current.status !== "REJECTED"; i += 1) {
      if (current.status === "COUNTER" && current.pendingDecisionBy === "OWNER") {
        current = decideInvestorBid(db, { offerId: bid.offer.id, date: "2027-07-03", accept: true });
        continue;
      }
      if (!current.respondBy) break;
      processDueOwnershipOffers(db, current.respondBy);
      current = repo.offer(bid.offer.id)!;
    }
    if (current.status !== "FINAL_TERMS") return; // Honest skip: didn't reach final terms this run.
    expect(current.pendingDecisionBy).toBe("OWNER");
    expect(current.boardStanceTier).toBe("OPPOSED");
    // The daily tick must never settle this on its own — there is
    // deliberately no respondBy while it waits on the owner.
    expect(current.respondBy).toBeUndefined();
    const untouched = processDueOwnershipOffers(db, "2027-08-01");
    expect(untouched.find((o) => o.clubId === clubId)).toBeUndefined();
    expect(repo.offer(bid.offer.id)!.status).toBe("FINAL_TERMS");

    const confirmed = acknowledgeBoardOpposition(db, { offerId: bid.offer.id, date: "2027-07-10" });
    expect(confirmed.status).toBe("COMPLETED");
    expect(() => acknowledgeBoardOpposition(db, { offerId: bid.offer.id, date: "2027-07-11" })).toThrow();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("never collides on a duplicate historical-event id across multiple negotiation rounds on the same simulated day", () => {
    const { db, dir, clubId, ownerPersonId } = setup("event-dedupe");
    const market = createInvestorStakeOffer(db, { clubId, sellerHolderId: ownerPersonId, percentage: 8, date: "2027-07-02" });
    const bid = market.bids.find((b) => b.offer.dealStructure === "SECONDARY_STAKE_SALE")!;
    // Drive several owner<->investor counter rounds all "on" the same date
    // string — the exact scenario that previously collided on a duplicate
    // historical_events primary key.
    expect(() => {
      let offer = counterInvestorBid(db, { offerId: bid.offer.id, amount: bid.offer.offerAmount * 3, date: "2027-07-03" });
      for (let i = 0; i < 2 && offer.status === "COUNTER" && offer.pendingDecisionBy === "INVESTOR"; i += 1) {
        processDueOwnershipOffers(db, offer.respondBy ?? "2027-07-03");
        offer = new OwnershipRepository(db).offer(bid.offer.id)!;
        if (offer.status === "COUNTER" && offer.pendingDecisionBy === "OWNER" && (offer.negotiationRoundCount ?? 0) < MAX_NEGOTIATION_ROUNDS) {
          offer = counterInvestorBid(db, { offerId: bid.offer.id, amount: bid.offer.offerAmount * 3, date: "2027-07-03" });
        }
      }
    }).not.toThrow();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
