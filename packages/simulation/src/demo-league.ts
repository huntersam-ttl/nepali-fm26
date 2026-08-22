import {
  createStableEntityId,
  type CompetitionRuleSet,
  type CompetitionSeason,
  type EntityId,
  type PlayerAttributeSet,
  type PlayerPosition,
} from "@nepal-football-sim/shared-types";
import type { SeasonSimulationInput } from "./season-engine.js";

export const createDemoLeagueInput = (seed: string, seasonOffset = 0): SeasonSimulationInput => {
  const competitionId = createStableEntityId("competition", "testing-only-stage-three-league");
  const startYear = 2026 + seasonOffset;
  const season: CompetitionSeason = {
    id: createStableEntityId("competition-season", `testing-only-stage-three:${startYear}`),
    competitionId,
    name: `Testing-only Nepal Stage 3 League ${startYear}`,
    startDate: `${startYear}-08-01`,
    endDate: `${startYear + 1}-05-31`,
  };
  const ruleSet: CompetitionRuleSet = {
    id: createStableEntityId("competition-rule", `${season.id}:rules`),
    competitionSeasonId: season.id,
    competitionType: "DOUBLE_ROUND_ROBIN",
    pointsForWin: 3,
    pointsForDraw: 1,
    pointsForLoss: 0,
    tiebreakers: ["points", "goalDifference", "goalsScored", "wins"],
    numberOfRounds: 2,
    homeAwayStructure: "double",
    seasonStartDate: season.startDate,
    seasonEndDate: season.endDate,
    roundSpacingDays: 7,
    promotionSlots: 0,
    relegationSlots: 1,
    continentalQualificationSlots: 1,
  };
  const teamIds = ["red", "blue", "green", "gold"].map((key) =>
    createStableEntityId("team", `testing-only-${key}`),
  );
  const playersByTeam = new Map<EntityId, PlayerAttributeSet[]>(
    teamIds.map((teamId, teamIndex) => [teamId, createSquad(teamId, 9 + teamIndex * 2)]),
  );
  return { competitionSeason: season, ruleSet, teamIds, playersByTeam, seed };
};

const positions: readonly PlayerPosition[] = [
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

export const createSquad = (teamId: EntityId, baseAbility: number): PlayerAttributeSet[] =>
  positions.map((position, index) =>
    createPlayer(teamId, position, index, baseAbility + (index % 3) - 1),
  );

export const createPlayer = (
  teamId: EntityId,
  position: PlayerPosition,
  index: number,
  ability: number,
): PlayerAttributeSet => {
  const rating = (delta = 0) => Math.max(1, Math.min(20, Math.round(ability + delta)));
  return {
    id: createStableEntityId("player-attribute", `${teamId}:${index}`),
    personId: createStableEntityId("person", `${teamId}:${index}`),
    primaryPosition: position,
    secondaryPositions: position === "CB" ? ["LB", "RB"] : [],
    technical: {
      firstTouch: rating(),
      passing: rating(),
      crossing: rating(position === "RW" || position === "LW" ? 2 : 0),
      dribbling: rating(position === "RW" || position === "LW" ? 2 : 0),
      finishing: rating(position === "ST" ? 3 : -1),
      heading: rating(position === "CB" || position === "ST" ? 2 : 0),
      tackling: rating(["CB", "RB", "LB", "CM"].includes(position) ? 2 : -1),
      technique: rating(),
      longShots: rating(),
      setPieces: rating(),
    },
    mental: {
      decisions: rating(),
      vision: rating(position === "AM" || position === "CM" ? 2 : 0),
      composure: rating(),
      positioning: rating(),
      anticipation: rating(),
      workRate: rating(),
      teamwork: rating(),
      leadership: rating(index === 5 ? 2 : 0),
      aggression: rating(),
      determination: rating(),
      professionalism: rating(),
    },
    physical: {
      pace: rating(position === "RW" || position === "LW" ? 2 : 0),
      acceleration: rating(),
      strength: rating(position === "CB" || position === "ST" ? 2 : 0),
      stamina: rating(),
      agility: rating(),
      balance: rating(),
      jumping: rating(position === "CB" || position === "ST" ? 2 : 0),
      naturalFitness: rating(),
    },
    goalkeeping: {
      handling: rating(position === "GK" ? 4 : -6),
      reflexes: rating(position === "GK" ? 4 : -6),
      oneOnOnes: rating(position === "GK" ? 4 : -6),
      aerialReach: rating(position === "GK" ? 4 : -6),
      kicking: rating(position === "GK" ? 2 : -6),
      distribution: rating(position === "GK" ? 2 : -6),
      commandOfArea: rating(position === "GK" ? 4 : -6),
    },
  };
};
