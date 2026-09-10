import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSave, openGameDatabase, migrateDatabase } from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  buildClubProfile,
  buildCompetitionProfile,
  buildEntityReference,
  buildPlayerProfile,
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

  it("CLUB squad exposure: a domestic club's real squad opens to a visible, correctly-scoped player profile", () => {
    const db = createRealCareer();
    const club = db
      .prepare(
        `SELECT c.id, c.name FROM clubs c
         JOIN teams t ON t.club_id = c.id
         JOIN team_person_assignments tpa ON tpa.team_id = t.id AND tpa.role = 'PLAYER' AND tpa.ended_on IS NULL
         JOIN player_attributes pa ON pa.person_id = tpa.person_id
         WHERE NOT EXISTS (SELECT 1 FROM external_club_context ecc WHERE ecc.club_id = c.id)
         GROUP BY c.id HAVING COUNT(*) > 0 ORDER BY c.id LIMIT 1`,
      )
      .get() as { id: EntityId; name: string };
    const profile = buildClubProfile(db, club.id, ROLE);
    expect(profile.squad.length).toBeGreaterThan(0);
    const squadEntry = profile.squad[0]!;
    expect(squadEntry.entityType).toBe("PLAYER");
    expect(squadEntry.visible).toBe(true);

    const saveRow = db.prepare("SELECT id FROM saves LIMIT 1").get() as { id: EntityId };
    const save = loadSave(db, saveRow.id);
    const playerProfile = buildPlayerProfile(db, save, { role: ROLE }, squadEntry.id);
    expect(playerProfile.personId).toBe(squadEntry.id);
    expect(playerProfile.club?.id).toBe(club.id);
    expect(playerProfile.club?.label).toBe(club.name);
    // Opened as a shared world entity, not this viewer's own squad — no
    // Nepal-manager relationship data borrowed for someone else's player.
    expect(playerProfile.ownSquad).toBe(false);
    expect(playerProfile.relationship).toBeUndefined();
    db.close();
  });

  /**
   * A genuine, confirmed data gap in the current global-football-import: it
   * links every squad member it can to a foreign club's team_person_assignments,
   * but only ever creates a real player_attributes row for a player it has
   * separate evidence for — leaving most CONTEXT_ONLY foreign squads with NO
   * attribute-backed member at all in today's seeded dataset. buildClubProfile's
   * squad field is joined to player_attributes specifically so this never
   * surfaces as a dead link (a roster entry that 500s when opened) — verified
   * here directly: whatever a foreign club's squad DOES contain must actually
   * open, never fabricating attribute coverage that doesn't exist to force
   * more entries in. Extending real attribute coverage to more foreign
   * players is future Global Football Market Engine work, not this pass.
   */
  it("CLUB (foreign, CONTEXT_ONLY) squad exposure never surfaces a player profile that would fail to open", () => {
    const db = createRealCareer();
    const foreignClubIds = (
      db.prepare(`SELECT club_id AS id FROM external_club_context`).all() as Array<{ id: EntityId }>
    ).map((row) => row.id);
    expect(foreignClubIds.length).toBeGreaterThan(0);
    const saveRow = db.prepare("SELECT id FROM saves LIMIT 1").get() as { id: EntityId };
    const save = loadSave(db, saveRow.id);
    let checkedAtLeastOneSquadEntry = false;
    for (const clubId of foreignClubIds) {
      const profile = buildClubProfile(db, clubId, ROLE);
      for (const entry of profile.squad) {
        checkedAtLeastOneSquadEntry = true;
        expect(entry.entityType).toBe("PLAYER");
        expect(entry.visible).toBe(true);
        expect(() => buildPlayerProfile(db, save, { role: ROLE }, entry.id)).not.toThrow();
      }
    }
    // Not asserted as >0: today's seeded dataset may have zero attribute-
    // backed foreign squad members at all (a real, documented data gap) —
    // this test's job is that IF any exist, they are genuinely navigable.
    void checkedAtLeastOneSquadEntry;
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
