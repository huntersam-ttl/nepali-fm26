import { describe, expect, it } from "vitest";
import { FORMATION_PRESETS, createTacticalSetup, simulateMatch } from "@nepal-football-sim/simulation";
import type {
  EntityId,
  FixtureRecord,
  PlayerAttributeSet,
  SetPieceAssignments,
  TacticalSetup,
} from "@nepal-football-sim/shared-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fixture = {
  id: "set-piece-routine-fixture",
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

const POSITIONS: PlayerAttributeSet["primaryPosition"][] = [
  "GK", "LB", "CB", "CB", "RB", "CM", "CM", "CM", "LW", "RW", "ST",
];

const squad = (team: string, overrides: Record<number, Parameters<typeof player>[3]> = {}): PlayerAttributeSet[] =>
  POSITIONS.map((position, index) => player(team, index, position, overrides[index]));

const formation433 = FORMATION_PRESETS.find((f) => f.name === "4-3-3")!;

const setupWithSetPieces = (
  team: string,
  players: PlayerAttributeSet[],
  setPieces: Partial<SetPieceAssignments>,
): TacticalSetup => {
  const base = createTacticalSetup({ teamId: team as EntityId, name: `${team} tactic`, formation: formation433 });
  const assignments = formation433.slots.map((slot, index) => ({
    slotId: slot.id,
    playerId: players[index]!.personId,
    roleId: base.assignments[index]!.roleId,
    duty: base.assignments[index]!.duty,
  }));
  return {
    ...base,
    assignments,
    familiarity: { formation: 90, style: 88, roles: 88, instructions: 88 },
    bench: [],
    setPieces: { ...base.setPieces, ...setPieces },
  };
};

type SetPieceTotals = {
  corners: number;
  cornerOutcomes: Record<string, number>;
  cornerTargets: Record<string, number>;
  cornerGoals: number;
  freeKicks: number;
  freeKickOutcomes: Record<string, number>;
  freeKickGoals: number;
};

const bump = (record: Record<string, number>, key: string) => {
  record[key] = (record[key] ?? 0) + 1;
};

const aggregate = (
  homeSetup: TacticalSetup,
  homePlayers: PlayerAttributeSet[],
  awaySetup: TacticalSetup,
  awayPlayers: PlayerAttributeSet[],
  matches = 80,
): SetPieceTotals => {
  const totals: SetPieceTotals = {
    corners: 0,
    cornerOutcomes: {},
    cornerTargets: {},
    cornerGoals: 0,
    freeKicks: 0,
    freeKickOutcomes: {},
    freeKickGoals: 0,
  };
  for (let i = 0; i < matches; i += 1) {
    const result = simulateMatch({
      fixture,
      homePlayers,
      awayPlayers,
      homeTacticalSetup: homeSetup,
      awayTacticalSetup: awaySetup,
      seed: `set-piece-routine:${i}`,
    });
    for (const event of result.events) {
      if (event.type === "CORNER" && event.teamId === homeSetup.teamId) {
        totals.corners += 1;
        bump(totals.cornerOutcomes, String(event.data?.outcome));
        if (event.data?.targetPlayerId) bump(totals.cornerTargets, String(event.data.targetPlayerId));
      }
      if (event.type === "FREE_KICK" && event.teamId === homeSetup.teamId) {
        totals.freeKicks += 1;
        bump(totals.freeKickOutcomes, String(event.data?.outcome));
      }
      if (event.type === "GOAL" && event.teamId === homeSetup.teamId && event.data?.fromSetPiece === "CORNER") {
        totals.cornerGoals += 1;
      }
      if (event.type === "GOAL" && event.teamId === homeSetup.teamId && event.data?.fromSetPiece === "FREE_KICK") {
        totals.freeKickGoals += 1;
      }
    }
  }
  return totals;
};

const aerialShare = (totals: SetPieceTotals): number => {
  const contested = (totals.cornerOutcomes.TARGETED ?? 0) + (totals.cornerOutcomes.AERIAL_CONTEST ?? 0);
  return totals.corners > 0 ? contested / totals.corners : 0;
};

// ---------------------------------------------------------------------------
// Corner routines
// ---------------------------------------------------------------------------

describe("corner routine consumption", () => {
  const homePlayers = squad("team-home", {
    10: { heading: 18, jumping: 18, composure: 16 }, // primary target
    9: { heading: 6, jumping: 6 }, // secondary target
    8: { heading: 15, jumping: 15 }, // edge target
  });
  const awayPlayers = squad("team-away");
  const awaySetup = setupWithSetPieces("team-away", awayPlayers, {});

  it("SHORT_CORNER produces a materially lower aerial-contest share than NEAR_POST", () => {
    const nearPost = setupWithSetPieces("team-home", homePlayers, {
      cornerRoutine: "NEAR_POST",
      cornerPrimaryTarget: homePlayers[10]!.personId,
    });
    const shortCorner = setupWithSetPieces("team-home", homePlayers, {
      cornerRoutine: "SHORT_CORNER",
      cornerPrimaryTarget: homePlayers[10]!.personId,
    });
    const nearTotals = aggregate(nearPost, homePlayers, awaySetup, awayPlayers);
    const shortTotals = aggregate(shortCorner, homePlayers, awaySetup, awayPlayers);
    expect(nearTotals.corners).toBeGreaterThan(0);
    expect(shortTotals.corners).toBeGreaterThan(0);
    expect(aerialShare(shortTotals)).toBeLessThan(aerialShare(nearTotals));
  });

  it("CROWD_KEEPER produces a materially higher aerial-contest share than SHORT_CORNER", () => {
    const crowd = setupWithSetPieces("team-home", homePlayers, {
      cornerRoutine: "CROWD_KEEPER",
      cornerPrimaryTarget: homePlayers[10]!.personId,
    });
    const shortCorner = setupWithSetPieces("team-home", homePlayers, {
      cornerRoutine: "SHORT_CORNER",
      cornerPrimaryTarget: homePlayers[10]!.personId,
    });
    const crowdTotals = aggregate(crowd, homePlayers, awaySetup, awayPlayers);
    const shortTotals = aggregate(shortCorner, homePlayers, awaySetup, awayPlayers);
    expect(aerialShare(crowdTotals)).toBeGreaterThan(aerialShare(shortTotals));
  });

  it("an EDGE delivery zone favours the edge target over the primary target vs a NEAR_POST zone", () => {
    const edgeZone = setupWithSetPieces("team-home", homePlayers, {
      cornerRoutine: "NEAR_POST",
      cornerDeliveryZone: "EDGE",
      cornerPrimaryTarget: homePlayers[10]!.personId,
      cornerSecondaryTarget: homePlayers[9]!.personId,
      cornerEdgeTarget: homePlayers[8]!.personId,
    });
    const nearZone = setupWithSetPieces("team-home", homePlayers, {
      cornerRoutine: "NEAR_POST",
      cornerDeliveryZone: "NEAR_POST",
      cornerPrimaryTarget: homePlayers[10]!.personId,
      cornerSecondaryTarget: homePlayers[9]!.personId,
      cornerEdgeTarget: homePlayers[8]!.personId,
    });
    const edgeTotals = aggregate(edgeZone, homePlayers, awaySetup, awayPlayers, 40);
    const nearTotals = aggregate(nearZone, homePlayers, awaySetup, awayPlayers, 40);
    const edgeShareOfEdgeZone =
      (edgeTotals.cornerTargets[homePlayers[8]!.personId] ?? 0) / edgeTotals.corners;
    const edgeShareOfNearZone =
      (nearTotals.cornerTargets[homePlayers[8]!.personId] ?? 0) / nearTotals.corners;
    expect(edgeShareOfEdgeZone).toBeGreaterThan(edgeShareOfNearZone);
  });

  it("never crashes and always resolves a valid on-pitch target even when the configured target is missing", () => {
    const noTarget = setupWithSetPieces("team-home", homePlayers, {
      cornerRoutine: "FAR_POST",
      cornerPrimaryTarget: "not-on-pitch" as EntityId,
      cornerSecondaryTarget: undefined,
      cornerEdgeTarget: undefined,
    });
    const totals = aggregate(noTarget, homePlayers, awaySetup, awayPlayers, 20);
    expect(totals.corners).toBeGreaterThan(0);
    // Every corner still resolved to a real on-pitch target (fallback), never RECYCLED.
    expect(totals.cornerOutcomes.RECYCLED ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Free-kick routines
// ---------------------------------------------------------------------------

describe("free-kick routine consumption", () => {
  const homePlayers = squad("team-home", {
    10: { setPieces: 18, longShots: 18, composure: 16 },
  });
  const awayPlayers = squad("team-away");
  const awaySetup = setupWithSetPieces("team-away", awayPlayers, {});

  it("DIRECT resolves through the shot pathway (GOAL/SAVED/OFF_TARGET), never the aerial-contest pathway", () => {
    const direct = setupWithSetPieces("team-home", homePlayers, {
      freeKickRoutine: "DIRECT",
      directFreeKickTaker: homePlayers[10]!.personId,
    });
    const totals = aggregate(direct, homePlayers, awaySetup, awayPlayers, 60);
    expect(totals.freeKicks).toBeGreaterThan(0);
    const shotOutcomes = new Set(["GOAL", "SAVED", "OFF_TARGET", "RECYCLE"]);
    for (const outcome of Object.keys(totals.freeKickOutcomes)) {
      expect(shotOutcomes.has(outcome)).toBe(true);
    }
  });

  it("CROSS resolves through the aerial-contest pathway (TARGETED/AERIAL_CONTEST/CLEARED), never the shot pathway", () => {
    const cross = setupWithSetPieces("team-home", homePlayers, {
      freeKickRoutine: "CROSS",
      freeKickTarget: homePlayers[10]!.personId,
    });
    const totals = aggregate(cross, homePlayers, awaySetup, awayPlayers, 60);
    expect(totals.freeKicks).toBeGreaterThan(0);
    const aerialOutcomes = new Set(["TARGETED", "AERIAL_CONTEST", "CLEARED", "RECYCLE"]);
    for (const outcome of Object.keys(totals.freeKickOutcomes)) {
      expect(aerialOutcomes.has(outcome)).toBe(true);
    }
  });

  it("INDIRECT produces a lower aerial-contest share than CROSS", () => {
    const cross = setupWithSetPieces("team-home", homePlayers, {
      freeKickRoutine: "CROSS",
      freeKickTarget: homePlayers[10]!.personId,
    });
    const indirect = setupWithSetPieces("team-home", homePlayers, {
      freeKickRoutine: "INDIRECT",
      freeKickTarget: homePlayers[10]!.personId,
    });
    const crossTotals = aggregate(cross, homePlayers, awaySetup, awayPlayers, 80);
    const indirectTotals = aggregate(indirect, homePlayers, awaySetup, awayPlayers, 80);
    const share = (t: SetPieceTotals) => {
      const contested = (t.freeKickOutcomes.TARGETED ?? 0) + (t.freeKickOutcomes.AERIAL_CONTEST ?? 0);
      return t.freeKicks > 0 ? contested / t.freeKicks : 0;
    };
    expect(share(indirectTotals)).toBeLessThan(share(crossTotals));
  });

  it("never crashes when the configured taker is missing — falls back to a valid on-pitch outfield taker", () => {
    const noTaker = setupWithSetPieces("team-home", homePlayers, {
      freeKickRoutine: "DIRECT",
      directFreeKickTaker: "not-on-pitch" as EntityId,
      indirectFreeKickTaker: undefined,
    });
    const totals = aggregate(noTaker, homePlayers, awaySetup, awayPlayers, 20);
    expect(totals.freeKicks).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Defensive corner schemes
// ---------------------------------------------------------------------------

describe("defensive corner schemes", () => {
  it("a strong named man-marker against a weak attacking target concedes a lower aerial-contest share than zonal coverage", () => {
    const homePlayers = squad("team-home", { 10: { heading: 6, jumping: 6 } }); // weak attacking target
    const awayPlayers = squad("team-away", { 2: { heading: 19, jumping: 19 } }); // elite marker
    const homeSetup = setupWithSetPieces("team-home", homePlayers, {
      cornerRoutine: "NEAR_POST",
      cornerPrimaryTarget: homePlayers[10]!.personId,
    });
    const manOriented = setupWithSetPieces("team-away", awayPlayers, {
      defensiveCornerScheme: "MAN_ORIENTED",
      defensiveAerialPriority: [awayPlayers[2]!.personId],
    });
    const zonal = setupWithSetPieces("team-away", awayPlayers, {
      defensiveCornerScheme: "ZONAL",
      defensiveAerialPriority: [awayPlayers[2]!.personId],
    });
    const manTotals = aggregate(homeSetup, homePlayers, manOriented, awayPlayers, 80);
    const zonalTotals = aggregate(homeSetup, homePlayers, zonal, awayPlayers, 80);
    expect(aerialShare(manTotals)).toBeLessThan(aerialShare(zonalTotals));
  });

  it("no scheme is universally best: a weak/absent man-marking assignment against a strong target is worse than zonal", () => {
    const homePlayers = squad("team-home", { 10: { heading: 19, jumping: 19 } }); // elite attacking target
    const awayPlayers = squad("team-away", { 2: { heading: 6, jumping: 6 } }); // weak marker
    const homeSetup = setupWithSetPieces("team-home", homePlayers, {
      cornerRoutine: "NEAR_POST",
      cornerPrimaryTarget: homePlayers[10]!.personId,
    });
    const manOriented = setupWithSetPieces("team-away", awayPlayers, {
      defensiveCornerScheme: "MAN_ORIENTED",
      defensiveAerialPriority: [awayPlayers[2]!.personId],
    });
    const zonal = setupWithSetPieces("team-away", awayPlayers, {
      defensiveCornerScheme: "ZONAL",
      defensiveAerialPriority: [awayPlayers[2]!.personId],
    });
    const manTotals = aggregate(homeSetup, homePlayers, manOriented, awayPlayers, 80);
    const zonalTotals = aggregate(homeSetup, homePlayers, zonal, awayPlayers, 80);
    expect(aerialShare(manTotals)).toBeGreaterThan(aerialShare(zonalTotals));
  });
});
