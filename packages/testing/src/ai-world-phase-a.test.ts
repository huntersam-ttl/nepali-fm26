import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, InsuranceRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { createNepalSave, initializeClubEconomyForSave, runClubAiSeasonPlanning } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "ai-world-phase-a-")); dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: seed, gameVersion: "test", randomSeed: seed });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("AI world and long-term decision-making phase A", () => {
  it("keeps annual club strategy deterministic across 10, 20 and 30 years and reloads", () => {
    const firstPath = makeSave("ai-continuity");
    const first = openGameDatabase(firstPath);
    const second = openGameDatabase(makeSave("ai-continuity"));
    initializeClubEconomyForSave({ db: first, worldDate: "2026-08-01", seed: "ai-continuity" });
    initializeClubEconomyForSave({ db: second, worldDate: "2026-08-01", seed: "ai-continuity" });
    for (const year of [2026, 2036, 2046]) {
      runClubAiSeasonPlanning(first, { date: `${year}-08-28`, seed: "ai-continuity" });
      runClubAiSeasonPlanning(second, { date: `${year}-08-28`, seed: "ai-continuity" });
    }
    const clubId = (first.prepare("SELECT id FROM clubs ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    const a = new ClubEconomyRepository(first).aiDecisions(clubId);
    const b = new ClubEconomyRepository(second).aiDecisions(clubId);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(a.every((decision) => decision.actions.length >= 5)).toBe(true);
    const identities = new ClubEconomyRepository(first).aiDecisions().map((decision) => decision.identity);
    expect(new Set(identities).size).toBeGreaterThan(1);
    expect(new ClubEconomyRepository(first).aiDecisions(clubId).map((decision) => decision.identity)).toEqual([a[0].identity, a[1].identity, a[2].identity]);
    const policies = new InsuranceRepository(first).policies(clubId);
    expect(policies).toHaveLength(3);
    expect(policies.map((policy) => policy.status)).toEqual(["EXPIRED", "EXPIRED", "ACTIVE"]);
    expect(first.prepare("SELECT COUNT(*) AS count FROM historical_events WHERE event_type IN ('INSURANCE_POLICY_ACTIVATED','INSURANCE_POLICY_RENEWED','INSURANCE_POLICY_EXPIRED')").get()).toEqual({ count: 5 });
    first.close(); second.close();
    const reloaded = openGameDatabase(firstPath);
    expect(new ClubEconomyRepository(reloaded).aiDecisions(clubId)).toHaveLength(3);
    reloaded.close();
  });
});
