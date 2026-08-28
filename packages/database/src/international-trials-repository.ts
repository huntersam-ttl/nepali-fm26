import type {
  EntityId,
  InternationalTrialRecord,
} from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const mapTrial = (row: any): InternationalTrialRecord => ({
  id: row.id,
  playerId: row.player_id,
  hostClubId: row.host_club_id,
  currentClubIdAtInvitation: row.current_club_id_at_invitation ?? undefined,
  parentClubPermissionGranted: Boolean(row.parent_club_permission_granted),
  invitedOn: row.invited_on,
  startDate: row.start_date,
  endDate: row.end_date,
  invitationStatus: row.invitation_status,
  playerResponse: row.player_response,
  state: row.state,
  source: row.source,
  reason: row.reason ?? undefined,
  decidedOn: row.decided_on ?? undefined,
  completedOn: row.completed_on ?? undefined,
});

export class InternationalTrialsRepository {
  constructor(private readonly db: GameDatabase) {}

  insert(record: InternationalTrialRecord): void {
    this.db
      .prepare(
        `INSERT INTO international_trials
        (id, player_id, host_club_id, current_club_id_at_invitation,
          parent_club_permission_granted, invited_on, start_date, end_date,
          invitation_status, player_response, state, source, reason,
          decided_on, completed_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          current_club_id_at_invitation = excluded.current_club_id_at_invitation,
          parent_club_permission_granted = excluded.parent_club_permission_granted,
          invitation_status = excluded.invitation_status,
          player_response = excluded.player_response,
          state = excluded.state,
          source = excluded.source,
          reason = excluded.reason,
          decided_on = excluded.decided_on,
          completed_on = excluded.completed_on`,
      )
      .run(
        record.id,
        record.playerId,
        record.hostClubId,
        record.currentClubIdAtInvitation ?? null,
        Number(record.parentClubPermissionGranted),
        record.invitedOn,
        record.startDate,
        record.endDate,
        record.invitationStatus,
        record.playerResponse,
        record.state,
        record.source,
        record.reason ?? null,
        record.decidedOn ?? null,
        record.completedOn ?? null,
      );
  }

  get(id: EntityId): InternationalTrialRecord | undefined {
    const row = this.db.prepare("SELECT * FROM international_trials WHERE id = ?").get(id) as any;
    return row ? mapTrial(row) : undefined;
  }

  all(): InternationalTrialRecord[] {
    return this.db
      .prepare("SELECT * FROM international_trials ORDER BY invited_on, id")
      .all()
      .map(mapTrial);
  }

  activeForPlayer(playerId: EntityId): InternationalTrialRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM international_trials
         WHERE player_id = ? AND state IN ('INVITED', 'ACTIVE')
         ORDER BY start_date, id`,
      )
      .all(playerId)
      .map(mapTrial);
  }

  activeForClub(hostClubId: EntityId): InternationalTrialRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM international_trials
         WHERE host_club_id = ? AND state IN ('INVITED', 'ACTIVE')
         ORDER BY end_date, id`,
      )
      .all(hostClubId)
      .map(mapTrial);
  }

  due(worldDate: string): InternationalTrialRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM international_trials
         WHERE state IN ('INVITED', 'ACTIVE') AND end_date <= ?
         ORDER BY end_date, id`,
      )
      .all(worldDate)
      .map(mapTrial);
  }
}
