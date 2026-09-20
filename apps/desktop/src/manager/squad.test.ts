import { describe, expect, it } from "vitest";
import {
  contractsExpiring,
  injuredOrSuspended,
  positionalDepth,
  sortFirstTeam,
  squadAvailability,
  squadTotal,
} from "./squad.js";
import type { SquadList, SquadPlayerRow } from "@nepal-football-sim/shared-types";

const player = (over: Record<string, unknown>): SquadPlayerRow =>
  ({
    personId: `p-${String(over.name ?? "x")}`,
    name: String(over.name ?? "X"),
    primaryPosition: String(over.primaryPosition ?? "STRIKER"),
    availability: String(over.availability ?? "AVAILABLE"),
    age: { value: 24, status: "ESTIMATED" },
    ...over,
  }) as unknown as SquadPlayerRow;

const squad = (players: SquadPlayerRow[]): SquadList =>
  ({
    teamId: "t1",
    teamName: "Club",
    players,
    positionOptions: ["STRIKER", "GOALKEEPER"],
    availabilityCounts: {
      AVAILABLE: players.filter((p) => p.availability === "AVAILABLE").length,
      INJURED: players.filter((p) => p.availability === "INJURED").length,
      SUSPENDED: players.filter((p) => p.availability === "SUSPENDED").length,
      UNAVAILABLE: players.filter((p) => p.availability === "UNAVAILABLE").length,
      INTERNATIONAL_DUTY: 0,
    },
  }) as unknown as SquadList;

describe("squad helpers", () => {
  it("2/3. derives availability counts and totals", () => {
    const s = squad([
      player({ name: "a" }),
      player({ name: "b", availability: "INJURED" }),
      player({ name: "c", availability: "INJURED" }),
      player({ name: "d", availability: "SUSPENDED" }),
    ]);
    expect(squadTotal(s)).toBe(4);
    expect(squadAvailability(s).INJURED).toBe(2);
    expect(squadAvailability(s).SUSPENDED).toBe(1);
  });

  it("4. injury/suspension summary returns only real non-available players", () => {
    const s = squad([player({ name: "a" }), player({ name: "b", availability: "INJURED" })]);
    expect(injuredOrSuspended(s).map((p) => p.name)).toEqual(["b"]);
  });

  it("5. contract-expiry summary only lists those with a recorded expiry", () => {
    const s = squad([player({ name: "a" }), player({ name: "b", contractExpiry: "2027-06-30" })]);
    expect(contractsExpiring(s).map((p) => p.name)).toEqual(["b"]);
  });

  it("6. truthfully absent youth: positional depth reflects only senior players present", () => {
    const s = squad([player({ name: "a", primaryPosition: "STRIKER" }), player({ name: "b", primaryPosition: "STRIKER" }), player({ name: "c", primaryPosition: "GOALKEEPER" })]);
    const depth = positionalDepth(s);
    expect(depth).toEqual([
      { position: "GOALKEEPER", count: 1 },
      { position: "STRIKER", count: 2 },
    ]);
  });

  it("7. first-team ordering is deterministic (position group, then name)", () => {
    const s = squad([player({ name: "b", primaryPosition: "STRIKER" }), player({ name: "a", primaryPosition: "GOALKEEPER" })]);
    expect(sortFirstTeam(s.players).map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("8/9/11. presentation model contains no hidden ability/potential field", () => {
    const s = squad([player({ name: "a" })]);
    const json = JSON.stringify(sortFirstTeam(s.players)[0]);
    expect(json).not.toMatch(/"potential"|"currentAbility"|"hiddenAbility"/i);
  });
});