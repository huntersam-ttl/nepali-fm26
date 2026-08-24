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
  runChairmanDemo,
  runEconomyDiagnostic,
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
    const first = openGameDatabase(createSave("deterministic-economy-a"));
    const second = openGameDatabase(createSave("deterministic-economy-b"));
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
});

const clubIdByName = (db: ReturnType<typeof openGameDatabase>, name: string): EntityId => {
  const row = db.prepare("SELECT id FROM clubs WHERE name = ?").get(name) as { id: EntityId };
  return row.id;
};

const stripVolatile = <T extends { clubs: Array<{ clubId: EntityId }> }>(report: T): T => ({
  ...report,
  clubs: report.clubs.map((club) => ({ ...club, clubId: "" as EntityId })),
});
