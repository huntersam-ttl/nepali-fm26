import { describe, expect, it } from "vitest";
import {
  createMatchState,
  createTacticalSetup,
  deserializeMatchState,
  serializeMatchState,
  simulateMatch,
} from "@nepal-football-sim/simulation";
import type { EntityId, FixtureRecord } from "@nepal-football-sim/shared-types";

const fixture = {
  id: "fixture-momentum",
  homeTeamId: "team-home",
  awayTeamId: "team-away",
  scheduledDate: "2026-08-08",
  status: "scheduled",
} as unknown as FixtureRecord;

const player = (team: EntityId, index: number) => ({
  id: `${team}-attribute-${index}`,
  personId: `${team}-player-${index}`,
  primaryPosition: index === 0 ? "GK" : index === 10 ? "ST" : "CM",
  secondaryPositions: [],
  technical: { finishing: 10, passing: 10, setPieces: 10 },
  mental: { composure: 10, vision: 10 },
  physical: { stamina: 10, strength: 10 },
  goalkeeping: index === 0 ? { handling: 10, reflexes: 10 } : {},
});

const squad = (team: EntityId) =>
  Array.from({ length: 11 }, (_, index) => player(team, index)) as never[];

describe("match momentum and set-piece routines", () => {
  it("persists bounded momentum in the resumable match state", () => {
    const state = createMatchState({
      fixture,
      homePlayers: squad("home" as EntityId),
      awayPlayers: squad("away" as EntityId),
      seed: "momentum-seed",
    });
    state.home.momentum = 78;
    state.away.momentum = 24;
    const restored = deserializeMatchState(serializeMatchState(state));
    expect(restored.home.momentum).toBe(78);
    expect(restored.away.momentum).toBe(24);
  });

  it("resolves active set-piece targets, defensive assignments, and fallbacks", () => {
    const homeSetup = {
      ...createTacticalSetup({ teamId: "home" as EntityId, name: "Set pieces" }),
      setPieces: {
        cornerRoutine: "FAR_POST" as const,
        cornerDeliveryZone: "FAR_POST" as const,
        cornerPrimaryTarget: "home-player-10" as EntityId,
        cornerSecondaryTarget: "home-player-9" as EntityId,
        cornerEdgeTarget: "home-player-8" as EntityId,
        defensiveCornerScheme: "MIXED" as const,
        defensiveCornerAssignments: ["home-player-1" as EntityId],
        defensiveAerialPriority: ["home-player-2" as EntityId],
        directFreeKickTaker: "home-player-10" as EntityId,
        indirectFreeKickTaker: "home-player-9" as EntityId,
        freeKickRoutine: "CROSS" as const,
        freeKickTarget: "home-player-10" as EntityId,
        penaltyTakers: ["home-player-10", "home-player-9"] as EntityId[],
      },
    };
    const awaySetup = {
      ...createTacticalSetup({ teamId: "away" as EntityId, name: "Defence" }),
      setPieces: { defensiveCornerScheme: "ZONAL" as const },
    };
    const result = simulateMatch({
      fixture,
      homePlayers: squad("home" as EntityId),
      awayPlayers: squad("away" as EntityId),
      homeTacticalSetup: homeSetup,
      awayTacticalSetup: awaySetup,
      seed: "set-piece-workflow",
    });
    const corner = result.events.find((event) => event.type === "CORNER");
    if (corner) {
      expect(corner.data?.deliveryZone).toBe("FAR_POST");
      expect(corner.data?.defensiveScheme).toBe("ZONAL");
      expect(corner.data?.targetPlayerId).toBeTruthy();
      expect(corner.data?.outcome).toBeTruthy();
    }
    const restored = deserializeMatchState(
      serializeMatchState(
        createMatchState({
          fixture,
          homePlayers: squad("home" as EntityId),
          awayPlayers: squad("away" as EntityId),
          homeTacticalSetup: homeSetup,
          awayTacticalSetup: awaySetup,
          seed: "set-piece-workflow-resume",
        }),
      ),
    );
    expect(restored.home.setup?.setPieces.cornerPrimaryTarget).toBe("home-player-10");
    expect(restored.home.setup?.setPieces.penaltyTakers).toEqual([
      "home-player-10",
      "home-player-9",
    ]);
  });
});
