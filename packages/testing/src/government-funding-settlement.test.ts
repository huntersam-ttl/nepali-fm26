import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FederationGovernanceRepository,
  GovernmentRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  createNepalSave,
  initializeFederationGovernanceForSave,
  proposeGovernmentFunding,
  reviewGovernmentFunding,
  submitGovernmentFunding,
} from "@nepal-football-sim/simulation";
import type { EntityId, GovernmentFundingType } from "@nepal-football-sim/shared-types";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];
const DATE = "2026-09-01";

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const seededSave = (label: string): string => {
  const directory = mkdtempSync(join(tmpdir(), `nepal-gov-funding-${label}-`));
  tempDirs.push(directory);
  const databasePath = join(directory, "career.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Government funding ${label}`,
    gameVersion: "test",
    randomSeed: `government-funding-${label}`,
  });
  return databasePath;
};

const nepalFederation = (db: ReturnType<typeof openGameDatabase>): EntityId =>
  (db.prepare("SELECT id FROM federations ORDER BY founded_year IS NULL, id LIMIT 1").get() as {
    id: EntityId;
  }).id;

/** A council with plenty of capacity so the decision itself is not the thing under test. */
const seedInstitution = (db: ReturnType<typeof openGameDatabase>): EntityId => {
  const id = "nsc-institution" as EntityId;
  new GovernmentRepository(db).upsertInstitution({
    id,
    name: "National Sports Council",
    institutionType: "NATIONAL_SPORTS_COUNCIL",
    profile: {
      budgetCapacity: 40_000_000,
      committedBudget: 0,
      footballPriority: 90,
      credibilityTowardFederation: 85,
      infrastructurePriority: 90,
      youthWomenPriority: 90,
    },
    provenanceStatus: "SIMULATION_ONLY",
  });
  return id;
};

const strongEvidence = {
  federationCredibility: 95,
  projectQuality: 95,
  footballPerformance: 90,
  existingCommitments: 5,
};

const approve = (
  db: ReturnType<typeof openGameDatabase>,
  input: { institutionId: EntityId; federationId?: EntityId; fundingType: GovernmentFundingType },
) => {
  const proposed = proposeGovernmentFunding(db, {
    institutionId: input.institutionId,
    federationId: input.federationId,
    fundingType: input.fundingType,
    requestedAmount: 5_000_000,
    proposedOn: DATE,
  } as never);
  submitGovernmentFunding(db, proposed.id);
  return reviewGovernmentFunding(db, {
    applicationId: proposed.id,
    reviewedOn: DATE,
    evidence: strongEvidence,
  });
};

const governmentEntries = (db: ReturnType<typeof openGameDatabase>, federationId: EntityId) =>
  new FederationGovernanceRepository(db)
    .ledgerEntries(federationId)
    .filter((entry) => entry.category === "GOVERNMENT_GRANT");

describe("government funding settlement", () => {
  it("credits the federation when an application is approved", () => {
    const db = openGameDatabase(seededSave("credit"));
    try {
      initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "gov" });
      const federationId = nepalFederation(db);
      const institutionId = seedInstitution(db);
      const before = new FederationGovernanceRepository(db).financialAccount(federationId)!;

      const decision = approve(db, {
        institutionId,
        federationId,
        fundingType: "YOUTH_GRASSROOTS",
      });
      expect(["APPROVED", "CONDITIONAL"]).toContain(decision.status);
      expect(decision.approvedAmount).toBeGreaterThan(0);

      const entries = governmentEntries(db, federationId);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.direction).toBe("CREDIT");
      expect(entries[0]!.amount).toBe(decision.approvedAmount);
      expect(entries[0]!.restrictionTag).toBe("development");
      expect(entries[0]!.relatedEntityId).toBe(decision.id);
      expect(entries[0]!.status).toBe("SIMULATION_ONLY");

      const after = new FederationGovernanceRepository(db).financialAccount(federationId)!;
      expect(after.cashBalance).toBe(before.cashBalance + decision.approvedAmount!);
    } finally {
      db.close();
    }
  }, 120000);

  it("settles once however often the review is replayed", () => {
    const path = seededSave("replay");
    const db = openGameDatabase(path);
    let expectedAmount = 0;
    let federationId: EntityId;
    try {
      initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "gov" });
      federationId = nepalFederation(db);
      const institutionId = seedInstitution(db);
      const decision = approve(db, {
        institutionId,
        federationId,
        fundingType: "INFRASTRUCTURE",
      });
      expectedAmount = decision.approvedAmount!;
      const balance = new FederationGovernanceRepository(db).financialAccount(federationId)!
        .cashBalance;

      for (const attempt of [0, 1]) {
        void attempt;
        reviewGovernmentFunding(db, {
          applicationId: decision.id,
          reviewedOn: DATE,
          evidence: strongEvidence,
        });
      }
      expect(governmentEntries(db, federationId)).toHaveLength(1);
      expect(
        new FederationGovernanceRepository(db).financialAccount(federationId)!.cashBalance,
      ).toBe(balance);
    } finally {
      db.close();
    }

    // The credit survives a reload with its amount and restriction intact.
    const reloaded = openGameDatabase(path);
    try {
      const entries = governmentEntries(reloaded, federationId!);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.amount).toBe(expectedAmount);
      expect(entries[0]!.restrictionTag).toBe("infrastructure");
    } finally {
      reloaded.close();
    }
  }, 120000);

  it("moves no money when the application is rejected or has no federation", () => {
    const db = openGameDatabase(seededSave("negative"));
    try {
      initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "gov" });
      const federationId = nepalFederation(db);
      const repository = new GovernmentRepository(db);

      // Fully committed budget: the council has nothing left to award.
      const exhausted = "exhausted-institution" as EntityId;
      repository.upsertInstitution({
        id: exhausted,
        name: "Committed Municipality",
        institutionType: "MUNICIPALITY",
        profile: {
          budgetCapacity: 1_000_000,
          committedBudget: 1_000_000,
          footballPriority: 90,
          credibilityTowardFederation: 90,
          infrastructurePriority: 90,
          youthWomenPriority: 90,
        },
        provenanceStatus: "SIMULATION_ONLY",
      });
      const rejected = approve(db, {
        institutionId: exhausted,
        federationId,
        fundingType: "INFRASTRUCTURE",
      });
      expect(rejected.status).toBe("REJECTED");
      expect(governmentEntries(db, federationId)).toHaveLength(0);

      // Approved, but attached to no federation: nothing to credit.
      const institutionId = seedInstitution(db);
      const unattached = approve(db, { institutionId, fundingType: "FEDERATION_OPERATIONS" });
      expect(["APPROVED", "CONDITIONAL"]).toContain(unattached.status);
      expect(governmentEntries(db, federationId)).toHaveLength(0);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  }, 120000);
});
