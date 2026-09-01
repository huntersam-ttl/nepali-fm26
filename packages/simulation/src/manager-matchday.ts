import {
  ClubEconomyRepository,
  MatchSessionRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import type {
  EntityId,
  LiveMatchView,
  LivePlayerState,
  LiveTacticsCommand,
  LiveTeamView,
  MatchCommentaryLine,
  MatchRatingRow,
  MatchViewMode,
  PlayerMatchState,
  PostMatchReport,
  TacticalSetup,
} from "@nepal-football-sim/shared-types";
import { commentaryTimeline, type CommentaryLine } from "./match-commentary.js";
import {
  applyPossession,
  orderedEvents,
  type LiveMatchState,
  type RuntimeTeam,
} from "./match-engine.js";
import { FORMATION_PRESETS, TACTICAL_STYLE_PRESETS } from "./tactics.js";

type SqlRow = Record<string, any>;

const personName = (db: GameDatabase, id: EntityId): string => {
  const row = db.prepare("SELECT * FROM persons WHERE id = ?").get(id) as SqlRow | undefined;
  return (row?.display_name as string) ?? (row?.full_name as string) ?? "Unknown player";
};

const teamName = (db: GameDatabase, id: EntityId): string => {
  const row = db.prepare("SELECT name FROM teams WHERE id = ?").get(id) as SqlRow | undefined;
  return (row?.name as string) ?? "Unknown team";
};

// ---------------------------------------------------------------------------
// Live view
// ---------------------------------------------------------------------------

const playerStatus = (
  player: PlayerMatchState,
  onPitchIds: ReadonlySet<EntityId>,
): LivePlayerState["status"] => {
  if (player.redCard) return "SENT_OFF";
  if (onPitchIds.has(player.personId)) return "ON_PITCH";
  return "SUBBED_OFF";
};

const livePlayer = (
  db: GameDatabase,
  player: PlayerMatchState,
  onPitchIds: ReadonlySet<EntityId>,
): LivePlayerState => ({
  personId: player.personId,
  name: personName(db, player.personId),
  position: player.position,
  status: playerStatus(player, onPitchIds),
  minutes: Math.max(0, Math.round(player.minutesPlayed)),
  rating: Math.round(player.rating * 100) / 100,
  fitness: Math.round(player.currentFitness),
  fatigue: Math.round(player.fatigue),
  goals: player.goals,
  assists: player.assists,
  yellowCards: player.yellowCards,
  redCard: player.redCard,
  injured: Boolean(player.injuryDuringMatch),
  subbedOnMinute: player.subbedOnMinute,
  subbedOffMinute: player.subbedOffMinute,
});

const liveTeam = (
  db: GameDatabase,
  team: RuntimeTeam,
  goals: number,
  substitutionLimit: number,
): LiveTeamView => {
  const onPitchIds = new Set(team.selection.map((player) => player.personId));
  const involved = team.states.map((player) => livePlayer(db, player, onPitchIds));
  return {
    teamId: team.teamId,
    teamName: teamName(db, team.teamId),
    goals,
    possession: team.stats.possession,
    shots: team.stats.shots,
    shotsOnTarget: team.stats.shotsOnTarget,
    xg: Math.round(team.stats.xg * 100) / 100,
    corners: team.stats.corners,
    fouls: team.stats.fouls,
    yellowCards: team.stats.yellowCards,
    redCards: team.stats.redCards,
    onPitch: involved.filter((player) => player.status === "ON_PITCH"),
    bench: team.benchPlayers.map((player) => ({
      personId: player.personId,
      name: personName(db, player.personId),
      position: player.position,
      status: "BENCH" as const,
      minutes: 0,
      rating: 0,
      fitness: 100,
      fatigue: 0,
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCard: false,
      injured: false,
    })),
    playersOff: involved.filter(
      (player) => player.status === "SUBBED_OFF" || player.status === "SENT_OFF",
    ),
    substitutionsUsed: team.substitutionsUsed,
    substitutionsRemaining: Math.max(0, substitutionLimit - team.substitutionsUsed),
    playersOnPitch: team.selection.length,
    formation: team.setup?.formation.name,
    style: team.setup?.style,
    mentality: team.setup?.instructions.mentality,
  };
};

const toCommentaryLine = (line: CommentaryLine, sequence: number): MatchCommentaryLine => ({
  eventId: line.eventId,
  minute: line.minute,
  stoppageTime: line.stoppageTime,
  type: line.type,
  importance: line.importance as MatchCommentaryLine["importance"],
  teamId: line.teamId as EntityId | undefined,
  sequence,
  text: line.text,
});

/**
 * Builds the live read model. `since` acts as a cursor so a Text Live view can
 * poll for new commentary without refetching the whole timeline.
 */
export const buildLiveMatchView = (
  db: GameDatabase,
  state: LiveMatchState,
  options: {
    competitionName: string;
    managedTeamId: EntityId;
    viewMode: MatchViewMode;
    since?: number;
    finalized?: boolean;
  },
): LiveMatchView => {
  // Possession is meaningful mid-match, not only at full time.
  applyPossession(state);

  const events = orderedEvents(state);
  const lines = commentaryTimeline(events, {
    homeTeamId: String(state.homeTeamId),
    homeTeamName: teamName(db, state.homeTeamId),
    awayTeamName: teamName(db, state.awayTeamId),
    playerName: (personId) => personName(db, personId as EntityId),
  });

  const commentary = events
    .map((event, index) => ({
      sequence: Number(event.data?.sequence ?? index),
      line: lines[index]!,
    }))
    .filter((entry) => (options.since === undefined ? true : entry.sequence > options.since))
    .map((entry) => toCommentaryLine(entry.line, entry.sequence));

  const onPitchHome = new Set(state.home.selection.map((player) => player.personId));
  const onPitchAway = new Set(state.away.selection.map((player) => player.personId));
  const injuryDecisions = [
    ...state.home.states
      .filter((player) => player.injuryDuringMatch && onPitchHome.has(player.personId))
      .map((player) => livePlayer(db, player, onPitchHome)),
    ...state.away.states
      .filter((player) => player.injuryDuringMatch && onPitchAway.has(player.personId))
      .map((player) => livePlayer(db, player, onPitchAway)),
  ];

  return {
    matchId: state.matchId,
    fixtureId: state.fixtureId,
    competitionName: options.competitionName,
    period: state.period,
    minute: state.minute,
    stoppageTime: state.stoppageTime,
    pauseReason: state.pauseReason,
    viewMode: options.viewMode,
    home: liveTeam(db, state.home, state.homeGoals, state.substitutionLimit),
    away: liveTeam(db, state.away, state.awayGoals, state.substitutionLimit),
    managedTeamId: options.managedTeamId,
    commentary,
    cursor: state.eventSequence - 1,
    injuryDecisions,
    finalized: Boolean(options.finalized),
    requiresWinner: state.requiresWinner,
    aggregateFirstLeg: state.aggregateFirstLeg,
    aggregateScore: state.aggregateFirstLeg
      ? {
          home: state.homeGoals + state.aggregateFirstLeg.homeGoals,
          away: state.awayGoals + state.aggregateFirstLeg.awayGoals,
        }
      : undefined,
    shootoutHomeGoals: state.shootoutHomeGoals,
    shootoutAwayGoals: state.shootoutAwayGoals,
    winnerTeamId: state.winnerTeamId,
  };
};

/**
 * Turns a partial tactical command into a full setup, starting from what the
 * team is currently using. Only engine-supported inputs are accepted.
 */
export const applyTacticsCommand = (
  current: TacticalSetup,
  command: LiveTacticsCommand,
): TacticalSetup => {
  const formation =
    command.formationId && command.formationId !== current.formation.id
      ? FORMATION_PRESETS.find((candidate) => candidate.id === command.formationId)
      : undefined;
  const style = (command.style ?? current.style) as TacticalSetup["style"];
  const base =
    command.style && command.style !== current.style
      ? TACTICAL_STYLE_PRESETS[style as keyof typeof TACTICAL_STYLE_PRESETS]
      : current.instructions;

  return {
    ...current,
    formation: formation ?? current.formation,
    style,
    assignments:
      command.assignments ??
      (formation
        ? formation.slots.map((slot, index) => ({
            slotId: slot.id,
            playerId: current.assignments[index]?.playerId,
            roleId: current.assignments[index]?.roleId ?? "CENTRAL_MIDFIELDER",
          }))
        : current.assignments),
    instructions: {
      ...base,
      mentality: (command.mentality ?? base.mentality) as typeof base.mentality,
      inPossession: {
        ...base.inPossession,
        tempo: command.tempo ?? base.inPossession.tempo,
        passingLength: command.passingLength ?? base.inPossession.passingLength,
        width: command.width ?? base.inPossession.width,
        buildUpRisk: command.buildUpRisk ?? base.inPossession.buildUpRisk,
        playFromBack: command.playFromBack ?? base.inPossession.playFromBack,
        workBallIntoBox: command.workBallIntoBox ?? base.inPossession.workBallIntoBox,
        earlyCrosses: command.earlyCrosses ?? base.inPossession.earlyCrosses,
      },
      transition: {
        ...base.transition,
        counterPress: command.counterPress ?? base.transition.counterPress,
        regroup: command.regroup ?? base.transition.regroup,
        counter: command.counter ?? base.transition.counter,
        holdShape: command.holdShape ?? base.transition.holdShape,
        goalkeeperDistributionStyle:
          command.goalkeeperDistributionStyle ?? base.transition.goalkeeperDistributionStyle,
      },
      outOfPossession: {
        ...base.outOfPossession,
        pressingIntensity: command.pressingIntensity ?? base.outOfPossession.pressingIntensity,
        defensiveLine: command.defensiveLine ?? base.outOfPossession.defensiveLine,
        engagementLine: command.engagementLine ?? base.outOfPossession.engagementLine,
        tacklingIntensity: command.tacklingIntensity ?? base.outOfPossession.tacklingIntensity,
      },
    },
  };
};

// ---------------------------------------------------------------------------
// Post-match report
// ---------------------------------------------------------------------------

/**
 * Builds the post-match report from persisted state only. Nothing here
 * recalculates football; ratings come from `player_match_ratings`.
 */
export const buildPostMatchReport = (
  db: GameDatabase,
  fixtureId: EntityId,
  managedTeamId: EntityId,
  competitionName: string,
): PostMatchReport | undefined => {
  const match = db.prepare("SELECT * FROM matches WHERE fixture_id = ? LIMIT 1").get(fixtureId) as
    SqlRow | undefined;
  if (!match) return undefined;
  const fixture = db.prepare("SELECT * FROM fixtures WHERE id = ?").get(fixtureId) as SqlRow;

  const events = (
    db.prepare("SELECT * FROM match_events WHERE match_id = ?").all(match.id) as SqlRow[]
  )
    .map((row) => ({
      id: row.id,
      matchId: row.match_id,
      minute: row.minute ?? undefined,
      stoppageTime: row.stoppage_time ?? undefined,
      type: row.type as string,
      teamId: row.team_id ?? undefined,
      primaryPersonId: row.primary_person_id ?? undefined,
      secondaryPersonId: row.secondary_person_id ?? undefined,
      personId: row.person_id ?? undefined,
      data: row.data_json ? JSON.parse(row.data_json) : undefined,
    }))
    .sort(
      (a, b) =>
        (a.minute ?? 0) - (b.minute ?? 0) ||
        Number(a.data?.sequence ?? 0) - Number(b.data?.sequence ?? 0),
    );

  const homeTeamId = fixture.home_team_id as EntityId;
  const awayTeamId = fixture.away_team_id as EntityId;
  const homeName = teamName(db, homeTeamId);
  const awayName = teamName(db, awayTeamId);
  const nameOf = (id?: EntityId) => (id ? personName(db, id) : "Unknown player");
  const teamNameFor = (id?: EntityId) => (String(id) === String(homeTeamId) ? homeName : awayName);

  const lines = commentaryTimeline(events as never, {
    homeTeamId: String(homeTeamId),
    homeTeamName: homeName,
    awayTeamName: awayName,
    playerName: (personId) => personName(db, personId as EntityId),
  }).map((line, index) => toCommentaryLine(line, Number(events[index]?.data?.sequence ?? index)));

  const ratings = new MatchSessionRepository(db)
    .ratingsForMatch(match.id as EntityId)
    .map<MatchRatingRow>((rating) => ({
      personId: rating.playerId,
      name: personName(db, rating.playerId),
      teamId: rating.teamId,
      teamName: teamName(db, rating.teamId),
      position: rating.position,
      minutes: rating.minutes,
      rating: rating.rating,
      goals: rating.goals,
      assists: rating.assists,
      yellowCards: rating.yellowCards,
      redCard: rating.redCard,
      started: rating.started,
      subbedOnMinute: rating.subbedOnMinute,
      subbedOffMinute: rating.subbedOffMinute,
    }));

  const homeGoals = Number(match.home_goals ?? 0);
  const awayGoals = Number(match.away_goals ?? 0);
  const managedIsHome = String(managedTeamId) === String(homeTeamId);
  const own = managedIsHome ? homeGoals : awayGoals;
  const other = managedIsHome ? awayGoals : homeGoals;
  const winnerTeamId = (match.winner_team_id as EntityId | undefined) ?? undefined;
  const aggregateFirstLeg = fixture.tie_id
    ? (db
        .prepare(
          `SELECT m.home_goals AS home_goals, m.away_goals AS away_goals, f.home_team_id AS home_team_id
           FROM fixtures f JOIN matches m ON m.fixture_id = f.id
           WHERE f.tie_id = ? AND f.id != ? LIMIT 1`,
        )
        .get(fixture.tie_id, fixtureId) as SqlRow | undefined)
    : undefined;
  const firstLegHomeAwayGoals = aggregateFirstLeg
    ? String(aggregateFirstLeg.home_team_id) === String(homeTeamId)
      ? {
          homeGoals: Number(aggregateFirstLeg.home_goals ?? 0),
          awayGoals: Number(aggregateFirstLeg.away_goals ?? 0),
        }
      : {
          homeGoals: Number(aggregateFirstLeg.away_goals ?? 0),
          awayGoals: Number(aggregateFirstLeg.home_goals ?? 0),
        }
    : undefined;
  const aggregateScore = firstLegHomeAwayGoals
    ? {
        home: homeGoals + firstLegHomeAwayGoals.homeGoals,
        away: awayGoals + firstLegHomeAwayGoals.awayGoals,
      }
    : undefined;

  const teamStats = (teamId: EntityId, type: string) =>
    events.filter((event) => String(event.teamId) === String(teamId) && event.type === type).length;
  const xgFor = (teamId: EntityId) =>
    Math.round(
      events
        .filter((event) => String(event.teamId) === String(teamId) && event.type === "SHOT")
        .reduce((total, event) => total + Number(event.data?.xg ?? 0), 0) * 100,
    ) / 100;

  const ledger = new ClubEconomyRepository(db)
    .ledgerEntries()
    .filter((entry) => entry.relatedEntityId === fixtureId);

  return {
    matchId: match.id as EntityId,
    fixtureId,
    competitionName,
    venue: undefined,
    date: (match.played_date ?? fixture.scheduled_date) as string,
    homeTeamName: homeName,
    awayTeamName: awayName,
    homeGoals,
    awayGoals,
    result: winnerTeamId
      ? String(winnerTeamId) === String(managedTeamId)
        ? "W"
        : "L"
      : own > other
        ? "W"
        : own === other
          ? "D"
          : "L",
    attendance: match.attendance ?? undefined,
    wentToExtraTime: Boolean(match.went_to_extra_time),
    shootoutHomeGoals: (match.shootout_home_goals as number | undefined) ?? undefined,
    shootoutAwayGoals: (match.shootout_away_goals as number | undefined) ?? undefined,
    winnerTeamId,
    aggregateFirstLeg: firstLegHomeAwayGoals,
    aggregateScore,
    scorers: events
      .filter((event) => event.type === "GOAL")
      .map((event) => ({
        minute: event.minute,
        playerName: nameOf(event.primaryPersonId),
        teamName: teamNameFor(event.teamId),
        assist: event.secondaryPersonId ? nameOf(event.secondaryPersonId) : undefined,
      })),
    stats: {
      // Possession is stored on the persisted team stats via the match engine.
      possession: possessionFromEvents(db, match.id as EntityId, homeTeamId, awayTeamId),
      shots: { home: teamStats(homeTeamId, "SHOT"), away: teamStats(awayTeamId, "SHOT") },
      shotsOnTarget: {
        home: teamStats(homeTeamId, "SHOT_ON_TARGET"),
        away: teamStats(awayTeamId, "SHOT_ON_TARGET"),
      },
      xg: { home: xgFor(homeTeamId), away: xgFor(awayTeamId) },
      corners: { home: teamStats(homeTeamId, "CORNER"), away: teamStats(awayTeamId, "CORNER") },
      fouls: { home: teamStats(homeTeamId, "FOUL"), away: teamStats(awayTeamId, "FOUL") },
      yellowCards: {
        home: teamStats(homeTeamId, "YELLOW_CARD"),
        away: teamStats(awayTeamId, "YELLOW_CARD"),
      },
      redCards: {
        home: teamStats(homeTeamId, "RED_CARD"),
        away: teamStats(awayTeamId, "RED_CARD"),
      },
    },
    timeline: lines,
    ratings,
    playerOfTheMatch: playerOfTheMatch(ratings),
    substitutions: events
      .filter((event) => event.type === "SUBSTITUTION")
      .map((event) => ({
        minute: event.minute,
        teamName: teamNameFor(event.teamId),
        playerOn: nameOf(event.primaryPersonId),
        playerOff: nameOf(event.secondaryPersonId),
        reason: event.data?.reason as string | undefined,
      })),
    tacticalChanges: events
      .filter((event) => event.type === "TACTICAL_CHANGE")
      .map((event) => ({
        minute: event.minute,
        teamName: teamNameFor(event.teamId),
        decidedBy: String(event.data?.decidedBy ?? "MANAGER"),
        summary: summarizeTacticalChange(event.data ?? {}),
      })),
    cards: events
      .filter((event) => ["YELLOW_CARD", "RED_CARD", "SECOND_YELLOW"].includes(event.type))
      .map((event) => ({
        minute: event.minute,
        playerName: nameOf(event.primaryPersonId),
        teamName: teamNameFor(event.teamId),
        type: event.type,
      })),
    injuries: events
      .filter((event) => event.type === "INJURY")
      .map((event) => ({
        minute: event.minute,
        playerName: nameOf(event.primaryPersonId),
        teamName: teamNameFor(event.teamId),
        severity: event.data?.severity as string | undefined,
      })),
    finances: ledger.map((entry) => ({
      description: entry.description,
      amount: entry.amount,
      currency: entry.currency,
      direction: entry.direction,
    })),
  };
};

/**
 * Highest rating wins. Ties break on goals, then assists, then minutes, then
 * player id, so the result is stable rather than dependent on row order.
 */
export const playerOfTheMatch = (ratings: readonly MatchRatingRow[]): MatchRatingRow | undefined =>
  [...ratings]
    .filter((rating) => rating.minutes > 0)
    .sort(
      (a, b) =>
        b.rating - a.rating ||
        b.goals - a.goals ||
        b.assists - a.assists ||
        b.minutes - a.minutes ||
        String(a.personId).localeCompare(String(b.personId)),
    )[0];

const summarizeTacticalChange = (data: Record<string, unknown>): string => {
  const parts: string[] = [];
  if (data.formation) parts.push(`formation ${String(data.formation)}`);
  if (data.style) parts.push(`style ${String(data.style).replace(/_/g, " ").toLowerCase()}`);
  if (data.mentality) {
    parts.push(`mentality ${String(data.mentality).replace(/_/g, " ").toLowerCase()}`);
  }
  if (data.pressingIntensity !== undefined)
    parts.push(`pressing ${String(data.pressingIntensity)}`);
  if (data.defensiveLine !== undefined) parts.push(`defensive line ${String(data.defensiveLine)}`);
  if (data.tempo !== undefined) parts.push(`tempo ${String(data.tempo)}`);
  if (data.width !== undefined) parts.push(`width ${String(data.width)}`);
  if (data.passingLength !== undefined) parts.push(`passing ${String(data.passingLength)}`);
  return parts.length > 0 ? parts.join(", ") : "shape adjusted";
};

/**
 * Possession is not stored per match row, so it is recovered from the session
 * state when one still exists and falls back to an even split otherwise.
 */
const possessionFromEvents = (
  db: GameDatabase,
  matchId: EntityId,
  homeTeamId: EntityId,
  awayTeamId: EntityId,
): { home: number; away: number } => {
  const row = db
    .prepare("SELECT state_json FROM match_sessions WHERE match_id = ? LIMIT 1")
    .get(matchId) as SqlRow | undefined;
  if (row?.state_json) {
    try {
      const state = JSON.parse(row.state_json as string) as LiveMatchState;
      const home = state.home.teamId === homeTeamId ? state.home : state.away;
      const away = home === state.home ? state.away : state.home;
      if (home.stats.possession + away.stats.possession === 100) {
        return { home: home.stats.possession, away: away.stats.possession };
      }
    } catch {
      // Fall through to the neutral split below.
    }
  }
  void awayTeamId;
  return { home: 50, away: 50 };
};
