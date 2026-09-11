import type {
  EntityId,
  PlayerAttributeSet,
  PlayerAvailability,
  PlayerInstruction,
  PlayerMatchState,
  PlayerPosition,
  PlayerTacticalBehavior,
  TacticalSetup,
} from "@nepal-football-sim/shared-types";
import {
  NEUTRAL_PLAYER_BEHAVIOR,
  calculateRoleFit,
  defaultDutyForRole,
  derivePlayerTacticalBehavior,
  dutyIsLegalForRole,
  roleById,
  tacticalPositionToPlayerPosition,
} from "./tactics.js";

export const DEFAULT_SHAPE: readonly PlayerPosition[] = [
  "GK",
  "RB",
  "CB",
  "CB",
  "LB",
  "CM",
  "CM",
  "AM",
  "RW",
  "LW",
  "ST",
];

export type SelectedPlayer = {
  personId: EntityId;
  teamId: EntityId;
  position: PlayerPosition;
  attributes: PlayerAttributeSet;
  availability: PlayerAvailability;
  role?: string;
  duty?: string;
  instructions?: readonly PlayerInstruction[];
  roleFit?: number;
  tacticalSlotId?: string;
  /** Derived once per selection / tactical change / substitution and read by
   * the match engine to weight who creates, scores, presses and defends. */
  behavior?: PlayerTacticalBehavior;
};

export const selectTeam = (input: {
  teamId: EntityId;
  players: readonly PlayerAttributeSet[];
  availability?: ReadonlyMap<EntityId, PlayerAvailability>;
}): SelectedPlayer[] => {
  const available = input.players.filter((player) => {
    const state = input.availability?.get(player.personId);
    return !state?.injury && !state?.suspension && (state?.fitness ?? 100) >= 35;
  });
  const selected = new Set<EntityId>();
  return DEFAULT_SHAPE.map((position, index) => {
    const chosen =
      available
        .filter((player) => !selected.has(player.personId))
        .sort((a, b) => suitability(b, position) - suitability(a, position))[0] ??
      createReplacementPlayer(input.teamId, position, index);
    selected.add(chosen.personId);
    return {
      personId: chosen.personId,
      teamId: input.teamId,
      position,
      attributes: chosen,
      availability: input.availability?.get(chosen.personId) ?? {
        personId: chosen.personId,
        fitness: 82,
        moraleModifier: 0,
        formModifier: 0,
      },
      // No tactical setup here — a neutral behaviour profile so the engine's
      // per-player weighting still has a value to read.
      behavior: NEUTRAL_PLAYER_BEHAVIOR,
    };
  });
};

export const selectTeamFromTacticalSetup = (input: {
  teamId: EntityId;
  players: readonly PlayerAttributeSet[];
  setup: TacticalSetup;
  availability?: ReadonlyMap<EntityId, PlayerAvailability>;
}): SelectedPlayer[] => {
  const byPerson = new Map(input.players.map((player) => [player.personId, player]));
  return input.setup.formation.slots.map((slot, index) => {
    const assignment = input.setup.assignments.find((candidate) => candidate.slotId === slot.id);
    const assigned = assignment?.playerId ? byPerson.get(assignment.playerId) : undefined;
    const chosen =
      assigned ??
      input.players
        .filter((player) => {
          const state = input.availability?.get(player.personId);
          return !state?.injury && !state?.suspension && (state?.fitness ?? 100) >= 35;
        })
        .filter(
          (player) =>
            !input.setup.assignments.some(
              (candidate) => candidate.playerId === player.personId && candidate.slotId !== slot.id,
            ),
        )
        .sort(
          (a, b) =>
            suitability(b, tacticalPositionToPlayerPosition(slot.position)) -
            suitability(a, tacticalPositionToPlayerPosition(slot.position)),
        )[0] ??
      createReplacementPlayer(input.teamId, tacticalPositionToPlayerPosition(slot.position), index);
    const role = roleById(assignment?.roleId ?? "CENTRAL_MIDFIELDER");
    const duty =
      assignment?.duty && dutyIsLegalForRole(role.id, assignment.duty)
        ? assignment.duty
        : defaultDutyForRole(role.id);
    const roleFit = calculateRoleFit({
      player: chosen,
      slot,
      role,
      familiarity: input.setup.familiarity.roles,
    });
    return {
      personId: chosen.personId,
      teamId: input.teamId,
      position: tacticalPositionToPlayerPosition(slot.position),
      attributes: applyRoleFitToAttributes(chosen, roleFit.overall),
      availability: input.availability?.get(chosen.personId) ?? {
        personId: chosen.personId,
        fitness: 82,
        moraleModifier: 0,
        formModifier: 0,
      },
      role: role.id,
      duty,
      instructions: assignment?.instructions,
      roleFit: roleFit.overall,
      tacticalSlotId: slot.id,
      behavior: derivePlayerTacticalBehavior({
        attributes: chosen,
        roleId: role.id,
        duty,
        roleFit: roleFit.overall,
        familiarity: input.setup.familiarity,
        mentality: input.setup.instructions.mentality,
        teamInstructions: input.setup.instructions,
        playerInstructions: assignment?.instructions,
      }),
    };
  });
};

export const createInitialPlayerState = (player: SelectedPlayer): PlayerMatchState => ({
  personId: player.personId,
  teamId: player.teamId,
  startingFitness: player.availability.fitness,
  currentFitness: player.availability.fitness,
  fatigue: 0,
  moraleModifier: player.availability.moraleModifier,
  formModifier: player.availability.formModifier,
  yellowCards: 0,
  redCard: false,
  minutesPlayed: 0,
  position: player.position,
  role: player.role ?? "default",
  rating: 6,
  goals: 0,
  assists: 0,
  shots: 0,
  shotsOnTarget: 0,
  passesAttempted: 0,
  passesCompleted: 0,
  tackles: 0,
  interceptions: 0,
  keyPasses: 0,
  saves: 0,
});

const applyRoleFitToAttributes = (
  attributes: PlayerAttributeSet,
  roleFit: number,
): PlayerAttributeSet => {
  const factor = 0.92 + Math.max(35, Math.min(100, roleFit)) / 1250;
  const scaleGroup = <T extends Record<string, number>>(group: T): T =>
    Object.fromEntries(
      Object.entries(group).map(([key, value]) => [key, Math.max(1, Math.min(20, value * factor))]),
    ) as T;
  return {
    ...attributes,
    technical: scaleGroup(attributes.technical),
    mental: scaleGroup(attributes.mental),
    physical: scaleGroup(attributes.physical),
    goalkeeping: scaleGroup(attributes.goalkeeping),
  };
};

export const suitability = (player: PlayerAttributeSet, position: PlayerPosition): number => {
  const positionFit =
    player.primaryPosition === position
      ? 1
      : player.secondaryPositions.includes(position)
        ? 0.88
        : 0.7;
  const technical =
    position === "GK"
      ? average(Object.values(player.goalkeeping))
      : average([
          player.technical.firstTouch,
          player.technical.passing,
          player.technical.technique,
          player.mental.decisions,
          player.physical.stamina,
        ]);
  return technical * positionFit;
};

const average = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0) / values.length;

const createReplacementPlayer = (
  teamId: EntityId,
  position: PlayerPosition,
  index: number,
): PlayerAttributeSet => ({
  id: `${teamId}:replacement:${index}:attributes` as EntityId,
  personId: `${teamId}:replacement:${index}` as EntityId,
  primaryPosition: position,
  secondaryPositions: [],
  technical: {
    firstTouch: 8,
    passing: 8,
    crossing: 8,
    dribbling: 8,
    finishing: 8,
    heading: 8,
    tackling: 8,
    technique: 8,
    longShots: 8,
    setPieces: 8,
  },
  mental: {
    decisions: 8,
    vision: 8,
    composure: 8,
    positioning: 8,
    anticipation: 8,
    workRate: 8,
    teamwork: 8,
    leadership: 8,
    aggression: 8,
    determination: 8,
    professionalism: 8,
  },
  physical: {
    pace: 8,
    acceleration: 8,
    strength: 8,
    stamina: 8,
    agility: 8,
    balance: 8,
    jumping: 8,
    naturalFitness: 8,
  },
  goalkeeping: {
    handling: position === "GK" ? 8 : 3,
    reflexes: position === "GK" ? 8 : 3,
    oneOnOnes: position === "GK" ? 8 : 3,
    aerialReach: position === "GK" ? 8 : 3,
    kicking: position === "GK" ? 8 : 3,
    distribution: position === "GK" ? 8 : 3,
    commandOfArea: position === "GK" ? 8 : 3,
  },
});
