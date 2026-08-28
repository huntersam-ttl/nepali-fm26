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
  analyzeSquadNeeds,
  createNepalSave,
  initializeClubEconomyForSave,
  initializeForeignFootballWorldForSave,
  initializeTransferMarketForSave,
  positionGroupForPlayer,
  processClubEconomyMonth,
  runClubAiSeasonPlanning,
  startLoan,
} from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const WORLD_DATE = "2026-08-01";
const PLANNING_DATE = "2026-08-28";
const FOREIGN_CLUB = "SIM-FOREIGN-IN";

type Db = ReturnType<typeof openGameDatabase>;
type LoanScenario = {
  databasePath: string;
  parentClubId: EntityId;
  loanClubId: EntityId;
  playerId: EntityId;
  loanId: EntityId;
  positionGroup: string;
  endDate: string;
};

const createWorld = (seed: string): string => {
  const directory = mkdtempSync(join(tmpdir(), "nepal-football-ai-loan-recall-"));
  tempDirs.push(directory);
  const databasePath = join(directory, "world.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `AI loan recall ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
    globalSeedPath: null,
  });
  const db = openGameDatabase(databasePath);
  try {
    initializeTransferMarketForSave({ db, worldDate: WORLD_DATE, seed });
    initializeForeignFootballWorldForSave({ db, worldDate: WORLD_DATE, seed });
    initializeClubEconomyForSave({ db, worldDate: WORLD_DATE, seed });
  } finally {
    db.close();
  }
  return databasePath;
};

const positionMinimum = (positionGroup: string): number =>
  ({ GOALKEEPER: 2, DEFENDER: 7, MIDFIELDER: 6, FORWARD: 4 })[positionGroup] ?? 0;

const candidateLoan = (db: Db, requireHealthyAfterLoan: boolean): {
  parentClubId: EntityId;
  loanClubId: EntityId;
  playerId: EntityId;
  positionGroup: string;
  endDate: string;
} => {
  const market = new TransferMarketRepository(db);
  const clubs = db
    .prepare(
      `SELECT c.id
       FROM clubs c
       JOIN countries co ON co.id = c.country_id
       WHERE co.iso_code IN ('NP', 'NPL')
         AND c.canonical_external_id NOT LIKE 'SIM-FOREIGN-%'
       ORDER BY c.id`,
    )
    .all() as Array<{ id: EntityId }>;
  const loanClubId = (
    db.prepare("SELECT id FROM clubs WHERE canonical_external_id = ?").get(FOREIGN_CLUB) as {
      id: EntityId;
    }
  ).id;

  for (const club of clubs) {
    const contracts = market
      .activeContractsForClub(club.id, WORLD_DATE)
      .filter((contract) => contract.endDate > PLANNING_DATE);
    const counts = new Map<string, number>();
    const groups = new Map<EntityId, string>();
    for (const contract of contracts) {
      const group = positionGroupForPlayer(db, contract.playerId);
      if (!group) continue;
      groups.set(contract.playerId, group);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    for (const contract of contracts) {
      const group = groups.get(contract.playerId);
      if (!group) continue;
      const countAfterLoan = (counts.get(group) ?? 0) - 1;
      if (requireHealthyAfterLoan && countAfterLoan < positionMinimum(group)) continue;
      return {
        parentClubId: club.id,
        loanClubId,
        playerId: contract.playerId,
        positionGroup: group,
        endDate: contract.endDate,
      };
    }
  }
  throw new Error(
    requireHealthyAfterLoan
      ? "Expected a Nepal squad with healthy depth after one outbound loan"
      : "Expected a Nepal loan candidate with a current parent contract",
  );
};

const createLoanScenario = (
  seed: string,
  options: { recallAllowed: boolean; healthyAfterLoan: boolean },
): LoanScenario => {
  const databasePath = createWorld(seed);
  const db = openGameDatabase(databasePath);
  try {
    const candidate = candidateLoan(db, options.healthyAfterLoan);
    const loan = startLoan(
      db,
      candidate.parentClubId,
      candidate.loanClubId,
      candidate.playerId,
      WORLD_DATE,
      seed,
      {
        endDate: candidate.endDate,
        wageContributionPercent: 60,
        recallAllowed: options.recallAllowed,
      },
    );
    return { databasePath, ...candidate, loanId: loan.id };
  } finally {
    db.close();
  }
};

const inducePositionShortage = (db: Db, scenario: LoanScenario): void => {
  const market = new TransferMarketRepository(db);
  for (const contract of market.activeContractsForClub(scenario.parentClubId, PLANNING_DATE)) {
    if (contract.playerId === scenario.playerId) continue;
    if (positionGroupForPlayer(db, contract.playerId) === scenario.positionGroup) {
      market.markContractStatus(contract.id, "TERMINATED");
    }
  }
  const need = analyzeSquadNeeds(db, scenario.parentClubId, PLANNING_DATE).needs.find(
    (item) => item.positionGroup === scenario.positionGroup,
  );
  expect(need?.severity).toBe("HIGH");
};

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

const loanFinanceEntries = (db: Db, loanId: EntityId): unknown[] =>
  db
    .prepare(
      "SELECT id FROM club_ledger_entries WHERE related_entity_id = ? AND category IN ('PLAYER_WAGES', 'LOAN_PAYMENT')",
    )
    .all(loanId);

const planningDecision = (db: Db, clubId: EntityId) =>
  new ClubEconomyRepository(db)
    .aiDecisions(clubId)
    .find((decision) => decision.date === PLANNING_DATE)!;

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("bounded AI loan recall", () => {
  it(
    "recalls an outbound Nepal loan for a high-severity squad shortage and persists the terminal state",
    () => {
      const scenario = createLoanScenario("ai-recall-shortage", {
        recallAllowed: true,
        healthyAfterLoan: false,
      });
      const db = openGameDatabase(scenario.databasePath);
      try {
        inducePositionShortage(db, scenario);
        const decisions = runClubAiSeasonPlanning(db, {
          date: PLANNING_DATE,
          seed: "ai-recall-shortage",
        });
        const decision = planningDecision(db, scenario.parentClubId);
        const loan = new TransferMarketRepository(db).loan(scenario.loanId)!;

        expect(decisions.some((item) => item.clubId === scenario.parentClubId)).toBe(true);
        expect(decision.actions).toContain("RECALL_ON_LOAN_FOR_SQUAD_EMERGENCY");
        expect(decision.context).toMatchObject({
          activeLoansConsidered: 1,
          recallEligible: 1,
          recallRejectedByAgreementOrDate: 0,
          squadNeedCandidates: 1,
          recallsRequested: 1,
          recallsCompleted: 1,
        });
        expect(loan.status).toBe("ENDED");
        expect(teamClub(db, scenario.playerId)).toBe(scenario.parentClubId);
        expect(new TransferMarketRepository(db).activeLoansForParent(scenario.parentClubId, PLANNING_DATE)).toHaveLength(0);
        expect(historyCount(db, scenario.playerId, "LOAN_ENDED")).toBe(1);

        processClubEconomyMonth(db, { date: "2026-09-28", seed: "ai-recall-payroll" });
        expect(loanFinanceEntries(db, scenario.loanId)).toHaveLength(0);
      } finally {
        db.close();
      }

      const reloaded = openGameDatabase(scenario.databasePath);
      try {
        expect(new TransferMarketRepository(reloaded).loan(scenario.loanId)?.status).toBe("ENDED");
        expect(teamClub(reloaded, scenario.playerId)).toBe(scenario.parentClubId);
        expect(historyCount(reloaded, scenario.playerId, "LOAN_ENDED")).toBe(1);
        runClubAiSeasonPlanning(reloaded, { date: "2027-08-28", seed: "ai-recall-reload" });
        expect(historyCount(reloaded, scenario.playerId, "LOAN_ENDED")).toBe(1);
        expect(new TransferMarketRepository(reloaded).activeLoansForParent(scenario.parentClubId, "2027-08-28")).toHaveLength(0);
      } finally {
        reloaded.close();
      }
    },
    300000,
  );

  it("does not recall when the parent remains healthy after an outbound loan", () => {
    const scenario = createLoanScenario("ai-recall-healthy", {
      recallAllowed: true,
      healthyAfterLoan: true,
    });
    const db = openGameDatabase(scenario.databasePath);
    try {
      runClubAiSeasonPlanning(db, { date: PLANNING_DATE, seed: "ai-recall-healthy" });
      const decision = planningDecision(db, scenario.parentClubId);
      const loan = new TransferMarketRepository(db).loan(scenario.loanId)!;

      expect(loan.status).toBe("ACTIVE");
      expect(decision.actions).toContain("REVIEW_ACTIVE_LOAN_RECALLS");
      expect(decision.actions).not.toContain("RECALL_ON_LOAN_FOR_SQUAD_EMERGENCY");
      expect(decision.context).toMatchObject({
        activeLoansConsidered: 1,
        recallEligible: 1,
        squadNeedCandidates: 0,
        recallsRequested: 0,
        recallsCompleted: 0,
      });
    } finally {
      db.close();
    }
  }, 300000);

  it("keeps a non-recallable loan active when a high-severity shortage exists", () => {
    const scenario = createLoanScenario("ai-recall-forbidden", {
      recallAllowed: false,
      healthyAfterLoan: false,
    });
    const db = openGameDatabase(scenario.databasePath);
    try {
      inducePositionShortage(db, scenario);
      runClubAiSeasonPlanning(db, { date: PLANNING_DATE, seed: "ai-recall-forbidden" });
      const decision = planningDecision(db, scenario.parentClubId);
      const loan = new TransferMarketRepository(db).loan(scenario.loanId)!;

      expect(loan.status).toBe("ACTIVE");
      expect(teamClub(db, scenario.playerId)).toBe(scenario.loanClubId);
      expect(historyCount(db, scenario.playerId, "LOAN_ENDED")).toBe(0);
      expect(decision.actions).toContain("REVIEW_ACTIVE_LOAN_RECALLS");
      expect(decision.actions).not.toContain("RECALL_ON_LOAN_FOR_SQUAD_EMERGENCY");
      expect(decision.context).toMatchObject({
        activeLoansConsidered: 1,
        recallEligible: 0,
        recallRejectedByAgreementOrDate: 1,
        squadNeedCandidates: 0,
        recallsRequested: 0,
        recallsCompleted: 0,
      });
    } finally {
      db.close();
    }
  }, 300000);
});
