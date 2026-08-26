import {
  ClubEconomyRepository,
  PlayerRepository,
  StaffMarketRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createEntityId,
  type DevelopmentFocusType,
  type EntityId,
  type FixtureRecord,
  type IndividualDevelopmentPlan,
  type PlayerAttributeSet,
  type TrainingIntensity,
} from "@nepal-football-sim/shared-types";
import { developmentPhaseForAge, isPlateaued, type DevelopmentEnvironment } from "./player-development.js";

const clampEnv = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);

export const addDaysISO = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

/** A multi-week block: long enough to matter, short enough to review often. */
export const DEVELOPMENT_BLOCK_DAYS = 42;
const RETURN_RAMP_DAYS = 10;
const FAMILIARITY_GOAL = 70;

/**
 * Coaching and facility signal for `updatePlayerDevelopment`'s environment
 * multipliers, derived from the club's real head coach and real facility
 * profile — never an invented number. Training quality itself is not a
 * separate knob here: it is already represented by the team's actual
 * `TrainingPlan` (session load feeds the engine directly).
 */
export const computeDevelopmentEnvironment = (
  db: GameDatabase,
  clubId: EntityId | undefined,
): DevelopmentEnvironment => {
  if (!clubId) return {};
  const staff = new StaffMarketRepository(db);
  const coach =
    staff.activeAppointmentsForClub(clubId).find((appointment) => appointment.role === "HEAD_COACH") ??
    staff.activeAppointmentsForClub(clubId).find((appointment) => appointment.role === "ASSISTANT_COACH");
  const profile = coach ? staff.staffSimulationProfile(coach.personId) : undefined;
  const coachingQuality = profile
    ? clampEnv(
        (profile.coachingTechnical + profile.coachingTactical + profile.coachingPhysical + profile.coachingMental) /
          40,
        0.7,
        1.3,
      )
    : 1;
  const facility = new ClubEconomyRepository(db).facilityProfile(clubId);
  const facilitiesEffect = facility ? clampEnv(0.75 + facility.trainingFacilityQuality / 16, 0.75, 1.25) : 1;
  return { coachingQuality, facilitiesEffect };
};

/**
 * Fixture-congestion dampener: a real busy run of matches leaves less real
 * bandwidth for development work, so growth is throttled rather than the
 * calendar being invented around it. Counts scheduled/played fixtures for
 * the team within a 6-day window either side of `date`.
 */
export const computeCongestionMultiplier = (
  fixtures: readonly Pick<FixtureRecord, "homeTeamId" | "awayTeamId" | "scheduledDate" | "status">[],
  teamId: EntityId,
  date: string,
): number => {
  const windowDays = 6;
  const nearby = fixtures.filter(
    (fixture) =>
      fixture.status !== "cancelled" &&
      (fixture.homeTeamId === teamId || fixture.awayTeamId === teamId) &&
      Math.abs(daysBetween(date, fixture.scheduledDate)) <= windowDays,
  ).length;
  return clampEnv(1 - Math.max(0, nearby - 1) * 0.12, 0.62, 1);
};

/** Was there an injury whose recovery date fell in the last `RETURN_RAMP_DAYS` days? */
/** Days since the player's most recent injury recovery date, or undefined if never injured. */
export const daysSinceRecovery = (db: GameDatabase, personId: EntityId, date: string): number | undefined => {
  const row = db
    .prepare(
      `SELECT expected_recovery_date FROM injuries
      WHERE person_id = ? ORDER BY expected_recovery_date DESC LIMIT 1`,
    )
    .get(personId) as { expected_recovery_date?: string } | undefined;
  if (!row?.expected_recovery_date) return undefined;
  return daysBetween(row.expected_recovery_date, date);
};

const recentlyRecoveredInjury = (db: GameDatabase, personId: EntityId, date: string): boolean => {
  const gap = daysSinceRecovery(db, personId, date);
  return gap !== undefined && gap >= 0 && gap <= RETURN_RAMP_DAYS;
};

/** FULL/INJURED/RETURNING, from the same injury records match-time injuries already use. */
export const trainingAvailabilityFor = (
  db: GameDatabase,
  personId: EntityId,
  date: string,
): "FULL" | "INJURED" | "RETURNING" => {
  const injured = new PlayerRepository(db).activeInjuries(date).some((injury) => injury.personId === personId);
  if (injured) return "INJURED";
  return recentlyRecoveredInjury(db, personId, date) ? "RETURNING" : "FULL";
};

const groupAverage = (group: Record<string, number>): number =>
  Object.values(group).reduce((sum, value) => sum + value, 0) / Object.values(group).length;

/** The attribute group with the most real room to grow, used only as a sensible default. */
const weakestAttributeGroup = (
  attributes: PlayerAttributeSet,
): "technical" | "mental" | "physical" | "goalkeeping" => {
  const candidates: Array<["technical" | "mental" | "physical" | "goalkeeping", number]> =
    attributes.primaryPosition === "GK"
      ? [
          ["goalkeeping", groupAverage(attributes.goalkeeping)],
          ["physical", groupAverage(attributes.physical)],
          ["mental", groupAverage(attributes.mental)],
        ]
      : [
          ["technical", groupAverage(attributes.technical)],
          ["mental", groupAverage(attributes.mental)],
          ["physical", groupAverage(attributes.physical)],
        ];
  return candidates.sort((a, b) => a[1] - b[1])[0]![0];
};

/**
 * Fills the gap for any player without a manager-set plan, with a default
 * that actually fits their real situation: youths get broad growth,
 * veterans get a maintenance focus that slows decline instead of chasing
 * gains that no longer come, and everyone else gets their weakest real
 * attribute group. This is the same default-filling shape Staff Market
 * Phase C uses for responsibility delegation — never overriding a plan the
 * manager (or a prior call) already set.
 */
export const ensureSensibleDevelopmentPlan = (
  db: GameDatabase,
  worldDate: string,
  teamId: EntityId,
): void => {
  const players = new PlayerRepository(db);
  const world = new WorldRepository(db);
  for (const attributes of players.attributesForTeam(teamId)) {
    if (world.activeIndividualDevelopmentPlan(attributes.personId)) continue;
    const person = db.prepare("SELECT date_of_birth FROM persons WHERE id = ?").get(attributes.personId) as
      | { date_of_birth?: string }
      | undefined;
    const age = person?.date_of_birth ? ageOn(person.date_of_birth, worldDate) : 25;
    const phase = developmentPhaseForAge(age);
    let focusType: DevelopmentFocusType;
    let intensity: TrainingIntensity;
    let targetAttributeGroup: "technical" | "mental" | "physical" | "goalkeeping" | undefined;
    if (phase === "LATE_PRIME" || phase === "DECLINE") {
      focusType = "MAINTENANCE";
      intensity = "LOW";
    } else if (phase === "YOUTH_DEVELOPMENT") {
      focusType = "BALANCED";
      intensity = "NORMAL";
    } else {
      focusType = "ATTRIBUTE";
      intensity = "NORMAL";
      targetAttributeGroup = weakestAttributeGroup(attributes);
    }
    const plan: IndividualDevelopmentPlan = {
      id: createEntityId(),
      playerId: attributes.personId,
      focusType,
      targetAttributeGroup,
      intensity,
      startDate: worldDate,
      endDate: addDaysISO(worldDate, DEVELOPMENT_BLOCK_DAYS),
      status: "ACTIVE",
    };
    world.upsertIndividualDevelopmentPlan(plan);
  }
};

const ageOn = (dateOfBirth: string, onDate: string): number => {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  const date = new Date(`${onDate}T00:00:00Z`);
  let age = date.getUTCFullYear() - birth.getUTCFullYear();
  if (
    date.getUTCMonth() < birth.getUTCMonth() ||
    (date.getUTCMonth() === birth.getUTCMonth() && date.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
};

export type DevelopmentPlanReviewOutcome = {
  recommendation: "GOAL_ACHIEVED" | "CONTINUE" | "CONSIDER_NEW_FOCUS";
  plateaued: boolean;
};

/**
 * Runs a review exactly once per block, when the plan's block has expired:
 * a retraining focus that reached the familiarity goal is marked complete,
 * a plateaued focus is flagged for the manager to reconsider (and given a
 * fresh block rather than silently running forever), everything else just
 * gets a fresh block and a "continue" note. Nothing here invents progress —
 * it reads the same state/history the daily engine already produced.
 */
export const reviewDevelopmentPlanIfDue = (
  db: GameDatabase,
  worldDate: string,
  plan: IndividualDevelopmentPlan,
  familiarity: number | undefined,
  recentAverageDeltas: number[],
): DevelopmentPlanReviewOutcome | undefined => {
  if (plan.status !== "ACTIVE" || !plan.endDate || worldDate < plan.endDate) return undefined;
  const world = new WorldRepository(db);
  const plateaued = isPlateaued(recentAverageDeltas);
  if ((plan.focusType === "POSITION" || plan.focusType === "ROLE") && (familiarity ?? 0) >= FAMILIARITY_GOAL) {
    world.upsertIndividualDevelopmentPlan({ ...plan, status: "COMPLETED", endDate: worldDate });
    return { recommendation: "GOAL_ACHIEVED", plateaued };
  }
  world.upsertIndividualDevelopmentPlan({
    ...plan,
    endDate: addDaysISO(worldDate, DEVELOPMENT_BLOCK_DAYS),
  });
  return { recommendation: plateaued ? "CONSIDER_NEW_FOCUS" : "CONTINUE", plateaued };
};
