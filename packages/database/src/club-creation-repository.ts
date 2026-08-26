import type { EntityId, SimulationClubRecord } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const map = (r: any): SimulationClubRecord => ({ id: r.id, clubId: r.club_id, locationId: r.location_id, foundedOn: r.founded_on, ownershipType: r.ownership_type, initialReputation: r.initial_reputation, supporterBase: r.supporter_base, status: r.status, admissionStatus: r.admission_status, venueId: r.venue_id ?? undefined, provenanceStatus: r.provenance_status });
export class ClubCreationRepository {
  constructor(private readonly db: GameDatabase) {}
  upsert(record: SimulationClubRecord): void { this.db.prepare(`INSERT INTO simulation_club_records (id,club_id,location_id,founded_on,ownership_type,initial_reputation,supporter_base,status,admission_status,venue_id,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(club_id) DO UPDATE SET status=excluded.status, admission_status=excluded.admission_status, venue_id=excluded.venue_id`).run(record.id,record.clubId,record.locationId,record.foundedOn,record.ownershipType,record.initialReputation,record.supporterBase,record.status,record.admissionStatus,record.venueId??null,record.provenanceStatus); }
  get(clubId: EntityId): SimulationClubRecord | undefined { const row = this.db.prepare("SELECT * FROM simulation_club_records WHERE club_id = ?").get(clubId) as any; return row ? map(row) : undefined; }
  all(): SimulationClubRecord[] { return (this.db.prepare("SELECT * FROM simulation_club_records ORDER BY founded_on,id").all() as any[]).map(map); }
}
