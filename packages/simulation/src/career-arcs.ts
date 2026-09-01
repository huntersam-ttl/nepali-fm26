import { CareerIdentityRepository, type GameDatabase } from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type CareerArcReadModel,
  type CareerIdentity,
  type CareerMilestone,
  type EntityId,
  type PlayerCareerPhase,
} from "@nepal-football-sim/shared-types";
import { getCareerIdentity, recordCareerMilestone } from "./career-identity.js";

export type CareerArcInput = {
  age: number;
  ability: number;
  developmentTrend: "IMPROVING" | "STABLE" | "DECLINING";
  minutesLast30Days?: number;
  seasonAppearances?: number;
  reputation?: number;
  recentMajorInjuries?: number;
  professionalism?: number;
  roleStatus?: "YOUTH" | "SQUAD" | "REGULAR" | "STARTER" | "CAPTAIN";
};

/** Uses age as one signal among exposure, trajectory, ability and role—not a fixed age table. */
export const playerCareerPhase = (input: CareerArcInput): PlayerCareerPhase => {
  const exposure = (input.minutesLast30Days ?? 0) + (input.seasonAppearances ?? 0) * 12;
  const established =
    exposure >= 420 || ["REGULAR", "STARTER", "CAPTAIN"].includes(input.roleStatus ?? "");
  const breakthrough = exposure >= 180 && input.developmentTrend === "IMPROVING";
  if (input.age >= 35 || (input.age >= 31 && input.developmentTrend === "DECLINING"))
    return "VETERAN";
  if (input.developmentTrend === "DECLINING" && input.age >= 27) return "DECLINING";
  if (input.age >= 25 && established && input.ability >= 10) return "PRIME";
  if (established) return "ESTABLISHED";
  if (breakthrough || (input.age >= 19 && input.reputation !== undefined && input.reputation >= 45))
    return "BREAKTHROUGH";
  return "EMERGING";
};

export const retirementDecision = (input: {
  age: number;
  physicalDecline: number;
  recentMajorInjuries: number;
  appearancesLastSeason: number;
  reputation: number;
  contractYearsRemaining: number;
  ambition: number;
}): { shouldRetire: boolean; rationale: string } => {
  const pressure =
    Math.max(0, input.age - 32) * 0.08 +
    input.physicalDecline * 0.35 +
    input.recentMajorInjuries * 0.08 +
    (input.appearancesLastSeason < 3 ? 0.15 : 0) +
    (input.contractYearsRemaining === 0 ? 0.08 : 0);
  const resilience = input.ambition * 0.004 + input.reputation * 0.002;
  const shouldRetire = pressure - resilience >= 0.72;
  return {
    shouldRetire,
    rationale: shouldRetire
      ? "Age, physical decline, and current playing outlook support retirement."
      : "The player's physical and career outlook still supports continuing.",
  };
};

export const recordPlayerMilestone = (
  db: GameDatabase,
  input: {
    personId: EntityId;
    date: string;
    type: Extract<
      CareerMilestone["type"],
      | "DEBUT"
      | "FIRST_GOAL"
      | "APPEARANCE_MILESTONE"
      | "CAPTAINCY"
      | "RETIREMENT"
      | "MAJOR_TRANSFER"
      | "NATIONAL_TEAM_DEBUT"
    >;
    title: string;
    sourceEntityId?: EntityId;
    impact?: CareerMilestone["impact"];
  },
): CareerIdentity => recordCareerMilestone(db, { ...input, role: "PLAYER" });

export const deriveLegacyLabels = (input: {
  identity: CareerIdentity;
  academyGraduate?: boolean;
  oneClub?: boolean;
  appearancesAtClub?: number;
  captaincyAtClub?: boolean;
  supporterAffinity?: number;
}): string[] => {
  const milestones = input.identity.milestones;
  const labels: string[] = [];
  if ((input.supporterAffinity ?? 0) >= 80 && (input.appearancesAtClub ?? 0) >= 40)
    labels.push("FAN_FAVOURITE");
  if (input.oneClub && (input.appearancesAtClub ?? 0) >= 100) labels.push("ONE_CLUB_PLAYER");
  if (input.academyGraduate && milestones.some((item) => item.type === "DEBUT"))
    labels.push("ACADEMY_GRADUATE_SUCCESS");
  if (input.captaincyAtClub || milestones.some((item) => item.type === "CAPTAINCY"))
    labels.push("LONG_SERVING_CAPTAIN");
  if (
    milestones.some((item) => item.type === "TROPHY") &&
    milestones.filter((item) => item.type === "TROPHY").length >= 2
  )
    labels.push("SERIAL_WINNER");
  if (milestones.some((item) => item.type === "PROMOTION")) labels.push("PROMOTION_HERO");
  return labels;
};

export const playerCareerArcReadModel = (
  db: GameDatabase,
  input: CareerArcInput & { personId: EntityId; date: string },
): CareerArcReadModel => {
  const identity = getCareerIdentity(db, input.personId, input.date);
  return {
    personId: input.personId,
    phase: playerCareerPhase(input),
    trajectory: input.developmentTrend,
    milestones: identity.milestones.filter((item) => item.role === "PLAYER"),
    legacyLabels: identity.legacy.labels ?? [],
    provenanceStatus: "SIMULATION_ONLY",
  };
};

export const persistPlayerLegacyLabels = (
  db: GameDatabase,
  personId: EntityId,
  date: string,
  labels: string[],
): CareerIdentity => {
  const repository = new CareerIdentityRepository(db);
  const identity = getCareerIdentity(db, personId, date);
  const next = {
    ...identity,
    legacy: { ...identity.legacy, labels: [...new Set(labels)].sort() },
    lastUpdatedAt: date,
  };
  repository.upsert(next);
  return next;
};

export const milestoneId = (
  personId: EntityId,
  date: string,
  type: CareerMilestone["type"],
  sourceEntityId?: EntityId,
): EntityId =>
  createStableEntityId("career-milestone", `${personId}:${date}:${type}:${sourceEntityId ?? ""}`);
