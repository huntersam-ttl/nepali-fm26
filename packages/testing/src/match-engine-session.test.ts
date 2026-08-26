import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CompetitionRepository,
  MatchSessionRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  compareMatchEvents,
  createMatchState,
  deserializeMatchState,
  isKeyEvent,
  matchEventImportance,
  runMatchToCompletion,
  serializeMatchState,
  simulateMatch,
  stepMatch,
  toMatchResult,
  type LiveMatchState,
} from "@nepal-football-sim/simulation";
import type { FixtureRecord, PlayerAttributeSet } from "@nepal-football-sim/shared-types";

// ---------------------------------------------------------------------------
// Deterministic synthetic squads: the engine only needs attribute sets.
// ---------------------------------------------------------------------------

const technical = (base: number) => ({
  firstTouch: base,
  passing: base,
  crossing: base - 1,
  dribbling: base,
  finishing: base - 1,
  heading: base,
  tackling: base,
  technique: base,
  longShots: base - 2,
  setPieces: base,
});
const mental = (base: number) => ({
  decisions: base,
  vision: base,
  composure: base,
  positioning: base,
  anticipation: base,
  workRate: base,
  teamwork: base,
  leadership: base - 1,
  aggression: base,
  determination: base,
  professionalism: base,
});
const physical = (base: number) => ({
  pace: base,
  acceleration: base,
  strength: base,
  stamina: base,
  agility: base,
  balance: base,
  jumping: base,
  naturalFitness: base,
});
const goalkeeping = (base: number) => ({
  handling: base,
  reflexes: base,
  oneOnOnes: base,
  aerialReach: base,
  kicking: base,
  distribution: base,
  commandOfArea: base,
});

const POSITIONS = [
  "GK",
  "RB",
  "CB",
  "CB",
  "LB",
  "DM",
  "CM",
  "AM",
  "RW",
  "LW",
  "ST",
  "GK",
  "CB",
  "CM",
  "RW",
  "ST",
  "LB",
  "CM",
] as const;

const squad = (teamId: string, base: number): PlayerAttributeSet[] =>
  POSITIONS.map((position, index) => ({
    id: `${teamId}-attr-${index}`,
    personId: `${teamId}-p${index}`,
    primaryPosition: position,
    secondaryPositions: [],
    technical: technical(base + (index % 3)),
    mental: mental(base + (index % 2)),
    physical: physical(base + (index % 4)),
    goalkeeping: goalkeeping(position === "GK" ? base + 4 : 2),
  })) as unknown as PlayerAttributeSet[];

const fixture = {
  id: "fixture-baseline",
  competitionSeasonId: "season-baseline",
  homeTeamId: "team-home",
  awayTeamId: "team-away",
  scheduledDate: "2026-08-08",
  status: "scheduled",
  round: 1,
} as unknown as FixtureRecord;

const input = (seed: string) => ({
  fixture,
  homePlayers: squad("team-home", 12),
  awayPlayers: squad("team-away", 11),
  seed,
});

const SEEDS = ["seed-alpha", "seed-beta", "seed-gamma", "seed-delta", "seed-epsilon"];

/** Comparable shape: ids are stable but irrelevant to match behaviour. */
const fingerprint = (state: LiveMatchState) => {
  const result = toMatchResult(state);
  return {
    score: `${result.match.homeGoals}-${result.match.awayGoals}`,
    events: result.events.map(
      (event) =>
        `${event.minute}|${event.type}|${event.teamId}|${event.primaryPersonId ?? ""}|${event.secondaryPersonId ?? ""}`,
    ),
    homeStats: result.homeStats,
    awayStats: result.awayStats,
    players: result.playerStates
      .map(
        (player) =>
          `${player.personId}|${player.minutesPlayed}|${player.rating.toFixed(4)}|${player.goals}|${player.assists}|${player.shots}|${player.yellowCards}|${player.redCard}`,
      )
      .sort(),
  };
};

/** Minimal FK chain so a fixture row can exist: competition, season, teams. */
const seedMinimalWorld = (db: GameDatabase): void => {
  const world = new WorldRepository(db);
  const competitions = new CompetitionRepository(db);
  world.insertCountry({ id: "country-test" as never, name: "Testland", isoCode: "TL" } as never);
  world.insertClub({
    id: "club-test" as never,
    name: "Test Club",
    countryId: "country-test" as never,
    ownershipType: "COMMUNITY",
  } as never);
  world.insertCompetition({
    id: "season-competition" as never,
    name: "Test Competition",
    scope: "domestic",
  } as never);
  world.insertCompetitionSeason({
    id: "season-baseline" as never,
    competitionId: "season-competition" as never,
    name: "Test Season",
    startDate: "2026-08-01",
    endDate: "2027-05-31",
  } as never);
  for (const teamId of ["team-home", "team-away"]) {
    world.insertTeam({
      id: teamId as never,
      clubId: "club-test" as never,
      name: teamId,
      level: "senior",
      gender: "men",
    } as never);
  }
  competitions.insertFixture(fixture);
};

const tempDbs: Array<{ db: GameDatabase; dir: string }> = [];

const freshDb = (): GameDatabase => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-match-"));
  const db = openGameDatabase(join(dir, "match.sqlite"));
  migrateDatabase(db);
  seedMinimalWorld(db);
  tempDbs.push({ db, dir });
  return db;
};

afterEach(() => {
  for (const entry of tempDbs.splice(0)) {
    try {
      entry.db.close();
    } catch {
      // Already closed by a test that exercised reopening.
    }
    rmSync(entry.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------

describe("resumable match engine", () => {
  it("produces the same match step-wise as run-to-completion", () => {
    for (const seed of SEEDS) {
      const atomic = runMatchToCompletion(createMatchState(input(seed)));

      // Drive the state machine one step at a time instead.
      const stepped = createMatchState(input(seed));
      let guard = 0;
      while (stepped.period !== "FULL_TIME" && guard < 200) {
        stepMatch(stepped);
        guard += 1;
      }

      expect(stepped.period).toBe("FULL_TIME");
      expect(fingerprint(stepped)).toEqual(fingerprint(atomic));
    }
  });

  it("keeps simulateMatch as an unchanged run-to-completion API", () => {
    for (const seed of SEEDS) {
      const viaApi = simulateMatch(input(seed));
      const viaState = toMatchResult(runMatchToCompletion(createMatchState(input(seed))));
      expect(viaApi.match.homeGoals).toBe(viaState.match.homeGoals);
      expect(viaApi.match.awayGoals).toBe(viaState.match.awayGoals);
      expect(viaApi.events.length).toBe(viaState.events.length);
      expect(viaApi.homeStats).toEqual(viaState.homeStats);
    }
  });

  it("resumes from a serialised checkpoint with no divergence", () => {
    for (const seed of SEEDS) {
      const uninterrupted = runMatchToCompletion(createMatchState(input(seed)));

      // Stop mid-match, round-trip through JSON, then continue.
      const partial = createMatchState(input(seed));
      for (let step = 0; step < 40; step += 1) stepMatch(partial);
      expect(partial.period).not.toBe("FULL_TIME");
      const revived = deserializeMatchState(serializeMatchState(partial));
      const resumed = runMatchToCompletion(revived);

      expect(fingerprint(resumed)).toEqual(fingerprint(uninterrupted));
    }
  });

  it("resumes identically from several different interruption points", () => {
    const seed = "seed-gamma";
    const expected = fingerprint(runMatchToCompletion(createMatchState(input(seed))));
    for (const stopAfter of [1, 12, 46, 47, 80]) {
      const partial = createMatchState(input(seed));
      for (let step = 0; step < stopAfter; step += 1) stepMatch(partial);
      const resumed = runMatchToCompletion(deserializeMatchState(serializeMatchState(partial)));
      expect(fingerprint(resumed)).toEqual(expected);
    }
  });

  it("emits events in chronological order", () => {
    for (const seed of SEEDS) {
      const events = simulateMatch(input(seed)).events;
      const sorted = [...events].sort(compareMatchEvents);
      expect(events).toEqual(sorted);

      const kickOff = events.findIndex((event) => event.type === "KICK_OFF");
      const halfTime = events.findIndex((event) => event.type === "HALF_TIME");
      const secondHalf = events.findIndex((event) => event.type === "SECOND_HALF");
      const fullTime = events.findIndex((event) => event.type === "FULL_TIME");
      expect(kickOff).toBe(0);
      expect(halfTime).toBeGreaterThan(kickOff);
      expect(secondHalf).toBeGreaterThan(halfTime);
      expect(fullTime).toBe(events.length - 1);
    }
  });

  it("classifies event importance and exposes a key-event filter", () => {
    const events = simulateMatch(input("seed-gamma")).events;
    expect(matchEventImportance({ type: "GOAL" } as never)).toBe("CRITICAL");
    expect(matchEventImportance({ type: "RED_CARD" } as never)).toBe("CRITICAL");
    expect(matchEventImportance({ type: "SUBSTITUTION" } as never)).toBe("MAJOR");
    expect(matchEventImportance({ type: "YELLOW_CARD" } as never)).toBe("NOTABLE");
    expect(matchEventImportance({ type: "CORNER" } as never)).toBe("MINOR");
    // A clear-cut chance is worth showing even though most shots are not.
    expect(matchEventImportance({ type: "SHOT", data: { chanceType: "clear" } } as never)).toBe(
      "NOTABLE",
    );
    expect(matchEventImportance({ type: "SHOT", data: { chanceType: "low" } } as never)).toBe(
      "MINOR",
    );

    for (const event of events) {
      expect(event.data?.importance).toBe(matchEventImportance(event));
    }
    // Key Events is a strict subset of the same timeline.
    const key = events.filter(isKeyEvent);
    expect(key.length).toBeGreaterThan(0);
    expect(key.length).toBeLessThan(events.length);
    expect(events.filter((event) => event.type === "GOAL").every(isKeyEvent)).toBe(true);
  });

  it("dismisses a player for a second bookable offence exactly once", () => {
    // Search seeds for a match containing a second yellow.
    let found: ReturnType<typeof simulateMatch> | undefined;
    for (let index = 0; index < 400 && !found; index += 1) {
      const result = simulateMatch(input(`card-seed-${index}`));
      if (result.events.some((event) => event.type === "SECOND_YELLOW")) found = result;
    }
    expect(found, "no second yellow produced in 400 seeds").toBeDefined();
    if (!found) return;

    const secondYellow = found.events.find((event) => event.type === "SECOND_YELLOW")!;
    const personId = secondYellow.primaryPersonId!;
    const player = found.playerStates.find((state) => state.personId === personId)!;

    expect(player.yellowCards).toBe(2);
    expect(player.redCard).toBe(true);
    expect(player.sentOffMinute).toBe(secondYellow.minute);

    // A dismissal from a second booking is a red card, counted once.
    const reds = found.events.filter(
      (event) => event.type === "RED_CARD" && event.primaryPersonId === personId,
    );
    expect(reds).toHaveLength(1);
    expect(reds[0]?.data?.secondYellow).toBe(true);

    const teamStats =
      found.homeStats.teamId === secondYellow.teamId ? found.homeStats : found.awayStats;
    const dismissedOnTeam = found.playerStates.filter(
      (state) => state.teamId === secondYellow.teamId && state.redCard,
    ).length;
    expect(teamStats.redCards).toBe(dismissedOnTeam);

    // The player stops accumulating minutes at the dismissal.
    expect(player.minutesPlayed).toBeLessThan(90);
  });

  it("produces varied possession that totals 100", () => {
    const shares = new Set<number>();
    for (const seed of SEEDS) {
      const result = simulateMatch(input(seed));
      expect(result.homeStats.possession + result.awayStats.possession).toBe(100);
      expect(result.homeStats.possession).toBeGreaterThan(20);
      expect(result.homeStats.possession).toBeLessThan(80);
      shares.add(result.homeStats.possession);
    }
    // Possession must respond to the match, not be a constant.
    expect(shares.size).toBeGreaterThan(1);
    expect(shares.has(50) && shares.size === 1).toBe(false);

    // Deterministic for the same seed.
    expect(simulateMatch(input("seed-beta")).homeStats.possession).toBe(
      simulateMatch(input("seed-beta")).homeStats.possession,
    );
  });

  it("attributes minutes to substitutes and withdrawn players", () => {
    const state = createMatchState({
      ...input("sub-seed"),
      homeTacticalSetup: undefined,
    });
    // Give the home side a usable bench and force a substitution at minute 60.
    state.home.benchIds = ["team-home-p12", "team-home-p13"] as never;
    state.home.benchPlayers = squad("team-home", 12)
      .filter((player) => ["team-home-p12", "team-home-p13"].includes(String(player.personId)))
      .map((attributes) => ({
        personId: attributes.personId,
        teamId: "team-home",
        position: attributes.primaryPosition,
        attributes,
        availability: {
          personId: attributes.personId,
          fitness: 100,
          moraleModifier: 0,
          formModifier: 0,
        },
      })) as never;

    const finished = runMatchToCompletion(state);
    const subs = finished.events.filter((event) => event.type === "SUBSTITUTION");
    expect(subs.length).toBeGreaterThan(0);

    const sub = subs[0]!;
    const onState = finished.home.states.find((player) => player.personId === sub.primaryPersonId)!;
    const offState = finished.home.states.find(
      (player) => player.personId === sub.secondaryPersonId,
    )!;
    expect(offState.subbedOffMinute).toBe(sub.minute);
    expect(offState.minutesPlayed).toBe(sub.minute);
    expect(onState.subbedOnMinute).toBe(sub.minute);
    expect(onState.minutesPlayed).toBe(90 - sub.minute!);
  });
});

describe("match session persistence", () => {
  it("round-trips a live state through the session table", () => {
    const db = freshDb();
    const state = createMatchState(input("session-seed"));
    for (let step = 0; step < 30; step += 1) stepMatch(state);

    const sessions = new MatchSessionRepository(db);
    sessions.upsertSession({
      id: "session-1" as never,
      fixtureId: state.fixtureId,
      matchId: state.matchId,
      status: "IN_PROGRESS",
      period: state.period,
      minute: state.minute,
      stoppageTime: state.stoppageTime,
      homeGoals: state.homeGoals,
      awayGoals: state.awayGoals,
      seed: state.seed,
      rngState: state.rngState,
      stateJson: serializeMatchState(state),
      startedAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:10:00.000Z",
    });

    const loaded = sessions.sessionForFixture(state.fixtureId);
    expect(loaded).toBeDefined();
    expect(loaded?.minute).toBe(state.minute);
    expect(loaded?.rngState).toBe(state.rngState);

    const revived = deserializeMatchState(loaded!.stateJson);
    expect(fingerprint(runMatchToCompletion(revived))).toEqual(
      fingerprint(runMatchToCompletion(createMatchState(input("session-seed")))),
    );
    expect(sessions.activeSessions()).toHaveLength(1);
  });

  it("survives closing and reopening the database mid-match", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-match-reopen-"));
    const path = join(dir, "resume.sqlite");
    const expected = fingerprint(runMatchToCompletion(createMatchState(input("resume-seed"))));

    const first = openGameDatabase(path);
    migrateDatabase(first);
    seedMinimalWorld(first);
    const state = createMatchState(input("resume-seed"));
    for (let step = 0; step < 55; step += 1) stepMatch(state);
    new MatchSessionRepository(first).upsertSession({
      id: "resume-session" as never,
      fixtureId: state.fixtureId,
      matchId: state.matchId,
      status: "IN_PROGRESS",
      period: state.period,
      minute: state.minute,
      stoppageTime: state.stoppageTime,
      homeGoals: state.homeGoals,
      awayGoals: state.awayGoals,
      seed: state.seed,
      rngState: state.rngState,
      stateJson: serializeMatchState(state),
      startedAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:20:00.000Z",
    });
    first.close();

    const second = openGameDatabase(path);
    migrateDatabase(second);
    const record = new MatchSessionRepository(second).sessionForFixture(state.fixtureId)!;
    const finished = runMatchToCompletion(deserializeMatchState(record.stateJson));
    second.close();
    rmSync(dir, { recursive: true, force: true });

    expect(fingerprint(finished)).toEqual(expected);
  });
});

describe("extra time, penalties and aggregate context", () => {
  const knockoutInput = (seed: string) => ({ ...input(seed), requiresWinner: true });

  it("never touches extra time or penalties for a normal league match", () => {
    for (const seed of SEEDS) {
      const result = simulateMatch(input(seed));
      expect(result.match.wentToExtraTime).toBeFalsy();
      expect(result.match.shootoutHomeGoals).toBeUndefined();
      expect(result.events.some((event) => event.type.startsWith("EXTRA_TIME"))).toBe(false);
      expect(result.events.some((event) => event.type.startsWith("PENALTY_SHOOTOUT"))).toBe(false);
    }
  });

  it("always produces a winner for a knockout tie, going to ET and penalties as needed", () => {
    for (let index = 0; index < 60; index += 1) {
      const seed = `knockout-seed-${index}`;
      const result = simulateMatch(knockoutInput(seed));
      expect(result.match.winnerTeamId).toBeDefined();
    }
  });

  it("finds a knockout match that goes all the way to penalties and keeps shootout goals separate", () => {
    let found: ReturnType<typeof simulateMatch> | undefined;
    for (let index = 0; index < 500 && !found; index += 1) {
      const result = simulateMatch(knockoutInput(`shootout-seed-${index}`));
      if (result.match.shootoutHomeGoals !== undefined) found = result;
    }
    expect(found).toBeDefined();
    const result = found!;
    expect(result.match.wentToExtraTime).toBe(true);
    expect(result.match.homeGoals).toBe(result.match.awayGoals);
    expect(result.match.shootoutHomeGoals).not.toBe(result.match.shootoutAwayGoals);
    const expectedWinner =
      result.match.shootoutHomeGoals! > result.match.shootoutAwayGoals!
        ? fixture.homeTeamId
        : fixture.awayTeamId;
    expect(result.match.winnerTeamId).toBe(expectedWinner);

    // Shootout goals never leak into normal match/player stats.
    const shootoutKickEvents = result.events.filter(
      (event) => event.type === "PENALTY_SHOOTOUT_KICK",
    );
    expect(shootoutKickEvents.length).toBeGreaterThan(0);
    const scoredShootoutGoals = shootoutKickEvents.filter((event) => event.data?.scored).length;
    const totalPlayerGoals = result.playerStates.reduce((total, player) => total + player.goals, 0);
    expect(totalPlayerGoals).toBe(result.match.homeGoals! + result.match.awayGoals!);
    expect(scoredShootoutGoals).not.toBe(0);
    expect(result.events.some((event) => event.type === "PENALTY_SHOOTOUT_COMPLETE")).toBe(true);
  });

  it("decides a knockout tie by extra-time goals without needing penalties, when ET breaks the deadlock", () => {
    let found: ReturnType<typeof simulateMatch> | undefined;
    for (let index = 0; index < 500 && !found; index += 1) {
      const result = simulateMatch(knockoutInput(`et-seed-${index}`));
      if (result.match.wentToExtraTime && result.match.shootoutHomeGoals === undefined) {
        found = result;
      }
    }
    expect(found).toBeDefined();
    expect(found!.match.homeGoals).not.toBe(found!.match.awayGoals);
    expect(found!.match.winnerTeamId).toBeDefined();
  });

  it("is deterministic across Quick Sim / step-wise Key Events / minute-by-minute Text Live for a knockout tie", () => {
    const seed = "knockout-determinism-seed";
    const quickSim = fingerprint(runMatchToCompletion(createMatchState(knockoutInput(seed))));

    const stepped = createMatchState(knockoutInput(seed));
    let guard = 0;
    while (stepped.period !== "FULL_TIME" && guard < 260) {
      stepMatch(stepped);
      guard += 1;
    }
    expect(fingerprint(stepped)).toEqual(quickSim);

    // Interrupt and resume mid extra-time/shootout.
    const partial = createMatchState(knockoutInput(seed));
    for (let step = 0; step < 130; step += 1) stepMatch(partial);
    const resumed = runMatchToCompletion(deserializeMatchState(serializeMatchState(partial)));
    expect(fingerprint(resumed)).toEqual(quickSim);
  });

  it("computes aggregate context and folds first-leg goals into the winner decision", () => {
    const secondLeg = {
      ...knockoutInput("aggregate-seed"),
      aggregateFirstLeg: { homeGoals: 0, awayGoals: 3 },
    };
    const result = simulateMatch(secondLeg);
    // Away led 3-0 from the first leg; even a home win in this leg alone
    // should not overturn the tie unless it swings the aggregate.
    const aggregateHome = result.match.homeGoals! + 0;
    const aggregateAway = result.match.awayGoals! + 3;
    if (aggregateHome !== aggregateAway) {
      const expectedWinner =
        aggregateHome > aggregateAway ? fixture.homeTeamId : fixture.awayTeamId;
      expect(result.match.winnerTeamId).toBe(expectedWinner);
    }
  });

  it("computes realistic, bounded stoppage time from in-half stoppages", () => {
    const result = simulateMatch(input("stoppage-seed"));
    const halfTime = result.events.find((event) => event.type === "HALF_TIME");
    const fullTime = result.events.find((event) => event.type === "FULL_TIME");
    for (const event of [halfTime, fullTime]) {
      if (event?.stoppageTime !== undefined) {
        expect(event.stoppageTime).toBeGreaterThanOrEqual(1);
        expect(event.stoppageTime).toBeLessThanOrEqual(7);
      }
    }
  });
});
