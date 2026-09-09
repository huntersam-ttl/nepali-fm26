import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase, migrateDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * A CONTEXT_ONLY foreign club (external_club_context) is real-world context
 * data, not a club this engine simulates in depth. Once createCareer began
 * applying the global dataset seed (so foreign clubs now genuinely exist in
 * every save's `clubs` table), several Nepal-only systems that queried
 * `clubs` unscoped started silently absorbing those foreign rows —
 * generating fabricated NPR-currency financial/facility/sponsorship data
 * for them (club-economy.ts's allClubs), inflating a federation's
 * "registered clubs" count and running licensing assessments against them
 * (federation-governance.ts's allClubs), and pulling them into Nepal's
 * ownership-succession simulation (ownership.ts's processOwnershipContinuity).
 * This file guards against that class of regression recurring.
 */

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const createRealCareer = () => {
  const savesDirectory = mkdtempSync(join(tmpdir(), "context-only-safety-"));
  tempDirs.push(savesDirectory);
  const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
  const created = service.createCareer({
    saveName: "Context Only Safety",
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
  return { db, service, savePath };
};

describe("CONTEXT_ONLY foreign clubs never enter Nepal-only economy/governance systems", () => {
  it("initializeClubEconomyForSave never fabricates a financial/facility/sponsorship account for a foreign club", () => {
    const { db } = createRealCareer();
    const foreignClub = db
      .prepare(
        `SELECT ecc.club_id AS id FROM external_club_context ecc LIMIT 1`,
      )
      .get() as { id: EntityId };
    const economy = new ClubEconomyRepository(db);
    expect(economy.financialAccount(foreignClub.id)).toBeUndefined();
    expect(economy.facilityProfile(foreignClub.id)).toBeUndefined();
    expect(economy.sponsorships(foreignClub.id)).toHaveLength(0);
    expect(economy.ownershipStakes(foreignClub.id)).toHaveLength(0);
    db.close();
  });

  it("still generates a real financial/facility account for every genuine Nepal club", () => {
    const { db } = createRealCareer();
    const domesticClub = db
      .prepare(
        `SELECT c.id FROM clubs c
         JOIN club_memberships cm ON cm.club_id = c.id
         WHERE NOT EXISTS (SELECT 1 FROM external_club_context ecc WHERE ecc.club_id = c.id)
         LIMIT 1`,
      )
      .get() as { id: EntityId };
    const economy = new ClubEconomyRepository(db);
    expect(economy.financialAccount(domesticClub.id)).toBeDefined();
    db.close();
  });
});
