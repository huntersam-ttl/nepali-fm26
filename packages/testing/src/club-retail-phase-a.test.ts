import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, EventRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  advanceInfrastructureProjects,
  createInfrastructureProject,
  createNepalSave,
  initializeClubEconomyForSave,
  postMerchandiseRevenue,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * Club Store Phase 1: a completed RETAIL_STORE infrastructure project
 * raises ClubCommercialProfile.merchandiseAppeal, which
 * postMerchandiseRevenue already reads every month (this monthly hook,
 * the MERCHANDISE ledger category, and the ClubCommercialProfile itself
 * all pre-date this feature — see docs/game-design/CLUB_RETAIL.md for
 * the full audit). No new ledger category, no new revenue-posting
 * function, no parallel project lifecycle: this is entirely a new
 * InfrastructureProjectType flowing through the existing canonical
 * facility pipeline.
 */

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "club-retail-phase-a-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: seed,
    gameVersion: "test",
    randomSeed: seed,
  });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("club retail phase A — RETAIL_STORE raises merchandiseAppeal through the canonical facility pipeline", () => {
  it("completes a RETAIL_STORE project like any other facility project and records it as a BUILDING asset", () => {
    const db = openGameDatabase(makeSave("club-retail-lifecycle"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "club-retail-lifecycle" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };

    const project = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "RETAIL_STORE",
      date: "2026-08-01",
      seed: "club-retail-lifecycle",
    });
    expect(project.capitalCost).toBeGreaterThan(0);

    advanceInfrastructureProjects(db, { date: "2027-12-01", seed: "club-retail-lifecycle" });
    const economy = new ClubEconomyRepository(db);
    const completed = economy.infrastructureProjects(club.id).find((item) => item.id === project.id);
    expect(completed?.status).toBe("COMPLETED");
    expect(economy.assets(club.id).some((asset) => asset.assetType === "BUILDING")).toBe(true);
    expect(
      new EventRepository(db)
        .historicalEvents()
        .filter((item) => item.eventType === "FACILITY_PROJECT_COMPLETED"),
    ).toHaveLength(1);
    db.close();
  });

  it("raises merchandiseAppeal by a bounded amount on completion, and caps it at 100 rather than compounding unboundedly", () => {
    const db = openGameDatabase(makeSave("club-retail-appeal"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "club-retail-appeal" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    const economy = new ClubEconomyRepository(db);
    const before = economy.commercialProfile(club.id)!.merchandiseAppeal;

    const project = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "RETAIL_STORE",
      date: "2026-08-01",
      seed: "club-retail-appeal",
    });
    advanceInfrastructureProjects(db, { date: "2027-12-01", seed: "club-retail-appeal" });
    const after = economy.commercialProfile(club.id)!.merchandiseAppeal;
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeLessThanOrEqual(6);
    expect(after).toBeLessThanOrEqual(100);

    // Force merchandiseAppeal near the cap, then complete a second store —
    // the bump must clamp, never push it past 100.
    const commercial = economy.commercialProfile(club.id)!;
    economy.upsertCommercialProfile({ ...commercial, merchandiseAppeal: 97 });
    const secondProject = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "RETAIL_STORE",
      date: "2027-12-01",
      seed: "club-retail-appeal-2",
    });
    advanceInfrastructureProjects(db, { date: "2029-06-01", seed: "club-retail-appeal-2" });
    expect(economy.infrastructureProjects(club.id).find((item) => item.id === secondProject.id)?.status).toBe(
      "COMPLETED",
    );
    expect(economy.commercialProfile(club.id)!.merchandiseAppeal).toBeLessThanOrEqual(100);
    db.close();
  });

  it("a completed club store measurably increases the club's actual monthly merchandise revenue", () => {
    const before = openGameDatabase(makeSave("club-retail-revenue"));
    const after = openGameDatabase(makeSave("club-retail-revenue"));
    initializeClubEconomyForSave({ db: before, worldDate: "2026-08-01", seed: "club-retail-revenue" });
    initializeClubEconomyForSave({ db: after, worldDate: "2026-08-01", seed: "club-retail-revenue" });
    const club = before.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };

    // "before": no retail upgrade, just the baseline merchandise revenue
    // the game already ticks every month.
    const revenueBefore = postMerchandiseRevenue(before, {
      clubId: club.id,
      date: "2026-08-03",
      seed: "club-retail-revenue",
    });

    // "after": same starting world, but with a completed retail upgrade
    // before the same revenue tick runs.
    createInfrastructureProject(after, {
      clubId: club.id,
      projectType: "RETAIL_STORE",
      date: "2026-08-01",
      seed: "club-retail-revenue",
    });
    advanceInfrastructureProjects(after, { date: "2027-12-01", seed: "club-retail-revenue" });
    const revenueAfter = postMerchandiseRevenue(after, {
      clubId: club.id,
      date: "2027-12-03",
      seed: "club-retail-revenue",
    });

    expect(revenueAfter).toBeGreaterThan(revenueBefore);
    before.close();
    after.close();
  });
});
