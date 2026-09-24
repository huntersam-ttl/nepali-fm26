import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * The national team the President is looking at. Held outside React so that
 * opening a player or staff profile and coming back keeps the same team. It only
 * remembers an id; the team itself is always read from the runtime.
 */
let selectedNationalTeamId: EntityId | undefined;

export const getSelectedNationalTeam = (): EntityId | undefined => selectedNationalTeamId;

export const selectNationalTeam = (id: EntityId | undefined): void => {
  selectedNationalTeamId = id;
};

type TeamLike = { id: EntityId; level: string; gender: string };

/** The remembered team if it still exists, else the senior men's team, else the first team. */
export const resolveNationalTeam = <T extends TeamLike>(teams: T[], remembered: EntityId | undefined): T | undefined =>
  teams.find((team) => team.id === remembered) ??
  teams.find((team) => team.level === "senior" && team.gender === "men") ??
  teams[0];
