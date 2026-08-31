import { describe, expect, it } from "vitest";
import { nextFixtureForTeam, userMatchRequiresAction } from "@nepal-football-sim/simulation";
import type { EntityId, FixtureRecord } from "@nepal-football-sim/shared-types";

const id = (value: string) => value as EntityId;
const fixture = (idValue: string, date: string, status: FixtureRecord["status"] = "scheduled"): FixtureRecord => ({
  id: id(idValue), competitionSeasonId: id("season"), homeTeamId: id("home"), awayTeamId: id("player"), scheduledDate: date, status, round: 1,
});

describe("manager matchday integrity", () => {
  it("recognises today's unresolved fixture as a hard stop", () => {
    const current = fixture("today", "2027-08-08");
    const future = fixture("future", "2027-08-15");
    expect(userMatchRequiresAction([current, future], id("player"), "2027-08-08")?.id).toBe(current.id);
    expect(nextFixtureForTeam([current, future], id("player"), "2027-08-08")?.id).toBe(current.id);
  });

  it("does not treat a future fixture as playable", () => {
    const future = fixture("future", "2027-08-15");
    expect(userMatchRequiresAction([future], id("player"), "2027-08-08")).toBeUndefined();
    expect(nextFixtureForTeam([future], id("player"), "2027-08-08")?.id).toBe(future.id);
  });

  it("ignores completed fixtures even when their date is today", () => {
    expect(userMatchRequiresAction([fixture("played", "2027-08-08", "played")], id("player"), "2027-08-08")).toBeUndefined();
  });
});
