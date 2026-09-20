import type { TacticalSetup, SquadPlayerRow } from "@nepal-football-sim/shared-types";

/**
 * Phase 4A — pure Tactics presentation/selection model.
 * Slot enumeration, player assignment, swap, bench, and availability are
 * derived from the canonical TacticalSetup and squad reads only. No hidden
 * CA/PA and no fabricated positional ratings.
 */

export type SlotView = {
  id: string;
  label: string;
  x: number;
  y: number;
  playerId?: string;
};

/** Deterministic slot coordinates from the canonical formation slots. */
export const slotsForFormation = (slots: TacticalSetup["formation"]["slots"]): SlotView[] =>
  slots.map((slot) => ({ id: slot.id, label: slot.label ?? slot.id, x: slot.x, y: slot.y }));

/** Expected starting count for a formation (its real slot list length). */
export const intendedStartingCount = (slots: TacticalSetup["formation"]["slots"]): number => slots.length;

export const assignmentMap = (setup: TacticalSetup): Map<string, string> =>
  new Map(
    setup.assignments.filter((item) => Boolean(item.playerId)).map((item) => [item.slotId, item.playerId as string]),
  );

/** Assign a player to a slot, removing them from the bench (canonical shape). */
export const assignPlayerToSlot = (
  setup: TacticalSetup,
  slotId: string,
  playerId?: string,
): Pick<TacticalSetup, "assignments" | "bench"> => ({
  assignments: setup.assignments.map((item) =>
    item.slotId === slotId ? { ...item, playerId: playerId as TacticalSetup["assignments"][number]["playerId"] } : item,
  ) as TacticalSetup["assignments"],
  bench: playerId ? setup.bench.filter((id) => id !== (playerId as string)) : setup.bench,
});

/** Swap the players in two slots (occupied/empty allowed). */
export const swapSlots = (
  setup: TacticalSetup,
  slotA: string,
  slotB: string,
): Pick<TacticalSetup, "assignments"> => {
  const map = assignmentMap(setup);
  const a = map.get(slotA);
  const b = map.get(slotB);
  return {
    assignments: setup.assignments.map((item) => {
      if (item.slotId === slotA) return { ...item, playerId: b as TacticalSetup["assignments"][number]["playerId"] };
      if (item.slotId === slotB) return { ...item, playerId: a as TacticalSetup["assignments"][number]["playerId"] };
      return item;
    }) as TacticalSetup["assignments"],
  };
};

export const startingPlayerIds = (setup: TacticalSetup): string[] => [...assignmentMap(setup).values()];

export const hasDuplicateStarting = (setup: TacticalSetup): boolean => {
  const ids = startingPlayerIds(setup);
  return new Set(ids).size !== ids.length;
};

/** Squad markers that are genuinely available (operational availability). */
export const availablePlayers = (candidates: SquadPlayerRow[]): SquadPlayerRow[] =>
  candidates.filter((player) => player.availability === "AVAILABLE");