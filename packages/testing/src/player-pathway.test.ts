import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FederationGovernanceRepository, openGameDatabase } from "@nepal-football-sim/database";
import { buildPlayerPathway, createNepalSave, initializeFederationGovernanceForSave, processFederationMonth } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "player-pathway-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: seed,
    gameVersion: "test",
    randomSeed: seed,
  });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("player national pathway", () => {
  it("returns undefined honestly for a player with no call-up history, never a placeholder", () => {
    const db = openGameDatabase(makeSave("pathway-none"));
    const player = db.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get() as { id: EntityId };
    expect(buildPlayerPathway(db, player.id, "MANAGER")).toBeUndefined();
    db.close();
  });

  it("builds a real stage timeline from actual call-up/appearance history, with Women & Girls kept as its own distinct sequence", () => {
    const db = openGameDatabase(makeSave("pathway-real"));
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "pathway" });
    processFederationMonth(db, { date: "2026-11-28", seed: "pathway" });
    const callups = new FederationGovernanceRepository(db).nationalTeamCallups();
    expect(callups.length).toBeGreaterThan(0);
    const playerId = callups[0]!.playerId;
    const pathway = buildPlayerPathway(db, playerId, "MANAGER");
    expect(pathway).toBeDefined();
    expect(pathway!.playerId).toBe(playerId);
    expect(pathway!.stages.length).toBeGreaterThan(0);
    for (const stage of pathway!.stages) {
      expect(["SENIOR_MENS", "YOUTH", "WOMENS_GIRLS"]).toContain(stage.programme);
      expect(stage.programme === "WOMENS_GIRLS").toBe(stage.gender === "women");
      expect(stage.team.visible).toBe(true);
    }
    expect(pathway!.provenanceStatus).toBe("SIMULATION_ONLY");
    db.close();
  });

  it("is deterministic for the same real save state", () => {
    const first = openGameDatabase(makeSave("pathway-det"));
    const second = openGameDatabase(makeSave("pathway-det"));
    initializeFederationGovernanceForSave({ db: first, worldDate: "2026-08-01", seed: "pathway-det" });
    initializeFederationGovernanceForSave({ db: second, worldDate: "2026-08-01", seed: "pathway-det" });
    processFederationMonth(first, { date: "2026-11-28", seed: "pathway-det" });
    processFederationMonth(second, { date: "2026-11-28", seed: "pathway-det" });
    const playerId = new FederationGovernanceRepository(first).nationalTeamCallups()[0]!.playerId;
    const a = buildPlayerPathway(first, playerId, "MANAGER");
    const b = buildPlayerPathway(second, playerId, "MANAGER");
    expect(a?.stages.map((s) => s.team.id)).toEqual(b?.stages.map((s) => s.team.id));
    first.close();
    second.close();
  });
});
