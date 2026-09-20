import type { SquadList, SquadPlayerRow } from "@nepal-football-sim/shared-types";

/**
 * Phase 3A — Squad helpers (pure, deterministic, no invented data).
 * Summaries come from real `SquadList` state only. We deliberately avoid
 * invented ability/threshold metrics: availability counts, contract expiry, a
 * positional depth distribution, and deterministic first-team ordering.
 */

export const squadAvailability = (squad: SquadList): Record<string, number> => squad.availabilityCounts;

export const squadTotal = (squad: SquadList): number => squad.players.length;

/** Players whose contract is recorded as expiring (has an expiry date). */
export const contractsExpiring = (squad: SquadList): SquadPlayerRow[] =>
  squad.players.filter((player) => Boolean(player.contractExpiry));

export const injuredOrSuspended = (squad: SquadList): SquadPlayerRow[] =>
  squad.players.filter((player) => player.availability === "INJURED" || player.availability === "SUSPENDED");

/** Positional depth: primary-position → count, deterministic (name-sorted). */
export const positionalDepth = (squad: SquadList): Array<{ position: string; count: number }> => {
  const counts = new Map<string, number>();
  for (const player of squad.players) {
    counts.set(player.primaryPosition, (counts.get(player.primaryPosition) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([position, count]) => ({ position, count }))
    .sort((a, b) => a.position.localeCompare(b.position));
};

export const positionOrder: Record<string, number> = {
  GOALKEEPER: 0,
  RIGHT_BACK: 1,
  CENTRE_BACK: 2,
  LEFT_BACK: 3,
  DEFENSIVE_MIDFIELDER: 4,
  CENTRAL_MIDFIELDER: 5,
  RIGHT_MIDFIELDER: 6,
  ATTACKING_MIDFIELDER: 7,
  LEFT_MIDFIELDER: 8,
  RIGHT_WINGER: 9,
  LEFT_WINGER: 10,
  STRIKER: 11,
};

/** Deterministic first-team ordering: by position group then name. */
export const sortFirstTeam = (players: SquadPlayerRow[]): SquadPlayerRow[] =>
  [...players].sort((a, b) => {
    const posA = positionOrder[a.primaryPosition] ?? 99;
    const posB = positionOrder[b.primaryPosition] ?? 99;
    if (posA !== posB) return posA - posB;
    return a.name.localeCompare(b.name);
  });