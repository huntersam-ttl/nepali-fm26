import {
  createEntityId,
  createStableEntityId,
  type EntityId,
  type FormationDefinition,
  type ManagerAttributeSet,
  type PlayerAttributeSet,
  type PlayerPosition,
  type PlayerRoleDefinition,
  type RoleFit,
  type TacticalAssignment,
  type TacticalFamiliarity,
  type TacticalPositionCode,
  type TacticalSetup,
  type TacticalShapeAnalysis,
  type TacticalSlot,
  type TacticalStyleId,
  type TeamInstructions,
} from "@nepal-football-sim/shared-types";

export type TacticalMatchModifiers = {
  control: number;
  chanceCreation: number;
  xg: number;
  defense: number;
  transitionDefense: number;
  fatigue: number;
  possession: number;
  discipline: number;
  managerQuality: number;
};

export type TacticalPreparationInput = {
  setup: TacticalSetup;
  preparedOn: string;
  daysAvailable: number;
  trainingQuality?: number;
  managerQuality?: number;
  averageRoleFit?: number;
  /** Confidence in observed opposition tendencies; no value is inferred here. */
  oppositionKnowledge?: number;
};

export type TacticalPreparationResult = {
  setup: TacticalSetup;
  preparationScore: number;
  gains: TacticalFamiliarity;
};

export const DEFAULT_FAMILIARITY: TacticalFamiliarity = {
  formation: 72,
  style: 68,
  roles: 64,
  instructions: 66,
};

export const DEFAULT_TEAM_INSTRUCTIONS: TeamInstructions = {
  mentality: "BALANCED",
  inPossession: {
    tempo: 50,
    passingLength: 50,
    width: 50,
    buildUpRisk: 50,
    playFromBack: false,
    workBallIntoBox: false,
    earlyCrosses: false,
    focusMiddle: false,
    focusLeft: false,
    focusRight: false,
    overlapLeft: false,
    overlapRight: false,
    underlapLeft: false,
    underlapRight: false,
  },
  transition: {
    counterPress: false,
    regroup: false,
    counter: false,
    holdShape: true,
    goalkeeperDistributionStyle: "MIXED",
  },
  outOfPossession: {
    pressingIntensity: 50,
    defensiveLine: 50,
    engagementLine: 50,
    tacklingIntensity: 50,
    pressGoalkeeper: false,
    stopShortDistribution: false,
    forceInside: false,
    forceOutside: false,
  },
};

export const TACTICAL_STYLE_PRESETS: Record<TacticalStyleId, TeamInstructions> = {
  BALANCED: DEFAULT_TEAM_INSTRUCTIONS,
  POSSESSION: mergeInstructions({
    inPossession: {
      tempo: 42,
      passingLength: 28,
      buildUpRisk: 62,
      playFromBack: true,
      workBallIntoBox: true,
    },
    transition: { holdShape: true },
    outOfPossession: { pressingIntensity: 48 },
  }),
  GEGENPRESS: mergeInstructions({
    mentality: "POSITIVE",
    inPossession: { tempo: 70, passingLength: 42 },
    transition: { counterPress: true, counter: true, holdShape: false },
    outOfPossession: {
      pressingIntensity: 82,
      defensiveLine: 72,
      engagementLine: 76,
      pressGoalkeeper: true,
    },
  }),
  HIGH_PRESS: mergeInstructions({
    mentality: "POSITIVE",
    inPossession: { tempo: 64 },
    transition: { counterPress: true, holdShape: false },
    outOfPossession: {
      pressingIntensity: 78,
      defensiveLine: 70,
      engagementLine: 74,
      pressGoalkeeper: true,
    },
  }),
  COUNTER_ATTACK: mergeInstructions({
    mentality: "CAUTIOUS",
    inPossession: { tempo: 62, passingLength: 68, buildUpRisk: 38 },
    transition: { counter: true, regroup: true, holdShape: false },
    outOfPossession: { pressingIntensity: 38, defensiveLine: 38, engagementLine: 42 },
  }),
  DIRECT: mergeInstructions({
    inPossession: { tempo: 68, passingLength: 78, earlyCrosses: true, buildUpRisk: 45 },
    transition: { counter: true },
    outOfPossession: { pressingIntensity: 54 },
  }),
  LOW_BLOCK: mergeInstructions({
    mentality: "DEFENSIVE",
    inPossession: { tempo: 38, passingLength: 60, width: 42, buildUpRisk: 30 },
    transition: { regroup: true, holdShape: true },
    outOfPossession: { pressingIntensity: 28, defensiveLine: 24, engagementLine: 30 },
  }),
  WING_PLAY: mergeInstructions({
    inPossession: {
      tempo: 58,
      passingLength: 56,
      width: 78,
      earlyCrosses: true,
      focusLeft: true,
      focusRight: true,
      overlapLeft: true,
      overlapRight: true,
    },
  }),
  VERTICAL: mergeInstructions({
    mentality: "POSITIVE",
    inPossession: { tempo: 74, passingLength: 66, buildUpRisk: 58 },
    transition: { counter: true },
    outOfPossession: { engagementLine: 60 },
  }),
};

export const ROLE_DEFINITIONS: readonly PlayerRoleDefinition[] = [
  role("GOALKEEPER", "Goalkeeper", "GOALKEEPER", ["goalkeeper"], {
    "goalkeeping.handling": 2,
    "goalkeeping.reflexes": 2,
    "goalkeeping.oneOnOnes": 1.5,
    "goalkeeping.commandOfArea": 1,
    "mental.positioning": 1,
  }),
  role("SWEEPER_KEEPER", "Sweeper Keeper", "GOALKEEPER", ["goalkeeper"], {
    "goalkeeping.reflexes": 1.5,
    "goalkeeping.oneOnOnes": 1.5,
    "goalkeeping.distribution": 1.5,
    "goalkeeping.kicking": 1,
    "mental.decisions": 1.2,
  }),
  role("NO_NONSENSE_DEFENDER", "No-Nonsense Defender", "CENTRE_BACK", ["defense"], {
    "technical.tackling": 2,
    "technical.heading": 1.6,
    "mental.positioning": 1.6,
    "physical.strength": 1.4,
    "mental.anticipation": 1,
  }),
  role("BALL_PLAYING_DEFENDER", "Ball-Playing Defender", "CENTRE_BACK", ["defense"], {
    "technical.passing": 1.6,
    "technical.technique": 1.3,
    "mental.composure": 1.4,
    "mental.decisions": 1.3,
    "mental.positioning": 1,
    "technical.tackling": 1,
  }),
  role("STOPPER", "Stopper", "CENTRE_BACK", ["defense"], {
    "technical.tackling": 1.8,
    "mental.aggression": 1.4,
    "physical.strength": 1.4,
    "mental.anticipation": 1.2,
  }),
  role("COVER", "Cover", "CENTRE_BACK", ["defense"], {
    "physical.pace": 1.4,
    "mental.positioning": 1.5,
    "mental.anticipation": 1.5,
    "technical.tackling": 1.2,
  }),
  role("WIDE_CENTRE_BACK", "Wide Centre Back", "CENTRE_BACK", ["defense", "wingback"], {
    "technical.tackling": 1.4,
    "technical.passing": 1,
    "physical.pace": 1,
    "mental.positioning": 1.3,
  }),
  role("LIBERO", "Libero", "CENTRE_BACK", ["defense"], {
    "technical.passing": 1.4,
    "technical.technique": 1.2,
    "mental.vision": 1.2,
    "mental.decisions": 1.4,
    "technical.tackling": 1,
  }),
  role("FULL_BACK", "Full Back", "FULLBACK_WINGBACK", ["defense", "wingback"], {
    "technical.tackling": 1.3,
    "technical.crossing": 1.1,
    "physical.stamina": 1.3,
    "mental.teamwork": 1.2,
  }),
  role("WING_BACK", "Wing Back", "FULLBACK_WINGBACK", ["wingback", "defense"], {
    "technical.crossing": 1.4,
    "physical.stamina": 1.5,
    "physical.pace": 1.2,
    "technical.dribbling": 1,
  }),
  role("INVERTED_FULL_BACK", "Inverted Full Back", "FULLBACK_WINGBACK", ["defense", "wingback"], {
    "technical.passing": 1.4,
    "mental.decisions": 1.3,
    "technical.tackling": 1,
    "mental.positioning": 1,
  }),
  role("ANCHOR", "Anchor", "MIDFIELD", ["defensiveMidfield", "midfield"], {
    "mental.positioning": 1.6,
    "technical.tackling": 1.5,
    "mental.anticipation": 1.3,
    "physical.strength": 1,
  }),
  role(
    "DEFENSIVE_MIDFIELDER",
    "Defensive Midfielder",
    "MIDFIELD",
    ["defensiveMidfield", "midfield"],
    {
      "technical.tackling": 1.4,
      "mental.positioning": 1.3,
      "technical.passing": 1,
      "physical.stamina": 1.1,
    },
  ),
  role(
    "DEEP_LYING_PLAYMAKER",
    "Deep-Lying Playmaker",
    "MIDFIELD",
    ["defensiveMidfield", "midfield"],
    {
      "technical.passing": 1.7,
      "mental.vision": 1.5,
      "mental.decisions": 1.3,
      "mental.composure": 1,
    },
  ),
  role("BOX_TO_BOX_MIDFIELDER", "Box-to-Box Midfielder", "MIDFIELD", ["midfield"], {
    "physical.stamina": 1.6,
    "mental.workRate": 1.5,
    "technical.passing": 1,
    "technical.tackling": 1,
    "technical.finishing": 0.8,
  }),
  role("CENTRAL_MIDFIELDER", "Central Midfielder", "MIDFIELD", ["midfield"], {
    "technical.passing": 1.3,
    "mental.decisions": 1.3,
    "mental.teamwork": 1.2,
    "physical.stamina": 1,
  }),
  role("MEZZALA", "Mezzala", "MIDFIELD", ["midfield", "attackingMidfield"], {
    "technical.dribbling": 1.2,
    "technical.passing": 1.2,
    "mental.vision": 1.2,
    "physical.stamina": 1,
  }),
  role("ADVANCED_PLAYMAKER", "Advanced Playmaker", "MIDFIELD", ["midfield", "attackingMidfield"], {
    "technical.passing": 1.6,
    "mental.vision": 1.6,
    "technical.technique": 1.2,
    "mental.decisions": 1,
  }),
  role("WINGER", "Winger", "WIDE_ATTACKING", ["attackingMidfield", "midfield"], {
    "technical.crossing": 1.5,
    "technical.dribbling": 1.4,
    "physical.pace": 1.3,
    "physical.acceleration": 1,
  }),
  role("INSIDE_FORWARD", "Inside Forward", "WIDE_ATTACKING", ["attackingMidfield"], {
    "technical.finishing": 1.4,
    "technical.dribbling": 1.3,
    "physical.acceleration": 1.1,
    "mental.composure": 1,
  }),
  role("WIDE_PLAYMAKER", "Wide Playmaker", "WIDE_ATTACKING", ["attackingMidfield", "midfield"], {
    "technical.passing": 1.5,
    "mental.vision": 1.5,
    "technical.technique": 1.2,
    "mental.decisions": 1,
  }),
  role("POACHER", "Poacher", "FORWARD", ["forward"], {
    "technical.finishing": 1.8,
    "mental.anticipation": 1.3,
    "mental.composure": 1.2,
    "physical.acceleration": 1,
  }),
  role("TARGET_FORWARD", "Target Forward", "FORWARD", ["forward"], {
    "physical.strength": 1.4,
    "technical.heading": 1.4,
    "mental.teamwork": 1,
    "technical.finishing": 1,
  }),
  role("PRESSING_FORWARD", "Pressing Forward", "FORWARD", ["forward"], {
    "mental.workRate": 1.5,
    "physical.stamina": 1.4,
    "physical.acceleration": 1.1,
    "mental.aggression": 1.1,
    "mental.teamwork": 1,
    "technical.finishing": 0.9,
  }),
  role("ADVANCED_FORWARD", "Advanced Forward", "FORWARD", ["forward"], {
    "technical.finishing": 1.5,
    "physical.pace": 1.2,
    "mental.composure": 1.2,
    "technical.dribbling": 1,
  }),
  role("COMPLETE_FORWARD", "Complete Forward", "FORWARD", ["forward"], {
    "technical.finishing": 1.2,
    "technical.passing": 1,
    "technical.heading": 1,
    "mental.composure": 1,
    "physical.strength": 1,
  }),
];

export const FORMATION_PRESETS: readonly FormationDefinition[] = [
  formation("4-3-3", [
    slot("GK", "GK", 50, 6),
    slot("DL", "DL", 18, 24),
    slot("DCL", "DCL", 38, 22),
    slot("DCR", "DCR", 62, 22),
    slot("DR", "DR", 82, 24),
    slot("MCL", "MCL", 38, 50),
    slot("MC", "MC", 50, 48),
    slot("MCR", "MCR", 62, 50),
    slot("AML", "AML", 22, 78),
    slot("AMR", "AMR", 78, 78),
    slot("STC", "STC", 50, 88),
  ]),
  formation("4-2-3-1", [
    slot("GK", "GK", 50, 6),
    slot("DL", "DL", 18, 24),
    slot("DCL", "DCL", 38, 22),
    slot("DCR", "DCR", 62, 22),
    slot("DR", "DR", 82, 24),
    slot("DML", "DML", 42, 42),
    slot("DMR", "DMR", 58, 42),
    slot("AML", "AML", 22, 70),
    slot("AMC", "AMC", 50, 70),
    slot("AMR", "AMR", 78, 70),
    slot("STC", "STC", 50, 88),
  ]),
  formation("4-4-2", [
    slot("GK", "GK", 50, 6),
    slot("DL", "DL", 18, 24),
    slot("DCL", "DCL", 38, 22),
    slot("DCR", "DCR", 62, 22),
    slot("DR", "DR", 82, 24),
    slot("ML", "ML", 18, 54),
    slot("MCL", "MCL", 42, 52),
    slot("MCR", "MCR", 58, 52),
    slot("MR", "MR", 82, 54),
    slot("STL", "STL", 42, 86),
    slot("STR", "STR", 58, 86),
  ]),
  formation("3-4-2-1", [
    slot("GK", "GK", 50, 6),
    slot("DCL", "DCL", 32, 24),
    slot("DC", "DC", 50, 22),
    slot("DCR", "DCR", 68, 24),
    slot("WBL", "WBL", 16, 52),
    slot("MCL", "MCL", 42, 50),
    slot("MCR", "MCR", 58, 50),
    slot("WBR", "WBR", 84, 52),
    slot("AML", "AML", 40, 74),
    slot("AMR", "AMR", 60, 74),
    slot("STC", "STC", 50, 88),
  ]),
  formation("3-5-2", [
    slot("GK", "GK", 50, 6),
    slot("DCL", "DCL", 32, 24),
    slot("DC", "DC", 50, 22),
    slot("DCR", "DCR", 68, 24),
    slot("WBL", "WBL", 16, 54),
    slot("MCL", "MCL", 40, 50),
    slot("MC", "MC", 50, 48),
    slot("MCR", "MCR", 60, 50),
    slot("WBR", "WBR", 84, 54),
    slot("STL", "STL", 42, 86),
    slot("STR", "STR", 58, 86),
  ]),
  formation("4-1-4-1", [
    slot("GK", "GK", 50, 6),
    slot("DL", "DL", 18, 24),
    slot("DCL", "DCL", 38, 22),
    slot("DCR", "DCR", 62, 22),
    slot("DR", "DR", 82, 24),
    slot("DM", "DM", 50, 40),
    slot("ML", "ML", 18, 60),
    slot("MCL", "MCL", 42, 58),
    slot("MCR", "MCR", 58, 58),
    slot("MR", "MR", 82, 60),
    slot("STC", "STC", 50, 88),
  ]),
];

export const createCustomFormation = (input: {
  name: string;
  slots: readonly TacticalSlot[];
}): FormationDefinition => {
  validateFormation(input.slots);
  return {
    id: createStableEntityId("custom-formation", `${input.name}:${JSON.stringify(input.slots)}`),
    name: input.name,
    kind: "CUSTOM",
    slots: [...input.slots],
  };
};

export const createTacticalSetup = (input: {
  teamId: EntityId;
  managerProfileId?: EntityId;
  name: string;
  formation?: FormationDefinition;
  style?: TacticalStyleId;
  assignments?: readonly TacticalAssignment[];
  bench?: readonly EntityId[];
  familiarity?: TacticalFamiliarity;
}): TacticalSetup => {
  const formationDefinition = input.formation ?? FORMATION_PRESETS[0]!;
  const style = input.style ?? "BALANCED";
  validateFormation(formationDefinition.slots);
  return {
    id: createEntityId(),
    managerProfileId: input.managerProfileId,
    teamId: input.teamId,
    name: input.name,
    formation: formationDefinition,
    style,
    instructions: TACTICAL_STYLE_PRESETS[style],
    familiarity: input.familiarity ?? DEFAULT_FAMILIARITY,
    assignments: input.assignments
      ? [...input.assignments]
      : defaultAssignments(formationDefinition),
    bench: input.bench ? [...input.bench] : [],
    setPieces: {},
    createdOn: "2026-08-01",
    updatedOn: "2026-08-01",
  };
};

export type TacticalVariant =
  "PRIMARY" | "ATTACKING" | "DEFENSIVE" | "LATE_GAME_CHASE" | "PROTECT_LEAD";

/** Creates a named variant without resetting formation, roles, or familiarity. */
export const createTacticalVariant = (
  setup: TacticalSetup,
  variant: TacticalVariant,
): TacticalSetup => {
  const styleByVariant: Record<Exclude<TacticalVariant, "PRIMARY">, TacticalStyleId> = {
    ATTACKING: "VERTICAL",
    DEFENSIVE: "LOW_BLOCK",
    LATE_GAME_CHASE: "HIGH_PRESS",
    PROTECT_LEAD: "LOW_BLOCK",
  };
  if (variant === "PRIMARY")
    return {
      ...setup,
      name: setup.name.replace(/ \((ATTACKING|DEFENSIVE|LATE_GAME_CHASE|PROTECT_LEAD)\)$/, ""),
    };
  const style = styleByVariant[variant];
  const preset = TACTICAL_STYLE_PRESETS[style];
  const adjustments =
    variant === "PROTECT_LEAD"
      ? {
          ...preset,
          mentality: "CAUTIOUS" as const,
          transition: { ...preset.transition, holdShape: true, regroup: true, counter: false },
        }
      : variant === "LATE_GAME_CHASE"
        ? {
            ...preset,
            mentality: "ATTACKING" as const,
            transition: { ...preset.transition, counter: true, counterPress: true },
          }
        : preset;
  return {
    ...setup,
    id: createStableEntityId("tactical-variant", `${setup.id}:${variant}`),
    name: `${setup.name.replace(/ \((ATTACKING|DEFENSIVE|LATE_GAME_CHASE|PROTECT_LEAD)\)$/, "")} (${variant})`,
    style,
    instructions: adjustments,
  };
};

/**
 * Advance the existing setup's pre-match familiarity. This is intentionally a
 * pure setup transformation: persistence remains the tactical-setups
 * repository and match simulation still consumes TacticalSetup directly.
 */
export const prepareTacticalSetup = (
  input: TacticalPreparationInput,
): TacticalPreparationResult => {
  const days = Math.max(0, Math.min(21, input.daysAvailable));
  const trainingQuality = Math.max(0, Math.min(100, input.trainingQuality ?? 60));
  const managerQuality = Math.max(0, Math.min(100, input.managerQuality ?? 60));
  const roleFit = Math.max(0, Math.min(100, input.averageRoleFit ?? 70));
  const oppositionKnowledge = Math.max(0, Math.min(100, input.oppositionKnowledge ?? 0));
  const preparationScore =
    days * 0.65 +
    trainingQuality * 0.18 +
    managerQuality * 0.1 +
    roleFit * 0.07 +
    oppositionKnowledge * 0.08;
  const gains: TacticalFamiliarity = {
    formation: Math.min(100, Math.round(days * (0.35 + trainingQuality / 500))),
    style: Math.min(100, Math.round(days * (0.28 + managerQuality / 600))),
    roles: Math.min(100, Math.round(days * (0.22 + roleFit / 700))),
    instructions: Math.min(
      100,
      Math.round(days * (0.2 + (trainingQuality + oppositionKnowledge) / 800)),
    ),
  };
  const nextFamiliarity: TacticalFamiliarity = {
    formation: Math.min(100, input.setup.familiarity.formation + gains.formation),
    style: Math.min(100, input.setup.familiarity.style + gains.style),
    roles: Math.min(100, input.setup.familiarity.roles + gains.roles),
    instructions: Math.min(100, input.setup.familiarity.instructions + gains.instructions),
  };
  return {
    setup: {
      ...input.setup,
      familiarity: nextFamiliarity,
      updatedOn: input.preparedOn,
    },
    preparationScore: Math.round(preparationScore * 100) / 100,
    gains,
  };
};

export const validateFormation = (slots: readonly TacticalSlot[]): void => {
  const ids = new Set<string>();
  for (const candidate of slots) {
    if (ids.has(candidate.id)) {
      throw new Error(`Duplicate tactical slot: ${candidate.id}`);
    }
    ids.add(candidate.id);
    if (candidate.x < 0 || candidate.x > 100 || candidate.y < 0 || candidate.y > 100) {
      throw new Error(`Tactical slot ${candidate.id} coordinates must be between 0 and 100`);
    }
  }
};

export const validateSelection = (input: {
  setup: TacticalSetup;
  players: readonly PlayerAttributeSet[];
  benchLimit?: number;
  playerName?: (playerId: EntityId) => string;
}): { isValid: boolean; blockingErrors: string[]; warnings: string[] } => {
  const assigned = input.setup.assignments.flatMap((assignment) =>
    assignment.playerId ? [assignment.playerId] : [],
  );
  const playerIds = new Set(input.players.map((player) => player.personId));
  const duplicateStarters = duplicates(assigned);
  const unavailableAssigned = [...assigned, ...input.setup.bench].filter(
    (id) => !playerIds.has(id),
  );
  const duplicateBench = duplicates(input.setup.bench);
  const benchStarterOverlap = input.setup.bench.filter((id) => assigned.includes(id));
  const goalkeeperSlots = input.setup.assignments.filter((assignment) => {
    const slot = input.setup.formation.slots.find(
      (candidate) => candidate.id === assignment.slotId,
    );
    return slot?.position === "GK" && assignment.playerId;
  });
  const errors = [
    assigned.length !== 11 ? "Starting XI must contain exactly 11 players." : undefined,
    duplicateStarters.length ? "A player cannot occupy two tactical slots." : undefined,
    duplicateBench.length ? "Bench cannot contain duplicate players." : undefined,
    benchStarterOverlap.length ? "Bench cannot include starting players." : undefined,
    unavailableAssigned.length
      ? "Selection contains players outside the available squad."
      : undefined,
    input.benchLimit !== undefined && input.setup.bench.length > input.benchLimit
      ? `Bench exceeds competition limit of ${input.benchLimit}.`
      : undefined,
  ].filter((value): value is string => Boolean(value));
  const warnings = [
    goalkeeperSlots.length === 0 ? "No recognised goalkeeper has been assigned." : undefined,
    input.setup.assignments.some((assignment) => !assignment.playerId)
      ? "One or more tactical slots are unfilled."
      : undefined,
    ...outOfPositionWarnings(input.setup, input.players, input.playerName),
  ].filter((value): value is string => Boolean(value));

  return { isValid: errors.length === 0, blockingErrors: errors, warnings };
};

export const calculateRoleFit = (input: {
  player: PlayerAttributeSet;
  slot: TacticalSlot;
  role: PlayerRoleDefinition;
  familiarity?: number;
}): RoleFit => {
  const positionFit = tacticalPositionFit(input.player, input.slot.position);
  const attributeFit = weightedAttributeFit(input.player, input.role.weightedAttributes);
  const zoneFit = input.role.preferredZones.includes(input.slot.zone) ? 100 : 72;
  const physicalFit = physicalSuitability(input.player, input.slot.zone);
  const familiarity = input.familiarity ?? 65;
  const preferredFootFit = wideFootFit(input.slot.position);
  const overall =
    positionFit * 0.27 +
    attributeFit * 0.38 +
    zoneFit * 0.12 +
    familiarity * 0.12 +
    preferredFootFit * 0.04 +
    physicalFit * 0.07;
  return {
    playerId: input.player.personId,
    slotId: input.slot.id,
    roleId: input.role.id,
    positionFit: round(positionFit),
    attributeFit: round(attributeFit),
    familiarity: round(familiarity),
    preferredFootFit,
    physicalFit: round(physicalFit),
    overall: round(overall),
    label: fitLabel(overall),
  };
};

export const analyzeTacticalShape = (
  formationDefinition: FormationDefinition,
): TacticalShapeAnalysis => {
  const slots = formationDefinition.slots;
  const count = (predicate: (slot: TacticalSlot) => boolean): number =>
    slots.filter(predicate).length;
  const wide = count((candidate) => candidate.x <= 24 || candidate.x >= 76);
  const central = count((candidate) => candidate.x > 34 && candidate.x < 66);
  const defensive = count(
    (candidate) => candidate.zone === "defense" || candidate.zone === "wingback",
  );
  const midfield = count(
    (candidate) => candidate.zone === "defensiveMidfield" || candidate.zone === "midfield",
  );
  const attacking = count(
    (candidate) => candidate.zone === "attackingMidfield" || candidate.zone === "forward",
  );
  const restDefense = count((candidate) => candidate.y <= 45);
  const pressing = count((candidate) => candidate.y >= 58);
  const warnings = [
    defensive < 3 ? "Defensive coverage is thin." : undefined,
    midfield < 2 ? "Midfield control may be weak." : undefined,
    wide < 2 ? "Wide coverage is limited." : undefined,
    attacking > 5 ? "Rest defense may suffer with this many advanced players." : undefined,
  ].filter((value): value is string => Boolean(value));
  return {
    width: round((wide / 6) * 100),
    centralDensity: round((central / 7) * 100),
    defensiveCoverage: round((defensive / 5) * 100),
    midfieldControl: round((midfield / 5) * 100),
    attackingNumbers: round((attacking / 5) * 100),
    restDefense: round((restDefense / 6) * 100),
    pressingStructure: round((pressing / 5) * 100),
    warnings,
  };
};

export const calculateTacticalModifiers = (input: {
  setup: TacticalSetup;
  manager?: ManagerAttributeSet;
  averageRoleFit?: number;
}): TacticalMatchModifiers => {
  const shape = analyzeTacticalShape(input.setup.formation);
  const instructions = input.setup.instructions;
  const familiarity = average(Object.values(input.setup.familiarity));
  const roleFit = input.averageRoleFit ?? 70;
  const managerQuality = input.manager ? managerMatchQuality(input.manager) : 10;
  const mentality = mentalityRisk(input.setup.instructions.mentality);
  const style = styleBase(input.setup.style);
  const pressing = (instructions.outOfPossession.pressingIntensity - 50) / 100;
  const tempo = (instructions.inPossession.tempo - 50) / 100;
  const directness = (instructions.inPossession.passingLength - 50) / 100;
  const familiarityPenalty = (70 - familiarity) / 200;
  const fitBonus = (roleFit - 70) / 220;

  return {
    control: clamp(
      1 + style.control + shape.midfieldControl / 800 + managerQuality / 500 - familiarityPenalty,
      0.86,
      1.16,
    ),
    chanceCreation: clamp(
      1 + style.chanceCreation + tempo * 0.1 + directness * 0.05 + mentality.chance + fitBonus,
      0.84,
      1.2,
    ),
    xg: clamp(
      1 + style.xg + mentality.xg + (instructions.inPossession.workBallIntoBox ? 0.03 : 0),
      0.88,
      1.16,
    ),
    defense: clamp(
      1 + style.defense + shape.defensiveCoverage / 900 + mentality.defense,
      0.84,
      1.2,
    ),
    transitionDefense: clamp(
      1 + style.transitionDefense + shape.restDefense / 850 - mentality.risk,
      0.82,
      1.18,
    ),
    fatigue: clamp(1 + style.fatigue + pressing * 0.18 + tempo * 0.08, 0.9, 1.22),
    possession: clamp(
      1 + style.possession + (instructions.inPossession.playFromBack ? 0.04 : 0),
      0.86,
      1.16,
    ),
    discipline: clamp(1 + (instructions.outOfPossession.tacklingIntensity - 50) / 250, 0.9, 1.16),
    managerQuality,
  };
};

export const tacticalPositionToPlayerPosition = (
  position: TacticalPositionCode,
): PlayerPosition => {
  if (position === "GK") return "GK";
  if (["DL", "WBL"].includes(position)) return "LB";
  if (["DR", "WBR"].includes(position)) return "RB";
  if (["DCL", "DC", "DCR"].includes(position)) return "CB";
  if (["DM", "DML", "DMR"].includes(position)) return "DM";
  if (["ML", "MCL", "MC", "MCR", "MR"].includes(position)) return "CM";
  if (["AML", "AMC", "AMR"].includes(position)) return "AM";
  return "ST";
};

export const roleById = (roleId: string): PlayerRoleDefinition =>
  ROLE_DEFINITIONS.find((candidate) => candidate.id === roleId) ?? ROLE_DEFINITIONS[0]!;

const defaultAssignments = (formationDefinition: FormationDefinition): TacticalAssignment[] =>
  formationDefinition.slots.map((candidate) => ({
    slotId: candidate.id,
    roleId: defaultRoleForSlot(candidate),
  }));

const defaultRoleForSlot = (slotDefinition: TacticalSlot): string => {
  if (slotDefinition.position === "GK") return "GOALKEEPER";
  if (slotDefinition.zone === "defense") {
    return slotDefinition.x > 28 && slotDefinition.x < 72 ? "BALL_PLAYING_DEFENDER" : "FULL_BACK";
  }
  if (slotDefinition.zone === "wingback") return "WING_BACK";
  if (slotDefinition.zone === "defensiveMidfield") return "DEFENSIVE_MIDFIELDER";
  if (slotDefinition.zone === "midfield") return "CENTRAL_MIDFIELDER";
  if (slotDefinition.zone === "attackingMidfield")
    return slotDefinition.position === "AMC" ? "ADVANCED_PLAYMAKER" : "WINGER";
  return "ADVANCED_FORWARD";
};

function mergeInstructions(overrides: {
  mentality?: TeamInstructions["mentality"];
  inPossession?: Partial<TeamInstructions["inPossession"]>;
  transition?: Partial<TeamInstructions["transition"]>;
  outOfPossession?: Partial<TeamInstructions["outOfPossession"]>;
}): TeamInstructions {
  return {
    mentality: overrides.mentality ?? DEFAULT_TEAM_INSTRUCTIONS.mentality,
    inPossession: { ...DEFAULT_TEAM_INSTRUCTIONS.inPossession, ...overrides.inPossession },
    transition: { ...DEFAULT_TEAM_INSTRUCTIONS.transition, ...overrides.transition },
    outOfPossession: { ...DEFAULT_TEAM_INSTRUCTIONS.outOfPossession, ...overrides.outOfPossession },
  };
}

function role(
  id: string,
  name: string,
  family: PlayerRoleDefinition["family"],
  preferredZones: TacticalSlot["zone"][],
  weightedAttributes: Record<string, number>,
): PlayerRoleDefinition {
  return { id, name, family, preferredZones, weightedAttributes };
}

function formation(name: string, slots: readonly TacticalSlot[]): FormationDefinition {
  return {
    id: createStableEntityId("formation", name),
    name,
    kind: "PRESET",
    slots: [...slots],
  };
}

function slot(position: TacticalPositionCode, label: string, x: number, y: number): TacticalSlot {
  return { id: label, label, position, x, y, zone: zoneFor(position) };
}

function zoneFor(position: TacticalPositionCode): TacticalSlot["zone"] {
  if (position === "GK") return "goalkeeper";
  if (["DL", "DCL", "DC", "DCR", "DR"].includes(position)) return "defense";
  if (["WBL", "WBR"].includes(position)) return "wingback";
  if (["DM", "DML", "DMR"].includes(position)) return "defensiveMidfield";
  if (["ML", "MCL", "MC", "MCR", "MR"].includes(position)) return "midfield";
  if (["AML", "AMC", "AMR"].includes(position)) return "attackingMidfield";
  return "forward";
}

function tacticalPositionFit(player: PlayerAttributeSet, position: TacticalPositionCode): number {
  const mapped = tacticalPositionToPlayerPosition(position);
  if (player.primaryPosition === mapped) return 100;
  if (player.secondaryPositions.includes(mapped)) return 86;
  if (mapped === "CM" && ["DM", "AM"].includes(player.primaryPosition)) return 76;
  if (mapped === "CB" && ["RB", "LB", "DM"].includes(player.primaryPosition)) return 72;
  if (mapped === "ST" && ["RW", "LW", "AM"].includes(player.primaryPosition)) return 70;
  return 54;
}

function weightedAttributeFit(player: PlayerAttributeSet, weights: Record<string, number>): number {
  const entries = Object.entries(weights);
  const totalWeight = entries.reduce((total, [, weight]) => total + weight, 0);
  const score = entries.reduce(
    (total, [path, weight]) => total + attribute(player, path) * weight,
    0,
  );
  return (score / totalWeight) * 5;
}

function attribute(player: PlayerAttributeSet, path: string): number {
  const [group, key] = path.split(".") as [keyof PlayerAttributeSet, string];
  const source = player[group] as Record<string, unknown>;
  const value = source[key];
  return typeof value === "number" ? value : 8;
}

function physicalSuitability(player: PlayerAttributeSet, zone: TacticalSlot["zone"]): number {
  if (zone === "goalkeeper") return average(Object.values(player.goalkeeping)) * 5;
  if (zone === "forward" || zone === "attackingMidfield") {
    return (
      average([player.physical.pace, player.physical.acceleration, player.physical.agility]) * 5
    );
  }
  if (zone === "defense") {
    return (
      average([player.physical.strength, player.physical.jumping, player.physical.balance]) * 5
    );
  }
  return (
    average([player.physical.stamina, player.physical.balance, player.physical.naturalFitness]) * 5
  );
}

function wideFootFit(position: TacticalPositionCode): number {
  return ["DL", "WBL", "ML", "AML", "DR", "WBR", "MR", "AMR"].includes(position) ? 88 : 94;
}

function fitLabel(score: number): RoleFit["label"] {
  if (score >= 88) return "Natural";
  if (score >= 78) return "Very Good";
  if (score >= 68) return "Good";
  if (score >= 55) return "Adequate";
  if (score >= 42) return "Weak";
  return "Poor";
}

function outOfPositionWarnings(
  setup: TacticalSetup,
  players: readonly PlayerAttributeSet[],
  playerName: (playerId: EntityId) => string = () => "Selected player",
): string[] {
  const byPerson = new Map(players.map((player) => [player.personId, player]));
  return setup.assignments.flatMap((assignment) => {
    const player = assignment.playerId ? byPerson.get(assignment.playerId) : undefined;
    const slotDefinition = setup.formation.slots.find(
      (candidate) => candidate.id === assignment.slotId,
    );
    if (!player || !slotDefinition) return [];
    return tacticalPositionFit(player, slotDefinition.position) < 60
      ? [`${playerName(player.personId)} is heavily out of position at ${slotDefinition.label}.`]
      : [];
  });
}

function duplicates(values: readonly EntityId[]): EntityId[] {
  const seen = new Set<EntityId>();
  return values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
}

function managerMatchQuality(attributes: ManagerAttributeSet): number {
  return average([
    attributes.tactical.tacticalKnowledge,
    attributes.tactical.matchManagement,
    attributes.tactical.adaptability,
    attributes.people.motivation,
    attributes.people.communication,
  ]);
}

function styleBase(
  style: TacticalStyleId,
): Omit<TacticalMatchModifiers, "discipline" | "managerQuality"> {
  const base = {
    control: 0,
    chanceCreation: 0,
    xg: 0,
    defense: 0,
    transitionDefense: 0,
    fatigue: 0,
    possession: 0,
  };
  switch (style) {
    case "POSSESSION":
      return {
        ...base,
        control: 0.07,
        chanceCreation: -0.02,
        defense: 0.02,
        possession: 0.08,
        fatigue: -0.02,
      };
    case "GEGENPRESS":
      return {
        ...base,
        control: 0.03,
        chanceCreation: 0.08,
        defense: -0.03,
        transitionDefense: -0.05,
        fatigue: 0.11,
      };
    case "HIGH_PRESS":
      return {
        ...base,
        chanceCreation: 0.06,
        defense: -0.02,
        transitionDefense: -0.04,
        fatigue: 0.08,
      };
    case "COUNTER_ATTACK":
      return {
        ...base,
        control: -0.05,
        chanceCreation: 0.03,
        xg: 0.04,
        defense: 0.04,
        possession: -0.06,
      };
    case "DIRECT":
      return {
        ...base,
        control: -0.04,
        chanceCreation: 0.06,
        xg: 0.02,
        possession: -0.05,
        fatigue: 0.02,
      };
    case "LOW_BLOCK":
      return {
        ...base,
        control: -0.08,
        chanceCreation: -0.05,
        defense: 0.09,
        transitionDefense: 0.08,
        possession: -0.06,
      };
    case "WING_PLAY":
      return { ...base, chanceCreation: 0.03, xg: 0.02, defense: -0.01 };
    case "VERTICAL":
      return { ...base, control: -0.03, chanceCreation: 0.07, xg: 0.02, transitionDefense: -0.02 };
    case "BALANCED":
      return base;
  }
}

function mentalityRisk(mentality: TeamInstructions["mentality"]): {
  chance: number;
  xg: number;
  defense: number;
  risk: number;
} {
  const table: Record<
    TeamInstructions["mentality"],
    { chance: number; xg: number; defense: number; risk: number }
  > = {
    VERY_DEFENSIVE: { chance: -0.09, xg: -0.05, defense: 0.08, risk: -0.06 },
    DEFENSIVE: { chance: -0.06, xg: -0.03, defense: 0.05, risk: -0.04 },
    CAUTIOUS: { chance: -0.03, xg: -0.01, defense: 0.03, risk: -0.02 },
    BALANCED: { chance: 0, xg: 0, defense: 0, risk: 0 },
    POSITIVE: { chance: 0.03, xg: 0.01, defense: -0.02, risk: 0.03 },
    ATTACKING: { chance: 0.06, xg: 0.03, defense: -0.04, risk: 0.06 },
    VERY_ATTACKING: { chance: 0.1, xg: 0.05, defense: -0.07, risk: 0.1 },
  };
  return table[mentality];
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
