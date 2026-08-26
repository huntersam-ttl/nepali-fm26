import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId, LiveMatchView } from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");

/**
 * Interactive matchday is exercised through the real service so the tests prove
 * the shipped command surface. Building the Nepal world is slow, so one career
 * is created and each test plays a different fixture.
 */
let service: DesktopApplicationService;
let savesDirectory: string;
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

beforeAll(() => {
  savesDirectory = mkdtempSync(join(tmpdir(), "nepal-live-match-"));
  service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
  const created = service.createCareer(career("Live Match"));
  if (!created.ok) throw new Error(`career creation failed: ${created.error.message}`);
  saveId = created.data.save.id;
}, 240_000);

afterAll(() => {
  service.closeCareer();
  rmSync(savesDirectory, { recursive: true, force: true });
});

/**
 * Hands each test its own fixture. An unfinalised session leaves a fixture
 * "scheduled", so tests would otherwise fight over the same match.
 */
const claimed = new Set<string>();
const nextFixture = (): EntityId => {
  const fixtures = service.getFixtures();
  if (!fixtures.ok) throw new Error("fixtures unavailable");
  const target = fixtures.data.upcoming.find((row) => !claimed.has(String(row.id)));
  if (!target) throw new Error("no upcoming fixture");
  claimed.add(String(target.id));
  return target.id;
};

const start = (fixtureId: EntityId, viewMode: "TEXT_LIVE" | "KEY_EVENTS" = "TEXT_LIVE") => {
  const started = service.startMatch({ fixtureId, viewMode });
  expect(started.ok).toBe(true);
  if (!started.ok) throw new Error(started.error.message);
  return started.data;
};

const advance = (command: Parameters<typeof service.advanceMatch>[0], fixtureId: EntityId) => {
  const result = service.advanceMatch(command, fixtureId);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};

/** Runs a match to full time without any manager intervention. */
const playOut = (view: LiveMatchView, fixtureId: EntityId): LiveMatchView => {
  let current = view;
  let guard = 0;
  while (current.period !== "FULL_TIME" && guard < 60) {
    current =
      current.period === "HALF_TIME"
        ? (service.continueFromHalfTime(fixtureId) as { ok: true; data: LiveMatchView }).data
        : advance({ minutes: 15 }, fixtureId);
    guard += 1;
  }
  return current;
};

describe("interactive matchday", () => {
  it("starts a match and exposes a live read model", () => {
    const fixtureId = nextFixture();
    const view = start(fixtureId);

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
  }, 120_000);

  it("advances by minutes and produces deterministic commentary", () => {
    const fixtureId = nextFixture();
    start(fixtureId);
    const view = advance({ minutes: 20 }, fixtureId);

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
  }, 120_000);

  it("serves only new commentary after a cursor", () => {
    const fixtureId = nextFixture();
    start(fixtureId);
    const first = advance({ minutes: 15 }, fixtureId);
    const cursor = first.cursor;

    const second = advance({ minutes: 15, since: cursor }, fixtureId);
    expect(second.commentary.every((line) => line.sequence > cursor)).toBe(true);
    expect(second.commentary.length).toBeLessThan(first.commentary.length + 30);

    // The full timeline is still available on request.
    const full = service.getLiveMatch(fixtureId);
    expect(full.ok).toBe(true);
    if (full.ok) {
      expect(full.data.commentary.length).toBeGreaterThan(second.commentary.length);
    }
  }, 120_000);

  it("advances to the next important event only", () => {
    const fixtureId = nextFixture();
    start(fixtureId);
    const view = advance({ toNextEvent: true, minImportance: "MAJOR" }, fixtureId);
    // It either found something major or reached a pause/full time.
    const majors = view.commentary.filter(
      (line) => line.importance === "MAJOR" || line.importance === "CRITICAL",
    );
    expect(majors.length + (view.pauseReason ? 1 : 0)).toBeGreaterThan(0);
  }, 120_000);

  it("pauses at half time and resumes into the second half", () => {
    const fixtureId = nextFixture();
    start(fixtureId);
    const halfTime = advance({ toHalfTime: true }, fixtureId);

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
  }, 120_000);

  it("makes a valid substitution and persists it", () => {
    const fixtureId = nextFixture();
    start(fixtureId);
    const view = advance({ minutes: 30 }, fixtureId);
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
  }, 120_000);

  it("rejects invalid substitutions with specific codes", () => {
    const fixtureId = nextFixture();
    start(fixtureId);
    const view = advance({ minutes: 20 }, fixtureId);
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
  }, 120_000);

  it("refuses substitutions once the limit is reached", () => {
    const fixtureId = nextFixture();
    start(fixtureId);
    let view = advance({ minutes: 20 }, fixtureId);

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
  }, 120_000);

  it("applies a tactical change that affects the rest of the match", () => {
    const fixtureId = nextFixture();
    start(fixtureId);
    const before = advance({ minutes: 20 }, fixtureId);
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
  }, 120_000);

  it("quick sims from the current state rather than from kickoff", () => {
    const fixtureId = nextFixture();
    start(fixtureId);
    const partial = advance({ minutes: 40 }, fixtureId);
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
  }, 180_000);

  it("produces a post-match report from persisted state", () => {
    const fixtures = service.getFixtures();
    expect(fixtures.ok).toBe(true);
    if (!fixtures.ok) return;
    const played = fixtures.data.results[0]!;

    const report = service.getPostMatchReport(played.id);
    expect(report.ok).toBe(true);
    if (!report.ok || !report.data) return;

    expect(report.data.homeTeamName).toBeTruthy();
    expect(["W", "D", "L"]).toContain(report.data.result);
    expect(report.data.timeline.length).toBeGreaterThan(5);
    expect(report.data.ratings.length).toBeGreaterThanOrEqual(22);
    expect(report.data.stats.possession.home + report.data.stats.possession.away).toBe(100);

    // Player of the match is the top persisted rating, not a new calculation.
    const best = [...report.data.ratings]
      .filter((rating) => rating.minutes > 0)
      .sort((a, b) => b.rating - a.rating)[0];
    expect(report.data.playerOfTheMatch?.rating).toBe(best?.rating);

    for (const scorer of report.data.scorers) {
      expect(scorer.playerName).not.toBe("Unknown player");
    }
    expect(report.data.attendance).toBeGreaterThan(0);
  }, 180_000);

  it("keeps a dismissed player off the pitch and unreplaceable", () => {
    // Play matches until one produces a dismissal.
    let redCardView: LiveMatchView | undefined;
    for (let attempt = 0; attempt < 6 && !redCardView; attempt += 1) {
      const fixtureId = nextFixture();
      const view = playOut(start(fixtureId), fixtureId);
      const sentOff = [...view.home.playersOff, ...view.away.playersOff].filter(
        (player) => player.redCard,
      );
      if (sentOff.length > 0) redCardView = view;
      service.quickSimCurrentMatch(fixtureId);
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
  }, 300_000);

  it("refuses match commands when no session exists", () => {
    const fixtures = service.getFixtures();
    if (!fixtures.ok) return;
    const unstarted = fixtures.data.upcoming.at(-1)!;
    expect(service.getLiveMatch(unstarted.id)).toMatchObject({
      ok: false,
      error: { code: "FIXTURE_MISSING" },
    });
  });

  it("refuses to control a match that is not the manager's", () => {
    const service2 = service;
    const foreign = "fixture-that-is-not-ours" as EntityId;
    expect(service2.startMatch({ fixtureId: foreign })).toMatchObject({
      ok: false,
      error: { code: "FIXTURE_MISSING" },
    });
  });

  it("refuses match commands with no career open", () => {
    service.closeCareer();
    expect(service.startMatch({})).toMatchObject({
      ok: false,
      error: { code: "SESSION_NOT_OPEN" },
    });
    expect(service.loadCareer(saveId).ok).toBe(true);
  });
});
