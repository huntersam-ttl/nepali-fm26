import type {
  EntityId,
  SetPieceAssignments,
  SquadPlayerRow,
  TacticalFamiliarity,
  TacticalSetup,
} from "@nepal-football-sim/shared-types";

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

export type TacticalMode =
  | "teamShape"
  | "inPossession"
  | "transition"
  | "outOfPossession"
  | "setPieces";

export const TACTICAL_MODES: ReadonlyArray<{ value: TacticalMode; label: string }> = [
  { value: "teamShape", label: "Team Shape" },
  { value: "setPieces", label: "Set Pieces" },
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

/* ------------------------------------------------------------------
 * Phase 4C — Set Pieces (pure presentation over canonical setPieces)
 * ------------------------------------------------------------------ */

/** The set-piece routines the canonical SetPieceAssignments model supports. */
export const SET_PIECE_ROUTINES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "penalty", label: "Penalty" },
  { value: "attackingCorner", label: "Attacking corner" },
  { value: "defendingCorner", label: "Defending corner" },
  { value: "attackingFreeKick", label: "Free kick (attacking)" },
];

/** "Throw-in" is not modelled by the engine — never surfaced as a routine. */
export const setPieceRoutineSupported = (value: string): boolean =>
  SET_PIECE_ROUTINES.some((routine) => routine.value === value);

/** Named assignment fields exposed by SetPieceAssignments. */
export const SET_PIECE_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "penaltyTaker", label: "Penalty taker" },
  { key: "leftCornerTaker", label: "Left corner taker" },
  { key: "rightCornerTaker", label: "Right corner taker" },
  { key: "directFreeKickTaker", label: "Free-kick direct taker" },
  { key: "indirectFreeKickTaker", label: "Free-kick indirect taker" },
  { key: "cornerPrimaryTarget", label: "Corner primary target" },
  { key: "cornerSecondaryTarget", label: "Corner secondary target" },
  { key: "cornerEdgeTarget", label: "Corner edge target" },
  { key: "cornerStayBack", label: "Corner stay back" },
  { key: "defensiveCornerAssignments", label: "Defensive corner marking" },
  { key: "defensiveAerialPriority", label: "Defensive aerial priority" },
  { key: "freeKickTarget", label: "Free-kick target" },
  { key: "freeKickSecondaryTarget", label: "Free-kick secondary target" },
];

/** Mutate exactly one set-piece field, preserving the rest of the contract. */
export const setPieceMutation = <K extends keyof SetPieceAssignments>(
  setPieces: SetPieceAssignments,
  key: K,
  value: SetPieceAssignments[K],
): SetPieceAssignments => ({ ...setPieces, [key]: value });

/** Swap two single-taker slots (e.g. swap left/right corner takers). */
export const swapTakers = (
  setPieces: SetPieceAssignments,
  fieldA: keyof SetPieceAssignments,
  fieldB: keyof SetPieceAssignments,
): SetPieceAssignments => {
  const a = setPieces[fieldA];
  const b = setPieces[fieldB];
  return setPieceMutation(setPieceMutation(setPieces, fieldA, b), fieldB, a);
};

/** Collapse duplicates from a multi-assignment list (engine-safe). */
export const dedupePlayers = (ids: ReadonlyArray<EntityId>): EntityId[] => [...new Set(ids)];

/** Individual roster of single taker fields (for name lookups). */
export const singleTakerKeys: ReadonlyArray<keyof SetPieceAssignments> = [
  "penaltyTaker",
  "leftCornerTaker",
  "rightCornerTaker",
  "directFreeKickTaker",
  "indirectFreeKickTaker",
  "cornerPrimaryTarget",
  "cornerSecondaryTarget",
  "cornerEdgeTarget",
  "freeKickTarget",
  "freeKickSecondaryTarget",
];

/* ------------------------------------------------------------------
 * Phase 4D — Tactics closure: relief, validation consolidation + readiness
 * ------------------------------------------------------------------ */

export const dedupeStrings = (items: readonly string[]): string[] => [...new Set(items)];

/** Deduplicates repeated validation messages while preserving severity. */
export const consolidateValidation = (validation: {
  blockingErrors: readonly string[];
  warnings: readonly string[];
}): { blockingErrors: string[]; warnings: string[] } => ({
  blockingErrors: dedupeStrings(validation.blockingErrors),
  warnings: dedupeStrings(validation.warnings),
});

export type StartingXIStatus = {
  required: number;
  selected: number;
  complete: boolean;
  hasGoalkeeper: boolean;
};

/**
 * Derived from canonical slot + assignment data only. The engine already emits
 * "Starting XI must contain exactly 11 players." (blocking) and
 * "No recognised goalkeeper has been assigned." (warning), so this helper is
 * for the factual summary line, not for re-classifying severity.
 */
export const startingXIStatus = (setup: TacticalSetup): StartingXIStatus => {
  const slots = setup.formation.slots;
  const selected = setup.assignments.filter((a) => Boolean(a.playerId)).length;
  const hasGoalkeeper = slots.some(
    (slot) => slot.position === "GK" && setup.assignments.some((a) => a.slotId === slot.id && a.playerId),
  );
  return {
    required: slots.length,
    selected,
    complete: selected === slots.length && hasGoalkeeper,
    hasGoalkeeper,
  };
};

/** Factual set-piece taker count — never a "completeness" grade. */
export const setPieceReadiness = (setPieces: SetPieceAssignments): string => {
  const count = [
    setPieces.penaltyTaker,
    setPieces.leftCornerTaker,
    setPieces.rightCornerTaker,
    setPieces.directFreeKickTaker,
    setPieces.indirectFreeKickTaker,
  ].filter(Boolean).length;
  return `Set pieces: ${count} takers assigned (defaults apply for the rest)`;
};

export type ReadinessSeverity = "blocking" | "warning" | "info";
export type ReadinessItem = { severity: ReadinessSeverity; text: string };

/**
 * Consolidated factual Match-readiness summary. Severity is taken verbatim from
 * the canonical SquadSelectionValidation lists (never invented new blocks), plus
 * pure informational lines. No synthetic readiness score is produced.
 */
export const readinessItems = (
  setup: TacticalSetup,
  familiarity: TacticalFamiliarity,
  validation: { blockingErrors: readonly string[]; warnings: readonly string[] },
): ReadonlyArray<ReadinessItem> => {
  const { required, selected, hasGoalkeeper } = startingXIStatus(setup);
  const items: ReadinessItem[] = [
    {
      severity: "info",
      text: `Starting XI: ${selected}/${required} selected${hasGoalkeeper ? " · goalkeeper set" : ""}`,
    },
    {
      severity: "info",
      text: `Tactical familiarity — formation ${familiarity.formation}% · style ${familiarity.style}% · roles ${familiarity.roles}% · instructions ${familiarity.instructions}%`,
    },
    { severity: "info", text: setPieceReadiness(setup.setPieces) },
  ];
  for (const text of consolidateValidation(validation).blockingErrors) {
    items.push({ severity: "blocking", text });
  }
  for (const text of consolidateValidation(validation).warnings) {
    items.push({ severity: "warning", text });
  }
  return items;
};

/**
 * Tactical cohesion beyond familiarity is not a separate canonical read.
 * TacticalFamiliarity (numbers) is the cohesion proxy within Tactics; the
 * dressing-room TeamCohesion (`TeamCohesion.level`) is a Dynamics concern and is
 * intentionally NOT relabelled as tactical chemistry here.
 */
export const tacticalCohesionPresent = (): boolean => false;