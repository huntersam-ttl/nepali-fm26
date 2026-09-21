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

/* ------------------------------------------------------------------
 * Phase 4B — roles, duties and tactical phases (pure model)
 * ------------------------------------------------------------------ */

export type TacticalMode = "teamShape" | "inPossession" | "transition" | "outOfPossession";

export const TACTICAL_MODES: ReadonlyArray<{ value: TacticalMode; label: string }> = [
  { value: "teamShape", label: "Team Shape" },
  { value: "inPossession", label: "In Possession" },
  { value: "transition", label: "Transition" },
  { value: "outOfPossession", label: "Out of Possession" },
];

/**
 * Roles a slot may legally take, from the canonical role.zones constraint
 * (empty zones means the role is unrestricted). The engine owns validity; the
 * UI only filters, never invents hard restrictions.
 */
export const legalRolesForSlot = (
  slotZone: string,
  roles: ReadonlyArray<{ id: string; name: string; zones: string[] }>,
): ReadonlyArray<{ id: string; name: string; zones: string[] }> =>
  roles.filter((role) => role.zones.length === 0 || role.zones.includes(slotZone));

export const currentRoleId = (setup: TacticalSetup, slotId: string): string | undefined =>
  setup.assignments.find((item) => item.slotId === slotId)?.roleId;

/** Everything three duties when the role does not restrict them. */
export const legalDuties = (
  role?: { allowedDuties?: ReadonlyArray<"DEFEND" | "SUPPORT" | "ATTACK"> },
): ReadonlyArray<"DEFEND" | "SUPPORT" | "ATTACK"> =>
  role?.allowedDuties?.length ? role.allowedDuties : ALL_DUTIES;

const ALL_DUTIES = ["DEFEND", "SUPPORT", "ATTACK"] as const;

/** Mutate exactly one phase of TeamInstructions, leaving the rest untouched. */
export const updatePhase = <P extends "inPossession" | "transition" | "outOfPossession">(
  instructions: TacticalSetup["instructions"],
  phase: P,
  patch: Partial<TacticalSetup["instructions"][P]>,
): TacticalSetup["instructions"] => {
  const next: TacticalSetup["instructions"] = { ...instructions };
  const target = { ...instructions[phase], ...(patch as Record<string, unknown>) };
  if (phase === "inPossession") next.inPossession = target as TacticalSetup["instructions"]["inPossession"];
  else if (phase === "transition") next.transition = target as TacticalSetup["instructions"]["transition"];
  else next.outOfPossession = target as TacticalSetup["instructions"]["outOfPossession"];
  return next;
};

/** Presentation groups for the In Possession editor (all canonical keys). */
export const IN_POSSESSION_GROUPS: ReadonlyArray<{ label: string; keys: ReadonlyArray<string> }> = [
  { label: "Shape", keys: ["tempo", "passingLength", "width", "buildUpRisk"] },
  { label: "Build-up", keys: ["playFromBack", "workBallIntoBox", "earlyCrosses"] },
  { label: "Focus", keys: ["focusMiddle", "focusLeft", "focusRight"] },
  { label: "Overlap / underlap", keys: ["overlapLeft", "overlapRight", "underlapLeft", "underlapRight"] },
];

/** Role change as a canonical assignment patch (keeps other assignments). */
export const changeRole = (
  setup: TacticalSetup,
  slotId: string,
  roleId: string,
): Pick<TacticalSetup, "assignments"> => ({
  assignments: setup.assignments.map((item) => (item.slotId === slotId ? { ...item, roleId } : item)),
});