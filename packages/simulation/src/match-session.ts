import {
  CompetitionRepository,
  ManagerRepository,
  MatchSessionRepository,
  PlayerRepository,
  SaveRepository,
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
} from "@nepal-football-sim/shared-types";
import { postMatchdayEconomy } from "./club-economy.js";
import {
  createMatchState,
  orderedEvents,
  runMatchToCompletion,
  stepMatch,
  toMatchResult,
  type LiveMatchState,
  type SimulateMatchInput,
} from "./match-engine.js";
import { calculateStandings, summarizePlayerStats, summarizeTeamStats } from "./standings.js";

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
  const state = createMatchState(input);
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

export const deserializeMatchState = (json: string): LiveMatchState =>
  JSON.parse(json) as LiveMatchState;

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

  db.exec("BEGIN;");
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
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return { status: "FINALIZED", matchId: state.matchId, attendance: state.attendance };
};

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
