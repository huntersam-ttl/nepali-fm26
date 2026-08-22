import type { SelectedPlayer } from "./team-selection.js";

export type TeamStrength = {
  attack: number;
  midfield: number;
  defense: number;
  goalkeeping: number;
  setPieces: number;
  cohesion: number;
  overall: number;
};

export const calculateTeamStrength = (input: {
  selection: readonly SelectedPlayer[];
  homeAdvantage?: boolean;
  managerQuality?: number;
}): TeamStrength => {
  const byPosition = (positions: readonly string[]) =>
    input.selection.filter((player) => positions.includes(player.position));
  const attack = average(
    byPosition(["RW", "LW", "ST", "AM"]).map(
      (player) =>
        weighted([
          player.attributes.technical.finishing,
          player.attributes.technical.dribbling,
          player.attributes.mental.composure,
          player.attributes.physical.pace,
        ]) * fitnessFactor(player.availability.fitness),
    ),
  );
  const midfield = average(
    byPosition(["DM", "CM", "AM"]).map((player) =>
      weighted([
        player.attributes.technical.passing,
        player.attributes.mental.vision,
        player.attributes.mental.decisions,
        player.attributes.physical.stamina,
      ]),
    ),
  );
  const defense = average(
    byPosition(["RB", "CB", "LB", "DM"]).map((player) =>
      weighted([
        player.attributes.technical.tackling,
        player.attributes.mental.positioning,
        player.attributes.mental.anticipation,
        player.attributes.physical.strength,
      ]),
    ),
  );
  const goalkeeper = input.selection.find((player) => player.position === "GK");
  const goalkeeping = goalkeeper
    ? weighted([
        goalkeeper.attributes.goalkeeping.handling,
        goalkeeper.attributes.goalkeeping.reflexes,
        goalkeeper.attributes.goalkeeping.oneOnOnes,
        goalkeeper.attributes.goalkeeping.commandOfArea,
      ])
    : 6;
  const setPieces = average(
    input.selection.map(
      (player) => player.attributes.technical.setPieces + player.attributes.physical.jumping / 2,
    ),
  );
  const cohesion = 10 + (input.managerQuality ?? 10) * 0.1;
  const home = input.homeAdvantage ? 0.7 : 0;
  const overall =
    attack * 0.27 +
    midfield * 0.24 +
    defense * 0.22 +
    goalkeeping * 0.17 +
    setPieces * 0.05 +
    cohesion * 0.05 +
    home;

  return { attack, midfield, defense, goalkeeping, setPieces, cohesion, overall };
};

const weighted = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0) / values.length;

const average = (values: readonly number[]): number =>
  values.length === 0 ? 8 : values.reduce((total, value) => total + value, 0) / values.length;

const fitnessFactor = (fitness: number): number =>
  0.75 + Math.max(35, Math.min(100, fitness)) / 400;
