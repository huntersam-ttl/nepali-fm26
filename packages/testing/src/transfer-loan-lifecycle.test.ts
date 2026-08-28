import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  TransferMarketRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  createNepalSave,
  endLoan,
  exerciseLoanOption,
  initializeClubEconomyForSave,
  initializeForeignFootballWorldForSave,
  recallLoan,
  startLoan,
  processClubEconomyMonth,
} from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const globalSeedPath = resolve(process.cwd(), "data/global/football-world-v16.seed.json");
const WORLD_DATE = "2026-08-01";

type Db = ReturnType<typeof openGameDatabase>;

const createWorld = (seed: string): string => {
  const directory = mkdtempSync(join(tmpdir(), "nepal-football-loan-lifecycle-"));
  tempDirs.push(directory);
  const databasePath = join(directory, "world.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Loan lifecycle ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
    globalSeedPath,
  });
  const db = openGameDatabase(databasePath);
  try {
    initializeForeignFootballWorldForSave({ db, worldDate: WORLD_DATE, seed });
    initializeClubEconomyForSave({ db, worldDate: WORLD_DATE, seed });
  } finally {
    db.close();
  }
  return databasePath;
};

const foreignContract = (db: Db, excludedPlayerId?: EntityId) =>
  db
    .prepare(
      `SELECT pc.player_id AS playerId, pc.club_id AS clubId
       FROM player_contracts pc
       JOIN clubs c ON c.id = pc.club_id
       WHERE pc.status = 'ACTIVE'
         AND c.canonical_external_id LIKE 'SIM-FOREIGN-%'
         AND pc.player_id != COALESCE(?, '')
       ORDER BY pc.player_id LIMIT 1`,
    )
    .get(excludedPlayerId ?? null) as { playerId: EntityId; clubId: EntityId };

const nepalClubWithCompetition = (db: Db, excludedClubId?: EntityId): EntityId =>
  (
    db
      .prepare(
        `SELECT c.id
         FROM clubs c
         JOIN countries co ON co.id = c.country_id
         WHERE co.iso_code IN ('NP','NPL')
           AND c.id != COALESCE(?, '')
           AND EXISTS (
             SELECT 1
             FROM club_memberships cm
             JOIN competition_seasons cs ON cs.id = cm.competition_season_id
             WHERE cm.club_id = c.id AND cm.status = 'ACTIVE'
               AND cs.start_date <= ? AND cs.end_date >= ?
           )
         ORDER BY c.id LIMIT 1`,
      )
      .get(excludedClubId ?? null, WORLD_DATE, WORLD_DATE) as { id: EntityId }
  ).id;

const teamClub = (db: Db, playerId: EntityId): EntityId | undefined =>
  (
    db
      .prepare(
        `SELECT t.club_id AS clubId
         FROM team_person_assignments tpa
         JOIN teams t ON t.id = tpa.team_id
         WHERE tpa.person_id = ? AND tpa.role = 'PLAYER' AND tpa.ended_on IS NULL
         LIMIT 1`,
      )
      .get(playerId) as { clubId?: EntityId } | undefined
  )?.clubId;

const historyCount = (db: Db, playerId: EntityId, eventType: string): number =>
  Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM transfer_history_events WHERE player_id = ? AND event_type = ?",
        )
        .get(playerId, eventType) as { count?: number } | undefined
    )?.count ?? 0,
  );

const loanWages = (db: Db, loanId: EntityId) =>
  db
    .prepare(
      `SELECT entry_date AS date, club_id AS clubId, amount
       FROM club_ledger_entries
       WHERE related_entity_id = ? AND category = 'PLAYER_WAGES'
       ORDER BY entry_date, club_id`,
    )
    .all(loanId) as Array<{ date: string; clubId: EntityId; amount: number }>;

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("loan lifecycle closure", () => {
  it("settles parent and destination wages once per payroll period, separately from the loan fee", () => {
    const databasePath = createWorld("loan-wages");
    const db = openGameDatabase(databasePath);
    try {
      const foreign = foreignContract(db);
      const destination = nepalClubWithCompetition(db);
      const loan = startLoan(db, foreign.clubId, destination, foreign.playerId, WORLD_DATE, "wages", {
        endDate: "2027-01-31",
        wageContributionPercent: 60,
        loanFee: 125000,
      });
      const contract = new TransferMarketRepository(db).activeContract(foreign.playerId, WORLD_DATE)!;
      const total = Math.round(contract.salary / 12);
      const destinationShare = Math.round((total * 60) / 100);
      const parentShare = total - destinationShare;

      processClubEconomyMonth(db, { date: "2026-09-28", seed: "wages" });
      processClubEconomyMonth(db, { date: "2026-09-28", seed: "wages-repeat" });
      let entries = loanWages(db, loan.id);
      expect(entries).toHaveLength(2);
      expect(entries.map((entry) => entry.amount).sort((a, b) => a - b)).toEqual(
        [parentShare, destinationShare].sort((a, b) => a - b),
      );
      expect(entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(total);

      processClubEconomyMonth(db, { date: "2026-10-28", seed: "wages-next" });
      entries = loanWages(db, loan.id);
      expect(entries).toHaveLength(4);
      expect(new Set(entries.map((entry) => entry.date))).toEqual(
        new Set(["2026-09-28", "2026-10-28"]),
      );
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM club_ledger_entries WHERE related_entity_id = ? AND category = 'LOAN_PAYMENT'",
          )
          .get(loan.id),
      ).toEqual({ count: 2 });
      expect(new ClubEconomyRepository(db).ledgerEntries().filter((entry) => entry.relatedEntityId === loan.id && entry.category === "LOAN_PAYMENT")).toHaveLength(2);
    } finally {
      db.close();
    }
  }, 300000);

  it("recalls only through the parent, closes registration, persists, and stops future loan wages", () => {
    const databasePath = createWorld("loan-recall");
    let playerId: EntityId;
    let parentClubId: EntityId;
    let destinationClubId: EntityId;
    let loanId: EntityId;
    const db = openGameDatabase(databasePath);
    try {
      const foreign = foreignContract(db);
      playerId = foreign.playerId;
      parentClubId = foreign.clubId;
      destinationClubId = nepalClubWithCompetition(db);
      const loan = startLoan(db, parentClubId, destinationClubId, playerId, WORLD_DATE, "recall", {
        endDate: "2027-06-30",
        wageContributionPercent: 40,
        recallAllowed: true,
      });
      loanId = loan.id;
      processClubEconomyMonth(db, { date: "2026-09-28", seed: "recall-before" });
      expect(() => recallLoan(db, { loanId, parentClubId: destinationClubId, worldDate: "2026-10-01" })).toThrow(/parent club/);
      expect(() => recallLoan(db, { loanId, parentClubId, worldDate: "2026-07-31" })).toThrow(/too early/);

      const recalled = recallLoan(db, { loanId, parentClubId, worldDate: "2026-10-15" });
      expect(recalled.status).toBe("ENDED");
      expect(teamClub(db, playerId)).toBe(parentClubId);
      expect(new TransferMarketRepository(db).activeLoans("2026-10-15")).toHaveLength(0);
      expect(historyCount(db, playerId, "LOAN_ENDED")).toBe(1);
      expect(
        db
          .prepare(
            "SELECT status, registered_until FROM competition_registrations WHERE player_id = ? AND registration_type = 'LOAN'",
          )
          .get(playerId),
      ).toEqual({ status: "EXPIRED", registered_until: "2026-10-15" });
      const wagesBefore = loanWages(db, loanId).length;
      processClubEconomyMonth(db, { date: "2026-11-28", seed: "recall-after" });
      expect(loanWages(db, loanId)).toHaveLength(wagesBefore);
      expect(() => recallLoan(db, { loanId, parentClubId, worldDate: "2026-11-28" })).toThrow(/no longer active/);
      endLoan(db, loan, "2027-07-01");
      expect(historyCount(db, playerId, "LOAN_ENDED")).toBe(1);
    } finally {
      db.close();
    }
    const reloaded = openGameDatabase(databasePath);
    try {
      expect(teamClub(reloaded, playerId!)).toBe(parentClubId!);
      expect(new TransferMarketRepository(reloaded).loan(loanId!)?.status).toBe("ENDED");
      expect(historyCount(reloaded, playerId!, "LOAN_ENDED")).toBe(1);
    } finally {
      reloaded.close();
    }
  }, 300000);

  it("exercises an option through permanent transfer settlement and converts the registration", () => {
    const databasePath = createWorld("loan-option");
    let playerId: EntityId;
    let parentClubId: EntityId;
    let destinationClubId: EntityId;
    let loanId: EntityId;
    const db = openGameDatabase(databasePath);
    try {
      const foreign = foreignContract(db);
      playerId = foreign.playerId;
      parentClubId = foreign.clubId;
      destinationClubId = nepalClubWithCompetition(db);
      const loan = startLoan(db, parentClubId, destinationClubId, playerId, WORLD_DATE, "option", {
        endDate: "2027-06-30",
        wageContributionPercent: 50,
        loanFee: 125000,
        purchaseOption: 100000,
      });
      loanId = loan.id;
      const result = exerciseLoanOption(db, {
        loanId,
        loanClubId: destinationClubId,
        worldDate: "2026-09-15",
        seed: "option",
      });
      expect(result.completed).toBe(true);
      expect(result.offer.status).toBe("COMPLETED");
      expect(new TransferMarketRepository(db).activeLoans("2026-09-15")).toHaveLength(0);
      expect(teamClub(db, playerId)).toBe(destinationClubId);
      const activeContracts = new TransferMarketRepository(db)
        .allPlayerContracts()
        .filter((contract) => contract.playerId === playerId && contract.status === "ACTIVE");
      expect(activeContracts).toHaveLength(1);
      expect(activeContracts[0]!.clubId).toBe(destinationClubId);
      expect(historyCount(db, playerId, "TRANSFER_COMPLETED")).toBe(1);
      expect(historyCount(db, playerId, "LOAN_ENDED")).toBe(1);
      expect(historyCount(db, playerId, "FREE_AGENT_SIGNED")).toBe(0);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM club_ledger_entries WHERE related_entity_id = ? AND category = 'TRANSFER_EXPENSE'",
          )
          .get(result.offer.id),
      ).toEqual({ count: 1 });
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM club_ledger_entries WHERE related_entity_id = ? AND category = 'TRANSFER_INCOME'",
          )
          .get(result.offer.id),
      ).toEqual({ count: 1 });
      expect(
        new TransferMarketRepository(db)
          .negotiationRounds(result.offer.id)
          .some((round) => round.actor === "PLAYER" || round.actor === "PLAYER_AGENT"),
      ).toBe(true);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM competition_registrations WHERE player_id = ? AND registration_type = 'LOAN' AND status = 'ACTIVE'",
          )
          .get(playerId),
      ).toEqual({ count: 0 });
      endLoan(db, loan, "2027-07-01");
      expect(historyCount(db, playerId, "LOAN_ENDED")).toBe(1);
    } finally {
      db.close();
    }
    const reloaded = openGameDatabase(databasePath);
    try {
      const market = new TransferMarketRepository(reloaded);
      expect(market.loan(loanId!)?.status).toBe("ENDED");
      expect(market.activeContract(playerId!, "2026-09-15")?.clubId).toBe(destinationClubId!);
      expect(historyCount(reloaded, playerId!, "TRANSFER_COMPLETED")).toBe(1);
      expect(historyCount(reloaded, playerId!, "LOAN_ENDED")).toBe(1);
    } finally {
      reloaded.close();
    }
  }, 300000);

  it("rejects missing, unaffordable, and unauthorized option exercises without side effects", () => {
    const databasePath = createWorld("loan-option-rejections");
    const db = openGameDatabase(databasePath);
    try {
      const first = foreignContract(db);
      const second = foreignContract(db, first.playerId);
      const firstDestination = nepalClubWithCompetition(db);
      const secondDestination = nepalClubWithCompetition(db, firstDestination);
      const noOption = startLoan(db, first.clubId, firstDestination, first.playerId, WORLD_DATE, "no-option", {
        endDate: "2027-06-30",
      });
      const beforeOffers = new TransferMarketRepository(db).transferOffers().length;
      expect(() => exerciseLoanOption(db, { loanId: noOption.id, loanClubId: firstDestination, worldDate: "2026-09-15", seed: "no-option" })).toThrow(/no purchase option/);
      expect(new TransferMarketRepository(db).loan(noOption.id)?.status).toBe("ACTIVE");
      expect(new TransferMarketRepository(db).transferOffers()).toHaveLength(beforeOffers);

      const unaffordable = startLoan(db, second.clubId, secondDestination, second.playerId, WORLD_DATE, "unaffordable", {
        endDate: "2027-06-30",
        purchaseOption: Number.MAX_SAFE_INTEGER,
      });
      expect(() => exerciseLoanOption(db, { loanId: unaffordable.id, loanClubId: secondDestination, worldDate: "2026-09-15", seed: "unaffordable" })).toThrow(/cannot afford/);
      expect(new TransferMarketRepository(db).loan(unaffordable.id)?.status).toBe("ACTIVE");
      expect(historyCount(db, second.playerId, "TRANSFER_COMPLETED")).toBe(0);
      expect(() => exerciseLoanOption(db, { loanId: noOption.id, loanClubId: secondDestination, worldDate: "2026-09-15", seed: "wrong-club" })).toThrow(/destination club/);
      expect(historyCount(db, first.playerId, "TRANSFER_COMPLETED")).toBe(0);
    } finally {
      db.close();
    }
  }, 300000);
});
