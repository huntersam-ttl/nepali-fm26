import {
  CompetitionRepository,
  ManagerRepository,
  MatchSessionRepository,
  PlayerRepository,
  SaveRepository,
  SupporterCultureRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type CompetitionRuleSet,
  type EntityId,
  type FixtureRecord,
  type MatchSessionRecord,
  type MatchViewMode,
  type PlayerMatchRatingRecord,
  type PlayerMatchState,
  type SaveMetadata,
  type SuspensionRecord,
  type TacticalSetup,
} from "@nepal-football-sim/shared-types";
import { postMatchdayEconomy } from "./club-economy.js";
import { settleFederationInjuryWelfare, settleMatchInjuryInsurance } from "./insurance.js";
import { requireFixtureOfficials } from "./referee-assignment.js";
import {
  applySubstitution,
  applyTacticalChange,
  createMatchState,
  matchEventImportance,
  orderedEvents,
  runMatchToCompletion,
  stepMatch,
  toMatchResult,
  type LiveMatchState,
  type MatchEventImportance,
  type RuntimeTeam,
  type SimulateMatchInput,
} from "./match-engine.js";
import { calculateStandings, summarizePlayerStats, summarizeTeamStats } from "./standings.js";
import {
  applyMatchSupporterOutcome,
  initializeSupporterCultureForSave,
} from "./supporter-culture.js";
import { recordFootballMatchHistory } from "./football-history.js";

export type MatchFinalizationContext = {
  fixture: FixtureRecord;
  competitionTeamIds: readonly EntityId[];
  ruleSet: CompetitionRuleSet;
  seed: string;
  save?: SaveMetadata;
  /** Extra inbox items the caller wants written inside the same transaction. */
  inboxItems?: Parameters<ManagerRepository["insertInboxItem"]>[0][];
};

export type FinalizationOutcome =
  | { status: "FINALIZED"; matchId: EntityId; attendance?: number }
  | { status: "ALREADY_FINALIZED"; matchId: EntityId; attendance?: number };

/** Raised when a fixture that already has a result is played again. */
export class MatchAlreadyPlayedError extends Error {
  readonly code = "MATCH_ALREADY_PLAYED" as const;
  constructor(readonly fixtureId: EntityId) {
    super(`Fixture ${fixtureId} has already been played.`);
  }
}

/** Matches for which a red card costs the player their next fixture. */
const RED_CARD_SUSPENSION_MATCHES = 1;

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export const startMatchSession = (
  db: GameDatabase,
  input: SimulateMatchInput,
  viewMode: MatchViewMode = "QUICK_SIM",
): LiveMatchState => {
  const existing = new MatchSessionRepository(db).sessionForFixture(input.fixture.id);
  if (existing?.status === "COMPLETED" || fixtureAlreadyPlayed(db, input.fixture.id)) {
    throw new MatchAlreadyPlayedError(input.fixture.id);
  }
  if (existing) {
    // An interrupted match is resumed rather than restarted, so a player cannot
    // reroll a result they did not like by leaving and coming back.
    return deserializeMatchState(existing.stateJson);
  }
  const assignment =
    input.refereeAssignment ?? requireFixtureOfficials(db, input.fixture, { seed: input.seed });
  const state = createMatchState({ ...input, refereeAssignment: assignment });
  saveMatchSession(db, state, viewMode);
  return state;
};

export const loadMatchSession = (
  db: GameDatabase,
  fixtureId: EntityId,
): { state: LiveMatchState; record: MatchSessionRecord } | undefined => {
  const record = new MatchSessionRepository(db).sessionForFixture(fixtureId);
  if (!record) return undefined;
  return { state: deserializeMatchState(record.stateJson), record };
};

/**
 * Writes a checkpoint. Callers decide when — the engine never persists on its
 * own, so a Text Live reveal does not cause a write per simulated minute.
 */
export const saveMatchSession = (
  db: GameDatabase,
  state: LiveMatchState,
  viewMode?: MatchViewMode,
): void => {
  const sessions = new MatchSessionRepository(db);
  const now = new Date().toISOString();
  const existing = sessions.sessionForFixture(state.fixtureId);
  sessions.upsertSession({
    id: existing?.id ?? createStableEntityId("match-session", state.fixtureId),
    fixtureId: state.fixtureId,
    matchId: state.matchId,
    status: state.period === "FULL_TIME" ? "IN_PROGRESS" : "IN_PROGRESS",
    period: state.period,
    minute: state.minute,
    stoppageTime: state.stoppageTime,
    homeGoals: state.homeGoals,
    awayGoals: state.awayGoals,
    seed: state.seed,
    rngState: state.rngState,
    stateJson: serializeMatchState(state),
    viewMode: viewMode ?? existing?.viewMode,
    startedAt: existing?.startedAt ?? now,
    updatedAt: now,
    completedAt: existing?.completedAt,
  });
};

export const serializeMatchState = (state: LiveMatchState): string => JSON.stringify(state);

export const deserializeMatchState = (json: string): LiveMatchState => {
  const state = JSON.parse(json) as Partial<LiveMatchState>;
  return {
    ...state,
    winnerResolution: state.winnerResolution ?? "EXTRA_TIME_THEN_PENALTIES",
    allowExtraTime: state.allowExtraTime ?? true,
    allowPenalties: state.allowPenalties ?? true,
  } as LiveMatchState;
};

/**
 * Advances a live match by a bounded number of minutes and checkpoints once at
 * the end, rather than once per minute.
 */
export const advanceMatchSession = (
  db: GameDatabase,
  state: LiveMatchState,
  minutes = 1,
): LiveMatchState => {
  for (let step = 0; step < minutes && state.period !== "FULL_TIME"; step += 1) {
    stepMatch(state);
  }
  saveMatchSession(db, state);
  return state;
};

/** Advances until the next event a Key Events viewer would stop on. */
export const advanceToNextEvent = (
  db: GameDatabase,
  state: LiveMatchState,
  predicate: (state: LiveMatchState, newEvents: number) => boolean,
): LiveMatchState => {
  const startCount = state.events.length;
  let guard = 0;
  while (state.period !== "FULL_TIME" && guard < 120) {
    stepMatch(state);
    guard += 1;
    if (state.events.length > startCount && predicate(state, state.events.length - startCount)) {
      break;
    }
  }
  saveMatchSession(db, state);
  return state;
};

// ---------------------------------------------------------------------------
// Finalization
// ---------------------------------------------------------------------------

/**
 * Commits a completed match to the world exactly once.
 *
 * Everything happens in one transaction, and every write is keyed so that a
 * repeat call is a no-op rather than a duplicate. A fixture already marked
 * played, or a session already marked completed, short-circuits.
 */
export const finalizeMatch = (
  db: GameDatabase,
  state: LiveMatchState,
  context: MatchFinalizationContext,
): FinalizationOutcome => {
  if (state.period !== "FULL_TIME") {
    throw new Error("Cannot finalize a match before full time.");
  }
  const requiresWinner = Boolean(
    context.ruleSet.matchesRequireWinner && (!context.fixture.tieId || context.fixture.leg === 2),
  );
  if (requiresWinner && !state.winnerTeamId) {
    throw new Error(`Winner-required fixture ${context.fixture.id} completed without a winner`);
  }
  const sessions = new MatchSessionRepository(db);
  const existingSession = sessions.sessionForFixture(state.fixtureId);
  if (existingSession?.status === "COMPLETED" || fixtureAlreadyPlayed(db, state.fixtureId)) {
    return {
      status: "ALREADY_FINALIZED",
      matchId: existingSession?.matchId ?? state.matchId,
      attendance: attendanceForMatch(db, existingSession?.matchId ?? state.matchId),
    };
  }

  const result = toMatchResult(state);
  const competition = new CompetitionRepository(db);
  const managers = new ManagerRepository(db);
  const players = new PlayerRepository(db);

  // A savepoint rather than BEGIN: finalization is called both standalone and
  // from inside an outer command transaction, and savepoints nest safely.
  db.exec("SAVEPOINT match_finalization;");
  try {
    // Attendance and gate money come from the existing economy model, which is
    // already idempotent through stable ledger ids.
    const economy = postMatchdayEconomy(
      db,
      context.fixture,
      result.match.playedDate ?? context.fixture.scheduledDate,
      context.seed,
    );
    state.attendance = economy?.attendance;

    const homeClubId = clubIdForTeam(db, context.fixture.homeTeamId);
    const awayClubId = clubIdForTeam(db, context.fixture.awayTeamId);
    if (homeClubId && awayClubId) {
      initializeSupporterCultureForSave({
        db,
        worldDate: result.match.playedDate ?? context.fixture.scheduledDate,
        seed: context.save?.randomSeed ?? context.seed,
      });
      const rivalry = new SupporterCultureRepository(db).rivalry(homeClubId, awayClubId);
      const homeGoals = result.match.homeGoals ?? 0;
      const awayGoals = result.match.awayGoals ?? 0;
      const resultDelta = homeGoals === awayGoals ? 0 : homeGoals > awayGoals ? 1 : -1;
      const rivalryEvent = rivalry
        ? {
            date: result.match.playedDate ?? context.fixture.scheduledDate,
            met: true,
            cupFinal: context.fixture.round >= 20,
          }
        : undefined;
      applyMatchSupporterOutcome({
        db,
        clubId: homeClubId,
        opponentClubId: awayClubId,
        date: result.match.playedDate ?? context.fixture.scheduledDate,
        performanceVsExpectation: resultDelta * 12 + (homeGoals - awayGoals) * 3,
        derbyResult: rivalry ? (resultDelta as -1 | 0 | 1) : undefined,
        rivalryEvent,
        attendance: economy?.attendance,
        capacity: economy?.capacity,
      });
      applyMatchSupporterOutcome({
        db,
        clubId: awayClubId,
        opponentClubId: homeClubId,
        date: result.match.playedDate ?? context.fixture.scheduledDate,
        performanceVsExpectation: -resultDelta * 12 + (awayGoals - homeGoals) * 3,
        derbyResult: rivalry ? (-resultDelta as -1 | 0 | 1) : undefined,
        rivalryEvent: rivalry
          ? { ...rivalryEvent!, date: result.match.playedDate ?? context.fixture.scheduledDate }
          : undefined,
      });
    }
    recordFootballMatchHistory(
      db,
      context.fixture,
      result,
      result.match.playedDate ?? context.fixture.scheduledDate,
    );

    competition.insertMatch(result.match, economy?.attendance);
    for (const event of orderedEvents(state)) {
      competition.insertMatchEvent(event);
    }

    const standings = calculateStandings({
      competitionSeasonId: context.fixture.competitionSeasonId!,
      teamIds: context.competitionTeamIds,
      ruleSet: context.ruleSet,
      results: [result],
    });
    for (const standing of standings) competition.upsertStanding(standing);
    for (const stat of summarizeTeamStats(context.fixture.competitionSeasonId!, standings)) {
      competition.upsertTeamSeasonStat(stat);
    }
    for (const stat of summarizePlayerStats(context.fixture.competitionSeasonId!, [result])) {
      competition.upsertPlayerSeasonStat(stat);
    }

    persistMatchRatings(db, state);
    persistPlayerOutcomes(db, players, state, context);

    for (const item of context.inboxItems ?? []) managers.insertInboxItem(item);
    competition.markFixturePlayed(state.fixtureId);

    sessions.upsertSession({
      id: existingSession?.id ?? createStableEntityId("match-session", state.fixtureId),
      fixtureId: state.fixtureId,
      matchId: state.matchId,
      status: "COMPLETED",
      period: "FULL_TIME",
      minute: state.minute,
      stoppageTime: state.stoppageTime,
      homeGoals: state.homeGoals,
      awayGoals: state.awayGoals,
      seed: state.seed,
      rngState: state.rngState,
      stateJson: serializeMatchState(state),
      viewMode: existingSession?.viewMode,
      startedAt: existingSession?.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    if (context.save) {
      new SaveRepository(db).upsert({
        ...context.save,
        worldDate: nextDay(context.fixture.scheduledDate),
        lastSavedAt: new Date().toISOString(),
      });
    }
    db.exec("RELEASE match_finalization;");
  } catch (error) {
    db.exec("ROLLBACK TO match_finalization;");
    db.exec("RELEASE match_finalization;");
    throw error;
  }

  return { status: "FINALIZED", matchId: state.matchId, attendance: state.attendance };
};

const clubIdForTeam = (db: GameDatabase, teamId: EntityId): EntityId | undefined =>
  (
    db.prepare("SELECT club_id AS clubId FROM teams WHERE id = ?").get(teamId) as
      { clubId?: EntityId } | undefined
  )?.clubId;

/** Convenience path: create, run to full time, finalize. Used by Quick Sim. */
export const simulateAndFinalizeMatch = (
  db: GameDatabase,
  input: SimulateMatchInput,
  context: MatchFinalizationContext,
): { state: LiveMatchState; outcome: FinalizationOutcome } => {
  const state = runMatchToCompletion(startMatchSession(db, input, "QUICK_SIM"));
  return { state, outcome: finalizeMatch(db, state, context) };
};

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const persistMatchRatings = (db: GameDatabase, state: LiveMatchState): void => {
  const sessions = new MatchSessionRepository(db);
  for (const player of [...state.home.states, ...state.away.states]) {
    sessions.upsertRating(toRatingRecord(state.matchId, player));
  }
};

/** Uses the rating the engine already calculated; no second algorithm. */
const toRatingRecord = (matchId: EntityId, player: PlayerMatchState): PlayerMatchRatingRecord => ({
  matchId,
  playerId: player.personId,
  teamId: player.teamId,
  position: player.position,
  role: player.role,
  started: player.subbedOnMinute === undefined,
  subbedOnMinute: player.subbedOnMinute,
  subbedOffMinute: player.subbedOffMinute,
  sentOffMinute: player.sentOffMinute,
  minutes: Math.max(0, Math.round(player.minutesPlayed)),
  rating: Math.round(player.rating * 100) / 100,
  goals: player.goals,
  assists: player.assists,
  shots: player.shots,
  shotsOnTarget: player.shotsOnTarget,
  keyPasses: player.keyPasses,
  passesAttempted: player.passesAttempted,
  passesCompleted: player.passesCompleted,
  tackles: player.tackles,
  interceptions: player.interceptions,
  saves: player.saves,
  yellowCards: player.yellowCards,
  redCard: player.redCard,
});

const persistPlayerOutcomes = (
  db: GameDatabase,
  players: PlayerRepository,
  state: LiveMatchState,
  context: MatchFinalizationContext,
): void => {
  const playedDate = context.fixture.scheduledDate;
  for (const player of [...state.home.states, ...state.away.states]) {
    players.upsertAvailabilityState({
      personId: player.personId,
      teamId: player.teamId,
      fitness: player.currentFitness,
      moraleModifier: player.moraleModifier,
      formModifier: player.formModifier,
      availability: player.injuryDuringMatch
        ? "INJURED"
        : player.redCard
          ? "SUSPENDED"
          : "AVAILABLE",
      updatedOn: playedDate,
    });
    if (player.injuryDuringMatch) {
      players.insertInjury(player.injuryDuringMatch);
      const clubId = (db.prepare("SELECT club_id AS clubId FROM teams WHERE id = ?").get(player.teamId) as { clubId?: EntityId } | undefined)?.clubId;
      if (clubId) {
        const insuranceClaim = settleMatchInjuryInsurance(db, { clubId, injury: player.injuryDuringMatch, date: player.injuryDuringMatch.dateOccurred });
        settleFederationInjuryWelfare(db, { clubId, injury: player.injuryDuringMatch, date: player.injuryDuringMatch.dateOccurred, insuranceClaim });
      }
    }
    if (player.redCard && context.fixture.competitionSeasonId) {
      // Dismissals feed the existing competition suspension model.
      const suspension: SuspensionRecord = {
        id: createStableEntityId("suspension", `${state.matchId}:${player.personId}`),
        personId: player.personId,
        competitionSeasonId: context.fixture.competitionSeasonId,
        reason: "redCard",
        matchesRemaining: RED_CARD_SUSPENSION_MATCHES,
      };
      players.insertSuspension(suspension);
    }
  }
};

const fixtureAlreadyPlayed = (db: GameDatabase, fixtureId: EntityId): boolean => {
  const row = db.prepare("SELECT status FROM fixtures WHERE id = ?").get(fixtureId) as
    { status?: string } | undefined;
  return row?.status === "played";
};

const attendanceForMatch = (db: GameDatabase, matchId: EntityId): number | undefined => {
  const row = db.prepare("SELECT attendance FROM matches WHERE id = ?").get(matchId) as
    { attendance?: number } | undefined;
  return row?.attendance ?? undefined;
};

const nextDay = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Interactive match control
// ---------------------------------------------------------------------------

export type MatchCommandCode =
  | "MATCH_NOT_ACTIVE"
  | "MATCH_ALREADY_COMPLETE"
  | "INVALID_SUBSTITUTION"
  | "SUBSTITUTION_LIMIT_REACHED"
  | "PLAYER_NOT_ON_PITCH"
  | "PLAYER_NOT_ON_BENCH"
  | "INVALID_TACTICAL_CHANGE"
  | "MATCH_NOT_AT_HALF_TIME";

/** Structured failure from an interactive match command. */
export class MatchCommandError extends Error {
  constructor(
    readonly code: MatchCommandCode,
    message: string,
  ) {
    super(message);
  }
}

export type AdvanceTarget =
  | { kind: "MINUTES"; minutes: number }
  | { kind: "NEXT_EVENT"; minImportance?: MatchEventImportance }
  | { kind: "HALF_TIME" }
  | { kind: "FULL_TIME" };

const IMPORTANCE_RANK: Record<MatchEventImportance, number> = {
  MINOR: 0,
  NOTABLE: 1,
  MAJOR: 2,
  CRITICAL: 3,
};

/**
 * Advances a live match toward a target, stopping early whenever the match
 * itself demands the manager's attention. Bounded: never loops past full time.
 */
export const advanceMatch = (
  db: GameDatabase,
  state: LiveMatchState,
  target: AdvanceTarget,
): LiveMatchState => {
  // Read through a helper: `stepMatch` mutates the period, so narrowing the
  // property directly would tell the compiler the loop can never advance.
  const period = (): LiveMatchState["period"] => state.period;
  if (period() === "FULL_TIME") {
    throw new MatchCommandError("MATCH_ALREADY_COMPLETE", "The match has already finished.");
  }
  // A pause must be acknowledged before play continues.
  state.pauseReason = undefined;

  const startSequence = state.eventSequence;
  const minImportance =
    target.kind === "NEXT_EVENT" ? (target.minImportance ?? "MAJOR") : undefined;
  let steps = 0;
  const maxSteps = target.kind === "MINUTES" ? Math.max(1, target.minutes) : 200;

  while (steps < maxSteps && period() !== "FULL_TIME") {
    if (target.kind === "HALF_TIME" && period() === "HALF_TIME") break;
    stepMatch(state);
    steps += 1;
    if (state.pauseReason) break;
    if (target.kind === "HALF_TIME" && period() === "HALF_TIME") break;
    if (minImportance && hasEventAtLeast(state, startSequence, minImportance)) break;
  }

  saveMatchSession(db, state);
  return state;
};

const hasEventAtLeast = (
  state: LiveMatchState,
  sinceSequence: number,
  minImportance: MatchEventImportance,
): boolean =>
  state.events.some(
    (event) =>
      Number(event.data?.sequence ?? -1) >= sinceSequence &&
      IMPORTANCE_RANK[matchEventImportance(event)] >= IMPORTANCE_RANK[minImportance],
  );

/**
 * Resumes play after a scheduled break — half time, or the equivalent break
 * between extra-time halves. Only valid while the match is actually paused
 * at one of those breaks.
 */
export const continueFromHalfTime = (db: GameDatabase, state: LiveMatchState): LiveMatchState => {
  if (state.period !== "HALF_TIME" && state.period !== "EXTRA_TIME_HALF_TIME") {
    throw new MatchCommandError("MATCH_NOT_AT_HALF_TIME", "The match is not at half time.");
  }
  stepMatch(state);
  saveMatchSession(db, state);
  return state;
};

export type SubstitutionRequest = {
  teamId: EntityId;
  playerOffId: EntityId;
  playerOnId: EntityId;
};

/**
 * Manager substitution. Every rule is checked here rather than trusted from the
 * UI, and each failure has its own code so the client can explain it.
 */
export const makeSubstitution = (
  db: GameDatabase,
  state: LiveMatchState,
  request: SubstitutionRequest,
): LiveMatchState => {
  if (state.period === "FULL_TIME") {
    throw new MatchCommandError("MATCH_ALREADY_COMPLETE", "The match has already finished.");
  }
  if (state.period === "NOT_STARTED") {
    throw new MatchCommandError("MATCH_NOT_ACTIVE", "The match has not kicked off yet.");
  }
  const team = teamForId(state, request.teamId);
  if (team.substitutionsUsed >= state.substitutionLimit) {
    throw new MatchCommandError(
      "SUBSTITUTION_LIMIT_REACHED",
      `Only ${state.substitutionLimit} substitutions are permitted.`,
    );
  }
  if (request.playerOffId === request.playerOnId) {
    throw new MatchCommandError("INVALID_SUBSTITUTION", "A player cannot replace themselves.");
  }

  const onPitch = team.selection.some((player) => player.personId === request.playerOffId);
  if (!onPitch) {
    throw new MatchCommandError(
      "PLAYER_NOT_ON_PITCH",
      "That player is not currently on the pitch.",
    );
  }
  const outgoing = team.states.find((player) => player.personId === request.playerOffId);
  if (outgoing?.redCard) {
    throw new MatchCommandError(
      "INVALID_SUBSTITUTION",
      "A dismissed player cannot be substituted; the team plays on a man short.",
    );
  }
  const incoming = team.benchPlayers.some((player) => player.personId === request.playerOnId);
  if (!incoming) {
    const alreadyUsed = team.usedSubstitutes.includes(request.playerOnId);
    throw new MatchCommandError(
      "PLAYER_NOT_ON_BENCH",
      alreadyUsed
        ? "That player has already come on."
        : "That player is not on the bench for this match.",
    );
  }

  applySubstitution(
    state,
    team,
    request.playerOffId,
    request.playerOnId,
    Math.max(state.minute, 1),
    { reason: "manager", decidedBy: "MANAGER" },
  );
  // A user decision is a meaningful checkpoint.
  saveMatchSession(db, state);
  return state;
};

export type LiveTacticsRequest = {
  teamId: EntityId;
  setup: TacticalSetup;
};

/** Manager tactical change. Takes effect from the next simulated minute. */
export const updateLiveTactics = (
  db: GameDatabase,
  state: LiveMatchState,
  request: LiveTacticsRequest,
): LiveMatchState => {
  if (state.period === "FULL_TIME") {
    throw new MatchCommandError("MATCH_ALREADY_COMPLETE", "The match has already finished.");
  }
  const team = teamForId(state, request.teamId);
  const assigned = request.setup.assignments.filter((assignment) => assignment.playerId).length;
  if (assigned === 0) {
    throw new MatchCommandError(
      "INVALID_TACTICAL_CHANGE",
      "A tactical setup must assign at least one player.",
    );
  }
  applyTacticalChange(state, team, request.setup, Math.max(state.minute, 1), "MANAGER");
  saveMatchSession(db, state);
  return state;
};

const teamForId = (state: LiveMatchState, teamId: EntityId): RuntimeTeam => {
  if (state.home.teamId === teamId) return state.home;
  if (state.away.teamId === teamId) return state.away;
  throw new MatchCommandError("MATCH_NOT_ACTIVE", "That team is not playing in this match.");
};

/** Finishes a partially played match from its current state, never from kickoff. */
export const quickSimFromCurrentState = (
  db: GameDatabase,
  state: LiveMatchState,
  context: MatchFinalizationContext,
): { state: LiveMatchState; outcome: FinalizationOutcome } => {
  runMatchToCompletion(state);
  return { state, outcome: finalizeMatch(db, state, context) };
};
