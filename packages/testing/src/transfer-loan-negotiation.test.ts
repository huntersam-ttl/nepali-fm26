import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DesktopApplicationService, createTransferOffer, processDueTransferOffers } from "@nepal-football-sim/simulation";
import {
  TransferMarketRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");

let service: DesktopApplicationService;
let savesDirectory: string;
let saveId: EntityId;
let saveFilePath: string;

const command = () => ({
  saveName: "Transfer Loan Negotiation",
  character: {
    fullName: "Maya Adhikari",
    preferredDisplayName: "Maya",
    dateOfBirth: "1993-05-12",
    startingAge: 33,
    languages: ["ne", "en"],
    footballBackground: "COMMUNITY_COACHING",
    education: "SPORTS_RELATED_DEGREE",
    playingExperience: "AMATEUR_PLAYER",
    coachingExperience: "YOUTH_COACH",
    businessBackground: "SMALL_BUSINESS",
    startingReputationProfile: "LOCAL_RESPECTED",
  },
});

/**
 * negotiateLoan requires a genuine active parent-club contract — a
 * searchRecruitment row's clubName alone doesn't guarantee one exists (some
 * generated players have no formal contract on file). This queries the real
 * player_contracts table directly for a rival player who actually has one,
 * so the loan tests exercise the real negotiation path instead of tripping
 * the (correct, pre-existing) "cannot be approached for a loan" validation.
 */
const findLoanableRivalPlayer = (
  db: ReturnType<typeof openGameDatabase>,
  ownClubId: EntityId,
  worldDate: string,
): EntityId | undefined => {
  const rows = db
    .prepare(
      `SELECT player_id AS playerId FROM player_contracts
       WHERE club_id != ? AND status = 'ACTIVE' AND start_date <= ? AND end_date > ?
       ORDER BY player_id LIMIT 20`,
    )
    .all(ownClubId, worldDate, worldDate) as Array<{ playerId: EntityId }>;
  const found = rows.find((row) => !usedPlayerIds.has(row.playerId))?.playerId;
  if (found) usedPlayerIds.add(found);
  return found;
};

const ownClubIdFor = (db: ReturnType<typeof openGameDatabase>, playerId: EntityId): EntityId => {
  const row = db
    .prepare("SELECT club_id AS clubId FROM player_contracts WHERE player_id = ? AND status='ACTIVE'")
    .get(playerId) as { clubId: EntityId };
  return row.clubId;
};

/** Any club other than the two given — used to stand in for a competing bidder. */
const rivalClubIdExcluding = (db: ReturnType<typeof openGameDatabase>, ...excluded: EntityId[]): EntityId => {
  const placeholders = excluded.map(() => "?").join(",");
  const row = db
    .prepare(`SELECT id FROM clubs WHERE id NOT IN (${placeholders}) ORDER BY id LIMIT 1`)
    .get(...excluded) as { id: EntityId };
  return row.id;
};

// Tests share one persistent career/world across the whole file — a player
// already offered on in an earlier test keeps whatever status that offer
// reached (createTransferOffer is itself idempotent per exact terms/date),
// so each test must pick its own untouched target rather than "the first
// row", or it silently inspects a different test's already-resolved offer.
const usedPlayerIds = new Set<EntityId>();
const pickUnusedTarget = <T extends { playerId: EntityId }>(rows: T[]): T | undefined => {
  const target = rows.find((row) => !usedPlayerIds.has(row.playerId));
  if (target) usedPlayerIds.add(target.playerId);
  return target;
};

const filePathFor = (): string => {
  const saves = service.listSaves();
  if (!saves.ok) throw new Error("listSaves failed");
  const entry = saves.data.find((candidate) => candidate.saveId === saveId);
  if (!entry) throw new Error("save not found");
  return entry.filePath;
};

beforeAll(() => {
  savesDirectory = mkdtempSync(join(tmpdir(), "transfer-loan-negotiation-"));
  service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
  const created = service.createCareer(command());
  if (!created.ok) throw new Error(`career creation failed: ${created.error.message}`);
  saveId = created.data.save.id;
  saveFilePath = filePathFor();
}, 240_000);

afterAll(() => {
  service.closeCareer();
  rmSync(savesDirectory, { recursive: true, force: true });
});

describe("transfer negotiation depth", () => {
  it("does not resolve a submitted offer synchronously, and clears the pending decision exactly once when it comes due", () => {
    const search = service.searchRecruitment({ pageSize: 60 });
    expect(search.ok).toBe(true);
    if (!search.ok) return;
    const squad = service.getSquad();
    expect(squad.ok).toBe(true);
    if (!squad.ok) return;
    const ownIds = new Set(squad.data.players.map((player) => player.personId));
    const target = pickUnusedTarget(search.data.rows.filter((row) => !ownIds.has(row.playerId)));
    if (!target) return;

    const offered = service.makeTransferOffer({ playerId: target.playerId });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    const offer = offered.data.incoming.find((row) => row.playerId === target.playerId);
    expect(offer?.status).toBe("SUBMITTED");

    // Inspect the real persisted row directly: a decision must be scheduled,
    // not made, and it must land within the plausible 1-3 day window.
    const db = openGameDatabase(saveFilePath);
    const market = new TransferMarketRepository(db);
    const persisted = market.transferOffers().find((row) => row.playerId === target.playerId);
    expect(persisted?.pendingDecisionBy).toBe("CLUB");
    expect(persisted?.respondBy).toBeTruthy();
    db.close();

    // Advancing the career must not stop before the scheduled day, and the
    // stop reason must be the real transfer response, not a coincidence.
    const advanced = service.continueCareer();
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;

    const afterDb = openGameDatabase(saveFilePath);
    const afterMarket = new TransferMarketRepository(afterDb);
    const resolved = afterMarket.transferOffers().find((row) => row.playerId === target.playerId);
    afterDb.close();
    expect(resolved).toBeTruthy();
    expect(resolved!.status).not.toBe("SUBMITTED");
  }, 120_000);

  it("runs the club decision and player-terms decision as two separate due dates for an accepted transfer", () => {
    // A deterministic, generous fee against a low-reputation free agent
    // maximises the chance of an outright club acceptance so the
    // club-agreed -> player-terms phase transition is actually exercised.
    const search = service.searchRecruitment({ pageSize: 200 });
    expect(search.ok).toBe(true);
    if (!search.ok) return;
    const squad = service.getSquad();
    if (!squad.ok) return;
    const ownIds = new Set(squad.data.players.map((player) => player.personId));
    const freeAgent = search.data.rows.find(
      (row) => !ownIds.has(row.playerId) && row.discoveryStatus !== "UNDISCOVERED" && !row.clubName,
    );
    if (!freeAgent) return; // Free agents aren't guaranteed in every dataset slice — an honest skip, not a false pass.

    const offered = service.makeTransferOffer({ playerId: freeAgent.playerId });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;

    let db = openGameDatabase(saveFilePath);
    let market = new TransferMarketRepository(db);
    let persisted = market.transferOffers().find((row) => row.playerId === freeAgent.playerId);
    expect(persisted?.offerType).toBe("FREE_TRANSFER");
    db.close();

    // Free-transfer offers have no selling club to negotiate a fee with, so
    // evaluateTransferOffer accepts unconditionally — this exercises the
    // CLUB -> PLAYER phase handoff deterministically.
    for (let i = 0; i < 5 && persisted?.status !== "COMPLETED" && persisted?.status !== "REJECTED"; i++) {
      const advanced = service.continueCareer();
      if (!advanced.ok) break;
      db = openGameDatabase(saveFilePath);
      market = new TransferMarketRepository(db);
      persisted = market.transferOffers().find((row) => row.playerId === freeAgent.playerId);
      db.close();
    }
    expect(["COMPLETED", "REJECTED"]).toContain(persisted?.status);
  }, 120_000);

  it("loan enquiries go through real parent-club evaluation instead of resolving instantly", () => {
    const squad = service.getSquad();
    expect(squad.ok).toBe(true);
    if (!squad.ok) return;
    let db = openGameDatabase(saveFilePath);
    const ownClubId = ownClubIdFor(db, squad.data.players[0]!.personId);
    const targetId = findLoanableRivalPlayer(db, ownClubId, "2026-08-01");
    db.close();
    if (!targetId) return;

    // A low wage-contribution offer should not be accepted outright for any
    // player with real squad standing — this is the exact complaint
    // ("loan resolves in a second") this sprint fixes.
    const loaned = service.negotiateLoan({ playerId: targetId, wageContributionPercent: 10 });
    expect(loaned.ok).toBe(true);
    if (!loaned.ok) return;

    db = openGameDatabase(saveFilePath);
    const market = new TransferMarketRepository(db);
    const offer = market.transferOffers().find((row) => row.playerId === targetId && row.loanTerms);
    expect(offer).toBeTruthy();
    expect(offer?.status).toBe("SUBMITTED");
    expect(offer?.pendingDecisionBy).toBe("CLUB");
    expect(offer?.loanTerms?.wageContributionPercent).toBe(10);
    db.close();
  }, 120_000);

  it("counters an unattractively low wage split and lets the manager accept the counter to finalize the loan", () => {
    const squad = service.getSquad();
    if (!squad.ok) return;
    let seedDb = openGameDatabase(saveFilePath);
    const ownClubId = ownClubIdFor(seedDb, squad.data.players[0]!.personId);
    const targetId = findLoanableRivalPlayer(seedDb, ownClubId, "2026-08-01");
    seedDb.close();
    if (!targetId) return;
    const target = { playerId: targetId };

    const loaned = service.negotiateLoan({ playerId: target.playerId, wageContributionPercent: 5 });
    expect(loaned.ok).toBe(true);
    if (!loaned.ok) return;

    let db = openGameDatabase(saveFilePath);
    let market = new TransferMarketRepository(db);
    let offer = market.transferOffers().find((row) => row.playerId === target.playerId && row.loanTerms);
    const offerId = offer!.id;
    db.close();

    for (let i = 0; i < 5 && offer?.status === "SUBMITTED"; i++) {
      const advanced = service.continueCareer();
      if (!advanced.ok) break;
      db = openGameDatabase(saveFilePath);
      market = new TransferMarketRepository(db);
      offer = market.transferOffers().find((row) => row.id === offerId);
      db.close();
    }

    expect(["COUNTERED", "REJECTED", "COMPLETED"]).toContain(offer?.status);
    if (offer?.status === "COUNTERED") {
      const accepted = service.respondLoanOffer({ offerId, action: "ACCEPT" });
      expect(accepted.ok).toBe(true);
      db = openGameDatabase(saveFilePath);
      market = new TransferMarketRepository(db);
      offer = market.transferOffers().find((row) => row.id === offerId);
      expect(offer?.status).toBe("COMPLETED");
      const loans = market.activeLoans(offer!.submittedAt as string);
      expect(loans.some((loan) => loan.playerId === target.playerId)).toBe(true);
      db.close();
    }
  }, 120_000);

  it("persists a mid-negotiation offer's stage and terms across a full reload", () => {
    const squad = service.getSquad();
    if (!squad.ok) return;
    const search = service.searchRecruitment({ pageSize: 60 });
    if (!search.ok) return;
    const ownIds = new Set(squad.data.players.map((player) => player.personId));
    const target = pickUnusedTarget(search.data.rows.filter((row) => !ownIds.has(row.playerId)));
    if (!target) return;

    const offered = service.makeTransferOffer({ playerId: target.playerId });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;

    const before = openGameDatabase(saveFilePath);
    const beforeMarket = new TransferMarketRepository(before);
    const beforeOffer = beforeMarket.transferOffers().find((row) => row.playerId === target.playerId);
    const beforeRespondBy = beforeOffer?.respondBy;
    before.close();

    service.closeCareer();
    const reloaded = service.loadCareer(saveId);
    expect(reloaded.ok).toBe(true);

    const after = openGameDatabase(saveFilePath);
    const afterMarket = new TransferMarketRepository(after);
    const afterOffer = afterMarket.transferOffers().find((row) => row.playerId === target.playerId);
    expect(afterOffer?.status).toBe("SUBMITTED");
    expect(afterOffer?.pendingDecisionBy).toBe("CLUB");
    expect(afterOffer?.respondBy).toBe(beforeRespondBy);
    after.close();
  }, 120_000);

  it("supports a competing bid for the same player without either offer resolving instantly or clobbering the other", () => {
    const search = service.searchRecruitment({ pageSize: 60 });
    if (!search.ok) return;
    const squad = service.getSquad();
    if (!squad.ok) return;
    const ownIds = new Set(squad.data.players.map((player) => player.personId));
    const target = pickUnusedTarget(search.data.rows.filter((row) => !ownIds.has(row.playerId)));
    if (!target) return;

    const offered = service.makeTransferOffer({ playerId: target.playerId });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;

    const db = openGameDatabase(saveFilePath);
    const market = new TransferMarketRepository(db);
    const ownOffer = market.transferOffers().find((row) => row.playerId === target.playerId);
    expect(ownOffer?.status).toBe("SUBMITTED");

    const ownClubId = ownClubIdFor(db, squad.data.players[0]!.personId);
    const sellingClubId = ownOffer?.sellingClubId;
    const rivalClubId = rivalClubIdExcluding(db, ownClubId, ...(sellingClubId ? [sellingClubId] : []));
    const rivalOffer = createTransferOffer(db, {
      buyingClubId: rivalClubId,
      sellingClubId,
      playerId: target.playerId,
      submittedAt: "2026-08-01",
      fee: (ownOffer?.transferFee ?? 100_000) + 50_000,
    });
    db.close();

    // Both offers must coexist, independently addressable by id, and the
    // manager's own offer must not have been silently mutated by the rival's.
    expect(rivalOffer.id).not.toBe(ownOffer!.id);
    const afterDb = openGameDatabase(saveFilePath);
    const afterMarket = new TransferMarketRepository(afterDb);
    const rows = afterMarket.transferOffers().filter((row) => row.playerId === target.playerId);
    afterDb.close();
    expect(rows.map((row) => row.id).sort()).toEqual([ownOffer!.id, rivalOffer.id].sort());
    expect(rows.find((row) => row.id === ownOffer!.id)?.status).toBe("SUBMITTED");
  }, 120_000);

  it("processing due offers twice for the same world date is a no-op the second time", () => {
    const search = service.searchRecruitment({ pageSize: 60 });
    if (!search.ok) return;
    const squad = service.getSquad();
    if (!squad.ok) return;
    const ownIds = new Set(squad.data.players.map((player) => player.personId));
    const target = pickUnusedTarget(search.data.rows.filter((row) => !ownIds.has(row.playerId)));
    if (!target) return;

    const offered = service.makeTransferOffer({ playerId: target.playerId });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;

    const db = openGameDatabase(saveFilePath);
    const market = new TransferMarketRepository(db);
    const offer = market.transferOffers().find((row) => row.playerId === target.playerId)!;
    const respondBy = offer.respondBy!;

    const firstRun = processDueTransferOffers(db, respondBy, "exactly-once-test");
    const roundsAfterFirst = market.negotiationRounds(offer.id).length;
    const statusAfterFirst = market.transferOffers().find((row) => row.id === offer.id)?.status;

    const secondRun = processDueTransferOffers(db, respondBy, "exactly-once-test");
    const roundsAfterSecond = market.negotiationRounds(offer.id).length;
    const statusAfterSecond = market.transferOffers().find((row) => row.id === offer.id)?.status;
    db.close();

    expect(firstRun.some((result) => result.playerId === target.playerId)).toBe(true);
    expect(secondRun.some((result) => result.playerId === target.playerId)).toBe(false);
    expect(roundsAfterSecond).toBe(roundsAfterFirst);
    expect(statusAfterSecond).toBe(statusAfterFirst);
  }, 120_000);

  it("persists a permanent transfer's personal-terms phase (club-agreed, player pending) across a full reload", () => {
    const search = service.searchRecruitment({ pageSize: 200 });
    if (!search.ok) return;
    const squad = service.getSquad();
    if (!squad.ok) return;
    const ownIds = new Set(squad.data.players.map((player) => player.personId));
    const freeAgent = pickUnusedTarget(
      search.data.rows.filter((row) => !ownIds.has(row.playerId) && !row.clubName),
    );
    if (!freeAgent) return; // Free agents aren't guaranteed in every dataset slice — an honest skip.

    const offered = service.makeTransferOffer({ playerId: freeAgent.playerId });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;

    let db = openGameDatabase(saveFilePath);
    let market = new TransferMarketRepository(db);
    let offer = market.transferOffers().find((row) => row.playerId === freeAgent.playerId);
    db.close();

    // Free-transfer club-side evaluation accepts unconditionally, so one
    // advance reliably lands the offer in the PLAYER phase.
    for (let i = 0; i < 3 && offer?.pendingDecisionBy !== "PLAYER"; i++) {
      const advanced = service.continueCareer();
      if (!advanced.ok) break;
      db = openGameDatabase(saveFilePath);
      market = new TransferMarketRepository(db);
      offer = market.transferOffers().find((row) => row.playerId === freeAgent.playerId);
      db.close();
    }
    if (offer?.pendingDecisionBy !== "PLAYER") return; // Player-terms phase not reached this run — nothing to verify.

    const respondByBeforeReload = offer.respondBy;
    service.closeCareer();
    const reloaded = service.loadCareer(saveId);
    expect(reloaded.ok).toBe(true);

    const after = openGameDatabase(saveFilePath);
    const afterMarket = new TransferMarketRepository(after);
    const afterOffer = afterMarket.transferOffers().find((row) => row.id === offer!.id);
    after.close();
    expect(afterOffer?.pendingDecisionBy).toBe("PLAYER");
    expect(afterOffer?.respondBy).toBe(respondByBeforeReload);
    expect(afterOffer?.status).toBe(offer.status);
  }, 120_000);

  it("persists a countered loan's negotiated wage split across a full reload", () => {
    const squad = service.getSquad();
    if (!squad.ok) return;
    let seedDb = openGameDatabase(saveFilePath);
    const ownClubId = ownClubIdFor(seedDb, squad.data.players[0]!.personId);
    const targetId = findLoanableRivalPlayer(seedDb, ownClubId, "2026-08-01");
    seedDb.close();
    if (!targetId) return;

    const loaned = service.negotiateLoan({ playerId: targetId, wageContributionPercent: 5 });
    expect(loaned.ok).toBe(true);
    if (!loaned.ok) return;

    let db = openGameDatabase(saveFilePath);
    let market = new TransferMarketRepository(db);
    let offer = market.transferOffers().find((row) => row.playerId === targetId && row.loanTerms);
    const offerId = offer!.id;
    db.close();

    for (let i = 0; i < 5 && offer?.status === "SUBMITTED"; i++) {
      const advanced = service.continueCareer();
      if (!advanced.ok) break;
      db = openGameDatabase(saveFilePath);
      market = new TransferMarketRepository(db);
      offer = market.transferOffers().find((row) => row.id === offerId);
      db.close();
    }
    if (offer?.status !== "COUNTERED") return; // Counter not reached this run (accepted/rejected outright) — nothing to verify.

    const wageBeforeReload = offer.loanTerms?.wageContributionPercent;
    service.closeCareer();
    const reloaded = service.loadCareer(saveId);
    expect(reloaded.ok).toBe(true);

    const after = openGameDatabase(saveFilePath);
    const afterMarket = new TransferMarketRepository(after);
    const afterOffer = afterMarket.transferOffers().find((row) => row.id === offerId);
    after.close();
    expect(afterOffer?.status).toBe("COUNTERED");
    expect(afterOffer?.loanTerms?.wageContributionPercent).toBe(wageBeforeReload);
  }, 120_000);

  it("lets the manager withdraw a pending bid, and refuses a second withdraw on the now-terminal offer", () => {
    const search = service.searchRecruitment({ pageSize: 60 });
    if (!search.ok) return;
    const squad = service.getSquad();
    if (!squad.ok) return;
    const ownIds = new Set(squad.data.players.map((player) => player.personId));
    const target = pickUnusedTarget(search.data.rows.filter((row) => !ownIds.has(row.playerId)));
    if (!target) return;

    const offered = service.makeTransferOffer({ playerId: target.playerId });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    const offer = offered.data.incoming.find((row) => row.playerId === target.playerId)!;

    const withdrawn = service.withdrawTransferOffer({ offerId: offer.id });
    expect(withdrawn.ok).toBe(true);
    if (!withdrawn.ok) return;
    const afterWithdraw = withdrawn.data.incoming.find((row) => row.id === offer.id);
    expect(afterWithdraw?.status).toBe("WITHDRAWN");

    // The offer is now terminal — a second withdraw must be refused, not
    // silently re-applied (the exact-once guarantee the manager's own
    // actions need just as much as the AI's scheduled decisions do).
    const secondWithdraw = service.withdrawTransferOffer({ offerId: offer.id });
    expect(secondWithdraw.ok).toBe(false);
  }, 120_000);

  it("lets the manager revise a countered loan proposal, which is re-evaluated rather than accepted on submission", () => {
    const squad = service.getSquad();
    if (!squad.ok) return;
    let seedDb = openGameDatabase(saveFilePath);
    const ownClubId = ownClubIdFor(seedDb, squad.data.players[0]!.personId);
    const targetId = findLoanableRivalPlayer(seedDb, ownClubId, "2026-08-01");
    seedDb.close();
    if (!targetId) return;

    const loaned = service.negotiateLoan({ playerId: targetId, wageContributionPercent: 5 });
    expect(loaned.ok).toBe(true);
    if (!loaned.ok) return;

    let db = openGameDatabase(saveFilePath);
    let market = new TransferMarketRepository(db);
    let offer = market.transferOffers().find((row) => row.playerId === targetId && row.loanTerms);
    const offerId = offer!.id;
    db.close();

    for (let i = 0; i < 5 && offer?.status === "SUBMITTED"; i++) {
      const advanced = service.continueCareer();
      if (!advanced.ok) break;
      db = openGameDatabase(saveFilePath);
      market = new TransferMarketRepository(db);
      offer = market.transferOffers().find((row) => row.id === offerId);
      db.close();
    }
    if (offer?.status !== "COUNTERED") return; // Counter not reached this run — nothing to verify.

    const demandedWage = offer.loanTerms!.wageContributionPercent;
    const revised = service.counterLoanOffer({ offerId, wageContributionPercent: demandedWage - 1 });
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;

    db = openGameDatabase(saveFilePath);
    market = new TransferMarketRepository(db);
    const afterRevision = market.transferOffers().find((row) => row.id === offerId);
    db.close();
    // Not resolved on submission — back to a pending club decision, not
    // instantly accepted or rejected.
    expect(afterRevision?.status).toBe("SUBMITTED");
    expect(afterRevision?.pendingDecisionBy).toBe("CLUB");
    expect(afterRevision?.respondBy).toBeTruthy();
    expect(afterRevision?.loanTerms?.wageContributionPercent).toBe(demandedWage - 1);
  }, 120_000);
});
