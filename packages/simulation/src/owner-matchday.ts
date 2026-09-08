import type { GameDatabase } from "@nepal-football-sim/database";
import type { EntityId, FixtureRow, OwnerMatchdayView, SaveMetadata } from "@nepal-football-sim/shared-types";
import { venueForFixture } from "./manager-desktop.js";

export type { OwnerMatchdayView } from "@nepal-football-sim/shared-types";

/**
 * `teamId` here must be the resolved fixture-playing TEAM id (the same id
 * `fixtures.home_team_id`/`away_team_id` use), never the club id — the two
 * are different rows entirely, so comparing a team column against a club id
 * silently always takes the "away" branch, making every fixture (including
 * genuine home fixtures) report the wrong opponent and the wrong
 * home/away side.
 */
const row = (db: GameDatabase, fixture: any, teamId: EntityId): FixtureRow => {
  const isHome = fixture.home_team_id === teamId;
  const opponentId = isHome ? fixture.away_team_id : fixture.home_team_id;
  const match = db.prepare("SELECT home_goals, away_goals FROM matches WHERE fixture_id=?").get(fixture.id) as { home_goals?: number; away_goals?: number } | undefined;
  const ownGoals = isHome ? match?.home_goals : match?.away_goals;
  const opponentGoals = isHome ? match?.away_goals : match?.home_goals;
  const result = match ? ownGoals! > opponentGoals! ? "W" : ownGoals === opponentGoals ? "D" : "L" : undefined;
  const competition = db.prepare("SELECT c.name FROM competition_seasons cs JOIN competitions c ON c.id=cs.competition_id WHERE cs.id=?").get(fixture.competition_season_id) as { name?: string } | undefined;
  const opponent = db.prepare("SELECT name FROM teams WHERE id=?").get(opponentId) as { name?: string } | undefined;
  return {
    id: fixture.id,
    date: fixture.scheduled_date,
    competition: competition?.name ?? "Competition",
    opponent: opponent?.name ?? "Unknown team",
    opponentId,
    homeAway: isHome ? "home" : "away",
    venue: venueForFixture(db, { home_team_id: fixture.home_team_id }),
    status: fixture.status,
    score: match ? `${match.home_goals}-${match.away_goals}` : undefined,
  };
};

export const buildOwnerMatchday = (db: GameDatabase, save: SaveMetadata, clubId: EntityId): OwnerMatchdayView => {
  const club = db.prepare("SELECT name FROM clubs WHERE id=?").get(clubId) as { name?: string } | undefined;
  /*
   * A club fields both a senior men's and a senior women's team (both
   * level='senior'), so `level='senior'` alone is ambiguous and picking by
   * id order silently resolved to whichever team's id happened to sort
   * first — often the women's side, which has no scheduled men's-league
   * fixtures, making Owner Matchday show "no fixtures" for a club mid-season.
   * The senior men's first team is the club's flagship fixture list
   * everywhere else in the codebase resolves it (see federation-governance
   * national-team lookups); fall back to any senior team only if the club
   * genuinely has no men's side.
   */
  const team = (db
    .prepare("SELECT id FROM teams WHERE club_id=? AND level='senior' AND gender='men' ORDER BY id LIMIT 1")
    .get(clubId) ??
    db.prepare("SELECT id FROM teams WHERE club_id=? AND level='senior' ORDER BY id LIMIT 1").get(clubId)) as
    | { id?: EntityId }
    | undefined;
  if (!club?.name || !team?.id) throw new Error("Controlled club has no senior team.");
  const fixtures = db.prepare("SELECT * FROM fixtures WHERE home_team_id=? OR away_team_id=? ORDER BY scheduled_date, id").all(team.id, team.id) as any[];
  const models = fixtures.map((fixture) => row(db, fixture, team.id!));
  const upcoming = models.filter((fixture) => fixture.status === "scheduled");
  const results = models.filter((fixture) => fixture.status === "played" && fixture.date <= save.worldDate).slice(-12).reverse();
  const seasonId = fixtures.find((fixture) => fixture.status === "scheduled")?.competition_season_id ?? fixtures[0]?.competition_season_id;
  const table = seasonId ? db.prepare("SELECT played, points FROM league_standings WHERE competition_season_id=? AND team_id=?").get(seasonId, team.id) as { played?: number; points?: number } | undefined : undefined;
  const standingRows = seasonId ? db.prepare("SELECT team_id FROM league_standings WHERE competition_season_id=? ORDER BY points DESC, team_id").all(seasonId) as Array<{ team_id: EntityId }> : [];
  const position = standingRows.findIndex((standing) => standing.team_id === team.id) + 1;
  return { clubId, clubName: club.name, teamId: team.id, upcoming, results, currentFixtureId: upcoming[0]?.id, positionContext: position > 0 && table ? { position, played: table.played ?? 0, points: table.points ?? 0 } : undefined };
};
