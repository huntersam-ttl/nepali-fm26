import { describe, expect, it } from "vitest";
import { MANAGER_WORKSPACES } from "../navigation.js";
import { MANAGER_FAMILIES } from "./navigationLabels.js";
import {
  POSITION_LANES,
  SUPPORTED_ASSIGNMENT_TYPES,
  UNKNOWN,
  activeAssignments,
  assignmentStatusText,
  assignmentTypeLabel,
  classifyHorizon,
  filterByKnowledge,
  knowledgeText,
  orderAssignments,
  positionGroupFor,
  provenanceText,
  rangeText,
  recommendationsOrdered,
  reportAgeDays,
  rowName,
  rowPosition,
  shortlistSortRows,
  sortRows,
} from "./recruitment.js";
import type { KnowledgeRange, PlayerKnowledgeLevel, RecruitmentRow, ScoutingReportView } from "@nepal-football-sim/shared-types";

const eid = (v: string) => v as unknown as RecruitmentRow["playerId"];

const row = (over: Omit<Partial<RecruitmentRow>, "playerId"> & { playerId?: string }): RecruitmentRow => {
  const { playerId, ...rest } = over;
  return {
    playerId: (playerId ?? "p1") as unknown as RecruitmentRow["playerId"],
    discoveryStatus: "KNOWN",
    knowledge: "BASIC",
    confidence: "MEDIUM",
    shortlisted: false,
    ...rest,
  } as RecruitmentRow;
};

const report = (over: Omit<Partial<ScoutingReportView>, "playerId"> & { playerId?: string }): ScoutingReportView => {
  const { playerId, ...rest } = over;
  return {
    playerId: (playerId ?? "p1") as unknown as ScoutingReportView["playerId"],
    playerName: "A",
    estimatedPotentialBand: "Debuted",
    confidence: "MEDIUM",
    observations: 1,
    strengths: [],
    weaknesses: [],
    positionAssessment: "Forward",
    roleAssessment: "Striker",
    recommendation: "Sensible target",
    generatedAt: "2026-01-02",
    scoutName: "Scout One",
    ...rest,
  } as ScoutingReportView;
};

const shortEntry = (over: Partial<{
  playerName?: string;
  knowledge?: PlayerKnowledgeLevel;
  estimatedAbility?: KnowledgeRange;
  addedAt?: string;
  clubName?: string;
}>): { playerName?: string; knowledge: PlayerKnowledgeLevel; estimatedAbility?: KnowledgeRange; addedAt: string; clubName?: string } => ({
  playerName: over.playerName ?? "B",
  knowledge: over.knowledge ?? "BASIC",
  addedAt: over.addedAt ?? "2026-01-01",
  clubName: over.clubName ?? "Club",
  estimatedAbility: over.estimatedAbility,
});

describe("database mapping", () => {
  it("1/8. maps a recruitment row to name/position carrying the canonical player id", () => {
    const r = row({ playerId: "p-abc", name: "Maya", knownPosition: "ST", positionGroup: "Forward" });
    expect(rowName(r)).toBe("Maya");
    expect(rowPosition(r)).toBe("ST");
    expect(r.playerId).toBe(eid("p-abc"));
  });
  it("2. known vs unknown ability", () => {
    expect(rangeText(undefined)).toBe(UNKNOWN);
    expect(rangeText({ min: 60, max: 70 })).toBe("60–70");
  });
  it("7. empty dataset produces empty results", () => {
    expect(sortRows([], "name")).toEqual([]);
    expect(filterByKnowledge([], "GOOD")).toEqual([]);
    expect(recommendationsOrdered([])).toEqual([]);
  });
});

describe("knowledge safety", () => {
  it("3. no hidden CA/PA anywhere", () => {
    const json = JSON.stringify([
      rowName(row({ name: "X" })),
      rowPosition(row({ knownPosition: "Midfielder" })),
      rangeText({ min: 60, max: 70 }),
      knowledgeText("BASIC"),
      provenanceText("SCOUTED"),
    ]);
    expect(json).not.toMatch(/potential|currentAbility|hidden|attributeValue|wage|value/i);
  });
  it("9/10/11. unscouted hides, estimates stay estimates, knowledge is provenance-preserved", () => {
    expect(rangeText(undefined)).toBe(UNKNOWN); // unseen stays unknown
    expect(rangeText({ min: 55, max: 65 })).toBe("55–65"); // band estimate, not exact
    expect(provenanceText("UNDISCOVERED")).toBe("Not yet discovered");
    expect(provenanceText("SCOUTED")).toBe("Scouted");
  });
  it("12. provenance + knowledge labels are stable text", () => {
    expect(knowledgeText("GOOD")).toBe("good");
    expect(provenanceText("KNOWN")).toBe("Known");
  });
});

describe("filtering & sorting", () => {
  it("4. deterministic knowledge filter preserves the rest of the dataset shape", () => {
    const a = row({ playerId: "a", knowledge: "GOOD" });
    const b = row({ playerId: "b", knowledge: "NONE" });
    expect(filterByKnowledge([a, b], "GOOD")).toEqual([a]);
    expect(filterByKnowledge([a, b], "ALL")).toEqual([a, b]);
  });
  it("5. deterministic sort by name/position/knowledge/ability", () => {
    const rows = [row({ playerId: "b", name: "B", knownPosition: "Z" }), row({ playerId: "a", name: "A", knownPosition: "A" })];
    expect(sortRows(rows, "name").map((r) => r.playerId)).toEqual([eid("a"), eid("b")]);
    expect(sortRows(rows, "position").map((r) => r.playerId)).toEqual([eid("a"), eid("b")]);
  });
  it("6. unknown ability sorts last, transparently", () => {
    const a = row({ playerId: "a", estimatedAbility: { min: 70, max: 80 } });
    const b = row({ playerId: "b", estimatedAbility: undefined });
    expect(sortRows([a, b], "ability").map((r) => r.playerId)).toEqual([eid("a"), eid("b")]);
    expect(sortRows([b, a], "ability").map((r) => r.playerId)).toEqual([eid("a"), eid("b")]);
  });
});

describe("recommendations", () => {
  it("13/14. deterministic ordering newest-first then name", () => {
    const old = report({ playerId: "old", playerName: "A", generatedAt: "2026-01-01" });
    const newR = report({ playerId: "new", playerName: "B", generatedAt: "2026-01-03" });
    expect(recommendationsOrdered([old, newR]).map((r) => r.playerId)).toEqual([eid("new"), eid("old")]);
  });
  it("15. never fabricates recommendation text", () => {
    const r = recommendationsOrdered([report({ recommendation: "Sensible target" })]);
    expect(r[0].recommendation).toBe("Sensible target");
  });
  it("16. empty recommendations", () => {
    expect(recommendationsOrdered([])).toEqual([]);
  });
  it("17. scout attribution is preserved", () => {
    const r = report({ scoutName: "Scout One" });
    expect(recommendationsOrdered([r])[0].scoutName).toBe("Scout One");
  });
  it("report age is a factual day count", () => {
    expect(reportAgeDays("2026-01-01", "2026-01-04")).toBe(3);
  });
});

describe("nav / role boundary", () => {
  it("18/20. the three Recruitment destinations are Manager workspaces in the Recruitment family", () => {
    for (const id of ["recruitment-overview", "player-database", "recommendations"] as const) {
      expect(MANAGER_WORKSPACES).toContain(id);
    }
    const recruitment = MANAGER_FAMILIES.find((family) => family.label === "Recruitment");
    expect(recruitment?.items).toEqual(
      expect.arrayContaining(["recruitment-overview", "player-database", "recommendations"]),
    );
    // Manager-only: no Owner/President ids leak into the family.
    expect(recruitment?.items.some((id) => id === "dashboard" || id === "finance" || id === "tenure")).toBe(false);
  });
});

describe("focuses (scouting assignments)", () => {
  const assignment = (over: Partial<{ status: string; startedAt: string; id: string; assignmentType: string }>) => ({
    id: "a1",
    status: "ACTIVE",
    startedAt: "2026-01-02",
    assignmentType: "PLAYER",
    ...over,
  });
  it("1/2/3. maps lifecycle, status, and target type from canonical fields", () => {
    expect(assignmentTypeLabel("PLAYER")).toBe("Player");
    expect(assignmentTypeLabel("REGION")).toBe("Region");
    expect(assignmentTypeLabel("BOGUS")).toBe("bogus");
    expect(assignmentStatusText("COMPLETED")).toBe("completed");
  });
  it("4. deterministic ordering: active first, then by start date desc", () => {
    const activeOld = assignment({ id: "active-old", status: "ACTIVE", startedAt: "2026-01-01" });
    const activeNew = assignment({ id: "active-new", status: "ACTIVE", startedAt: "2026-01-03" });
    const done = assignment({ id: "done", status: "COMPLETED", startedAt: "2025-12-01" });
    expect(orderAssignments([done, activeOld, activeNew]).map((a) => a.id)).toEqual([
      "active-new", "active-old", "done",
    ]);
    expect(activeAssignments([done, activeOld, activeNew]).map((a) => a.id)).toEqual([
      "active-old", "active-new",
    ]);
  });
  it("5. empty assignments", () => {
    expect(orderAssignments([])).toEqual([]);
    expect(activeAssignments([])).toEqual([]);
  });
  it("7. only canonical assignment types surface", () => {
    expect(SUPPORTED_ASSIGNMENT_TYPES).toEqual(
      expect.arrayContaining(["PLAYER", "CLUB", "COMPETITION", "REGION", "POSITION", "SHORTLIST"]),
    );
  });
  it("no hidden scouting weights in focus output", () => {
    const text = JSON.stringify(
      SUPPORTED_ASSIGNMENT_TYPES.map((t) => assignmentTypeLabel(t)).concat([assignmentStatusText("ACTIVE")]),
    );
    expect(text).not.toMatch(/wonder|potential|hidden|successRate|discoverability|weight/i);
  });
});

describe("shortlists", () => {
  it("1/2. maps and deterministically sorts shortlist entries", () => {
    const a = shortEntry({ playerName: "A", addedAt: "2026-01-02" });
    const b = shortEntry({ playerName: "B", addedAt: "2026-01-01" });
    expect(shortlistSortRows([b, a], "player").map((r) => r.playerName)).toEqual(["A", "B"]);
    expect(shortlistSortRows([a, b], "added").map((r) => r.playerName)).toEqual(["A", "B"]);
  });
  it("unknown ability sorts last transparently", () => {
    const known = shortEntry({ playerName: "Known", estimatedAbility: { min: 60, max: 70 } });
    const unknown = shortEntry({ playerName: "Unknown", estimatedAbility: undefined });
    const out = shortlistSortRows([unknown, known], "ability").map((r) => r.playerName);
    expect(out).toEqual(["Known", "Unknown"]);
  });
  it("7. no hidden CA/PA in shortlist output", () => {
    const text = JSON.stringify(shortlistSortRows([shortEntry({})], "player"));
    expect(text).not.toMatch(/potential|currentAbility|hidden|wage|value/i);
  });
  it("6. empty shortlist sorts empty", () => {
    expect(shortlistSortRows([], "player")).toEqual([]);
  });
});

describe("squad planner (derived view)", () => {
  it("9. groups canonical positions into lanes", () => {
    expect(positionGroupFor("GK")).toBe("goalkeepers");
    expect(positionGroupFor("CB")).toBe("defenders");
    expect(positionGroupFor("CM")).toBe("midfielders");
    expect(positionGroupFor("ST")).toBe("attackers");
    expect(positionGroupFor("NOTREAL")).toBe("other");
    expect(POSITION_LANES.map((l) => l.label)).toEqual(["Goalkeepers", "Defenders", "Midfielders", "Attackers"]);
  });
  it("10/14. classifies contract expiry vs the horizon", () => {
    expect(classifyHorizon({ contractExpiry: "2026-05-31" }, 0, "2026-06-01").state).toBe("CONTRACT_EXPIRES");
    expect(classifyHorizon({ contractExpiry: "2027-06-01" }, 365, "2026-01-01").state).toBe("CONTRACTED");
    expect(classifyHorizon({}, 365, "2026-01-01").state).toBe("NO_CONTRACT");
  });
  it("13. expiring contract is NOT described as a departure", () => {
    const text = classifyHorizon({ contractExpiry: "2026-05-31" }, 0, "2026-06-01").text;
    expect(text).toContain("Contract expires");
    expect(text).not.toMatch(/leaving|departed|out the door|release|sell/i);
  });
  it("17. no invented need severity anywhere in classification", () => {
    expect(classifyHorizon({ contractExpiry: "2026-05-31" }, 0, "2026-06-01").text).not.toMatch(/critical|weak|priority|must sign/i);
  });
  it("18. no hidden ability/development prediction in derived future state", () => {
    const text = JSON.stringify([
      classifyHorizon({ contractExpiry: "2026-05-31" }, 365, "2026-06-01").text,
      positionGroupFor("AM"),
    ]);
    expect(text).not.toMatch(/decline|potential|hiddenAbility|prediction|developmentRate/i);
  });
});

describe("targets", () => {
  it("19. targets carry no position mapping beyond canonical data (shortlist has none)", () => {
    // ShortlistEntry has no position field in the canonical read; we never infer one.
    const text = JSON.stringify(shortlistSortRows([shortEntry({})], "player"));
    expect(text).not.toMatch(/"position"/i);
  });
});