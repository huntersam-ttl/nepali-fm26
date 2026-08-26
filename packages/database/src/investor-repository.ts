import type { EntityId, OwnershipInvestorProfile } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const map = (r: any): OwnershipInvestorProfile => ({ id:r.id, clubId:r.club_id, personId:r.person_id, influence:r.influence, trust:r.trust, confidence:r.confidence, expectations:JSON.parse(r.expectations_json), lastReviewedOn:r.last_reviewed_on, status:r.status, provenanceStatus:r.provenance_status });
export class OwnershipInvestorRepository {
  constructor(private readonly db: GameDatabase) {}
  upsert(p: OwnershipInvestorProfile): void { this.db.prepare(`INSERT INTO ownership_investor_profiles (id,club_id,person_id,influence,trust,confidence,expectations_json,last_reviewed_on,status,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(club_id,person_id) DO UPDATE SET influence=excluded.influence,trust=excluded.trust,confidence=excluded.confidence,expectations_json=excluded.expectations_json,last_reviewed_on=excluded.last_reviewed_on,status=excluded.status,provenance_status=excluded.provenance_status`).run(p.id,p.clubId,p.personId,p.influence,p.trust,p.confidence,JSON.stringify(p.expectations),p.lastReviewedOn,p.status,p.provenanceStatus); }
  profile(clubId: EntityId, personId: EntityId): OwnershipInvestorProfile | undefined { const r=this.db.prepare("SELECT * FROM ownership_investor_profiles WHERE club_id=? AND person_id=?").get(clubId,personId) as any; return r?map(r):undefined; }
  profiles(clubId?: EntityId): OwnershipInvestorProfile[] { const rows=(clubId?this.db.prepare("SELECT * FROM ownership_investor_profiles WHERE club_id=? ORDER BY person_id").all(clubId):this.db.prepare("SELECT * FROM ownership_investor_profiles ORDER BY club_id,person_id").all()) as any[]; return rows.map(map); }
}
