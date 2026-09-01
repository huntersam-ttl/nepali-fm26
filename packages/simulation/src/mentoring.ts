import {
  PeopleFoundationRepository,
  PlayerRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type EntityId,
  type MentoringAssignment,
  type MentoringFocus,
  type PersonRelationship,
} from "@nepal-football-sim/shared-types";
import { SeededRandom } from "./rng.js";
import { computeSquadHierarchy } from "./squad-dynamics.js";

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
const MENTOR_ROLES = new Set(["CAPTAIN", "VICE_CAPTAIN", "SENIOR_PLAYER"]);

export type MentoringResult = { assignment: MentoringAssignment; created: boolean };

/** Creates one bounded, same-squad mentoring link; no parallel social model is introduced. */
export const createMentoringAssignment = (input: {
  db: GameDatabase;
  teamId: EntityId;
  mentorPersonId: EntityId;
  menteePersonId: EntityId;
  focus: MentoringFocus;
  startDate: string;
}): MentoringResult => {
  if (input.mentorPersonId === input.menteePersonId)
    throw new Error("A player cannot mentor themselves");
  const playerIds = new Set(
    new PlayerRepository(input.db).attributesForTeam(input.teamId).map((player) => player.personId),
  );
  if (!playerIds.has(input.mentorPersonId) || !playerIds.has(input.menteePersonId))
    throw new Error("Mentoring requires two active players in the same squad");
  const hierarchy = computeSquadHierarchy(input.db, input.teamId, input.startDate);
  const mentor = hierarchy.find((entry) => entry.personId === input.mentorPersonId);
  if (!mentor || !MENTOR_ROLES.has(mentor.role))
    throw new Error("Only senior squad players can mentor");
  const repository = new PeopleFoundationRepository(input.db);
  const existing = repository
    .mentoringForPerson(input.mentorPersonId)
    .find(
      (assignment) =>
        assignment.menteePersonId === input.menteePersonId &&
        assignment.teamId === input.teamId &&
        assignment.focus === input.focus &&
        assignment.status === "ACTIVE",
    );
  if (existing) return { assignment: existing, created: false };
  const assignment: MentoringAssignment = {
    id: createStableEntityId(
      "mentoring-assignment",
      `${input.teamId}:${input.mentorPersonId}:${input.menteePersonId}:${input.focus}`,
    ),
    mentorPersonId: input.mentorPersonId,
    menteePersonId: input.menteePersonId,
    teamId: input.teamId,
    focus: input.focus,
    startDate: input.startDate,
    endDate: undefined,
    progress: 0,
    status: "ACTIVE",
    updatedOn: input.startDate,
    provenanceStatus: "SIMULATION_ONLY",
  };
  repository.upsertMentoringAssignment(assignment);
  return { assignment, created: true };
};

/** Advances mentoring progress and strengthens the existing canonical relationship edge. */
export const advanceMentoring = (input: {
  db: GameDatabase;
  teamId: EntityId;
  date: string;
  seed: string;
}): MentoringAssignment[] => {
  const repository = new PeopleFoundationRepository(input.db);
  const players = new Set(
    new PlayerRepository(input.db).attributesForTeam(input.teamId).map((player) => player.personId),
  );
  const completed: MentoringAssignment[] = [];
  for (const current of repository.activeMentoringForTeam(input.teamId)) {
    if (!players.has(current.mentorPersonId) || !players.has(current.menteePersonId)) {
      const cancelled = {
        ...current,
        status: "CANCELLED" as const,
        endDate: input.date,
        updatedOn: input.date,
      };
      repository.upsertMentoringAssignment(cancelled);
      completed.push(cancelled);
      continue;
    }
    const rng = new SeededRandom(`${input.seed}:mentoring:${current.id}:${input.date}`);
    const delta = 10 + Math.floor(rng.next() * 8);
    const progress = clamp(current.progress + delta);
    const status = progress >= 100 ? ("COMPLETED" as const) : ("ACTIVE" as const);
    const next = {
      ...current,
      progress,
      status,
      endDate: status === "COMPLETED" ? input.date : undefined,
      updatedOn: input.date,
    };
    repository.upsertMentoringAssignment(next);
    const existing = repository.relationship(
      current.mentorPersonId,
      current.menteePersonId,
      "TEAMMATE",
    );
    const relationship: PersonRelationship = {
      id:
        existing?.id ??
        createStableEntityId(
          "person-relationship",
          `${current.mentorPersonId}:${current.menteePersonId}:TEAMMATE`,
        ),
      fromPersonId: current.mentorPersonId,
      toPersonId: current.menteePersonId,
      kind: "TEAMMATE",
      affinity: clamp((existing?.affinity ?? 50) + 2),
      trust: clamp((existing?.trust ?? 50) + 3),
      respect: clamp((existing?.respect ?? 50) + 3),
      tension: clamp((existing?.tension ?? 0) - 2),
      updatedOn: input.date,
      provenanceStatus: "SIMULATION_ONLY",
    };
    repository.upsertRelationship(relationship);
    completed.push(next);
  }
  return completed;
};
