import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FederationGovernanceRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { createNepalSave, initializeClubEconomyForSave, initializeFederationGovernanceForSave, runFederationAiSeasonPlanning } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "ai-world-phase-c-")); dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: seed, gameVersion: "test", randomSeed: seed });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("AI world and long-term decision-making phase C", () => {
  it("keeps federation priorities deterministic across 20, 30 and 50 years and persists them", () => {
    const path = makeSave("federation-ai-continuity");
    const db = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "federation-ai-continuity" });
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "federation-ai-continuity" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    for (const year of [2026, 2046, 2056, 2076]) runFederationAiSeasonPlanning(db, { date: `${year}-08-28`, seed: "federation-ai-continuity" });
    const decisions = new FederationGovernanceRepository(db).aiDecisions(federationId);
    expect(decisions).toHaveLength(4);
    expect(decisions.every((decision) => decision.actions.length > 0)).toBe(true);
    expect(decisions[0].priorities.infrastructure).toBeGreaterThan(0);
    db.close();
    const reloaded = openGameDatabase(path);
    expect(new FederationGovernanceRepository(reloaded).aiDecisions(federationId)).toEqual(decisions);
    reloaded.close();
  });
});
