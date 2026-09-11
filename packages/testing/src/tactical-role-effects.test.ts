import { describe, expect, it } from "vitest";
import {
  allowedDutiesForRole,
  createTacticalSetup,
  defaultDutyForRole,
  derivePlayerTacticalBehavior,
  dutyIsLegalForRole,
  normalizeTacticalSetup,
  simulateMatch,
  validateSelection,
} from "@nepal-football-sim/simulation";
import { FORMATION_PRESETS } from "@nepal-football-sim/simulation";
import type {
  EntityId,
  FixtureRecord,
  PlayerAttributeSet,
  PlayerDuty,
  TacticalAssignment,
} from "@nepal-football-sim/shared-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fixture = {
  id: "role-effect-fixture",
  homeTeamId: "team-home",
  awayTeamId: "team-away",
  scheduledDate: "2026-08-08",
  status: "scheduled",
  competitionSeasonId: "season-1",
  round: 1,
} as unknown as FixtureRecord;

const attr = (over: Partial<PlayerAttributeSet["technical"] & PlayerAttributeSet["mental"] & PlayerAttributeSet["physical"]> = {}) => ({
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
  overrides: Partial<PlayerAttributeSet["technical"] & PlayerAttributeSet["mental"] & PlayerAttributeSet["physical"]> = {},
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

const squad = (team: string): PlayerAttributeSet[] =>
  POSITIONS.map((position, index) => player(team, index, position));

const formation433 = FORMATION_PRESETS.find((f) => f.name === "4-3-3")!;

const setupWith = (
  team: string,
  players: PlayerAttributeSet[],
  slotOverrides: Record<string, { roleId: string; duty: PlayerDuty }>,
) => {
  const base = createTacticalSetup({ teamId: team as EntityId, name: `${team} tactic`, formation: formation433 });
  const assignments: TacticalAssignment[] = formation433.slots.map((slot, index) => {
    const override = slotOverrides[slot.id];
    return {
      slotId: slot.id,
      playerId: players[index]!.personId,
      roleId: override?.roleId ?? base.assignments[index]!.roleId,
      duty: override?.duty ?? base.assignments[index]!.duty,
    };
  });
  return {
    ...base,
    assignments,
    familiarity: { formation: 90, style: 88, roles: 88, instructions: 88 },
    bench: [],
  };
};

/** Aggregate one player's event involvement across many seeded matches. */
const aggregate = (
  homeSetup: ReturnType<typeof setupWith>,
  homePlayers: PlayerAttributeSet[],
  personId: string,
  matches = 40,
) => {
  const awayPlayers = squad("away");
  const awaySetup = setupWith("away", awayPlayers, {});
  const totals = { shots: 0, goals: 0, assists: 0, crossAssists: 0, tackles: 0, fouls: 0 };
  for (let i = 0; i < matches; i += 1) {
    const result = simulateMatch({
      fixture,
      homePlayers,
      awayPlayers,
      homeTacticalSetup: homeSetup,
      awayTacticalSetup: awaySetup,
      seed: `role-effect:${i}`,
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
      if (line.personId === personId) totals.tackles += line.tackles ?? 0;
    }
  }
  return totals;
};

// ---------------------------------------------------------------------------
// derivePlayerTacticalBehavior — unit
// ---------------------------------------------------------------------------

describe("derivePlayerTacticalBehavior", () => {
  const p = player("x", 1, "CM");

  it("ATTACK duty raises attacking involvement and lowers defensive contribution vs SUPPORT", () => {
    const support = derivePlayerTacticalBehavior({ attributes: p, roleId: "CENTRAL_MIDFIELDER", duty: "SUPPORT" });
    const attack = derivePlayerTacticalBehavior({ attributes: p, roleId: "CENTRAL_MIDFIELDER", duty: "ATTACK" });
    expect(attack.attackingInvolvement).toBeGreaterThan(support.attackingInvolvement);
    expect(attack.boxPresence).toBeGreaterThan(support.boxPresence);
    expect(attack.defensiveContribution).toBeLessThan(support.defensiveContribution);
    expect(attack.riskTaking).toBeGreaterThan(support.riskTaking);
  });

  it("DEFEND duty is the inverse trend", () => {
    const support = derivePlayerTacticalBehavior({ attributes: p, roleId: "CENTRAL_MIDFIELDER", duty: "SUPPORT" });
    const defend = derivePlayerTacticalBehavior({ attributes: p, roleId: "DEFENSIVE_MIDFIELDER", duty: "DEFEND" });
    expect(defend.attackingInvolvement).toBeLessThan(support.attackingInvolvement);
    expect(defend.defensiveContribution).toBeGreaterThan(support.defensiveContribution);
  });

  it("role archetype differentiates a playmaker from a ball-winner", () => {
    const dlp = derivePlayerTacticalBehavior({ attributes: p, roleId: "DEEP_LYING_PLAYMAKER", duty: "SUPPORT" });
    const bwm = derivePlayerTacticalBehavior({ attributes: p, roleId: "DEFENSIVE_MIDFIELDER", duty: "DEFEND" });
    expect(dlp.creativeInvolvement).toBeGreaterThan(bwm.creativeInvolvement);
    expect(dlp.progressionInvolvement).toBeGreaterThan(bwm.progressionInvolvement);
    expect(bwm.defensiveContribution).toBeGreaterThan(dlp.defensiveContribution);
  });

  it("a winger crosses more than an inside forward; the inside forward is more of a box threat", () => {
    const winger = derivePlayerTacticalBehavior({ attributes: p, roleId: "WINGER", duty: "ATTACK" });
    const insideForward = derivePlayerTacticalBehavior({ attributes: p, roleId: "INSIDE_FORWARD", duty: "ATTACK" });
    expect(winger.crossingTendency).toBeGreaterThan(insideForward.crossingTendency);
    expect(insideForward.boxPresence).toBeGreaterThan(winger.boxPresence);
  });

  it("poor role fit / low familiarity pull every intent back toward neutral (bounded)", () => {
    const sharp = derivePlayerTacticalBehavior({
      attributes: p, roleId: "ADVANCED_FORWARD", duty: "ATTACK", roleFit: 95,
      familiarity: { formation: 95, style: 95, roles: 95, instructions: 95 },
    });
    const blunt = derivePlayerTacticalBehavior({
      attributes: p, roleId: "ADVANCED_FORWARD", duty: "ATTACK", roleFit: 35,
      familiarity: { formation: 34, style: 34, roles: 34, instructions: 34 },
    });
    expect(sharp.attackingInvolvement).toBeGreaterThan(blunt.attackingInvolvement);
    for (const value of Object.values(blunt)) {
      expect(value).toBeGreaterThanOrEqual(0.4);
      expect(value).toBeLessThanOrEqual(1.75);
    }
  });

  it("high attacking attributes lift attacking involvement within bounds", () => {
    // A mid-range role (not one whose ATTACK duty already reaches the ceiling)
    // so the attribute contribution is visible.
    const poor = derivePlayerTacticalBehavior({ attributes: player("x", 2, "CM", { finishing: 4, anticipation: 4, acceleration: 4 }), roleId: "CENTRAL_MIDFIELDER", duty: "SUPPORT" });
    const elite = derivePlayerTacticalBehavior({ attributes: player("x", 3, "CM", { finishing: 19, anticipation: 18, acceleration: 18 }), roleId: "CENTRAL_MIDFIELDER", duty: "SUPPORT" });
    expect(elite.attackingInvolvement).toBeGreaterThan(poor.attackingInvolvement);
    expect(elite.attackingInvolvement).toBeLessThanOrEqual(1.75);
  });
});

// ---------------------------------------------------------------------------
// Match-engine directional effects (aggregate over seeded matches)
// ---------------------------------------------------------------------------

describe("role/duty change match-engine event involvement", () => {
  it("Advanced Forward ATTACK takes more shots than Deep-Lying Forward SUPPORT in the same slot", () => {
    const players = squad("home");
    const strikerId = players[10]!.personId as string;
    const af = aggregate(setupWith("home", players, { STC: { roleId: "ADVANCED_FORWARD", duty: "ATTACK" } }), players, strikerId);
    const dlf = aggregate(setupWith("home", players, { STC: { roleId: "COMPLETE_FORWARD", duty: "SUPPORT" } }), players, strikerId);
    expect(af.shots).toBeGreaterThan(dlf.shots);
    expect(af.shots + af.goals).toBeGreaterThan(dlf.shots + dlf.goals);
  }, 60_000);

  it("Winger ATTACK creates more (and more crossed) assists than Inside Forward ATTACK in the same wide slot", () => {
    const players = squad("home");
    const wideId = players[8]!.personId as string;
    const winger = aggregate(setupWith("home", players, { AML: { roleId: "WINGER", duty: "ATTACK" } }), players, wideId);
    const inside = aggregate(setupWith("home", players, { AML: { roleId: "INSIDE_FORWARD", duty: "ATTACK" } }), players, wideId);
    expect(winger.assists).toBeGreaterThanOrEqual(inside.assists);
    expect(winger.crossAssists).toBeGreaterThan(inside.crossAssists);
    expect(inside.shots).toBeGreaterThan(winger.shots);
  }, 60_000);

  it("a midfielder on ATTACK is more involved in shots than the same player on DEFEND", () => {
    const players = squad("home");
    const midId = players[7]!.personId as string;
    const attack = aggregate(setupWith("home", players, { MCR: { roleId: "MEZZALA", duty: "ATTACK" } }), players, midId);
    const defend = aggregate(setupWith("home", players, { MCR: { roleId: "DEFENSIVE_MIDFIELDER", duty: "DEFEND" } }), players, midId);
    expect(attack.shots).toBeGreaterThan(defend.shots);
    expect(defend.tackles).toBeGreaterThanOrEqual(attack.tackles);
  }, 60_000);

  it("a Ball-Winning midfielder on DEFEND commits more of the team's fouls than a Deep-Lying Playmaker", () => {
    const players = squad("home");
    const midId = players[5]!.personId as string;
    const bwm = aggregate(setupWith("home", players, { MCL: { roleId: "DEFENSIVE_MIDFIELDER", duty: "DEFEND" } }), players, midId);
    const dlp = aggregate(setupWith("home", players, { MCL: { roleId: "DEEP_LYING_PLAYMAKER", duty: "SUPPORT" } }), players, midId);
    expect(bwm.fouls + bwm.tackles).toBeGreaterThan(dlp.fouls + dlp.tackles);
  }, 60_000);
});

describe("role × duty legality", () => {
  it("a deeply defensive role cannot take ATTACK; a pure poacher cannot take DEFEND", () => {
    expect(dutyIsLegalForRole("ANCHOR", "ATTACK")).toBe(false);
    expect(dutyIsLegalForRole("ANCHOR", "DEFEND")).toBe(true);
    expect(dutyIsLegalForRole("POACHER", "DEFEND")).toBe(false);
    expect(dutyIsLegalForRole("POACHER", "ATTACK")).toBe(true);
    expect(allowedDutiesForRole("CENTRAL_MIDFIELDER")).toEqual(["DEFEND", "SUPPORT", "ATTACK"]);
  });

  it("the backend rejects an illegal role/duty pairing as a blocking error, not just a UI hint", () => {
    const players = squad("home");
    const setup = setupWith("home", players, { STC: { roleId: "POACHER", duty: "DEFEND" } });
    const validation = validateSelection({ setup, players });
    expect(validation.isValid).toBe(false);
    expect(validation.blockingErrors.some((message) => /duty/i.test(message))).toBe(true);
  });

  it("a legal role/duty pairing validates cleanly", () => {
    const players = squad("home");
    const setup = setupWith("home", players, { STC: { roleId: "POACHER", duty: "ATTACK" } });
    expect(validateSelection({ setup, players }).isValid).toBe(true);
  });
});

describe("old-save / missing-duty compatibility", () => {
  it("backfills a legal, deterministic duty for an assignment saved before duties existed", () => {
    const players = squad("home");
    const setup = setupWith("home", players, {});
    // Simulate a pre-duty save: strip duty entirely.
    const preDuty = {
      ...setup,
      assignments: setup.assignments.map(({ duty: _duty, ...rest }) => rest),
    };
    const normalized = normalizeTacticalSetup(preDuty as never);
    for (const assignment of normalized.assignments) {
      expect(assignment.duty).toBeDefined();
      expect(dutyIsLegalForRole(assignment.roleId, assignment.duty!)).toBe(true);
      expect(assignment.duty).toBe(defaultDutyForRole(assignment.roleId));
    }
    // Normalizing twice is idempotent.
    expect(normalizeTacticalSetup(normalized)).toEqual(normalized);
  });

  it("clamps an illegal duty carried over from a role change to the new role's default", () => {
    const players = squad("home");
    const setup = setupWith("home", players, { STC: { roleId: "POACHER", duty: "DEFEND" as never } });
    const normalized = normalizeTacticalSetup(setup);
    const stc = normalized.assignments.find((a) => a.slotId === "STC")!;
    expect(stc.duty).toBe("ATTACK");
  });
});
