import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ClubEconomyRepository, FacilityPlanningRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, createFacilityProjectPlan, generateFacilitySiteOptions, initializeClubEconomyForSave, runChairmanDemo } from "@nepal-football-sim/simulation";
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
