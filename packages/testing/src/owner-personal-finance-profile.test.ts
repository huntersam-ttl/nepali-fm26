import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  capitalInjectionFromInvestor,
  DesktopApplicationService,
  investPersonalFunds,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * No owner-career start path ever created a `personal_financial_profiles`
 * row for the real player — only AI ownership candidates got one (see
 * `generateOwnershipCandidate`). Because `updatePersonalCash` is a plain
 * `UPDATE ... WHERE person_id = ?` with no upsert fallback, a missing row
 * doesn't error, it silently no-ops: `investPersonalFunds` throws outright,
 * and a secondary stake sale's proceeds vanish into nowhere, while the read
 * model's `ownerPersonalCash ?? 0` made the missing row indistinguishable
 * from an honest zero balance. This was found live: after a real
 * accept -> due diligence -> board review -> completion cycle, the "seller"
 * (the player) still showed NPR 0 personal cash despite a completed
 * NPR 1.5m+ secondary sale.
 */

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const character = {
  fullName: "Owner Finance Test",
  dateOfBirth: "1985-01-01",
  startingAge: 41,
  languages: ["en"],
  footballBackground: "COMMUNITY_COACHING",
  education: "SPORTS_RELATED_DEGREE",
  playingExperience: "AMATEUR_PLAYER",
  coachingExperience: "SENIOR_COACH",
  businessBackground: "ENTREPRENEURSHIP",
  startingReputationProfile: "LOCAL_RESPECTED",
};

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("a real owner career always gets a usable personal financial profile", () => {
  it("joining an existing club as OWNER creates a real, non-zero personal cash balance", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-finance-join-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({
      savesDirectory: dir,
      worldDatasetPath: registryPath,
    });
    const listed = service.listStartingClubs();
    if (!listed.ok) throw new Error(listed.error.message);
    const club = listed.data.find((item) => item.division === "A");
    if (!club?.teamId) throw new Error("No A-Division club in the starting-club list");
    const created = service.createCareer({
      careerMode: "OWNER",
      saveName: "Owner Finance Join",
      joinTeamId: club.teamId,
      character,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const db = openGameDatabase(created.data.catalogEntry.filePath);
    const economy = new ClubEconomyRepository(db);
    const personId = db
      .prepare(
        "SELECT holder_id AS id FROM club_ownership_stakes WHERE club_id=? AND holder_type='PERSON' AND status='ACTIVE' LIMIT 1",
      )
      .get(club.clubId) as { id: EntityId };
    const profile = economy.personalFinancialProfile(personId.id);
    expect(profile).toBeDefined();
    expect(profile!.cash).toBeGreaterThan(0);
    // Nepal-scale, not a windfall: bounded well under typical club valuations.
    expect(profile!.cash).toBeLessThan(20_000_000);
    expect(profile!.status).toBe("SIMULATION_ONLY");
    db.close();
  });

  it("a founder-mode owner career also gets a usable personal cash balance", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-finance-founder-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({
      savesDirectory: dir,
      worldDatasetPath: registryPath,
    });
    const created = service.createCareer({
      careerMode: "OWNER",
      saveName: "Owner Finance Founder",
      character,
      founder: { clubName: "Founder Finance FC", locationName: "Kathmandu" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const db = openGameDatabase(created.data.catalogEntry.filePath);
    const economy = new ClubEconomyRepository(db);
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Founder Finance FC") as {
      id: EntityId;
    };
    const personId = db
      .prepare(
        "SELECT holder_id AS id FROM club_ownership_stakes WHERE club_id=? AND holder_type='PERSON' AND status='ACTIVE' LIMIT 1",
      )
      .get(club.id) as { id: EntityId };
    const profile = economy.personalFinancialProfile(personId.id);
    expect(profile).toBeDefined();
    expect(profile!.cash).toBeGreaterThan(0);
    db.close();
  });

  it("investPersonalFunds actually works for a real owner career, end to end", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-finance-invest-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({
      savesDirectory: dir,
      worldDatasetPath: registryPath,
    });
    const listed = service.listStartingClubs();
    if (!listed.ok) throw new Error(listed.error.message);
    const club = listed.data.find((item) => item.division === "A");
    if (!club?.teamId) throw new Error("No A-Division club in the starting-club list");
    const created = service.createCareer({
      careerMode: "OWNER",
      saveName: "Owner Finance Invest",
      joinTeamId: club.teamId,
      character,
    });
    if (!created.ok) throw new Error(created.error.message);

    const db = openGameDatabase(created.data.catalogEntry.filePath);
    const economy = new ClubEconomyRepository(db);
    const personId = db
      .prepare(
        "SELECT holder_id AS id FROM club_ownership_stakes WHERE club_id=? AND holder_type='PERSON' AND status='ACTIVE' LIMIT 1",
      )
      .get(club.clubId) as { id: EntityId };
    const beforePersonal = economy.personalFinancialProfile(personId.id)!.cash;
    const beforeClub = economy.financialAccount(club.clubId!)!.cashBalance;

    const amount = Math.min(100_000, Math.floor(beforePersonal / 2));
    expect(amount).toBeGreaterThan(0);
    // Before this fix, this call threw "Personal financial profile missing".
    expect(() =>
      investPersonalFunds(db, {
        personId: personId.id,
        clubId: club.clubId!,
        date: "2026-08-15",
        amount,
        form: "EQUITY",
      }),
    ).not.toThrow();

    const afterPersonal = economy.personalFinancialProfile(personId.id)!.cash;
    const afterClub = economy.financialAccount(club.clubId!)!.cashBalance;
    expect(afterPersonal).toBe(beforePersonal - amount);
    expect(afterClub).toBe(beforeClub + amount);
    db.close();
  });

  /**
   * `injectOwnerCapital` -> `capitalInjectionFromInvestor` always minted a
   * fresh `ownership-stake:{clubId}:{personId}` id for the investing owner's
   * stake, even when they already held one under a different id (e.g. the
   * career-start owner stake). The dilution loop upserted the existing row
   * by its real id; the final "add the new equity" write then created a
   * SECOND, duplicate ACTIVE stake row for the same holder at the same club
   * instead of updating the first — found live via the Investors screen
   * showing the same owner listed twice at two different percentages.
   */
  it("investing owner capital never creates a duplicate ownership stake row", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-finance-dedupe-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({
      savesDirectory: dir,
      worldDatasetPath: registryPath,
    });
    const listed = service.listStartingClubs();
    if (!listed.ok) throw new Error(listed.error.message);
    const club = listed.data.find((item) => item.division === "A");
    if (!club?.teamId) throw new Error("No A-Division club in the starting-club list");
    const created = service.createCareer({
      careerMode: "OWNER",
      saveName: "Owner Finance Dedupe",
      joinTeamId: club.teamId,
      character,
    });
    if (!created.ok) throw new Error(created.error.message);

    const db = openGameDatabase(created.data.catalogEntry.filePath);
    const economy = new ClubEconomyRepository(db);
    const personId = db
      .prepare(
        "SELECT holder_id AS id FROM club_ownership_stakes WHERE club_id=? AND holder_type='PERSON' AND status='ACTIVE' LIMIT 1",
      )
      .get(club.clubId) as { id: EntityId };
    const stakeIdBefore = db
      .prepare("SELECT id FROM club_ownership_stakes WHERE club_id=? AND holder_id=? AND status='ACTIVE'")
      .get(club.clubId, personId.id) as { id: EntityId };

    const cash = economy.personalFinancialProfile(personId.id)!.cash;
    capitalInjectionFromInvestor(db, {
      clubId: club.clubId!,
      personId: personId.id,
      date: "2026-08-15",
      amount: Math.min(100_000, Math.floor(cash / 4)),
      form: "EQUITY",
    });

    const activeStakes = db
      .prepare("SELECT id, percentage FROM club_ownership_stakes WHERE club_id=? AND holder_id=? AND status='ACTIVE'")
      .all(club.clubId, personId.id) as Array<{ id: EntityId; percentage: number }>;
    expect(activeStakes).toHaveLength(1);
    expect(activeStakes[0].id).toBe(stakeIdBefore.id);
    expect(activeStakes[0].percentage).toBeGreaterThan(75);
    db.close();
  });
});
