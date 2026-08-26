import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { playerCoverageReport, validateNepalWorldDataset, validateNepalWorldReferences } from "@nepal-football-sim/data-import";

describe("Nepal player database phase A", () => {
  it("reports the imported player pool without collapsing unknown facts", () => {
    const dataset = validateNepalWorldDataset(JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8")) as unknown);
    expect(validateNepalWorldReferences(dataset)).toEqual([]);
    const report = playerCoverageReport(dataset);
    expect(report.totalRealPlayers).toBeGreaterThan(500);
    expect(report.provenance.REPORTED ?? 0).toBeGreaterThan(0);
    expect(new Set(dataset.playerFactualProfiles.map((profile) => profile.playerKey)).size).toBe(dataset.playerFactualProfiles.length);
    expect(dataset.playerAttributes.every((attributes) => attributes.provenance.status === "SIMULATION_ONLY")).toBe(true);
  });
});
