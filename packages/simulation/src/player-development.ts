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
  plan?: TrainingPlan;
  individualPlan?: IndividualDevelopmentPlan;
  playingTime?: PlayerPlayingTimeSnapshot;
  environment?: DevelopmentEnvironment;
  curve?: PlayerDevelopmentCurve;
  periodDays?: number;
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
  const sessions =
    input.plan?.sessions ?? createDefaultTrainingPlan("unassigned", input.date).sessions;
  const load = trainingLoadForSessions(sessions);
  const restCount = sessions.filter((training) => training.category === "REST").length;
  const recoveryCount = sessions.filter((training) => training.category === "RECOVERY").length;
  const random = new SeededRandom(`${input.seed}:${input.attributes.personId}:${input.date}`);
  const variation = 0.94 + random.next() * 0.12;
  const environment = normalizeEnvironment(input.environment);
  const sharpnessDelta = sharpnessChange(input.playingTime) * periodScale;
  const updatedState: PlayerDevelopmentState = {
    ...input.state,
    developmentPhase: phase,
    trainingLoad: round(clamp(input.state.trainingLoad * 0.55 + load * 0.45, 0, 100)),
    fatigue: round(
      clamp(
        input.state.fatigue +
          ((load - 38) * 0.18 - restCount * 3.2 - recoveryCount * 1.7) * periodScale,
        0,
        100,
      ),
    ),
    matchSharpness: round(clamp(input.state.matchSharpness + sharpnessDelta, 0, 100)),
    fitness: round(
      clamp(
        input.state.fitness +
          (fitnessStimulus(sessions) * 0.08 - input.state.fatigue * 0.012 + recoveryCount * 0.18) *
            periodScale,
        0,
        100,
      ),
    ),
    recovery: round(
      clamp(
        input.state.recovery +
          (restCount * 5.5 + recoveryCount * 3 - Math.max(0, load - 45) * 0.12) * periodScale,
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
  const phaseRegression = regressionPressure(phase);
  const loadStimulus = clamp(0.75 + load / 120, 0.65, 1.35);
  const fatigueDrag = clamp(1 - updatedState.fatigue / 180, 0.45, 1.05);
  const fitnessModifier = clamp(updatedState.fitness / 88, 0.55, 1.08);
  const traitModifier = clamp(
    (input.potential.developmentRate + input.potential.professionalism) / 2,
    0.35,
    1.6,
  );
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
    periodScale;
  const cappedDevelopmentDelta = clamp(developmentDelta, -0.06 * periodScale, 0.08 * periodScale);
  const attributeGroups = targetAttributeGroups(input.attributes, sessions, input.individualPlan);
  const updatedAttributes = developAttributes(
    input.attributes,
    attributeGroups,
    cappedDevelopmentDelta,
    phaseRegression * periodScale,
  );

  applyPositionAndRoleFamiliarity(
    updatedState,
    input.individualPlan,
    environment.coachingQuality,
    periodScale,
  );
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

const applyPositionAndRoleFamiliarity = (
  state: PlayerDevelopmentState,
  plan: IndividualDevelopmentPlan | undefined,
  coachingQuality: number,
  periodScale: number,
): void => {
  if (plan?.status !== "ACTIVE") return;
  const intensity = intensityWeight[plan.intensity];
  const gain = clamp(0.75 * intensity * coachingQuality * periodScale, 0.1, 1.8 * periodScale);
  if (plan.focusType === "POSITION" && plan.targetPosition) {
    const current = state.positionFamiliarity[plan.targetPosition] ?? 0;
    state.positionFamiliarity = {
      ...state.positionFamiliarity,
      [plan.targetPosition]: round(clamp(current + gain, 0, 100)),
    };
  }
  if (plan.focusType === "ROLE" && plan.targetRole) {
    const current = state.roleFamiliarity[plan.targetRole] ?? 0;
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
  if (input.individualPlan?.focusType === "POSITION" && input.individualPlan.targetPosition) {
    const familiarity = state.positionFamiliarity[input.individualPlan.targetPosition] ?? 0;
    events.push(
      history(input, "POSITION_FAMILIARITY_INCREASED", {
        position: input.individualPlan.targetPosition,
        familiarity,
        level: familiarityLevel(familiarity),
      }),
    );
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
    `${input.attributes.personId}-${input.date}-${eventType}-${JSON.stringify(data)}`,
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
