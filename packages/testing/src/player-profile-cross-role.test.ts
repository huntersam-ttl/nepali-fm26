import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SquadDynamicsRepository, loadSave, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import { buildPlayerProfile, createNepalSave, type PlayerProfileViewer } from "@nepal-football-sim/simulation";
import type { CareerRole, EntityId, SaveMetadata } from "@nepal-football-sim/shared-types";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

/**
 * The Player Profile is a shared world entity view: every legitimate role can
 * OPEN it, because every story surface links to players. What each viewer SEES
 * is still decided by the existing club-knowledge model — never by role name —
 * and acting on a player stays behind real authority.
 */

const dirs: string[] = [];
let db: GameDatabase;
let save: SaveMetadata;
let clubId: EntityId;
let teamId: EntityId;
let ownPlayer: EntityId;
let outsidePlayer: EntityId;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "player-profile-cross-role-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8")) as unknown,
    saveName: "player-profile-cross-role",
    gameVersion: "test",
    randomSeed: "player-profile-cross-role",
  });
  db = openGameDatabase(path);
  const first = db.prepare("SELECT id FROM saves LIMIT 1").get() as { id: EntityId };
  save = loadSave(db, first.id);
  const team = db
    .prepare(
      `SELECT t.id AS teamId, t.club_id AS clubId FROM teams t
       JOIN team_person_assignments tpa ON tpa.team_id = t.id AND tpa.role='PLAYER' AND tpa.ended_on IS NULL
       JOIN player_attributes pa ON pa.person_id = tpa.person_id
       WHERE t.club_id IS NOT NULL GROUP BY t.id HAVING COUNT(*) > 0 ORDER BY t.id LIMIT 1`,
    )
    .get() as { teamId: EntityId; clubId: EntityId };
  teamId = team.teamId;
  clubId = team.clubId;
  ownPlayer = (
    db
      .prepare(
        `SELECT tpa.person_id AS id FROM team_person_assignments tpa
         JOIN player_attributes pa ON pa.person_id = tpa.person_id
         WHERE tpa.team_id = ? AND tpa.role='PLAYER' AND tpa.ended_on IS NULL
         ORDER BY tpa.person_id LIMIT 1`,
      )
      .get(teamId) as { id: EntityId }
  ).id;
  outsidePlayer = (
    db
      .prepare(
        `SELECT tpa.person_id AS id FROM team_person_assignments tpa
         JOIN player_attributes pa ON pa.person_id = tpa.person_id
         WHERE tpa.team_id != ? AND tpa.role='PLAYER' AND tpa.ended_on IS NULL
         ORDER BY tpa.person_id LIMIT 1`,
      )
      .get(teamId) as { id: EntityId }
  ).id;
});

afterAll(() => {
  db?.close();
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

/** A viewer with no club — a federation president has neither club nor team. */
const federationViewer = (role: CareerRole = "FEDERATION_PRESIDENT"): PlayerProfileViewer => ({ role });
/** A club viewer that is NOT the manager (owner/executive): real club, no manager context. */
const clubViewer = (role: CareerRole): PlayerProfileViewer => ({ role, clubId, teamId });

describe("player profile opens for every legitimate role", () => {
  it.each([
    "CHAIRMAN_OWNER",
    "CEO",
    "GENERAL_SECRETARY",
    "SPORTING_DIRECTOR",
    "DIRECTOR_OF_FOOTBALL",
  ] as const)("%s can open a player profile at their own club", (role) => {
    const profile = buildPlayerProfile(db, save, clubViewer(role), ownPlayer);
    expect(profile.personId).toBe(ownPlayer);
    expect(profile.name.length).toBeGreaterThan(0);
    expect(profile.viewer.role).toBe(role);
  });

  it("FEDERATION_PRESIDENT can open a player profile with no club of their own", () => {
    const profile = buildPlayerProfile(db, save, federationViewer(), ownPlayer);
    expect(profile.personId).toBe(ownPlayer);
    expect(profile.name.length).toBeGreaterThan(0);
    expect(profile.viewer.role).toBe("FEDERATION_PRESIDENT");
  });

  it("resolves the player's real club and season record regardless of who is looking", () => {
    const president = buildPlayerProfile(db, save, federationViewer(), outsidePlayer);
    const owner = buildPlayerProfile(db, save, clubViewer("CHAIRMAN_OWNER"), outsidePlayer);
    expect(president.clubName).toBe(owner.clubName);
    expect(president.season).toEqual(owner.season);
  });
});

describe("knowledge gating is preserved, never granted by role", () => {
  it("a viewer with no club gets NONE knowledge and no per-attribute detail", () => {
    const profile = buildPlayerProfile(db, save, federationViewer(), ownPlayer);
    expect(profile.knowledge).toBe("NONE");
    expect(profile.attributeGroups).toHaveLength(0);
  });

  it("the President never receives a scouting report — that is a manager's own scouting operation", () => {
    expect(buildPlayerProfile(db, save, federationViewer(), outsidePlayer).scoutingSummary).toBeUndefined();
    expect(buildPlayerProfile(db, save, federationViewer(), ownPlayer).scoutingSummary).toBeUndefined();
  });

  it("a club viewer with no manager appointment gets club knowledge but still no scouting report", () => {
    const owner = buildPlayerProfile(db, save, clubViewer("CHAIRMAN_OWNER"), outsidePlayer);
    expect(owner.scoutingSummary).toBeUndefined();
  });

  it("an unscouted outside player never leaks per-attribute detail to any non-manager viewer", () => {
    for (const viewer of [federationViewer(), clubViewer("CHAIRMAN_OWNER"), clubViewer("CEO")]) {
      const profile = buildPlayerProfile(db, save, viewer, outsidePlayer);
      if (profile.knowledge !== "EXTENSIVE" && profile.knowledge !== "COMPLETE") {
        expect(profile.attributeGroups).toHaveLength(0);
      }
    }
  });

  it("is deterministic — the same viewer and player always produce the same knowledge presentation", () => {
    const once = buildPlayerProfile(db, save, federationViewer(), ownPlayer);
    const twice = buildPlayerProfile(db, save, federationViewer(), ownPlayer);
    expect(twice.knowledge).toBe(once.knowledge);
    expect(twice.attributeGroups).toEqual(once.attributeGroups);
    expect(twice.viewer).toEqual(once.viewer);
  });
});

describe("player action authority is separate from profile access", () => {
  it.each([
    "CHAIRMAN_OWNER",
    "CEO",
    "GENERAL_SECRETARY",
    "SPORTING_DIRECTOR",
    "DIRECTOR_OF_FOOTBALL",
    "FEDERATION_PRESIDENT",
  ] as const)("%s can open the profile but is never offered player-management controls", (role) => {
    const viewer = role === "FEDERATION_PRESIDENT" ? federationViewer(role) : clubViewer(role);
    const profile = buildPlayerProfile(db, save, viewer, ownPlayer);
    expect(profile.viewer.canManagePlayer).toBe(false);
    // ownSquad drives the manager's own-squad affordances; a non-manager
    // viewer must never be flagged as the player's manager.
    expect(profile.transferListStatus).toBeUndefined();
  });
});

describe("player profile relationship section", () => {
  it("is present (read-only) for any club role viewing their own player, and absent for someone else's player", () => {
    const owner = buildPlayerProfile(db, save, clubViewer("CHAIRMAN_OWNER"), ownPlayer);
    expect(owner.relationship).toBeDefined();
    expect(owner.relationship?.concerns).toEqual([]);
    expect(owner.relationship?.demands).toEqual([]);
    expect(owner.relationship?.promises).toEqual([]);
    // Read-only: this role has no manager authority over the player either way.
    expect(owner.viewer.canManagePlayer).toBe(false);

    const outsideView = buildPlayerProfile(db, save, clubViewer("CHAIRMAN_OWNER"), outsidePlayer);
    expect(outsideView.relationship).toBeUndefined();
  });

  it("is absent for a viewer with no club of their own", () => {
    const profile = buildPlayerProfile(db, save, federationViewer(), ownPlayer);
    expect(profile.relationship).toBeUndefined();
  });

  it("surfaces a real, unresolved concern for the player — filtered from the same repository the Dressing Room reads, not recalculated", () => {
    const dynamics = new SquadDynamicsRepository(db);
    dynamics.upsertConcern({
      id: createStableEntityId("concern", `${ownPlayer}:profile-test`),
      personId: ownPlayer,
      teamId,
      type: "PLAYING_TIME",
      status: "ACTIVE",
      severity: 6,
      raisedOn: save.worldDate,
      updatedOn: save.worldDate,
    });
    const profile = buildPlayerProfile(db, save, clubViewer("CHAIRMAN_OWNER"), ownPlayer);
    expect(profile.relationship?.concerns).toHaveLength(1);
    expect(profile.relationship?.concerns[0]?.type).toBe("PLAYING_TIME");
    expect(profile.relationship?.concerns[0]?.personId).toBe(ownPlayer);

    // A concern for a DIFFERENT player on the same team never leaks in here.
    dynamics.upsertConcern({
      id: createStableEntityId("concern", `${outsidePlayer}:profile-test-other`),
      personId: outsidePlayer,
      teamId,
      type: "CONTRACT",
      status: "ACTIVE",
      severity: 5,
      raisedOn: save.worldDate,
      updatedOn: save.worldDate,
    });
    const stillJustOne = buildPlayerProfile(db, save, clubViewer("CHAIRMAN_OWNER"), ownPlayer);
    expect(stillJustOne.relationship?.concerns).toHaveLength(1);
  });
});
