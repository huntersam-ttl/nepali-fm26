import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  migrateDatabase,
  openGameDatabase,
  PlayerRepository,
  WorldRepository,
} from "@nepal-football-sim/database";
import {
  createDefaultTrainingPlan,
  createInitialDevelopmentState,
  familiarityLevel,
  simulateTrainingWeek,
} from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";
import type {
  Country,
  IndividualDevelopmentPlan,
  Person,
  PlayerAttributeSet,
  PlayerDevelopmentState,
  PlayerPlayingTimeSnapshot,
  PlayerPotential,
  TrainingPlan,
  TrainingSession,
} from "@nepal-football-sim/shared-types";

const tempDirs: string[] = [];

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-development-"));
  tempDirs.push(dir);
  return join(dir, "save.sqlite");
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("training and player development foundation", () => {
  it("develops young players faster than older players", () => {
    const young = runWeeks(18, 52);
    const older = runWeeks(35, 52);

    expect(average(young.updatedAttributes) - average(testingAttributes("p18"))).toBeGreaterThan(
      average(older.updatedAttributes) - average(testingAttributes("p35")),
    );
  });

  it("keeps prime players relatively stable", () => {
    const initial = testingAttributes("p27");
    const output = runWeeks(27, 52, { attributes: initial });

    expect(Math.abs(average(output.updatedAttributes) - average(initial))).toBeLessThan(0.7);
  });

  it("regresses older physical attributes", () => {
    const initial = testingAttributes("p36");
    const output = runWeeks(36, 52, { attributes: initial });

    expect(averageGroup(output.updatedAttributes.physical)).toBeLessThan(
      averageGroup(initial.physical),
    );
  });

  it("raises fatigue under very high training load", () => {
    const high = runWeeks(23, 4, { plan: loadPlan("VERY_HIGH") });
    const normal = runWeeks(23, 4, { plan: createDefaultTrainingPlan(teamId(), "2026-08-01") });

    expect(high.updatedState.fatigue).toBeGreaterThan(normal.updatedState.fatigue);
    expect(high.injuryRiskSignal.risk).toBeGreaterThan(normal.injuryRiskSignal.risk);
  });

  it("rest weeks reduce fatigue and improve recovery", () => {
    const state = { ...initialState(testingAttributes("rest"), 24), fatigue: 70, recovery: 35 };
    const output = runWeeks(24, 1, { state, plan: restPlan() });

    expect(output.updatedState.fatigue).toBeLessThan(70);
    expect(output.updatedState.recovery).toBeGreaterThan(35);
  });

  it("tracks match sharpness separately from fitness", () => {
    const active = runWeeks(22, 4, { playingTime: playingTime("active", 360) });
    const inactive = runWeeks(22, 4, { playingTime: playingTime("inactive", 0) });

    expect(active.updatedState.matchSharpness).toBeGreaterThan(
      inactive.updatedState.matchSharpness,
    );
    expect(active.updatedState.fitness).toBeGreaterThan(0);
  });

  it("trains new positions gradually without instant mastery", () => {
    const output = runWeeks(20, 8, { individualPlan: positionPlan("LB") });
    const familiarity = output.updatedState.positionFamiliarity.LB ?? 0;

    expect(familiarity).toBeGreaterThan(0);
    expect(familiarityLevel(familiarity)).not.toBe("NATURAL");
  });

  it("benefits more from good coaching than poor coaching", () => {
    const good = runWeeks(19, 52, { coachingQuality: 1.25 });
    const poor = runWeeks(19, 52, { coachingQuality: 0.7 });

    expect(average(good.updatedAttributes)).toBeGreaterThan(average(poor.updatedAttributes));
  });

  it("is deterministic for the same seed", () => {
    const first = runWeeks(19, 20, { seed: "same-seed" });
    const second = runWeeks(19, 20, { seed: "same-seed" });

    expect(second).toEqual(first);
  });

  it("persists player development state across save reload", () => {
    const databasePath = tempDbPath();
    let db = openGameDatabase(databasePath);
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const players = new PlayerRepository(db);
    const country: Country = {
      id: createStableEntityId("country", "NP"),
      name: "Nepal",
      isoCode: "NP",
    };
    const person: Person = {
      id: createStableEntityId("person", "testing-only-development-save"),
      fullName: "Testing-only Development Player",
      nationalityCountryId: country.id,
      languages: ["ne"],
    };
    const attributes = testingAttributes("save");
    const state = {
      ...initialState(attributes, 18),
      fatigue: 33,
      matchSharpness: 64,
      positionFamiliarity: { AM: 100, CM: 24 },
    };

    world.insertCountry(country);
    world.insertPerson(person);
    players.upsertDevelopmentState({ ...state, playerId: person.id });
    db.close();

    db = openGameDatabase(databasePath);
    migrateDatabase(db);
    expect(new PlayerRepository(db).developmentState(person.id)).toMatchObject({
      playerId: person.id,
      fatigue: 33,
      matchSharpness: 64,
      positionFamiliarity: { AM: 100, CM: 24 },
    });
    db.close();
  });
});

function runWeeks(
  age: number,
  weeks: number,
  options: {
    attributes?: PlayerAttributeSet;
    state?: PlayerDevelopmentState;
    plan?: TrainingPlan;
    individualPlan?: IndividualDevelopmentPlan;
    playingTime?: PlayerPlayingTimeSnapshot;
    coachingQuality?: number;
    seed?: string;
  } = {},
) {
  let date = "2026-08-01";
  let attributes = options.attributes ?? testingAttributes(`p${age}`);
  let state = options.state ?? initialState(attributes, age);
  const potential = potentialFor(attributes, age);
  for (let week = 0; week < weeks; week += 1) {
    const output = simulateTrainingWeek({
      attributes,
      state,
      potential,
      age,
      date,
      seed: options.seed ?? "development-test-seed",
      plan: options.plan ?? createDefaultTrainingPlan(teamId(), date),
      individualPlan: options.individualPlan,
      playingTime: options.playingTime ?? playingTime(attributes.personId, 180),
      environment: {
        coachingQuality: options.coachingQuality ?? 1,
        trainingQuality: 1,
        facilitiesEffect: 1,
      },
    });
    attributes = output.updatedAttributes;
    state = output.updatedState;
    date = addDays(date, 7);
  }
  return simulateTrainingWeek({
    attributes,
    state,
    potential,
    age,
    date,
    seed: options.seed ?? "development-test-seed",
    plan: options.plan ?? createDefaultTrainingPlan(teamId(), date),
    individualPlan: options.individualPlan,
    playingTime: options.playingTime ?? playingTime(attributes.personId, 180),
    environment: { coachingQuality: options.coachingQuality ?? 1 },
  });
}

function testingAttributes(key: string): PlayerAttributeSet {
  const personId = createStableEntityId("person", key);
  return {
    id: createStableEntityId("player-attribute", key),
    personId,
    primaryPosition: "AM",
    secondaryPositions: ["CM"],
    technical: {
      firstTouch: 10,
      passing: 10,
      crossing: 9,
      dribbling: 10,
      finishing: 10,
      heading: 9,
      tackling: 9,
      technique: 10,
      longShots: 9,
      setPieces: 9,
    },
    mental: {
      decisions: 10,
      vision: 10,
      composure: 10,
      positioning: 10,
      anticipation: 10,
      workRate: 10,
      teamwork: 10,
      leadership: 9,
      aggression: 9,
      determination: 11,
      professionalism: 10,
    },
    physical: {
      pace: 10,
      acceleration: 10,
      strength: 10,
      stamina: 10,
      agility: 10,
      balance: 10,
      jumping: 9,
      naturalFitness: 10,
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

function initialState(attributes: PlayerAttributeSet, age: number): PlayerDevelopmentState {
  return createInitialDevelopmentState(attributes, age, "2026-08-01");
}

function potentialFor(attributes: PlayerAttributeSet, age: number): PlayerPotential {
  return {
    id: createStableEntityId("player-potential", attributes.personId),
    playerId: attributes.personId,
    potentialCeiling: age < 25 ? 15 : 12,
    developmentRate: 1,
    volatility: 0.5,
    professionalism: 1,
    status: "SIMULATION_ONLY",
  };
}

function positionPlan(
  position: IndividualDevelopmentPlan["targetPosition"],
): IndividualDevelopmentPlan {
  return {
    id: createStableEntityId("individual-development-plan", `position-${position}`),
    playerId: createStableEntityId("person", "p20"),
    focusType: "POSITION",
    targetPosition: position,
    intensity: "NORMAL",
    startDate: "2026-08-01",
    status: "ACTIVE",
  };
}

function playingTime(key: string, minutes: number): PlayerPlayingTimeSnapshot {
  return {
    id: createStableEntityId("player-playing-time-snapshot", `${key}-${minutes}`),
    playerId: createStableEntityId("person", key),
    minutesLast30Days: minutes,
    minutesSeason: minutes,
    startsSeason: Math.floor(minutes / 90),
    subAppearances: 0,
    updatedOn: "2026-08-01",
  };
}

function loadPlan(intensity: TrainingPlan["intensity"]): TrainingPlan {
  const plan = createDefaultTrainingPlan(teamId(), "2026-08-01");
  const extraSessions: TrainingSession[] = [
    { day: "SATURDAY", slot: 1, category: "FITNESS", intensity, targetGroup: "FULL_SQUAD" },
    { day: "SUNDAY", slot: 1, category: "ENDURANCE", intensity, targetGroup: "FULL_SQUAD" },
  ];
  return {
    ...plan,
    intensity,
    sessions: [
      ...plan.sessions.filter((session) => session.category !== "REST"),
      ...extraSessions,
    ].map((session) => ({ ...session, intensity })),
  };
}

function restPlan(): TrainingPlan {
  const sessions: TrainingSession[] = [
    { day: "MONDAY", slot: 1, category: "REST", intensity: "LOW", targetGroup: "FULL_SQUAD" },
    { day: "TUESDAY", slot: 1, category: "RECOVERY", intensity: "LOW", targetGroup: "FULL_SQUAD" },
    { day: "WEDNESDAY", slot: 1, category: "REST", intensity: "LOW", targetGroup: "FULL_SQUAD" },
    { day: "THURSDAY", slot: 1, category: "RECOVERY", intensity: "LOW", targetGroup: "FULL_SQUAD" },
    { day: "FRIDAY", slot: 1, category: "REST", intensity: "LOW", targetGroup: "FULL_SQUAD" },
  ];
  return {
    ...createDefaultTrainingPlan(teamId(), "2026-08-01"),
    sessions,
  };
}

function teamId() {
  return createStableEntityId("team", "testing-only-development");
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
