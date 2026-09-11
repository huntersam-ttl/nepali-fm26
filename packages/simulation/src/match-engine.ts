import {
  createStableEntityId,
  type EntityId,
  type FixtureOfficialAssignment,
  type FixtureRecord,
  type InjuryRecord,
  type MatchEvent,
  type MatchResult,
  type PlayerAttributeSet,
  type PlayerMatchState,
  type TacticalSetup,
  type TeamMatchStats,
  type WinnerResolution,
} from "@nepal-football-sim/shared-types";
import { SeededRandom } from "./rng.js";
import { calculateTeamStrength, type TeamStrength } from "./strength.js";
import {
  createInitialPlayerState,
  selectTeam,
  selectTeamFromTacticalSetup,
  type SelectedPlayer,
} from "./team-selection.js";
import {
  NEUTRAL_PLAYER_BEHAVIOR,
  calculateTacticalModifiers,
  derivePlayerTacticalBehavior,
  dutyIsLegalForRole,
  type TacticalMatchModifiers,
} from "./tactics.js";
import type {
  PlayerDuty,
  PlayerTacticalBehavior,
  TacticalAssignment,
} from "@nepal-football-sim/shared-types";

export type SimulateMatchInput = {
  fixture: FixtureRecord;
  refereeAssignment?: FixtureOfficialAssignment;
  homePlayers: readonly PlayerAttributeSet[];
  awayPlayers: readonly PlayerAttributeSet[];
  seed: string;
  environment?: Partial<MatchEnvironment>;
  homeTacticalSetup?: TacticalSetup;
  awayTacticalSetup?: TacticalSetup;
  /** Competition substitution allowance. Defaults to the engine's original 3. */
  substitutionLimit?: number;
  /** Knockout ties that cannot end level: drawn regulation goes to ET, then penalties. */
  requiresWinner?: boolean;
  winnerResolution?: WinnerResolution;
  allowExtraTime?: boolean;
  allowPenalties?: boolean;
  /** First-leg score of a two-leg tie, in this match's home/away frame. */
  aggregateFirstLeg?: { homeGoals: number; awayGoals: number };
};

export type MatchEnvironment = {
  matchTempo: number;
  pitchQuality: number;
  refereeStrictness: number;
  weatherImpact: number;
  altitudeImpact: number;
  heatImpact: number;
  competitionPhysicality: number;
  homeAdvantage: number;
};

export const DEFAULT_MATCH_ENVIRONMENT: MatchEnvironment = {
  matchTempo: 1,
  pitchQuality: 1,
  refereeStrictness: 1,
  weatherImpact: 0,
  altitudeImpact: 0,
  heatImpact: 0,
  competitionPhysicality: 1,
  homeAdvantage: 1,
};

export type RuntimeTeam = {
  teamId: EntityId;
  selection: SelectedPlayer[];
  strength: TeamStrength;
  tactical: TacticalMatchModifiers;
  stats: TeamMatchStats;
  states: PlayerMatchState[];
  substitutionsUsed: number;
  /** Minutes in which this side was the attacking team, for live possession. */
  controlTicks: number;
  /** Bounded match-state confidence/pressure signal, persisted in session state. */
  momentum: number;
  /** Person ids named on the bench, in order. */
  benchIds: EntityId[];
  /** Attribute sets for bench players, so a substitute can actually come on. */
  benchPlayers: SelectedPlayer[];
  /** Current tactical setup, kept so a mid-match change can be re-applied. */
  setup?: TacticalSetup;
  /** Person ids that have already been used as a substitute. */
  usedSubstitutes: EntityId[];
};

export type MatchPeriod =
  | "NOT_STARTED"
  | "FIRST_HALF"
  | "HALF_TIME"
  | "SECOND_HALF"
  | "EXTRA_TIME_FIRST_HALF"
  | "EXTRA_TIME_HALF_TIME"
  | "EXTRA_TIME_SECOND_HALF"
  | "PENALTY_SHOOTOUT"
  | "FULL_TIME";

/**
 * Everything needed to resume a match exactly where it stopped.
 *
 * This is the single source of match truth: Quick Sim, Key Events and Text Live
 * all drive the same state through the same `stepMatch`. Only the RNG word and
 * the mutable runtime teams are carried — nothing derived is stored.
 */
export type LiveMatchState = {
  matchId: EntityId;
  fixtureId: EntityId;
  refereeAssignment?: FixtureOfficialAssignment;
  seed: string;
  /** LCG word. Restoring this reproduces the exact future of the match. */
  rngState: number;
  minute: number;
  stoppageTime: number;
  period: MatchPeriod;
  homeTeamId: EntityId;
  awayTeamId: EntityId;
  homeGoals: number;
  awayGoals: number;
  home: RuntimeTeam;
  away: RuntimeTeam;
  events: MatchEvent[];
  eventSequence: number;
  environment: MatchEnvironment;
  scheduledDate: string;
  substitutionLimit: number;
  attendance?: number;
  /** Why an interactive match should stop and wait for the manager. */
  pauseReason?: MatchPauseReason;
  /** Knockout ties that cannot end level. Unset/false for league matches. */
  requiresWinner?: boolean;
  /** First-leg score of a two-leg tie, in this match's home/away frame. */
  aggregateFirstLeg?: { homeGoals: number; awayGoals: number };
  /** True once extra time has started. */
  extraTime?: boolean;
  /** Penalty shootout goals, tracked separately: these never count as match goals/stats. */
  shootoutHomeGoals?: number;
  shootoutAwayGoals?: number;
  shootoutKicks?: PenaltyKick[];
  /** The side that won the tie, once decided by regulation, ET, aggregate or shootout. */
  winnerTeamId?: EntityId;
  winnerResolution: WinnerResolution;
  allowExtraTime: boolean;
  allowPenalties: boolean;
};

export type PenaltyKick = {
  teamId: EntityId;
  personId: EntityId;
  scored: boolean;
  round: number;
};

/** Reasons an interactive match pauses. Minor events never pause. */
export type MatchPauseReason =
  | "HALF_TIME"
  | "INJURY_DECISION"
  | "RED_CARD"
  | "FULL_TIME"
  | "EXTRA_TIME_START"
  | "EXTRA_TIME_HALF_TIME"
  | "PENALTY_SHOOTOUT";

const REGULATION_MINUTES = 90;
const HALF_TIME_MINUTE = 45;
const EXTRA_TIME_HALF_MINUTE = 105;
const EXTRA_TIME_FULL_MINUTES = 120;

export const createMatchState = (input: SimulateMatchInput): LiveMatchState => {
  const environment = { ...DEFAULT_MATCH_ENVIRONMENT, ...input.environment };
  if (input.refereeAssignment?.refereeQuality !== undefined) {
    environment.refereeStrictness = Math.max(
      0.85,
      Math.min(1.15, 0.85 + input.refereeAssignment.refereeQuality / 300),
    );
  }
  const matchId = createStableEntityId("match", `${input.fixture.id}:${input.seed}`);
  const homeSelection = input.homeTacticalSetup
    ? selectTeamFromTacticalSetup({
        teamId: input.fixture.homeTeamId,
        players: input.homePlayers,
        setup: input.homeTacticalSetup,
      })
    : selectTeam({
        teamId: input.fixture.homeTeamId,
        players: input.homePlayers,
      });
  const awaySelection = input.awayTacticalSetup
    ? selectTeamFromTacticalSetup({
        teamId: input.fixture.awayTeamId,
        players: input.awayPlayers,
        setup: input.awayTacticalSetup,
      })
    : selectTeam({
        teamId: input.fixture.awayTeamId,
        players: input.awayPlayers,
      });
  const state: LiveMatchState = {
    matchId,
    fixtureId: input.fixture.id,
    refereeAssignment: input.refereeAssignment,
    seed: input.seed,
    rngState: new SeededRandom(input.seed).snapshot(),
    minute: 0,
    stoppageTime: 0,
    period: "NOT_STARTED",
    homeTeamId: input.fixture.homeTeamId,
    awayTeamId: input.fixture.awayTeamId,
    homeGoals: 0,
    awayGoals: 0,
    home: createRuntimeTeam(
      input.fixture.homeTeamId,
      homeSelection,
      true,
      environment,
      input.homeTacticalSetup,
    ),
    away: createRuntimeTeam(
      input.fixture.awayTeamId,
      awaySelection,
      false,
      environment,
      input.awayTacticalSetup,
    ),
    events: [],
    eventSequence: 0,
    environment,
    scheduledDate: input.fixture.scheduledDate,
    substitutionLimit: input.substitutionLimit ?? 3,
    requiresWinner: input.requiresWinner,
    winnerResolution: input.winnerResolution ?? "EXTRA_TIME_THEN_PENALTIES",
    allowExtraTime: input.allowExtraTime ?? input.winnerResolution !== "DIRECT_PENALTIES",
    allowPenalties: input.allowPenalties ?? true,
    aggregateFirstLeg: input.aggregateFirstLeg,
  };
  // Bench membership drives substitutions; it is not part of the pitch selection.
  state.home.benchIds = [...(input.homeTacticalSetup?.bench ?? [])];
  state.away.benchIds = [...(input.awayTacticalSetup?.bench ?? [])];
  state.home.benchPlayers = benchPlayers(input.homePlayers, state.home.benchIds, homeSelection);
  state.away.benchPlayers = benchPlayers(input.awayPlayers, state.away.benchIds, awaySelection);
  return state;
};

/**
 * Advances the match by one bounded unit of work: a period transition or a
 * single minute. Returns the same state object, mutated, so callers can loop
 * cheaply; persistence is the caller's decision, not the engine's.
 */
export const stepMatch = (state: LiveMatchState): LiveMatchState => {
  if (state.period === "FULL_TIME") {
    return state;
  }
  const rng = SeededRandom.restore(state.rngState);

  if (state.period === "NOT_STARTED") {
    state.period = "FIRST_HALF";
    pushEvent(state, 0, "KICK_OFF", state.homeTeamId);
    state.rngState = rng.snapshot();
    return state;
  }

  if (state.period === "HALF_TIME") {
    state.period = "SECOND_HALF";
    state.pauseReason = undefined;
    pushEvent(state, HALF_TIME_MINUTE + 1, "SECOND_HALF", state.awayTeamId);
    state.rngState = rng.snapshot();
    return state;
  }

  if (state.period === "EXTRA_TIME_HALF_TIME") {
    state.period = "EXTRA_TIME_SECOND_HALF";
    state.pauseReason = undefined;
    pushEvent(state, EXTRA_TIME_HALF_MINUTE + 1, "EXTRA_TIME_SECOND_HALF", state.awayTeamId);
    state.rngState = rng.snapshot();
    return state;
  }

  if (state.period === "PENALTY_SHOOTOUT") {
    resolveShootout(state, rng);
    state.rngState = rng.snapshot();
    return state;
  }

  simulateMinute(state, rng, state.minute + 1);
  state.minute += 1;
  state.rngState = rng.snapshot();

  if (state.period === "FIRST_HALF" && state.minute === HALF_TIME_MINUTE) {
    state.stoppageTime = computeStoppageTime(state, 0, HALF_TIME_MINUTE);
    state.period = "HALF_TIME";
    state.pauseReason = "HALF_TIME";
    pushEvent(state, HALF_TIME_MINUTE, "HALF_TIME", state.homeTeamId);
    state.stoppageTime = 0;
    return state;
  }

  if (state.period === "SECOND_HALF" && state.minute >= REGULATION_MINUTES) {
    state.stoppageTime = computeStoppageTime(state, HALF_TIME_MINUTE, REGULATION_MINUTES);
    if (needsExtraTime(state)) {
      state.period = "EXTRA_TIME_FIRST_HALF";
      state.extraTime = true;
      state.pauseReason = "EXTRA_TIME_START";
      pushEvent(state, state.minute, "EXTRA_TIME_START", state.homeTeamId);
    } else {
      completeMatch(state);
      beginShootoutIfRequired(state);
    }
    state.stoppageTime = 0;
    return state;
  }

  if (state.period === "EXTRA_TIME_FIRST_HALF" && state.minute === EXTRA_TIME_HALF_MINUTE) {
    state.stoppageTime = computeStoppageTime(state, REGULATION_MINUTES, EXTRA_TIME_HALF_MINUTE);
    state.period = "EXTRA_TIME_HALF_TIME";
    state.pauseReason = "EXTRA_TIME_HALF_TIME";
    pushEvent(state, EXTRA_TIME_HALF_MINUTE, "EXTRA_TIME_HALF_TIME", state.homeTeamId);
    state.stoppageTime = 0;
    return state;
  }

  if (state.period === "EXTRA_TIME_SECOND_HALF" && state.minute >= EXTRA_TIME_FULL_MINUTES) {
    state.stoppageTime = computeStoppageTime(
      state,
      EXTRA_TIME_HALF_MINUTE,
      EXTRA_TIME_FULL_MINUTES,
    );
    completeMatch(state);
    beginShootoutIfRequired(state);
    state.stoppageTime = 0;
    return state;
  }

  return state;
};

/** Runs the state machine until full time (and any shootout) is resolved. */
export const runMatchToCompletion = (state: LiveMatchState): LiveMatchState => {
  let guard = 0;
  const guardLimit = EXTRA_TIME_FULL_MINUTES + 32;
  while (!isMatchDecided(state)) {
    stepMatch(state);
    guard += 1;
    if (guard > guardLimit) {
      throw new Error("Match state machine failed to reach full time");
    }
  }
  return state;
};

/** True once the match cannot advance any further: full time, shootout included. */
const isMatchDecided = (state: LiveMatchState): boolean => state.period === "FULL_TIME";

export const toMatchResult = (state: LiveMatchState): MatchResult => ({
  match: {
    id: state.matchId,
    fixtureId: state.fixtureId,
    playedDate: state.scheduledDate,
    homeGoals: state.homeGoals,
    awayGoals: state.awayGoals,
    winnerTeamId: state.winnerTeamId,
    wentToExtraTime: state.extraTime,
    shootoutHomeGoals: state.shootoutHomeGoals,
    shootoutAwayGoals: state.shootoutAwayGoals,
  },
  events: orderedEvents(state),
  homeStats: roundStats(state.home.stats),
  awayStats: roundStats(state.away.stats),
  playerStates: [...state.home.states, ...state.away.states],
  attendance: state.attendance,
  weather: "not-modeled",
  pitch: "not-modeled",
});

/** Run-to-completion convenience API. Unchanged signature and semantics. */
export const simulateMatch = (input: SimulateMatchInput): MatchResult =>
  toMatchResult(runMatchToCompletion(createMatchState(input)));

/**
 * VAR is intentionally limited to the incidents the engine can currently
 * review authoritatively: goals. The local RNG keeps review outcomes
 * deterministic without changing the match's primary simulation stream.
 */
const reviewGoalWithVar = (
  state: LiveMatchState,
  minute: number,
  attacking: RuntimeTeam,
  shooterId: EntityId,
  assisterId?: EntityId,
): void => {
  const varPersonId = state.refereeAssignment?.varPersonId;
  if (!varPersonId) return;

  const reviewRng = new SeededRandom(`${state.seed}:var:${state.matchId}:${minute}:${shooterId}`);
  if (reviewRng.next() >= 0.25) return;

  const overturn = reviewRng.next() < 0.2;
  const shooterState = playerState(attacking, shooterId);
  if (overturn) {
    if (attacking === state.home) state.homeGoals -= 1;
    else state.awayGoals -= 1;
    shooterState.goals -= 1;
    shooterState.rating -= 0.55;
    if (assisterId) {
      const assisterState = playerState(attacking, assisterId);
      assisterState.assists -= 1;
      assisterState.keyPasses -= 1;
      assisterState.rating -= 0.25;
    }
  }

  pushEvent(state, minute, "VAR_CHECK", attacking.teamId, shooterId, assisterId, {
    incident: "GOAL",
    originalDecision: "GOAL_ALLOWED",
    finalDecision: overturn ? "GOAL_DISALLOWED" : "GOAL_ALLOWED",
    outcome: overturn ? "OVERTURNED" : "CONFIRMED",
    varPersonId,
  });
};

/**
 * One simulated minute. The order of random draws here is load-bearing: it
 * defines the match, so it must not be reordered without regenerating the
 * engine regression baseline.
 */
const simulateMinute = (state: LiveMatchState, rng: SeededRandom, minute: number): void => {
  const { home, away, environment, matchId } = state;
  updateMomentum(state);
  const attacking = chooseAttackingTeam(rng, home, away);
  const defending = attacking === home ? away : home;
  attacking.controlTicks += 1;
  tickFatigue(attacking.states, minute, attacking.tactical.fatigue);
  tickFatigue(defending.states, minute, defending.tactical.fatigue);
  addPassingStats(rng, attacking);
  maybeSubstitute(rng, state, minute, attacking);
  maybeSubstitute(rng, state, minute, defending);
  // Deterministic, so it does not disturb the random stream.
  aiTacticalReaction(state, home, minute);
  aiTacticalReaction(state, away, minute);

  if (rng.next() < attackingSequenceChance(attacking, defending, environment)) {
    const shooter = chooseShooter(rng, attacking.selection);
    const assister = chooseAssister(rng, attacking.selection, shooter.personId);
    const xg = calculateShotXg(
      shooter,
      assister,
      attacking.strength,
      defending.strength,
      rng,
      environment,
      attacking.tactical,
      defending.tactical,
    );
    attacking.stats.shots += 1;
    attacking.stats.xg += xg;
    playerState(attacking, shooter.personId).shots += 1;
    pushEvent(state, minute, "SHOT", attacking.teamId, shooter.personId, undefined, {
      xg,
      chanceType: xg > 0.22 ? "clear" : xg > 0.1 ? "good" : "low",
    });

    const onTargetChance = clamp(
      (0.31 + xg + shooter.attributes.technical.finishing / 76) * attacking.tactical.chanceCreation,
      0.15,
      0.84,
    );
    if (rng.next() < onTargetChance) {
      attacking.stats.shotsOnTarget += 1;
      playerState(attacking, shooter.personId).shotsOnTarget += 1;
      pushEvent(state, minute, "SHOT_ON_TARGET", attacking.teamId, shooter.personId, undefined, {
        xg,
      });
      const goalChance = clamp(
        xg * (1.32 + shooter.attributes.mental.composure / 55) -
          (defending.strength.goalkeeping * defending.tactical.defense) / 460,
        0.03,
        0.68,
      );
      if (rng.next() < goalChance) {
        if (attacking === home) {
          state.homeGoals += 1;
        } else {
          state.awayGoals += 1;
        }
        const shooterState = playerState(attacking, shooter.personId);
        shooterState.goals += 1;
        shooterState.rating += 0.55;
        if (assister) {
          const assisterState = playerState(attacking, assister.personId);
          assisterState.assists += 1;
          assisterState.keyPasses += 1;
          assisterState.rating += 0.25;
        }
        pushEvent(state, minute, "GOAL", attacking.teamId, shooter.personId, assister?.personId, {
          xg,
          ...(assistDeliveredByCross(assister) ? { deliveredByCross: true } : {}),
        });
        if (assister) {
          pushEvent(state, minute, "ASSIST", attacking.teamId, assister.personId, shooter.personId, {
            ...(assistDeliveredByCross(assister) ? { deliveredByCross: true } : {}),
          });
        }
        reviewGoalWithVar(state, minute, attacking, shooter.personId, assister?.personId);
      } else {
        const keeper = defending.selection.find((player) => player.position === "GK");
        if (keeper) {
          playerState(defending, keeper.personId).saves += 1;
        }
        defending.stats.xg += 0;
        pushEvent(state, minute, "SAVE", defending.teamId, keeper?.personId, shooter.personId, {
          xg,
        });
      }
    } else if (rng.next() < 0.22) {
      attacking.stats.corners += 1;
      const setPieces = attacking.setup?.setPieces;
      const routine = setPieces?.cornerRoutine ?? "NEAR_POST";
      const target = resolveCornerTarget(attacking, setPieces);
      const defensive = resolveCornerDefence(defending);
      const familiarity = attacking.setup
        ? (attacking.setup.familiarity.instructions + attacking.setup.familiarity.roles) / 2
        : 50;
      const routineQuality = clamp(
        0.88 + (familiarity - 50) / 500 + attacking.strength.setPieces / 500,
        0.88,
        1.18,
      );
      pushEvent(state, minute, "CORNER", attacking.teamId, undefined, undefined, {
        routine,
        deliveryZone: setPieces?.cornerDeliveryZone ?? routine,
        targetPlayerId: target?.player.personId,
        targetRole: target?.role,
        fallbackUsed: target?.fallbackUsed ?? false,
        stayBackPlayerIds: activeIds(attacking, setPieces?.cornerStayBack),
        defensiveScheme: defensive.scheme,
        defensiveAssignmentIds: defensive.assignmentIds,
        aerialPriorityIds: defensive.aerialPriorityIds,
        outcome: resolveCornerOutcome(state, minute, attacking, defending, target, routineQuality),
        routineQuality: Number(routineQuality.toFixed(3)),
      });
    }
  }

  if (rng.next() < foulChance(home, away, environment)) {
    const fouling = rng.next() < 0.5 ? home : away;
    // Single draw, weighted: pressing/ball-winning players and higher-aggression
    // players commit more of a side's fouls than a deep-lying playmaker.
    const fouler = rng.pickWeighted(fouling.selection, (player) => {
      const b = behaviorOf(player);
      return (
        b.pressingContribution * (0.6 + player.attributes.mental.aggression / 20) +
        b.defensiveContribution * 0.3
      );
    });
    fouling.stats.fouls += 1;
    pushEvent(state, minute, "FOUL", fouling.teamId, fouler.personId);
    // A foul can create a set piece for the opponent. Record the routine and
    // quality as event data so the existing analytics/read models can explain
    // set-piece outcomes without inventing a separate event stream.
    if (rng.next() < 0.35) {
      const attacking = fouling === home ? away : home;
      const setPieces = attacking.setup?.setPieces;
      const routine = setPieces?.freeKickRoutine ?? "CROSS";
      const taker = resolveTaker(
        attacking,
        routine === "INDIRECT"
          ? [setPieces?.indirectFreeKickTaker, setPieces?.directFreeKickTaker]
          : [setPieces?.directFreeKickTaker, setPieces?.indirectFreeKickTaker],
      );
      const target = resolveTarget(attacking, [
        setPieces?.freeKickTarget,
        setPieces?.freeKickSecondaryTarget,
      ]);
      const familiarity = attacking.setup
        ? (attacking.setup.familiarity.instructions + attacking.setup.familiarity.roles) / 2
        : 50;
      const routineQuality = clamp(
        0.86 + (familiarity - 50) / 500 + attacking.strength.setPieces / 500,
        0.86,
        1.16,
      );
      pushEvent(state, minute, "FREE_KICK", attacking.teamId, taker?.personId, undefined, {
        routine,
        deliveryChoice:
          routine === "DIRECT" ? "SHOT" : routine === "INDIRECT" ? "DELIVERY" : "CROSS",
        targetPlayerId: target?.player.personId,
        fallbackUsed: target?.fallbackUsed ?? false,
        outcome: target ? "TARGET_AVAILABLE" : "RECYCLE",
        routineQuality: Number(routineQuality.toFixed(3)),
      });
    }
    if (rng.next() < 0.105 * fouling.tactical.discipline) {
      bookPlayer(state, fouling, fouler.personId, minute);
    }
    if (rng.next() < 0.006 * fouling.tactical.discipline) {
      dismissPlayer(state, fouling, fouler.personId, minute, "RED_CARD");
    }
  }

  if (rng.next() < injuryChance(home, away, environment)) {
    const injuredTeam = rng.next() < 0.5 ? home : away;
    const injured = rng.pick(injuredTeam.selection);
    const injury: InjuryRecord = {
      id: createStableEntityId("injury", `${matchId}:${injured.personId}:${minute}`),
      personId: injured.personId,
      injuryType: "match knock",
      dateOccurred: state.scheduledDate,
      expectedRecoveryDate: recoveryDate(state.scheduledDate, rng.integer(7, 35)),
      severity: rng.next() < 0.72 ? "minor" : rng.next() < 0.9 ? "moderate" : "major",
    };
    playerState(injuredTeam, injured.personId).injuryDuringMatch = injury;
    pushEvent(state, minute, "INJURY", injuredTeam.teamId, injured.personId, undefined, injury);
    if (injury.severity !== "minor") {
      state.pauseReason = "INJURY_DECISION";
    }
  }
};

type SetPieceTarget = {
  player: SelectedPlayer;
  role: "PRIMARY" | "SECONDARY" | "EDGE" | "FALLBACK";
  fallbackUsed: boolean;
};

const activeIds = (team: RuntimeTeam, ids?: EntityId[]): EntityId[] =>
  (ids ?? []).filter((id) => team.selection.some((player) => player.personId === id));

const resolveTaker = (
  team: RuntimeTeam,
  priorities: Array<EntityId | undefined>,
): SelectedPlayer | undefined => {
  for (const id of priorities) {
    const player = team.selection.find((candidate) => candidate.personId === id);
    const state = player
      ? team.states.find((candidate) => candidate.personId === player.personId)
      : undefined;
    if (player && state && !state.redCard && state.subbedOffMinute === undefined) return player;
  }
  return team.selection.find((player) => player.position !== "GK") ?? team.selection[0];
};

const resolveTarget = (
  team: RuntimeTeam,
  priorities: Array<EntityId | undefined>,
): SetPieceTarget | undefined => {
  const active = (id: EntityId | undefined): SelectedPlayer | undefined => {
    if (!id) return undefined;
    const player = team.selection.find((candidate) => candidate.personId === id);
    const state = player
      ? team.states.find((candidate) => candidate.personId === player.personId)
      : undefined;
    return player && state && !state.redCard && state.subbedOffMinute === undefined
      ? player
      : undefined;
  };
  const roles: SetPieceTarget["role"][] = ["PRIMARY", "SECONDARY", "EDGE"];
  for (let index = 0; index < priorities.length; index += 1) {
    const player = active(priorities[index]);
    if (player) return { player, role: roles[index] ?? "FALLBACK", fallbackUsed: index > 0 };
  }
  // No explicit target set — deterministically pick the best aerial threat on
  // the pitch (role/duty aerialTargetWeight + heading/jumping) rather than the
  // first outfield player. No RNG, no change to the explicit-priority path.
  const outfield = team.selection.filter((player) => player.position !== "GK");
  const fallback = outfield
    .map((player) => ({
      player,
      score:
        behaviorOf(player).aerialTargetWeight *
        (player.attributes.technical.heading + player.attributes.physical.jumping),
    }))
    .sort((a, b) => b.score - a.score)[0]?.player;
  return fallback ? { player: fallback, role: "FALLBACK", fallbackUsed: true } : undefined;
};

const resolveCornerTarget = (
  team: RuntimeTeam,
  setPieces?: TacticalSetup["setPieces"],
): SetPieceTarget | undefined =>
  resolveTarget(team, [
    setPieces?.cornerPrimaryTarget,
    setPieces?.cornerSecondaryTarget,
    setPieces?.cornerEdgeTarget,
  ]);

const resolveCornerDefence = (
  team: RuntimeTeam,
): {
  scheme: NonNullable<TacticalSetup["setPieces"]["defensiveCornerScheme"]>;
  assignmentIds: EntityId[];
  aerialPriorityIds: EntityId[];
} => {
  const setPieces = team.setup?.setPieces;
  const available = activeIds(team, setPieces?.defensiveCornerAssignments);
  const aerialPriorityIds = activeIds(team, setPieces?.defensiveAerialPriority);
  return {
    scheme: setPieces?.defensiveCornerScheme ?? "ZONAL",
    assignmentIds:
      available.length > 0
        ? available
        : team.selection
            .filter((p) => p.position !== "GK")
            .slice(0, 3)
            .map((p) => p.personId),
    aerialPriorityIds:
      aerialPriorityIds.length > 0
        ? aerialPriorityIds
        : team.selection
            .filter((p) => ["CB", "DM", "ST"].includes(p.position))
            .slice(0, 2)
            .map((p) => p.personId),
  };
};

const resolveCornerOutcome = (
  state: LiveMatchState,
  minute: number,
  attacking: RuntimeTeam,
  defending: RuntimeTeam,
  target: SetPieceTarget | undefined,
  routineQuality: number,
): "TARGETED" | "AERIAL_CONTEST" | "CLEARED" | "RECYCLED" => {
  if (!target) return "RECYCLED";
  const local = new SeededRandom(
    `${state.seed}:corner:${state.matchId}:${minute}:${attacking.teamId}:${state.eventSequence}`,
  );
  const aerial =
    target.player.attributes.physical.jumping + target.player.attributes.mental.positioning;
  const defence = defending.strength.defense + defending.tactical.defense * 10;
  const contestChance = clamp(
    0.34 + routineQuality * 0.24 + aerial / 260 - defence / 500,
    0.18,
    0.78,
  );
  if (local.next() > contestChance) return "CLEARED";
  return local.next() < 0.42 + routineQuality / 8 ? "AERIAL_CONTEST" : "TARGETED";
};

const updateMomentum = (state: LiveMatchState): void => {
  const lastEvent = state.events.at(-1);
  const lastGoalTeam = lastEvent?.type === "GOAL" ? lastEvent.teamId : undefined;
  for (const [team, goalsFor, goalsAgainst] of [
    [state.home, state.homeGoals, state.awayGoals],
    [state.away, state.awayGoals, state.homeGoals],
  ] as const) {
    const scoreSignal = clamp((goalsFor - goalsAgainst) * 9, -24, 24);
    const eventSignal = lastGoalTeam === team.teamId ? 9 : lastGoalTeam ? -5 : 0;
    const target = clamp(50 + scoreSignal + eventSignal, 20, 80);
    team.momentum = clamp(team.momentum + (target - team.momentum) * 0.16, 20, 80);
  }
};

const completeMatch = (state: LiveMatchState): void => {
  finalizeStates(state.home.states, state.homeGoals, state.awayGoals);
  finalizeStates(state.away.states, state.awayGoals, state.homeGoals);
  applyPossession(state);
  state.period = "FULL_TIME";
  state.pauseReason = "FULL_TIME";
  pushEvent(state, state.minute, "FULL_TIME", state.homeTeamId);
  if (state.requiresWinner) {
    const score = effectiveAggregateScore(state);
    if (score.home !== score.away) {
      state.winnerTeamId = score.home > score.away ? state.homeTeamId : state.awayTeamId;
    }
  }
};

/**
 * Realistic stoppage time: a deterministic function of how many stoppages
 * (fouls, cards, injuries, subs, goals) happened during the half. Display and
 * commentary only — it does not add simulated minutes to the clock.
 */
const STOPPAGE_EVENT_TYPES = new Set([
  "FOUL",
  "YELLOW_CARD",
  "SECOND_YELLOW",
  "RED_CARD",
  "INJURY",
  "SUBSTITUTION",
  "GOAL",
]);

const computeStoppageTime = (
  state: LiveMatchState,
  fromMinute: number,
  toMinute: number,
): number => {
  const count = state.events.filter(
    (event) =>
      (event.minute ?? 0) > fromMinute &&
      (event.minute ?? 0) <= toMinute &&
      STOPPAGE_EVENT_TYPES.has(event.type),
  ).length;
  return Math.round(clamp(count / 2.4, 1, 7));
};

/** Regulation/ET goals plus any first-leg goals, in this match's home/away frame. */
const effectiveAggregateScore = (state: LiveMatchState): { home: number; away: number } => {
  const leg = state.aggregateFirstLeg;
  if (!leg) return { home: state.homeGoals, away: state.awayGoals };
  return { home: state.homeGoals + leg.homeGoals, away: state.awayGoals + leg.awayGoals };
};

/** A knockout tie still level on aggregate at 90' needs extra time. */
const needsExtraTime = (state: LiveMatchState): boolean => {
  if (
    !state.requiresWinner ||
    !state.allowExtraTime ||
    state.winnerResolution === "DIRECT_PENALTIES"
  )
    return false;
  const score = effectiveAggregateScore(state);
  return score.home === score.away;
};

const beginShootoutIfRequired = (state: LiveMatchState): void => {
  if (state.requiresWinner && !state.winnerTeamId) {
    if (!state.allowPenalties) {
      throw new Error("Winner-required match has no configured penalty resolution");
    }
    state.period = "PENALTY_SHOOTOUT";
    state.pauseReason = "PENALTY_SHOOTOUT";
  }
};

/**
 * Resolves a penalty shootout deterministically and atomically in one step —
 * not an interactive per-kick UI, so it stays a bounded addition to the
 * existing state machine rather than a new subsystem. Best-of-five then
 * sudden death, cycling back through the taker list if it runs out.
 */
const resolveShootout = (state: LiveMatchState, rng: SeededRandom): void => {
  const homeTakers = shootoutTakers(state.home);
  const awayTakers = shootoutTakers(state.away);
  const kicks: PenaltyKick[] = [];
  let homeScore = 0;
  let awayScore = 0;

  const takeKick = (team: RuntimeTeam, takers: SelectedPlayer[], round: number): boolean => {
    const taker = takers[(round - 1) % takers.length]!;
    const chance = clamp(
      0.7 + taker.attributes.mental.composure / 500 + taker.attributes.technical.finishing / 550,
      0.55,
      0.93,
    );
    const scored = rng.next() < chance;
    kicks.push({ teamId: team.teamId, personId: taker.personId, scored, round });
    pushEvent(
      state,
      state.minute,
      "PENALTY_SHOOTOUT_KICK",
      team.teamId,
      taker.personId,
      undefined,
      {
        scored,
        round,
      },
    );
    return scored;
  };

  let round = 1;
  // Best of five.
  while (round <= 5) {
    if (takeKick(state.home, homeTakers, round)) homeScore += 1;
    if (takeKick(state.away, awayTakers, round)) awayScore += 1;
    round += 1;
  }
  // Sudden death: one kick each, round by round, until it's decided.
  while (homeScore === awayScore && round <= 200) {
    if (takeKick(state.home, homeTakers, round)) homeScore += 1;
    if (takeKick(state.away, awayTakers, round)) awayScore += 1;
    round += 1;
  }

  state.shootoutHomeGoals = homeScore;
  state.shootoutAwayGoals = awayScore;
  state.shootoutKicks = kicks;
  state.winnerTeamId = homeScore > awayScore ? state.homeTeamId : state.awayTeamId;
  state.period = "FULL_TIME";
  state.pauseReason = "FULL_TIME";
  pushEvent(
    state,
    state.minute,
    "PENALTY_SHOOTOUT_COMPLETE",
    state.winnerTeamId,
    undefined,
    undefined,
    { homeScore, awayScore },
  );
};

/** Outfield players first, goalkeeper last, so a keeper only takes a kick if everyone else has. */
const shootoutTakers = (team: RuntimeTeam): SelectedPlayer[] => {
  const eligible = team.selection.filter((player) => {
    const state = team.states.find((candidate) => candidate.personId === player.personId);
    return state && !state.redCard && state.subbedOffMinute === undefined;
  });
  const configured =
    team.setup?.setPieces.penaltyTakers ??
    [team.setup?.setPieces.penaltyTaker].filter((id): id is EntityId => Boolean(id));
  const configuredPlayers = configured.flatMap((id) =>
    eligible.filter((player) => player.personId === id),
  );
  const remaining = eligible.filter((player) => !configured.includes(player.personId));
  const outfield = [...configuredPlayers, ...remaining].filter(
    (player) => player.position !== "GK",
  );
  const keeper = [...configuredPlayers, ...remaining].filter((player) => player.position === "GK");
  const pool = [...outfield, ...keeper];
  return pool.length > 0 ? pool : team.selection;
};

/**
 * Applies a new tactical setup to a side mid-match and records it.
 *
 * Only future minutes are affected: strength and modifiers are recomputed from
 * the new setup, and nothing already simulated is revisited.
 */
export const applyTacticalChange = (
  state: LiveMatchState,
  team: RuntimeTeam,
  setup: TacticalSetup,
  minute: number,
  decidedBy: "MANAGER" | "AI" = "MANAGER",
): void => {
  const previous = team.setup;
  team.setup = setup;
  // Re-derive each on-pitch player's behaviour from their slot's (possibly
  // changed) role + duty. The XI itself is untouched — a live tactical change
  // never silently swaps players — only how they now play.
  team.selection = team.selection.map((player) => {
    const assignment = player.tacticalSlotId
      ? setup.assignments.find((candidate) => candidate.slotId === player.tacticalSlotId)
      : undefined;
    if (!assignment) return player;
    const duty = (assignment.duty as PlayerDuty | undefined) ?? "SUPPORT";
    return {
      ...player,
      role: assignment.roleId,
      duty,
      instructions: assignment.instructions,
      behavior: derivePlayerTacticalBehavior({
        attributes: player.attributes,
        roleId: assignment.roleId,
        duty,
        roleFit: player.roleFit,
        familiarity: setup.familiarity,
        mentality: setup.instructions.mentality,
        teamInstructions: setup.instructions,
        playerInstructions: assignment.instructions,
      }),
    };
  });
  team.tactical = calculateTacticalModifiers({
    setup,
    averageRoleFit: average(team.selection.map((player) => player.roleFit ?? 70)),
  });
  team.strength = applyTacticalStrength(
    applyEnvironmentToStrength(
      calculateTeamStrength({
        selection: team.selection,
        homeAdvantage: team.teamId === state.homeTeamId,
        managerQuality: team.tactical.managerQuality,
      }),
      team.teamId === state.homeTeamId,
      state.environment,
    ),
    setup,
  );

  // Only the fields that actually moved are stored, not the whole tactic.
  const changes: Record<string, unknown> = { decidedBy };
  if (previous?.formation.id !== setup.formation.id) {
    changes.formation = setup.formation.name;
  }
  if (previous?.style !== setup.style) changes.style = setup.style;
  if (previous?.instructions.mentality !== setup.instructions.mentality) {
    changes.mentality = setup.instructions.mentality;
  }
  const before = previous?.instructions;
  const after = setup.instructions;
  if (before?.inPossession.tempo !== after.inPossession.tempo) {
    changes.tempo = after.inPossession.tempo;
  }
  if (before?.inPossession.passingLength !== after.inPossession.passingLength) {
    changes.passingLength = after.inPossession.passingLength;
  }
  if (before?.inPossession.width !== after.inPossession.width) {
    changes.width = after.inPossession.width;
  }
  if (before?.outOfPossession.pressingIntensity !== after.outOfPossession.pressingIntensity) {
    changes.pressingIntensity = after.outOfPossession.pressingIntensity;
  }
  if (before?.outOfPossession.defensiveLine !== after.outOfPossession.defensiveLine) {
    changes.defensiveLine = after.outOfPossession.defensiveLine;
  }
  pushEvent(state, minute, "TACTICAL_CHANGE", team.teamId, undefined, undefined, changes);
};

/**
 * Lightweight deterministic AI reactions. Consumes no randomness, so it shifts
 * how a side plays without perturbing the match's random stream.
 */
/**
 * Bounded duty redistribution for a mentality swing — never every outfield
 * player, never a defensive slot pushed forward, never an illegal duty. At
 * most two attacking-zone assignments move one step; the rest of the shape
 * (and every defensive slot) is untouched, so the team's identity stays
 * recognisable through the adjustment. This is match-session state only —
 * applyTacticalChange never writes back to the persisted baseline setup, so
 * the AI manager's own tactic is exactly what it was before kickoff once the
 * match ends.
 */
const redistributeDuties = (
  setup: TacticalSetup,
  direction: "ATTACKING" | "CAUTIOUS",
): TacticalAssignment[] => {
  const attackingZones = new Set(["forward", "attackingMidfield", "wingback"]);
  const slotZone = new Map(setup.formation.slots.map((slot) => [slot.id, slot.zone] as const));
  let moved = 0;
  return setup.assignments.map((assignment) => {
    if (moved >= 2 || !assignment.playerId) return assignment;
    const zone = slotZone.get(assignment.slotId);
    if (!zone || !attackingZones.has(zone)) return assignment;
    if (
      direction === "ATTACKING" &&
      assignment.duty === "SUPPORT" &&
      dutyIsLegalForRole(assignment.roleId, "ATTACK")
    ) {
      moved += 1;
      return { ...assignment, duty: "ATTACK" };
    }
    if (
      direction === "CAUTIOUS" &&
      assignment.duty === "ATTACK" &&
      dutyIsLegalForRole(assignment.roleId, "SUPPORT")
    ) {
      moved += 1;
      return { ...assignment, duty: "SUPPORT" };
    }
    return assignment;
  });
};

export const aiTacticalReaction = (state: LiveMatchState, team: RuntimeTeam, minute: number): void => {
  if (!team.setup || minute < 60 || minute % 15 !== 0) return;
  const deficit = trailingBy(state, team);
  const shortHanded = team.selection.length < 11;
  const mentality = team.setup.instructions.mentality;

  let target: TacticalSetup["instructions"]["mentality"] | undefined;
  if (shortHanded && mentality !== "DEFENSIVE") {
    target = "DEFENSIVE";
  } else if (deficit > 0 && minute >= 70 && mentality !== "ATTACKING") {
    target = "ATTACKING";
  } else if (deficit < 0 && minute >= 80 && mentality !== "CAUTIOUS") {
    target = "CAUTIOUS";
  }
  if (!target) return;

  // A red card gets the defensive mentality shift only — reshaping duties on
  // top of playing a player short is exactly the invasive change this pass
  // avoids; the reduced XI and its unchanged roles/duties already carry the
  // defensive intent.
  const assignments =
    !shortHanded && (target === "ATTACKING" || target === "CAUTIOUS")
      ? redistributeDuties(team.setup, target)
      : team.setup.assignments;

  applyTacticalChange(
    state,
    team,
    {
      ...team.setup,
      instructions: { ...team.setup.instructions, mentality: target },
      assignments,
    },
    minute,
    "AI",
  );
};

/**
 * Possession is the engine's existing midfield-and-style weighting. It is now
 * blended with how often each side actually had the ball during the match so it
 * can be read live, and it still totals 100.
 */
export const applyPossession = (state: LiveMatchState): void => {
  const { home, away } = state;
  const homeWeight = home.strength.midfield * home.tactical.possession;
  const awayWeight = away.strength.midfield * away.tactical.possession;
  const totalWeight = homeWeight + awayWeight;
  const modelShare = totalWeight > 0 ? homeWeight / totalWeight : 0.5;
  const ticks = home.controlTicks + away.controlTicks;
  const observedShare = ticks > 0 ? home.controlTicks / ticks : modelShare;
  const share = clamp(modelShare * 0.6 + observedShare * 0.4, 0.2, 0.8);
  home.stats.possession = Math.round(share * 100);
  away.stats.possession = 100 - home.stats.possession;
};

const createRuntimeTeam = (
  teamId: EntityId,
  selection: SelectedPlayer[],
  homeAdvantage: boolean,
  environment: MatchEnvironment,
  tacticalSetup?: TacticalSetup,
): RuntimeTeam => ({
  teamId,
  selection,
  strength: applyTacticalStrength(
    applyEnvironmentToStrength(
      calculateTeamStrength({
        selection,
        homeAdvantage,
        managerQuality: tacticalSetup
          ? calculateTacticalModifiers({ setup: tacticalSetup }).managerQuality
          : undefined,
      }),
      homeAdvantage,
      environment,
    ),
    tacticalSetup,
  ),
  tactical: tacticalSetup
    ? calculateTacticalModifiers({
        setup: tacticalSetup,
        averageRoleFit: average(selection.map((player) => player.roleFit ?? 70)),
      })
    : neutralTacticalModifiers(),
  stats: {
    teamId,
    possession: 50,
    shots: 0,
    shotsOnTarget: 0,
    xg: 0,
    corners: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
  },
  states: selection.map(createInitialPlayerState),
  substitutionsUsed: 0,
  controlTicks: 0,
  momentum: tacticalSetup
    ? clamp(50 + (average(Object.values(tacticalSetup.familiarity)) - 65) * 0.2, 35, 65)
    : 50,
  benchIds: [],
  benchPlayers: [],
  setup: tacticalSetup,
  usedSubstitutes: [],
});

const chooseAttackingTeam = (
  rng: SeededRandom,
  home: RuntimeTeam,
  away: RuntimeTeam,
): RuntimeTeam => {
  const homeControl =
    (home.strength.midfield + home.strength.attack * 0.35) *
    home.tactical.control *
    (0.92 + home.momentum / 500);
  const awayControl =
    (away.strength.midfield + away.strength.attack * 0.35) *
    away.tactical.control *
    (0.92 + away.momentum / 500);
  return rng.next() < homeControl / (homeControl + awayControl) ? home : away;
};

const attackingSequenceChance = (
  attacking: RuntimeTeam,
  defending: RuntimeTeam,
  environment: MatchEnvironment,
): number => {
  const tempo = clamp(environment.matchTempo, 0.8, 1.18);
  const pitch = clamp(environment.pitchQuality, 0.85, 1.12);
  return clamp(
    (0.14 +
      (attacking.strength.attack * attacking.tactical.chanceCreation -
        defending.strength.defense * defending.tactical.transitionDefense) /
        980) *
      tempo *
      pitch *
      (0.96 + (attacking.momentum - 50) / 500),
    0.098,
    0.192,
  );
};

const calculateShotXg = (
  shooter: SelectedPlayer,
  assister: SelectedPlayer | undefined,
  attacking: TeamStrength,
  defending: TeamStrength,
  rng: SeededRandom,
  environment: MatchEnvironment,
  attackingTactic: TacticalMatchModifiers,
  defendingTactic: TacticalMatchModifiers,
): number => {
  const chanceBase = rng.next() < 0.18 ? 0.22 : rng.next() < 0.48 ? 0.115 : 0.055;
  const finisher = shooter.attributes.technical.finishing + shooter.attributes.mental.composure;
  const creation = assister
    ? assister.attributes.mental.vision + assister.attributes.technical.passing
    : 18;
  const pressure = defending.defense * defendingTactic.defense + defending.goalkeeping * 0.45;
  const environmentalDrag = environment.weatherImpact * 0.018 + environment.heatImpact * 0.012;
  return clamp(
    chanceBase +
      finisher / 420 +
      creation / 625 +
      (attacking.attack * attackingTactic.xg) / 850 -
      pressure / 1100 -
      environmentalDrag,
    0.015,
    0.58,
  );
};

const behaviorOf = (player: SelectedPlayer): PlayerTacticalBehavior =>
  player.behavior ?? NEUTRAL_PLAYER_BEHAVIOR;

const WIDE_ROLES = new Set([
  "WINGER",
  "INSIDE_FORWARD",
  "WIDE_PLAYMAKER",
  "WING_BACK",
  "FULL_BACK",
  "INVERTED_FULL_BACK",
  "WIDE_CENTRE_BACK",
]);

/** A player who operates in wide channels, by selected position or by role. */
const isWide = (player: SelectedPlayer): boolean =>
  ["LW", "RW", "LB", "RB"].includes(player.position) ||
  (player.role !== undefined && WIDE_ROLES.has(player.role));

/**
 * Who gets the shot. Still a single RNG draw (the match-minute draw order is
 * load-bearing), now a weighted one: role/duty box presence and attacking
 * involvement combine with the player's own finishing so a Poacher/Advanced
 * Forward on an ATTACK duty is materially more likely to be the shooter than
 * a wide SUPPORT player, without ever guaranteeing it.
 */
const chooseShooter = (rng: SeededRandom, players: readonly SelectedPlayer[]): SelectedPlayer => {
  const attackers = players.filter((player) =>
    ["ST", "LW", "RW", "AM", "CM"].includes(player.position),
  );
  const pool = attackers.length > 0 ? attackers : players;
  return rng.pickWeighted(pool, (player) => {
    const b = behaviorOf(player);
    const finishing = (player.attributes.technical.finishing + player.attributes.mental.composure) / 2;
    return b.boxPresence * b.attackingInvolvement * (0.55 + finishing / 22);
  });
};

/**
 * Who gets the assist / key pass. Same two draws as before (the 0.64 gate,
 * then the pick), the pick now weighted by creative + progression involvement,
 * the player's vision/passing, plus a wide crossing contribution so a Winger
 * on ATTACK feeds more chances than an Inside Forward in the same slot.
 */
const chooseAssister = (
  rng: SeededRandom,
  players: readonly SelectedPlayer[],
  shooterId: EntityId,
): SelectedPlayer | undefined => {
  if (rng.next() > 0.64) {
    return undefined;
  }
  const creators = players.filter(
    (player) => player.personId !== shooterId && player.position !== "GK",
  );
  if (creators.length === 0) return undefined;
  return rng.pickWeighted(creators, (player) => {
    const b = behaviorOf(player);
    const vision = (player.attributes.mental.vision + player.attributes.technical.passing) / 2;
    const wide = isWide(player) ? b.crossingTendency : 1;
    return b.creativeInvolvement * b.progressionInvolvement * wide * (0.5 + vision / 24);
  });
};

/** True when an assist plausibly came from a wide delivery — recorded on the
 * event so the wide/crossing role effect is observable without a new event. */
const assistDeliveredByCross = (assister: SelectedPlayer | undefined): boolean =>
  Boolean(
    assister && isWide(assister) && behaviorOf(assister).crossingTendency >= 1.25,
  );

/**
 * AI substitution. The window still costs the same single random draw as before
 * so the RNG stream stays aligned, but the choice of who comes off is now a
 * deterministic score over fitness, rating, cards and the scoreline rather than
 * "most tired player".
 */
const maybeSubstitute = (
  rng: SeededRandom,
  state: LiveMatchState,
  minute: number,
  team: RuntimeTeam,
): void => {
  if (
    ![60, 72, 82].includes(minute) ||
    team.substitutionsUsed >= state.substitutionLimit ||
    rng.next() > 0.72
  ) {
    return;
  }
  const candidate = substitutionCandidate(state, team, minute);
  if (!candidate) {
    return;
  }
  applySubstitution(state, team, candidate.offId, candidate.onId, minute, {
    reason: candidate.reason,
    decidedBy: "AI",
  });
};

type SubstitutionChoice = { offId: EntityId; onId: EntityId; reason: string };

/**
 * Picks who to withdraw. Uses only information a manager can see during a
 * match — condition, performance, disciplinary risk — not hidden ability.
 */
const substitutionCandidate = (
  state: LiveMatchState,
  team: RuntimeTeam,
  minute: number,
): SubstitutionChoice | undefined => {
  const incoming = team.benchPlayers[0];
  if (!incoming) return undefined;

  const chasing = trailingBy(state, team) > 0;
  const leading = trailingBy(state, team) < 0;

  const scored = team.selection
    .filter((player) => player.position !== "GK")
    .flatMap((player) => {
      const playerState = team.states.find((candidate) => candidate.personId === player.personId);
      if (!playerState || playerState.subbedOffMinute !== undefined) return [];
      let urgency = 0;
      let reason = "fitness";
      if (playerState.injuryDuringMatch) {
        urgency += 100;
        reason = "injury";
      }
      // A booked player late on is a dismissal risk.
      if (playerState.yellowCards >= 1 && minute >= 60) {
        urgency += 22;
        if (reason === "fitness") reason = "discipline";
      }
      urgency += Math.max(0, 70 - playerState.currentFitness);
      urgency += Math.max(0, 6.4 - playerState.rating) * 6;
      if (playerState.rating < 5.8 && reason === "fitness") reason = "performance";
      // Chasing a game, take off a defender; protecting one, take off a forward.
      if (chasing && ["CB", "RB", "LB", "DM"].includes(player.position)) urgency += 12;
      if (leading && ["ST", "LW", "RW", "AM"].includes(player.position)) urgency += 10;
      return [{ playerState, urgency, reason }];
    })
    .sort(
      (a, b) =>
        b.urgency - a.urgency || a.playerState.personId.localeCompare(b.playerState.personId),
    );

  const choice = scored[0];
  if (!choice || choice.playerState.personId === incoming.personId) return undefined;
  return {
    offId: choice.playerState.personId,
    onId: incoming.personId,
    reason: choice.reason,
  };
};

const trailingBy = (state: LiveMatchState, team: RuntimeTeam): number =>
  team.teamId === state.homeTeamId
    ? state.awayGoals - state.homeGoals
    : state.homeGoals - state.awayGoals;

/**
 * Puts a substitution into effect. Unlike the original engine this actually
 * swaps the players on the pitch, so the replacement can influence the rest of
 * the match and minutes are attributed correctly.
 */
export const applySubstitution = (
  state: LiveMatchState,
  team: RuntimeTeam,
  outgoingId: EntityId,
  incomingId: EntityId,
  minute: number,
  data: Record<string, unknown> = {},
): void => {
  const outgoingIndex = team.selection.findIndex((player) => player.personId === outgoingId);
  const incoming = team.benchPlayers.find((player) => player.personId === incomingId);
  const outgoingState = team.states.find((candidate) => candidate.personId === outgoingId);
  if (outgoingIndex < 0 || !incoming || !outgoingState) {
    return;
  }
  team.substitutionsUsed += 1;
  outgoingState.currentFitness = Math.min(100, outgoingState.currentFitness + 3);
  outgoingState.subbedOffMinute = minute;
  outgoingState.minutesPlayed = minute;

  // The replacement inherits the vacated tactical slot — including any player
  // instructions, which belong to the slot, not the departing player — so
  // shape and intent are preserved, but behaviour is re-derived from the
  // incoming player's own attributes in that role + duty: a like-for-like
  // swap into a poor-fit role is blunted.
  const vacated = team.selection[outgoingIndex]!;
  const replacement: SelectedPlayer = {
    ...incoming,
    teamId: team.teamId,
    position: vacated.position,
    role: vacated.role,
    duty: vacated.duty,
    instructions: vacated.instructions,
    roleFit: vacated.roleFit,
    tacticalSlotId: vacated.tacticalSlotId,
    behavior: vacated.role
      ? derivePlayerTacticalBehavior({
          attributes: incoming.attributes,
          roleId: vacated.role,
          duty: (vacated.duty as PlayerDuty | undefined) ?? "SUPPORT",
          roleFit: vacated.roleFit,
          familiarity: team.setup?.familiarity,
          mentality: team.setup?.instructions.mentality,
          teamInstructions: team.setup?.instructions,
          playerInstructions: vacated.instructions,
        })
      : (vacated.behavior ?? NEUTRAL_PLAYER_BEHAVIOR),
  };
  team.selection[outgoingIndex] = replacement;
  team.benchPlayers = team.benchPlayers.filter((player) => player.personId !== incomingId);
  team.usedSubstitutes.push(incomingId);

  const incomingState = createInitialPlayerState(replacement);
  incomingState.subbedOnMinute = minute;
  incomingState.minutesPlayed = 0;
  team.states.push(incomingState);

  pushEvent(state, minute, "SUBSTITUTION", team.teamId, incomingId, outgoingId, {
    ...data,
    substitutionsUsed: team.substitutionsUsed,
  });
};

const playerState = (team: RuntimeTeam, personId: EntityId): PlayerMatchState => {
  const state = team.states.find((candidate) => candidate.personId === personId);
  if (!state) {
    throw new Error(`Missing player state for ${personId}`);
  }
  return state;
};

const addPassingStats = (rng: SeededRandom, team: RuntimeTeam): void => {
  const behaviorByPerson = new Map(
    team.selection.map((player) => [player.personId, behaviorOf(player)] as const),
  );
  for (const player of team.states) {
    const b = behaviorByPerson.get(player.personId) ?? NEUTRAL_PLAYER_BEHAVIOR;
    // Same three draws in the same order — role/duty only reshapes the odds.
    const attempted = rng.integer(0, 2);
    const progression = clamp(b.progressionInvolvement, 0.4, 1.75);
    player.passesAttempted += Math.round(attempted * clamp(0.7 + progression * 0.3, 0.6, 1.3));
    player.passesCompleted += Math.round(
      attempted * clamp(0.62 + team.strength.midfield / 70, 0.55, 0.9),
    );
    const defensive = clamp(b.defensiveContribution, 0.4, 1.75);
    if (rng.next() < 0.035 * defensive) {
      player.tackles += 1;
    }
    if (rng.next() < 0.025 * clamp((defensive + b.defensivePositioning) / 2, 0.4, 1.75)) {
      player.interceptions += 1;
    }
  }
};

const tickFatigue = (
  states: PlayerMatchState[],
  minute: number,
  fatigueMultiplier: number,
): void => {
  if (minute % 5 !== 0) {
    return;
  }
  for (const state of states) {
    state.minutesPlayed += 5;
    state.fatigue += 2.2 * fatigueMultiplier;
    state.currentFitness = Math.max(10, state.currentFitness - 1.7 * fatigueMultiplier);
  }
};

/**
 * Attributes minutes honestly (a substitute does not get 90) and applies the
 * engine's existing rating adjustments. The rating formula itself is unchanged.
 */
const finalizeStates = (
  states: PlayerMatchState[],
  goalsFor: number,
  goalsAgainst: number,
): void => {
  for (const state of states) {
    const leftAt = state.subbedOffMinute ?? state.sentOffMinute;
    const cameOn = state.subbedOnMinute ?? 0;
    state.minutesPlayed = leftAt !== undefined ? leftAt - cameOn : REGULATION_MINUTES - cameOn;
    state.rating = clamp(
      state.rating +
        state.goals * 0.7 +
        state.assists * 0.35 +
        state.saves * 0.08 +
        (goalsFor - goalsAgainst) * 0.08 -
        Number(state.redCard) * 1.1 -
        state.yellowCards * 0.12,
      3,
      10,
    );
  }
};

const foulChance = (home: RuntimeTeam, away: RuntimeTeam, environment: MatchEnvironment): number =>
  clamp(
    (0.18 + (home.strength.defense + away.strength.defense) / 980) *
      clamp(environment.refereeStrictness, 0.75, 1.3) *
      clamp(environment.competitionPhysicality, 0.8, 1.25),
    0.14,
    0.27,
  );

const injuryChance = (
  home: RuntimeTeam,
  away: RuntimeTeam,
  environment: MatchEnvironment,
): number =>
  clamp(
    (0.00105 +
      (100 - averageFitness(home.states) + 100 - averageFitness(away.states)) / 160000 +
      environment.heatImpact * 0.0002) *
      clamp(environment.competitionPhysicality, 0.75, 1.35),
    0.0006,
    0.0032,
  );

const averageFitness = (states: readonly PlayerMatchState[]): number =>
  states.reduce((total, state) => total + state.currentFitness, 0) / states.length;

const recoveryDate = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

/**
 * Event importance drives Key Events filtering. It is derived from the event
 * type and its context, never stored by the caller.
 */
export type MatchEventImportance = "MINOR" | "NOTABLE" | "MAJOR" | "CRITICAL";

const IMPORTANCE: Record<string, MatchEventImportance> = {
  KICK_OFF: "NOTABLE",
  HALF_TIME: "MAJOR",
  SECOND_HALF: "NOTABLE",
  FULL_TIME: "CRITICAL",
  EXTRA_TIME_START: "CRITICAL",
  EXTRA_TIME_HALF_TIME: "MAJOR",
  EXTRA_TIME_SECOND_HALF: "NOTABLE",
  PENALTY_SHOOTOUT_KICK: "MAJOR",
  PENALTY_SHOOTOUT_COMPLETE: "CRITICAL",
  GOAL: "CRITICAL",
  VAR_CHECK: "MAJOR",
  OWN_GOAL: "CRITICAL",
  PENALTY_SCORED: "CRITICAL",
  PENALTY_MISSED: "CRITICAL",
  PENALTY_AWARDED: "MAJOR",
  RED_CARD: "CRITICAL",
  SECOND_YELLOW: "CRITICAL",
  INJURY: "MAJOR",
  SUBSTITUTION: "MAJOR",
  TACTICAL_CHANGE: "MAJOR",
  YELLOW_CARD: "NOTABLE",
  SAVE: "NOTABLE",
  SHOT_ON_TARGET: "NOTABLE",
  ASSIST: "NOTABLE",
  SHOT: "MINOR",
  CORNER: "MINOR",
  FOUL: "MINOR",
  FREE_KICK: "MINOR",
};

export const matchEventImportance = (event: MatchEvent): MatchEventImportance => {
  if (event.type === "SHOT") {
    // A clear-cut chance matters even though most shots do not.
    return event.data?.chanceType === "clear" ? "NOTABLE" : "MINOR";
  }
  return IMPORTANCE[event.type] ?? "MINOR";
};

/** Events the Key Events view shows. */
export const isKeyEvent = (event: MatchEvent): boolean =>
  matchEventImportance(event) === "MAJOR" || matchEventImportance(event) === "CRITICAL";

/**
 * Appends an event and stamps it with a monotonic sequence, so a timeline can
 * be restored in the exact order it happened even within a single minute.
 */
const pushEvent = (
  state: LiveMatchState,
  minute: number,
  type: string,
  teamId: EntityId,
  primaryPersonId?: EntityId,
  secondaryPersonId?: EntityId,
  data?: Record<string, unknown>,
): MatchEvent => {
  const sequence = state.eventSequence;
  state.eventSequence += 1;
  const built: MatchEvent = {
    id: createStableEntityId("match-event", `${state.matchId}:${sequence}`),
    matchId: state.matchId,
    minute,
    stoppageTime: state.stoppageTime > 0 ? state.stoppageTime : undefined,
    type,
    teamId,
    primaryPersonId,
    secondaryPersonId,
    personId: primaryPersonId,
    data: { ...(data ?? {}), sequence, importance: "MINOR" },
  };
  built.data!.importance = matchEventImportance(built);
  state.events.push(built);
  return built;
};

/** Chronological order: minute, then stoppage, then the order it happened in. */
export const orderedEvents = (state: LiveMatchState): MatchEvent[] =>
  [...state.events].sort(compareMatchEvents);

export const compareMatchEvents = (a: MatchEvent, b: MatchEvent): number =>
  (a.minute ?? 0) - (b.minute ?? 0) ||
  (a.stoppageTime ?? 0) - (b.stoppageTime ?? 0) ||
  Number(a.data?.sequence ?? 0) - Number(b.data?.sequence ?? 0);

/**
 * A booking. A player already on a yellow is dismissed for a second, which the
 * original engine did not model.
 */
const bookPlayer = (
  state: LiveMatchState,
  team: RuntimeTeam,
  personId: EntityId,
  minute: number,
): void => {
  const player = playerState(team, personId);
  if (player.redCard) {
    return;
  }
  player.yellowCards += 1;
  team.stats.yellowCards += 1;
  if (player.yellowCards >= 2) {
    pushEvent(state, minute, "SECOND_YELLOW", team.teamId, personId);
    dismissPlayer(state, team, personId, minute, "SECOND_YELLOW_DISMISSAL");
    return;
  }
  pushEvent(state, minute, "YELLOW_CARD", team.teamId, personId);
};

/**
 * Sends a player off. The team plays on a man short: the dismissed player is
 * removed from the pitch and is never automatically replaced.
 */
const dismissPlayer = (
  state: LiveMatchState,
  team: RuntimeTeam,
  personId: EntityId,
  minute: number,
  type: string,
): void => {
  const player = playerState(team, personId);
  if (player.redCard) {
    return;
  }
  player.redCard = true;
  player.minutesPlayed = minute;
  player.sentOffMinute = minute;
  // Counted once, whether it came straight or from a second booking.
  team.stats.redCards += 1;
  team.selection = team.selection.filter((candidate) => candidate.personId !== personId);
  state.pauseReason = "RED_CARD";
  if (type === "RED_CARD") {
    pushEvent(state, minute, "RED_CARD", team.teamId, personId);
  } else {
    pushEvent(state, minute, "RED_CARD", team.teamId, personId, undefined, {
      secondYellow: true,
    });
  }
};

/** Bench players resolved to selectable form, excluding anyone already starting. */
const benchPlayers = (
  players: readonly PlayerAttributeSet[],
  benchIds: readonly EntityId[],
  selection: readonly SelectedPlayer[],
): SelectedPlayer[] => {
  const starting = new Set(selection.map((player) => player.personId));
  return benchIds.flatMap((id) => {
    if (starting.has(id)) return [];
    const attributes = players.find((player) => player.personId === id);
    if (!attributes) return [];
    return [
      {
        personId: attributes.personId,
        teamId: selection[0]?.teamId ?? ("" as EntityId),
        position: attributes.primaryPosition,
        attributes,
        availability: {
          personId: attributes.personId,
          fitness: 100,
          moraleModifier: 0,
          formModifier: 0,
        },
      } satisfies SelectedPlayer,
    ];
  });
};

const roundStats = (stats: TeamMatchStats): TeamMatchStats => ({
  ...stats,
  xg: Math.round(stats.xg * 100) / 100,
});

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const applyEnvironmentToStrength = (
  strength: TeamStrength,
  isHome: boolean,
  environment: MatchEnvironment,
): TeamStrength => {
  const home = isHome ? clamp(environment.homeAdvantage, 0, 1.6) : 0;
  const travelDrag = isHome
    ? 0
    : clamp(environment.altitudeImpact + environment.heatImpact, 0, 1.5) * 0.12;
  return {
    ...strength,
    attack: strength.attack + home * 0.24 - travelDrag,
    midfield: strength.midfield + home * 0.38 - travelDrag,
    defense: strength.defense + home * 0.14,
    goalkeeping: strength.goalkeeping + home * 0.06,
    setPieces: strength.setPieces + home * 0.08,
    overall: strength.overall + home * 0.22 - travelDrag,
  };
};

const applyTacticalStrength = (
  strength: TeamStrength,
  tacticalSetup?: TacticalSetup,
): TeamStrength => {
  if (!tacticalSetup) {
    return strength;
  }
  const modifiers = calculateTacticalModifiers({ setup: tacticalSetup });
  return {
    attack: strength.attack * modifiers.chanceCreation,
    midfield: strength.midfield * modifiers.control,
    defense: strength.defense * modifiers.defense,
    goalkeeping: strength.goalkeeping,
    setPieces: strength.setPieces * (1 + (modifiers.managerQuality - 10) / 220),
    cohesion: strength.cohesion * (average(Object.values(tacticalSetup.familiarity)) / 70),
    overall: strength.overall,
  };
};

const neutralTacticalModifiers = (): TacticalMatchModifiers => ({
  control: 1,
  chanceCreation: 1,
  xg: 1,
  defense: 1,
  transitionDefense: 1,
  fatigue: 1,
  possession: 1,
  discipline: 1,
  managerQuality: 10,
});

const average = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0) / values.length;
