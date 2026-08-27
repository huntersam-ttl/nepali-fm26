import {
  createStableEntityId,
  type DevelopmentPhase,
  type FamiliarityLevel,
  type IndividualDevelopmentPlan,
  type PlayerAttributeSet,
  type PlayerDevelopmentCurve,
  type PlayerDevelopmentState,
  type PlayerPlayingTimeSnapshot,
  type PlayerPosition,
  type PlayerPotential,
  type TrainingHistoryEvent,
  type TrainingInjuryRiskSignal,
  type TrainingIntensity,
  type TrainingPlan,
  type TrainingSession,
} from "@nepal-football-sim/shared-types";
import { SeededRandom } from "./rng.js";

export type DevelopmentEnvironment = {
  trainingQuality?: number;
  coachingQuality?: number;
  facilitiesEffect?: number;
  moraleModifier?: number;
  competitionMultiplier?: number;
};

export type PlayerDevelopmentInput = {
  attributes: PlayerAttributeSet;
  state: PlayerDevelopmentState;
  potential: PlayerPotential;
  age: number;
  date: string;
  seed: string;
  /** Stable owner of a persisted development cycle (season/team when available). */
  historyScope?: string;
  plan?: TrainingPlan;
  individualPlan?: IndividualDevelopmentPlan;
  playingTime?: PlayerPlayingTimeSnapshot;
  environment?: DevelopmentEnvironment;
  curve?: PlayerDevelopmentCurve;
  periodDays?: number;
  /**
   * FULL (default) trains normally. INJURED means the player is in rehab,
   * not training — attribute growth and retraining familiarity gains are
   * suspended, only rest/recovery progresses. RETURNING dampens both by a
   * ramp factor for a short window after clearance, instead of resuming at
   * full load on day one.
   */
  trainingAvailability?: "FULL" | "INJURED" | "RETURNING";
};

export type PlayerDevelopmentOutput = {
  updatedAttributes: PlayerAttributeSet;
  updatedState: PlayerDevelopmentState;
  injuryRiskSignal: TrainingInjuryRiskSignal;
  historyEvents: TrainingHistoryEvent[];
};

const defaultCurve: PlayerDevelopmentCurve = {
  id: createStableEntityId("development-curve", "default"),
  name: "Default configurable development curve",
  youthMaxAge: 20,
  earlyCareerMaxAge: 24,
  primeMaxAge: 29,
  latePrimeMaxAge: 33,
};

const intensityWeight: Record<TrainingIntensity, number> = {
  LOW: 0.7,
  NORMAL: 1,
  HIGH: 1.25,
  VERY_HIGH: 1.55,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
const round = (value: number): number => Math.round(value * 100) / 100;

export const createDefaultTrainingPlan = (teamId: string, effectiveFrom: string): TrainingPlan => ({
  id: createStableEntityId("training-plan", `${teamId}-${effectiveFrom}-default`),
  teamId: teamId as TrainingPlan["teamId"],
  name: "Balanced weekly training",
  effectiveFrom,
  intensity: "NORMAL",
  source: "DEFAULT",
  sessions: [
    session("MONDAY", 1, "RECOVERY", "LOW", "FULL_SQUAD"),
    session("TUESDAY", 1, "TECHNICAL_GENERAL", "NORMAL", "FULL_SQUAD"),
    session("WEDNESDAY", 1, "TACTICAL_GENERAL", "NORMAL", "FULL_SQUAD"),
    session("THURSDAY", 1, "FITNESS", "NORMAL", "FULL_SQUAD"),
    session("FRIDAY", 1, "MATCH_PREPARATION", "LOW", "FULL_SQUAD"),
    session("SUNDAY", 1, "REST", "LOW", "FULL_SQUAD"),
  ],
});

export const createInitialDevelopmentState = (
  attributes: PlayerAttributeSet,
  age: number,
  date: string,
  curve: PlayerDevelopmentCurve = defaultCurve,
): PlayerDevelopmentState => ({
  id: createStableEntityId("player-development-state", attributes.personId),
  playerId: attributes.personId,
  developmentPhase: developmentPhaseForAge(age, curve),
  trainingLoad: 45,
  fatigue: 15,
  matchSharpness: 55,
  fitness: 88,
  recovery: 78,
  developmentMomentum: 0,
  positionFamiliarity: { [attributes.primaryPosition]: 100 },
  roleFamiliarity: {},
  lastTrainingDate: date,
  lastDevelopmentUpdate: date,
});

export const developmentPhaseForAge = (
  age: number,
  curve: PlayerDevelopmentCurve = defaultCurve,
): DevelopmentPhase => {
  if (age <= curve.youthMaxAge) return "YOUTH_DEVELOPMENT";
  if (age <= curve.earlyCareerMaxAge) return "EARLY_CAREER";
  if (age <= curve.primeMaxAge) return "PRIME";
  if (age <= curve.latePrimeMaxAge) return "LATE_PRIME";
  return "DECLINE";
};

export const familiarityLevel = (value: number): FamiliarityLevel => {
  if (value >= 90) return "NATURAL";
  if (value >= 70) return "ACCOMPLISHED";
  if (value >= 45) return "COMPETENT";
  if (value >= 20) return "BASIC";
  return "UNFAMILIAR";
};

export const simulateTrainingDay = (input: PlayerDevelopmentInput): PlayerDevelopmentOutput => {
  const day = dayName(input.date);
  const dayPlan = input.plan
    ? { ...input.plan, sessions: input.plan.sessions.filter((training) => training.day === day) }
    : undefined;
  return updatePlayerDevelopment({ ...input, plan: dayPlan, periodDays: 1 });
};

export const simulateTrainingWeek = (input: PlayerDevelopmentInput): PlayerDevelopmentOutput =>
  updatePlayerDevelopment({ ...input, periodDays: 7 });

export const updatePlayerDevelopment = (input: PlayerDevelopmentInput): PlayerDevelopmentOutput => {
  const periodScale = clamp(input.periodDays ?? 7, 1, 31) / 7;
  const phase = developmentPhaseForAge(input.age, input.curve);
  const availability = input.trainingAvailability ?? "FULL";
  const injured = availability === "INJURED";
  const returning = availability === "RETURNING";
  const sessions =
    input.plan?.sessions ?? createDefaultTrainingPlan("unassigned", input.date).sessions;
  // Injured players are in rehab, not training — the plan's sessions do not
  // apply. A returning player is eased back in at reduced effective load
  // rather than resuming the full plan on day one.
  const load = injured ? 12 : returning ? trainingLoadForSessions(sessions) * 0.6 : trainingLoadForSessions(sessions);
  const restCount = injured ? sessions.length : sessions.filter((training) => training.category === "REST").length;
  const recoveryCount = injured
    ? 0
    : sessions.filter((training) => training.category === "RECOVERY").length;
  const random = new SeededRandom(`${input.seed}:${input.attributes.personId}:${input.date}`);
  const variation = 0.94 + random.next() * 0.12;
  const environment = normalizeEnvironment(input.environment);
  const sharpnessDelta = (injured ? -2.2 : sharpnessChange(input.playingTime)) * periodScale;
  const updatedState: PlayerDevelopmentState = {
    ...input.state,
    developmentPhase: phase,
    trainingLoad: round(clamp(input.state.trainingLoad * 0.55 + load * 0.45, 0, 100)),
    fatigue: round(
      clamp(
        input.state.fatigue +
          ((load - 38) * 0.18 - restCount * 3.2 - recoveryCount * 1.7 - (injured ? 4 : 0)) *
            periodScale,
        0,
        100,
      ),
    ),
    matchSharpness: round(clamp(input.state.matchSharpness + sharpnessDelta, 0, 100)),
    fitness: round(
      clamp(
        input.state.fitness +
          ((injured ? -1.5 : fitnessStimulus(sessions) * 0.08) -
            input.state.fatigue * 0.012 +
            recoveryCount * 0.18) *
            periodScale,
        0,
        100,
      ),
    ),
    recovery: round(
      clamp(
        input.state.recovery +
          (restCount * 5.5 + recoveryCount * 3 - Math.max(0, load - 45) * 0.12 + (injured ? 6 : 0)) *
            periodScale,
        0,
        100,
      ),
    ),
    developmentMomentum: input.state.developmentMomentum,
    lastTrainingDate: input.date,
    lastDevelopmentUpdate: input.date,
  };

  const beforeAverage = averageAttributes(input.attributes);
  const potentialGap = clamp(input.potential.potentialCeiling - beforeAverage, -8, 10);
  const phaseGrowth = growthMultiplier(phase);
  // A maintenance plan trades growth ambition for slower decline once a
  // player is past their prime — the point is to hold the line, not improve.
  const maintaining =
    input.individualPlan?.status === "ACTIVE" &&
    input.individualPlan.focusType === "MAINTENANCE" &&
    (phase === "LATE_PRIME" || phase === "DECLINE");
  const phaseRegression = regressionPressure(phase) * (maintaining ? 0.55 : 1);
  const loadStimulus = clamp(0.75 + load / 120, 0.65, 1.35);
  const fatigueDrag = clamp(1 - updatedState.fatigue / 180, 0.45, 1.05);
  const fitnessModifier = clamp(updatedState.fitness / 88, 0.55, 1.08);
  const traitModifier = clamp(
    (input.potential.developmentRate + input.potential.professionalism) / 2,
    0.35,
    1.6,
  );
  // Injured players earn no training-driven growth (rehab is not practice);
  // a returning player's growth is ramped rather than immediately full.
  const availabilityGrowthFactor = injured ? 0 : returning ? 0.5 : 1;
  const developmentDelta =
    potentialGap *
    0.0045 *
    phaseGrowth *
    loadStimulus *
    fatigueDrag *
    fitnessModifier *
    traitModifier *
    environment.trainingQuality *
    environment.coachingQuality *
    environment.facilitiesEffect *
    environment.moraleModifier *
    environment.competitionMultiplier *
    variation *
    periodScale *
    availabilityGrowthFactor;
  const cappedDevelopmentDelta = clamp(developmentDelta, -0.06 * periodScale, 0.08 * periodScale);
  const attributeGroups = targetAttributeGroups(input.attributes, sessions, input.individualPlan);
  const updatedAttributes = injured
    ? input.attributes
    : developAttributes(
        input.attributes,
        attributeGroups,
        cappedDevelopmentDelta,
        phaseRegression * periodScale,
      );

  if (!injured) {
    applyPositionAndRoleFamiliarity(
      updatedState,
      input.individualPlan,
      environment.coachingQuality * environment.facilitiesEffect,
      input.potential.professionalism,
      input.age,
      input.playingTime,
      periodScale * availabilityGrowthFactor,
    );
  }
  updatedState.developmentMomentum = round(
    clamp(
      input.state.developmentMomentum * 0.7 +
        (averageAttributes(updatedAttributes) - beforeAverage) * 10,
      -100,
      100,
    ),
  );

  const injuryRiskSignal = trainingInjuryRiskSignal(updatedState);
  const historyEvents = historyForChange(
    input,
    updatedState,
    beforeAverage,
    averageAttributes(updatedAttributes),
  );
  return { updatedAttributes, updatedState, injuryRiskSignal, historyEvents };
};

export const trainingInjuryRiskSignal = (
  state: PlayerDevelopmentState,
): TrainingInjuryRiskSignal => {
  const risk =
    0.015 +
    state.trainingLoad / 650 +
    state.fatigue / 520 -
    state.recovery / 900 -
    state.fitness / 1200;
  return {
    playerId: state.playerId,
    load: state.trainingLoad,
    fatigue: state.fatigue,
    recovery: state.recovery,
    physicalCondition: state.fitness,
    risk: round(clamp(risk, 0.005, 0.22)),
  };
};

/**
 * Plateau/diminishing-return detection from a run of recent average-attribute
 * deltas (oldest first): true once there have been enough consecutive
 * near-zero periods that continuing the same plan is no longer paying off.
 */
export const isPlateaued = (recentAverageDeltas: number[], threshold = 0.03): boolean =>
  recentAverageDeltas.length >= 3 && recentAverageDeltas.every((delta) => Math.abs(delta) < threshold);

const session = (
  day: TrainingSession["day"],
  slot: number,
  category: TrainingSession["category"],
  intensity: TrainingIntensity,
  targetGroup: TrainingSession["targetGroup"],
): TrainingSession => ({ day, slot, category, intensity, targetGroup });

const normalizeEnvironment = (
  environment: DevelopmentEnvironment | undefined,
): Required<DevelopmentEnvironment> => ({
  trainingQuality: environment?.trainingQuality ?? 1,
  coachingQuality: environment?.coachingQuality ?? 1,
  facilitiesEffect: environment?.facilitiesEffect ?? 1,
  moraleModifier: environment?.moraleModifier ?? 1,
  competitionMultiplier: environment?.competitionMultiplier ?? 1,
});

const trainingLoadForSessions = (sessions: readonly TrainingSession[]): number => {
  if (sessions.length === 0) return 18;
  const total = sessions.reduce((sum, session) => {
    const base = session.category === "REST" ? 5 : session.category === "RECOVERY" ? 18 : 42;
    return sum + base * intensityWeight[session.intensity];
  }, 0);
  return clamp(total / Math.max(1, sessions.length) + Math.max(0, sessions.length - 5) * 4, 0, 100);
};

const fitnessStimulus = (sessions: readonly TrainingSession[]): number =>
  sessions
    .filter((session) =>
      ["FITNESS", "ENDURANCE", "STRENGTH", "SPEED", "AGILITY"].includes(session.category),
    )
    .reduce((sum, session) => sum + intensityWeight[session.intensity], 0);

const sharpnessChange = (playingTime: PlayerPlayingTimeSnapshot | undefined): number => {
  const minutes = playingTime?.minutesLast30Days ?? 0;
  if (minutes <= 0) return -1.4;
  return clamp(minutes / 90, 0, 4) * 1.4;
};

const growthMultiplier = (phase: DevelopmentPhase): number =>
  ({
    YOUTH_DEVELOPMENT: 1.35,
    EARLY_CAREER: 1.05,
    PRIME: 0.22,
    LATE_PRIME: 0,
    DECLINE: -0.12,
  })[phase];

const regressionPressure = (phase: DevelopmentPhase): number =>
  ({
    YOUTH_DEVELOPMENT: 0,
    EARLY_CAREER: 0,
    PRIME: 0,
    LATE_PRIME: 0.008,
    DECLINE: 0.026,
  })[phase];

const targetAttributeGroups = (
  attributes: PlayerAttributeSet,
  sessions: readonly TrainingSession[],
  plan: IndividualDevelopmentPlan | undefined,
): Array<keyof Pick<PlayerAttributeSet, "technical" | "mental" | "physical" | "goalkeeping">> => {
  if (plan?.targetAttributeGroup) return [plan.targetAttributeGroup];
  // Maintenance is light physical upkeep only — it is not meant to chase growth.
  if (plan?.focusType === "MAINTENANCE") return ["physical"];
  if (plan?.focusType === "PHYSICAL") return ["physical"];
  if (plan?.focusType === "TECHNICAL") return ["technical"];
  if (plan?.focusType === "MENTAL") return ["mental"];
  if (
    sessions.some((session) => session.category.startsWith("GK")) ||
    attributes.primaryPosition === "GK"
  ) {
    return ["goalkeeping", "mental", "physical"];
  }
  const groups = new Set<"technical" | "mental" | "physical">();
  for (const training of sessions) {
    if (["FITNESS", "ENDURANCE", "STRENGTH", "SPEED", "AGILITY"].includes(training.category)) {
      groups.add("physical");
    }
    if (
      [
        "TECHNICAL_GENERAL",
        "PASSING",
        "FIRST_TOUCH",
        "DRIBBLING",
        "FINISHING",
        "CROSSING",
        "DEFENDING",
        "TACKLING",
        "HEADING",
        "SET_PIECES_ATTACK",
      ].includes(training.category)
    ) {
      groups.add("technical");
    }
    if (
      [
        "TACTICAL_GENERAL",
        "ATTACKING_SHAPE",
        "DEFENSIVE_SHAPE",
        "PRESSING",
        "TRANSITION",
        "POSSESSION",
        "COUNTER_ATTACK",
        "MATCH_PREPARATION",
        "TEAM_BONDING",
        "VIDEO_ANALYSIS",
      ].includes(training.category)
    ) {
      groups.add("mental");
    }
  }
  return groups.size > 0 ? [...groups] : ["technical", "mental", "physical"];
};

const developAttributes = (
  attributes: PlayerAttributeSet,
  groups: ReturnType<typeof targetAttributeGroups>,
  developmentDelta: number,
  physicalRegression: number,
): PlayerAttributeSet => ({
  ...attributes,
  technical: groups.includes("technical")
    ? adjustGroup(attributes.technical, developmentDelta)
    : attributes.technical,
  mental: groups.includes("mental")
    ? adjustGroup(attributes.mental, developmentDelta * 0.85)
    : attributes.mental,
  physical: adjustGroup(
    attributes.physical,
    (groups.includes("physical") ? developmentDelta : 0) - physicalRegression,
  ),
  goalkeeping: groups.includes("goalkeeping")
    ? adjustGroup(attributes.goalkeeping, developmentDelta)
    : attributes.goalkeeping,
});

const adjustGroup = <T extends Record<string, number>>(group: T, delta: number): T =>
  Object.fromEntries(
    Object.entries(group).map(([key, value]) => [key, round(clamp(value + delta, 1, 20))]),
  ) as T;

/** Older players pick up an unfamiliar position/role more slowly than teenagers do. */
const ageRetrainingFactor = (age: number): number => clamp(1.35 - (age - 18) * 0.02, 0.55, 1.35);

/** Getting minutes in a real match is worth more than the training pitch alone. */
const exposureFactor = (playingTime: PlayerPlayingTimeSnapshot | undefined): number =>
  (playingTime?.minutesLast30Days ?? 0) > 0 ? 1.12 : 0.82;

const applyPositionAndRoleFamiliarity = (
  state: PlayerDevelopmentState,
  plan: IndividualDevelopmentPlan | undefined,
  coachingAndFacilities: number,
  professionalism: number,
  age: number,
  playingTime: PlayerPlayingTimeSnapshot | undefined,
  periodScale: number,
): void => {
  if (plan?.status !== "ACTIVE") return;
  const intensity = intensityWeight[plan.intensity];
  const professionalismFactor = clamp(professionalism, 0.6, 1.3);
  const baseGain =
    0.75 *
    intensity *
    coachingAndFacilities *
    professionalismFactor *
    ageRetrainingFactor(age) *
    exposureFactor(playingTime) *
    periodScale;
  const applyDiminishing = (current: number): number =>
    // Diminishing returns: the closer to full familiarity, the harder each
    // further point is to earn.
    clamp(baseGain * clamp(1 - current / 130, 0.2, 1), 0.05 * periodScale, 1.8 * periodScale);
  if (plan.focusType === "POSITION" && plan.targetPosition) {
    const current = state.positionFamiliarity[plan.targetPosition] ?? 0;
    const gain = applyDiminishing(current);
    state.positionFamiliarity = {
      ...state.positionFamiliarity,
      [plan.targetPosition]: round(clamp(current + gain, 0, 100)),
    };
  }
  if (plan.focusType === "ROLE" && plan.targetRole) {
    const current = state.roleFamiliarity[plan.targetRole] ?? 0;
    const gain = applyDiminishing(current);
    state.roleFamiliarity = {
      ...state.roleFamiliarity,
      [plan.targetRole]: round(clamp(current + gain, 0, 100)),
    };
  }
};

const historyForChange = (
  input: PlayerDevelopmentInput,
  state: PlayerDevelopmentState,
  beforeAverage: number,
  afterAverage: number,
): TrainingHistoryEvent[] => {
  const events: TrainingHistoryEvent[] = [];
  const delta = afterAverage - beforeAverage;
  if (delta >= 0.05) {
    events.push(history(input, "ATTRIBUTE_IMPROVED", { averageDelta: round(delta) }));
  }
  if (delta <= -0.05) {
    events.push(history(input, "ATTRIBUTE_DECLINED", { averageDelta: round(delta) }));
  }
  if (input.individualPlan?.status === "ACTIVE" && input.individualPlan.focusType === "POSITION" && input.individualPlan.targetPosition) {
    const position = input.individualPlan.targetPosition;
    const before = input.state.positionFamiliarity[position] ?? 0;
    const familiarity = state.positionFamiliarity[position] ?? 0;
    events.push(history(input, "POSITION_FAMILIARITY_INCREASED", { position, familiarity, level: familiarityLevel(familiarity) }));
    if (before < 70 && familiarity >= 70) {
      events.push(history(input, "RETRAINING_MILESTONE_REACHED", { position, familiarity, level: familiarityLevel(familiarity) }));
    }
  }
  if (input.individualPlan?.status === "ACTIVE" && input.individualPlan.focusType === "ROLE" && input.individualPlan.targetRole) {
    const role = input.individualPlan.targetRole;
    const before = input.state.roleFamiliarity[role] ?? 0;
    const familiarity = state.roleFamiliarity[role] ?? 0;
    events.push(history(input, "ROLE_FAMILIARITY_INCREASED", { role, familiarity, level: familiarityLevel(familiarity) }));
    if (before < 70 && familiarity >= 70) {
      events.push(history(input, "RETRAINING_MILESTONE_REACHED", { role, familiarity, level: familiarityLevel(familiarity) }));
    }
  }
  if (state.trainingLoad >= 70 && state.fatigue >= 65) {
    events.push(
      history(input, "PLAYER_OVERTRAINED", { load: state.trainingLoad, fatigue: state.fatigue }),
    );
  }
  if (input.state.fatigue >= 55 && state.fatigue < 45) {
    events.push(history(input, "PLAYER_RETURNED_TO_FULL_TRAINING", { fatigue: state.fatigue }));
  }
  return events;
};

const history = (
  input: PlayerDevelopmentInput,
  eventType: TrainingHistoryEvent["eventType"],
  data: Record<string, unknown>,
): TrainingHistoryEvent => ({
  id: createStableEntityId(
    "training-history-event",
    `${input.historyScope ?? "default"}:${input.attributes.personId}:${input.date}:${eventType}:${JSON.stringify(data)}`,
  ),
  playerId: input.attributes.personId,
  eventType,
  occurredOn: input.date,
  data,
});

const averageAttributes = (attributes: PlayerAttributeSet): number => {
  const values = [
    ...Object.values(attributes.technical),
    ...Object.values(attributes.mental),
    ...Object.values(attributes.physical),
    ...Object.values(attributes.goalkeeping),
  ];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const dayName = (date: string): TrainingSession["day"] => {
  const names: TrainingSession["day"][] = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];
  return names[new Date(`${date}T00:00:00.000Z`).getUTCDay()]!;
};

export type PositionTrainingTarget = PlayerPosition;
