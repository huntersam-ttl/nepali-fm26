import type {
  ClubRivalry,
  EntityId,
  NationalTeamSupporterState,
  SupporterCultureProfile,
  SupporterEvent,
  SupporterPlayerAffinity,
} from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const j = (value: unknown) => JSON.stringify(value);

const profile = (r: any): SupporterCultureProfile => ({
  ...JSON.parse(r.data_json),
  clubId: r.club_id,
  gender: r.gender,
  tier: r.tier,
  lastEvaluatedOn: r.last_evaluated_on,
});
const rivalry = (r: any): ClubRivalry => ({
  ...JSON.parse(r.data_json),
  id: r.id,
  clubId: r.club_id,
  rivalClubId: r.rival_club_id,
  intensity: r.intensity,
});
const affinity = (r: any): SupporterPlayerAffinity => ({
  ...JSON.parse(r.data_json),
  clubId: r.club_id,
  playerId: r.player_id,
  affinity: r.affinity,
});
const event = (r: any): SupporterEvent => ({
  ...JSON.parse(r.data_json),
  id: r.id,
  clubId: r.club_id,
  date: r.date,
});
const national = (r: any): NationalTeamSupporterState => ({
  ...JSON.parse(r.data_json),
  nationalTeamId: r.national_team_id,
  gender: r.gender,
});

/**
 * Supporter world persistence. Only state that genuinely has to survive
 * save/load lives here; attendance breakdowns, atmosphere and read models stay
 * derived.
 */
export class SupporterCultureRepository {
  constructor(private readonly db: GameDatabase) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS club_supporter_culture (
        club_id TEXT NOT NULL, gender TEXT NOT NULL, tier INTEGER NOT NULL,
        last_evaluated_on TEXT NOT NULL, data_json TEXT NOT NULL,
        PRIMARY KEY (club_id, gender));
      CREATE TABLE IF NOT EXISTS club_rivalries (
        id TEXT PRIMARY KEY, club_id TEXT NOT NULL, rival_club_id TEXT NOT NULL,
        intensity REAL NOT NULL, data_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS supporter_player_affinities (
        club_id TEXT NOT NULL, player_id TEXT NOT NULL, affinity REAL NOT NULL,
        data_json TEXT NOT NULL, PRIMARY KEY (club_id, player_id));
      CREATE TABLE IF NOT EXISTS supporter_events (
        id TEXT PRIMARY KEY, club_id TEXT NOT NULL, date TEXT NOT NULL, data_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS national_team_supporter_states (
        national_team_id TEXT NOT NULL, gender TEXT NOT NULL, data_json TEXT NOT NULL,
        PRIMARY KEY (national_team_id, gender));
    `);
  }

  upsertProfile(value: SupporterCultureProfile): void {
    this.db
      .prepare(
        `INSERT INTO club_supporter_culture (club_id,gender,tier,last_evaluated_on,data_json) VALUES (?,?,?,?,?)
         ON CONFLICT(club_id,gender) DO UPDATE SET tier=excluded.tier,last_evaluated_on=excluded.last_evaluated_on,data_json=excluded.data_json`,
      )
      .run(value.clubId, value.gender, value.tier, value.lastEvaluatedOn, j(value));
  }

  profile(clubId: EntityId, gender: "men" | "women" = "men"): SupporterCultureProfile | undefined {
    const row = this.db
      .prepare("SELECT * FROM club_supporter_culture WHERE club_id = ? AND gender = ?")
      .get(clubId, gender) as any;
    return row ? profile(row) : undefined;
  }

  profiles(gender?: "men" | "women"): SupporterCultureProfile[] {
    const rows = (
      gender
        ? this.db
            .prepare("SELECT * FROM club_supporter_culture WHERE gender = ? ORDER BY club_id")
            .all(gender)
        : this.db.prepare("SELECT * FROM club_supporter_culture ORDER BY club_id, gender").all()
    ) as any[];
    return rows.map(profile);
  }

  upsertRivalry(value: ClubRivalry): void {
    this.db
      .prepare(
        `INSERT INTO club_rivalries (id,club_id,rival_club_id,intensity,data_json) VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET intensity=excluded.intensity,data_json=excluded.data_json`,
      )
      .run(value.id, value.clubId, value.rivalClubId, value.intensity, j(value));
  }

  rivalry(clubId: EntityId, rivalClubId: EntityId): ClubRivalry | undefined {
    const row = this.db
      .prepare("SELECT * FROM club_rivalries WHERE club_id = ? AND rival_club_id = ?")
      .get(clubId, rivalClubId) as any;
    return row ? rivalry(row) : undefined;
  }

  rivalries(clubId?: EntityId): ClubRivalry[] {
    const rows = (
      clubId
        ? this.db
            .prepare("SELECT * FROM club_rivalries WHERE club_id = ? ORDER BY intensity DESC, id")
            .all(clubId)
        : this.db.prepare("SELECT * FROM club_rivalries ORDER BY intensity DESC, id").all()
    ) as any[];
    return rows.map(rivalry);
  }

  upsertAffinity(value: SupporterPlayerAffinity): void {
    this.db
      .prepare(
        `INSERT INTO supporter_player_affinities (club_id,player_id,affinity,data_json) VALUES (?,?,?,?)
         ON CONFLICT(club_id,player_id) DO UPDATE SET affinity=excluded.affinity,data_json=excluded.data_json`,
      )
      .run(value.clubId, value.playerId, value.affinity, j(value));
  }

  affinity(clubId: EntityId, playerId: EntityId): SupporterPlayerAffinity | undefined {
    const row = this.db
      .prepare("SELECT * FROM supporter_player_affinities WHERE club_id = ? AND player_id = ?")
      .get(clubId, playerId) as any;
    return row ? affinity(row) : undefined;
  }

  affinities(clubId: EntityId): SupporterPlayerAffinity[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM supporter_player_affinities WHERE club_id = ? ORDER BY affinity DESC, player_id",
        )
        .all(clubId) as any[]
    ).map(affinity);
  }

  recordEvent(value: SupporterEvent): void {
    this.db
      .prepare(
        `INSERT INTO supporter_events (id,club_id,date,data_json) VALUES (?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json`,
      )
      .run(value.id, value.clubId, value.date, j(value));
  }

  events(clubId?: EntityId, limit = 25): SupporterEvent[] {
    const rows = (
      clubId
        ? this.db
            .prepare(
              "SELECT * FROM supporter_events WHERE club_id = ? ORDER BY date DESC, id LIMIT ?",
            )
            .all(clubId, limit)
        : this.db
            .prepare("SELECT * FROM supporter_events ORDER BY date DESC, id LIMIT ?")
            .all(limit)
    ) as any[];
    return rows.map(event);
  }

  upsertNationalState(value: NationalTeamSupporterState): void {
    this.db
      .prepare(
        `INSERT INTO national_team_supporter_states (national_team_id,gender,data_json) VALUES (?,?,?)
         ON CONFLICT(national_team_id,gender) DO UPDATE SET data_json=excluded.data_json`,
      )
      .run(value.nationalTeamId, value.gender, j(value));
  }

  nationalState(
    nationalTeamId: EntityId,
    gender: "men" | "women" = "men",
  ): NationalTeamSupporterState | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM national_team_supporter_states WHERE national_team_id = ? AND gender = ?",
      )
      .get(nationalTeamId, gender) as any;
    return row ? national(row) : undefined;
  }

  nationalStates(): NationalTeamSupporterState[] {
    return (
      this.db
        .prepare("SELECT * FROM national_team_supporter_states ORDER BY national_team_id, gender")
        .all() as any[]
    ).map(national);
  }
}
