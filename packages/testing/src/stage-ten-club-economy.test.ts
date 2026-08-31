import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  TransferMarketRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import type { EntityId, TransferOffer } from "@nepal-football-sim/shared-types";
import {
  acceptSponsorOffer,
  calculateClubValuation,
  completePermanentTransfer,
  createInfrastructureProject,
  createNepalSave,
  generateSponsorOffers,
  getClubFinancialSummary,
  initializeClubEconomyForSave,
  initializeTransferMarketForSave,
  postCompetitionMediaRights,
  processClubEconomyMonth,
  runChairmanDemo,
  runEconomyDiagnostic,
  setClubTicketPrice,
  simulateNepalCareer,
} from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-economy-"));
  tempDirs.push(dir);
  return join(dir, "economy.sqlite");
};

const createSave = (seed: string): string => {
  const databasePath = tempDbPath();
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Economy ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  return databasePath;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("club economy and chairman foundation", () => {
  it("creates simulation-only club accounts, budgets, supporters, facilities and ownership models", () => {
    const db = openGameDatabase(createSave("accounts"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "accounts" });
    const economy = new ClubEconomyRepository(db);
    const accounts = economy.financialAccounts();
    const ownership = economy.ownershipStakes();
    const departmentalClubId = clubIdByName(db, "Tribhuvan Army Club");

    expect(accounts.length).toBeGreaterThan(50);
    expect(accounts.every((account) => account.status === "SIMULATION_ONLY")).toBe(true);
    expect(economy.budgets().some((budget) => budget.category === "WAGE_BUDGET")).toBe(true);
    expect(
      economy.supporterProfiles().every((profile) => profile.status === "SIMULATION_ONLY"),
    ).toBe(true);
    expect(economy.facilityProfile(accounts[0]!.clubId)?.status).toBe("SIMULATION_ONLY");
    expect(ownership.find((stake) => stake.clubId === departmentalClubId)?.ownershipModel).toBe(
      "DEPARTMENTAL",
    );
    db.close();
  });

  it("posts auditable ledger entries and keeps personal wealth separate from club cash", () => {
    const db = openGameDatabase(createSave("owner-investment"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "owner-investment" });
    const clubId = clubIdByName(db, "New Road Team");
    const demo = runChairmanDemo({ db, seed: "owner-investment", worldDate: "2026-08-01", clubId });
    const economy = new ClubEconomyRepository(db);
    const personal = economy.personalFinancialProfile(demo.chairmanPersonId)!;
    const investments = economy.ownerInvestments();
    const summary = getClubFinancialSummary(db, clubId);

    expect(investments).toHaveLength(1);
    expect(personal.cash).toBeLessThan(25000000);
    expect(summary.account.cashBalance).toBeGreaterThan(demo.before.account.cashBalance);
    expect(summary.ledgerEntries.some((entry) => entry.category === "OWNER_INVESTMENT")).toBe(true);
    expect(demo.permissions).toContain("BUDGETS");
    db.close();
  });

  it("supports sponsorship, infrastructure projects, assets, valuation and reload", () => {
    const path = createSave("sponsors-projects");
    const db = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "sponsors-projects" });
    const clubId = clubIdByName(db, "Machhindra FC");
    const offer = generateSponsorOffers(db, {
      clubId,
      date: "2026-08-01",
      seed: "sponsors-projects",
      count: 1,
    })[0]!;
    const accepted = acceptSponsorOffer(db, offer.id, "2026-08-01");
    const project = createInfrastructureProject(db, {
      clubId,
      projectType: "MEDICAL_ROOM",
      date: "2026-08-01",
      seed: "sponsors-projects",
    });
    const valuation = calculateClubValuation(db, clubId, "2026-08-01");
    db.close();

    const reloaded = openGameDatabase(path);
    const economy = new ClubEconomyRepository(reloaded);
    expect(economy.sponsorships(clubId).find((item) => item.id === accepted.id)?.status).toBe(
      "ACTIVE",
    );
    expect(economy.infrastructureProjects(clubId).map((item) => item.id)).toContain(project.id);
    expect(economy.valuation(clubId)?.valuation).toBe(valuation.valuation);
    reloaded.close();
  });

  it("posts transfer purchase and sale ledger entries without breaking movement identity", () => {
    const db = openGameDatabase(createSave("transfer-ledger"));
    initializeTransferMarketForSave({ db, worldDate: "2026-08-01", seed: "transfer-ledger" });
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "transfer-ledger" });
    const market = new TransferMarketRepository(db);
    const sellerContract = market
      .allPlayerContracts()
      .find((contract) => contract.status === "ACTIVE")!;
    expect(sellerContract).toBeDefined();
    const buyerId = new ClubEconomyRepository(db)
      .financialAccounts()
      .find((account) => account.clubId !== sellerContract.clubId)!.clubId;
    const offer: TransferOffer = {
      id: "economy-transfer-offer" as EntityId,
      buyingClubId: buyerId,
      sellingClubId: sellerContract.clubId,
      playerId: sellerContract.playerId,
      offerType: "PERMANENT",
      transferFee: 50000,
      installments: 0,
      addOns: 0,
      sellOnPercentage: 0,
      submittedAt: "2026-08-01",
      expiresAt: "2026-08-15",
      status: "ACCEPTED",
      currency: "NPR",
      agentFee: 0,
      signingFee: 0,
    };

    market.insertTransferOffer(offer);
    completePermanentTransfer(db, offer, "2026-08-01", "transfer-ledger");
    const ledger = new ClubEconomyRepository(db).ledgerEntries();
    expect(
      ledger.some((entry) => entry.clubId === buyerId && entry.category === "TRANSFER_EXPENSE"),
    ).toBe(true);
    expect(
      ledger.some(
        (entry) => entry.clubId === sellerContract.clubId && entry.category === "TRANSFER_INCOME",
      ),
    ).toBe(true);
    expect(market.activeContract(offer.playerId, "2026-08-01")?.clubId).toBe(buyerId);
    db.close();
  });

  it("runs a fixture-backed economy season with matchday, payroll, prize money and statements", () => {
    const db = openGameDatabase(createSave("career-economy"));
    const report = simulateNepalCareer({
      db,
      seasons: 1,
      seed: "career-economy",
      transfersEnabled: true,
      youthEnabled: true,
      economyEnabled: true,
    });
    const economy = new ClubEconomyRepository(db);
    const entries = economy.ledgerEntries();

    expect(report.seasons.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.category === "MATCHDAY_REVENUE")).toBe(true);
    expect(entries.some((entry) => entry.category === "PLAYER_WAGES")).toBe(true);
    expect(entries.some((entry) => entry.category === "PRIZE_MONEY")).toBe(true);
    expect(economy.financialStatements().length).toBeGreaterThan(0);
    expect(
      economy.financialAccounts().filter((account) => account.financialHealth === "INSOLVENT")
        .length,
    ).toBeLessThan(economy.financialAccounts().length);
    db.close();
  });

  it("is deterministic for same-seed starting profiles and economy diagnostics", () => {
    // The diagnostic seed is only meaningful when the save bootstrap is also
    // identical; separate temporary databases already provide isolation.
    const first = openGameDatabase(createSave("deterministic-economy"));
    const second = openGameDatabase(createSave("deterministic-economy"));
    const firstReport = runEconomyDiagnostic({
      db: first,
      seed: "deterministic-economy",
      startDate: "2026-08-01",
      seasons: 2,
    });
    const secondReport = runEconomyDiagnostic({
      db: second,
      seed: "deterministic-economy",
      startDate: "2026-08-01",
      seasons: 2,
    });

    expect(stripVolatile(firstReport)).toEqual(stripVolatile(secondReport));
    first.close();
    second.close();
  });

  it("keeps one-month finance outputs deterministic across A/B/C divisions", () => {
    const first = openGameDatabase(createSave("fast-economy-determinism"));
    const second = openGameDatabase(createSave("fast-economy-determinism"));
    const seed = "fast-economy-determinism";
    initializeClubEconomyForSave({ db: first, worldDate: "2026-08-01", seed });
    initializeClubEconomyForSave({ db: second, worldDate: "2026-08-01", seed });
    processClubEconomyMonth(first, { date: "2026-08-31", seed });
    processClubEconomyMonth(second, { date: "2026-08-31", seed });

    const snapshot = (db: ReturnType<typeof openGameDatabase>) => {
      const economy = new ClubEconomyRepository(db);
      return (["A", "B", "C"] as const).map((division) => {
        const row = db
          .prepare(
            `SELECT c.id AS club_id, c.name
           FROM clubs c
           JOIN club_memberships cm ON cm.club_id = c.id AND cm.status = 'ACTIVE'
           JOIN competition_seasons cs ON cs.id = cm.competition_season_id
           JOIN competitions comp ON comp.id = cs.competition_id
           WHERE lower(comp.name) LIKE ?
           ORDER BY c.id
           LIMIT 1`,
          )
          .get(`%${division.toLowerCase()}-division%`) as { club_id: EntityId; name: string };
        const account = economy.financialAccount(row.club_id)!;
        return {
          division,
          name: row.name,
          cashBalance: account.cashBalance,
          seasonRevenue: account.seasonRevenue,
          seasonExpenses: account.seasonExpenses,
          sponsorshipValue: economy
            .sponsorships(row.club_id)
            .reduce((total, item) => total + item.annualValue, 0),
        };
      });
    };

    expect(snapshot(first)).toEqual(snapshot(second));
    first.close();
    second.close();
  }, 60_000);

  it("persists commercial profiles, ticket pricing and competition media rights deterministically", () => {
    const first = openGameDatabase(createSave("commercial-phase-a"));
    initializeClubEconomyForSave({ db: first, worldDate: "2026-08-01", seed: "commercial-phase-a" });
    const clubId = clubIdByName(first, "Machhindra FC");
    const season = first.prepare("SELECT competition_season_id AS id FROM club_memberships WHERE status = 'ACTIVE' ORDER BY competition_season_id LIMIT 1").get() as { id: EntityId };
    const profile = new ClubEconomyRepository(first).commercialProfile(clubId)!;
    expect(profile.brandStrength).toBeGreaterThan(0);
    setClubTicketPrice(first, clubId, 375);
    const rights = postCompetitionMediaRights(first, { competitionSeasonId: season.id, date: "2026-08-01", seed: "commercial-phase-a" });
    expect(new ClubEconomyRepository(first).supporterProfile(clubId)?.standardTicketPrice).toBe(375);
    expect(new ClubEconomyRepository(first).mediaRights(season.id)[0]).toEqual(rights);
    expect(new ClubEconomyRepository(first).ledgerEntries().some((entry) => entry.category === "BROADCASTING")).toBe(true);
    first.close();
  });
});

const clubIdByName = (db: ReturnType<typeof openGameDatabase>, name: string): EntityId => {
  const row = db.prepare("SELECT id FROM clubs WHERE name = ?").get(name) as { id: EntityId };
  return row.id;
};

const stripVolatile = <T extends { clubs: Array<{ clubId: EntityId }> }>(report: T): T => ({
  ...report,
  clubs: report.clubs.map((club) => ({ ...club, clubId: "" as EntityId })),
});
