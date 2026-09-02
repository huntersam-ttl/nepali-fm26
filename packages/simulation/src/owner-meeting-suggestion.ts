import type { GameDatabase } from "@nepal-football-sim/database";
import type { EntityId, SaveMetadata } from "@nepal-football-sim/shared-types";
import { buildEntityReference } from "./entity-reference.js";

export const buildOwnerPostMatchSuggestion = (db: GameDatabase, save: SaveMetadata, clubId: EntityId) => {
  const team = db.prepare("SELECT id FROM teams WHERE club_id=? ORDER BY id LIMIT 1").get(clubId) as { id?: EntityId } | undefined;
  if (!team?.id) return undefined;
  const match = db.prepare("SELECT f.id, f.home_team_id, f.away_team_id, f.scheduled_date, m.home_goals, m.away_goals FROM fixtures f JOIN matches m ON m.fixture_id=f.id WHERE (f.home_team_id=? OR f.away_team_id=?) AND f.status='played' ORDER BY m.played_date DESC, m.id DESC LIMIT 1").get(team.id, team.id) as { id: EntityId; home_team_id: EntityId; away_team_id: EntityId; scheduled_date: string; home_goals: number; away_goals: number } | undefined;
  if (!match) return undefined;
  const ownGoals = match.home_team_id === team.id ? match.home_goals : match.away_goals;
  const opponentGoals = match.home_team_id === team.id ? match.away_goals : match.home_goals;
  const result = ownGoals > opponentGoals ? "WIN" : ownGoals < opponentGoals ? "DEFEAT" : "DRAW";
  const margin = Math.abs(ownGoals - opponentGoals);
  const reason = result === "DEFEAT" ? (margin >= 2 ? "A heavy defeat merits an urgent form review." : "A defeat merits a result and form review.") : result === "WIN" && margin >= 2 ? "A significant win is a useful moment to review objectives and support." : "The latest result is available for the next Owner-manager review.";
  return { suggested: result === "DEFEAT" || margin >= 2, reason, result, score: `${ownGoals}-${opponentGoals}`, urgency: result === "DEFEAT" && margin >= 2 ? "HIGH" : "MEDIUM", topic: "FORM", action: "openOwnerManagerMeeting", fixture: buildEntityReference(db, "FIXTURE", match.id, "CHAIRMAN_OWNER"), asOf: save.worldDate };
};
