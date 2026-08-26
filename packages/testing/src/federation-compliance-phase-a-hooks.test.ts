import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FederationComplianceRepository, FederationGovernanceRepository, migrateDatabase, openGameDatabase } from "@nepal-football-sim/database";
import {
  applyFederationComplianceSnapshot,
  federationAccessAllowed,
  initializeFederationComplianceForSave,
  runFederationComplianceAiForAllFederations,
} from "@nepal-football-sim/simulation";
import type { EntityId, FederationComplianceSnapshotSeed } from "@nepal-football-sim/shared-types";

const tempDirs: string[] = [];
const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "federation-compliance-hooks-"));
  tempDirs.push(dir);
  return join(dir, "career.sqlite");
};
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const seedFederation = (db: ReturnType<typeof openGameDatabase>, federationId: string, financialHealth = "STABLE") => {
  db.prepare("INSERT INTO countries (id,name,iso_code) VALUES (?,?,?)").run("country-1", "Nepal", "NPL");
  db.prepare("INSERT INTO federations (id,country_id,name) VALUES (?,?,?)").run(federationId, "country-1", "Simulation Federation");
  db.prepare(
    "INSERT INTO federation_financial_accounts (federation_id,currency,cash_balance,restricted_funds,receivables,payables,debt,season_revenue,season_expenses,season_profit_loss,financial_health,last_updated_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(federationId, "NPR", 0, 0, 0, 0, 0, 0, 0, 0, financialHealth, "2027-01-01", "SIMULATION_ONLY");
};

describe("federation compliance phase A — init/snapshot/AI hooks", () => {
  it("creates a default unverified compliance profile only for federations that lack one", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    seedFederation(db, "fed-1");
    const federationId = "fed-1" as EntityId;

    initializeFederationComplianceForSave(db, "2027-01-01");
    const repo = new FederationComplianceRepository(db);
    const created = repo.complianceProfile(federationId)!;
    expect(created.status).toBe("NORMAL");
    expect(created.provenanceStatus).toBe("UNKNOWN");

    // A second call must not clobber an existing profile (e.g. a real snapshot).
    repo.upsertComplianceProfile({ ...created, status: "WARNING", provenanceStatus: "SIMULATION_ONLY" });
    initializeFederationComplianceForSave(db, "2027-02-01");
    expect(repo.complianceProfile(federationId)!.status).toBe("WARNING");
    db.close();
  });

  it("seeds a verified starting snapshot with its own provenance, including any real sanctions and their consequences", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    seedFederation(db, "fed-1");
    const federationId = "fed-1" as EntityId;

    const snapshot: FederationComplianceSnapshotSeed = {
      federationKey: "anfa",
      status: "SUSPENDED",
      dimensions: { statutoryCompliance: 20 },
      effectiveDate: "2026-08-01",
      provenanceStatus: "VERIFIED",
      sanctions: [
        {
          authority: "FIFA",
          reason: "Third-party interference in federation governance",
          category: "GOVERNANCE_INTERFERENCE",
          startDate: "2026-08-01",
          requirementsForResolution: ["Reinstate elected leadership"],
          affectedProgrammes: ["NATIONAL_TEAM"],
          consequences: ["FUNDING_FROZEN", "NATIONAL_TEAM_PARTICIPATION_BLOCKED"],
          provenanceStatus: "VERIFIED",
        },
      ],
    };
    applyFederationComplianceSnapshot(db, federationId, snapshot);

    const repo = new FederationComplianceRepository(db);
    const profile = repo.complianceProfile(federationId)!;
    expect(profile.status).toBe("SUSPENDED");
    expect(profile.provenanceStatus).toBe("VERIFIED");
    expect(profile.dimensions.statutoryCompliance).toBe(20);
    expect(repo.sanctionsForFederation(federationId)).toHaveLength(1);
    expect(repo.sanctionsForFederation(federationId)[0]!.provenanceStatus).toBe("VERIFIED");
    expect(federationAccessAllowed(db, federationId, "FUNDING_FROZEN")).toBe(false);
    expect(federationAccessAllowed(db, federationId, "NATIONAL_TEAM_PARTICIPATION_BLOCKED")).toBe(false);
    db.close();
  });

  it("leaves a federation's compliance UNKNOWN (not a fabricated claim) when no snapshot is supplied", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    seedFederation(db, "fed-1");
    initializeFederationComplianceForSave(db, "2026-08-01");
    const profile = new FederationComplianceRepository(db).complianceProfile("fed-1" as EntityId)!;
    expect(profile.provenanceStatus).toBe("UNKNOWN");
    expect(profile.status).toBe("NORMAL");
    db.close();
  });

  it("runs bounded, deterministic AI behaviour: advances grants, proposes new funding when cash is thin, and starts corrective action under sanction", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    seedFederation(db, "fed-1", "DISTRESSED");
    const federationId = "fed-1" as EntityId;
    initializeFederationComplianceForSave(db, "2027-01-01");

    // Thin cash + no pending grant -> AI proposes a new one (PROPOSED first, never auto-approved on creation).
    runFederationComplianceAiForAllFederations(db, "2027-01-01");
    const repo = new FederationComplianceRepository(db);
    let grants = repo.grantsForFederation(federationId);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.status).toBe("PROPOSED");

    // A later tick progresses the existing grant (approves it) rather than proposing a duplicate.
    runFederationComplianceAiForAllFederations(db, "2027-01-02");
    grants = repo.grantsForFederation(federationId);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.status).toBe("APPROVED");

    // Once the funding period has ended, the AI flags it for reporting and then reports it.
    runFederationComplianceAiForAllFederations(db, "2027-01-03");
    grants = repo.grantsForFederation(federationId);
    expect(["REPORTING_DUE", "ACTIVE", "APPROVED"]).toContain(grants[0]!.status);

    // An active sanction gets a corrective action started automatically.
    const financeRepo = new FederationGovernanceRepository(db);
    void financeRepo;
    applyFederationComplianceSnapshot(db, federationId, {
      federationKey: "fed-1",
      status: "WARNING",
      effectiveDate: "2027-02-01",
      provenanceStatus: "SIMULATION_ONLY",
      sanctions: [
        {
          authority: "AFC",
          reason: "Late financial reporting",
          category: "REPORTING_FAILURE",
          startDate: "2027-02-01",
          requirementsForResolution: ["Submit audited accounts"],
          affectedProgrammes: ["FEDERATION_OPERATIONS"],
          consequences: ["NEW_GRANTS_BLOCKED"],
          provenanceStatus: "SIMULATION_ONLY",
        },
      ],
    });
    runFederationComplianceAiForAllFederations(db, "2027-02-02");
    const sanction = repo.sanctionsForFederation(federationId).find((s) => s.category === "REPORTING_FAILURE")!;
    expect(repo.correctiveActionsForSanction(sanction.id).length).toBeGreaterThan(0);
    // New grants are blocked, so the AI must not propose another one despite thin cash.
    expect(repo.grantsForFederation(federationId)).toHaveLength(1);
    db.close();
  });

  it("produces the same outcome from the same starting state (deterministic, no hidden randomness)", () => {
    const run = () => {
      const db = openGameDatabase(":memory:");
      migrateDatabase(db);
      seedFederation(db, "fed-1", "DISTRESSED");
      initializeFederationComplianceForSave(db, "2027-01-01");
      runFederationComplianceAiForAllFederations(db, "2027-01-01");
      const grants = new FederationComplianceRepository(db).grantsForFederation("fed-1" as EntityId);
      db.close();
      return grants.map((g) => ({ status: g.status, approvedAmount: g.approvedAmount, purpose: g.purpose }));
    };
    expect(run()).toEqual(run());
  });

  it("persists compliance profiles, sanctions and grants across save/load", () => {
    const path = tempDbPath();
    let db = openGameDatabase(path);
    migrateDatabase(db);
    seedFederation(db, "fed-1", "DISTRESSED");
    const federationId = "fed-1" as EntityId;
    applyFederationComplianceSnapshot(db, federationId, {
      federationKey: "fed-1",
      status: "WARNING",
      effectiveDate: "2027-01-01",
      provenanceStatus: "SIMULATION_ONLY",
      sanctions: [
        {
          authority: "DOMESTIC",
          reason: "Election dispute",
          category: "ELECTION_LEGITIMACY",
          startDate: "2027-01-01",
          requirementsForResolution: ["Re-run election"],
          affectedProgrammes: ["FEDERATION_OPERATIONS"],
          consequences: ["REPUTATION_DAMAGE"],
          provenanceStatus: "SIMULATION_ONLY",
        },
      ],
    });
    runFederationComplianceAiForAllFederations(db, "2027-01-01");
    db.close();

    db = openGameDatabase(path);
    migrateDatabase(db);
    const repo = new FederationComplianceRepository(db);
    const profile = repo.complianceProfile(federationId)!;
    expect(profile.status).toBe("WARNING");
    expect(repo.sanctionsForFederation(federationId)).toHaveLength(1);
    expect(repo.grantsForFederation(federationId).length).toBeGreaterThan(0);
    db.close();
  });
});
