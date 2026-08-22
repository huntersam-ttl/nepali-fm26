import type {
  PlayerAttributeSet,
  PlayerPosition,
  PlayerPotential,
} from "@nepal-football-sim/shared-types";
import { createStableEntityId } from "@nepal-football-sim/shared-types";
import { SeededRandom } from "./rng.js";

export type FactualPlayerForGeneration = {
  playerKey: string;
  clubKey: string;
  fullName: string;
  factualPrimaryPosition?: PlayerPosition;
  factualPositionGroup?: "GOALKEEPER" | "DEFENDER" | "MIDFIELDER" | "FORWARD" | "UNKNOWN";
  squadStatus?: "STARTER" | "REGULAR" | "SQUAD" | "RESERVE" | "YOUTH" | "UNKNOWN";
  confidenceLevel?: "HIGH" | "MEDIUM" | "LOW";
  dateOfBirth?: string;
  age?: number;
  nationalTeamStatus?: boolean;
};

export type PlayerCalibrationProfile = {
  id: string;
  domesticBaseline: number;
  strongClubModifier: number;
  nationalTeamModifier: number;
};

export type GeneratedSimulationPlayerProfile = {
  simulationPrimaryPosition: PlayerPosition;
  simulationAgeProfile: "YOUNG" | "EARLY_CAREER" | "PRIME" | "EXPERIENCED" | "VETERAN" | "UNKNOWN";
  simulationDateOfBirth?: string;
  simulationHeightCm: number;
  simulationPreferredFoot: "RIGHT" | "LEFT" | "BOTH";
  currentAbility: number;
  potentialAbility: number;
  reputation: number;
  hiddenTraits: PlayerPotential & {
    consistency: number;
    ambition: number;
    adaptability: number;
    pressureHandling: number;
    injuryProneness: number;
  };
  attributes: PlayerAttributeSet;
};

const defaultCalibration: PlayerCalibrationProfile = {
  id: "nepal-national-league-2026",
  domesticBaseline: 8,
  strongClubModifier: 1,
  nationalTeamModifier: 1.2,
};

export const generateSimulationPlayerProfile = (
  factual: FactualPlayerForGeneration,
  seed: string,
  calibration: PlayerCalibrationProfile = defaultCalibration,
): GeneratedSimulationPlayerProfile => {
  const rng = new SeededRandom(
    `${seed}:${factual.playerKey}:${factual.fullName}:${factual.clubKey}`,
  );
  const position =
    factual.factualPrimaryPosition ?? generatedPosition(factual.factualPositionGroup, rng);
  const ageProfile = ageProfileFor(factual.age, factual.squadStatus);
  const squadModifier = squadStatusModifier(factual.squadStatus);
  const confidenceNoise =
    factual.confidenceLevel === "HIGH" ? 0.25 : factual.confidenceLevel === "LOW" ? 0.75 : 0.5;
  const currentAbility = round(
    clamp(
      calibration.domesticBaseline +
        squadModifier +
        (factual.nationalTeamStatus ? calibration.nationalTeamModifier : 0) +
        (rng.next() - 0.5) * confidenceNoise * 2,
      4,
      13.5,
    ),
  );
  const potentialAbility = round(
    clamp(
      currentAbility + potentialGap(ageProfile, factual.squadStatus) + rng.next() * 1.2,
      currentAbility,
      15,
    ),
  );
  const personId = createStableEntityId("person", factual.playerKey);
  const hiddenTraits = {
    id: createStableEntityId("player-potential", factual.playerKey),
    playerId: personId,
    potentialCeiling: potentialAbility,
    developmentRate: round(clamp((potentialAbility - currentAbility) / 5 + 0.7, 0.35, 1.6)),
    volatility: round(0.4 + rng.next() * 0.8),
    professionalism: ratingAround(10, rng),
    consistency: ratingAround(10, rng),
    ambition: ratingAround(10, rng),
    adaptability: ratingAround(10, rng),
    pressureHandling: ratingAround(10, rng),
    injuryProneness: ratingAround(8, rng),
    status: "SIMULATION_ONLY" as const,
  };
  return {
    simulationPrimaryPosition: position,
    simulationAgeProfile: ageProfile,
    simulationDateOfBirth: factual.dateOfBirth ? undefined : simulatedDateOfBirth(ageProfile, rng),
    simulationHeightCm: generatedHeight(position, rng),
    simulationPreferredFoot: generatedFoot(position, rng),
    currentAbility,
    potentialAbility,
    reputation: round(clamp(currentAbility * 5 + (factual.nationalTeamStatus ? 12 : 0), 10, 80)),
    hiddenTraits,
    attributes: attributesFor(position, currentAbility, personId, factual.playerKey, rng),
  };
};

const generatedPosition = (
  group: FactualPlayerForGeneration["factualPositionGroup"],
  rng: SeededRandom,
): PlayerPosition => {
  const pools: Record<string, PlayerPosition[]> = {
    GOALKEEPER: ["GK"],
    DEFENDER: ["CB", "CB", "RB", "LB"],
    MIDFIELDER: ["CM", "CM", "DM", "AM"],
    FORWARD: ["ST", "ST", "RW", "LW"],
    UNKNOWN: ["CB", "CM", "ST", "GK", "RB", "LB", "DM", "AM", "RW", "LW"],
  };
  return rng.pick(pools[group ?? "UNKNOWN"]);
};

const ageProfileFor = (
  age: number | undefined,
  squadStatus: FactualPlayerForGeneration["squadStatus"],
): GeneratedSimulationPlayerProfile["simulationAgeProfile"] => {
  if (age !== undefined) {
    if (age <= 20) return "YOUNG";
    if (age <= 24) return "EARLY_CAREER";
    if (age <= 29) return "PRIME";
    if (age <= 33) return "EXPERIENCED";
    return "VETERAN";
  }
  return squadStatus === "YOUTH" ? "YOUNG" : "UNKNOWN";
};

const squadStatusModifier = (status: FactualPlayerForGeneration["squadStatus"]): number =>
  ({
    STARTER: 1.25,
    REGULAR: 0.75,
    SQUAD: 0.15,
    RESERVE: -0.6,
    YOUTH: -0.8,
    UNKNOWN: 0,
  })[status ?? "UNKNOWN"];

const potentialGap = (
  ageProfile: GeneratedSimulationPlayerProfile["simulationAgeProfile"],
  status: FactualPlayerForGeneration["squadStatus"],
): number =>
  ({
    YOUNG: 2.4,
    EARLY_CAREER: 1.7,
    PRIME: 0.8,
    EXPERIENCED: 0.25,
    VETERAN: 0,
    UNKNOWN: status === "YOUTH" ? 2 : 1,
  })[ageProfile];

const attributesFor = (
  position: PlayerPosition,
  ability: number,
  personId: PlayerAttributeSet["personId"],
  key: string,
  rng: SeededRandom,
): PlayerAttributeSet => {
  const base = Math.round(ability);
  const mod = (value: number) => clamp(Math.round(value + (rng.next() - 0.5) * 3), 1, 20);
  const gk = position === "GK";
  return {
    id: createStableEntityId("player-attribute", key),
    personId,
    primaryPosition: position,
    secondaryPositions: [],
    technical: {
      firstTouch: mod(base + (gk ? -3 : 0)),
      passing: mod(base),
      crossing: mod(base + (["RB", "LB", "RW", "LW"].includes(position) ? 1 : -1)),
      dribbling: mod(base + (["AM", "RW", "LW"].includes(position) ? 1 : -1)),
      finishing: mod(base + (position === "ST" ? 2 : -2)),
      heading: mod(base + (["CB", "ST"].includes(position) ? 2 : -1)),
      tackling: mod(base + (["CB", "RB", "LB", "DM"].includes(position) ? 2 : -2)),
      technique: mod(base),
      longShots: mod(base + (["CM", "AM"].includes(position) ? 1 : -1)),
      setPieces: mod(base - 1),
    },
    mental: {
      decisions: mod(base),
      vision: mod(base + (["CM", "AM"].includes(position) ? 1 : -1)),
      composure: mod(base),
      positioning: mod(base + (["CB", "DM", "ST", "GK"].includes(position) ? 1 : 0)),
      anticipation: mod(base),
      workRate: mod(base),
      teamwork: mod(base),
      leadership: mod(base - 1),
      aggression: mod(base + (["CB", "DM"].includes(position) ? 1 : -1)),
      determination: mod(base),
      professionalism: mod(base),
    },
    physical: {
      pace: mod(base + (["RB", "LB", "RW", "LW"].includes(position) ? 2 : 0)),
      acceleration: mod(base + (["RW", "LW", "ST"].includes(position) ? 1 : 0)),
      strength: mod(base + (["CB", "ST"].includes(position) ? 2 : 0)),
      stamina: mod(base),
      agility: mod(base + (["RW", "LW", "AM"].includes(position) ? 1 : 0)),
      balance: mod(base),
      jumping: mod(base + (["CB", "ST", "GK"].includes(position) ? 2 : -1)),
      naturalFitness: mod(base),
    },
    goalkeeping: {
      handling: mod(gk ? base + 2 : 2),
      reflexes: mod(gk ? base + 2 : 2),
      oneOnOnes: mod(gk ? base + 1 : 2),
      aerialReach: mod(gk ? base + 1 : 2),
      kicking: mod(gk ? base : 2),
      distribution: mod(gk ? base : 2),
      commandOfArea: mod(gk ? base : 2),
    },
  };
};

const generatedHeight = (position: PlayerPosition, rng: SeededRandom): number => {
  const base = position === "GK" ? 181 : position === "CB" || position === "ST" ? 176 : 170;
  return Math.round(base + (rng.next() - 0.5) * 12);
};

const generatedFoot = (position: PlayerPosition, rng: SeededRandom): "RIGHT" | "LEFT" | "BOTH" => {
  if (position === "LB" || position === "LW") {
    return rng.next() < 0.38 ? "LEFT" : rng.next() < 0.04 ? "BOTH" : "RIGHT";
  }
  const roll = rng.next();
  return roll < 0.76 ? "RIGHT" : roll < 0.96 ? "LEFT" : "BOTH";
};

const simulatedDateOfBirth = (
  profile: GeneratedSimulationPlayerProfile["simulationAgeProfile"],
  rng: SeededRandom,
): string => {
  const age =
    (
      { YOUNG: 19, EARLY_CAREER: 23, PRIME: 27, EXPERIENCED: 31, VETERAN: 35, UNKNOWN: 27 } as const
    )[profile] + Math.floor((rng.next() - 0.5) * 4);
  const year = 2026 - age;
  const month = String(1 + rng.integer(0, 11)).padStart(2, "0");
  const day = String(1 + rng.integer(0, 27)).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const ratingAround = (base: number, rng: SeededRandom): number =>
  clamp(Math.round(base + (rng.next() - 0.5) * 8), 1, 20);

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
const round = (value: number): number => Math.round(value * 100) / 100;
