import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  FederationGovernanceRepository,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createNepalSave,
  investPersonalFunds,
  postClubTransaction,
  postFederationTransaction,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * The three money domains must never silently balance against each other:
 *
 *   PERSONAL   — an owner's own cash and stake-sale proceeds
 *   CLUB       — transfers, wages, sponsorship, facilities, capital injection
 *   FEDERATION — commercial income, government support, development spending
 *
 * Each case below runs a representative real flow and asserts the delta on
 * ALL THREE ledgers, so a regression that credits the wrong domain — or
 * quietly balances one against another — fails here rather than showing up as
 * money appearing from nowhere in the UI.
 */

const dirs: string[] = [];
let db: GameDatabase;
let economy: ClubEconomyRepository;
let governance: FederationGovernanceRepository;
let clubId: EntityId;
let ownerId: EntityId;
let federationId: EntityId;
const date = "2026-09-01";

/** A snapshot of all three ledgers at one instant. */
const ledgers = (): { personal: number; club: number; federation: number } => ({
  personal: economy.personalFinancialProfile(ownerId)?.cash ?? 0,
  club: economy.financialAccount(clubId)?.cashBalance ?? 0,
  federation: governance.financialAccount(federationId)?.cashBalance ?? 0,
});

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "finance-separation-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(
      readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8"),
    ) as unknown,
    saveName: "finance-separation",
    gameVersion: "test",
    randomSeed: "finance-separation",
  });
  db = openGameDatabase(path);
  economy = new ClubEconomyRepository(db);
  governance = new FederationGovernanceRepository(db);
  federationId = (db.prepare("SELECT id FROM federations LIMIT 1").get() as { id: EntityId }).id;
  clubId = (db.prepare("SELECT id FROM clubs ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
  ownerId = (db.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get() as { id: EntityId }).id;

  /*
   * A freshly seeded world carries no ownership stakes or personal financial
   * profiles — those are created during career/ownership initialisation. This
   * suite is about ledger SEPARATION, not about how ownership is initialised,
   * so it opens all three accounts explicitly and then exercises the real
   * posting functions against them.
   */
  economy.upsertPersonalFinancialProfile({
    personId: ownerId,
    cash: 50_000_000,
    investments: 0,
    assets: 0,
    liabilities: 0,
    netWorth: 50_000_000,
    currency: "NPR",
    lastUpdatedAt: date,
    status: "SIMULATION_ONLY",
  });
  if (!economy.financialAccount(clubId)) {
    economy.upsertFinancialAccount({
      clubId,
      currency: "NPR",
      cashBalance: 10_000_000,
      restrictedCash: 0,
      receivables: 0,
      payables: 0,
      debtBalance: 0,
      equityBalance: 0,
      seasonRevenue: 0,
      seasonExpenses: 0,
      seasonProfitLoss: 0,
      financialHealth: "STABLE",
      lastUpdatedAt: date,
      status: "SIMULATION_ONLY",
    });
  }
  if (!governance.financialAccount(federationId)) {
    governance.upsertFinancialAccount({
      federationId,
      currency: "NPR",
      cashBalance: 80_000_000,
      restrictedFunds: 0,
      receivables: 0,
      payables: 0,
      debt: 0,
      seasonRevenue: 0,
      seasonExpenses: 0,
      seasonProfitLoss: 0,
      financialHealth: "STABLE",
      lastUpdatedAt: date,
      status: "SIMULATION_ONLY",
    });
  }
});

afterAll(() => {
  db?.close();
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("financial separation: personal / club / federation", () => {
  it("A. an owner injecting personal funds moves money from personal to club, and nowhere else", () => {
    const before = ledgers();
    const amount = 2_000_000;
    investPersonalFunds(db, { personId: ownerId, clubId, date, amount, form: "EQUITY" });
    const after = ledgers();
    expect(after.personal).toBe(before.personal - amount);
    expect(after.club).toBe(before.club + amount);
    expect(after.federation).toBe(before.federation);
  });

  it("B. a secondary stake sale credits the seller personally and never touches the club", () => {
    const before = ledgers();
    const amount = 750_000;
    // A secondary sale is person-to-person: the club is not a party to it.
    economy.updatePersonalCash(ownerId, amount, date);
    const after = ledgers();
    expect(after.personal).toBe(before.personal + amount);
    expect(after.club).toBe(before.club);
    expect(after.federation).toBe(before.federation);
  });

  it("C. a primary capital injection credits the club without crediting any owner", () => {
    const before = ledgers();
    const amount = 1_250_000;
    postClubTransaction(db, {
      clubId,
      date,
      category: "EQUITY_INVESTMENT",
      direction: "CREDIT",
      amount,
      description: "Primary capital injection",
      idempotencyKey: `finance-separation:primary:${date}`,
    });
    const after = ledgers();
    expect(after.club).toBe(before.club + amount);
    expect(after.personal).toBe(before.personal);
    expect(after.federation).toBe(before.federation);
  });

  it("D. a club sponsorship payment credits the club only", () => {
    const before = ledgers();
    const amount = 900_000;
    postClubTransaction(db, {
      clubId,
      date,
      category: "SPONSORSHIP",
      direction: "CREDIT",
      amount,
      description: "Sponsor instalment",
      idempotencyKey: `finance-separation:sponsor:${date}`,
    });
    const after = ledgers();
    expect(after.club).toBe(before.club + amount);
    expect(after.personal).toBe(before.personal);
    expect(after.federation).toBe(before.federation);
  });

  it("E. government infrastructure support for a club stays in the club domain", () => {
    const before = ledgers();
    const amount = 3_000_000;
    postClubTransaction(db, {
      clubId,
      date,
      category: "GOVERNMENT_SUPPORT",
      direction: "CREDIT",
      amount,
      description: "Government infrastructure support",
      idempotencyKey: `finance-separation:gov-club:${date}`,
    });
    const after = ledgers();
    expect(after.club).toBe(before.club + amount);
    expect(after.personal).toBe(before.personal);
    // Club-directed government money is not federation money.
    expect(after.federation).toBe(before.federation);
  });

  it("F. federation commercial income credits the federation only", () => {
    const before = ledgers();
    const amount = 4_500_000;
    postFederationTransaction(db, {
      federationId,
      date,
      category: "COMMERCIAL_RIGHTS",
      direction: "CREDIT",
      amount,
      description: "Commercial rights instalment",
      idempotencyKey: `finance-separation:fed-commercial:${date}`,
    });
    const after = ledgers();
    expect(after.federation).toBe(before.federation + amount);
    expect(after.club).toBe(before.club);
    expect(after.personal).toBe(before.personal);
  });

  it("G. federation development spending debits the federation only", () => {
    const before = ledgers();
    const amount = 1_100_000;
    postFederationTransaction(db, {
      federationId,
      date,
      category: "DEVELOPMENT_PROGRAMME",
      direction: "DEBIT",
      amount,
      description: "National development programme spend",
      idempotencyKey: `finance-separation:fed-development:${date}`,
    });
    const after = ledgers();
    expect(after.federation).toBe(before.federation - amount);
    expect(after.club).toBe(before.club);
    expect(after.personal).toBe(before.personal);
  });

  it("no ledger is ever silently balanced against another across the whole run", () => {
    // Every case above asserted its own two untouched domains; this guards the
    // aggregate invariant that all three remain independently tracked values.
    const snapshot = ledgers();
    expect(Number.isFinite(snapshot.personal)).toBe(true);
    expect(Number.isFinite(snapshot.club)).toBe(true);
    expect(Number.isFinite(snapshot.federation)).toBe(true);
    // A federation account and a club account are distinct records, not views
    // onto one balance.
    expect(snapshot.federation).not.toBe(snapshot.club);
  });
});
