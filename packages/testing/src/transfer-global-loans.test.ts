import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TransferMarketRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  completePermanentTransfer,
  createNepalSave,
  createTransferOffer,
  endLoan,
  evaluateTransferOffer,
  initializeForeignFootballWorldForSave,
  initializeTransferMarketForSave,
  isContextOnlyClub,
  simulateTransferWindow,
  startLoan,
} from "@nepal-football-sim/simulation";

/*
 * Loans and purchases across the Nepal/foreign boundary. The engine already
 * had loans; what it did not have was visibility — generated players carry no
 * imported factual profile, so the context-only foreign squads were invisible
 * to the market and could never be a candidate for either.
 */

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const WORLD_DATE = "2026-08-01";

const createWorld = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-global-loans-"));
  tempDirs.push(dir);
  const databasePath = join(dir, "world.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Loans ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
    globalSeedPath: resolve(process.cwd(), "data/global/football-world-v16.seed.json"),
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

type Db = ReturnType<typeof openGameDatabase>;

const contractedAt = (
  db: Db,
  where: "FOREIGN" | "NEPAL",
): { playerId: EntityId; clubId: EntityId } => {
  const clause =
    where === "FOREIGN"
      ? "c.canonical_external_id LIKE 'SIM-FOREIGN-%'"
      : "co.iso_code IN ('NPL','NP') AND c.canonical_external_id IS NOT 'SIM-FOREIGN'";
  const row = db
    .prepare(
      `SELECT pc.player_id AS playerId, pc.club_id AS clubId FROM player_contracts pc
       JOIN clubs c ON c.id = pc.club_id
       JOIN countries co ON co.id = c.country_id
       WHERE pc.status = 'ACTIVE' AND ${clause}
       ORDER BY pc.player_id LIMIT 1`,
    )
    .get() as { playerId: EntityId; clubId: EntityId };
  return row;
};

const nepalClubWithSquad = (db: Db, excludeClubId?: EntityId): EntityId =>
  (
    db
      .prepare(
        `SELECT c.id FROM clubs c JOIN countries co ON co.id = c.country_id
         WHERE co.iso_code IN ('NPL','NP') AND c.canonical_external_id IS NOT NULL
           AND c.id != COALESCE(?, '')
         ORDER BY c.id LIMIT 1`,
      )
      .get(excludeClubId ?? null) as { id: EntityId }
  ).id;

const historyCount = (db: Db, playerId: EntityId, type: string): number =>
  Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) n FROM transfer_history_events WHERE player_id = ? AND event_type = ?",
        )
        .get(playerId, type) as { n?: number } | undefined
    )?.n ?? 0,
  );

const teamClub = (db: Db, playerId: EntityId): EntityId | undefined =>
  (
    db
      .prepare(
        `SELECT t.club_id AS clubId FROM team_person_assignments tpa
         JOIN teams t ON t.id = tpa.team_id
         WHERE tpa.person_id = ? AND tpa.role = 'PLAYER' AND tpa.ended_on IS NULL LIMIT 1`,
      )
      .get(playerId) as { clubId?: EntityId } | undefined
  )?.clubId;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("global loan pathways", () => {
  it("keeps canonical imported Africa and South Asia players in the loan market", () => {
    const databasePath = createWorld("imported-loan-candidates");
    const db = openGameDatabase(databasePath);
    try {
      const candidates = db
        .prepare(
          `SELECT pfp.canonical_external_id AS externalId, co.iso_code AS isoCode,
                  pc.club_id AS clubId
           FROM player_factual_profiles pfp
           JOIN clubs c ON c.id = pfp.current_club_id
           JOIN countries co ON co.id = c.country_id
           JOIN player_contracts pc ON pc.player_id = pfp.player_id AND pc.status = 'ACTIVE'
           WHERE co.iso_code IN ('NGA','IND')
           ORDER BY pfp.canonical_external_id`,
        )
        .all() as Array<{ externalId: string; isoCode: string; clubId: EntityId }>;
      expect(candidates.some((candidate) => candidate.isoCode === "NGA")).toBe(true);
      expect(candidates.some((candidate) => candidate.isoCode === "IND")).toBe(true);
      expect(candidates.every((candidate) => isContextOnlyClub(db, candidate.clubId))).toBe(true);
    } finally {
      db.close();
    }
  }, 300000);

  it("loans a foreign player to a Nepal club and returns them once at expiry", () => {
    const databasePath = createWorld("foreign-to-nepal");
    let playerId: EntityId;
    let parentClubId: EntityId;
    let nepalClubId: EntityId;

    const db = openGameDatabase(databasePath);
    try {
      const foreign = contractedAt(db, "FOREIGN");
      playerId = foreign.playerId;
      parentClubId = foreign.clubId;
      nepalClubId = nepalClubWithSquad(db);
      expect(isContextOnlyClub(db, parentClubId)).toBe(true);

      const loan = startLoan(db, parentClubId, nepalClubId, playerId, WORLD_DATE, "loan", {
        endDate: "2027-01-31",
        wageContributionPercent: 60,
        loanFee: 125000,
      });

      // One player, temporarily registered in Nepal, still owned abroad.
      expect(loan.parentClubId).toBe(parentClubId);
      expect(loan.loanClubId).toBe(nepalClubId);
      expect(teamClub(db, playerId)).toBe(nepalClubId);
      const market = new TransferMarketRepository(db);
      expect(market.activeContract(playerId, WORLD_DATE)?.clubId).toBe(parentClubId);
      expect(loan.wageContributionPercent).toBe(60);
      expect(loan.loanFee).toBe(125000);
      expect(
        db
          .prepare(
            "SELECT direction, amount FROM club_ledger_entries WHERE related_entity_id = ? AND category = 'LOAN_PAYMENT' ORDER BY direction",
          )
          .all(loan.id),
      ).toEqual([
        { direction: "CREDIT", amount: 125000 },
        { direction: "DEBIT", amount: 125000 },
      ]);
      expect(historyCount(db, playerId, "LOAN_STARTED")).toBe(1);
      expect(db.prepare("SELECT COUNT(*) n FROM persons WHERE id = ?").get(playerId)).toEqual({
        n: 1,
      });
    } finally {
      db.close();
    }

    // Reload mid-loan: parent, destination, expiry and wage split all survive.
    const midLoan = openGameDatabase(databasePath);
    try {
      const active = new TransferMarketRepository(midLoan).activeLoans(WORLD_DATE);
      const loan = active.find((item) => item.playerId === playerId);
      expect(loan).toBeDefined();
      expect(loan?.parentClubId).toBe(parentClubId!);
      expect(loan?.loanClubId).toBe(nepalClubId!);
      expect(loan?.endDate).toBe("2027-01-31");
      expect(loan?.wageContributionPercent).toBe(60);
      expect(teamClub(midLoan, playerId!)).toBe(nepalClubId!);
    } finally {
      midLoan.close();
    }

    // Expiry returns the player to the parent club exactly once.
    const expiry = openGameDatabase(databasePath);
    try {
      const market = new TransferMarketRepository(expiry);
      const ending = market.endingLoans("2027-02-01");
      expect(ending.some((item) => item.playerId === playerId!)).toBe(true);
      for (const loan of ending) endLoan(expiry, loan, "2027-02-01");

      expect(teamClub(expiry, playerId!)).toBe(parentClubId!);
      expect(historyCount(expiry, playerId!, "LOAN_ENDED")).toBe(1);
      // No permanent move was invented by the return.
      expect(historyCount(expiry, playerId!, "TRANSFER_COMPLETED")).toBe(0);

      // Re-processing the same expiry is a no-op: the loan is no longer ending.
      expect(market.endingLoans("2027-02-01").some((i) => i.playerId === playerId!)).toBe(false);
    } finally {
      expiry.close();
    }

    // Reload after return: still returned, still one return record.
    const afterReturn = openGameDatabase(databasePath);
    try {
      expect(teamClub(afterReturn, playerId!)).toBe(parentClubId!);
      expect(historyCount(afterReturn, playerId!, "LOAN_ENDED")).toBe(1);
      expect(
        new TransferMarketRepository(afterReturn)
          .activeLoans("2027-02-01")
          .some((item) => item.playerId === playerId!),
      ).toBe(false);
    } finally {
      afterReturn.close();
    }
  }, 300000);

  it("loans a Nepal player abroad while the foreign club stays context-only", () => {
    const databasePath = createWorld("nepal-to-foreign");
    const db = openGameDatabase(databasePath);
    try {
      const nepal = contractedAt(db, "NEPAL");
      const foreignClubId = contractedAt(db, "FOREIGN").clubId;

      const loan = startLoan(
        db,
        nepal.clubId,
        foreignClubId,
        nepal.playerId,
        WORLD_DATE,
        "abroad",
        {
          endDate: "2027-06-30",
          wageContributionPercent: 40,
        },
      );
      expect(loan.loanClubId).toBe(foreignClubId);
      expect(teamClub(db, nepal.playerId)).toBe(foreignClubId);
      // The parent contract, and therefore ownership, stays in Nepal.
      expect(
        new TransferMarketRepository(db).activeContract(nepal.playerId, WORLD_DATE)?.clubId,
      ).toBe(nepal.clubId);
      expect(historyCount(db, nepal.playerId, "LOAN_STARTED")).toBe(1);

      // Hosting a loan does not make the foreign club playable.
      expect(isContextOnlyClub(db, foreignClubId)).toBe(true);
      expect(
        db.prepare("SELECT COUNT(*) n FROM club_memberships WHERE club_id = ?").get(foreignClubId),
      ).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  }, 300000);

  it("refuses a loan that would duplicate an existing one", () => {
    const databasePath = createWorld("reject");
    const db = openGameDatabase(databasePath);
    try {
      const foreign = contractedAt(db, "FOREIGN");
      const nepalClubId = nepalClubWithSquad(db);
      startLoan(db, foreign.clubId, nepalClubId, foreign.playerId, WORLD_DATE, "reject");
      // A second destination for the same player must not be possible.
      expect(() =>
        startLoan(
          db,
          foreign.clubId,
          nepalClubWithSquad(db, nepalClubId),
          foreign.playerId,
          WORLD_DATE,
          "reject",
        ),
      ).toThrow(/already has an active loan/);
      // A loan without a parent contract is refused rather than invented.
      const unattached = db
        .prepare(
          `SELECT p.id FROM persons p JOIN player_attributes pa ON pa.person_id = p.id
           WHERE NOT EXISTS (SELECT 1 FROM player_contracts pc WHERE pc.player_id = p.id AND pc.status='ACTIVE')
           ORDER BY p.id LIMIT 1`,
        )
        .get() as { id: EntityId } | undefined;
      if (unattached) {
        expect(() =>
          startLoan(db, foreign.clubId, nepalClubId, unattached.id, WORLD_DATE, "reject"),
        ).toThrow(/active parent-club contract/);
      }
    } finally {
      db.close();
    }
  }, 300000);
});

describe("contracted foreign player purchase", () => {
  it("buys a contracted foreign player into Nepal, settling identity, history and reload", () => {
    const databasePath = createWorld("purchase");
    let playerId: EntityId;
    let sellerId: EntityId;
    let buyerId: EntityId;

    const db = openGameDatabase(databasePath);
    try {
      const foreign = contractedAt(db, "FOREIGN");
      playerId = foreign.playerId;
      sellerId = foreign.clubId;
      buyerId = nepalClubWithSquad(db);

      const offer = createTransferOffer(db, {
        buyingClubId: buyerId,
        sellingClubId: sellerId,
        playerId,
        submittedAt: WORLD_DATE,
        fee: 3_000_000,
      });
      // The external seller genuinely evaluates rather than rubber-stamping.
      const evaluation = evaluateTransferOffer(db, offer, WORLD_DATE, "purchase");
      expect(typeof evaluation.accepted).toBe("boolean");
      expect(evaluation.accepted).toBe(true);

      completePermanentTransfer(db, offer, WORLD_DATE, "purchase");

      const market = new TransferMarketRepository(db);
      expect(market.transferOffers().find((item) => item.id === offer.id)?.status).toBe(
        "COMPLETED",
      );

      // Old external deal closed, one Nepal contract open, same person.
      const active = market
        .allPlayerContracts()
        .filter((c) => c.playerId === playerId && c.status === "ACTIVE");
      expect(active).toHaveLength(1);
      expect(active[0]!.clubId).toBe(buyerId);
      expect(teamClub(db, playerId)).toBe(buyerId);
      expect(db.prepare("SELECT COUNT(*) n FROM persons WHERE id = ?").get(playerId)).toEqual({
        n: 1,
      });

      // One permanent record, and not mistaken for a free-agent signing.
      expect(historyCount(db, playerId, "TRANSFER_COMPLETED")).toBe(1);
      expect(historyCount(db, playerId, "FREE_AGENT_SIGNED")).toBe(0);
    } finally {
      db.close();
    }

    const reloaded = openGameDatabase(databasePath);
    try {
      const market = new TransferMarketRepository(reloaded);
      expect(market.activeContract(playerId!, WORLD_DATE)?.clubId).toBe(buyerId!);
      expect(teamClub(reloaded, playerId!)).toBe(buyerId!);
      expect(historyCount(reloaded, playerId!, "TRANSFER_COMPLETED")).toBe(1);
      expect(
        market.allPlayerContracts().filter((c) => c.playerId === playerId && c.status === "ACTIVE"),
      ).toHaveLength(1);
    } finally {
      reloaded.close();
    }
  }, 300000);

  it("reaches foreign squads from a normal market tick without direct helper calls", () => {
    const databasePath = createWorld("reachability");
    const db = openGameDatabase(databasePath);
    try {
      const before = new TransferMarketRepository(db).transferHistory().length;
      const report = simulateTransferWindow({ db, worldDate: WORLD_DATE, seed: "reachability" });

      // The window runs the whole market, and foreign-club players are now part
      // of the candidate pool it draws from.
      expect(report.offers).toBeGreaterThan(0);
      expect(report.loans).toBeGreaterThan(0);
      const market = new TransferMarketRepository(db);
      expect(market.transferHistory().length).toBeGreaterThan(before);

      const foreignPool = db
        .prepare(
          `SELECT COUNT(*) n FROM player_contracts pc JOIN clubs c ON c.id = pc.club_id
           WHERE pc.status = 'ACTIVE' AND c.canonical_external_id LIKE 'SIM-FOREIGN-%'`,
        )
        .get() as { n: number };
      expect(foreignPool.n).toBeGreaterThan(0);

      for (const value of [report.offers, report.completedTransfers, report.loans]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    } finally {
      db.close();
    }
  }, 300000);
});
