import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import {
  advanceInfrastructureProjects,
  createInfrastructureProject,
  createNepalSave,
  initializeClubEconomyForSave,
  latestInfrastructureUpdate,
  recentInfrastructureHistory,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "infra-story-read-"));
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

describe("infrastructure story read models", () => {
  it("returns undefined for the Owner Home card when the club has no infrastructure history yet", () => {
    const db = openGameDatabase(makeSave("story-none"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "story-none" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    expect(latestInfrastructureUpdate(db, club.id, "CHAIRMAN_OWNER")).toBeUndefined();
    expect(recentInfrastructureHistory(db, club.id, "CHAIRMAN_OWNER")).toHaveLength(0);
    db.close();
  });

  it("surfaces the most recent real event with clickable club/project entities, never a generic placeholder", () => {
    const db = openGameDatabase(makeSave("story-latest"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "story-latest" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    const project = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "TRAINING_GROUND",
      date: "2026-08-01",
      seed: "story-latest",
    });
    advanceInfrastructureProjects(db, { date: "2026-09-05", seed: "story-latest" });
    const latest = latestInfrastructureUpdate(db, club.id, "CHAIRMAN_OWNER");
    expect(latest).toBeDefined();
    expect(latest!.headline).not.toBe("Project updated.");
    expect(latest!.headline.toLowerCase()).toContain("construction");
    const clubRef = latest!.entities.find((entity) => entity.entityType === "CLUB");
    const projectRef = latest!.entities.find((entity) => entity.entityType === "INFRASTRUCTURE_PROJECT");
    expect(clubRef?.id).toBe(club.id);
    expect(clubRef?.visible).toBe(true);
    expect(projectRef?.id).toBe(project.id);
    expect(projectRef?.visible).toBe(true);

    advanceInfrastructureProjects(db, { date: "2027-06-01", seed: "story-latest" });
    const history = recentInfrastructureHistory(db, club.id, "CHAIRMAN_OWNER");
    expect(history.length).toBeGreaterThanOrEqual(2);
    // Most recent first.
    expect(history[0]!.occurredOn >= history[1]!.occurredOn).toBe(true);
    db.close();
  });
});
