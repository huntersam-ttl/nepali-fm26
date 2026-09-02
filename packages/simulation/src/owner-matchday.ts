import type { GameDatabase } from "@nepal-football-sim/database";
import type { EntityId, FixtureRow, OwnerMatchdayView, SaveMetadata } from "@nepal-football-sim/shared-types";

export type { OwnerMatchdayView } from "@nepal-football-sim/shared-types";

const row = (db: GameDatabase, fixture: any, clubId: EntityId): FixtureRow => {
  const opponentId = fixture.home_team_id === clubId ? fixture.away_team_id : fixture.home_team_id;
  const match = db.prepare("SELECT home_goals, away_goals FROM matches WHERE fixture_id=?").get(fixture.id) as { home_goals?: number; away_goals?: number } | undefined;
  const ownGoals = fixture.home_team_id === clubId ? match?.home_goals : match?.away_goals;
  const opponentGoals = fixture.home_team_id === clubId ? match?.away_goals : match?.home_goals;
  const result = match ? ownGoals! > opponentGoals! ? "W" : ownGoals === opponentGoals ? "D" : "L" : undefined;
  const competition = db.prepare("SELECT c.name FROM competition_seasons cs JOIN competitions c ON c.id=cs.competition_id WHERE cs.id=?").get(fixture.competition_season_id) as { name?: string } | undefined;
  const opponent = db.prepare("SELECT name FROM teams WHERE id=?").get(opponentId) as { name?: string } | undefined;
  return {
    id: fixture.id,
    date: fixture.scheduled_date,
    competition: competition?.name ?? "Competition",
    opponent: opponent?.name ?? "Unknown team",
    opponentId,
    homeAway: fixture.home_team_id === clubId ? "home" : "away",
    status: fixture.status,
    score: match ? `${match.home_goals}-${match.away_goals}` : undefined,
  };
};

export const buildOwnerMatchday = (db: GameDatabase, save: SaveMetadata, clubId: EntityId): OwnerMatchdayView => {
  const club = db.prepare("SELECT name FROM clubs WHERE id=?").get(clubId) as { name?: string } | undefined;
  const team = db.prepare("SELECT id FROM teams WHERE club_id=? ORDER BY id LIMIT 1").get(clubId) as { id?: EntityId } | undefined;
  if (!club?.name || !team?.id) throw new Error("Controlled club has no senior team.");
  const fixtures = db.prepare("SELECT * FROM fixtures WHERE home_team_id=? OR away_team_id=? ORDER BY scheduled_date, id").all(team.id, team.id) as any[];
  const models = fixtures.map((fixture) => row(db, fixture, clubId));
  const upcoming = models.filter((fixture) => fixture.status === "scheduled");
  const results = models.filter((fixture) => fixture.status === "played" && fixture.date <= save.worldDate).slice(-12).reverse();
  const seasonId = fixtures.find((fixture) => fixture.status === "scheduled")?.competition_season_id ?? fixtures[0]?.competition_season_id;
  const table = seasonId ? db.prepare("SELECT played, points FROM league_standings WHERE competition_season_id=? AND team_id=?").get(seasonId, team.id) as { played?: number; points?: number } | undefined : undefined;
  const standingRows = seasonId ? db.prepare("SELECT team_id FROM league_standings WHERE competition_season_id=? ORDER BY points DESC, team_id").all(seasonId) as Array<{ team_id: EntityId }> : [];
  const position = standingRows.findIndex((standing) => standing.team_id === team.id) + 1;
  return { clubId, clubName: club.name, teamId: team.id, upcoming, results, currentFixtureId: upcoming[0]?.id, positionContext: position > 0 && table ? { position, played: table.played ?? 0, points: table.points ?? 0 } : undefined };
};
