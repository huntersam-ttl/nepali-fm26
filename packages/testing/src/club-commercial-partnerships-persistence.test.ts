import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  acceptSponsorOffer,
  DesktopApplicationService,
  generateSponsorOffers,
  processClubEconomyMonth,
  SPONSORSHIP_SLOT_ORDER,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * Club Commercial Phase 2 — persistence, old-save tolerance and the
 * Create-a-Club default for kit supply.
 *
 * These drive the real DesktopApplicationService: a career is created,
 * a supplier deal is signed and paid through the canonical economy, then
 * the save is reloaded through a SEPARATE service instance and read back
 * from the Owner's commercial overview — the same surface the Club Store
 * renders. Nothing asserts a repository in isolation.
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
  fullName: "Partnership Tester",
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
  clubId: EntityId;
};

const createOwnerCareer = (saveName: string): OwnerCareer => {
  const savesDirectory = tempDir("partnerships-persistence-");
  const runtime = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
  const clubs = runtime.listStartingClubs();
  if (!clubs.ok) throw new Error("failed to list starting clubs");
  const created = runtime.createCareer({ saveName, joinTeamId: clubs.data[0]!.teamId, character });
  if (!created.ok) throw new Error(`failed to create career: ${created.error.message}`);
  if (!runtime.seedE2ERoleFixture().ok) throw new Error("failed to seed role fixture");
  if (!runtime.switchActiveCareerRole("CHAIRMAN_OWNER").ok) throw new Error("failed to take owner role");
  const overview = runtime.getClubCommercialOverview();
  if (!overview.ok) throw new Error(`overview failed: ${overview.error.message}`);
  return { runtime, savesDirectory, saveId: created.data.save.id, clubId: overview.data.clubId };
};

const overviewOf = (runtime: DesktopApplicationService) => {
  const result = runtime.getClubCommercialOverview();
  if (!result.ok) throw new Error(`commercial overview failed: ${result.error.message}`);
  return result.data;
};

/** Signs a real KIT_SUPPLIER deal through the canonical offer lifecycle. */
const signKitSupplier = (db: GameDatabase, clubId: EntityId, date: string): void => {
  const economy = new ClubEconomyRepository(db);
  for (let attempt = 0; attempt < SPONSORSHIP_SLOT_ORDER.length * 2; attempt += 1) {
    const held = economy
      .sponsorships(clubId)
      .filter((item) => item.status === "ACTIVE")
      .map((item) => item.type);
    if (held.includes("KIT_SUPPLIER")) return;
    const offer = generateSponsorOffers(db, { clubId, date, seed: `supplier:${attempt}`, count: 1 })[0];
    if (!offer) break;
    acceptSponsorOffer(db, offer.id, date);
  }
  throw new Error("failed to sign a kit supplier");
};

describe("club commercial partnerships — persistence and old saves", () => {
  it("preserves a signed kit supplier, its royalty and the Owner's view across save and load", () => {
    const { runtime, savesDirectory, saveId, clubId } = createOwnerCareer("Partnership Save Load");
    expect(runtime.saveCareer().ok).toBe(true);

    // Sign the deal and run a real economy month so a royalty is actually paid.
    const db = openGameDatabase(onlySaveFile(savesDirectory));
    signKitSupplier(db, clubId, "2026-08-01");
    processClubEconomyMonth(db, { date: "2026-09-28", seed: "partnership-save-load" });
    const economy = new ClubEconomyRepository(db);
    const signed = economy
      .sponsorships(clubId)
      .find((item) => item.type === "KIT_SUPPLIER" && item.status === "ACTIVE")!;
    const royalties = economy
      .ledgerEntries(clubId)
      .filter((entry) => entry.description === "Kit supplier merchandise royalty");
    expect(royalties.length, "the supplier paid a royalty before saving").toBeGreaterThan(0);
    db.close();

    // A genuinely separate service instance reading the save from disk.
    const reopened = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    expect(reopened.loadCareer(saveId).ok).toBe(true);
    expect(reopened.switchActiveCareerRole("CHAIRMAN_OWNER").ok).toBe(true);
    const overview = overviewOf(reopened);

    expect(overview.kitSupplier, "the Owner still sees the supplier after reload").toBeDefined();
    expect(overview.kitSupplier!.partnerName.length).toBeGreaterThan(0);
    expect(overview.kitSupplier!.endDate).toBe(signed.endDate);
    expect(overview.kitSupplier!.annualValue).toBe(signed.annualValue);
    expect(overview.kitSupplier!.royaltyShare).toBeGreaterThan(0);

    // The royalty money survived too, in the canonical ledger.
    const reloadedDb = openGameDatabase(onlySaveFile(savesDirectory));
    const reloadedRoyalties = new ClubEconomyRepository(reloadedDb)
      .ledgerEntries(clubId)
      .filter((entry) => entry.description === "Kit supplier merchandise royalty");
    expect(reloadedRoyalties.length).toBe(royalties.length);
    expect(reloadedRoyalties[0]!.amount).toBe(royalties[0]!.amount);
    reloadedDb.close();
  }, 300_000);

  it("loads a save that predates kit supply: legacy sponsorships only, no supplier, no crash", () => {
    const { runtime, savesDirectory, saveId, clubId } = createOwnerCareer("Partnership Old Save");
    expect(runtime.saveCareer().ok).toBe(true);

    /*
     * Build a genuine pre-feature save shape. A fresh save on current code is
     * NOT that: the monthly tick correctly offers the newly-opened supplier
     * slot, so an OFFERED KIT_SUPPLIER row legitimately appears. A save
     * written before the type existed has no such row at all, which is what
     * this deletion reproduces.
     */
    const db = openGameDatabase(onlySaveFile(savesDirectory));
    db.prepare("DELETE FROM sponsorship_contracts WHERE sponsorship_type = 'KIT_SUPPLIER'").run();
    const economy = new ClubEconomyRepository(db);
    const legacy = economy.sponsorships(clubId);
    expect(legacy.length, "the club still holds its real legacy sponsorships").toBeGreaterThan(0);
    expect(
      legacy.some((item) => item.type === "KIT_SUPPLIER"),
      "a pre-feature save has no supplier row of any status",
    ).toBe(false);
    db.close();

    const reopened = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    expect(reopened.loadCareer(saveId).ok, "an old-shaped save loads without migration failure").toBe(
      true,
    );
    expect(reopened.switchActiveCareerRole("CHAIRMAN_OWNER").ok).toBe(true);
    const overview = overviewOf(reopened);

    expect(overview.kitSupplier, "no supplier is reported, and nothing is invented").toBeUndefined();
    // The rest of the commercial surface still works.
    expect(overview.clubName.length).toBeGreaterThan(0);
    expect(overview.provenanceStatus).toBe("SIMULATION_ONLY");
  }, 300_000);

  it("founds a club with no kit supplier and no commercial deals at all", () => {
    const { runtime, savesDirectory } = createOwnerCareer("Partnership Founder");
    expect(runtime.saveCareer().ok).toBe(true);

    const probe = openGameDatabase(onlySaveFile(savesDirectory));
    const district = probe
      .prepare(
        "SELECT name FROM locations WHERE kind='district' AND country_id=(SELECT id FROM countries WHERE iso_code IN ('NP','NPL') ORDER BY id LIMIT 1) ORDER BY name LIMIT 1",
      )
      .get() as { name?: string } | undefined;
    probe.close();
    expect(district?.name).toBeTruthy();

    const clubName = `Partnership Founders ${Date.now()}`;
    const founded = runtime.foundClub(clubName, district!.name!);
    if (!founded.ok) throw new Error(`failed to found club: ${founded.error.message}`);
    expect(runtime.saveCareer().ok).toBe(true);

    const db = openGameDatabase(onlySaveFile(savesDirectory));
    const row = db.prepare("SELECT id FROM clubs WHERE name = ?").get(clubName) as
      | { id?: EntityId }
      | undefined;
    expect(row?.id).toBeTruthy();
    const sponsorships = new ClubEconomyRepository(db).sponsorships(row!.id!);
    expect(
      sponsorships.filter((item) => item.type === "KIT_SUPPLIER"),
      "founding must never grant a free kit supplier",
    ).toEqual([]);
    expect(
      sponsorships.filter((item) => item.status === "ACTIVE"),
      "a brand-new club starts with no elite sponsorship of any kind",
    ).toEqual([]);
    db.close();
  }, 300_000);
});
