import {
  createEntityId,
  type EntityId,
  type FixtureRecord,
  type InjuryRecord,
  type MatchEvent,
  type MatchResult,
  type PlayerAttributeSet,
  type PlayerMatchState,
  type TeamMatchStats,
} from "@nepal-football-sim/shared-types";
import { SeededRandom } from "./rng.js";
import { calculateTeamStrength, type TeamStrength } from "./strength.js";
import { createInitialPlayerState, selectTeam, type SelectedPlayer } from "./team-selection.js";

export type SimulateMatchInput = {
  fixture: FixtureRecord;
  homePlayers: readonly PlayerAttributeSet[];
  awayPlayers: readonly PlayerAttributeSet[];
  seed: string;
  environment?: Partial<MatchEnvironment>;
};

export type MatchEnvironment = {
  matchTempo: number;
  pitchQuality: number;
  refereeStrictness: number;
  weatherImpact: number;
  altitudeImpact: number;
  heatImpact: number;
  competitionPhysicality: number;
  homeAdvantage: number;
};

export const DEFAULT_MATCH_ENVIRONMENT: MatchEnvironment = {
  matchTempo: 1,
  pitchQuality: 1,
  refereeStrictness: 1,
  weatherImpact: 0,
  altitudeImpact: 0,
  heatImpact: 0,
  competitionPhysicality: 1,
  homeAdvantage: 1,
};

type RuntimeTeam = {
  teamId: EntityId;
  selection: SelectedPlayer[];
  strength: TeamStrength;
  stats: TeamMatchStats;
  states: PlayerMatchState[];
};

export const simulateMatch = (input: SimulateMatchInput): MatchResult => {
  const rng = new SeededRandom(input.seed);
  const environment = { ...DEFAULT_MATCH_ENVIRONMENT, ...input.environment };
  const matchId = createEntityId();
  const homeSelection = selectTeam({
    teamId: input.fixture.homeTeamId,
    players: input.homePlayers,
  });
  const awaySelection = selectTeam({
    teamId: input.fixture.awayTeamId,
    players: input.awayPlayers,
  });
  const home: RuntimeTeam = createRuntimeTeam(
    input.fixture.homeTeamId,
    homeSelection,
    true,
    environment,
  );
  const away: RuntimeTeam = createRuntimeTeam(
    input.fixture.awayTeamId,
    awaySelection,
    false,
    environment,
  );
  const events: MatchEvent[] = [
    event(matchId, 0, "KICK_OFF", input.fixture.homeTeamId),
    event(matchId, 45, "HALF_TIME", input.fixture.homeTeamId),
    event(matchId, 46, "SECOND_HALF", input.fixture.awayTeamId),
  ];
  let homeGoals = 0;
  let awayGoals = 0;

  for (let minute = 1; minute <= 90; minute += 1) {
    const attacking = chooseAttackingTeam(rng, home, away);
    const defending = attacking === home ? away : home;
    tickFatigue(attacking.states, minute);
    tickFatigue(defending.states, minute);
    addPassingStats(rng, attacking);

    if (rng.next() < attackingSequenceChance(attacking, defending, environment)) {
      const shooter = chooseShooter(rng, attacking.selection);
      const assister = chooseAssister(rng, attacking.selection, shooter.personId);
      const xg = calculateShotXg(
        shooter,
        assister,
        attacking.strength,
        defending.strength,
        rng,
        environment,
      );
      attacking.stats.shots += 1;
      attacking.stats.xg += xg;
      playerState(attacking, shooter.personId).shots += 1;
      events.push(
        event(matchId, minute, "SHOT", attacking.teamId, shooter.personId, undefined, {
          xg,
          chanceType: xg > 0.22 ? "clear" : xg > 0.1 ? "good" : "low",
        }),
      );

      const onTargetChance = clamp(
        0.31 + xg + shooter.attributes.technical.finishing / 76,
        0.15,
        0.84,
      );
      if (rng.next() < onTargetChance) {
        attacking.stats.shotsOnTarget += 1;
        playerState(attacking, shooter.personId).shotsOnTarget += 1;
        events.push(
          event(matchId, minute, "SHOT_ON_TARGET", attacking.teamId, shooter.personId, undefined, {
            xg,
          }),
        );
        const goalChance = clamp(
          xg * (1.32 + shooter.attributes.mental.composure / 55) -
            defending.strength.goalkeeping / 460,
          0.03,
          0.68,
        );
        if (rng.next() < goalChance) {
          if (attacking === home) {
            homeGoals += 1;
          } else {
            awayGoals += 1;
          }
          const shooterState = playerState(attacking, shooter.personId);
          shooterState.goals += 1;
          shooterState.rating += 0.55;
          if (assister) {
            const assisterState = playerState(attacking, assister.personId);
            assisterState.assists += 1;
            assisterState.keyPasses += 1;
            assisterState.rating += 0.25;
          }
          events.push(
            event(matchId, minute, "GOAL", attacking.teamId, shooter.personId, assister?.personId, {
              xg,
            }),
          );
          if (assister) {
            events.push(
              event(
                matchId,
                minute,
                "ASSIST",
                attacking.teamId,
                assister.personId,
                shooter.personId,
              ),
            );
          }
        } else {
          const keeper = defending.selection.find((player) => player.position === "GK");
          if (keeper) {
            playerState(defending, keeper.personId).saves += 1;
          }
          defending.stats.xg += 0;
          events.push(
            event(matchId, minute, "SAVE", defending.teamId, keeper?.personId, shooter.personId, {
              xg,
            }),
          );
        }
      } else if (rng.next() < 0.22) {
        attacking.stats.corners += 1;
        events.push(event(matchId, minute, "CORNER", attacking.teamId));
      }
    }

    if (rng.next() < foulChance(home, away, environment)) {
      const fouling = rng.next() < 0.5 ? home : away;
      const fouler = rng.pick(fouling.selection);
      fouling.stats.fouls += 1;
      events.push(event(matchId, minute, "FOUL", fouling.teamId, fouler.personId));
      if (rng.next() < 0.105) {
        fouling.stats.yellowCards += 1;
        playerState(fouling, fouler.personId).yellowCards += 1;
        events.push(event(matchId, minute, "YELLOW_CARD", fouling.teamId, fouler.personId));
      }
      if (rng.next() < 0.006) {
        fouling.stats.redCards += 1;
        playerState(fouling, fouler.personId).redCard = true;
        events.push(event(matchId, minute, "RED_CARD", fouling.teamId, fouler.personId));
      }
    }

    if (rng.next() < injuryChance(home, away, environment)) {
      const injuredTeam = rng.next() < 0.5 ? home : away;
      const injured = rng.pick(injuredTeam.selection);
      const injury: InjuryRecord = {
        id: createEntityId(),
        personId: injured.personId,
        injuryType: "match knock",
        dateOccurred: input.fixture.scheduledDate,
        expectedRecoveryDate: recoveryDate(input.fixture.scheduledDate, rng.integer(7, 35)),
        severity: rng.next() < 0.72 ? "minor" : rng.next() < 0.9 ? "moderate" : "major",
      };
      playerState(injuredTeam, injured.personId).injuryDuringMatch = injury;
      events.push(
        event(matchId, minute, "INJURY", injuredTeam.teamId, injured.personId, undefined, injury),
      );
    }
  }

  finalizeStates(home.states, homeGoals, awayGoals);
  finalizeStates(away.states, awayGoals, homeGoals);
  const totalStrength = home.strength.midfield + away.strength.midfield;
  home.stats.possession = Math.round((home.strength.midfield / totalStrength) * 100);
  away.stats.possession = 100 - home.stats.possession;
  events.push(event(matchId, 90, "FULL_TIME", input.fixture.homeTeamId));

  return {
    match: {
      id: matchId,
      fixtureId: input.fixture.id,
      playedDate: input.fixture.scheduledDate,
      homeGoals,
      awayGoals,
    },
    events,
    homeStats: roundStats(home.stats),
    awayStats: roundStats(away.stats),
    playerStates: [...home.states, ...away.states],
    weather: "not-modeled",
    pitch: "not-modeled",
  };
};

const createRuntimeTeam = (
  teamId: EntityId,
  selection: SelectedPlayer[],
  homeAdvantage: boolean,
  environment: MatchEnvironment,
): RuntimeTeam => ({
  teamId,
  selection,
  strength: applyEnvironmentToStrength(
    calculateTeamStrength({ selection, homeAdvantage }),
    homeAdvantage,
    environment,
  ),
  stats: {
    teamId,
    possession: 50,
    shots: 0,
    shotsOnTarget: 0,
    xg: 0,
    corners: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
  },
  states: selection.map(createInitialPlayerState),
});

const chooseAttackingTeam = (
  rng: SeededRandom,
  home: RuntimeTeam,
  away: RuntimeTeam,
): RuntimeTeam => {
  const homeControl = home.strength.midfield + home.strength.attack * 0.35;
  const awayControl = away.strength.midfield + away.strength.attack * 0.35;
  return rng.next() < homeControl / (homeControl + awayControl) ? home : away;
};

const attackingSequenceChance = (
  attacking: RuntimeTeam,
  defending: RuntimeTeam,
  environment: MatchEnvironment,
): number => {
  const tempo = clamp(environment.matchTempo, 0.8, 1.18);
  const pitch = clamp(environment.pitchQuality, 0.85, 1.12);
  return clamp(
    (0.14 + (attacking.strength.attack - defending.strength.defense) / 980) * tempo * pitch,
    0.098,
    0.192,
  );
};

const calculateShotXg = (
  shooter: SelectedPlayer,
  assister: SelectedPlayer | undefined,
  attacking: TeamStrength,
  defending: TeamStrength,
  rng: SeededRandom,
  environment: MatchEnvironment,
): number => {
  const chanceBase = rng.next() < 0.18 ? 0.22 : rng.next() < 0.48 ? 0.115 : 0.055;
  const finisher = shooter.attributes.technical.finishing + shooter.attributes.mental.composure;
  const creation = assister
    ? assister.attributes.mental.vision + assister.attributes.technical.passing
    : 18;
  const pressure = defending.defense + defending.goalkeeping * 0.45;
  const environmentalDrag = environment.weatherImpact * 0.018 + environment.heatImpact * 0.012;
  return clamp(
    chanceBase +
      finisher / 420 +
      creation / 625 +
      attacking.attack / 850 -
      pressure / 1100 -
      environmentalDrag,
    0.015,
    0.58,
  );
};

const chooseShooter = (rng: SeededRandom, players: readonly SelectedPlayer[]): SelectedPlayer => {
  const attackers = players.filter((player) =>
    ["ST", "LW", "RW", "AM", "CM"].includes(player.position),
  );
  return rng.pick(attackers.length > 0 ? attackers : players);
};

const chooseAssister = (
  rng: SeededRandom,
  players: readonly SelectedPlayer[],
  shooterId: EntityId,
): SelectedPlayer | undefined => {
  if (rng.next() > 0.64) {
    return undefined;
  }
  const creators = players.filter(
    (player) => player.personId !== shooterId && player.position !== "GK",
  );
  return rng.pick(creators);
};

const playerState = (team: RuntimeTeam, personId: EntityId): PlayerMatchState => {
  const state = team.states.find((candidate) => candidate.personId === personId);
  if (!state) {
    throw new Error(`Missing player state for ${personId}`);
  }
  return state;
};

const addPassingStats = (rng: SeededRandom, team: RuntimeTeam): void => {
  for (const player of team.states) {
    const attempted = rng.integer(0, 2);
    player.passesAttempted += attempted;
    player.passesCompleted += Math.round(
      attempted * clamp(0.62 + team.strength.midfield / 70, 0.55, 0.9),
    );
    if (rng.next() < 0.035) {
      player.tackles += 1;
    }
    if (rng.next() < 0.025) {
      player.interceptions += 1;
    }
  }
};

const tickFatigue = (states: PlayerMatchState[], minute: number): void => {
  if (minute % 5 !== 0) {
    return;
  }
  for (const state of states) {
    state.minutesPlayed += 5;
    state.fatigue += 2.2;
    state.currentFitness = Math.max(10, state.currentFitness - 1.7);
  }
};

const finalizeStates = (
  states: PlayerMatchState[],
  goalsFor: number,
  goalsAgainst: number,
): void => {
  for (const state of states) {
    state.minutesPlayed = 90;
    state.rating = clamp(
      state.rating +
        state.goals * 0.7 +
        state.assists * 0.35 +
        state.saves * 0.08 +
        (goalsFor - goalsAgainst) * 0.08 -
        Number(state.redCard) * 1.1 -
        state.yellowCards * 0.12,
      3,
      10,
    );
  }
};

const foulChance = (home: RuntimeTeam, away: RuntimeTeam, environment: MatchEnvironment): number =>
  clamp(
    (0.18 + (home.strength.defense + away.strength.defense) / 980) *
      clamp(environment.refereeStrictness, 0.75, 1.3) *
      clamp(environment.competitionPhysicality, 0.8, 1.25),
    0.14,
    0.27,
  );

const injuryChance = (
  home: RuntimeTeam,
  away: RuntimeTeam,
  environment: MatchEnvironment,
): number =>
  clamp(
    (0.00105 +
      (100 - averageFitness(home.states) + 100 - averageFitness(away.states)) / 160000 +
      environment.heatImpact * 0.0002) *
      clamp(environment.competitionPhysicality, 0.75, 1.35),
    0.0006,
    0.0032,
  );

const averageFitness = (states: readonly PlayerMatchState[]): number =>
  states.reduce((total, state) => total + state.currentFitness, 0) / states.length;

const recoveryDate = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const event = (
  matchId: EntityId,
  minute: number,
  type: string,
  teamId: EntityId,
  primaryPersonId?: EntityId,
  secondaryPersonId?: EntityId,
  data?: Record<string, unknown>,
): MatchEvent => ({
  id: createEntityId(),
  matchId,
  minute,
  type,
  teamId,
  primaryPersonId,
  secondaryPersonId,
  personId: primaryPersonId,
  data,
});

const roundStats = (stats: TeamMatchStats): TeamMatchStats => ({
  ...stats,
  xg: Math.round(stats.xg * 100) / 100,
});

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const applyEnvironmentToStrength = (
  strength: TeamStrength,
  isHome: boolean,
  environment: MatchEnvironment,
): TeamStrength => {
  const home = isHome ? clamp(environment.homeAdvantage, 0, 1.6) : 0;
  const travelDrag = isHome
    ? 0
    : clamp(environment.altitudeImpact + environment.heatImpact, 0, 1.5) * 0.12;
  return {
    ...strength,
    attack: strength.attack + home * 0.24 - travelDrag,
    midfield: strength.midfield + home * 0.38 - travelDrag,
    defense: strength.defense + home * 0.14,
    goalkeeping: strength.goalkeeping + home * 0.06,
    setPieces: strength.setPieces + home * 0.08,
    overall: strength.overall + home * 0.22 - travelDrag,
  };
};
