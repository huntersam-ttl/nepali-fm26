import type { GameDatabase } from "@nepal-football-sim/database";
import type { CompetitionRuleSet, EntityId, LeagueStanding, MatchResult } from "@nepal-football-sim/shared-types";
import { CompetitionRepository } from "@nepal-football-sim/database";
import { calculateStandings, summarizeTeamStats } from "./standings.js";

/**
 * Every played match of a competition season as the goals-and-teams result the
 * table needs, read from what is stored. A table built from these is always the
 * whole season's table, whichever matches were played by whom, in what order.
 */
export function matchResultsForStandings(db: GameDatabase, competitionSeasonId: EntityId): MatchResult[] {
  return db
    .prepare(
      `SELECT m.*, f.home_team_id, f.away_team_id
      FROM matches m
      JOIN fixtures f ON f.id = m.fixture_id
      WHERE f.competition_season_id = ?
      ORDER BY f.scheduled_date, f.round, f.id`,
    )
    .all(competitionSeasonId)
    .map((row: any) => ({
      match: {
        id: row.id,
        fixtureId: row.fixture_id,
        playedDate: row.played_date ?? undefined,
        homeGoals: row.home_goals,
        awayGoals: row.away_goals,
      },
      events: [],
      homeStats: {
        teamId: row.home_team_id,
        goals: row.home_goals,
        shots: 0,
        shotsOnTarget: 0,
        xg: 0,
        possession: 50,
        corners: 0,
        fouls: 0,
        yellowCards: 0,
        redCards: 0,
        passesCompleted: 0,
        saves: 0,
      },
      awayStats: {
        teamId: row.away_team_id,
        goals: row.away_goals,
        shots: 0,
        shotsOnTarget: 0,
        xg: 0,
        possession: 50,
        corners: 0,
        fouls: 0,
        yellowCards: 0,
        redCards: 0,
        passesCompleted: 0,
        saves: 0,
      },
      playerStates: [],
    }));
}

/** Rebuilds and stores the season's table (and team stats) from every stored match. */
export const recomputeSeasonStandings = (
  db: GameDatabase,
  input: { competitionSeasonId: EntityId; teamIds: readonly EntityId[]; ruleSet: CompetitionRuleSet },
): LeagueStanding[] => {
  const competitions = new CompetitionRepository(db);
  const standings = calculateStandings({
    competitionSeasonId: input.competitionSeasonId,
    teamIds: input.teamIds,
    ruleSet: input.ruleSet,
    results: matchResultsForStandings(db, input.competitionSeasonId),
  });
  for (const standing of standings) competitions.upsertStanding(standing);
  for (const stat of summarizeTeamStats(input.competitionSeasonId, standings)) competitions.upsertTeamSeasonStat(stat);
  return standings;
};

/** Adds one match's player line to the season and career totals rather than replacing them. */
export const accumulatePlayerStat = (
  db: GameDatabase,
  stat: {
    competitionSeasonId: EntityId;
    personId: EntityId;
    teamId: EntityId;
    appearances: number;
    starts: number;
    minutes: number;
    goals: number;
    assists: number;
    yellowCards: number;
    redCards: number;
    averageRating: number;
    cleanSheets: number;
  },
): void => {
  const known =
    db.prepare("SELECT 1 FROM persons WHERE id = ?").get(stat.personId) &&
    db.prepare("SELECT 1 FROM teams WHERE id = ?").get(stat.teamId);
  if (!known) return;
  const row = db
    .prepare("SELECT * FROM player_season_stats WHERE competition_season_id = ? AND person_id = ? AND team_id = ?")
    .get(stat.competitionSeasonId, stat.personId, stat.teamId) as any;
  const competitions = new CompetitionRepository(db);
  if (!row) {
    competitions.upsertPlayerSeasonStat(stat);
  } else {
    const appearances = row.appearances + stat.appearances;
    competitions.upsertPlayerSeasonStat({
      ...stat,
      appearances,
      starts: row.starts + stat.starts,
      minutes: row.minutes + stat.minutes,
      goals: row.goals + stat.goals,
      assists: row.assists + stat.assists,
      yellowCards: row.yellow_cards + stat.yellowCards,
      redCards: row.red_cards + stat.redCards,
      cleanSheets: row.clean_sheets + stat.cleanSheets,
      averageRating: Math.round(((row.average_rating * row.appearances + stat.averageRating * stat.appearances) / Math.max(1, appearances)) * 100) / 100,
    });
  }
  db.prepare(
    `INSERT INTO player_career_stats
    (person_id, team_id, appearances, starts, minutes, goals, assists, yellow_cards, red_cards, clean_sheets)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(person_id, team_id) DO UPDATE SET
      appearances = appearances + excluded.appearances,
      starts = starts + excluded.starts,
      minutes = minutes + excluded.minutes,
      goals = goals + excluded.goals,
      assists = assists + excluded.assists,
      yellow_cards = yellow_cards + excluded.yellow_cards,
      red_cards = red_cards + excluded.red_cards,
      clean_sheets = clean_sheets + excluded.clean_sheets`,
  ).run(
    stat.personId,
    stat.teamId,
    stat.appearances,
    stat.starts,
    stat.minutes,
    stat.goals,
    stat.assists,
    stat.yellowCards,
    stat.redCards,
    stat.cleanSheets,
  );
};
