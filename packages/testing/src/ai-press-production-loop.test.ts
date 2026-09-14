import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MediaPhaseBRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, simulateNepalCareer } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Proves the production AI press loop is real, not merely a directly-called
 * function: a genuine world-progression call (simulateNepalCareer, the same
 * entry point a career save's "advance" uses) is the only press producer in
 * this test — no test code calls startPressConference/answerPressQuestionAsAi/
 * runAiPressConference itself. If AI-managed teams generate real material
 * post-match/transfer/player-issue facts, completed MediaInterview rows for
 * a non-human personId must appear afterward.
 *
 * A freshly created save has no manager assigned to any club — AI staffing
 * only fills in gradually through the career-world staff-planning phase,
 * not at world-genesis — so the test bootstraps one season first (creating
 * the real fixtures/teams), seeds a real ACTIVE manager_contracts row for
 * each team exactly like the codebase's own AI-staffing outcome would look
 * once filled (the same shape press-interviews.test.ts's own ensureManagerFor
 * helper uses), then runs a second real season. The press interviews
 * themselves are never created by this test — only by career-world.ts's own
 * per-fixture manageAiPressForTeam call.
 */

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `ai-press-loop-${name}-`));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: name,
    gameVersion: "test",
    randomSeed: name,
  });
  return path;
};

/** Every team playing a real fixture gets a real ACTIVE manager_contracts
 * row — the exact shape the codebase's own AI-staffing outcome takes, not a
 * press-specific fabrication. */
const seedManagersForAllFixtureTeams = (db: ReturnType<typeof openGameDatabase>): number => {
  const teams = db
    .prepare(
      `SELECT DISTINCT team_id FROM (
        SELECT home_team_id AS team_id FROM fixtures
        UNION
        SELECT away_team_id AS team_id FROM fixtures
      )`,
    )
    .all() as Array<{ team_id: EntityId }>;
  let seeded = 0;
  for (const { team_id: teamId } of teams) {
    const existing = db
      .prepare("SELECT 1 FROM manager_contracts WHERE team_id=? AND status='ACTIVE'")
      .get(teamId);
    if (existing) continue;
    const person = db
      .prepare("SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM manager_profiles) LIMIT 1")
      .get() as { id: EntityId } | undefined;
    if (!person) break;
    const clubRow = db.prepare("SELECT club_id FROM teams WHERE id=?").get(teamId) as
      | { club_id: EntityId }
      | undefined;
    if (!clubRow) continue;
    const profileId = `production-loop-manager-profile-${person.id}` as EntityId;
    db.prepare(
      `INSERT INTO manager_profiles (id, person_id, attributes_json, preferred_style, reputation_profile, created_on)
       VALUES (?, ?, '{}', 'BALANCED', 'UNKNOWN', '2026-01-01')`,
    ).run(profileId, person.id);
    db.prepare(
      `INSERT INTO manager_contracts (id, manager_profile_id, person_id, team_id, club_id, job_title, contract_start, salary_amount_minor, currency, status)
       VALUES (?, ?, ?, ?, ?, 'Head Coach', '2026-01-01', 100000, 'NPR', 'ACTIVE')`,
    ).run(`production-loop-manager-contract-${person.id}`, profileId, person.id, teamId, clubRow.club_id);
    seeded += 1;
  }
  return seeded;
};

describe("AI press production loop — natural world-progression proof", () => {
  it("a real season of background fixtures naturally produces completed AI press interviews, with no test code calling the AI answer path directly", () => {
    const path = makeSave("production-loop");
    const db = openGameDatabase(path);

    // Season 1: bootstrap real fixtures/teams (no managers exist yet in a
    // fresh save — this run itself produces zero AI press, which is
    // correct: there is no AI-controlled manager to select).
    simulateNepalCareer({
      db,
      seasons: 1,
      seed: "ai-press-production-loop",
      savePath: path,
      competitionSeasonId: "anfa-national-league-2026" as EntityId,
      maxFixturesPerSeason: 90,
    });
    const seededManagers = seedManagersForAllFixtureTeams(db);
    expect(seededManagers).toBeGreaterThan(0);

    // Season 2: the same real career-world progression, now with real AI
    // managers in place — manageAiPressForTeam is called from inside this
    // call, never from this test.
    simulateNepalCareer({
      db,
      seasons: 1,
      seed: "ai-press-production-loop-season-2",
      savePath: path,
      competitionSeasonId: "anfa-national-league-2026" as EntityId,
      maxFixturesPerSeason: 90,
    });

    const interviews = new MediaPhaseBRepository(db).interviews();
    const humanPersonId = (
      db
        .prepare(`SELECT person_id FROM career_characters WHERE id = (SELECT player_character_id FROM saves LIMIT 1)`)
        .get() as { person_id?: EntityId } | undefined
    )?.person_id;
    const aiInterviews = interviews.filter(
      (interview) => interview.managerPersonId && interview.managerPersonId !== humanPersonId,
    );

    // The production loop must have created real AI interviews across a
    // full season of background fixtures for this to count as a genuine
    // natural-path proof rather than an untested code path.
    expect(aiInterviews.length).toBeGreaterThan(0);

    const byContext = new Map<string, number>();
    for (const interview of aiInterviews) byContext.set(interview.context, (byContext.get(interview.context) ?? 0) + 1);

    // Every AI interview the loop created is fully resolved: never left
    // OPEN (no AI Inbox exists to act on it), and every answer chose a
    // stance the question actually offered.
    for (const interview of aiInterviews) {
      expect(interview.status).toBe("COMPLETED");
      for (const answer of interview.structuredAnswers ?? []) {
        const question = interview.structuredQuestions?.find((item) => item.id === answer.questionId);
        expect(question).toBeDefined();
        expect(question!.options.some((option) => option.stance === answer.stance)).toBe(true);
      }
    }

    // Materiality bound: not every AI fixture produced a POST_MATCH
    // interview — a fixed materiality gate (shouldCreatePostMatchPress),
    // not a per-match certainty.
    const matches = db.prepare("SELECT COUNT(*) AS n FROM matches").get() as { n: number };
    const postMatchCount = byContext.get("POST_MATCH") ?? 0;
    expect(postMatchCount).toBeLessThan(matches.n);

    console.log("AI production loop — interviews by context:", Object.fromEntries(byContext));
    console.log("AI production loop — total matches:", matches.n, "| total AI interviews:", aiInterviews.length);
    db.close();
  }, 180_000);

  it("re-simulating the same already-played season again does not duplicate any AI interview", () => {
    const path = makeSave("production-loop-exact-once");
    const db = openGameDatabase(path);
    simulateNepalCareer({
      db,
      seasons: 1,
      seed: "ai-press-production-loop-exact-once",
      savePath: path,
      competitionSeasonId: "anfa-national-league-2026" as EntityId,
      maxFixturesPerSeason: 60,
    });
    seedManagersForAllFixtureTeams(db);
    // No maxFixturesPerSeason cap this time: the whole season's remaining
    // fixtures are played out in this one call, so a repeat call genuinely
    // has nothing left to simulate (rather than simply resuming from where
    // a fixture cap left off, which is what a second capped call would do).
    simulateNepalCareer({
      db,
      seasons: 1,
      seed: "ai-press-production-loop-exact-once-season-2",
      savePath: path,
      competitionSeasonId: "anfa-national-league-2026" as EntityId,
    });
    const first = new MediaPhaseBRepository(db).interviews().length;
    expect(first).toBeGreaterThan(0);

    // Re-running with the identical seed against the now-fully-played
    // season must not replay any fixture (ensureFixtures/completedFixtureIds
    // already guards that), so no additional AI press should be produced.
    simulateNepalCareer({
      db,
      seasons: 1,
      seed: "ai-press-production-loop-exact-once-season-2",
      savePath: path,
      competitionSeasonId: "anfa-national-league-2026" as EntityId,
    });
    const second = new MediaPhaseBRepository(db).interviews().length;
    expect(second).toBe(first);
    db.close();
  }, 180_000);
});
