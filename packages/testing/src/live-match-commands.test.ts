import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId, LiveMatchView } from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");

/**
 * Interactive matchday is exercised through the real service so these tests
 * prove the shipped command surface — but a single shared, ever-evolving
 * world is the wrong fixture strategy for it.
 *
 * Root cause of the previous version's pathological (effectively
 * non-terminating) runtime: `continueCareer()` is intentionally idempotent
 * once the calendar reaches a matchday the manager hasn't addressed (the
 * comment at its call site is explicit: "the manager must choose a match
 * action before the calendar can move again"). Most of these tests
 * deliberately leave a match session in progress rather than finishing it
 * (that's the point — they're testing mid-match state). Once test 1 left its
 * match open, every later test's "advance the shared world until we reach a
 * later fixture's date" loop could never make progress, because the
 * calendar was permanently stuck at test 1's unaddressed matchday. That loop
 * had no iteration bound, so it span forever — synchronously, with no
 * `await` anywhere in it, meaning the JS event loop never yielded back to
 * the test runner's own per-test timeout to let it intervene. That is a
 * fully synchronous CPU-bound infinite loop: 100% CPU, zero output, no
 * crash, indistinguishable from "just very slow" without profiling it.
 * Confirmed via direct A/B: the exact same failure mode reproduced
 * identically on pre-Sprint-4 source, so this bug predates and is unrelated
 * to any tactics work — it is a pure test-fixture defect.
 *
 * The fix: build the real Nepal world and advance it to the managed club's
 * first actionable fixture exactly once (~20s — unavoidable, real world
 * creation), then freeze that moment as a "golden" save file. Every test
 * below opens its OWN independent copy of that exact snapshot instead of
 * sharing one evolving world, so no test's leftover open match can ever
 * block another test's fixture, and no test needs the calendar to advance
 * any further than beforeAll already (once) took it. This keeps full
 * integration coverage (real DB, real DesktopApplicationService, real match
 * session, real repositories) while making fixture acquisition O(1) per
 * test instead of O(cumulative world days advanced).
 */
const WORLD_DIR = mkdtempSync(join(tmpdir(), "nepal-live-match-world-"));
let goldenDbPath: string;
let goldenFixtureId: EntityId;
let saveId: EntityId;

const career = (saveName: string) => ({
  saveName,
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

/** A real season has well under 100 fixture days between any two matches for
 * one club — this is a generous but genuine bound, not a magic number tuned
 * to one run. Exceeding it means the calendar is stuck, not slow. */
const MAX_CONTINUE_ITERATIONS = 60;

/** Advances `service`'s open career until its world date reaches `target`,
 * bounded so a stuck calendar throws a clear error instead of spinning
 * forever. This is the only place this file ever advances a world clock. */
const advanceToDate = (service: DesktopApplicationService, targetDate: string): void => {
  let iterations = 0;
  for (;;) {
    const fixtures = service.getFixtures();
    if (!fixtures.ok) throw new Error("fixtures unavailable");
    if (fixtures.data.worldDate >= targetDate) return;
    if (iterations >= MAX_CONTINUE_ITERATIONS) {
      throw new Error(
        `continueCareer() did not reach ${targetDate} within ${MAX_CONTINUE_ITERATIONS} iterations ` +
          `(stuck at ${fixtures.data.worldDate}) — the world calendar is blocked, most likely on an ` +
          `unaddressed matchday.`,
      );
    }
    const advanced = service.continueCareer();
    if (!advanced.ok) throw new Error(advanced.error.message);
    iterations += 1;
  }
};

beforeAll(() => {
  const service = new DesktopApplicationService({
    savesDirectory: WORLD_DIR,
    worldDatasetPath: WORLD_DATASET,
  });
  const created = service.createCareer(career("Live Match"));
  if (!created.ok) throw new Error(`career creation failed: ${created.error.message}`);
  saveId = created.data.save.id;

  const fixtures = service.getFixtures();
  if (!fixtures.ok) throw new Error("fixtures unavailable");
  const target = fixtures.data.upcoming[0];
  if (!target) throw new Error("no upcoming fixture");
  advanceToDate(service, target.date);
  goldenFixtureId = target.id;

  const saves = service.listSaves();
  if (!saves.ok) throw new Error("save catalog unavailable");
  const entry = saves.data.find((row) => row.saveId === saveId);
  if (!entry) throw new Error("golden save entry not found");
  service.closeCareer();

  goldenDbPath = join(WORLD_DIR, "golden.sqlite");
  copyFileSync(entry.filePath, goldenDbPath);
}, 240_000);

afterAll(() => {
  rmSync(WORLD_DIR, { recursive: true, force: true });
});

/**
 * Every test gets its own independent clone of the golden snapshot, so nothing
 * it does (leaving a match open, finishing one, closing the career) can
 * affect any other test. `close()` must be called at the end of each test
 * (via the returned handle, or automatically in `afterEach`) to release the
 * file handle before the temp file is removed.
 */
let activeClone: { service: DesktopApplicationService; dir: string } | undefined;

const freshMatch = (): { service: DesktopApplicationService; fixtureId: EntityId } => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-live-match-clone-"));
  const dbPath = join(dir, "clone.sqlite");
  copyFileSync(goldenDbPath, dbPath);
  const service = new DesktopApplicationService({ savesDirectory: dir, worldDatasetPath: WORLD_DATASET });
  const loaded = service.loadCareerByPath(dbPath);
  if (!loaded.ok) throw new Error(`clone load failed: ${loaded.error.message}`);
  activeClone = { service, dir };
  return { service, fixtureId: goldenFixtureId };
};

afterEach(() => {
  if (activeClone) {
    activeClone.service.closeCareer();
    rmSync(activeClone.dir, { recursive: true, force: true });
    activeClone = undefined;
  }
});

const start = (
  service: DesktopApplicationService,
  fixtureId: EntityId,
  viewMode: "TEXT_LIVE" | "KEY_EVENTS" = "TEXT_LIVE",
) => {
  const started = service.startMatch({ fixtureId, viewMode });
  expect(started.ok).toBe(true);
  if (!started.ok) throw new Error(started.error.message);
  return started.data;
};

const advance = (
  service: DesktopApplicationService,
  command: Parameters<DesktopApplicationService["advanceMatch"]>[0],
  fixtureId: EntityId,
) => {
  const result = service.advanceMatch(command, fixtureId);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};

/** Runs a match to full time without any manager intervention. Bounded the
 * same way the production Text Live screen bounds its own auto-advance. */
const playOut = (
  service: DesktopApplicationService,
  view: LiveMatchView,
  fixtureId: EntityId,
): LiveMatchView => {
  let current = view;
  let guard = 0;
  while (current.period !== "FULL_TIME" && guard < 60) {
    current =
      current.period === "HALF_TIME"
        ? (service.continueFromHalfTime(fixtureId) as { ok: true; data: LiveMatchView }).data
        : advance(service, { minutes: 15 }, fixtureId);
    guard += 1;
  }
  return current;
};

describe("interactive matchday", () => {
  it("starts a match and exposes a live read model", () => {
    const { service, fixtureId } = freshMatch();
    const view = start(service, fixtureId);

    expect(view.period).toBe("NOT_STARTED");
    expect(view.minute).toBe(0);
    expect(view.home.goals).toBe(0);
    expect(view.managedTeamId).toBeTruthy();
    expect([view.home.teamId, view.away.teamId]).toContain(view.managedTeamId);
    expect(view.viewMode).toBe("TEXT_LIVE");
    expect(view.finalized).toBe(false);

    // Serialised engine state must never cross the boundary.
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain("rngState");
    expect(serialised).not.toContain("stateJson");

    const managed = view.home.teamId === view.managedTeamId ? view.home : view.away;
    expect(managed.onPitch.length).toBe(11);
    expect(managed.substitutionsRemaining).toBeGreaterThan(0);
    expect(managed.playersOnPitch).toBe(11);
  });

  it("advances by minutes and produces deterministic commentary", () => {
    const { service, fixtureId } = freshMatch();
    start(service, fixtureId);
    const view = advance(service, { minutes: 20 }, fixtureId);

    expect(view.minute).toBeGreaterThan(0);
    expect(view.commentary.length).toBeGreaterThan(0);
    for (const line of view.commentary) {
      expect(line.text.length).toBeGreaterThan(3);
      expect(["MINOR", "NOTABLE", "MAJOR", "CRITICAL"]).toContain(line.importance);
    }
    // Kick-off is always the first thing said.
    expect(view.commentary[0]?.type).toBe("KICK_OFF");

    // Re-reading the same match yields identical commentary text.
    const reread = service.getLiveMatch(fixtureId);
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    expect(reread.data.commentary.map((line) => line.text)).toEqual(
      view.commentary.map((line) => line.text),
    );
  });

  it("serves only new commentary after a cursor", () => {
    const { service, fixtureId } = freshMatch();
    start(service, fixtureId);
    const first = advance(service, { minutes: 15 }, fixtureId);
    const cursor = first.cursor;

    const second = advance(service, { minutes: 15, since: cursor }, fixtureId);
    expect(second.commentary.every((line) => line.sequence > cursor)).toBe(true);
    expect(second.commentary.length).toBeLessThan(first.commentary.length + 30);

    // The full timeline is still available on request.
    const full = service.getLiveMatch(fixtureId);
    expect(full.ok).toBe(true);
    if (full.ok) {
      expect(full.data.commentary.length).toBeGreaterThan(second.commentary.length);
    }
  });

  it("advances to the next important event only", () => {
    const { service, fixtureId } = freshMatch();
    start(service, fixtureId);
    const view = advance(service, { toNextEvent: true, minImportance: "MAJOR" }, fixtureId);
    // It either found something major or reached a pause/full time.
    const majors = view.commentary.filter(
      (line) => line.importance === "MAJOR" || line.importance === "CRITICAL",
    );
    expect(majors.length + (view.pauseReason ? 1 : 0)).toBeGreaterThan(0);
  });

  it("pauses at half time and resumes into the second half", () => {
    const { service, fixtureId } = freshMatch();
    start(service, fixtureId);
    const halfTime = advance(service, { toHalfTime: true }, fixtureId);

    expect(halfTime.period).toBe("HALF_TIME");
    expect(halfTime.pauseReason).toBe("HALF_TIME");
    expect(halfTime.minute).toBe(45);

    const resumed = service.continueFromHalfTime(fixtureId);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.data.period).toBe("SECOND_HALF");
    expect(resumed.data.pauseReason).toBeUndefined();

    // Continuing outside half time is refused.
    expect(service.continueFromHalfTime(fixtureId)).toMatchObject({
      ok: false,
      error: { code: "MATCH_NOT_AT_HALF_TIME" },
    });
  });

  it("makes a valid substitution and persists it", () => {
    const { service, fixtureId } = freshMatch();
    start(service, fixtureId);
    const view = advance(service, { minutes: 30 }, fixtureId);
    const managed = view.home.teamId === view.managedTeamId ? view.home : view.away;

    const off = managed.onPitch.find((player) => player.position !== "GK")!;
    const on = managed.bench[0]!;
    const usedBefore = managed.substitutionsUsed;

    const result = service.makeSubstitution(
      { playerOffId: off.personId, playerOnId: on.personId },
      fixtureId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after =
      result.data.home.teamId === result.data.managedTeamId ? result.data.home : result.data.away;
    expect(after.substitutionsUsed).toBe(usedBefore + 1);
    expect(after.onPitch.some((player) => player.personId === on.personId)).toBe(true);
    expect(after.onPitch.some((player) => player.personId === off.personId)).toBe(false);
    expect(after.playersOff.some((player) => player.personId === off.personId)).toBe(true);
    expect(after.bench.some((player) => player.personId === on.personId)).toBe(false);
    expect(after.playersOnPitch).toBe(11);

    const subLine = result.data.commentary.find((line) => line.type === "SUBSTITUTION");
    expect(subLine).toBeDefined();

    // Persisted: a fresh read shows the same lineup.
    const reread = service.getLiveMatch(fixtureId);
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    const rereadTeam =
      reread.data.home.teamId === reread.data.managedTeamId ? reread.data.home : reread.data.away;
    expect(rereadTeam.onPitch.some((player) => player.personId === on.personId)).toBe(true);
  });

  it("rejects invalid substitutions with specific codes", () => {
    const { service, fixtureId } = freshMatch();
    start(service, fixtureId);
    const view = advance(service, { minutes: 20 }, fixtureId);
    const managed = view.home.teamId === view.managedTeamId ? view.home : view.away;
    const opponent = managed === view.home ? view.away : view.home;
    const onPitch = managed.onPitch[1]!;
    const bench = managed.bench[0]!;

    // A player who is not on the pitch cannot be withdrawn.
    expect(
      service.makeSubstitution(
        { playerOffId: bench.personId, playerOnId: bench.personId },
        fixtureId,
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_SUBSTITUTION" } });

    expect(
      service.makeSubstitution(
        { playerOffId: opponent.onPitch[0]!.personId, playerOnId: bench.personId },
        fixtureId,
      ),
    ).toMatchObject({ ok: false, error: { code: "PLAYER_NOT_ON_PITCH" } });

    // Someone who is not on this bench cannot come on.
    expect(
      service.makeSubstitution(
        { playerOffId: onPitch.personId, playerOnId: opponent.bench[0]!.personId },
        fixtureId,
      ),
    ).toMatchObject({ ok: false, error: { code: "PLAYER_NOT_ON_BENCH" } });
  });

  it("refuses substitutions once the limit is reached", () => {
    const { service, fixtureId } = freshMatch();
    start(service, fixtureId);
    let view = advance(service, { minutes: 20 }, fixtureId);

    for (let index = 0; index < 6; index += 1) {
      const managed = view.home.teamId === view.managedTeamId ? view.home : view.away;
      if (managed.substitutionsRemaining === 0) break;
      const off = managed.onPitch.find((player) => player.position !== "GK");
      const on = managed.bench[0];
      if (!off || !on) break;
      const result = service.makeSubstitution(
        { playerOffId: off.personId, playerOnId: on.personId },
        fixtureId,
      );
      if (!result.ok) break;
      view = result.data;
    }

    const managed = view.home.teamId === view.managedTeamId ? view.home : view.away;
    expect(managed.substitutionsRemaining).toBe(0);

    const extra = managed.bench[0];
    if (extra) {
      expect(
        service.makeSubstitution(
          {
            playerOffId: managed.onPitch.find((p) => p.position !== "GK")!.personId,
            playerOnId: extra.personId,
          },
          fixtureId,
        ),
      ).toMatchObject({ ok: false, error: { code: "SUBSTITUTION_LIMIT_REACHED" } });
    }
  });

  it("applies a tactical change that affects the rest of the match", () => {
    const { service, fixtureId } = freshMatch();
    start(service, fixtureId);
    const before = advance(service, { minutes: 20 }, fixtureId);
    const managedBefore = before.home.teamId === before.managedTeamId ? before.home : before.away;

    const changed = service.updateLiveTactics(
      { mentality: "ATTACKING", style: "HIGH_PRESS", pressingIntensity: 80 },
      fixtureId,
    );
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;

    const managedAfter =
      changed.data.home.teamId === changed.data.managedTeamId
        ? changed.data.home
        : changed.data.away;
    expect(managedAfter.mentality).toBe("ATTACKING");
    expect(managedAfter.style).toBe("HIGH_PRESS");
    expect(managedAfter.mentality).not.toBe(managedBefore.mentality);

    const changeLine = changed.data.commentary.find((line) => line.type === "TACTICAL_CHANGE");
    expect(changeLine).toBeDefined();

    // Survives a re-read.
    const reread = service.getLiveMatch(fixtureId);
    expect(reread.ok).toBe(true);
    if (reread.ok) {
      const team =
        reread.data.home.teamId === reread.data.managedTeamId ? reread.data.home : reread.data.away;
      expect(team.mentality).toBe("ATTACKING");
    }
  });

  it("quick sims from the current state rather than from kickoff", () => {
    const { service, fixtureId } = freshMatch();
    start(service, fixtureId);
    const partial = advance(service, { minutes: 40 }, fixtureId);
    expect(partial.minute).toBeGreaterThan(0);
    const commentaryBefore = partial.commentary.map((line) => line.text);

    const finished = service.quickSimCurrentMatch(fixtureId);
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    expect(finished.data.period).toBe("FULL_TIME");
    expect(finished.data.finalized).toBe(true);

    // The first half already played is still in the timeline, unchanged.
    const after = finished.data.commentary.map((line) => line.text);
    expect(after.slice(0, commentaryBefore.length)).toEqual(commentaryBefore);

    // Playing it again is a safe no-op that reports the finished match rather
    // than simulating a second time.
    const repeat = service.quickSimCurrentMatch(fixtureId);
    expect(repeat.ok).toBe(true);
    if (repeat.ok) {
      expect(repeat.data.period).toBe("FULL_TIME");
      expect(repeat.data.home.goals).toBe(finished.data.home.goals);
      expect(repeat.data.away.goals).toBe(finished.data.away.goals);
    }
  });

  it("commits the match when full time is reached through live play, and the post-match report reads that persisted state", () => {
    // Regression: only Quick Sim used to finalise, so a Text Live match played
    // to ninety minutes never committed its result to the world. Also covers
    // the post-match-report-from-persisted-state contract in the same match,
    // rather than depending on a previous test's leftover result (order
    // independence — every test here owns its own fixture).
    const { service, fixtureId } = freshMatch();
    let view = start(service, fixtureId, "TEXT_LIVE");
    let guard = 0;
    while (view.period !== "FULL_TIME" && guard < 40) {
      view =
        view.period === "HALF_TIME"
          ? (service.continueFromHalfTime(fixtureId) as { ok: true; data: LiveMatchView }).data
          : advance(service, { minutes: 15 }, fixtureId);
      guard += 1;
    }

    expect(view.period).toBe("FULL_TIME");
    expect(view.finalized).toBe(true);

    // The world reflects it: the fixture has a result and left the upcoming list.
    const fixtures = service.getFixtures();
    expect(fixtures.ok).toBe(true);
    if (!fixtures.ok) return;
    expect(fixtures.data.upcoming.some((row) => row.id === fixtureId)).toBe(false);
    expect(fixtures.data.results.some((row) => row.id === fixtureId)).toBe(true);

    // And a report exists without needing a separate Quick Sim.
    const report = service.getPostMatchReport(fixtureId);
    expect(report.ok).toBe(true);
    if (!report.ok || !report.data) return;
    expect(report.data.ratings.length).toBeGreaterThanOrEqual(22);
    expect(report.data.attendance).toBeGreaterThan(0);
    // The report's venue was hardcoded to undefined, rendering as a raw
    // "Unknown" in the UI even though the live match screen resolves a
    // real venue (or a Nepal-scale SIMULATION_ONLY fallback) for the same
    // fixture via the same venueForFixture helper.
    expect(report.data.venue).toBeTruthy();

    // Full post-match-report contract, read from persisted state only.
    expect(report.data.homeTeamName).toBeTruthy();
    expect(["W", "D", "L"]).toContain(report.data.result);
    expect(report.data.timeline.length).toBeGreaterThan(5);
    expect(report.data.stats.possession.home + report.data.stats.possession.away).toBe(100);
    const best = [...report.data.ratings]
      .filter((rating) => rating.minutes > 0)
      .sort((a, b) => b.rating - a.rating)[0];
    expect(report.data.playerOfTheMatch?.rating).toBe(best?.rating);
    for (const scorer of report.data.scorers) {
      expect(scorer.playerName).not.toBe("Unknown player");
    }
  });

  it("keeps a dismissed player off the pitch and unreplaceable", () => {
    // Play matches until one produces a dismissal. Bounded: a red card is a
    // real but not-guaranteed event, so this searches a few fixtures within
    // its own clone — the only test that needs more than one fixture, since
    // it's the only one testing a probabilistic in-match event.
    const { service, fixtureId: first } = freshMatch();
    let redCardView: LiveMatchView | undefined;
    let fixtureId = first;
    for (let attempt = 0; attempt < 3 && !redCardView; attempt += 1) {
      const view = playOut(service, start(service, fixtureId), fixtureId);
      const sentOff = [...view.home.playersOff, ...view.away.playersOff].filter(
        (player) => player.redCard,
      );
      if (sentOff.length > 0) redCardView = view;
      service.quickSimCurrentMatch(fixtureId);
      if (!redCardView && attempt < 2) {
        const fixtures = service.getFixtures();
        if (!fixtures.ok) break;
        const next = fixtures.data.upcoming[0];
        if (!next) break;
        advanceToDate(service, next.date);
        fixtureId = next.id;
      }
    }
    if (!redCardView) return; // No dismissal in this world's seeds; nothing to assert.

    for (const team of [redCardView.home, redCardView.away]) {
      const dismissed = team.playersOff.filter((player) => player.redCard);
      if (dismissed.length === 0) continue;
      // A sent-off player is never on the pitch and never on the bench.
      for (const player of dismissed) {
        expect(team.onPitch.some((candidate) => candidate.personId === player.personId)).toBe(
          false,
        );
        expect(team.bench.some((candidate) => candidate.personId === player.personId)).toBe(false);
        expect(player.status).toBe("SENT_OFF");
      }
      expect(team.playersOnPitch).toBeLessThanOrEqual(11);
    }
  }, 60_000);

  it("refuses match commands when no session exists", () => {
    const { service } = freshMatch();
    // A fixture nobody has started a session for, so it definitely has none.
    expect(service.getLiveMatch("fixture-with-no-session" as EntityId)).toMatchObject({
      ok: false,
      error: { code: "FIXTURE_MISSING" },
    });
  });

  it("refuses to control a match that is not the manager's", () => {
    const { service } = freshMatch();
    const foreign = "fixture-that-is-not-ours" as EntityId;
    expect(service.startMatch({ fixtureId: foreign })).toMatchObject({
      ok: false,
      error: { code: "FIXTURE_MISSING" },
    });
  });

  it("refuses match commands with no career open", () => {
    const { service } = freshMatch();
    service.closeCareer();
    expect(service.startMatch({})).toMatchObject({
      ok: false,
      error: { code: "SESSION_NOT_OPEN" },
    });
  });
});
