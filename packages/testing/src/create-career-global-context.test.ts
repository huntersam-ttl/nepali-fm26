import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase, migrateDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService, applyCanonicalGlobalDatasetSeed, buildClubProfile } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * Regression coverage for a real bug found during live verification: the
 * desktop app's own createCareer command never called
 * applyCanonicalGlobalDatasetSeed, so every save created through the actual
 * game UI was Nepal-only — no foreign clubs/competitions/players ever
 * existed, even though the whole CONTEXT_ONLY foreign-world system
 * (external_club_context, foreign-move-ambition, transfer-market's
 * processBoundedForeignInterest, etc.) was built assuming they would.
 */

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const createRealCareer = () => {
  const savesDirectory = mkdtempSync(join(tmpdir(), "create-career-global-context-"));
  tempDirs.push(savesDirectory);
  const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
  const created = service.createCareer({
    saveName: "Global Context Check",
    character: {
      fullName: "Maya Adhikari",
      preferredDisplayName: "Maya",
      dateOfBirth: "1993-05-12",
      startingAge: 33,
      languages: ["ne", "en"],
      footballBackground: "COMMUNITY_COACHING",
      education: "SPORTS_RELATED_DEGREE",
      playingExperience: "AMATEUR_PLAYER",
      coachingExperience: "YOUTH_COACH",
      businessBackground: "SMALL_BUSINESS",
      startingReputationProfile: "LOCAL_RESPECTED",
    },
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("career creation failed");
  const savePath = created.data.catalogEntry.filePath;
  service.closeCareer();
  const db = openGameDatabase(savePath);
  migrateDatabase(db);
  return db;
};

describe("createCareer applies the global (foreign-world) dataset seed", () => {
  it("populates real foreign clubs, leagues, and players — never leaves a save Nepal-only", () => {
    const db = createRealCareer();
    const clubCount = (db.prepare("SELECT COUNT(*) AS n FROM external_club_context").get() as { n: number }).n;
    const leagueCount = (db.prepare("SELECT COUNT(*) AS n FROM external_league_context").get() as { n: number }).n;
    const playerCount = (db.prepare("SELECT COUNT(*) AS n FROM external_player_context").get() as { n: number }).n;
    expect(clubCount).toBeGreaterThan(0);
    expect(leagueCount).toBeGreaterThan(0);
    expect(playerCount).toBeGreaterThan(0);

    const importRow = db
      .prepare("SELECT status FROM global_dataset_imports ORDER BY applied_on DESC LIMIT 1")
      .get() as { status: string } | undefined;
    expect(importRow?.status).toBe("ACTIVE");
    db.close();
  });

  it("running createCareer twice never duplicates the global dataset import (idempotent by dataset version)", () => {
    const db = createRealCareer();
    const before = (db.prepare("SELECT COUNT(*) AS n FROM external_club_context").get() as { n: number }).n;
    // Re-apply against the same, already-seeded database — simulates what
    // would happen if this were ever accidentally called twice.
    const outcome = applyCanonicalGlobalDatasetSeed(db);
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe("ALREADY_APPLIED");
    const after = (db.prepare("SELECT COUNT(*) AS n FROM external_club_context").get() as { n: number }).n;
    expect(after).toBe(before);
    db.close();
  });
});

describe("buildClubProfile never fabricates Nepal-club data for a CONTEXT_ONLY foreign club", () => {
  it("returns real foreign context (country/competition/reputation/financial band) and no Nepal-club-economy fields", () => {
    const db = createRealCareer();
    const foreignClub = db
      .prepare(
        `SELECT ecc.club_id AS id, c.name FROM external_club_context ecc
         JOIN clubs c ON c.id = ecc.club_id LIMIT 1`,
      )
      .get() as { id: EntityId; name: string };
    const profile = buildClubProfile(db, foreignClub.id, "MANAGER");
    expect(profile.foreignContext).toBeDefined();
    expect(profile.foreignContext?.country.length).toBeGreaterThan(0);
    expect(profile.foreignContext?.competition.visible).toBe(true);
    // Nepal club-economy/facility fields must never be presented as fact
    // for a foreign club, even if underlying rows exist for it.
    expect(profile.manager).toBeUndefined();
    expect(profile.owner).toBeUndefined();
    expect(profile.financialSummary).toBeUndefined();
    expect(profile.facilitySnapshot).toBeUndefined();
    expect(profile.stadium).toBeUndefined();
    expect(profile.activeSponsors).toHaveLength(0);
    db.close();
  });

  it("still returns the full Nepal-club profile for a real domestic club", () => {
    const db = createRealCareer();
    const domesticClub = db
      .prepare(
        `SELECT c.id, c.name FROM clubs c
         WHERE NOT EXISTS (SELECT 1 FROM external_club_context ecc WHERE ecc.club_id = c.id)
         LIMIT 1`,
      )
      .get() as { id: EntityId; name: string };
    const profile = buildClubProfile(db, domesticClub.id, "MANAGER");
    expect(profile.foreignContext).toBeUndefined();
    db.close();
  });
});
