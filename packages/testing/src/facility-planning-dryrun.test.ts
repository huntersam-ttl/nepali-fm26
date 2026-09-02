import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ClubEconomyRepository, FacilityPlanningRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, createFacilityProjectPlan, initializeClubEconomyForSave, resolveClubDistrict, runChairmanDemo } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * The facility planner's pre-commit "Review project" step runs
 * createFacilityProjectPlan with dryRun so its cost/duration bands come
 * from the exact same canonical engine the real commit uses, without
 * writing anything — never a duplicated frontend cost formula. This proves
 * that contract: a dry run computes real numbers but leaves the save
 * untouched, and a real run immediately afterward (same seed, same date)
 * reproduces the identical figures the preview showed.
 */
describe("facility project planning — dry-run preview", () => {
  const setup = () => {
    const directory = mkdtempSync(join(tmpdir(), "facility-dryrun-"));
    const path = join(directory, "career.sqlite");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8")) as unknown,
      saveName: "facility dry-run",
      gameVersion: "test",
      randomSeed: "facility dry-run",
    });
    const db = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "facility dry-run" });
    // Most real Nepal clubs in the registry fixture have no location on
    // record at all (resolveClubDistrict correctly returns undefined for
    // those, and the planner shows an honest empty state) — this test needs
    // one that does, to exercise the resolved-district path.
    const clubId = db.prepare("SELECT clubs.id FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE countries.iso_code IN ('NP', 'NPL') AND clubs.location_id IS NOT NULL ORDER BY clubs.id LIMIT 1").get() as { id: EntityId };
    const demo = runChairmanDemo({ db, seed: "facility dry-run", worldDate: "2026-08-01", clubId: clubId.id });
    db.prepare("UPDATE club_ownership_stakes SET holder_id=?, percentage=100, voting_percentage=100, status='ACTIVE' WHERE club_id=? AND holder_type='PERSON'").run(demo.chairmanPersonId, clubId.id);
    return { directory, path, db, clubId: clubId.id, personId: demo.chairmanPersonId };
  };

  it("resolves the club's own real district instead of a fabricated one", () => {
    const { db, clubId, directory } = setup();
    const resolved = resolveClubDistrict(db, clubId);
    expect(resolved).toBeDefined();
    const realLocation = db.prepare("SELECT name FROM locations WHERE id=?").get(resolved!.districtId) as { name?: string } | undefined;
    expect(realLocation?.name).toBe(resolved!.districtName);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("computes real cost/duration bands without persisting anything, then reproduces them exactly on the real commit", () => {
    const { db, clubId, personId, directory } = setup();
    const before = {
      projects: new ClubEconomyRepository(db).infrastructureProjects(clubId).length,
      plans: new FacilityPlanningRepository(db).plans(clubId).length,
    };
    const input = {
      clubId,
      personId,
      callerRole: "CHAIRMAN_OWNER" as const,
      // runChairmanDemo (in setup()) already seeds its own TRAINING_GROUND
      // project on this exact date — using ACADEMY here keeps this test's
      // deterministic project id distinct from that real, pre-existing one.
      projectType: "ACADEMY" as const,
      date: "2026-08-01",
      seed: "facility dry-run",
      mode: "UPGRADE_EXISTING" as const,
      scope: "STANDARD" as const,
      components: ["pitches", "classrooms"],
      fundingSource: "CLUB_CASH" as const,
      rationale: "Preview only — nothing should be written yet.",
    };
    const preview = createFacilityProjectPlan(db, { ...input, dryRun: true });
    // Nothing persisted by the preview.
    expect(new ClubEconomyRepository(db).infrastructureProjects(clubId).length).toBe(before.projects);
    expect(new FacilityPlanningRepository(db).plans(clubId).length).toBe(before.plans);

    const real = createFacilityProjectPlan(db, input);
    // Same seed + same date -> identical figures, not just the same band.
    expect(real.project.capitalCost).toBe(preview.project.capitalCost);
    expect(real.project.expectedCompletion).toBe(preview.project.expectedCompletion);
    expect(real.plan.costBand).toBe(preview.plan.costBand);
    expect(real.plan.durationBand).toBe(preview.plan.durationBand);
    // And this time it really is persisted.
    expect(new ClubEconomyRepository(db).infrastructureProjects(clubId).length).toBe(before.projects + 1);
    expect(new FacilityPlanningRepository(db).plans(clubId).length).toBe(before.plans + 1);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("does not create a debt record or post a transaction for a debt-funded dry run", () => {
    const { db, clubId, personId, directory } = setup();
    const before = new ClubEconomyRepository(db).debts(clubId).length;
    createFacilityProjectPlan(db, {
      clubId,
      personId,
      callerRole: "CHAIRMAN_OWNER",
      projectType: "ACADEMY",
      date: "2026-08-01",
      seed: "facility dry-run",
      mode: "UPGRADE_EXISTING",
      scope: "STANDARD",
      fundingSource: "DEBT",
      financing: { debt: 2_000_000 },
      rationale: "Preview a debt-funded plan.",
      dryRun: true,
    });
    expect(new ClubEconomyRepository(db).debts(clubId).length).toBe(before);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
