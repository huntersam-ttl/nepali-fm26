import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ClubEconomyRepository, FacilityPlanningRepository, GovernmentRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  createNepalSave,
  createFacilityProjectPlan,
  generateFacilitySiteOptions,
  initializeClubEconomyForSave,
  requestFacilitySiteGovernmentSupport,
  resolveGovernmentInstitutionForClub,
  reviewGovernmentFunding,
  runChairmanDemo,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

describe("facility project planning", () => {
  it("persists deterministic sites and applies scope/components to a canonical project", () => {
    const directory = mkdtempSync(join(tmpdir(), "facility-planning-"));
    const path = join(directory, "career.sqlite");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8")) as unknown,
      saveName: "facility planning",
      gameVersion: "test",
      randomSeed: "facility planning",
    });
    const db = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "facility planning" });
    const clubId = db.prepare("SELECT clubs.id FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE countries.iso_code IN ('NP', 'NPL') ORDER BY clubs.id LIMIT 1").get() as { id: EntityId };
    const demo = runChairmanDemo({ db, seed: "facility planning", worldDate: "2026-08-01", clubId: clubId.id });
    db.prepare("UPDATE club_ownership_stakes SET holder_id=?, percentage=100, voting_percentage=100, status='ACTIVE' WHERE club_id=? AND holder_type='PERSON'").run(demo.chairmanPersonId, clubId.id);
    const sites = generateFacilitySiteOptions(db, { clubId: clubId.id, districtId: "district-kathmandu" as EntityId, municipalityName: "Kathmandu", date: "2026-08-01", seed: "facility planning" });
    expect(sites).toHaveLength(3);
    expect(generateFacilitySiteOptions(db, { clubId: clubId.id, districtId: "district-kathmandu" as EntityId, municipalityName: "Changed name", date: "2026-08-02", seed: "other" }).map((site) => site.id).sort()).toEqual(sites.map((site) => site.id).sort());
    const sharedSite = sites.find((site) => site.siteType === "SHARED_CAMPUS")!;

    const first = createFacilityProjectPlan(db, {
      clubId: clubId.id,
      personId: demo.chairmanPersonId,
      callerRole: "CHAIRMAN_OWNER",
      projectType: "TRAINING_GROUND",
      date: "2026-08-01",
      seed: "facility planning",
      mode: "NEW_SITE",
      scope: "STANDARD",
      components: ["pitches", "gym"],
      siteOptionId: sharedSite.id,
      fundingSource: "CLUB_CASH",
      rationale: "Expand training capacity for the senior and youth teams.",
    });
    const second = createFacilityProjectPlan(db, {
      clubId: clubId.id,
      personId: demo.chairmanPersonId,
      callerRole: "CHAIRMAN_OWNER",
      projectType: "ACADEMY",
      date: "2026-08-02",
      seed: "facility planning",
      mode: "UPGRADE_EXISTING",
      scope: "EXPANDED",
      components: ["pitches", "classrooms", "accommodation", "medical"],
      fundingSource: "CLUB_CASH",
      rationale: "Create a larger academy pathway.",
    });
    expect(first.plan.mode).toBe("NEW_SITE");
    expect(first.project.siteRights).toBe("SHARED");
    expect(first.project.components).toEqual(["pitches", "gym"]);
    expect(second.project.capitalCost).toBeGreaterThan(first.project.capitalCost);
    expect(second.plan.durationBand).not.toBe("SHORT");
    expect(new FacilityPlanningRepository(db).plans(clubId.id)).toHaveLength(2);
    expect(new ClubEconomyRepository(db).infrastructureProjects(clubId.id).map((project) => project.id)).toContain(first.project.id);
    db.close();

    const reloaded = openGameDatabase(path);
    expect(new FacilityPlanningRepository(reloaded).planByProject(first.project.id)?.siteOptionId).toBe(sharedSite.id);
    expect(new FacilityPlanningRepository(reloaded).siteOptions(clubId.id, "district-kathmandu" as EntityId).map((site) => site.id).sort()).toEqual(sites.map((site) => site.id).sort());
    reloaded.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("breaks the government-review site circularity: no project needed to request, none duplicated after approval", () => {
    // Regression for the exact deadlock: createFacilityProjectPlan refused a
    // GOVERNMENT_REVIEW site without a governmentApplicationId, but the only
    // way to open one (requestClubInfrastructureGovernmentSupport) required
    // an existing InfrastructureProject — which only createFacilityProjectPlan
    // itself created. requestFacilitySiteGovernmentSupport anchors the
    // request on the site option directly, with no project required either
    // side of approval.
    const directory = mkdtempSync(join(tmpdir(), "facility-planning-circularity-"));
    const path = join(directory, "career.sqlite");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8")) as unknown,
      saveName: "facility circularity",
      gameVersion: "test",
      randomSeed: "facility circularity",
    });
    const db = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "facility circularity" });
    const clubId = (
      db
        .prepare(
          "SELECT clubs.id FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE countries.iso_code IN ('NP', 'NPL') AND clubs.location_id IS NOT NULL ORDER BY clubs.id LIMIT 1",
        )
        .get() as { id: EntityId }
    ).id;
    const demo = runChairmanDemo({ db, seed: "facility circularity", worldDate: "2026-08-01", clubId });
    db.prepare(
      "UPDATE club_ownership_stakes SET holder_id=?, percentage=100, voting_percentage=100, status='ACTIVE' WHERE club_id=? AND holder_type='PERSON'",
    ).run(demo.chairmanPersonId, clubId);
    // runChairmanDemo itself seeds one demo project; every assertion below
    // tracks the delta from this baseline, not an absolute count.
    const baselineProjectCount = new ClubEconomyRepository(db).infrastructureProjects(clubId).length;

    // No institution seeded yet at all: the resolver must be honest, never fabricate.
    expect(resolveGovernmentInstitutionForClub(db, clubId)).toBeUndefined();

    const sites = generateFacilitySiteOptions(db, {
      clubId,
      districtId: "district-kathmandu" as EntityId,
      municipalityName: "Kathmandu",
      date: "2026-08-01",
      seed: "facility circularity",
    });
    const governmentSite = sites.find((site) => site.readiness === "GOVERNMENT_REVIEW")!;
    expect(governmentSite).toBeTruthy();

    expect(() =>
      requestFacilitySiteGovernmentSupport(db, {
        clubId,
        siteOptionId: governmentSite.id,
        fundingType: "MUNICIPAL_LAND_OR_VENUE",
        requestedAmount: 2_000_000,
        date: "2026-08-01",
      }),
    ).toThrow(/government institution/i);

    new GovernmentRepository(db).upsertInstitution({
      id: "nsc-institution" as EntityId,
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
    expect(resolveGovernmentInstitutionForClub(db, clubId)?.id).toBe("nsc-institution");

    // The circularity, broken: no InfrastructureProject exists anywhere yet.
    expect(new ClubEconomyRepository(db).infrastructureProjects(clubId)).toHaveLength(baselineProjectCount);
    expect(() =>
      createFacilityProjectPlan(db, {
        clubId,
        personId: demo.chairmanPersonId,
        callerRole: "CHAIRMAN_OWNER",
        projectType: "STADIUM",
        date: "2026-08-01",
        seed: "facility circularity",
        mode: "NEW_SITE",
        scope: "STANDARD",
        siteOptionId: governmentSite.id,
        fundingSource: "CLUB_CASH",
        rationale: "New municipal ground.",
      }),
    ).toThrow(/government application/i);

    const application = requestFacilitySiteGovernmentSupport(db, {
      clubId,
      siteOptionId: governmentSite.id,
      fundingType: "MUNICIPAL_LAND_OR_VENUE",
      requestedAmount: 2_000_000,
      date: "2026-08-02",
    });
    expect(application.status).toBe("PROPOSED");
    // Still no project created by opening the request.
    expect(new ClubEconomyRepository(db).infrastructureProjects(clubId)).toHaveLength(baselineProjectCount);

    const reviewed = reviewGovernmentFunding(db, {
      applicationId: application.id,
      reviewedOn: "2026-08-05",
      evidence: {
        federationCredibility: 90,
        projectQuality: 85,
        footballPerformance: 70,
        existingCommitments: 10,
      },
    });
    expect(["APPROVED", "CONDITIONAL"]).toContain(reviewed.status);
    const releasedSite = new FacilityPlanningRepository(db)
      .siteOptions(clubId, "district-kathmandu" as EntityId)
      .find((site) => site.id === governmentSite.id);
    expect(releasedSite?.readiness).toBe("AVAILABLE");
    // Approval alone still creates no project — only createFacilityProjectPlan does.
    expect(new ClubEconomyRepository(db).infrastructureProjects(clubId)).toHaveLength(baselineProjectCount);

    const plan = createFacilityProjectPlan(db, {
      clubId,
      personId: demo.chairmanPersonId,
      callerRole: "CHAIRMAN_OWNER",
      projectType: "STADIUM",
      date: "2026-08-06",
      seed: "facility circularity",
      mode: "NEW_SITE",
      scope: "STANDARD",
      siteOptionId: governmentSite.id,
      fundingSource: "CLUB_CASH",
      rationale: "New municipal ground.",
    });
    expect(plan.project.id).toBeTruthy();
    // Exactly one new project — never a placeholder plus a canonical duplicate.
    expect(new ClubEconomyRepository(db).infrastructureProjects(clubId)).toHaveLength(
      baselineProjectCount + 1,
    );

    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("rejects a new-site plan without a persisted site option", () => {
    const db = openGameDatabase(":memory:");
    expect(() => createFacilityProjectPlan(db, {
      clubId: "missing-club" as EntityId,
      personId: "missing-person" as EntityId,
      callerRole: "CHAIRMAN_OWNER",
      projectType: "TRAINING_GROUND",
      date: "2026-08-01",
      seed: "facility planning",
      mode: "NEW_SITE",
      scope: "BASIC",
      fundingSource: "CLUB_CASH",
      rationale: "No site selected",
    })).toThrow(/site option/);
    db.close();
  });
});
