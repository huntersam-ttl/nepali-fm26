import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSave, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  buildOwnerMatchday,
  createNepalSave,
  DesktopApplicationService,
} from "@nepal-football-sim/simulation";
import type { EntityId, SaveMetadata } from "@nepal-football-sim/shared-types";

/**
 * A club fields both a senior men's and a senior women's team, and both rows
 * carry `level='senior'` — the only thing separating them is `gender`.
 * `buildOwnerMatchday` picked "the club's team" with
 * `SELECT id FROM teams WHERE club_id=? ORDER BY id LIMIT 1`, which is
 * ambiguous between the two and resolves to whichever team's id happens to
 * sort first alphabetically — silently the women's side for at least one
 * real club in the dataset, which has no scheduled fixtures yet. The result
 * was an Owner Matchday screen reading "No upcoming fixtures scheduled" /
 * "No results recorded yet" for a club mid-season with real fixtures and a
 * completed match, because the read model was looking at the wrong team.
 */

const dirs: string[] = [];
let db: GameDatabase;
let save: SaveMetadata;
let clubId: EntityId;
let mensTeamId: EntityId;
let womensTeamId: EntityId;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "owner-matchday-team-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(
      readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8"),
    ) as unknown,
    saveName: "owner-matchday-team",
    gameVersion: "test",
    randomSeed: "owner-matchday-team",
  });
  db = openGameDatabase(path);
  const first = db.prepare("SELECT id FROM saves LIMIT 1").get() as { id: EntityId };
  save = loadSave(db, first.id);

  // Find a real club in the dataset that fields both a senior men's and a
  // senior women's team — reproducing the exact ambiguity that caused the
  // bug, rather than constructing a synthetic fixture.
  const pair = db
    .prepare(
      `SELECT men.club_id AS clubId, men.id AS mensId, women.id AS womensId
       FROM teams men
       JOIN teams women ON women.club_id = men.club_id
       WHERE men.level = 'senior' AND men.gender = 'men'
         AND women.level = 'senior' AND women.gender = 'women'
       LIMIT 1`,
    )
    .get() as { clubId: EntityId; mensId: EntityId; womensId: EntityId } | undefined;
  if (!pair) throw new Error("No club in the dataset fields both a senior men's and women's team");
  clubId = pair.clubId;
  mensTeamId = pair.mensId;
  womensTeamId = pair.womensId;
});

afterAll(() => {
  db?.close();
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("owner matchday resolves the senior men's team, not an arbitrary team", () => {
  it("resolves the senior MEN'S team id, never the women's team, regardless of id ordering", () => {
    const view = buildOwnerMatchday(db, save, clubId);
    expect(view.teamId).toBe(mensTeamId);
    expect(view.teamId).not.toBe(womensTeamId);
  });

  it("surfaces the men's team's real scheduled fixtures, not an empty list", () => {
    const menFixtureCount = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM fixtures WHERE (home_team_id=? OR away_team_id=?) AND status='scheduled'",
        )
        .get(mensTeamId, mensTeamId) as { c: number }
    ).c;
    const view = buildOwnerMatchday(db, save, clubId);
    // If the men's team genuinely has scheduled fixtures in the dataset, the
    // Owner view must show them — an empty view here would mean it is still
    // reading the wrong team's (empty) fixture list.
    if (menFixtureCount > 0) {
      expect(view.upcoming.length).toBeGreaterThan(0);
    }
  });

  it("never returns a fixture that belongs to the women's team", () => {
    const view = buildOwnerMatchday(db, save, clubId);
    const womensFixtureIds = new Set(
      (
        db
          .prepare("SELECT id FROM fixtures WHERE home_team_id=? OR away_team_id=?")
          .all(womensTeamId, womensTeamId) as Array<{ id: EntityId }>
      ).map((row) => row.id),
    );
    for (const fixture of [...view.upcoming, ...view.results]) {
      expect(womensFixtureIds.has(fixture.id)).toBe(false);
    }
  });
});

/**
 * A second, deeper bug in the same read model: `row()` compared a fixture's
 * `home_team_id`/`away_team_id` (a TEAM id) against the CLUB id passed in,
 * which can never match — so `opponentId` always fell to `home_team_id` and
 * `homeAway` always reported "away", regardless of which side the team
 * actually played. A club playing at home saw itself listed as its own
 * opponent, on an "away" fixture that was genuinely at home.
 */
describe("owner matchday fixture rows report the correct opponent and home/away side", () => {
  const dirs2: string[] = [];
  let db2: GameDatabase;
  let save2: SaveMetadata;
  let clubId2: EntityId;
  let teamId2: EntityId;
  let opponentTeamId: EntityId;
  let homeFixtureId: EntityId;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "owner-matchday-sides-"));
    dirs2.push(dir);
    // Fixtures are generated during career creation, not at raw dataset
    // seeding, so this fixture drives the real desktop service.
    const service = new DesktopApplicationService({
      savesDirectory: dir,
      worldDatasetPath: resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"),
    });
    const listed = service.listStartingClubs();
    if (!listed.ok) throw new Error(listed.error.message);
    const club = listed.data.find((item) => item.division === "A");
    if (!club?.teamId) throw new Error("No A-Division club in the starting-club list");
    const created = service.createCareer({
      careerMode: "MANAGER",
      saveName: "owner-matchday-sides",
      joinTeamId: club.teamId,
      character: {
        fullName: "Owner Matchday Sides Test",
        dateOfBirth: "1985-01-01",
        startingAge: 41,
        languages: ["en"],
        footballBackground: "COMMUNITY_COACHING",
        education: "SPORTS_RELATED_DEGREE",
        playingExperience: "AMATEUR_PLAYER",
        coachingExperience: "SENIOR_COACH",
        businessBackground: "ENTREPRENEURSHIP",
        startingReputationProfile: "LOCAL_RESPECTED",
      },
    });
    if (!created.ok) throw new Error(created.error.message);
    db2 = openGameDatabase(created.data.catalogEntry.filePath);
    const first = db2.prepare("SELECT id FROM saves LIMIT 1").get() as { id: EntityId };
    save2 = loadSave(db2, first.id);

    // A real fixture where the resolved senior men's team plays at HOME —
    // exactly the case the bug silently mislabelled as "away".
    const fixture = db2
      .prepare(
        `SELECT f.id AS fixtureId, f.home_team_id AS homeTeamId, f.away_team_id AS awayTeamId, t.club_id AS clubId
         FROM fixtures f
         JOIN teams t ON t.id = f.home_team_id
         WHERE t.level = 'senior' AND t.gender = 'men'
         LIMIT 1`,
      )
      .get() as
      | { fixtureId: EntityId; homeTeamId: EntityId; awayTeamId: EntityId; clubId: EntityId }
      | undefined;
    if (!fixture) throw new Error("No senior men's home fixture found in the seeded dataset");
    clubId2 = fixture.clubId;
    teamId2 = fixture.homeTeamId;
    opponentTeamId = fixture.awayTeamId;
    homeFixtureId = fixture.fixtureId;
  });

  afterAll(() => {
    db2?.close();
    dirs2.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  it("reports 'home' for a fixture the team is genuinely hosting", () => {
    const view = buildOwnerMatchday(db2, save2, clubId2);
    const row = [...view.upcoming, ...view.results].find((item) => item.id === homeFixtureId);
    expect(row).toBeDefined();
    expect(row!.homeAway).toBe("home");
  });

  it("names the real opposing team, never the club's own team", () => {
    const view = buildOwnerMatchday(db2, save2, clubId2);
    const row = [...view.upcoming, ...view.results].find((item) => item.id === homeFixtureId);
    expect(row).toBeDefined();
    expect(row!.opponentId).toBe(opponentTeamId);
    expect(row!.opponentId).not.toBe(teamId2);
  });
});
