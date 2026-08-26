import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalisePersonnelRole, normalisePersonnelSourceRecords, personnelCoverageReport, validateNepalWorldDataset, validateNepalWorldReferences } from "@nepal-football-sim/data-import";

describe("Nepal personnel database phase A", () => {
  it("normalises roles and preserves a provenance-aware coverage report", () => {
    expect(normalisePersonnelRole("  Head_Coach ")).toBe("head coach");
    const dataset = validateNepalWorldDataset(JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8")) as unknown);
    expect(validateNepalWorldReferences(dataset)).toEqual([]);
    const report = personnelCoverageReport(dataset);
    expect(report.totalRealStaff).toBeGreaterThanOrEqual(0);
    expect(report.referees).toBe(0);
    expect(new Set(dataset.staffProfiles.map((profile) => profile.personKey)).size).toBe(dataset.staffProfiles.length);
    const normalised = normalisePersonnelSourceRecords([{ sourceId: "s1", sourceUrl: "https://example.com/source", fullName: "A. Coach", role: "Head_Coach", assignmentStatus: "UNKNOWN", provenanceStatus: "UNKNOWN" }, { sourceId: "s2", sourceUrl: "https://example.com/source-2", fullName: "A Coach", role: "assistant coach", assignmentStatus: "UNKNOWN", provenanceStatus: "UNKNOWN" }]);
    expect(normalised.records[0]?.role).toBe("head coach"); expect(normalised.duplicateCandidates).toEqual(["acoach"]);
  });
});
