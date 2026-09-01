import type {
  EntityId,
  MatchAnalyticsSnapshot,
  TeamAnalyticsSummary,
} from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "@nepal-football-sim/database";

type SqlRow = Record<string, any>;

const SUPPORTED_METRICS = [
  "goals",
  "shots",
  "shotsOnTarget",
  "xg",
  "corners",
  "fouls",
  "yellowCards",
  "redCards",
  "playerMinutes",
  "playerRatings",
  "playerGoals",
  "playerAssists",
  "keyPasses",
  "passesAttempted",
  "passesCompleted",
  "tackles",
  "interceptions",
  "saves",
] as const;

const DEFERRED_METRICS = [
  "possession",
  "progressivePasses",
  "pressures",
  "defensiveLineHeight",
  "zoneMaps",
  "expectedAssists",
  "carryDistance",
] as const;

/** Build an analytics snapshot from the canonical persisted event and rating tables. */
export const matchAnalytics = (
  db: GameDatabase,
  matchId: EntityId,
): MatchAnalyticsSnapshot | undefined => {
  const match = db
    .prepare(
      `SELECT m.id AS match_id, m.fixture_id, m.played_date,
              f.home_team_id, f.away_team_id
       FROM matches m JOIN fixtures f ON f.id = m.fixture_id
       WHERE m.id = ?`,
    )
    .get(matchId) as SqlRow | undefined;
  if (!match) return undefined;

  const teams = new Map<EntityId, MatchAnalyticsSnapshot["teams"][number]>(
    [match.home_team_id, match.away_team_id].map((teamId) => [
      teamId,
      {
        teamId,
        goals: 0,
        shots: 0,
        shotsOnTarget: 0,
        xg: 0,
        corners: 0,
        fouls: 0,
        yellowCards: 0,
        redCards: 0,
      },
    ]),
  );
  const events = db
    .prepare("SELECT * FROM match_events WHERE match_id = ? ORDER BY minute, id")
    .all(matchId) as SqlRow[];
  for (const event of events) {
    const team = event.team_id ? teams.get(event.team_id) : undefined;
    if (!team) continue;
    if (event.type === "GOAL" || event.type === "OWN_GOAL") team.goals += 1;
    if (event.type === "SHOT") team.shots += 1;
    if (event.type === "SHOT_ON_TARGET") team.shotsOnTarget += 1;
    if (event.type === "CORNER") team.corners += 1;
    if (event.type === "FOUL") team.fouls += 1;
    if (event.type === "YELLOW_CARD") team.yellowCards += 1;
    if (event.type === "RED_CARD") team.redCards += 1;
    if (event.data_json) {
      const data = JSON.parse(event.data_json) as { xg?: unknown };
      if (event.type === "SHOT" && typeof data.xg === "number") team.xg += data.xg;
    }
  }
  const playerLines = (
    db
      .prepare(
        "SELECT * FROM player_match_ratings WHERE match_id = ? ORDER BY rating DESC, player_id",
      )
      .all(matchId) as SqlRow[]
  ).map((row) => ({
    playerId: row.player_id,
    teamId: row.team_id,
    minutes: row.minutes,
    rating: row.rating,
    goals: row.goals,
    assists: row.assists,
    shots: row.shots,
    shotsOnTarget: row.shots_on_target,
    keyPasses: row.key_passes,
    passesAttempted: row.passes_attempted,
    passesCompleted: row.passes_completed,
    tackles: row.tackles,
    interceptions: row.interceptions,
    saves: row.saves,
    yellowCards: row.yellow_cards,
    redCard: Boolean(row.red_card),
  }));
  return {
    matchId,
    fixtureId: match.fixture_id,
    playedDate: match.played_date ?? undefined,
    teams: [...teams.values()],
    playerLines,
    supportedMetrics: SUPPORTED_METRICS,
    deferredMetrics: DEFERRED_METRICS,
  };
};

/** Aggregate only persisted match facts for one team and competition season. */
export const teamAnalyticsForSeason = (
  db: GameDatabase,
  competitionSeasonId: EntityId,
  teamId: EntityId,
): TeamAnalyticsSummary => {
  const matches = db
    .prepare(
      `SELECT m.id FROM matches m JOIN fixtures f ON f.id = m.fixture_id
     WHERE f.competition_season_id = ? AND (f.home_team_id = ? OR f.away_team_id = ?)
     ORDER BY m.id`,
    )
    .all(competitionSeasonId, teamId, teamId) as SqlRow[];
  const totals = {
    matches: 0,
    goals: 0,
    shots: 0,
    shotsOnTarget: 0,
    xg: 0,
    corners: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    ratingTotal: 0,
    ratedMinutes: 0,
  };
  for (const row of matches) {
    const snapshot = matchAnalytics(db, row.id);
    const team = snapshot?.teams.find((item) => item.teamId === teamId);
    if (!team) continue;
    totals.matches += 1;
    totals.goals += team.goals;
    totals.shots += team.shots;
    totals.shotsOnTarget += team.shotsOnTarget;
    totals.xg += team.xg;
    totals.corners += team.corners;
    totals.fouls += team.fouls;
    totals.yellowCards += team.yellowCards;
    totals.redCards += team.redCards;
    for (const line of snapshot?.playerLines.filter((item) => item.teamId === teamId) ?? []) {
      totals.ratingTotal += line.rating * line.minutes;
      totals.ratedMinutes += line.minutes;
    }
  }
  return {
    competitionSeasonId,
    teamId,
    ...totals,
    averageRating:
      totals.ratedMinutes > 0
        ? Math.round((totals.ratingTotal / totals.ratedMinutes) * 100) / 100
        : 0,
  };
};
