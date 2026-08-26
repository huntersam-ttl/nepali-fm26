import { MedicalRepository, PlayerRepository, type GameDatabase } from "@nepal-football-sim/database";
import {
  createEntityId,
  createStableEntityId,
  type EntityId,
  type FixtureRecord,
  type InjuryRecord,
  type MedicalAssessment,
  type RehabDecisionOutcome,
  type RehabDecisionRecord,
  type RehabilitationPlan,
  type RehabStage,
  type ReturnToPlayDecision,
  type SaveMetadata,
} from "@nepal-football-sim/shared-types";
import { assessPlayerMedical } from "./medical.js";
import { computeCongestionMultiplier, trainingAvailabilityFor } from "./player-development-plans.js";
import { SeededRandom } from "./rng.js";

const status = "SIMULATION_ONLY" as const;
const clamp = (n: number, low: number, high: number): number => Math.max(low, Math.min(high, n));
const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Front-loaded: protection and rehab take longer than the final training/match-ready run-in. */
const STAGE_ORDER: RehabStage[] = ["PROTECTION_REST", "REHABILITATION", "PARTIAL_TRAINING", "FULL_TRAINING", "MATCH_READY"];
const STAGE_THRESHOLDS = [0.15, 0.55, 0.78, 0.93, 1];

export class MedicalDecisionError extends Error {
  constructor(
    readonly code: "NO_ACTIVE_PLAN" | "ALREADY_MATCH_READY",
    message: string,
  ) {
    super(message);
  }
}

const clubIdForPerson = (db: GameDatabase, personId: EntityId): EntityId | undefined => {
  const row = db
    .prepare(
      `SELECT t.club_id AS clubId FROM team_person_assignments tpa
      JOIN teams t ON t.id = tpa.team_id
      WHERE tpa.person_id = ? AND tpa.role = 'PLAYER' AND tpa.ended_on IS NULL
      ORDER BY tpa.id DESC LIMIT 1`,
    )
    .get(personId) as { clubId?: EntityId } | undefined;
  return row?.clubId ?? undefined;
};

const staffQualityFor = (db: GameDatabase, clubId: EntityId | undefined): number => {
  if (!clubId) return 5;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN role IN ('HEAD_PHYSIO','DOCTOR','SPORTS_SCIENTIST') THEN 1 ELSE 0 END) AS specialists
      FROM staff_appointments WHERE club_id = ? AND employment_status = 'ACTIVE'`,
    )
    .get(clubId) as { total?: number; specialists?: number };
  return clamp(4 + (row?.specialists ?? 0) * 1.2 + Math.min(2, (row?.total ?? 0) * 0.15), 3, 10);
};

const facilityQualityFor = (db: GameDatabase, clubId: EntityId | undefined): number => {
  if (!clubId) return 3;
  return (
    (db.prepare("SELECT medical_facility_quality FROM club_facility_profiles WHERE club_id = ?").get(clubId) as
      | { medical_facility_quality?: number }
      | undefined)?.medical_facility_quality ?? 3
  );
};

/**
 * Recurring/chronic injury-proneness, derived only from how often this
 * player has actually appeared in the simulated injury log — never an
 * invented medical diagnosis.
 */
export const chronicRiskFlag = (db: GameDatabase, personId: EntityId, date: string): boolean => {
  const since = new Date(`${date}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 365);
  const sinceDate = since.toISOString().slice(0, 10);
  const row = db
    .prepare("SELECT COUNT(*) AS total FROM injuries WHERE person_id = ? AND date_occurred >= ? AND date_occurred <= ?")
    .get(personId, sinceDate, date) as { total?: number };
  return (row?.total ?? 0) >= 3;
};

const dueStageIndex = (injury: InjuryRecord, date: string, staffQuality: number, facilityQuality: number): number => {
  const totalDays = Math.max(1, daysBetween(injury.dateOccurred, injury.expectedRecoveryDate));
  const elapsed = clamp(daysBetween(injury.dateOccurred, date) / totalDays, 0, 1.15);
  // Better medical resources let a player progress slightly ahead of the nominal schedule.
  const qualityFactor = clamp(0.85 + (staffQuality + facilityQuality) / 40, 0.85, 1.2);
  const effective = clamp(elapsed * qualityFactor, 0, 1.15);
  const index = STAGE_THRESHOLDS.findIndex((threshold) => effective <= threshold);
  return index === -1 ? STAGE_ORDER.length - 1 : index;
};

/** Creates a fresh rehab plan for a new injury at the protection/rest stage. */
export const ensureRehabilitationPlan = (
  db: GameDatabase,
  injury: InjuryRecord,
  date: string,
): RehabilitationPlan => {
  const medical = new MedicalRepository(db);
  const existing = medical.rehabilitationPlanForInjury(injury.id);
  if (existing) return existing;
  const clubId = clubIdForPerson(db, injury.personId);
  const plan: RehabilitationPlan = {
    id: createStableEntityId("rehabilitation-plan", injury.id),
    injuryId: injury.id,
    personId: injury.personId,
    clubId,
    stage: "PROTECTION_REST",
    stageStartedOn: injury.dateOccurred,
    startedOn: injury.dateOccurred,
    targetReturnDate: injury.expectedRecoveryDate,
    status: "ACTIVE",
    provenanceStatus: status,
  };
  medical.upsertRehabilitationPlan(plan);
  return plan;
};

/**
 * Natural staged progression toward match-ready, from real elapsed time and
 * real medical-staff/facility quality — never an instant jump. Held at its
 * current stage if the manager's most recent decision on this plan was
 * DELAY, until a fresh decision is made.
 */
export const advanceRehabilitationPlan = (
  db: GameDatabase,
  plan: RehabilitationPlan,
  injury: InjuryRecord,
  date: string,
  respectHold = true,
): { plan: RehabilitationPlan; stageChanged: boolean; reachedMatchReady: boolean } => {
  const medical = new MedicalRepository(db);
  const lastDecision = medical.rehabDecisionHistory(plan.personId)[0];
  if (respectHold && lastDecision?.planId === plan.id && lastDecision.decision === "DELAY") {
    return { plan, stageChanged: false, reachedMatchReady: false };
  }
  const staffQuality = staffQualityFor(db, plan.clubId);
  const facilityQuality = facilityQualityFor(db, plan.clubId);
  const currentIndex = STAGE_ORDER.indexOf(plan.stage);
  const targetIndex = dueStageIndex(injury, date, staffQuality, facilityQuality);
  if (targetIndex <= currentIndex) return { plan, stageChanged: false, reachedMatchReady: false };
  const updated: RehabilitationPlan = { ...plan, stage: STAGE_ORDER[targetIndex]!, stageStartedOn: date };
  medical.upsertRehabilitationPlan(updated);
  return { plan: updated, stageChanged: true, reachedMatchReady: updated.stage === "MATCH_READY" };
};

/** How much extra recurrence risk an early return against the natural schedule adds, bounded so it is never certain. */
export const earlyReturnRisk = (
  baseRecurrenceRisk: number,
  stage: RehabStage,
  staffQuality: number,
  facilityQuality: number,
): number => {
  const stageDistance = STAGE_ORDER.length - 1 - STAGE_ORDER.indexOf(stage);
  const mitigation = (staffQuality + facilityQuality) / 200;
  return clamp(baseRecurrenceRisk + stageDistance * 0.08 - mitigation, 0.03, 0.65);
};

export type ReturnToPlayDecisionResult = {
  plan: RehabilitationPlan;
  decision: RehabDecisionRecord;
  setback: boolean;
};

/**
 * The return-to-play decision workflow: FOLLOW_ADVICE lets the natural
 * staged progression play out, DELAY holds the player out until a fresh
 * decision, and ACCEPT_RISK forces immediate match-ready availability
 * against medical advice with a deterministic (seeded), bounded — never
 * guaranteed — chance of a real setback (a new injury, via the same
 * injury table match-time injuries already use).
 */
export const recordReturnToPlayDecision = (
  db: GameDatabase,
  save: SaveMetadata,
  input: { personId: EntityId; decision: ReturnToPlayDecision },
): ReturnToPlayDecisionResult => {
  const medical = new MedicalRepository(db);
  const players = new PlayerRepository(db);
  const plan = medical.activeRehabilitationPlan(input.personId);
  if (!plan) throw new MedicalDecisionError("NO_ACTIVE_PLAN", "This player has no active rehabilitation plan.");
  const injury = players.activeInjuries(save.worldDate).find((record) => record.personId === input.personId);
  const clubId = plan.clubId ?? clubIdForPerson(db, input.personId);
  const assessment = assessPlayerMedical(db, {
    clubId: clubId ?? ("" as EntityId),
    personId: input.personId,
    date: save.worldDate,
  });
  const staffQuality = staffQualityFor(db, clubId);
  const facilityQuality = facilityQualityFor(db, clubId);

  let updatedPlan = plan;
  let outcome: RehabDecisionOutcome = "NO_CHANGE";
  let setback = false;
  let rationale = "";

  if (input.decision === "DELAY") {
    outcome = "HELD";
    rationale = "Manager chose to hold the player out longer than medical advice requires.";
  } else if (input.decision === "FOLLOW_ADVICE") {
    if (injury) {
      // A fresh FOLLOW_ADVICE decision explicitly supersedes any earlier DELAY hold on this plan.
      const advanced = advanceRehabilitationPlan(db, plan, injury, save.worldDate, false);
      updatedPlan = advanced.plan;
      outcome = advanced.stageChanged ? "ADVANCED" : "NO_CHANGE";
    }
    rationale = "Manager followed medical advice.";
  } else {
    if (plan.stage === "MATCH_READY") {
      outcome = "NO_CHANGE";
      rationale = "Player is already match-ready; no early-return risk to accept.";
    } else {
      const risk = earlyReturnRisk(assessment.recurrenceRisk, plan.stage, staffQuality, facilityQuality);
      const random = new SeededRandom(`${input.personId}:${save.worldDate}:accept-risk`);
      setback = random.next() < risk;
      if (setback && injury) {
        medical.upsertRehabilitationPlan({ ...plan, status: "ABANDONED" });
        const recovery = new Date(`${save.worldDate}T00:00:00.000Z`);
        recovery.setUTCDate(recovery.getUTCDate() + (injury.severity === "major" ? 45 : injury.severity === "moderate" ? 21 : 10));
        const newInjury: InjuryRecord = {
          id: createEntityId(),
          personId: input.personId,
          injuryType: `Recurrence of ${injury.injuryType} (early return)`,
          dateOccurred: save.worldDate,
          expectedRecoveryDate: recovery.toISOString().slice(0, 10),
          severity: injury.severity === "minor" ? "moderate" : injury.severity,
        };
        players.insertInjury(newInjury);
        players.upsertAvailabilityState({
          personId: input.personId,
          fitness: 40,
          moraleModifier: -5,
          formModifier: 0,
          availability: "INJURED",
          updatedOn: save.worldDate,
        });
        updatedPlan = ensureRehabilitationPlan(db, newInjury, save.worldDate);
        outcome = "SETBACK";
        rationale = `Returned early against medical advice and suffered a setback: ${newInjury.injuryType}.`;
      } else {
        updatedPlan = { ...plan, stage: "MATCH_READY", stageStartedOn: save.worldDate };
        medical.upsertRehabilitationPlan(updatedPlan);
        outcome = "ADVANCED";
        rationale = "Returned early against medical advice without incident.";
      }
    }
  }

  const record: RehabDecisionRecord = {
    id: createEntityId(),
    planId: updatedPlan.id,
    personId: input.personId,
    decidedOn: save.worldDate,
    decision: input.decision,
    medicalRecommendation: assessment.availabilityRecommendation,
    outcome,
    rationale,
    provenanceStatus: status,
  };
  medical.insertRehabDecision(record);
  return { plan: updatedPlan, decision: record, setback };
};

/**
 * World-wide progression tick: ensures every currently-injured player has a
 * plan and advances it toward match-ready on the natural schedule. With no
 * explicit manager decision this is exactly FOLLOW_ADVICE — the sensible
 * default every AI-managed club effectively uses.
 */
export const advanceAllRehabilitationPlans = (db: GameDatabase, save: SaveMetadata): number => {
  const players = new PlayerRepository(db);
  const medical = new MedicalRepository(db);
  const stillInjured = new Set(players.activeInjuries(save.worldDate).map((injury) => injury.id));
  let advanced = 0;
  for (const injury of players.activeInjuries(save.worldDate)) {
    const plan = ensureRehabilitationPlan(db, injury, save.worldDate);
    if (plan.status !== "ACTIVE") continue;
    const result = advanceRehabilitationPlan(db, plan, injury, save.worldDate);
    if (result.stageChanged) advanced += 1;
  }
  // Recovery date has passed: the injury is no longer active, so close out any plan still open for it.
  for (const plan of medical.activeRehabilitationPlansAll()) {
    if (!stillInjured.has(plan.injuryId)) {
      medical.upsertRehabilitationPlan({ ...plan, status: "COMPLETED" });
    }
  }
  return advanced;
};

export type MedicalCentreEntry = {
  assessment: MedicalAssessment;
  plan?: RehabilitationPlan;
  chronicRisk: boolean;
  decisionHistory: RehabDecisionRecord[];
  trainingAvailability: "FULL" | "INJURED" | "RETURNING";
  congestionMultiplier: number;
};

/** Manager-facing medical read model: Phase A's assessment plus the staged plan, chronic-risk flag and decision history. */
export const buildMedicalCentreEntry = (
  db: GameDatabase,
  input: { clubId: EntityId; personId: EntityId; date: string; workload?: number },
  fixtures: readonly Pick<FixtureRecord, "homeTeamId" | "awayTeamId" | "scheduledDate" | "status">[] = [],
  teamId?: EntityId,
): MedicalCentreEntry => {
  const assessment = assessPlayerMedical(db, input);
  const medical = new MedicalRepository(db);
  const plan = medical.activeRehabilitationPlan(input.personId);
  return {
    assessment,
    plan,
    chronicRisk: chronicRiskFlag(db, input.personId, input.date),
    decisionHistory: medical.rehabDecisionHistory(input.personId).slice(0, 5),
    trainingAvailability: trainingAvailabilityFor(db, input.personId, input.date),
    congestionMultiplier: teamId ? computeCongestionMultiplier(fixtures, teamId, input.date) : 1,
  };
};
