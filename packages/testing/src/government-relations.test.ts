import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GovernmentRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, governmentOverview, requestGovernmentFunding, reviewGovernmentFunding, submitGovernmentFunding } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * Covers the government-relations read model and funding-request command
 * behind the new "Government relations" UI: an honest empty state on a
 * fresh save, correct banding/filtering once real institution/relationship
 * data exists, and a real PROPOSED application from the write path.
 */
describe("government relations read model and funding request", () => {
  const setup = () => {
    const directory = mkdtempSync(join(tmpdir(), "government-relations-"));
    const path = join(directory, "career.sqlite");
    const datasetPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(datasetPath, "utf8")) as unknown,
      saveName: "government-relations",
      gameVersion: "test",
      randomSeed: "government-relations",
    });
    const db = openGameDatabase(path);
    const federationId = (
      db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: string }
    ).id as EntityId;
    return { directory, db, federationId };
  };

  it("returns an honest empty overview when no institution has ever engaged", () => {
    const { directory, db, federationId } = setup();
    const overview = governmentOverview(db, federationId);
    expect(overview.institutions).toEqual([]);
    expect(overview.applications).toEqual([]);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("bands real institution/relationship data and scopes applications to the federation", () => {
    const { directory, db, federationId } = setup();
    const repo = new GovernmentRepository(db);
    repo.upsertInstitution({
      id: "test-institution" as EntityId,
      name: "National Sports Council",
      institutionType: "NATIONAL_SPORTS_COUNCIL",
      profile: {
        budgetCapacity: 40_000_000,
        committedBudget: 12_000_000,
        footballPriority: 60,
        credibilityTowardFederation: 55,
        infrastructurePriority: 80,
        youthWomenPriority: 20,
      },
      provenanceStatus: "SIMULATION_ONLY",
    });
    repo.upsertRelationship({
      id: "test-relationship" as EntityId,
      institutionId: "test-institution" as EntityId,
      entityId: federationId,
      entityType: "FEDERATION",
      trust: 82,
      provenanceStatus: "SIMULATION_ONLY",
    });
    // A different federation's application must never leak into this one's overview.
    repo.upsertApplication({
      id: "other-federation-app" as EntityId,
      institutionId: "test-institution" as EntityId,
      federationId: "some-other-federation" as EntityId,
      fundingType: "MUNICIPAL_LAND_OR_VENUE",
      requestedAmount: 1_000_000,
      status: "PROPOSED",
      conditions: [],
      proposedOn: "2026-08-01",
      provenanceStatus: "SIMULATION_ONLY",
    });

    const overview = governmentOverview(db, federationId);
    expect(overview.institutions).toHaveLength(1);
    const [institution] = overview.institutions;
    expect(institution.relationshipBand).toBe("STRONG");
    expect(institution.infrastructurePriorityBand).toBe("VERY_HIGH");
    expect(institution.youthWomenPriorityBand).toBe("LOW");
    expect(institution.estimatedAvailableFunding).toBe(28_000_000);
    expect(overview.applications).toEqual([]);

    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("records a real PROPOSED application through the funding-request command", () => {
    const { directory, db, federationId } = setup();
    const repo = new GovernmentRepository(db);
    repo.upsertInstitution({
      id: "test-institution" as EntityId,
      name: "National Sports Council",
      institutionType: "NATIONAL_SPORTS_COUNCIL",
      profile: {
        budgetCapacity: 40_000_000,
        committedBudget: 0,
        footballPriority: 60,
        credibilityTowardFederation: 55,
        infrastructurePriority: 60,
        youthWomenPriority: 60,
      },
      provenanceStatus: "SIMULATION_ONLY",
    });

    const application = requestGovernmentFunding(db, {
      federationId,
      institutionId: "test-institution" as EntityId,
      fundingType: "MUNICIPAL_LAND_OR_VENUE",
      requestedAmount: 5_000_000,
      date: "2026-08-15",
    });
    expect(application.status).toBe("PROPOSED");
    expect(application.federationId).toBe(federationId);

    const overview = governmentOverview(db, federationId);
    expect(overview.applications).toHaveLength(1);
    expect(overview.applications[0]!.id).toBe(application.id);
    expect(overview.applications[0]!.requestedAmount).toBe(5_000_000);

    expect(() =>
      requestGovernmentFunding(db, {
        federationId,
        institutionId: "test-institution" as EntityId,
        fundingType: "MUNICIPAL_LAND_OR_VENUE",
        requestedAmount: 0,
        date: "2026-08-15",
      }),
    ).toThrow(/positive number/);

    expect(() =>
      requestGovernmentFunding(db, {
        federationId,
        institutionId: "missing-institution" as EntityId,
        fundingType: "MUNICIPAL_LAND_OR_VENUE",
        requestedAmount: 5_000_000,
        date: "2026-08-15",
      }),
    ).toThrow(/missing/);

    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("progresses relationship trust once across submission and review, including after reload", () => {
    const { directory, db, federationId } = setup();
    const repo = new GovernmentRepository(db);
    const institutionId = "review-institution" as EntityId;
    repo.upsertInstitution({
      id: institutionId,
      name: "National Sports Council",
      institutionType: "NATIONAL_SPORTS_COUNCIL",
      profile: {
        budgetCapacity: 40_000_000,
        committedBudget: 0,
        footballPriority: 80,
        credibilityTowardFederation: 70,
        infrastructurePriority: 80,
        youthWomenPriority: 70,
      },
      provenanceStatus: "SIMULATION_ONLY",
    });

    const application = requestGovernmentFunding(db, {
      federationId,
      institutionId,
      fundingType: "INFRASTRUCTURE",
      requestedAmount: 5_000_000,
      date: "2026-08-15",
    });
    expect(repo.relationships(institutionId)[0]?.trust).toBe(51);

    const submitted = submitGovernmentFunding(db, application.id);
    expect(submitted.status).toBe("SUBMITTED");
    expect(repo.relationships(institutionId)[0]?.trust).toBe(53);

    const reviewed = reviewGovernmentFunding(db, {
      applicationId: application.id,
      reviewedOn: "2026-08-16",
      evidence: {
        federationCredibility: 90,
        projectQuality: 90,
        footballPerformance: 80,
        existingCommitments: 0,
      },
    });
    expect(reviewed.status).toBe("APPROVED");
    expect(repo.relationships(institutionId)[0]?.trust).toBe(58);

    const reloaded = openGameDatabase(join(directory, "career.sqlite"));
    const trustAfterReload = new GovernmentRepository(reloaded).relationships(institutionId)[0]?.trust;
    expect(trustAfterReload).toBe(58);
    expect(reviewGovernmentFunding(reloaded, {
      applicationId: application.id,
      reviewedOn: "2026-08-17",
      evidence: {
        federationCredibility: 90,
        projectQuality: 90,
        footballPerformance: 80,
        existingCommitments: 0,
      },
    }).status).toBe("APPROVED");
    expect(new GovernmentRepository(reloaded).relationships(institutionId)[0]?.trust).toBe(58);

    reloaded.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("records a bounded relationship setback for a rejected request", () => {
    const { directory, db, federationId } = setup();
    const repo = new GovernmentRepository(db);
    const institutionId = "reject-institution" as EntityId;
    repo.upsertInstitution({
      id: institutionId,
      name: "Municipality",
      institutionType: "MUNICIPALITY",
      profile: {
        budgetCapacity: 10,
        committedBudget: 10,
        footballPriority: 10,
        credibilityTowardFederation: 20,
        infrastructurePriority: 10,
        youthWomenPriority: 10,
      },
      provenanceStatus: "SIMULATION_ONLY",
    });
    const application = requestGovernmentFunding(db, {
      federationId,
      institutionId,
      fundingType: "MUNICIPAL_LAND_OR_VENUE",
      requestedAmount: 5_000,
      date: "2026-08-15",
    });
    submitGovernmentFunding(db, application.id);
    expect(reviewGovernmentFunding(db, {
      applicationId: application.id,
      reviewedOn: "2026-08-16",
      evidence: {
        federationCredibility: 0,
        projectQuality: 0,
        footballPerformance: 0,
        existingCommitments: 100,
      },
    }).status).toBe("REJECTED");
    expect(repo.relationships(institutionId)[0]?.trust).toBe(50);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
