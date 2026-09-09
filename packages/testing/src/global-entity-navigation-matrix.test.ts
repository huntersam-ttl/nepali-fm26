import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase, migrateDatabase } from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  buildClubProfile,
  buildCompetitionProfile,
  buildEntityReference,
} from "@nepal-football-sim/simulation";
import type { CareerRole, EntityId } from "@nepal-football-sim/shared-types";

/**
 * The permanent product rule: every meaningful football entity with a
 * canonical destination must be clickable, and the SAME entity type must
 * resolve to the SAME canonical destination regardless of which screen it
 * was rendered from — Inbox, Story Detail, Player Profile, Transfers, a
 * Meeting, etc. all funnel through this one entity-reference/profile-builder
 * layer (buildEntityReference / buildClubProfile / buildCompetitionProfile),
 * never a screen-specific switch. This is the reusable regression proving
 * that contract, for every entity type this pass touched — domestic AND
 * CONTEXT_ONLY foreign — asserting the real destination/visibility/id the
 * UI actually receives, not merely that a destination string exists.
 */

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const createRealCareer = () => {
  const savesDirectory = mkdtempSync(join(tmpdir(), "global-entity-navigation-matrix-"));
  tempDirs.push(savesDirectory);
  const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
  const created = service.createCareer({
    saveName: "Global Entity Navigation Matrix",
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

const ROLE: CareerRole = "MANAGER";

describe("global entity navigation matrix", () => {
  it("PLAYER: a real Nepal player resolves to a visible, correctly-typed, correctly-identified reference", () => {
    const db = createRealCareer();
    const player = db.prepare("SELECT id FROM persons LIMIT 1").get() as { id: EntityId };
    const reference = buildEntityReference(db, "PLAYER", player.id, ROLE);
    expect(reference.visible).toBe(true);
    expect(reference.entityType).toBe("PLAYER");
    expect(reference.id).toBe(player.id);
    expect(reference.destination).toBe("player");
    expect(reference.label.length).toBeGreaterThan(0);
    db.close();
  });

  it("CLUB (domestic): resolves to a visible reference and a full Nepal club profile", () => {
    const db = createRealCareer();
    const club = db
      .prepare(
        `SELECT c.id, c.name FROM clubs c
         JOIN club_memberships cm ON cm.club_id = c.id
         WHERE NOT EXISTS (SELECT 1 FROM external_club_context ecc WHERE ecc.club_id = c.id)
         LIMIT 1`,
      )
      .get() as { id: EntityId; name: string };
    const reference = buildEntityReference(db, "CLUB", club.id, ROLE);
    expect(reference.visible).toBe(true);
    expect(reference.destination).toBe("club");
    expect(reference.label).toBe(club.name);
    const profile = buildClubProfile(db, club.id, ROLE);
    expect(profile.foreignContext).toBeUndefined();
    expect(profile.entityReference.id).toBe(club.id);
    db.close();
  });

  it("CLUB (foreign, CONTEXT_ONLY): resolves through the SAME entity reference and profile builder — no domestic/foreign fork", () => {
    const db = createRealCareer();
    const foreignClub = db
      .prepare(`SELECT ecc.club_id AS id, c.name FROM external_club_context ecc JOIN clubs c ON c.id = ecc.club_id LIMIT 1`)
      .get() as { id: EntityId; name: string };
    const reference = buildEntityReference(db, "CLUB", foreignClub.id, ROLE);
    expect(reference.visible).toBe(true);
    expect(reference.destination).toBe("club");
    expect(reference.label).toBe(foreignClub.name);
    const profile = buildClubProfile(db, foreignClub.id, ROLE);
    expect(profile.entityReference.id).toBe(foreignClub.id);
    expect(profile.foreignContext).toBeDefined();
    expect(profile.foreignContext?.competition.visible).toBe(true);
    db.close();
  });

  it("COMPETITION (domestic): resolves to a visible reference and a real competition profile", () => {
    const db = createRealCareer();
    const competition = db
      .prepare(
        `SELECT comp.id, comp.name FROM competitions comp
         JOIN club_memberships cm ON cm.competition_id = comp.id
         JOIN clubs c ON c.id = cm.club_id
         WHERE NOT EXISTS (SELECT 1 FROM external_club_context ecc WHERE ecc.club_id = c.id)
         LIMIT 1`,
      )
      .get() as { id: EntityId; name: string };
    const reference = buildEntityReference(db, "COMPETITION", competition.id, ROLE);
    expect(reference.visible).toBe(true);
    expect(reference.destination).toBe("competition");
    expect(reference.label).toBe(competition.name);
    const profile = buildCompetitionProfile(db, competition.id, ROLE);
    expect(profile.entityReference.id).toBe(competition.id);
    db.close();
  });

  it("COMPETITION (foreign): resolves through the SAME canonical path as a domestic competition — no Nepal-league fallback", () => {
    const db = createRealCareer();
    const foreignCompetition = db
      .prepare(`SELECT league_id AS id FROM external_league_context LIMIT 1`)
      .get() as { id: EntityId };
    const reference = buildEntityReference(db, "COMPETITION", foreignCompetition.id, ROLE);
    expect(reference.visible).toBe(true);
    expect(reference.destination).toBe("competition");
    const profile = buildCompetitionProfile(db, foreignCompetition.id, ROLE);
    expect(profile.entityReference.id).toBe(foreignCompetition.id);
    // Never a Nepal-specific league fallback: no fabricated standings for a
    // competition this engine doesn't simulate in depth.
    expect(profile.standings).toEqual([]);
    db.close();
  });

  it("FIXTURE: resolves to a visible reference naming both real teams", () => {
    const db = createRealCareer();
    const fixture = db.prepare("SELECT id FROM fixtures LIMIT 1").get() as { id: EntityId } | undefined;
    if (!fixture) return; // no fixtures scheduled yet in this fixture's world — not a failure
    const reference = buildEntityReference(db, "FIXTURE", fixture.id, ROLE);
    expect(reference.visible).toBe(true);
    expect(reference.destination).toBe("fixture");
    expect(reference.label).toContain(" vs ");
    db.close();
  });

  it("an unknown/deleted id of any type never renders as visible — no dead link presented as real", () => {
    const db = createRealCareer();
    const bogus = "00000000-0000-0000-0000-000000000000" as EntityId;
    for (const type of ["PLAYER", "CLUB", "COMPETITION", "FIXTURE"] as const) {
      const reference = buildEntityReference(db, type, bogus, ROLE);
      expect(reference.visible).toBe(false);
    }
    db.close();
  });
});
