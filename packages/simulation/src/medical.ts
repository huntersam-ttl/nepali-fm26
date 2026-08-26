import { MedicalRepository, PlayerRepository, type GameDatabase } from "@nepal-football-sim/database";
import { createStableEntityId, type EntityId, type MedicalAssessment, type InjuryRecord } from "@nepal-football-sim/shared-types";

const status = "SIMULATION_ONLY" as const;
const clamp = (n: number, low: number, high: number): number => Math.max(low, Math.min(high, n));
const day = (date: string, offset: number): string => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const staffQuality = (db: GameDatabase, clubId: EntityId): number => {
  const row = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN role IN ('HEAD_PHYSIO','DOCTOR','SPORTS_SCIENTIST') THEN 1 ELSE 0 END) AS specialists FROM staff_appointments WHERE club_id = ? AND employment_status = 'ACTIVE'`).get(clubId) as { total?: number; specialists?: number };
  return clamp(4 + (row?.specialists ?? 0) * 1.2 + Math.min(2, (row?.total ?? 0) * 0.15), 3, 10);
};

const injuryFor = (db: GameDatabase, personId: EntityId, date: string): InjuryRecord | undefined => new PlayerRepository(db).activeInjuries(date).find((injury) => injury.personId === personId);

export const assessPlayerMedical = (db: GameDatabase, input: { clubId: EntityId; personId: EntityId; date: string; workload?: number }): MedicalAssessment => {
  const players = new PlayerRepository(db); const repo = new MedicalRepository(db); const injury = injuryFor(db, input.personId, input.date);
  const availability = db.prepare("SELECT fitness, availability FROM player_availability_states WHERE person_id = ?").get(input.personId) as { fitness?: number; availability?: string } | undefined;
  const fitness = availability?.fitness ?? 82; const fatigue = clamp(100 - fitness, 0, 100); const load = clamp(input.workload ?? fatigue, 0, 100);
  const facility = (db.prepare("SELECT medical_facility_quality FROM club_facility_profiles WHERE club_id = ?").get(input.clubId) as { medical_facility_quality?: number } | undefined)?.medical_facility_quality ?? 3;
  const staff = staffQuality(db, input.clubId); const confidence = clamp(Math.round((staff * 0.55 + facility * 0.45) * 10) / 10, 1, 10);
  const previous = (db.prepare("SELECT COUNT(*) AS total FROM injuries WHERE person_id = ?").get(input.personId) as { total?: number })?.total ?? 0;
  const recurrenceRisk = clamp(Math.round((previous * 0.12 + (load >= 75 ? 0.12 : 0) + (facility < 4 ? 0.08 : 0)) * 100) / 100, 0, 0.8);
  let start = input.date; let end = input.date; let stage: MedicalAssessment["stage"] = "CLEARED"; let recommendation: MedicalAssessment["availabilityRecommendation"] = "FULLY_FIT"; let clearanceStatus: MedicalAssessment["clearanceStatus"] = "MATCH_CLEARANCE";
  if (injury) {
    const uncertainty = Math.max(1, Math.round(10 - confidence)); start = day(injury.expectedRecoveryDate, -uncertainty); end = day(injury.expectedRecoveryDate, uncertainty);
    const remaining = daysBetween(input.date, injury.expectedRecoveryDate);
    stage = remaining > 7 ? "REHABILITATION" : remaining > 0 ? "RETURN_TO_TRAINING" : "RETURN_TO_PLAY";
    recommendation = remaining > 7 ? "UNAVAILABLE" : remaining > 0 ? "LIMITED_TRAINING" : "AVAILABLE_WITH_RISK"; clearanceStatus = remaining > 0 ? "NOT_CLEARED" : "TRAINING_CLEARANCE";
    if (remaining <= 0 && fitness >= 80 && load < 55) { stage = "CLEARED"; recommendation = "FULLY_FIT"; clearanceStatus = "MATCH_CLEARANCE"; }
  } else if (fitness < 55 || load >= 80) { stage = "RETURN_TO_TRAINING"; recommendation = "LIMITED_TRAINING"; clearanceStatus = "TRAINING_CLEARANCE"; start = input.date; end = day(input.date, 3); }
  const workloadFlag: MedicalAssessment["workloadFlag"] = load >= 80 ? "OVERLOADED" : load >= 60 ? "ELEVATED" : "NORMAL";
  const rationale = injury ? `${injury.severity} injury remains under review; estimate uses the recorded recovery date and current medical resources.` : workloadFlag === "OVERLOADED" ? "High fatigue/load warrants restricted work and medical review." : "No active injury recorded; fitness supports the current recommendation.";
  const assessment: MedicalAssessment = { id: createStableEntityId("medical-assessment", `${input.personId}:${input.date}`), personId: input.personId, injuryId: injury?.id, assessedOn: input.date, stage, estimatedReturnStart: start, estimatedReturnEnd: end, confidence, recurrenceRisk, fatigue, workloadFlag, availabilityRecommendation: recommendation, clearanceStatus, rationale, provenanceStatus: status };
  repo.upsertAssessment(assessment); repo.recordHistory(assessment); return assessment;
};

export const medicalCentreReadModel = (db: GameDatabase, input: { clubId: EntityId; date: string }): MedicalAssessment[] => {
  const teams = (db.prepare("SELECT id FROM teams WHERE club_id = ?").all(input.clubId) as Array<{ id: EntityId }>).map((row) => row.id);
  const people = teams.flatMap((teamId) => new PlayerRepository(db).availabilityStates(teamId).map((state) => state.personId));
  return people.sort().map((personId) => assessPlayerMedical(db, { clubId: input.clubId, personId, date: input.date }));
};
