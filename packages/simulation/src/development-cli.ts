import {
  createStableEntityId,
  type IndividualDevelopmentPlan,
  type PlayerAttributeSet,
  type PlayerDevelopmentState,
  type PlayerPlayingTimeSnapshot,
  type PlayerPotential,
} from "@nepal-football-sim/shared-types";
import {
  createDefaultTrainingPlan,
  createInitialDevelopmentState,
  familiarityLevel,
  simulateTrainingWeek,
} from "./player-development.js";

type Scenario = {
  label: string;
  age: number;
  potentialCeiling: number;
  developmentRate: number;
};

const scenarios: Scenario[] = [
  { label: "young", age: 18, potentialCeiling: 15.5, developmentRate: 1.2 },
  { label: "prime", age: 27, potentialCeiling: 13.5, developmentRate: 1 },
  { label: "older", age: 35, potentialCeiling: 12, developmentRate: 0.75 },
];

const seasons = [1, 3, 5];
const seed = "testing-only-development-diagnostic";
const startDate = "2026-08-01";
const plan = createDefaultTrainingPlan(
  createStableEntityId("team", "testing-only-development"),
  startDate,
);

const runScenario = (scenario: Scenario, seasonCount: number) => {
  let date = startDate;
  let attributes = testingAttributes(scenario.label);
  const initialAverage = average(attributes);
  const initialPhysical = averageGroup(attributes.physical);
  const potential: PlayerPotential = {
    id: createStableEntityId("player-potential", scenario.label),
    playerId: attributes.personId,
    potentialCeiling: scenario.potentialCeiling,
    developmentRate: scenario.developmentRate,
    volatility: 0.6,
    professionalism: 1.05,
    status: "SIMULATION_ONLY",
  };
  let state: PlayerDevelopmentState = createInitialDevelopmentState(attributes, scenario.age, date);
  const individualPlan: IndividualDevelopmentPlan = {
    id: createStableEntityId("individual-development-plan", `${scenario.label}-position`),
    playerId: attributes.personId,
    focusType: "POSITION",
    targetPosition: "CM",
    intensity: "NORMAL",
    startDate,
    status: "ACTIVE",
  };
  let improvedEvents = 0;
  let declinedEvents = 0;
  let lastRisk = 0;

  for (let week = 0; week < seasonCount * 52; week += 1) {
    const playingTime: PlayerPlayingTimeSnapshot = {
      id: createStableEntityId("player-playing-time-snapshot", `${scenario.label}-${week}`),
      playerId: attributes.personId,
      minutesLast30Days: scenario.label === "older" ? 120 : 270,
      minutesSeason: week * (scenario.label === "older" ? 30 : 70),
      startsSeason: Math.floor(week / 2),
      subAppearances: Math.floor(week / 3),
      updatedOn: date,
    };
    const output = simulateTrainingWeek({
      attributes,
      state,
      potential,
      age: scenario.age + Math.floor(week / 52),
      date,
      seed,
      plan,
      individualPlan,
      playingTime,
      environment: {
        trainingQuality: 1,
        coachingQuality: 1,
        facilitiesEffect: 1,
      },
    });
    attributes = output.updatedAttributes;
    state = output.updatedState;
    lastRisk = output.injuryRiskSignal.risk;
    improvedEvents += output.historyEvents.filter(
      (event) => event.eventType === "ATTRIBUTE_IMPROVED",
    ).length;
    declinedEvents += output.historyEvents.filter(
      (event) => event.eventType === "ATTRIBUTE_DECLINED",
    ).length;
    date = addDays(date, 7);
  }

  const cmFamiliarity = state.positionFamiliarity.CM ?? 0;
  return {
    scenario: scenario.label,
    seasons: seasonCount,
    averageAttributeChange: round(average(attributes) - initialAverage),
    physicalAttributeChange: round(averageGroup(attributes.physical) - initialPhysical),
    fitness: state.fitness,
    matchSharpness: state.matchSharpness,
    trainingLoad: state.trainingLoad,
    fatigue: state.fatigue,
    recovery: state.recovery,
    cmFamiliarity,
    cmFamiliarityLevel: familiarityLevel(cmFamiliarity),
    improvedEvents,
    declinedEvents,
    trainingInjuryRiskSignal: lastRisk,
  };
};

const report = scenarios.flatMap((scenario) =>
  seasons.map((seasonCount) => runScenario(scenario, seasonCount)),
);
console.log(JSON.stringify({ seed, startDate, report }, null, 2));

function testingAttributes(label: string): PlayerAttributeSet {
  const id = createStableEntityId("person", `testing-only-${label}-player`);
  const base = label === "young" ? 9 : label === "prime" ? 12 : 11;
  return {
    id: createStableEntityId("player-attribute", label),
    personId: id,
    primaryPosition: "AM",
    secondaryPositions: ["CM"],
    technical: {
      firstTouch: base,
      passing: base,
      crossing: base - 1,
      dribbling: base,
      finishing: base,
      heading: base - 1,
      tackling: base - 1,
      technique: base,
      longShots: base - 1,
      setPieces: base - 1,
    },
    mental: {
      decisions: base,
      vision: base,
      composure: base,
      positioning: base,
      anticipation: base,
      workRate: base,
      teamwork: base,
      leadership: base - 1,
      aggression: base - 1,
      determination: base + 1,
      professionalism: base,
    },
    physical: {
      pace: base,
      acceleration: base,
      strength: base,
      stamina: base,
      agility: base,
      balance: base,
      jumping: base - 1,
      naturalFitness: base,
    },
    goalkeeping: {
      handling: 2,
      reflexes: 2,
      oneOnOnes: 2,
      aerialReach: 2,
      kicking: 2,
      distribution: 2,
      commandOfArea: 2,
    },
  };
}

function average(attributes: PlayerAttributeSet): number {
  return averageGroup({
    ...attributes.technical,
    ...attributes.mental,
    ...attributes.physical,
    ...attributes.goalkeeping,
  });
}

function averageGroup(group: Record<string, number>): number {
  const values = Object.values(group);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
