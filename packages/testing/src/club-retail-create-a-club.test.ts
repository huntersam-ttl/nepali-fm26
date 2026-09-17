import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * Club Commercial Phase 1C — Create-a-Club commercial defaults.
 *
 * A newly founded club must start commercially honest: no dedicated store
 * it never built, no sales history it never earned, and a baseline
 * merchandise appeal that comes from the existing club-founding defaults
 * rather than anything this feature invents. This test deliberately adds
 * no wizard step and no new founder input — it only asserts what the
 * existing founder flow already produces.
 */

process.env.NEPAL_E2E_ROLE_FIXTURE = "1";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const onlySaveFile = (savesDirectory: string): string => {
  const file = readdirSync(savesDirectory).find((name) => name.endsWith(".sqlite"));
  if (!file) throw new Error("no save file found");
  return join(savesDirectory, file);
};

const character = {
  fullName: "Founder Tester",
  preferredDisplayName: "Founder",
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

describe("create-a-club commercial defaults", () => {
  it("founds a club with no store, no sales history and a conservative baseline appeal", () => {
    const savesDirectory = tempDir("club-retail-founder-");
    const runtime = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const clubs = runtime.listStartingClubs();
    if (!clubs.ok) throw new Error("failed to list starting clubs");
    const created = runtime.createCareer({
      saveName: "Retail Founder Defaults",
      joinTeamId: clubs.data[0]!.teamId,
      character,
    });
    if (!created.ok) throw new Error(`failed to create career: ${created.error.message}`);
    expect(runtime.seedE2ERoleFixture().ok).toBe(true);
    expect(runtime.switchActiveCareerRole("CHAIRMAN_OWNER").ok).toBe(true);
    expect(runtime.saveCareer().ok).toBe(true);

    // Founding requires one of Nepal's canonical districts — read a real one
    // out of the world rather than hard-coding a name.
    const probe = openGameDatabase(onlySaveFile(savesDirectory));
    const district = probe
      .prepare(
        "SELECT name FROM locations WHERE kind='district' AND country_id=(SELECT id FROM countries WHERE iso_code IN ('NP','NPL') ORDER BY id LIMIT 1) ORDER BY name LIMIT 1",
      )
      .get() as { name?: string } | undefined;
    probe.close();
    expect(district?.name, "the world should contain Nepal districts").toBeTruthy();

    const clubName = `Retail Founders United ${Date.now()}`;
    const founded = runtime.foundClub(clubName, district!.name!);
    if (!founded.ok) throw new Error(`failed to found club: ${founded.error.message}`);
    expect(runtime.saveCareer().ok).toBe(true);

    const db = openGameDatabase(onlySaveFile(savesDirectory));
    const row = db.prepare("SELECT id FROM clubs WHERE name = ?").get(clubName) as { id?: EntityId } | undefined;
    expect(row?.id, "the founded club should exist in the world").toBeTruthy();
    const clubId = row!.id!;
    const economy = new ClubEconomyRepository(db);

    // A conservative commercial profile from the existing founding defaults —
    // real, low, and not granted by this feature.
    const commercial = economy.commercialProfile(clubId);
    expect(commercial, "a founded club has a commercial profile like any other").toBeDefined();
    expect(commercial!.merchandiseAppeal).toBeGreaterThanOrEqual(0);
    expect(
      commercial!.merchandiseAppeal,
      "a brand-new club must not start with an established club's pulling power",
    ).toBeLessThanOrEqual(5);

    // No free store: the founder must build one through the normal
    // RETAIL_STORE facility project like everyone else.
    const retailProjects = economy
      .infrastructureProjects(clubId)
      .filter((project) => project.projectType === "RETAIL_STORE");
    expect(retailProjects, "founding must not grant a free club store").toEqual([]);

    // No invented trading history.
    const merchandiseEntries = economy
      .ledgerEntries(clubId)
      .filter((entry) => entry.category === "MERCHANDISE");
    expect(merchandiseEntries, "a new club has sold nothing yet").toEqual([]);

    db.close();
  }, 300_000);
});
