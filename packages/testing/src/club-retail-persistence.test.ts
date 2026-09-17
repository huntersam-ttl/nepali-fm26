import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, ClubVisualIdentityRepository, openGameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService, postMerchandiseRevenue } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * Club Commercial Phase 1C — persistence, old-save tolerance and history
 * correctness for the Club Store.
 *
 * These drive the real DesktopApplicationService end to end (create career,
 * advance the canonical economy, save, load) rather than exercising a
 * repository in isolation: the claim under test is that what the Owner reads
 * on the Club Store survives a real save/load cycle, and that it is derived
 * from the real MERCHANDISE ledger rather than any state of its own.
 */

// seedE2ERoleFixture is deliberately gated; it is the supported way to hold
// the CHAIRMAN_OWNER role, which is what the commercial overview requires.
process.env.NEPAL_E2E_ROLE_FIXTURE = "1";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const onlySaveFile = (savesDirectory: string): string => {
  const file = readdirSync(savesDirectory).find((name) => name.endsWith(".sqlite"));
  if (!file) throw new Error("no save file found");
  return join(savesDirectory, file);
};

const character = {
  fullName: "Commercial Tester",
  preferredDisplayName: "Tester",
  dateOfBirth: "1993-05-12",
  startingAge: 33,
  languages: ["ne", "en"],
  footballBackground: "COMMUNITY_COACHING",
  education: "SPORTS_RELATED_DEGREE",
  playingExperience: "AMATEUR_PLAYER",
  coachingExperience: "YOUTH_COACH",
  businessBackground: "SMALL_BUSINESS",
  startingReputationProfile: "LOCAL_RESPECTED",
};

type OwnerCareer = {
  runtime: DesktopApplicationService;
  savesDirectory: string;
  saveId: EntityId;
};

/** A real career whose player holds the Chairman/Owner role, created the
 * same way the browser fixture does. */
const createOwnerCareer = (saveName: string): OwnerCareer => {
  const savesDirectory = tempDir("club-retail-persistence-");
  const runtime = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
  const clubs = runtime.listStartingClubs();
  if (!clubs.ok) throw new Error("failed to list starting clubs");
  const created = runtime.createCareer({ saveName, joinTeamId: clubs.data[0]!.teamId, character });
  if (!created.ok) throw new Error(`failed to create career: ${created.error.message}`);
  const fixture = runtime.seedE2ERoleFixture();
  if (!fixture.ok) throw new Error(`failed to seed role fixture: ${fixture.error.message}`);
  const switched = runtime.switchActiveCareerRole("CHAIRMAN_OWNER");
  if (!switched.ok) throw new Error(`failed to take the owner role: ${switched.error.message}`);
  return { runtime, savesDirectory, saveId: created.data.save.id };
};

const overviewOf = (runtime: DesktopApplicationService) => {
  const result = runtime.getClubCommercialOverview();
  if (!result.ok) throw new Error(`commercial overview failed: ${result.error.message}`);
  return result.data;
};

/** Advances the real world until the canonical monthly economy tick posts
 * merchandise revenue, exactly as pressing Continue would. */
const advanceUntilMerchandisePosted = (runtime: DesktopApplicationService, maxSteps = 12) => {
  for (let step = 0; step < maxSteps; step += 1) {
    const current = overviewOf(runtime);
    if (current.seasonMerchandiseRevenue > 0) return current;
    const advanced = runtime.continueCareer();
    if (!advanced.ok) throw new Error(`continueCareer failed: ${advanced.error.message}`);
  }
  return overviewOf(runtime);
};

describe("club retail persistence — save/load, old saves and season history", () => {
  it("reports honest zeros for a club that has never traded, inventing no history", () => {
    const { runtime } = createOwnerCareer("Retail Zero State");
    const overview = overviewOf(runtime);

    expect(overview.seasonMerchandiseRevenue).toBe(0);
    expect(overview.seasonShirtRevenue).toBe(0);
    expect(overview.seasonShirtUnits).toBe(0);
    expect(overview.homeShirtUnits).toBe(0);
    expect(overview.awayShirtUnits).toBe(0);
    expect(overview.thirdShirtUnits).toBe(0);
    expect(overview.seasonHistory).toEqual([]);
    expect(overview.recentMerchandisePostings).toEqual([]);
    // No store has been built, so the status must default conservatively.
    expect(overview.retailStatus).toBe("NONE");
    expect(overview.completedRetailStores).toBe(0);
    expect(overview.activeRetailProject).toBeUndefined();
    // Identity still resolves — the club exists even though it has not traded.
    expect(overview.clubName.length).toBeGreaterThan(0);
    expect(overview.provenanceStatus).toBe("SIMULATION_ONLY");
  });

  it("preserves every ledger-derived commercial figure across a real save and load", () => {
    const { runtime, savesDirectory, saveId } = createOwnerCareer("Retail Save Load");
    const before = advanceUntilMerchandisePosted(runtime);
    expect(
      before.seasonMerchandiseRevenue,
      "the monthly economy tick should have posted merchandise revenue",
    ).toBeGreaterThan(0);

    const saved = runtime.saveCareer();
    expect(saved.ok, "saveCareer should succeed").toBe(true);

    // A genuinely separate service instance loading the save from disk —
    // not the same in-memory session answering again.
    const reopened = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const loaded = reopened.loadCareer(saveId);
    expect(loaded.ok, "loadCareer should succeed").toBe(true);
    const switched = reopened.switchActiveCareerRole("CHAIRMAN_OWNER");
    expect(switched.ok, "the owner role should survive the reload").toBe(true);

    const after = overviewOf(reopened);
    expect(after.seasonMerchandiseRevenue).toBe(before.seasonMerchandiseRevenue);
    expect(after.seasonShirtRevenue).toBe(before.seasonShirtRevenue);
    expect(after.seasonShirtUnits).toBe(before.seasonShirtUnits);
    expect(after.homeShirtUnits).toBe(before.homeShirtUnits);
    expect(after.awayShirtUnits).toBe(before.awayShirtUnits);
    expect(after.thirdShirtUnits).toBe(before.thirdShirtUnits);
    expect(after.merchandiseAppeal).toBe(before.merchandiseAppeal);
    expect(after.retailStatus).toBe(before.retailStatus);
    expect(after.completedRetailStores).toBe(before.completedRetailStores);
    expect(after.seasonHistory).toEqual(before.seasonHistory);
    expect(after.recentMerchandisePostings).toEqual(before.recentMerchandisePostings);

    // And the underlying ledger really is on disk, not merely cached.
    const db = openGameDatabase(onlySaveFile(savesDirectory));
    const entries = new ClubEconomyRepository(db)
      .ledgerEntries(before.clubId)
      .filter((entry) => entry.category === "MERCHANDISE" && entry.direction === "CREDIT");
    expect(entries.length).toBeGreaterThan(0);
    db.close();
  });

  it("totals exactly the real MERCHANDISE ledger, with no drift or double counting", () => {
    const { runtime, savesDirectory, saveId } = createOwnerCareer("Retail Ledger Exact");
    advanceUntilMerchandisePosted(runtime);
    expect(runtime.saveCareer().ok).toBe(true);

    // Add further postings in the same season, directly through the
    // canonical revenue function, so the season carries several entries.
    const savePath = onlySaveFile(savesDirectory);
    const seeded = openGameDatabase(savePath);
    const clubId = overviewOf(runtime).clubId;
    postMerchandiseRevenue(seeded, { clubId, date: "2026-11-04", seed: "ledger-exact-a" });
    postMerchandiseRevenue(seeded, { clubId, date: "2026-12-04", seed: "ledger-exact-b" });
    const expected = new ClubEconomyRepository(seeded)
      .ledgerEntries(clubId)
      .filter((entry) => entry.category === "MERCHANDISE" && entry.direction === "CREDIT");
    const expectedSeasonTotal = expected
      .filter((entry) => entry.date.slice(0, 4) === "2026")
      .reduce((total, entry) => total + entry.amount, 0);
    expect(expected.length).toBeGreaterThan(2);
    seeded.close();

    const reopened = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    expect(reopened.loadCareer(saveId).ok).toBe(true);
    expect(reopened.switchActiveCareerRole("CHAIRMAN_OWNER").ok).toBe(true);
    const overview = overviewOf(reopened);

    expect(overview.seasonMerchandiseRevenue).toBe(expectedSeasonTotal);
    const season2026 = overview.seasonHistory.find((row) => row.seasonKey === "2026");
    expect(season2026?.merchandiseRevenue).toBe(expectedSeasonTotal);
    // Shirt money is a strict subset of the merchandise the ledger recorded.
    expect(overview.seasonShirtRevenue).toBeLessThanOrEqual(overview.seasonMerchandiseRevenue);
    expect(overview.homeShirtUnits + overview.awayShirtUnits + overview.thirdShirtUnits).toBe(
      overview.seasonShirtUnits,
    );
    // Postings are the real entries, newest first, and capped.
    expect(overview.recentMerchandisePostings.length).toBeLessThanOrEqual(6);
    const dates = overview.recentMerchandisePostings.map((posting) => posting.date);
    expect([...dates].sort((left, right) => right.localeCompare(left))).toEqual(dates);
  });

  it("groups seasons in ascending order and joins each to that season's own kits", () => {
    const { runtime, savesDirectory, saveId } = createOwnerCareer("Retail Season History");
    advanceUntilMerchandisePosted(runtime);
    expect(runtime.saveCareer().ok).toBe(true);
    const clubId = overviewOf(runtime).clubId;

    // Two distinct trading seasons, each with its own recorded kit snapshot —
    // the situation the Club Store's season history exists to describe.
    const savePath = onlySaveFile(savesDirectory);
    const seeded = openGameDatabase(savePath);
    postMerchandiseRevenue(seeded, { clubId, date: "2027-05-04", seed: "season-b" });
    const identity = new ClubVisualIdentityRepository(seeded);
    const kitJson = (base: string) =>
      JSON.stringify({
        baseColour: base,
        secondaryColour: "#ffffff",
        trimColour: "#000000",
        pattern: "PLAIN",
        shortsColour: base,
        socksColour: base,
      });
    identity.snapshotSeasonIfAbsent({
      id: "kit-history-2026" as EntityId,
      clubId,
      seasonKey: "2026",
      homeKitJson: kitJson("#aa0000"),
      awayKitJson: kitJson("#aa0001"),
      thirdKitJson: kitJson("#aa0002"),
      createdAt: "2026-08-01",
    });
    identity.snapshotSeasonIfAbsent({
      id: "kit-history-2027" as EntityId,
      clubId,
      seasonKey: "2027",
      homeKitJson: kitJson("#0000bb"),
      awayKitJson: kitJson("#0000bc"),
      thirdKitJson: kitJson("#0000bd"),
      createdAt: "2027-08-01",
    });
    seeded.close();

    const reopened = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    expect(reopened.loadCareer(saveId).ok).toBe(true);
    expect(reopened.switchActiveCareerRole("CHAIRMAN_OWNER").ok).toBe(true);
    const overview = overviewOf(reopened);

    const keys = overview.seasonHistory.map((row) => row.seasonKey);
    expect(keys, "season history is grouped in ascending season order").toEqual(
      [...keys].sort((left, right) => left.localeCompare(right)),
    );
    expect(keys).toContain("2026");
    expect(keys).toContain("2027");

    // Each season's kits are the ones recorded for that season — the join key
    // is the same plain 4-digit season key the history is grouped by, so the
    // two line up without any duplicate kit storage.
    const history = reopened.getClubKitHistory(clubId);
    expect(history.ok).toBe(true);
    if (history.ok) {
      const byKey = new Map(history.data.map((entry) => [entry.seasonKey, entry]));
      expect(byKey.get("2026")?.homeKit.baseColour).toBe("#aa0000");
      expect(byKey.get("2027")?.homeKit.baseColour).toBe("#0000bb");
      for (const row of overview.seasonHistory) {
        if (row.seasonKey === "2026" || row.seasonKey === "2027") {
          expect(byKey.has(row.seasonKey), `season ${row.seasonKey} joins to a kit snapshot`).toBe(true);
        }
      }
    }

    // Every season row stays internally consistent.
    for (const row of overview.seasonHistory) {
      expect(row.homeShirtUnits + row.awayShirtUnits + row.thirdShirtUnits).toBe(row.shirtUnits);
      expect(row.shirtRevenue).toBeLessThanOrEqual(row.merchandiseRevenue);
      expect(Number.isFinite(row.merchandiseRevenue)).toBe(true);
    }
  });

  it("loads a save that predates the retail feature: merchandise trade, but no store and no retail state", () => {
    const { runtime, savesDirectory, saveId } = createOwnerCareer("Retail Old Save");
    const traded = advanceUntilMerchandisePosted(runtime);
    expect(traded.seasonMerchandiseRevenue).toBeGreaterThan(0);
    expect(runtime.saveCareer().ok).toBe(true);

    // This is exactly the shape of a pre-feature save: a real
    // ClubCommercialProfile and real MERCHANDISE ledger entries, but no
    // RETAIL_STORE project and no commercial-dashboard state of any kind.
    const db = openGameDatabase(onlySaveFile(savesDirectory));
    const economy = new ClubEconomyRepository(db);
    const retailProjects = economy
      .infrastructureProjects(traded.clubId)
      .filter((project) => project.projectType === "RETAIL_STORE");
    expect(retailProjects, "the pre-feature save has no retail project at all").toEqual([]);
    expect(economy.commercialProfile(traded.clubId)).toBeDefined();
    db.close();

    const reopened = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    expect(reopened.loadCareer(saveId).ok, "an old-shaped save loads without migration failure").toBe(true);
    expect(reopened.switchActiveCareerRole("CHAIRMAN_OWNER").ok).toBe(true);

    const overview = overviewOf(reopened);
    expect(overview.retailStatus).toBe("NONE");
    expect(overview.completedRetailStores).toBe(0);
    expect(overview.activeRetailProject).toBeUndefined();
    // The analytics still derive correctly from the revenue that is there.
    expect(overview.seasonMerchandiseRevenue).toBe(traded.seasonMerchandiseRevenue);
    expect(overview.seasonShirtUnits).toBe(traded.seasonShirtUnits);
    expect(overview.homeShirtUnits + overview.awayShirtUnits + overview.thirdShirtUnits).toBe(
      overview.seasonShirtUnits,
    );
  });

  it("prices each season at the appeal it actually traded at, so history stops moving when the club grows", () => {
    const { runtime, savesDirectory, saveId } = createOwnerCareer("Retail Historical Appeal");
    const traded = advanceUntilMerchandisePosted(runtime);
    expect(traded.seasonMerchandiseRevenue).toBeGreaterThan(0);
    const seasonKey = traded.seasonKey;
    const before = traded.seasonHistory.find((row) => row.seasonKey === seasonKey);
    expect(before, "the traded season should appear in history").toBeDefined();
    expect(runtime.saveCareer().ok).toBe(true);

    // The club becomes far more commercially appealing than it was when
    // that season's shirts were actually sold — exactly what building a
    // club store, or several seasons of growth, does over a long save.
    const db = openGameDatabase(onlySaveFile(savesDirectory));
    const economy = new ClubEconomyRepository(db);
    const commercial = economy.commercialProfile(traded.clubId);
    expect(commercial).toBeDefined();
    economy.upsertCommercialProfile({ ...commercial!, merchandiseAppeal: 95 });
    db.close();

    const reopened = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    expect(reopened.loadCareer(saveId).ok).toBe(true);
    expect(reopened.switchActiveCareerRole("CHAIRMAN_OWNER").ok).toBe(true);
    const after = overviewOf(reopened);

    // The club genuinely did change...
    expect(after.merchandiseAppeal).toBeCloseTo(95, 5);
    // ...but the season that already happened must report exactly what it
    // reported before. Its units are recovered from the commercial-history
    // rows written at the time, not re-priced at today's appeal.
    const season = after.seasonHistory.find((row) => row.seasonKey === seasonKey);
    expect(season, "the traded season should still appear in history").toBeDefined();
    expect(season!.merchandiseRevenue).toBe(before!.merchandiseRevenue);
    expect(season!.shirtUnits, "past-season shirt units must not move when appeal changes").toBe(
      before!.shirtUnits,
    );
    expect(season!.homeShirtUnits).toBe(before!.homeShirtUnits);
    expect(season!.awayShirtUnits).toBe(before!.awayShirtUnits);
    expect(season!.thirdShirtUnits).toBe(before!.thirdShirtUnits);
    expect(season!.homeShirtUnits + season!.awayShirtUnits + season!.thirdShirtUnits).toBe(
      season!.shirtUnits,
    );
  });
});
