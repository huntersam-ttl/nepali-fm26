import type { EntityId, MedicalAssessment } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const map = (r: any): MedicalAssessment => ({
  id: r.id, personId: r.person_id, injuryId: r.injury_id ?? undefined, assessedOn: r.assessed_on,
  stage: r.stage, estimatedReturnStart: r.estimated_return_start, estimatedReturnEnd: r.estimated_return_end,
  confidence: r.confidence, recurrenceRisk: r.recurrence_risk, fatigue: r.fatigue, workloadFlag: r.workload_flag,
  availabilityRecommendation: r.availability_recommendation, clearanceStatus: r.clearance_status,
  rationale: r.rationale, provenanceStatus: r.provenance_status,
});

export class MedicalRepository {
  constructor(private readonly db: GameDatabase) {}
  upsertAssessment(value: MedicalAssessment): void {
    this.db.prepare(`INSERT INTO medical_assessments
      (id,person_id,injury_id,assessed_on,stage,estimated_return_start,estimated_return_end,confidence,recurrence_risk,fatigue,workload_flag,availability_recommendation,clearance_status,rationale,provenance_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET injury_id=excluded.injury_id,assessed_on=excluded.assessed_on,stage=excluded.stage,estimated_return_start=excluded.estimated_return_start,estimated_return_end=excluded.estimated_return_end,confidence=excluded.confidence,recurrence_risk=excluded.recurrence_risk,fatigue=excluded.fatigue,workload_flag=excluded.workload_flag,availability_recommendation=excluded.availability_recommendation,clearance_status=excluded.clearance_status,rationale=excluded.rationale`).run(
      value.id,value.personId,value.injuryId??null,value.assessedOn,value.stage,value.estimatedReturnStart,value.estimatedReturnEnd,value.confidence,value.recurrenceRisk,value.fatigue,value.workloadFlag,value.availabilityRecommendation,value.clearanceStatus,value.rationale,value.provenanceStatus);
  }
  assessment(personId: EntityId): MedicalAssessment | undefined { const row = this.db.prepare("SELECT * FROM medical_assessments WHERE person_id = ? ORDER BY assessed_on DESC, id DESC LIMIT 1").get(personId) as any; return row ? map(row) : undefined; }
  assessments(personIds?: readonly EntityId[]): MedicalAssessment[] { const rows = (personIds?.length ? this.db.prepare(`SELECT * FROM medical_assessments WHERE person_id IN (${personIds.map(() => "?").join(",")}) ORDER BY person_id`).all(...personIds) : this.db.prepare("SELECT * FROM medical_assessments ORDER BY person_id").all()) as any[]; return rows.map(map); }
  recordHistory(value: MedicalAssessment): void { this.db.prepare("INSERT OR REPLACE INTO medical_assessment_history (id,person_id,assessed_on,stage,recommendation,rationale,provenance_status) VALUES (?,?,?,?,?,?,?)").run(`${value.id}:history`,value.personId,value.assessedOn,value.stage,value.availabilityRecommendation,value.rationale,value.provenanceStatus); }
  history(personId: EntityId): Array<Pick<MedicalAssessment, "personId" | "assessedOn" | "stage" | "availabilityRecommendation" | "rationale">> { return (this.db.prepare("SELECT person_id,assessed_on,stage,recommendation,rationale FROM medical_assessment_history WHERE person_id = ? ORDER BY assessed_on,id").all(personId) as any[]).map((r) => ({ personId: r.person_id, assessedOn: r.assessed_on, stage: r.stage, availabilityRecommendation: r.recommendation, rationale: r.rationale })); }
}
