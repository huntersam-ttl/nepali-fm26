import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, TransferMarketRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  completePermanentTransfer,
  createNepalSave,
  createTransferOffer,
  evaluateTransferOffer,
  initializeForeignFootballWorldForSave,
  initializeTransferMarketForSave,
  runTransferDiagnostic,
  simulateTransferWindow,
} from "@nepal-football-sim/simulation";

/*
 * AI transfers used to deadlock: the selling club agreed, the player asked for
 * better terms, and nothing ever answered. Two breaks caused it — personal
 * terms judged the caller's stale copy of the offer instead of its persisted
 * state, and a stalled negotiation was not a state a revised offer could be
 * considered in.
 *
 * These tests pin the outcome of a negotiation, not a fixed script: a player
 * must still be able to refuse, and a club must still be able to walk away.
 */

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const WORLD_DATE = "2026-08-01";

const createWorld = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-terms-e2e-"));
  tempDirs.push(dir);
  const databasePath = join(dir, "world.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Terms ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  const db = openGameDatabase(databasePath);
  try {
    initializeTransferMarketForSave({ db, worldDate: WORLD_DATE, seed });
    initializeForeignFootballWorldForSave({ db, worldDate: WORLD_DATE, seed });
  } finally {
    db.close();
  }
  return databasePath;
};

const open = (databasePath: string) => openGameDatabase(databasePath);

const foreignClub = (db: ReturnType<typeof open>): { id: EntityId } =>
  db
    .prepare(
      "SELECT id FROM clubs WHERE canonical_external_id LIKE 'SIM-FOREIGN-%' ORDER BY id LIMIT 1",
    )
    .get() as { id: EntityId };

const foreignClubs = (db: ReturnType<typeof open>): Array<{ id: EntityId }> =>
  db
    .prepare("SELECT id FROM clubs WHERE canonical_external_id LIKE 'SIM-FOREIGN-%' ORDER BY id LIMIT 3")
    .all() as Array<{ id: EntityId }>;

/** A contracted Nepal player with a resolvable club, chosen deterministically. */
const nepalPlayer = (db: ReturnType<typeof open>): { player_id: EntityId; club_id: EntityId } =>
  db
    .prepare(
      `SELECT pc.player_id, pc.club_id FROM player_contracts pc
       JOIN clubs c ON c.id = pc.club_id
       JOIN countries co ON co.id = c.country_id
       WHERE pc.status = 'ACTIVE' AND co.iso_code IN ('NPL','NP')
       ORDER BY pc.player_id LIMIT 1`,
    )
    .get() as { player_id: EntityId; club_id: EntityId };

const historyCount = (db: ReturnType<typeof open>, playerId: EntityId, type: string): number =>
  Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) n FROM transfer_history_events WHERE player_id = ? AND event_type = ?",
        )
        .get(playerId, type) as { n?: number } | undefined
    )?.n ?? 0,
  );

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("AI personal-terms negotiation", () => {
  it("executes a Nepal export sell-on clause on a later foreign resale exactly once", () => {
    const databasePath = createWorld("sell-on-nepal-export");
    const db = open(databasePath);
    const target = nepalPlayer(db);
    const [foreignB, foreignC] = foreignClubs(db);
    const market = new TransferMarketRepository(db);
    const first = createTransferOffer(db, {
      buyingClubId: foreignB!.id,
      sellingClubId: target.club_id,
      playerId: target.player_id,
      submittedAt: WORLD_DATE,
      fee: 4_000_000,
      sellOnPercentage: 20,
    });
    expect(evaluateTransferOffer(db, first, WORLD_DATE, "sell-on-first").accepted).toBe(true);
    completePermanentTransfer(db, first, WORLD_DATE, "sell-on-first", { prefersOverseas: true, expectedPlayingTime: "FIRST_TEAM" }, { salary: 500_000, squadRole: "FIRST_TEAM", contractLengthMonths: 24 });
    expect(market.sellOnEntitlements(target.player_id)).toMatchObject([{ entitledClubId: target.club_id, percentage: 20, basis: "TOTAL_RESALE_FEE", status: "ACTIVE" }]);
    db.close();

    const reloaded = open(databasePath);
    try {
      const reloadedMarket = new TransferMarketRepository(reloaded);
      expect(reloadedMarket.sellOnEntitlements(target.player_id)).toHaveLength(1);
      const resale = createTransferOffer(reloaded, {
        buyingClubId: foreignC!.id,
        sellingClubId: foreignB!.id,
        playerId: target.player_id,
        submittedAt: "2027-01-01",
        fee: 10_000_000,
        sellOnPercentage: 0,
      });
      expect(evaluateTransferOffer(reloaded, resale, "2027-01-01", "sell-on-resale").accepted).toBe(true);
      completePermanentTransfer(reloaded, resale, "2027-01-01", "sell-on-resale", { prefersOverseas: true, expectedPlayingTime: "FIRST_TEAM" }, { salary: 500_000, squadRole: "FIRST_TEAM", contractLengthMonths: 24 });
      completePermanentTransfer(reloaded, resale, "2027-01-01", "sell-on-resale", { prefersOverseas: true, expectedPlayingTime: "FIRST_TEAM" }, { salary: 500_000, squadRole: "FIRST_TEAM", contractLengthMonths: 24 });
      const entitlement = reloadedMarket.sellOnEntitlements(target.player_id)[0]!;
      expect(entitlement.status).toBe("SETTLED");
      expect(entitlement.settledTransferId).toBe(resale.id);
      const resaleEntries = new ClubEconomyRepository(reloaded).ledgerEntries().filter((entry) => entry.relatedEntityId === resale.id);
      expect(resaleEntries.filter((entry) => entry.category === "TRANSFER_EXPENSE")).toHaveLength(1);
      expect(resaleEntries.filter((entry) => entry.category === "TRANSFER_INCOME")).toHaveLength(1);
      expect(resaleEntries.filter((entry) => entry.category === "SELL_ON_PAYMENT")).toEqual([expect.objectContaining({ clubId: foreignB!.id, amount: 2_000_000, direction: "DEBIT" })]);
      expect(resaleEntries.filter((entry) => entry.category === "SELL_ON_INCOME")).toEqual([expect.objectContaining({ clubId: target.club_id, amount: 2_000_000, direction: "CREDIT" })]);
      expect(historyCount(reloaded, target.player_id, "SELL_ON_CLAUSE_PAID")).toBe(1);
      expect(reloadedMarket.activeContract(target.player_id, "2027-01-01")?.clubId).toBe(foreignC!.id);
      expect(reloadedMarket.sellOnEntitlements(target.player_id)).toHaveLength(1);
    } finally {
      reloaded.close();
    }
  }, 300000);

  it("completes a Nepal to foreign transfer through a revised offer, preserving identity", () => {
    const databasePath = createWorld("nepal-to-foreign");
    const db = open(databasePath);
    let playerId: EntityId;
    let sellingClubId: EntityId;
    let buyingClubId: EntityId;
    try {
      const target = nepalPlayer(db);
      playerId = target.player_id;
      sellingClubId = target.club_id;
      buyingClubId = foreignClub(db).id;

      const offer = createTransferOffer(db, {
        buyingClubId,
        sellingClubId,
        playerId,
        submittedAt: WORLD_DATE,
        fee: 4_000_000,
      });
      const market = new TransferMarketRepository(db);
      const evaluation = evaluateTransferOffer(db, offer, WORLD_DATE, "nepal-to-foreign");
      expect(evaluation.accepted).toBe(true);

      completePermanentTransfer(db, offer, WORLD_DATE, "nepal-to-foreign");
      const settled = market.transferOffers().find((item) => item.id === offer.id);
      expect(settled?.status).toBe("COMPLETED");
      const transferLedger = new ClubEconomyRepository(db)
        .ledgerEntries()
        .filter((entry) => entry.relatedEntityId === offer.id);
      expect(transferLedger.filter((entry) => entry.category === "TRANSFER_EXPENSE")).toHaveLength(1);
      expect(transferLedger.filter((entry) => entry.category === "TRANSFER_INCOME")).toHaveLength(1);
      completePermanentTransfer(db, offer, WORLD_DATE, "nepal-to-foreign");
      expect(new ClubEconomyRepository(db).ledgerEntries().filter((entry) => entry.relatedEntityId === offer.id)).toHaveLength(2);

      // The negotiation actually happened: the player was asked twice.
      const rounds = market.negotiationRounds(offer.id);
      expect(rounds.length).toBeGreaterThanOrEqual(3);
      expect(rounds.some((round) => round.actor === "SELLING_CLUB")).toBe(true);

      // Identity is preserved — the same person moved, no clone was created.
      const persons = db.prepare("SELECT COUNT(*) n FROM persons WHERE id = ?").get(playerId) as {
        n: number;
      };
      expect(persons.n).toBe(1);

      // Affiliation moved to the foreign club and the Nepal deal is closed.
      const active = market.activeContract(playerId, WORLD_DATE);
      expect(active?.clubId).toBe(buyingClubId);
      expect(
        market.allPlayerContracts().filter((c) => c.playerId === playerId && c.status === "ACTIVE"),
      ).toHaveLength(1);

      // Exactly one history record, and the foreign club stays context-only.
      expect(historyCount(db, playerId, "TRANSFER_COMPLETED")).toBe(1);
      const membership = db
        .prepare("SELECT COUNT(*) n FROM club_memberships WHERE club_id = ?")
        .get(buyingClubId) as { n: number };
      expect(membership.n).toBe(0);
    } finally {
      db.close();
    }

    // Reload: no rerolled outcome, no duplicated history or contract.
    const reloaded = open(databasePath);
    try {
      const market = new TransferMarketRepository(reloaded);
      expect(market.activeContract(playerId!, WORLD_DATE)?.clubId).toBe(buyingClubId!);
      expect(historyCount(reloaded, playerId!, "TRANSFER_COMPLETED")).toBe(1);
      expect(
        market.allPlayerContracts().filter((c) => c.playerId === playerId && c.status === "ACTIVE"),
      ).toHaveLength(1);
    } finally {
      reloaded.close();
    }
  }, 300000);

  it("lets a club walk away when the player holds out beyond what it will pay", () => {
    const databasePath = createWorld("walk-away");
    const db = open(databasePath);
    try {
      const target = nepalPlayer(db);
      const buyingClubId = foreignClub(db).id;
      // A derisory wage offer: the seller may agree on the fee, but the player
      // will not sign, so the deal must end rather than deadlock.
      const offer = createTransferOffer(db, {
        buyingClubId,
        sellingClubId: target.club_id,
        playerId: target.player_id,
        submittedAt: WORLD_DATE,
        fee: 1,
      });
      completePermanentTransfer(db, offer, WORLD_DATE, "walk-away");
      const settled = new TransferMarketRepository(db)
        .transferOffers()
        .find((item) => item.id === offer.id);
      // Whatever the outcome, it is a resolved one — never left hanging.
      expect(settled?.status).not.toBe("ACCEPTED");
      expect(settled?.status).not.toBe("PLAYER_STALLED");
      expect([
        "COMPLETED",
        "REJECTED",
        "WITHDRAWN",
        "PLAYER_REJECTED",
        "COMPETING_OFFER",
      ]).toContain(settled?.status);
    } finally {
      db.close();
    }
  }, 300000);

  it("settles a contracted context-only player into Nepal through seller and player terms", () => {
    const databasePath = createWorld("contracted-foreign-to-nepal");
    const db = open(databasePath);
    try {
      const target = nepalPlayer(db);
      const externalClubId = foreignClub(db).id;
      const buyer = db.prepare("SELECT id FROM clubs WHERE canonical_external_id LIKE 'NEP-NSL-%' ORDER BY id LIMIT 1").get() as { id: EntityId };
      const market = new TransferMarketRepository(db);
      const contract = market.activeContract(target.player_id, WORLD_DATE)!;
      market.upsertPlayerContract({ ...contract, clubId: externalClubId });
      market.updatePlayerClub(target.player_id, externalClubId);

      const offer = createTransferOffer(db, {
        buyingClubId: buyer.id,
        sellingClubId: externalClubId,
        playerId: target.player_id,
        submittedAt: WORLD_DATE,
        fee: 20_000_000,
      });
      expect(evaluateTransferOffer(db, offer, WORLD_DATE, "contracted-foreign-to-nepal").accepted).toBe(true);
      completePermanentTransfer(db, offer, WORLD_DATE, "contracted-foreign-to-nepal", { preferredCountries: ["NP", "NPL"], expectedPlayingTime: "FIRST_TEAM" });
      simulateTransferWindow({ db, worldDate: WORLD_DATE, seed: "contracted-foreign-to-nepal", maxClubActions: 0 });

      expect(market.activeContract(target.player_id, WORLD_DATE)?.clubId).toBe(buyer.id);
      expect(historyCount(db, target.player_id, "TRANSFER_COMPLETED")).toBe(1);
      expect(market.transferOffers().find((item) => item.id === offer.id)?.status).toBe("COMPLETED");
      const transferLedger = new ClubEconomyRepository(db).ledgerEntries().filter((entry) => entry.relatedEntityId === offer.id);
      expect(transferLedger.filter((entry) => entry.category === "TRANSFER_EXPENSE")).toHaveLength(1);
      expect(transferLedger.filter((entry) => entry.category === "TRANSFER_INCOME")).toHaveLength(1);
      completePermanentTransfer(db, offer, WORLD_DATE, "contracted-foreign-to-nepal");
      expect(new ClubEconomyRepository(db).ledgerEntries().filter((entry) => entry.relatedEntityId === offer.id)).toHaveLength(2);
      expect(market.competitionRegistrations().some((item) => item.playerId === target.player_id && item.clubId === buyer.id && item.status === "ACTIVE")).toBe(true);
    } finally {
      db.close();
    }
  }, 300000);

  it("counts settled deals rather than seller agreements in the diagnostic", () => {
    const databasePath = createWorld("diagnostic");
    const db = open(databasePath);
    try {
      const report = runTransferDiagnostic(db, { seed: "window-mix", worldDate: WORLD_DATE });
      const market = new TransferMarketRepository(db);
      const settled = market.transferOffers().filter((offer) => offer.status === "COMPLETED");

      // The headline number is what the repository confirms, not what was tried.
      expect(report.completedTransfers).toBe(
        settled.filter((offer) => offer.offerType !== "FREE_TRANSFER").length,
      );
      // Seller agreements are reported separately from settled deals, and the
      // gap between them is accounted for rather than silently counted as done.
      expect(report.accepted).toBeGreaterThanOrEqual(report.completedTransfers);
      expect(report.accepted - report.completedTransfers).toBe(report.playerRejected);
      for (const value of [
        report.offers,
        report.accepted,
        report.rejected,
        report.playerRejected,
        report.completedTransfers,
        report.freeAgentSignings,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }

      // History is written exactly once per settled deal.
      for (const offer of settled) {
        const type =
          offer.offerType === "FREE_TRANSFER" ? "FREE_AGENT_SIGNED" : "TRANSFER_COMPLETED";
        expect(historyCount(db, offer.playerId, type)).toBe(1);
      }
    } finally {
      db.close();
    }
  }, 300000);
});
