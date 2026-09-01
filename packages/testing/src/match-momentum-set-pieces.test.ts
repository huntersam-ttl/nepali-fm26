import { describe, expect, it } from "vitest";
import {
  createMatchState,
  deserializeMatchState,
  serializeMatchState,
} from "@nepal-football-sim/simulation";
import type { FixtureRecord } from "@nepal-football-sim/shared-types";

const fixture = {
  id: "fixture-momentum",
  homeTeamId: "team-home",
  awayTeamId: "team-away",
  scheduledDate: "2026-08-08",
  status: "scheduled",
} as unknown as FixtureRecord;

const player = (team: string, index: number) => ({
  id: `${team}-attribute-${index}`,
  personId: `${team}-player-${index}`,
  primaryPosition: index === 0 ? "GK" : index === 10 ? "ST" : "CM",
  secondaryPositions: [],
  technical: { finishing: 10, passing: 10, setPieces: 10 },
  mental: { composure: 10, vision: 10 },
  physical: { stamina: 10, strength: 10 },
  goalkeeping: index === 0 ? { handling: 10, reflexes: 10 } : {},
});

const squad = (team: string) =>
  Array.from({ length: 11 }, (_, index) => player(team, index)) as never[];

describe("match momentum and set-piece routines", () => {
  it("persists bounded momentum in the resumable match state", () => {
    const state = createMatchState({
      fixture,
      homePlayers: squad("home"),
      awayPlayers: squad("away"),
      seed: "momentum-seed",
    });
    state.home.momentum = 78;
    state.away.momentum = 24;
    const restored = deserializeMatchState(serializeMatchState(state));
    expect(restored.home.momentum).toBe(78);
    expect(restored.away.momentum).toBe(24);
  });
});
