import { describe, expect, it } from "vitest";
import {
  managerHomePriorities,
  managerPrimaryPriority,
  ownerHomePriorities,
  presidentHomePriorities,
  attentionLimit,
} from "./homePriorities.js";
import type { EntityId, InboxItem, ManagerDashboard } from "@nepal-football-sim/shared-types";

const base = (over: Partial<ManagerDashboard> = {}): ManagerDashboard =>
  ({
    employmentStatus: "EMPLOYED",
    teamName: "Club",
    competitionName: "Competition",
    worldDate: "2026-08-01",
    played: 5,
    points: 8,
    form: ["W", "D"],
    recentResults: [],
    squadAvailability: { total: 25, available: 25, injured: 0, suspended: 0, unavailable: 0 },
    moraleSummary: "Good",
    trainingSummary: "Balanced",
    scoutingUpdates: 0,
    transferActivity: 0,
    contractIssues: 0,
    staffIssues: 0,
    inbox: [],
    ...over,
  }) as ManagerDashboard;

describe("Manager Home priorities", () => {
  it("1. next match is the primary priority when present", () => {
    const dashboard = base({ nextFixture: { id: "f1" as EntityId, date: "2026-08-08", competition: "A", opponent: "Rival", opponentId: "x" as EntityId, homeAway: "home", status: "UPCOMING" } });
    expect(managerPrimaryPriority(dashboard)).toBe("NEXT_MATCH");
    expect(managerHomePriorities(dashboard)[0]).toBe("NEXT_MATCH");
  });

  it("2. a decision becomes primary when there is no next match", () => {
    const dashboard = base({ inbox: [{ id: "i1" } as InboxItem] });
    expect(managerPrimaryPriority(dashboard)).toBe("DECISION");
  });

  it("3. squad readiness is the fallback primary (no fabrication)", () => {
    const dashboard = base();
    expect(managerPrimaryPriority(dashboard)).toBe("SQUAD_READINESS");
  });

  it("4. unemployed resolves as its own state", () => {
    const dashboard = base({ employmentStatus: "UNEMPLOYED" });
    expect(managerPrimaryPriority(dashboard)).toBe("UNEMPLOYED");
  });

  it("5. injuries surface only when real counts are non-zero", () => {
    const none = managerHomePriorities(base());
    expect(none).not.toContain("INJURIES");
    const some = managerHomePriorities(base({ squadAvailability: { total: 25, available: 20, injured: 3, suspended: 2, unavailable: 0 } }));
    expect(some).toContain("INJURIES");
  });
});

describe("Owner/President role adapters stay distinct from Manager", () => {
  it("owner institutional ordering is not the manager ordering", () => {
    const p = ownerHomePriorities({ hasDecision: true, hasFinanceContext: true, hasFixtures: true });
    expect(p).toEqual(["DECISION", "FINANCE", "NEXT_MATCH"]);
  });

  it("president federation ordering includes governance/national teams first", () => {
    const p = presidentHomePriorities({ hasGovDecision: true, hasFinanceContext: true, hasNationalTeams: true });
    expect(p).toEqual(["GOVERNANCE", "FINANCE", "NATIONAL_TEAMS"]);
  });

  it("empty views fall back to UPCOMING without inventing content", () => {
    expect(ownerHomePriorities({})).toEqual(["UPCOMING"]);
    expect(presidentHomePriorities({})).toEqual(["UPCOMING"]);
  });
});

describe("attention bounding", () => {
  it("7. result counts are bounded and deterministic", () => {
    expect(attentionLimit(0)).toBe(0);
    expect(attentionLimit(100)).toBe(6);
    expect(attentionLimit(4)).toBe(4);
  });
});