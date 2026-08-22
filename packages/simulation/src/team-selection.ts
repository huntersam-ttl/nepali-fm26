import type {
  EntityId,
  PlayerAttributeSet,
  PlayerAvailability,
  PlayerMatchState,
  PlayerPosition,
} from "@nepal-football-sim/shared-types";

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
  role: "default",
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
