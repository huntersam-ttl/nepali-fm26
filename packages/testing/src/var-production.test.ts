import { describe, expect, it } from "vitest";
import {
  createDemoLeagueInput,
  generateLeagueFixtures,
  simulateMatch,
} from "@nepal-football-sim/simulation";
import { createStableEntityId, type FixtureOfficialAssignment } from "@nepal-football-sim/shared-types";

describe("production VAR integration", () => {
  it("reviews goals deterministically and preserves the no-VAR path", () => {
    const demo = createDemoLeagueInput("var-production");
    const fixture = generateLeagueFixtures({
      competitionSeasonId: demo.competitionSeason.id,
      teamIds: demo.teamIds.slice(0, 2),
      ruleSet: { ...demo.ruleSet, homeAwayStructure: "single" },
      seed: "var-production-fixture",
    })[0]!;
    const assignment: FixtureOfficialAssignment = {
      id: createStableEntityId("official-assignment", "var-production"),
      fixtureId: fixture.id,
      varPersonId: createStableEntityId("person", "var-official"),
      assignedOn: fixture.scheduledDate,
      status: "ASSIGNED",
      provenanceStatus: "SIMULATION_ONLY",
    };
    const baseInput = {
      fixture,
      homePlayers: demo.playersByTeam.get(fixture.homeTeamId)!,
      awayPlayers: demo.playersByTeam.get(fixture.awayTeamId)!,
    };

    let reviewed: ReturnType<typeof simulateMatch> | undefined;
    let seed = "";
    for (let index = 0; index < 300 && !reviewed; index += 1) {
      seed = `var-production-seed:${index}`;
      const candidate = simulateMatch({ ...baseInput, seed, refereeAssignment: assignment });
      if (candidate.events.some((event) => event.type === "VAR_CHECK")) reviewed = candidate;
    }
    expect(reviewed).toBeDefined();
    const result = reviewed!;
    const repeat = simulateMatch({ ...baseInput, seed, refereeAssignment: assignment });
    expect(repeat).toEqual(result);

    const checks = result.events.filter((event) => event.type === "VAR_CHECK");
    expect(checks).toHaveLength(1);
    expect(["CONFIRMED", "OVERTURNED"]).toContain(checks[0]!.data?.outcome);
    expect(checks[0]!.data?.varPersonId).toBe(assignment.varPersonId);
    expect(result.playerStates.reduce((total, player) => total + player.goals, 0)).toBe(
      (result.match.homeGoals ?? 0) + (result.match.awayGoals ?? 0),
    );

    const withoutVar = simulateMatch({ ...baseInput, seed });
    expect(withoutVar.events.some((event) => event.type === "VAR_CHECK")).toBe(false);
    if (checks[0]!.data?.outcome === "OVERTURNED") {
      expect(withoutVar.match.homeGoals! + withoutVar.match.awayGoals!).toBeGreaterThan(
        result.match.homeGoals! + result.match.awayGoals!,
      );
    } else {
      expect(withoutVar.match.homeGoals).toBe(result.match.homeGoals);
      expect(withoutVar.match.awayGoals).toBe(result.match.awayGoals);
    }
  });
});
