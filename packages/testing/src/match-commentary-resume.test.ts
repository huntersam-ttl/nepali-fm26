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
  advanceMatch,
  applyTacticalChange,
  commentaryFor,
  commentaryTimeline,
  createMatchState,
  deserializeMatchState,
  makeSubstitution,
  runMatchToCompletion,
  serializeMatchState,
  simulateMatch,
  startMatchSession,
  stepMatch,
  updateLiveTactics,
  type LiveMatchState,
} from "@nepal-football-sim/simulation";
import type {
  FixtureRecord,
  PlayerAttributeSet,
  TacticalSetup,
} from "@nepal-football-sim/shared-types";

// --- deterministic synthetic squads -----------------------------------------

const technical = (b: number) => ({
  firstTouch: b,
  passing: b,
  crossing: b - 1,
  dribbling: b,
  finishing: b - 1,
  heading: b,
  tackling: b,
  technique: b,
  longShots: b - 2,
  setPieces: b,
});
const mental = (b: number) => ({
  decisions: b,
  vision: b,
  composure: b,
  positioning: b,
  anticipation: b,
  workRate: b,
  teamwork: b,
  leadership: b - 1,
  aggression: b,
  determination: b,
  professionalism: b,
});
const physical = (b: number) => ({
  pace: b,
  acceleration: b,
  strength: b,
  stamina: b,
  agility: b,
  balance: b,
  jumping: b,
  naturalFitness: b,
});
const goalkeeping = (b: number) => ({
  handling: b,
  reflexes: b,
  oneOnOnes: b,
  aerialReach: b,
  kicking: b,
  distribution: b,
  commandOfArea: b,
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
  id: "fixture-live",
  competitionSeasonId: "season-live",
  homeTeamId: "team-home",
  awayTeamId: "team-away",
  scheduledDate: "2026-08-08",
  status: "scheduled",
  round: 1,
} as unknown as FixtureRecord;

/** Minimal setup with a real bench so substitutions are possible. */
const setupFor = (teamId: string): TacticalSetup =>
  ({
    id: `${teamId}-setup`,
    teamId,
    name: "4-3-3",
    formation: {
      id: "formation-4-3-3",
      name: "4-3-3",
      kind: "PRESET",
      slots: POSITIONS.slice(0, 11).map((position, index) => ({
        id: `slot-${index}`,
        label: position,
        position,
        x: 50,
        y: index * 8,
        zone:
          index === 0 ? "goalkeeper" : index < 5 ? "defense" : index < 8 ? "midfield" : "forward",
      })),
    },
    style: "BALANCED",
    instructions: {
      mentality: "BALANCED",
      inPossession: {
        tempo: 50,
        passingLength: 50,
        width: 50,
        buildUpRisk: 50,
        playFromBack: false,
        workBallIntoBox: false,
        earlyCrosses: false,
        focusMiddle: false,
        focusLeft: false,
        focusRight: false,
        overlapLeft: false,
        overlapRight: false,
        underlapLeft: false,
        underlapRight: false,
      },
      transition: {
        counterPress: false,
        regroup: false,
        counter: false,
        holdShape: true,
        goalkeeperDistributionStyle: "MIXED",
      },
      outOfPossession: {
        pressingIntensity: 50,
        defensiveLine: 50,
        engagementLine: 50,
        tacklingIntensity: 50,
        pressGoalkeeper: false,
        stopShortDistribution: false,
        forceInside: false,
        forceOutside: false,
      },
    },
    familiarity: { formation: 70, style: 70, roles: 70, instructions: 70 },
    assignments: POSITIONS.slice(0, 11).map((_, index) => ({
      slotId: `slot-${index}`,
      playerId: `${teamId}-p${index}`,
      roleId: index === 0 ? "GOALKEEPER" : "CENTRAL_MIDFIELDER",
    })),
    bench: [11, 12, 13, 14, 15, 16, 17].map((index) => `${teamId}-p${index}`),
    setPieces: {},
    createdOn: "2026-08-01",
    updatedOn: "2026-08-01",
  }) as unknown as TacticalSetup;

const input = (seed: string) => ({
  fixture,
  homePlayers: squad("team-home", 12),
  awayPlayers: squad("team-away", 11),
  homeTacticalSetup: setupFor("team-home"),
  awayTacticalSetup: setupFor("team-away"),
  seed,
});

const fingerprint = (state: LiveMatchState) => ({
  score: `${state.homeGoals}-${state.awayGoals}`,
  events: state.events.map(
    (event) => `${event.minute}|${event.type}|${event.teamId}|${event.primaryPersonId ?? ""}`,
  ),
  ratings: [...state.home.states, ...state.away.states]
    .map((player) => `${player.personId}|${player.minutesPlayed}|${player.rating.toFixed(4)}`)
    .sort(),
});

const dirs: string[] = [];
const freshDb = (): { db: GameDatabase; path: string } => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-live-"));
  dirs.push(dir);
  const path = join(dir, "live.sqlite");
  const db = openGameDatabase(path);
  migrateDatabase(db);
  const world = new WorldRepository(db);
  world.insertCountry({ id: "c1" as never, name: "Testland", isoCode: "TL" } as never);
  world.insertClub({
    id: "club1" as never,
    name: "Test Club",
    countryId: "c1" as never,
    ownershipType: "COMMUNITY",
  } as never);
  world.insertCompetition({ id: "comp1" as never, name: "Test Comp", scope: "domestic" } as never);
  world.insertCompetitionSeason({
    id: "season-live" as never,
    competitionId: "comp1" as never,
    name: "Test Season",
    startDate: "2026-08-01",
    endDate: "2027-05-31",
  } as never);
  for (const teamId of ["team-home", "team-away"]) {
    world.insertTeam({
      id: teamId as never,
      clubId: "club1" as never,
      name: teamId,
      level: "senior",
      gender: "men",
    } as never);
  }
  new CompetitionRepository(db).insertFixture(fixture);
  return { db, path };
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe("match commentary", () => {
  it("renders the same text for the same event every time", () => {
    const result = simulateMatch(input("commentary-seed"));
    const context = {
      homeTeamId: "team-home",
      homeTeamName: "Home FC",
      awayTeamName: "Away FC",
      playerName: (id: string) => `Player ${id.slice(-2)}`,
      homeGoals: 0,
      awayGoals: 0,
    };
    const first = result.events.map((event) => commentaryFor(event, context).text);
    const second = result.events.map((event) => commentaryFor(event, context).text);
    expect(first).toEqual(second);
    for (const text of first) expect(text.length).toBeGreaterThan(3);
  });

  it("varies wording between events rather than repeating one line", () => {
    const result = simulateMatch(input("variety-seed"));
    const lines = commentaryTimeline(result.events, {
      homeTeamId: "team-home",
      homeTeamName: "Home FC",
      awayTeamName: "Away FC",
      playerName: (id) => `Player ${id.slice(-2)}`,
    });
    const shots = lines.filter((line) => line.type === "SHOT").map((line) => line.text);
    if (shots.length > 4) {
      // Deterministic templates, but not the identical sentence every time.
      expect(new Set(shots).size).toBeGreaterThan(1);
    }
    const kickOff = lines.find((line) => line.type === "KICK_OFF");
    expect(kickOff?.text).toMatch(/under way|kick-off/i);
  });

  it("does not consume match randomness", () => {
    // Generating commentary between two runs must not alter the football.
    const plain = simulateMatch(input("rng-seed"));
    const withCommentary = simulateMatch(input("rng-seed"));
    commentaryTimeline(withCommentary.events, {
      homeTeamId: "team-home",
      homeTeamName: "Home FC",
      awayTeamName: "Away FC",
      playerName: (id) => id,
    });
    const after = simulateMatch(input("rng-seed"));
    expect(after.match.homeGoals).toBe(plain.match.homeGoals);
    expect(after.events.length).toBe(plain.events.length);
  });

  it("reports the score as it stood at each goal", () => {
    const result = simulateMatch(input("score-seed"));
    const lines = commentaryTimeline(result.events, {
      homeTeamId: "team-home",
      homeTeamName: "Home FC",
      awayTeamName: "Away FC",
      playerName: (id) => `Player ${id.slice(-2)}`,
    });
    const goals = lines.filter((line) => line.type === "GOAL");
    if (goals.length >= 2) {
      // The second goal cannot read with the same score as the first.
      expect(goals[0]!.text).not.toBe(goals[1]!.text);
    }
  });
});

describe("interactive determinism", () => {
  it("diverges only after a tactical decision, never before", () => {
    const { db } = freshDb();
    const control = runMatchToCompletion(createMatchState(input("tactics-seed")));

    const changed = startMatchSession(db, input("tactics-seed"), "TEXT_LIVE");
    for (let step = 0; step < 30; step += 1) stepMatch(changed);
    const beforeDecision = changed.events.map(
      (event) => `${event.minute}|${event.type}|${event.primaryPersonId ?? ""}`,
    );
    // Everything up to the decision matches the untouched run.
    expect(
      control.events
        .slice(0, beforeDecision.length)
        .map((event) => `${event.minute}|${event.type}|${event.primaryPersonId ?? ""}`),
    ).toEqual(beforeDecision);

    updateLiveTactics(db, changed, {
      teamId: "team-home" as never,
      setup: {
        ...setupFor("team-home"),
        style: "HIGH_PRESS",
        instructions: {
          ...setupFor("team-home").instructions,
          mentality: "ATTACKING",
          outOfPossession: {
            ...setupFor("team-home").instructions.outOfPossession,
            pressingIntensity: 85,
          },
        },
      } as never,
    });
    runMatchToCompletion(changed);

    // The tactical change is recorded and the team is playing differently.
    expect(changed.events.some((event) => event.type === "TACTICAL_CHANGE")).toBe(true);
    expect(changed.home.setup?.style).toBe("HIGH_PRESS");
    expect(changed.home.tactical.chanceCreation).not.toBe(control.home.tactical.chanceCreation);
    db.close();
  });

  it("resumes to the identical result after a substitution and a reopen", () => {
    const { db, path } = freshDb();

    // Play, substitute, checkpoint, close.
    const state = startMatchSession(db, input("resume-decision"), "TEXT_LIVE");
    advanceMatch(db, state, { kind: "MINUTES", minutes: 30 });
    const off = state.home.selection.find((player) => player.position !== "GK")!.personId;
    const on = state.home.benchPlayers[0]!.personId;
    makeSubstitution(db, state, { teamId: "team-home" as never, playerOffId: off, playerOnId: on });
    const checkpoint = serializeMatchState(state);
    // Uninterrupted control: same decisions, no reopen.
    const control = runMatchToCompletion(deserializeMatchState(checkpoint));
    db.close();

    const reopened = openGameDatabase(path);
    migrateDatabase(reopened);
    const record = new MatchSessionRepository(reopened).sessionForFixture(fixture.id)!;
    const resumed = runMatchToCompletion(deserializeMatchState(record.stateJson));
    reopened.close();

    expect(fingerprint(resumed)).toEqual(fingerprint(control));
    // The substitution survived the round trip.
    expect(resumed.events.some((event) => event.type === "SUBSTITUTION")).toBe(true);
    expect(resumed.home.selection.some((player) => player.personId === on)).toBe(true);
    expect(resumed.home.selection.some((player) => player.personId === off)).toBe(false);
  });

  it("applies half-time changes to the second half only", () => {
    const { db } = freshDb();
    const state = startMatchSession(db, input("half-time-seed"), "TEXT_LIVE");
    advanceMatch(db, state, { kind: "HALF_TIME" });

    expect(state.period).toBe("HALF_TIME");
    const firstHalfEvents = state.events.length;

    const off = state.home.selection.find((player) => player.position !== "GK")!.personId;
    const on = state.home.benchPlayers[0]!.personId;
    makeSubstitution(db, state, { teamId: "team-home" as never, playerOffId: off, playerOnId: on });
    applyTacticalChange(
      state,
      state.home,
      { ...setupFor("team-home"), style: "LOW_BLOCK" } as never,
      45,
      "MANAGER",
    );

    runMatchToCompletion(state);
    expect(state.period).toBe("FULL_TIME");
    expect(state.home.setup?.style).toBe("LOW_BLOCK");

    // The change is stamped at half time, not applied retroactively.
    const change = state.events.find((event) => event.type === "TACTICAL_CHANGE")!;
    expect(change.minute).toBe(45);
    const sub = state.events.find((event) => event.type === "SUBSTITUTION")!;
    expect(sub.minute).toBeGreaterThanOrEqual(45);
    expect(state.events.length).toBeGreaterThan(firstHalfEvents);
    db.close();
  });

  it("makes deterministic AI substitutions", () => {
    const first = runMatchToCompletion(createMatchState(input("ai-sub-seed")));
    const second = runMatchToCompletion(createMatchState(input("ai-sub-seed")));

    const subsFor = (state: LiveMatchState) =>
      state.events
        .filter((event) => event.type === "SUBSTITUTION")
        .map((event) => `${event.minute}|${event.primaryPersonId}|${event.secondaryPersonId}`);

    expect(subsFor(first)).toEqual(subsFor(second));
    expect(subsFor(first).length).toBeGreaterThan(0);

    // AI substitutions are attributed and reasoned, not anonymous.
    const aiSub = first.events.find((event) => event.type === "SUBSTITUTION")!;
    expect(aiSub.data?.decidedBy).toBe("AI");
    expect(["fitness", "performance", "injury", "discipline"]).toContain(
      String(aiSub.data?.reason),
    );
    // Nobody comes on twice.
    const onIds = first.events
      .filter((event) => event.type === "SUBSTITUTION")
      .map((event) => String(event.primaryPersonId));
    expect(new Set(onIds).size).toBe(onIds.length);
  });

  it("reacts tactically to the game state without consuming randomness", () => {
    const state = runMatchToCompletion(createMatchState(input("ai-tactics-seed")));
    const aiChanges = state.events.filter(
      (event) => event.type === "TACTICAL_CHANGE" && event.data?.decidedBy === "AI",
    );
    // Reactions only fire from the hour mark onwards.
    for (const change of aiChanges) {
      expect(change.minute).toBeGreaterThanOrEqual(60);
      expect(change.data?.mentality).toBeTruthy();
    }
    // Determinism: identical inputs give identical reactions.
    const repeat = runMatchToCompletion(createMatchState(input("ai-tactics-seed")));
    expect(
      repeat.events.filter((event) => event.type === "TACTICAL_CHANGE").map((e) => e.minute),
    ).toEqual(aiChanges.map((event) => event.minute));
  });
});
