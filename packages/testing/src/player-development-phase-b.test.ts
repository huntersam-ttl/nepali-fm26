import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDatabase, openGameDatabase, PlayerRepository, WorldRepository } from "@nepal-football-sim/database";
import {
  computeCongestionMultiplier,
  createDefaultTrainingPlan,
  createInitialDevelopmentState,
  ensureSensibleDevelopmentPlan,
  isPlateaued,
  reviewDevelopmentPlanIfDue,
  simulateTrainingWeek,
  trainingAvailabilityFor,
} from "@nepal-football-sim/simulation";
import { createStableEntityId } from "@nepal-football-sim/shared-types";
import type { DevelopmentEnvironment } from "@nepal-football-sim/simulation";
import type {
  Country,
  FixtureRecord,
  IndividualDevelopmentPlan,
  Person,
  PlayerAttributeSet,
  PlayerDevelopmentState,
  PlayerPlayingTimeSnapshot,
  PlayerPotential,
} from "@nepal-football-sim/shared-types";

const tempDirs: string[] = [];
const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-development-b-"));
  tempDirs.push(dir);
  return join(dir, "save.sqlite");
};
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const attributesFor = (key: string, primaryPosition: PlayerAttributeSet["primaryPosition"] = "AM"): PlayerAttributeSet => ({
  id: createStableEntityId("player-attribute", key),
  personId: createStableEntityId("person", key),
  primaryPosition,
  secondaryPositions: [],
  technical: { firstTouch: 10, passing: 10, crossing: 9, dribbling: 10, finishing: 10, heading: 9, tackling: 9, technique: 10, longShots: 9, setPieces: 9 },
  mental: { decisions: 10, vision: 10, composure: 10, positioning: 10, anticipation: 10, workRate: 10, teamwork: 10, leadership: 9, aggression: 9, determination: 11, professionalism: 10 },
  physical: { pace: 10, acceleration: 10, strength: 10, stamina: 10, agility: 10, balance: 10, jumping: 9, naturalFitness: 10 },
  goalkeeping: { handling: 2, reflexes: 2, oneOnOnes: 2, aerialReach: 2, kicking: 2, distribution: 2, commandOfArea: 2 },
});

const potentialFor = (attributes: PlayerAttributeSet): PlayerPotential => ({
  id: createStableEntityId("player-potential", attributes.personId),
  playerId: attributes.personId,
  potentialCeiling: 16,
  developmentRate: 1,
  volatility: 0.5,
  professionalism: 1,
  status: "SIMULATION_ONLY",
});

const positionPlan = (
  playerId: string,
  targetPosition: IndividualDevelopmentPlan["targetPosition"],
  status: IndividualDevelopmentPlan["status"] = "ACTIVE",
): IndividualDevelopmentPlan => ({
  id: createStableEntityId("individual-development-plan", `${playerId}-${targetPosition}`),
  playerId: createStableEntityId("person", playerId),
  focusType: "POSITION",
  targetPosition,
  intensity: "NORMAL",
  startDate: "2026-08-01",
  status,
});

const average = (attributes: PlayerAttributeSet): number => {
  const values = [...Object.values(attributes.technical), ...Object.values(attributes.mental), ...Object.values(attributes.physical), ...Object.values(attributes.goalkeeping)];
  return values.reduce((sum, v) => sum + v, 0) / values.length;
};

const runWeeksWith = (
  age: number,
  weeks: number,
  options: {
    individualPlan?: IndividualDevelopmentPlan;
    environment?: DevelopmentEnvironment;
    playingTime?: PlayerPlayingTimeSnapshot;
    trainingAvailability?: "FULL" | "INJURED" | "RETURNING";
    attributes?: PlayerAttributeSet;
    state?: PlayerDevelopmentState;
    seed?: string;
  } = {},
) => {
  let date = "2026-08-01";
  let attributes = options.attributes ?? attributesFor(`age${age}-${Math.random()}`);
  let state = options.state ?? createInitialDevelopmentState(attributes, age, date);
  const potential = potentialFor(attributes);
  let output;
  for (let week = 0; week < Math.max(1, weeks); week += 1) {
    output = simulateTrainingWeek({
      attributes,
      state,
      potential,
      age,
      date,
      seed: options.seed ?? "phase-b-seed",
      plan: createDefaultTrainingPlan("team", date),
      individualPlan: options.individualPlan,
      playingTime: options.playingTime,
      environment: options.environment,
      trainingAvailability: options.trainingAvailability,
    });
    attributes = output.updatedAttributes;
    state = output.updatedState;
    date = addDays(date, 7);
  }
  return output!;
};

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

describe("player development & training phase B", () => {
  it("retrains younger players into a new position faster than older players", () => {
    const young = runWeeksWith(19, 10, { individualPlan: positionPlan("young", "ST") });
    const old = runWeeksWith(34, 10, { individualPlan: positionPlan("old", "ST") });
    expect(young.updatedState.positionFamiliarity.ST ?? 0).toBeGreaterThan(old.updatedState.positionFamiliarity.ST ?? 0);
  });

  it("applies diminishing returns as familiarity climbs toward mastery", () => {
    const lowStartAttrs = attributesFor("low-start");
    const highStartAttrs = attributesFor("high-start");
    const lowStart = createInitialDevelopmentState(lowStartAttrs, 24, "2026-08-01");
    const highStart = { ...createInitialDevelopmentState(highStartAttrs, 24, "2026-08-01"), positionFamiliarity: { ST: 88 } };

    const fromLow = runWeeksWith(24, 1, { individualPlan: positionPlan("low-start", "ST"), attributes: lowStartAttrs, state: lowStart });
    const fromHigh = runWeeksWith(24, 1, { individualPlan: positionPlan("high-start", "ST"), attributes: highStartAttrs, state: highStart });

    const gainLow = (fromLow.updatedState.positionFamiliarity.ST ?? 0) - 0;
    const gainHigh = (fromHigh.updatedState.positionFamiliarity.ST ?? 0) - 88;
    expect(gainLow).toBeGreaterThan(gainHigh);
  });

  it("rewards real playing-time exposure over training-only retraining", () => {
    const withMinutes = runWeeksWith(24, 6, {
      individualPlan: positionPlan("exposed", "ST"),
      playingTime: { id: createStableEntityId("pt", "exposed"), playerId: createStableEntityId("person", "exposed"), minutesLast30Days: 360, minutesSeason: 360, startsSeason: 4, subAppearances: 0, updatedOn: "2026-08-01" },
    });
    const withoutMinutes = runWeeksWith(24, 6, {
      individualPlan: positionPlan("bench", "ST"),
      playingTime: { id: createStableEntityId("pt", "bench"), playerId: createStableEntityId("person", "bench"), minutesLast30Days: 0, minutesSeason: 0, startsSeason: 0, subAppearances: 0, updatedOn: "2026-08-01" },
    });
    expect(withMinutes.updatedState.positionFamiliarity.ST ?? 0).toBeGreaterThan(withoutMinutes.updatedState.positionFamiliarity.ST ?? 0);
  });

  it("makes coaching and facility quality real drivers of retraining and attribute effectiveness", () => {
    const good = runWeeksWith(24, 8, { individualPlan: positionPlan("good-env", "ST"), environment: { coachingQuality: 1.3, facilitiesEffect: 1.25 } });
    const poor = runWeeksWith(24, 8, { individualPlan: positionPlan("poor-env", "ST"), environment: { coachingQuality: 0.7, facilitiesEffect: 0.75 } });
    expect(good.updatedState.positionFamiliarity.ST ?? 0).toBeGreaterThan(poor.updatedState.positionFamiliarity.ST ?? 0);
  });

  it("gives youth, prime and veteran players distinct development curves", () => {
    const youth = runWeeksWith(19, 20);
    const prime = runWeeksWith(27, 20);
    const veteran = runWeeksWith(36, 20);
    expect(average(youth.updatedAttributes)).toBeGreaterThan(average(prime.updatedAttributes));
    expect(average(veteran.updatedAttributes)).toBeLessThan(average(prime.updatedAttributes));
  });

  it("slows decline for a veteran on a maintenance-focused plan versus no plan", () => {
    const attrs = attributesFor("veteran-plain");
    const maintainedAttrs = attributesFor("veteran-maintained");
    const plain = runWeeksWith(37, 20, { attributes: attrs, state: createInitialDevelopmentState(attrs, 37, "2026-08-01") });
    const maintained = runWeeksWith(37, 20, {
      attributes: maintainedAttrs,
      state: createInitialDevelopmentState(maintainedAttrs, 37, "2026-08-01"),
      individualPlan: {
        id: createStableEntityId("individual-development-plan", "veteran-maintained"),
        playerId: createStableEntityId("person", "veteran-maintained"),
        focusType: "MAINTENANCE",
        intensity: "LOW",
        startDate: "2026-08-01",
        status: "ACTIVE",
      },
    });
    const plainDecline = average(attrs) - average(plain.updatedAttributes);
    const maintainedDecline = average(maintainedAttrs) - average(maintained.updatedAttributes);
    expect(maintainedDecline).toBeLessThan(plainDecline);
  });

  it("never grants instant boosts and always keeps growth within the documented per-period cap", () => {
    const output = runWeeksWith(19, 1, { individualPlan: positionPlan("cap-check", "ST") });
    const attrs = attributesFor("cap-check-base");
    const delta = average(output.updatedAttributes) - average(attrs);
    expect(Math.abs(delta)).toBeLessThan(0.1);
  });

  it("suspends growth and familiarity gain entirely while injured, and ramps rather than fully resumes when returning", () => {
    const attrs = attributesFor("injured-player");
    const state = createInitialDevelopmentState(attrs, 24, "2026-08-01");
    const injured = runWeeksWith(24, 1, {
      attributes: attrs,
      state,
      individualPlan: positionPlan("injured-player", "ST"),
      trainingAvailability: "INJURED",
    });
    expect(injured.updatedAttributes).toEqual(attrs);
    expect(injured.updatedState.positionFamiliarity.ST ?? 0).toBe(0);
    expect(injured.updatedState.recovery).toBeGreaterThanOrEqual(state.recovery);

    const returning = runWeeksWith(24, 6, { individualPlan: positionPlan("returning-player", "ST"), trainingAvailability: "RETURNING" });
    const full = runWeeksWith(24, 6, { individualPlan: positionPlan("full-player", "ST"), trainingAvailability: "FULL" });
    expect(returning.updatedState.positionFamiliarity.ST ?? 0).toBeLessThan(full.updatedState.positionFamiliarity.ST ?? 0);
  });

  it("dampens development in congested fixture weeks", () => {
    const teamId = createStableEntityId("team", "congestion");
    const other = createStableEntityId("team", "opponent");
    const busyFixtures: FixtureRecord[] = ["2026-07-28", "2026-07-31", "2026-08-03"].map((scheduledDate, i) => ({
      id: createStableEntityId("fixture", `busy-${i}`),
      homeTeamId: teamId,
      awayTeamId: other,
      scheduledDate,
      status: "scheduled",
      round: i,
    }));
    const quietFixtures: FixtureRecord[] = [
      { id: createStableEntityId("fixture", "quiet-0"), homeTeamId: teamId, awayTeamId: other, scheduledDate: "2026-08-01", status: "scheduled", round: 0 },
    ];
    const busy = computeCongestionMultiplier(busyFixtures, teamId, "2026-08-01");
    const quiet = computeCongestionMultiplier(quietFixtures, teamId, "2026-08-01");
    expect(busy).toBeLessThan(quiet);
    expect(quiet).toBe(1);
  });

  it("detects a plateau from a run of near-zero attribute deltas but not from real progress", () => {
    expect(isPlateaued([0.01, -0.01, 0.02])).toBe(true);
    expect(isPlateaued([0.2, 0.15, 0.1])).toBe(false);
    expect(isPlateaued([0.01])).toBe(false);
  });

  it("assigns sensible default plans by real age/attributes, and never overrides an existing plan", () => {
    const dbPath = tempDbPath();
    const db = openGameDatabase(dbPath);
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const players = new PlayerRepository(db);
    const country: Country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
    world.insertCountry(country);
    const team = createStableEntityId("team", "sensible-plans");
    world.insertClub({ id: createStableEntityId("club", "sensible-plans"), name: "Sensible FC", countryId: country.id, ownershipType: "PRIVATE" });
    world.insertTeam({ id: team, clubId: createStableEntityId("club", "sensible-plans"), name: "Sensible FC", level: "senior", gender: "men" });

    const makePlayer = (key: string, dateOfBirth: string) => {
      const person: Person = { id: createStableEntityId("person", key), fullName: key, dateOfBirth, nationalityCountryId: country.id, languages: ["ne"] };
      world.insertPerson(person);
      world.insertTeamPersonAssignment({ id: createStableEntityId("assignment", key), teamId: team, personId: person.id, role: "PLAYER", startedOn: "2026-08-01" });
      const attrs = attributesFor(key);
      players.upsertAttributes(attrs);
      return person.id;
    };

    const youthId = makePlayer("youth-player", "2009-01-01");
    const primeId = makePlayer("prime-player", "1998-01-01");
    const veteranId = makePlayer("veteran-player", "1988-01-01");

    ensureSensibleDevelopmentPlan(db, "2026-08-01", team);

    expect(world.activeIndividualDevelopmentPlan(youthId)?.focusType).toBe("BALANCED");
    expect(world.activeIndividualDevelopmentPlan(primeId)?.focusType).toBe("ATTRIBUTE");
    expect(world.activeIndividualDevelopmentPlan(primeId)?.targetAttributeGroup).toBeDefined();
    expect(world.activeIndividualDevelopmentPlan(veteranId)?.focusType).toBe("MAINTENANCE");
    expect(world.activeIndividualDevelopmentPlan(veteranId)?.intensity).toBe("LOW");

    const manualPlan = world.activeIndividualDevelopmentPlan(youthId)!;
    world.upsertIndividualDevelopmentPlan({ ...manualPlan, focusType: "ROLE", targetRole: "wing-back" });
    ensureSensibleDevelopmentPlan(db, "2026-08-08", team);
    expect(world.activeIndividualDevelopmentPlan(youthId)?.focusType).toBe("ROLE");

    db.close();
  });

  it("reviews a due plan: completes on goal achievement, flags a plateau otherwise, and leaves an undue plan untouched", () => {
    const dbPath = tempDbPath();
    const db = openGameDatabase(dbPath);
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const country: Country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
    world.insertCountry(country);
    const person: Person = { id: createStableEntityId("person", "review-target"), fullName: "Review Target", nationalityCountryId: country.id, languages: ["ne"] };
    world.insertPerson(person);

    const duePlan: IndividualDevelopmentPlan = {
      id: createStableEntityId("individual-development-plan", "due"),
      playerId: person.id,
      focusType: "POSITION",
      targetPosition: "ST",
      intensity: "NORMAL",
      startDate: "2026-01-01",
      endDate: "2026-02-11",
      status: "ACTIVE",
    };
    world.upsertIndividualDevelopmentPlan(duePlan);

    const notYetDue = reviewDevelopmentPlanIfDue(db, "2026-02-01", duePlan, 80, []);
    expect(notYetDue).toBeUndefined();

    const achieved = reviewDevelopmentPlanIfDue(db, "2026-02-11", duePlan, 85, [0.3, 0.4]);
    expect(achieved?.recommendation).toBe("GOAL_ACHIEVED");
    expect(world.activeIndividualDevelopmentPlan(person.id)).toBeUndefined();

    const plateauPlan: IndividualDevelopmentPlan = { ...duePlan, id: createStableEntityId("individual-development-plan", "plateau"), targetPosition: "CM" };
    world.upsertIndividualDevelopmentPlan(plateauPlan);
    const plateaued = reviewDevelopmentPlanIfDue(db, "2026-02-11", plateauPlan, 30, [0.01, -0.01, 0.02]);
    expect(plateaued?.recommendation).toBe("CONSIDER_NEW_FOCUS");
    expect(plateaued?.plateaued).toBe(true);
    const stillActive = world.activeIndividualDevelopmentPlan(person.id);
    expect(stillActive?.status).toBe("ACTIVE");
    expect(stillActive!.endDate! > "2026-02-11").toBe(true);

    db.close();
  });

  it("derives FULL/INJURED/RETURNING training availability from the same injury records match-time injuries use", () => {
    const dbPath = tempDbPath();
    const db = openGameDatabase(dbPath);
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const players = new PlayerRepository(db);
    const country: Country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
    world.insertCountry(country);
    const person: Person = { id: createStableEntityId("person", "availability-target"), fullName: "Availability Target", nationalityCountryId: country.id, languages: ["ne"] };
    world.insertPerson(person);

    expect(trainingAvailabilityFor(db, person.id, "2026-08-01")).toBe("FULL");

    players.insertInjury({ id: createStableEntityId("injury", "avail-1"), personId: person.id, injuryType: "Knock", dateOccurred: "2026-08-01", expectedRecoveryDate: "2026-08-10", severity: "minor" });
    expect(trainingAvailabilityFor(db, person.id, "2026-08-05")).toBe("INJURED");
    expect(trainingAvailabilityFor(db, person.id, "2026-08-12")).toBe("RETURNING");
    expect(trainingAvailabilityFor(db, person.id, "2026-08-25")).toBe("FULL");

    db.close();
  });
});
