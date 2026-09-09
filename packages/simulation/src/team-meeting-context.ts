import { CompetitionRepository, SquadDynamicsRepository, type GameDatabase } from "@nepal-football-sim/database";
import type {
  EntityId,
  TeamMeetingContext,
  TeamMeetingContextType,
  TeamMeetingMessage,
} from "@nepal-football-sim/shared-types";

type SqlRow = Record<string, any>;

const daysBetween = (from: string, to: string): number =>
  Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);

/**
 * Every message option a team meeting can offer, grouped by the context it
 * genuinely fits — used both to populate the real available choices for a
 * triggered context and to score how well a chosen message actually
 * matches it (a "GOOD" fit still isn't a guaranteed positive outcome; a
 * "POOR" one still isn't automatic failure — see holdSquadMeeting).
 */
const MESSAGES_FOR_CONTEXT: Record<TeamMeetingContextType, TeamMeetingMessage[]> = {
  POOR_RUN: [
    { id: "CHALLENGE", label: "Challenge the squad", description: "Set a higher standard and expect a response.", fit: "GOOD" },
    { id: "REASSURE", label: "Reassure", description: "Keep calm — this will turn.", fit: "NEUTRAL" },
    { id: "DEMAND_FOCUS", label: "Demand focus", description: "Cut out the mistakes that are costing points.", fit: "GOOD" },
  ],
  TITLE_PUSH: [
    { id: "KEEP_PRESSURE_OFF", label: "Keep the pressure off", description: "Play it down publicly and privately.", fit: "GOOD" },
    { id: "EMBRACE_OPPORTUNITY", label: "Embrace the opportunity", description: "Tell them this is what they've worked for.", fit: "GOOD" },
    { id: "DEMAND_STANDARDS", label: "Demand standards", description: "No complacency now.", fit: "NEUTRAL" },
  ],
  RELEGATION_PRESSURE: [
    { id: "RALLY_TOGETHER", label: "Rally together", description: "We fight this as one squad.", fit: "GOOD" },
    { id: "BE_DIRECT", label: "Be direct about the danger", description: "Make the stakes completely clear.", fit: "NEUTRAL" },
    { id: "ONE_MATCH_AT_A_TIME", label: "One match at a time", description: "Narrow the focus to what's controllable.", fit: "GOOD" },
  ],
  BIG_MATCH: [
    { id: "INSPIRE", label: "Inspire the squad", description: "Make them believe this is their moment.", fit: "GOOD" },
    { id: "CALM_NERVES", label: "Calm the nerves", description: "Treat it like any other match.", fit: "GOOD" },
    { id: "DEMAND_DISCIPLINE", label: "Demand discipline", description: "Emphasise the game plan above all else.", fit: "NEUTRAL" },
  ],
  DRESSING_ROOM_TENSION: [
    { id: "CONFRONT_ISSUE", label: "Confront the issue", description: "Address it directly, in the room.", fit: "GOOD" },
    { id: "BACK_LEADERSHIP", label: "Back the leadership group", description: "Publicly back your captain and senior players.", fit: "GOOD" },
    { id: "RESET_EXPECTATIONS", label: "Reset expectations", description: "Restate what you expect from everyone.", fit: "NEUTRAL" },
  ],
  SEASON_OPENING: [
    { id: "ESTABLISH_STANDARDS", label: "Establish standards", description: "Set out how this team will work.", fit: "GOOD" },
    { id: "EMPHASIZE_UNITY", label: "Emphasise unity", description: "One squad, one goal.", fit: "GOOD" },
    { id: "SET_OBJECTIVES", label: "Set objectives", description: "Be explicit about the season's targets.", fit: "NEUTRAL" },
  ],
  SEASON_CLOSING: [
    { id: "FINAL_PUSH", label: "Call for a final push", description: "Everything left on the pitch.", fit: "GOOD" },
    { id: "PROTECT_CONFIDENCE", label: "Protect confidence", description: "Keep spirits up regardless of the run-in.", fit: "NEUTRAL" },
    { id: "DEMAND_PROFESSIONALISM", label: "Demand professionalism", description: "See the season out the right way.", fit: "GOOD" },
  ],
};

const recentResults = (db: GameDatabase, competitionSeasonId: EntityId, teamId: EntityId, limit = 6): ("W" | "D" | "L")[] => {
  const rows = db
    .prepare(
      `SELECT f.home_team_id AS homeTeamId, m.home_goals AS homeGoals, m.away_goals AS awayGoals
       FROM fixtures f JOIN matches m ON m.fixture_id = f.id
       WHERE f.competition_season_id = ? AND f.status = 'played'
         AND (f.home_team_id = ? OR f.away_team_id = ?)
       ORDER BY f.scheduled_date DESC LIMIT ?`,
    )
    .all(competitionSeasonId, teamId, teamId, limit) as SqlRow[];
  return rows
    .filter((row) => row.homeGoals !== null && row.awayGoals !== null)
    .map((row) => {
      const isHome = row.homeTeamId === teamId;
      const goalsFor = isHome ? row.homeGoals : row.awayGoals;
      const goalsAgainst = isHome ? row.awayGoals : row.homeGoals;
      return goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
    });
};

/**
 * The real, currently-warranted reason (if any) to hold a team meeting —
 * exactly one, the single most urgent, never an arbitrary UI-side choice.
 * Every signal is generic (works for any competition/club, foreign or
 * domestic) and derived from actual persisted state: recent results, table
 * position relative to however many teams are actually in the competition,
 * squad-dynamics cohesion/concerns/disputes, or the season calendar.
 */
/**
 * The team's own primary league campaign right now — picked as whichever of
 * its active competition memberships has actually played the most matches,
 * a reasonable proxy for "the main league" versus a cup run with far fewer
 * fixtures, without hardcoding any specific competition name.
 */
const primarySeasonFor = (db: GameDatabase, teamId: EntityId): EntityId | undefined => {
  const rows = db
    .prepare(
      `SELECT DISTINCT cm.competition_season_id AS seasonId FROM club_memberships cm
       WHERE cm.team_id = ? AND cm.status NOT IN ('WITHDRAWN', 'SUSPENDED', 'INELIGIBLE')`,
    )
    .all(teamId) as Array<{ seasonId: EntityId }>;
  if (rows.length === 0) return undefined;
  let best: { seasonId: EntityId; played: number } | undefined;
  for (const row of rows) {
    const standing = db
      .prepare("SELECT played FROM league_standings WHERE competition_season_id = ? AND team_id = ?")
      .get(row.seasonId, teamId) as { played: number } | undefined;
    const played = standing?.played ?? 0;
    if (!best || played > best.played) best = { seasonId: row.seasonId, played };
  }
  return best?.seasonId;
};

export const evaluateTeamMeetingContext = (
  db: GameDatabase,
  worldDate: string,
  teamId: EntityId,
): TeamMeetingContext | undefined => {
  const dynamics = new SquadDynamicsRepository(db);
  const cohesion = dynamics.cohesion(teamId);
  const openConcerns = dynamics.concernsForTeam(teamId).filter((c) => c.status !== "RESOLVED");
  const openDisputes = dynamics.openDisputesForTeam(teamId);

  // DRESSING_ROOM_TENSION takes priority — an unhappy squad undermines
  // every other message before it's addressed.
  if (cohesion && (["SHAKY", "POOR", "CRITICAL"].includes(cohesion.level) || cohesion.topIssue)) {
    const evidence = [
      `Squad cohesion is ${cohesion.level.toLowerCase()} (${cohesion.score}/100).`,
      ...(cohesion.topIssue ? [cohesion.topIssue] : []),
      ...(openConcerns.length > 0 ? [`${openConcerns.length} unresolved concern(s) in the squad.`] : []),
      ...(openDisputes.length > 0 ? [`${openDisputes.length} open dispute(s).`] : []),
    ];
    return {
      type: "DRESSING_ROOM_TENSION",
      urgency: cohesion.level === "CRITICAL" ? 9 : cohesion.level === "POOR" ? 7 : 5,
      evidence,
      messages: MESSAGES_FOR_CONTEXT.DRESSING_ROOM_TENSION,
    };
  }

  const competitionSeasonId = primarySeasonFor(db, teamId);
  if (!competitionSeasonId) return undefined;
  const standings = new CompetitionRepository(db).standings(competitionSeasonId);
  const sorted = [...standings].sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference);
  const teamCount = sorted.length;
  const position = sorted.findIndex((row) => row.teamId === teamId) + 1;
  const own = position > 0 ? sorted[position - 1] : undefined;

  // A meaningful run needs a real sample — never a single result.
  const form = own ? recentResults(db, competitionSeasonId, teamId) : [];
  if (form.length >= 5) {
    const wins = form.filter((r) => r === "W").length;
    const losses = form.filter((r) => r === "L").length;
    if (losses >= 3 && wins === 0) {
      return {
        type: "POOR_RUN",
        urgency: 7,
        evidence: [`${losses} defeats in the last ${form.length} matches, with no wins.`],
        messages: MESSAGES_FOR_CONTEXT.POOR_RUN,
      };
    }
  }

  const ruleSet = new CompetitionRepository(db).getRuleSet(competitionSeasonId);
  if (ruleSet) {
    const daysIntoSeason = daysBetween(ruleSet.seasonStartDate, worldDate);
    const daysToSeasonEnd = daysBetween(worldDate, ruleSet.seasonEndDate);
    if (daysIntoSeason >= 0 && daysIntoSeason <= 14) {
      return {
        type: "SEASON_OPENING",
        urgency: 3,
        evidence: [`The season began ${daysIntoSeason} day(s) ago.`],
        messages: MESSAGES_FOR_CONTEXT.SEASON_OPENING,
      };
    }
    if (daysToSeasonEnd >= 0 && daysToSeasonEnd <= 14 && (own?.played ?? 0) > 0) {
      return {
        type: "SEASON_CLOSING",
        urgency: 4,
        evidence: [`${daysToSeasonEnd} day(s) remain before the season ends.`],
        messages: MESSAGES_FOR_CONTEXT.SEASON_CLOSING,
      };
    }
  }

  // Title/relegation zones are relative to however many teams are actually
  // in THIS competition — never a fixed number, and never keyed to a
  // specific club's reputation.
  if (teamCount >= 6 && position > 0 && own) {
    const titleZone = Math.max(1, Math.ceil(teamCount * 0.15));
    const relegationZone = Math.max(1, Math.ceil(teamCount * 0.15));
    const leader = sorted[0]!;
    const pointsBehindLeader = leader.points - own.points;
    if (position <= titleZone && pointsBehindLeader <= 6) {
      return {
        type: "TITLE_PUSH",
        urgency: 6,
        evidence: [`${position}${position === 1 ? "st" : position === 2 ? "nd" : position === 3 ? "rd" : "th"} of ${teamCount}, ${pointsBehindLeader} point(s) off top.`],
        messages: MESSAGES_FOR_CONTEXT.TITLE_PUSH,
      };
    }
    if (position > teamCount - relegationZone) {
      return {
        type: "RELEGATION_PRESSURE",
        urgency: 8,
        evidence: [`${position}${position === 1 ? "st" : position === 2 ? "nd" : position === 3 ? "rd" : "th"} of ${teamCount} — inside the relegation zone.`],
        messages: MESSAGES_FOR_CONTEXT.RELEGATION_PRESSURE,
      };
    }
  }

  // BIG_MATCH: the next fixture carries real table-position stakes for
  // either side — a genuine signal from the same data above, not a
  // separate rivalry/knockout model this pass doesn't have reliable
  // access to (documented limitation: cup finals/knockout-stage
  // significance are not detected here yet).
  if (teamCount >= 6 && position > 0) {
    const next = db
      .prepare(
        `SELECT home_team_id AS homeTeamId, away_team_id AS awayTeamId FROM fixtures
         WHERE competition_season_id = ? AND status = 'scheduled' AND (home_team_id = ? OR away_team_id = ?)
         ORDER BY scheduled_date ASC LIMIT 1`,
      )
      .get(competitionSeasonId, teamId, teamId) as SqlRow | undefined;
    if (next) {
      const opponentId = next.homeTeamId === teamId ? next.awayTeamId : next.homeTeamId;
      const opponentPosition = sorted.findIndex((row) => row.teamId === opponentId) + 1;
      const zone = Math.max(1, Math.ceil(teamCount * 0.15));
      const bothInZone =
        (position <= zone || position > teamCount - zone) &&
        (opponentPosition <= zone || opponentPosition > teamCount - zone);
      if (bothInZone) {
        return {
          type: "BIG_MATCH",
          urgency: 6,
          evidence: ["The next fixture carries real table-position stakes for both sides."],
          messages: MESSAGES_FOR_CONTEXT.BIG_MATCH,
        };
      }
    }
  }

  return undefined;
};
