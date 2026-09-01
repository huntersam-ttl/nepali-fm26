import {
  CareerWorldRepository,
  ClubEconomyRepository,
  ManagerRepository,
  PeopleFoundationRepository,
  SquadDynamicsRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import type {
  BoardPoliticsSnapshot,
  ClubVision,
  ClubBoardPolicy,
  EntityId,
  ManagerContract,
  ManagerProfile,
} from "@nepal-football-sim/shared-types";
import { upsertPersonRelationship } from "./people-foundation.js";

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const defaultPriorities = (policy: ClubBoardPolicy): Record<string, number> => ({
  youth: policy.youthPriority,
  commercial: policy.commercialPriority,
  infrastructure: policy.infrastructurePriority,
  squad: Number((1 - policy.youthPriority).toFixed(3)),
});

/** Combines the canonical board policy, latest AI direction, finance, and ownership influence. */
export const buildClubVision = (
  db: GameDatabase,
  clubId: EntityId,
  date: string,
): ClubVision | undefined => {
  const economy = new ClubEconomyRepository(db);
  const policy = economy.boardPolicy(clubId);
  if (!policy) return undefined;
  const latest = economy.aiDecisions(clubId).at(-1);
  const ownership = economy
    .ownershipStakes(clubId)
    .filter((stake) => stake.status === "ACTIVE")
    .reduce(
      (sum, stake) =>
        sum + ((stake.percentage ?? 0) * (stake.votingPercentage ?? stake.percentage ?? 0)) / 100,
      0,
    );
  const account = economy.financialAccount(clubId);
  return {
    clubId,
    objective: latest?.objective ?? policy.strategicObjective,
    identity: latest?.identity,
    priorities: latest?.priorities ?? defaultPriorities(policy),
    financialHealth: account?.financialHealth,
    financialRiskTolerance: policy.financialRiskTolerance,
    transferPhilosophy: policy.transferPhilosophy,
    ownershipInfluence: clamp(ownership),
    updatedOn: date,
    provenanceStatus: "SIMULATION_ONLY",
  };
};

const activeManagerForClub = (db: GameDatabase, clubId: EntityId): ManagerContract | undefined =>
  new ManagerRepository(db).allActiveContracts().find((contract) => contract.clubId === clubId);

/** Computes board pressure from existing confidence, promises, and the canonical board relationship. */
export const boardPolitics = (
  db: GameDatabase,
  clubId: EntityId,
  managerProfile: ManagerProfile,
): BoardPoliticsSnapshot | undefined => {
  const contract = activeManagerForClub(db, clubId);
  if (!contract || contract.managerProfileId !== managerProfile.id) return undefined;
  const confidence = new CareerWorldRepository(db).boardConfidence(clubId)?.confidence ?? 60;
  const policy = new ClubEconomyRepository(db).boardPolicy(clubId);
  const boardPersonId = policy?.chairmanPersonId;
  const relation = boardPersonId
    ? new PeopleFoundationRepository(db).relationship(
        managerProfile.personId,
        boardPersonId,
        "MANAGER_BOARD",
      )
    : undefined;
  if (!contract.teamId) return undefined;
  const promises = new SquadDynamicsRepository(db).promisesForPerson(
    managerProfile.personId,
    contract.teamId,
  );
  const activePromises = promises.filter((promise) => promise.status === "ACTIVE").length;
  const brokenPromises = promises.filter((promise) => promise.status === "BROKEN").length;
  const pressure =
    confidence <= 30 || brokenPromises >= 2 || (relation?.tension ?? 0) >= 70
      ? "HIGH"
      : confidence <= 60 || brokenPromises > 0 || (relation?.tension ?? 0) >= 45
        ? "MEDIUM"
        : "LOW";
  return {
    clubId,
    managerProfileId: managerProfile.id,
    confidence,
    relationshipTrust: relation?.trust ?? 50,
    relationshipTension: relation?.tension ?? 0,
    activePromises,
    brokenPromises,
    pressure,
    provenanceStatus: "SIMULATION_ONLY",
  };
};

/** Keeps the canonical manager-board edge aligned with board confidence and promise pressure. */
export const refreshManagerBoardRelationship = (
  db: GameDatabase,
  clubId: EntityId,
  managerProfile: ManagerProfile,
  date: string,
): BoardPoliticsSnapshot | undefined => {
  const policy = new ClubEconomyRepository(db).boardPolicy(clubId);
  const contract = activeManagerForClub(db, clubId);
  if (!policy?.chairmanPersonId || !contract || contract.managerProfileId !== managerProfile.id)
    return undefined;
  const snapshot = boardPolitics(db, clubId, managerProfile);
  if (!snapshot) return undefined;
  const trust = clamp(
    snapshot.confidence * 0.7 +
      (100 - snapshot.relationshipTension) * 0.3 -
      snapshot.brokenPromises * 8,
  );
  const tension = clamp(100 - trust + snapshot.brokenPromises * 5);
  upsertPersonRelationship({
    db,
    fromPersonId: managerProfile.personId,
    toPersonId: policy.chairmanPersonId,
    kind: "MANAGER_BOARD",
    affinity: trust,
    trust,
    respect: clamp(managerProfile.attributes.people.communication * 5),
    tension,
    date,
  });
  return { ...snapshot, relationshipTrust: trust, relationshipTension: tension };
};
