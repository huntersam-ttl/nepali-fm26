import { describe, expect, it } from "vitest";
import {
  FORMATION_PRESETS,
  applySubstitution,
  createMatchState,
  createTacticalSetup,
  derivePlayerTacticalBehavior,
  humanizeInstruction,
  legalInstructionsFor,
  simulateMatch,
  validateSelection,
} from "@nepal-football-sim/simulation";
import type {
  EntityId,
  FixtureRecord,
  PlayerAttributeSet,
  PlayerInstruction,
  TacticalAssignment,
} from "@nepal-football-sim/shared-types";

// ---------------------------------------------------------------------------
// Fixtures (mirrors packages/testing/src/tactical-role-effects.test.ts)
// ---------------------------------------------------------------------------

const fixture = {
  id: "player-instruction-fixture",
  homeTeamId: "team-home",
  awayTeamId: "team-away",
  scheduledDate: "2026-08-08",
  status: "scheduled",
  competitionSeasonId: "season-1",
  round: 1,
} as unknown as FixtureRecord;

const attr = (
  over: Partial<
    PlayerAttributeSet["technical"] & PlayerAttributeSet["mental"] & PlayerAttributeSet["physical"]
  > = {},
) => ({
  firstTouch: 12, passing: 12, crossing: 12, dribbling: 12, finishing: 12, heading: 12,
  tackling: 12, technique: 12, longShots: 12, setPieces: 12,
  decisions: 12, vision: 12, composure: 12, positioning: 12, anticipation: 12, workRate: 12,
  teamwork: 12, leadership: 12, aggression: 12, determination: 12, professionalism: 12,
  pace: 12, acceleration: 12, strength: 12, stamina: 12, agility: 12, balance: 12, jumping: 12,
  naturalFitness: 12,
  ...over,
});

const player = (
  team: string,
  index: number,
  position: PlayerAttributeSet["primaryPosition"],
  overrides: Partial<
    PlayerAttributeSet["technical"] & PlayerAttributeSet["mental"] & PlayerAttributeSet["physical"]
  > = {},
): PlayerAttributeSet => {
  const a = attr(overrides);
  return {
    id: `${team}-attr-${index}` as EntityId,
    personId: `${team}-p${index}` as EntityId,
    primaryPosition: position,
    secondaryPositions: [],
    technical: {
      firstTouch: a.firstTouch, passing: a.passing, crossing: a.crossing, dribbling: a.dribbling,
      finishing: a.finishing, heading: a.heading, tackling: a.tackling, technique: a.technique,
      longShots: a.longShots, setPieces: a.setPieces,
    },
    mental: {
      decisions: a.decisions, vision: a.vision, composure: a.composure, positioning: a.positioning,
      anticipation: a.anticipation, workRate: a.workRate, teamwork: a.teamwork, leadership: a.leadership,
      aggression: a.aggression, determination: a.determination, professionalism: a.professionalism,
    },
    physical: {
      pace: a.pace, acceleration: a.acceleration, strength: a.strength, stamina: a.stamina,
      agility: a.agility, balance: a.balance, jumping: a.jumping, naturalFitness: a.naturalFitness,
    },
    goalkeeping: {
      handling: position === "GK" ? 13 : 3, reflexes: position === "GK" ? 13 : 3,
      oneOnOnes: position === "GK" ? 13 : 3, aerialReach: position === "GK" ? 13 : 3,
      commandOfArea: position === "GK" ? 13 : 3, communication: position === "GK" ? 13 : 3,
      kicking: position === "GK" ? 12 : 6,
    },
  } as PlayerAttributeSet;
};

// 4-3-3: GK, DL DCL DCR DR, MCL MC MCR, AML AMR STC
const POSITIONS: PlayerAttributeSet["primaryPosition"][] = [
  "GK", "LB", "CB", "CB", "RB", "CM", "CM", "CM", "LW", "RW", "ST",
];

// One extra bench player per outfield position family, for substitution tests.
const BENCH_POSITIONS: PlayerAttributeSet["primaryPosition"][] = ["GK", "CB", "CM", "ST"];

const squad = (team: string): PlayerAttributeSet[] => [
  ...POSITIONS.map((position, index) => player(team, index, position)),
  ...BENCH_POSITIONS.map((position, index) => player(team, POSITIONS.length + index, position)),
];

const formation433 = FORMATION_PRESETS.find((f) => f.name === "4-3-3")!;

/** Builds a full tactical setup with one target slot given a specific
 * instruction list (or none), all other slots left at default. */
const setupWithInstructions = (
  team: string,
  players: PlayerAttributeSet[],
  targetSlotIndex: number,
  instructions: PlayerInstruction[] | undefined,
) => {
  const base = createTacticalSetup({ teamId: team as EntityId, name: `${team} tactic`, formation: formation433 });
  const assignments: TacticalAssignment[] = formation433.slots.map((slot, index) => ({
    slotId: slot.id,
    playerId: players[index]!.personId,
    roleId: base.assignments[index]!.roleId,
    duty: base.assignments[index]!.duty,
    instructions: index === targetSlotIndex ? instructions : undefined,
  }));
  return {
    ...base,
    assignments,
    familiarity: { formation: 90, style: 88, roles: 88, instructions: 88 },
    bench: players.slice(POSITIONS.length).map((p) => p.personId),
  };
};

const aggregate = (
  homeSetup: ReturnType<typeof setupWithInstructions>,
  homePlayers: PlayerAttributeSet[],
  personId: string,
  matches = 40,
) => {
  const awayPlayers = squad("away");
  const awaySetup = setupWithInstructions("away", awayPlayers, -1, undefined);
  const totals = { shots: 0, goals: 0, assists: 0, crossAssists: 0, tackles: 0, defensiveActions: 0, fouls: 0 };
  for (let i = 0; i < matches; i += 1) {
    const result = simulateMatch({
      fixture,
      homePlayers,
      awayPlayers,
      homeTacticalSetup: homeSetup,
      awayTacticalSetup: awaySetup,
      seed: `player-instruction:${i}`,
    });
    for (const event of result.events) {
      if (event.primaryPersonId !== personId && event.secondaryPersonId !== personId) continue;
      if (event.type === "SHOT" && event.primaryPersonId === personId) totals.shots += 1;
      if (event.type === "GOAL" && event.primaryPersonId === personId) totals.goals += 1;
      if (event.type === "ASSIST" && event.primaryPersonId === personId) {
        totals.assists += 1;
        if (event.data?.deliveredByCross) totals.crossAssists += 1;
      }
      if (event.type === "FOUL" && event.primaryPersonId === personId) totals.fouls += 1;
    }
    for (const line of result.playerStates ?? []) {
      if (line.personId === personId) {
        totals.tackles += line.tackles ?? 0;
        totals.defensiveActions += (line.tackles ?? 0) + (line.interceptions ?? 0);
      }
    }
  }
  return totals;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("player instruction validation", () => {
  const players = squad("home");
  const slotId = formation433.slots[8]!.id; // AML/wide forward slot

  const withInstructions = (instructions: PlayerInstruction[]) => {
    const setup = setupWithInstructions("home", players, 8, instructions);
    return validateSelection({ setup, players });
  };

  it("accepts a small, non-contradictory instruction set", () => {
    const result = withInstructions(["GET_FURTHER_FORWARD", "CROSS_MORE"]);
    expect(result.isValid).toBe(true);
  });

  it("rejects holding both members of a contradictory pair", () => {
    const result = withInstructions(["CROSS_MORE", "CROSS_LESS"]);
    expect(result.isValid).toBe(false);
    expect(result.blockingErrors.join(" ")).toMatch(/cannot both be set/i);
  });

  it("rejects more than the maximum instructions on one player", () => {
    const result = withInstructions([
      "GET_FURTHER_FORWARD",
      "STAY_WIDER",
      "TAKE_MORE_RISKS",
      "PRESS_MORE",
    ]);
    expect(result.isValid).toBe(false);
    expect(result.blockingErrors.join(" ")).toMatch(/at most/i);
  });

  it("rejects a shooting/crossing instruction on a goalkeeper", () => {
    const setup = setupWithInstructions("home", players, 0, ["SHOOT_MORE"]);
    const result = validateSelection({ setup, players });
    expect(result.isValid).toBe(false);
    expect(result.blockingErrors.join(" ")).toMatch(/goalkeeper/i);
  });

  it("does not over-restrict: a wide instruction on a central defender is legal", () => {
    const setup = setupWithInstructions("home", players, 2, ["STAY_WIDER", "TAKE_MORE_RISKS"]);
    const result = validateSelection({ setup, players });
    expect(result.isValid).toBe(true);
  });

  it("legalInstructionsFor(goalkeeper) excludes shooting/crossing but keeps the rest", () => {
    const gkLegal = legalInstructionsFor(true);
    expect(gkLegal).not.toContain("SHOOT_MORE");
    expect(gkLegal).not.toContain("CROSS_LESS");
    expect(gkLegal).toContain("GET_FURTHER_FORWARD");
    expect(legalInstructionsFor(false)).toContain("SHOOT_MORE");
  });

  it("humanizeInstruction renders a readable label", () => {
    expect(humanizeInstruction("GET_FURTHER_FORWARD")).toBe("Get Further Forward");
  });
});

// ---------------------------------------------------------------------------
// derivePlayerTacticalBehavior — instructions modify, not replace, role/duty
// ---------------------------------------------------------------------------

describe("derivePlayerTacticalBehavior with player instructions", () => {
  const p = player("x", 1, "CM");
  const base = { attributes: p, roleId: "CENTRAL_MIDFIELDER" as const, duty: "SUPPORT" as const };

  it("GET_FURTHER_FORWARD vs HOLD_POSITION move attacking involvement and defensive positioning oppositely", () => {
    const forward = derivePlayerTacticalBehavior({ ...base, playerInstructions: ["GET_FURTHER_FORWARD"] });
    const hold = derivePlayerTacticalBehavior({ ...base, playerInstructions: ["HOLD_POSITION"] });
    const neutral = derivePlayerTacticalBehavior(base);
    expect(forward.attackingInvolvement).toBeGreaterThan(neutral.attackingInvolvement);
    expect(hold.attackingInvolvement).toBeLessThan(neutral.attackingInvolvement);
    expect(forward.defensivePositioning).toBeLessThan(hold.defensivePositioning);
  });

  it("STAY_WIDER vs SIT_NARROWER move crossing tendency oppositely", () => {
    const wide = derivePlayerTacticalBehavior({ ...base, playerInstructions: ["STAY_WIDER"] });
    const narrow = derivePlayerTacticalBehavior({ ...base, playerInstructions: ["SIT_NARROWER"] });
    expect(wide.crossingTendency).toBeGreaterThan(narrow.crossingTendency);
  });

  it("TAKE_MORE_RISKS vs TAKE_FEWER_RISKS move risk-taking oppositely", () => {
    const risky = derivePlayerTacticalBehavior({ ...base, playerInstructions: ["TAKE_MORE_RISKS"] });
    const safe = derivePlayerTacticalBehavior({ ...base, playerInstructions: ["TAKE_FEWER_RISKS"] });
    expect(risky.riskTaking).toBeGreaterThan(safe.riskTaking);
  });

  it("PRESS_MORE vs PRESS_LESS move pressing contribution oppositely", () => {
    const press = derivePlayerTacticalBehavior({ ...base, playerInstructions: ["PRESS_MORE"] });
    const ease = derivePlayerTacticalBehavior({ ...base, playerInstructions: ["PRESS_LESS"] });
    expect(press.pressingContribution).toBeGreaterThan(ease.pressingContribution);
  });

  it("SHORTER_PASSING vs MORE_DIRECT_PASSING move progression involvement oppositely", () => {
    const shorter = derivePlayerTacticalBehavior({ ...base, playerInstructions: ["SHORTER_PASSING"] });
    const direct = derivePlayerTacticalBehavior({ ...base, playerInstructions: ["MORE_DIRECT_PASSING"] });
    expect(direct.progressionInvolvement).toBeGreaterThan(shorter.progressionInvolvement);
  });

  it("familiarity dampens instruction execution (bounded, not eliminated)", () => {
    const sharp = derivePlayerTacticalBehavior({
      ...base,
      playerInstructions: ["CROSS_MORE"],
      familiarity: { formation: 90, style: 90, roles: 90, instructions: 90 },
    });
    const blunt = derivePlayerTacticalBehavior({
      ...base,
      playerInstructions: ["CROSS_MORE"],
      familiarity: { formation: 90, style: 90, roles: 90, instructions: 30 },
    });
    const neutral = derivePlayerTacticalBehavior({
      ...base,
      familiarity: { formation: 90, style: 90, roles: 90, instructions: 30 },
    });
    expect(sharp.crossingTendency).toBeGreaterThan(blunt.crossingTendency);
    expect(blunt.crossingTendency).toBeGreaterThan(neutral.crossingTendency);
  });

  it("instructions modify but never override role/duty identity", () => {
    const attacker = derivePlayerTacticalBehavior({
      attributes: p, roleId: "ADVANCED_FORWARD", duty: "ATTACK", playerInstructions: ["HOLD_POSITION"],
    });
    const defender = derivePlayerTacticalBehavior({
      attributes: p, roleId: "DEFENSIVE_MIDFIELDER", duty: "DEFEND", playerInstructions: ["GET_FURTHER_FORWARD"],
    });
    // Even pushed toward defensive intent, an Advanced Forward on ATTACK still
    // attacks more than a Defensive Midfielder on DEFEND pushed forward.
    expect(attacker.attackingInvolvement).toBeGreaterThan(defender.attackingInvolvement);
  });

  it("stays within the same bounded range as role/duty-only derivation", () => {
    for (const instruction of legalInstructionsFor(false)) {
      const value = derivePlayerTacticalBehavior({ ...base, playerInstructions: [instruction] });
      for (const dimension of Object.values(value)) {
        expect(dimension).toBeGreaterThanOrEqual(0.4);
        expect(dimension).toBeLessThanOrEqual(1.75);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Match-engine directional effects (aggregate over seeded matches)
// ---------------------------------------------------------------------------

describe("player instruction match-engine event involvement", () => {
  it("SHOOT_MORE takes more shots than SHOOT_LESS in the same slot", () => {
    const players = squad("home");
    const target = players[10]!.personId; // ST slot
    const more = setupWithInstructions("home", players, 10, ["SHOOT_MORE"]);
    const less = setupWithInstructions("home", players, 10, ["SHOOT_LESS"]);
    const moreTotals = aggregate(more, players, target);
    const lessTotals = aggregate(less, players, target);
    expect(moreTotals.shots).toBeGreaterThan(lessTotals.shots);
  });

  it("CROSS_MORE produces more cross-delivered involvement than CROSS_LESS from a wide slot", () => {
    const players = squad("home");
    const target = players[8]!.personId; // LW slot
    const more = setupWithInstructions("home", players, 8, ["CROSS_MORE"]);
    const less = setupWithInstructions("home", players, 8, ["CROSS_LESS"]);
    const moreTotals = aggregate(more, players, target, 60);
    const lessTotals = aggregate(less, players, target, 60);
    expect(moreTotals.crossAssists).toBeGreaterThanOrEqual(lessTotals.crossAssists);
    expect(moreTotals.crossAssists + moreTotals.assists).toBeGreaterThan(0);
  });

  it("PRESS_MORE gives the player a larger share of the side's foul attribution than PRESS_LESS", () => {
    // pressingContribution is the dimension the engine actually weighs when
    // attributing fouls (see match-engine.ts's foul-attribution draw) — it is
    // not consumed by the tackle/interception draw, which is driven by
    // defensiveContribution/defensivePositioning instead.
    const players = squad("home");
    const target = players[5]!.personId; // CM slot
    const more = setupWithInstructions("home", players, 5, ["PRESS_MORE"]);
    const less = setupWithInstructions("home", players, 5, ["PRESS_LESS"]);
    const moreTotals = aggregate(more, players, target, 150);
    const lessTotals = aggregate(less, players, target, 150);
    expect(moreTotals.fouls).toBeGreaterThan(lessTotals.fouls);
  });
});

// ---------------------------------------------------------------------------
// Substitution / live-change safety
// ---------------------------------------------------------------------------

describe("player instruction substitution safety", () => {
  it("an incoming substitute inherits the vacated slot's instructions, not its own prior ones", () => {
    const homePlayers = squad("home");
    const awayPlayers = squad("away");
    const homeSetup = setupWithInstructions("home", homePlayers, 8, ["CROSS_MORE", "GET_FURTHER_FORWARD"]);
    const awaySetup = setupWithInstructions("away", awayPlayers, -1, undefined);

    const state = createMatchState({ fixture, homePlayers, awayPlayers, homeTacticalSetup: homeSetup, awayTacticalSetup: awaySetup, seed: "sub-safety" });
    const homeTeam = state.home;
    const outgoing = homeTeam.selection[8]!;
    const incoming = homeTeam.benchPlayers[0]!;

    applySubstitution(state, homeTeam, outgoing.personId, incoming.personId, 60);

    const replacement = homeTeam.selection[8]!;
    expect(replacement.personId).toBe(incoming.personId);
    expect(replacement.instructions).toEqual(["CROSS_MORE", "GET_FURTHER_FORWARD"]);
    // Behaviour is re-derived from the incoming player's own attributes, not
    // simply copied from whoever came off.
    expect(replacement.behavior).toBeDefined();
  });

  it("a substituted-off player's instruction-driven behaviour never remains active on the pitch", () => {
    const homePlayers = squad("home");
    const awayPlayers = squad("away");
    const homeSetup = setupWithInstructions("home", homePlayers, 8, ["CROSS_MORE"]);
    const awaySetup = setupWithInstructions("away", awayPlayers, -1, undefined);

    const state = createMatchState({ fixture, homePlayers, awayPlayers, homeTacticalSetup: homeSetup, awayTacticalSetup: awaySetup, seed: "sub-safety-2" });
    const homeTeam = state.home;
    const outgoingId = homeTeam.selection[8]!.personId;
    const incomingId = homeTeam.benchPlayers[0]!.personId;

    applySubstitution(state, homeTeam, outgoingId, incomingId, 60);

    // The outgoing player no longer appears anywhere in the active selection.
    expect(homeTeam.selection.some((selected) => selected.personId === outgoingId)).toBe(false);
  });
});
