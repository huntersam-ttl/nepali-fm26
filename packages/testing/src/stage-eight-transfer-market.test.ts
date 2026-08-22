import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TransferMarketRepository,
  WorldRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  analyzeSquadNeeds,
  createNepalSave,
  createTransferOffer,
  evaluateTransferOffer,
  initializeTransferMarketForSave,
  runTransferDiagnostic,
  searchPlayersForClub,
  simulateNepalCareer,
  startLoan,
} from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-transfers-"));
  tempDirs.push(dir);
  return join(dir, "transfers.sqlite");
};

const createSave = (seed: string): string => {
  const databasePath = tempDbPath();
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Transfers ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  const db = openGameDatabase(databasePath);
  initializeTransferMarketForSave({ db, worldDate: "2026-08-01", seed });
  db.close();
  return databasePath;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("transfer and contract market", () => {
  it("creates simulation-only starting contracts, budgets, agents, windows and registrations", () => {
    const db = openGameDatabase(createSave("starting-contracts"));
    const market = new TransferMarketRepository(db);
    const contracts = market.allPlayerContracts();
    const inspection = new WorldRepository(db).inspectWorld();

    expect(contracts.length).toBeGreaterThanOrEqual(573);
    expect(contracts.every((contract) => contract.provenance.status === "SIMULATION_ONLY")).toBe(
      true,
    );
    expect(market.transferWindows().map((window) => window.provenance.status)).toContain(
      "SIMULATION_ONLY",
    );
    expect(inspection.clubFinancialProfiles).toBeGreaterThan(0);
    expect(inspection.clubEmploymentProfiles).toBeGreaterThan(0);
    expect(inspection.agents).toBeGreaterThan(0);
    expect(inspection.agentClients).toBeGreaterThan(0);
    expect(
      market.competitionRegistrations().some((item) => item.registrationType === "TEMPORARY_NSL"),
    ).toBe(true);
    db.close();
  });

  it("runs a conservative transfer window with mixed outcomes and no hidden search leaks", () => {
    const db = openGameDatabase(createSave("window-mix"));
    const report = runTransferDiagnostic(db, { seed: "window-mix", worldDate: "2026-08-01" });
    const market = new TransferMarketRepository(db);
    const machhindra = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const search = searchPlayersForClub(db, machhindra, {}, "2026-08-01");

    expect(report.renewals).toBeGreaterThan(0);
    expect(report.releases).toBeGreaterThan(0);
    expect(report.freeAgentSignings).toBeGreaterThan(0);
    expect(report.completedTransfers).toBeGreaterThan(0);
    expect(report.loans).toBeGreaterThan(0);
    expect(report.offers).toBeGreaterThanOrEqual(report.completedTransfers);
    expect(report.sampleNegotiationTimeline.length).toBeGreaterThanOrEqual(2);
    expect(market.transferHistory().map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["TRANSFER_COMPLETED", "FREE_AGENT_SIGNED", "LOAN_STARTED"]),
    );
    expect(search.some((item) => "currentAbility" in (item as object))).toBe(false);
    db.close();
  });

  it("evaluates offers from club knowledge and preserves person identity after transfer", () => {
    const db = openGameDatabase(createSave("offer-person-id"));
    const buyingClubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const target = searchPlayersForClub(db, buyingClubId, {}, "2026-08-01").find(
      (item) => item.clubId && item.clubId !== buyingClubId && item.estimatedAbility,
    )!;
    const offer = createTransferOffer(db, {
      buyingClubId,
      sellingClubId: target.clubId,
      playerId: target.playerId,
      submittedAt: "2026-08-01",
      fee: 1_500_000,
    });

    const evaluation = evaluateTransferOffer(db, offer, "2026-08-01", "offer-person-id");
    if (evaluation.accepted) {
      runTransferDiagnostic(db, { seed: "offer-person-id", worldDate: "2026-08-01" });
    }

    const personRows = db
      .prepare("SELECT COUNT(*) AS count FROM persons WHERE id = ?")
      .get(target.playerId) as {
      count: number;
    };
    const activeAssignments = db
      .prepare(
        `SELECT COUNT(*) AS count
        FROM team_person_assignments
        WHERE person_id = ? AND role = 'PLAYER' AND ended_on IS NULL`,
      )
      .get(target.playerId) as { count: number };

    expect(offer.askingRange).toEqual(target.estimatedAbility ? expect.any(Object) : undefined);
    expect(personRows.count).toBe(1);
    expect(activeAssignments.count).toBeLessThanOrEqual(1);
    db.close();
  });

  it("supports temporary loans without terminating parent contracts", () => {
    const db = openGameDatabase(createSave("loan-return"));
    const parentClubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const loanClubId = clubIdByCanonical(db, "NEP-DIVA-FRN");
    const market = new TransferMarketRepository(db);
    const playerId = playerForClub(db, parentClubId);
    const parentContract = market.activeContract(playerId, "2026-08-01")!;

    const loan = startLoan(db, parentClubId, loanClubId, playerId, "2026-08-01", "loan-return");

    expect(market.activeContract(playerId, "2026-08-15")?.id).toBe(parentContract.id);
    expect(market.activeLoans("2026-08-15").map((item) => item.id)).toContain(loan.id);
    expect(market.transferHistory().map((event) => event.eventType)).toContain("LOAN_STARTED");
    db.close();
  });

  it("keeps three-season transfer careers playable and deterministic", () => {
    const first = openGameDatabase(createSave("deterministic-transfer-career"));
    const second = openGameDatabase(createSave("deterministic-transfer-career"));

    const firstReport = simulateNepalCareer({
      db: first,
      seasons: 3,
      seed: "deterministic-transfer-career",
      transfersEnabled: true,
    });
    const secondReport = simulateNepalCareer({
      db: second,
      seasons: 3,
      seed: "deterministic-transfer-career",
      transfersEnabled: true,
    });
    const firstHistory = new TransferMarketRepository(first).transferHistory();
    const secondHistory = new TransferMarketRepository(second).transferHistory();

    expect(firstReport.worldDate).toBe("2029-07-31");
    expect(
      firstReport.seasons.every((season) => season.matchesPlayed === season.fixturesGenerated),
    ).toBe(true);
    expect(firstHistory.length).toBeGreaterThan(0);
    expect(firstHistory).toEqual(secondHistory);
    expect(firstReport.seasons.map((season) => season.matchesPlayed)).toEqual(
      secondReport.seasons.map((season) => season.matchesPlayed),
    );
    first.close();
    second.close();
  });

  it("persists squad-need analysis for recruitment decisions", () => {
    const db = openGameDatabase(createSave("squad-needs"));
    const clubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const report = analyzeSquadNeeds(db, clubId, "2026-08-01");
    new TransferMarketRepository(db).upsertSquadNeedReport(report);

    expect(report.clubId).toBe(clubId);
    expect(report.expectedDepartures).toBeGreaterThanOrEqual(0);
    expect(report.needs.every((need) => ["LOW", "MEDIUM", "HIGH"].includes(need.severity))).toBe(
      true,
    );
    db.close();
  });
});

function clubIdByCanonical(
  db: ReturnType<typeof openGameDatabase>,
  canonicalExternalId: string,
): EntityId {
  return (
    db.prepare("SELECT id FROM clubs WHERE canonical_external_id = ?").get(canonicalExternalId) as {
      id: EntityId;
    }
  ).id;
}

function playerForClub(db: ReturnType<typeof openGameDatabase>, clubId: EntityId): EntityId {
  return (
    db
      .prepare(
        "SELECT player_id AS id FROM player_factual_profiles WHERE current_club_id = ? LIMIT 1",
      )
      .get(clubId) as { id: EntityId }
  ).id;
}
