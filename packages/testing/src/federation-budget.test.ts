import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FederationGovernanceRepository, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  createFederationGrant,
  initializeFederationGovernanceForSave,
} from "@nepal-football-sim/simulation";
import type { EntityId, FederationBudget } from "@nepal-football-sim/shared-types";

/*
 * Phase 9B: the President's FEDERATION_BUDGETS authority is enforced in the
 * domain. Budgets are allocation targets, not cash: setting one never moves
 * money or posts to the ledger. Grants are read-only and expose only the
 * player-facing fields.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const character = {
  fullName: "Federation Budget Tester",
  dateOfBirth: "1985-01-01",
  startingAge: 41,
  languages: ["en"],
  footballBackground: "COMMUNITY_COACHING",
  education: "SPORTS_RELATED_DEGREE",
  playingExperience: "AMATEUR_PLAYER",
  coachingExperience: "YOUTH_COACH",
  businessBackground: "SMALL_BUSINESS",
  startingReputationProfile: "LOCAL_RESPECTED",
};

const newService = (label: string) => {
  const directory = mkdtempSync(join(tmpdir(), `fedbudget-${label}-`));
  dirs.push(directory);
  return new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
};

const newManager = (label: string) => {
  const service = newService(label);
  const created = service.createCareer({ saveName: `Budget ${label}`, character });
  if (!created.ok) throw new Error(created.error.message);
  return { service, savePath: created.data.catalogEntry.filePath };
};

const newOwner = (label: string) => {
  const service = newService(label);
  const clubs = service.listStartingClubs();
  if (!clubs.ok) throw new Error(clubs.error.message);
  const club = clubs.data.find((option) => option.division === "C") ?? clubs.data[0]!;
  const created = service.createCareer({ careerMode: "OWNER", saveName: `Budget ${label}`, joinTeamId: club.teamId, character });
  if (!created.ok) throw new Error(created.error.message);
  return service;
};

const withDb = <T,>(savePath: string, run: (db: GameDatabase) => T): T => {
  const db = openGameDatabase(savePath);
  try {
    return run(db);
  } finally {
    db.close();
  }
};

const federationId = (db: GameDatabase): EntityId =>
  (db.prepare("SELECT id FROM federations WHERE name='All Nepal Football Association'").get() as { id: EntityId }).id;

const grantPresidency = (savePath: string, status: "ACTIVE" | "INTERIM" = "ACTIVE"): void =>
  withDb(savePath, (db) => {
    const save = db.prepare("SELECT player_character_id, world_date, random_seed FROM saves LIMIT 1").get() as {
      player_character_id: EntityId;
      world_date: string;
      random_seed: string;
    };
    const personId = (
      db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as { person_id: EntityId }
    ).person_id;
    initializeFederationGovernanceForSave({ db, worldDate: save.world_date, seed: save.random_seed });
    db.prepare(
      `INSERT INTO federation_leadership_tenures
        (id, person_id, federation_id, role, term_start, term_end, status, provenance_status)
        VALUES (?, ?, ?, 'FEDERATION_PRESIDENT', ?, '2030-01-01', ?, 'SIMULATION_ONLY')`,
    ).run("budget-president-tenure", personId, federationId(db), save.world_date, status);
  });

const newPresident = (label: string, status: "ACTIVE" | "INTERIM" = "ACTIVE") => {
  const { service, savePath } = newManager(label);
  service.closeCareer();
  grantPresidency(savePath, status);
  expect(service.loadCareerByPath(savePath).ok).toBe(true);
  expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT").ok).toBe(true);
  return { service, savePath };
};

const budgetOf = (service: DesktopApplicationService, category: string): FederationBudget => {
  const dashboard = service.getFederationPresidentDashboard();
  if (!dashboard.ok) throw new Error(dashboard.error.message);
  const budget = dashboard.data.finances.budgets.find((entry) => entry.category === category && entry.status === "ACTIVE");
  if (!budget) throw new Error(`no ${category} budget`);
  return budget;
};

describe("federation budget and grants: role boundary", () => {
  it("a Manager cannot set a federation budget or read grants", () => {
    const { service } = newManager("manager");
    for (const result of [service.setFederationBudget("ADMINISTRATION", 1_000_000), service.getFederationGrants()]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ROLE_NOT_AUTHORIZED");
    }
    service.closeCareer();
  });

  it("an Owner cannot set a federation budget or read grants", () => {
    const service = newOwner("owner");
    for (const result of [service.setFederationBudget("ADMINISTRATION", 1_000_000), service.getFederationGrants()]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ROLE_NOT_AUTHORIZED");
    }
    service.closeCareer();
  });

  it("an interim President cannot set a budget", () => {
    const { service } = newPresident("interim", "INTERIM");
    const result = service.setFederationBudget("ADMINISTRATION", budgetOf(service, "ADMINISTRATION").amount + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_SELECTION");
    service.closeCareer();
  });
});

describe("President budget command", () => {
  it("sets the allocation, keeps the used amount, moves no money and survives a reload", () => {
    const { service, savePath } = newPresident("set");
    const before = budgetOf(service, "ADMINISTRATION");
    const dashboardBefore = service.getFederationPresidentDashboard();
    if (!dashboardBefore.ok) throw new Error("dashboard failed");
    const { account, ledgerEntries } = dashboardBefore.data.finances;

    const target = before.amount + 1_000_000;
    const result = service.setFederationBudget("ADMINISTRATION", target);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.amount).toBe(target);
      expect(result.data.usedAmount).toBe(before.usedAmount);
    }

    const dashboardAfter = service.getFederationPresidentDashboard();
    if (!dashboardAfter.ok) throw new Error("dashboard failed");
    expect(budgetOf(service, "ADMINISTRATION").amount).toBe(target);
    expect(dashboardAfter.data.finances.account.cashBalance).toBe(account.cashBalance);
    expect(dashboardAfter.data.finances.account.restrictedFunds).toBe(account.restrictedFunds);
    expect(dashboardAfter.data.finances.ledgerEntries).toEqual(ledgerEntries);

    service.closeCareer();
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    service.switchActiveCareerRole("FEDERATION_PRESIDENT");
    expect(budgetOf(service, "ADMINISTRATION").amount).toBe(target);
    service.closeCareer();
  });

  it("rejects an unchanged amount, an invalid category and malformed amounts, changing nothing", () => {
    const { service } = newPresident("invalid");
    const before = budgetOf(service, "GRASSROOTS");
    const attempts = [
      service.setFederationBudget("GRASSROOTS", before.amount),
      service.setFederationBudget("NOT_A_CATEGORY" as never, 1_000),
      service.setFederationBudget("GRASSROOTS", -1),
      service.setFederationBudget("GRASSROOTS", 1.5),
      service.setFederationBudget("GRASSROOTS", Number.NaN),
      service.setFederationBudget("GRASSROOTS", Number.POSITIVE_INFINITY),
    ];
    for (const attempt of attempts) {
      expect(attempt.ok).toBe(false);
      if (!attempt.ok) expect(attempt.error.code).toBe("INVALID_SELECTION");
    }
    expect(budgetOf(service, "GRASSROOTS").amount).toBe(before.amount);
    service.closeCareer();
  });

  it("never lets a budget fall below what has already been used", () => {
    const { service, savePath } = newManager("floor");
    service.closeCareer();
    grantPresidency(savePath);
    withDb(savePath, (db) => {
      const save = db.prepare("SELECT world_date FROM saves LIMIT 1").get() as { world_date: string };
      new FederationGovernanceRepository(db).addBudgetUsage(federationId(db), save.world_date.slice(0, 4), "COMMERCIAL", 50_000);
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    service.switchActiveCareerRole("FEDERATION_PRESIDENT");
    const current = budgetOf(service, "COMMERCIAL");
    expect(current.usedAmount).toBe(50_000);

    const below = service.setFederationBudget("COMMERCIAL", 49_999);
    expect(below.ok).toBe(false);
    if (!below.ok) expect(below.error.message).toMatch(/below the amount already used/i);
    expect(budgetOf(service, "COMMERCIAL").amount).toBe(current.amount);

    const exact = service.setFederationBudget("COMMERCIAL", 50_000);
    expect(exact.ok).toBe(true);
    service.closeCareer();
  });
});

describe("federation grants read", () => {
  it("exposes only the player-facing fields and honest empties", () => {
    const { service, savePath } = newPresident("grants");
    const empty = service.getFederationGrants();
    expect(empty.ok).toBe(true);
    const existing = empty.ok ? empty.data.length : 0;

    service.closeCareer();
    withDb(savePath, (db) => {
      createFederationGrant(db, {
        federationId: federationId(db),
        sourceInstitution: "AFC_DEVELOPMENT",
        currency: "NPR",
        approvedAmount: 750_000,
        fundingPeriodStart: "2026-08-01",
        fundingPeriodEnd: "2027-07-31",
        purpose: "Grassroots development",
        restrictionType: "GRASSROOTS",
        reportingRequirements: ["annual report"],
        auditRequired: true,
        milestones: [{ key: "m1", description: "internal milestone", dueDate: "2027-01-01", completed: false }],
        conditions: ["internal condition"],
        seed: "budget-test",
      });
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    service.switchActiveCareerRole("FEDERATION_PRESIDENT");

    const grants = service.getFederationGrants();
    expect(grants.ok).toBe(true);
    if (!grants.ok) return;
    expect(grants.data).toHaveLength(existing + 1);
    const grant = grants.data.find((entry) => entry.purpose === "Grassroots development")!;
    expect(Object.keys(grant).sort()).toEqual(
      [
        "approvedAmount",
        "currency",
        "fundingPeriodEnd",
        "fundingPeriodStart",
        "id",
        "provenanceStatus",
        "purpose",
        "receivedAmount",
        "remainingAmount",
        "restrictionType",
        "sourceInstitution",
        "status",
      ].sort(),
    );
    expect(grant.sourceInstitution).toBe("AFC_DEVELOPMENT");
    expect(grant.restrictionType).toBe("GRASSROOTS");
    expect(grant.approvedAmount).toBe(750_000);
    expect(grant.receivedAmount).toBe(0);
    expect(JSON.stringify(grants.data)).not.toMatch(/internal condition|internal milestone|annual report/);
    service.closeCareer();
  });
});
