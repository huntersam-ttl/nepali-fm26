import { UniversalInteractionRepository, type GameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Save-growth policy (see docs/save-growth-policy.md). Storage only: nothing
 * here changes what happens in a match, a table, a transfer or a season.
 */

/** Event types whose per-event rows are compacted for old, background matches. */
export const COMPACTED_EVENT_TYPES = ["FOUL", "SHOT", "SHOT_ON_TARGET", "SAVE", "FREE_KICK", "CORNER"] as const;

export const MATCH_EVENT_COMPACTION_POLICY = "AI_MATCH_DETAIL_V1";

export interface TeamMatchSummary {
  teamId: EntityId;
  goals: number;
  shots: number;
  shotsOnTarget: number;
  xg: number;
  corners: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  freeKicks: number;
  saves: number;
}

/**
 * The stored team totals for a match whose verbose events were compacted, or
 * undefined when the match still has its full event log. Statistic readers use
 * these in place of counting the removed events.
 */
export const compactedTeamSummaries = (db: GameDatabase, matchId: EntityId): Map<EntityId, TeamMatchSummary> | undefined => {
  const marker = db.prepare("SELECT 1 AS present FROM match_event_compactions WHERE match_id = ?").get(matchId);
  if (!marker) return undefined;
  const rows = db.prepare("SELECT * FROM match_team_summaries WHERE match_id = ?").all(matchId) as Array<Record<string, number | string>>;
  return new Map(
    rows.map((row) => [
      row.team_id as EntityId,
      {
        teamId: row.team_id as EntityId,
        goals: Number(row.goals),
        shots: Number(row.shots),
        shotsOnTarget: Number(row.shots_on_target),
        xg: Number(row.xg),
        corners: Number(row.corners),
        fouls: Number(row.fouls),
        yellowCards: Number(row.yellow_cards),
        redCards: Number(row.red_cards),
        freeKicks: Number(row.free_kicks),
        saves: Number(row.saves),
      },
    ]),
  );
};

/**
 * Clubs any career the human has held is tied to: managed, owned, or on their
 * career timeline. Their matches keep full detail for as long as the save lives.
 */
const humanRelevantClubIds = (db: GameDatabase): EntityId[] => {
  const rows = db
    .prepare(
      `SELECT DISTINCT club_id AS id FROM (
         SELECT mc.club_id AS club_id FROM manager_contracts mc
           WHERE mc.person_id IN (SELECT person_id FROM career_characters)
         UNION ALL
         SELECT t.club_id FROM manager_contracts mc JOIN teams t ON t.id = mc.team_id
           WHERE mc.person_id IN (SELECT person_id FROM career_characters)
         UNION ALL
         SELECT s.club_id FROM club_ownership_stakes s
           WHERE s.holder_type = 'PERSON' AND s.holder_id IN (SELECT person_id FROM career_characters)
         UNION ALL
         SELECT e.club_id FROM career_timeline_events e
           WHERE e.person_id IN (SELECT person_id FROM career_characters)
       ) WHERE club_id IS NOT NULL`,
    )
    .all() as Array<{ id: EntityId }>;
  return rows.map((row) => row.id);
};

export interface CompactionResult {
  matchesCompacted: number;
  eventsRemoved: number;
}

const RESOLVED_INTERACTION_STAGES = "'ACCEPTED','REJECTED','WALKED_AWAY','COMPLETED','CANCELLED'";

/**
 * Removes resolved manager-interview records of background candidates once they are
 * more than a year old. Interviews are re-run whenever a vacancy is open, so they are
 * the largest source of growth after match events (about 10 MB a season), and nothing
 * reads an old one: the only lookup is "did this person already interview for this
 * vacancy on this date", and the decision itself lives on in manager_job_applications.
 *
 * Kept: any interview of a person the human plays, at a club the human has managed,
 * owned or held a role at, or whose candidate still holds an offer or accepted job for
 * that vacancy. Returns how many interviews were removed. Running it again does nothing further.
 */
export const compactResolvedInterviews = (db: GameDatabase, date: string): number => {
  new UniversalInteractionRepository(db);
  const clubs = humanRelevantClubIds(db);
  const clubList = clubs.length > 0 ? clubs.map(() => "?").join(",") : "NULL";
  const doomed = `
    interaction_type = 'MANAGER_INTERVIEW'
    AND json_extract(data_json, '$.stage') IN (${RESOLVED_INTERACTION_STAGES})
    AND json_extract(data_json, '$.worldDate') < date(?, '-1 year')
    AND COALESCE(json_extract(data_json, '$.initiator.entityId'), '') NOT IN (SELECT person_id FROM career_characters)
    AND COALESCE(json_extract(data_json, '$.organisationId'), '') NOT IN (${clubList})
    AND NOT EXISTS (
      SELECT 1 FROM manager_job_applications a
      WHERE a.vacancy_id = universal_interactions.linked_id
        AND a.person_id = json_extract(universal_interactions.data_json, '$.initiator.entityId')
        AND a.status IN ('OFFERED', 'ACCEPTED'))`;
  const params = [date, ...clubs];
  db.exec("CREATE TEMP TABLE IF NOT EXISTS doomed_interactions (id TEXT PRIMARY KEY); DELETE FROM doomed_interactions;");
  db.prepare(`INSERT OR IGNORE INTO doomed_interactions SELECT id FROM universal_interactions WHERE ${doomed}`).run(...params);
  db.exec("DELETE FROM interaction_memories WHERE json_extract(data_json, '$.interactionId') IN (SELECT id FROM doomed_interactions);");
  const removed = Number((db.prepare("SELECT COUNT(*) AS n FROM doomed_interactions").get() as { n: number }).n);
  db.exec("DELETE FROM universal_interactions WHERE id IN (SELECT id FROM doomed_interactions); DROP TABLE doomed_interactions;");
  return removed;
};

const CHUNK = 400;

/**
 * Compacts the verbose events of old background matches.
 *
 * A match qualifies when all of these hold:
 *  - its competition season is rolled over AND a later season of the same
 *    competition is also rolled over (the latest finished season keeps full detail);
 *  - neither team belongs to a club the human has managed, owned or held a role at;
 *  - it was not played through a live session.
 *
 * Goals, assists, cards, substitutions, injuries, penalties and period markers are
 * always kept. Fouls, shots, shots on target, saves, free kicks and corners are
 * replaced by one totals row per team. Running it again does nothing further.
 */
export const compactOldMatchEvents = (db: GameDatabase, date: string): CompactionResult => {
  const protectedClubs = humanRelevantClubIds(db);
  const clubList = protectedClubs.length > 0 ? protectedClubs.map(() => "?").join(",") : "NULL";
  const candidates = db
    .prepare(
      `SELECT m.id AS id FROM matches m
       JOIN fixtures f ON f.id = m.fixture_id
       JOIN competition_seasons cs ON cs.id = f.competition_season_id
       JOIN competition_season_states st ON st.competition_season_id = cs.id AND st.status = 'ROLLED_OVER'
       WHERE EXISTS (
               SELECT 1 FROM competition_seasons later
               JOIN competition_season_states lst ON lst.competition_season_id = later.id AND lst.status = 'ROLLED_OVER'
               WHERE later.competition_id = cs.competition_id AND later.end_date > cs.end_date)
         AND NOT EXISTS (SELECT 1 FROM match_event_compactions c WHERE c.match_id = m.id)
         AND NOT EXISTS (SELECT 1 FROM match_sessions s WHERE s.match_id = m.id)
         AND NOT EXISTS (
               SELECT 1 FROM teams t
               WHERE t.id IN (f.home_team_id, f.away_team_id) AND t.club_id IN (${clubList}))
       ORDER BY m.id`,
    )
    .all(...protectedClubs) as Array<{ id: EntityId }>;

  const types = COMPACTED_EVENT_TYPES.map((type) => `'${type}'`).join(",");
  let matchesCompacted = 0;
  let eventsRemoved = 0;
  for (let offset = 0; offset < candidates.length; offset += CHUNK) {
    const ids = candidates.slice(offset, offset + CHUNK).map((row) => row.id);
    const marks = ids.map(() => "?").join(",");
    db.prepare(
      `INSERT OR REPLACE INTO match_team_summaries
         (match_id, team_id, goals, shots, shots_on_target, xg, corners, fouls, yellow_cards, red_cards, free_kicks, saves)
       SELECT match_id, team_id,
         SUM(type IN ('GOAL','OWN_GOAL')),
         SUM(type = 'SHOT'),
         SUM(type = 'SHOT_ON_TARGET'),
         0,
         SUM(type = 'CORNER'),
         SUM(type = 'FOUL'),
         SUM(type = 'YELLOW_CARD'),
         SUM(type = 'RED_CARD'),
         SUM(type = 'FREE_KICK'),
         SUM(type = 'SAVE')
       FROM match_events WHERE match_id IN (${marks}) AND team_id IS NOT NULL
       GROUP BY match_id, team_id`,
    ).run(...ids);
    // xG is summed in the same order the readers sum it (minute, id) so the stored
    // total is bit-identical to what counting the events would have produced.
    const xg = new Map<string, number>();
    for (const shot of db
      .prepare(
        `SELECT match_id, team_id, data_json FROM match_events
         WHERE match_id IN (${marks}) AND type = 'SHOT' AND team_id IS NOT NULL AND data_json IS NOT NULL
         ORDER BY match_id, minute, id`,
      )
      .all(...ids) as Array<{ match_id: string; team_id: string; data_json: string }>) {
      const value = (JSON.parse(shot.data_json) as { xg?: unknown }).xg;
      if (typeof value === "number") xg.set(`${shot.match_id}|${shot.team_id}`, (xg.get(`${shot.match_id}|${shot.team_id}`) ?? 0) + value);
    }
    const setXg = db.prepare("UPDATE match_team_summaries SET xg = ? WHERE match_id = ? AND team_id = ?");
    for (const [key, value] of xg) {
      const [matchId, teamId] = key.split("|") as [string, string];
      setXg.run(value, matchId, teamId);
    }
    const counts = db
      .prepare(
        `SELECT match_id AS id, COUNT(*) AS total, SUM(type IN (${types})) AS removable
         FROM match_events WHERE match_id IN (${marks}) GROUP BY match_id`,
      )
      .all(...ids) as Array<{ id: EntityId; total: number; removable: number }>;
    const byMatch = new Map(counts.map((row) => [row.id, row]));
    db.prepare(`DELETE FROM match_events WHERE match_id IN (${marks}) AND type IN (${types})`).run(...ids);
    const mark = db.prepare(
      "INSERT OR IGNORE INTO match_event_compactions (match_id, compacted_on, events_before, events_removed, policy) VALUES (?, ?, ?, ?, ?)",
    );
    for (const id of ids) {
      const row = byMatch.get(id);
      mark.run(id, date, Number(row?.total ?? 0), Number(row?.removable ?? 0), MATCH_EVENT_COMPACTION_POLICY);
      eventsRemoved += Number(row?.removable ?? 0);
      matchesCompacted += 1;
    }
  }
  return { matchesCompacted, eventsRemoved };
};
