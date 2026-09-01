import { PeopleFoundationRepository, SquadDynamicsRepository, WorldRepository, type GameDatabase } from "@nepal-football-sim/database";
import type {
  DressingRoomHierarchyEntry,
  DressingRoomLifestyleEntry,
  DressingRoomManagerSupportEntry,
  DressingRoomMentoringEntry,
  DressingRoomMentoringProgressBand,
  DressingRoomSocialGroup,
  DressingRoomView,
  EntityId,
  ManagerSupportLabel,
  Person,
  SaveMetadata,
} from "@nepal-football-sim/shared-types";
import type { ManagerContext } from "./desktop-application.js";
import { buildSquadList } from "./manager-desktop.js";
import { derivePlayerLifestyle, squadSocialGroups } from "./press-social-lifestyle.js";

const displayName = (person: Person | undefined, fallback: string): string =>
  person?.displayName ?? person?.fullName ?? fallback;

/** Highly influential and captain/vice-captain both outrank a plain "leader" label; captaincy wins. */
const hierarchyLabel = (
  role: "CAPTAIN" | "VICE_CAPTAIN" | "SENIOR_PLAYER" | "SQUAD_PLAYER" | "FRINGE_PLAYER" | undefined,
  influence: number,
  age?: number,
): DressingRoomHierarchyEntry["label"] => {
  if (role === "CAPTAIN" || role === "VICE_CAPTAIN") return "TEAM_LEADER";
  if (influence >= 75) return "HIGHLY_INFLUENTIAL";
  if (role === "FRINGE_PLAYER") return "FRINGE";
  if (age !== undefined && age <= 20) return "YOUNGSTER";
  return "REGULAR";
};

const supportLabelFrom = (trust: number, tension: number): ManagerSupportLabel => {
  if (trust >= 65 && tension < 35) return "FULLY_ONSIDE";
  if (trust < 35 || tension >= 65) return "AT_ODDS";
  return "NEUTRAL";
};

const progressBandFrom = (progress: number): DressingRoomMentoringProgressBand => {
  if (progress >= 90) return "COMPLETE";
  if (progress >= 60) return "NEARLY_DONE";
  if (progress >= 25) return "UNDERWAY";
  return "STARTING";
};

export const buildDressingRoomView = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): DressingRoomView => {
  const squad = buildSquadList(db, save, context);
  const nameById = new Map<EntityId, string>(squad.players.map((player) => [player.personId, player.name]));
  const squadIds = squad.players.map((player) => player.personId);
  const ageById = new Map<EntityId, number | undefined>(
    squad.players.map((player) => [player.personId, player.age.value]),
  );

  const dynamics = new SquadDynamicsRepository(db);
  const hierarchyEntries = dynamics.hierarchyForTeam(context.team.id);
  const hierarchyByPerson = new Map(hierarchyEntries.map((entry) => [entry.personId, entry]));
  const groupByPerson = new Map(
    dynamics.groupsForTeam(context.team.id).map((entry) => [entry.personId, entry.groupType]),
  );
  const hierarchy: DressingRoomHierarchyEntry[] = squad.players.map((player) => {
    const entry = hierarchyByPerson.get(player.personId);
    return {
      personId: player.personId,
      playerName: player.name,
      label: hierarchyLabel(entry?.role, entry?.influence ?? 0, ageById.get(player.personId)),
      groupType: groupByPerson.get(player.personId) ?? "MAIN_GROUP",
    };
  });

  const people = new PeopleFoundationRepository(db);
  const rawGroups = squadSocialGroups(db, squadIds);
  const socialGroups: DressingRoomSocialGroup[] = rawGroups.map((group) => ({
    type: group.type,
    memberNames: group.personIds.map((id) => nameById.get(id) ?? "Unknown player"),
    clue: group.clue,
  }));

  const lifestyle: DressingRoomLifestyleEntry[] = squad.players
    .map((player) => {
      const personality = people.personality(player.personId);
      if (!personality) return undefined;
      const profile = derivePlayerLifestyle(personality);
      return {
        personId: player.personId,
        playerName: player.name,
        professionalismHabits: profile.professionalismHabits,
        trainingDiscipline: profile.trainingDiscipline,
        mediaActivity: profile.mediaActivity,
        offFieldFocus: profile.offFieldFocus,
      };
    })
    .filter((entry): entry is DressingRoomLifestyleEntry => Boolean(entry));

  const managerPersonId = context.character.personId;
  const managerRelationships = people.relationshipsForPerson(managerPersonId);
  const managerSupport: DressingRoomManagerSupportEntry[] = squad.players
    .map((player) => {
      const relationship = managerRelationships.find(
        (item) =>
          item.kind === "MANAGER_PLAYER" &&
          ((item.fromPersonId === managerPersonId && item.toPersonId === player.personId) ||
            (item.fromPersonId === player.personId && item.toPersonId === managerPersonId)),
      );
      if (!relationship) return undefined;
      return {
        personId: player.personId,
        playerName: player.name,
        support: supportLabelFrom(relationship.trust, relationship.tension),
      };
    })
    .filter((entry): entry is DressingRoomManagerSupportEntry => Boolean(entry));

  const world = new WorldRepository(db);
  const mentoring: DressingRoomMentoringEntry[] = people
    .activeMentoringForTeam(context.team.id)
    .map((assignment) => ({
      mentorName: nameById.get(assignment.mentorPersonId) ?? displayName(world.getPerson(assignment.mentorPersonId), "Unknown"),
      menteeName: nameById.get(assignment.menteePersonId) ?? displayName(world.getPerson(assignment.menteePersonId), "Unknown"),
      focus: assignment.focus,
      status: assignment.status,
      progressBand: progressBandFrom(assignment.progress),
    }));

  return { hierarchy, socialGroups, lifestyle, managerSupport, mentoring };
};
