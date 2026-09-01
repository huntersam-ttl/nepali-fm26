import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  EventRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  cancelInfrastructureProject,
  createInfrastructureProject,
  createNepalSave,
  initializeClubEconomyForSave,
  advanceInfrastructureProjects,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "infrastructure-phase-a-"));
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

describe("infrastructure and institution building phase A", () => {
  it("keeps unfunded projects in financing and preserves shared-site rights", () => {
    const db = openGameDatabase(makeSave("infrastructure-lifecycle"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "infrastructure-lifecycle" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as {
      id: EntityId;
    };
    const project = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "TRAINING_GROUND",
      date: "2026-08-01",
      seed: "infrastructure-lifecycle",
      financing: { clubCash: 0.2 },
      siteRights: "SHARED",
    });
    advanceInfrastructureProjects(db, { date: "2026-10-01", seed: "infrastructure-lifecycle" });
    expect(
      new ClubEconomyRepository(db)
        .infrastructureProjects(club.id)
        .find((item) => item.id === project.id)?.status,
    ).toBe("FINANCING");
    db.close();
  });

  it("completes funded projects deterministically, updates facilities and records maintenance", () => {
    const first = openGameDatabase(makeSave("infrastructure-complete"));
    const second = openGameDatabase(makeSave("infrastructure-complete"));
    initializeClubEconomyForSave({
      db: first,
      worldDate: "2026-08-01",
      seed: "infrastructure-complete",
    });
    initializeClubEconomyForSave({
      db: second,
      worldDate: "2026-08-01",
      seed: "infrastructure-complete",
    });
    const club = first.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as {
      id: EntityId;
    };
    const a = createInfrastructureProject(first, {
      clubId: club.id,
      projectType: "MEDICAL_ROOM",
      date: "2026-08-01",
      seed: "infrastructure-complete",
    });
    const b = createInfrastructureProject(second, {
      clubId: club.id,
      projectType: "MEDICAL_ROOM",
      date: "2026-08-01",
      seed: "infrastructure-complete",
    });
    expect({ cost: a.capitalCost, completion: a.expectedCompletion }).toEqual({
      cost: b.capitalCost,
      completion: b.expectedCompletion,
    });
    advanceInfrastructureProjects(first, { date: "2027-12-01", seed: "infrastructure-complete" });
    const economy = new ClubEconomyRepository(first);
    expect(economy.infrastructureProjects(club.id).find((item) => item.id === a.id)?.status).toBe(
      "COMPLETED",
    );
    expect(economy.assets(club.id).some((asset) => asset.assetType === "EQUIPMENT")).toBe(true);
    expect(economy.ledgerEntries(club.id).some((entry) => entry.category === "FACILITY_COST")).toBe(
      true,
    );
    expect(
      new EventRepository(first)
        .historicalEvents()
        .filter((item) => item.eventType === "FACILITY_PROJECT_COMPLETED"),
    ).toHaveLength(1);
    first.close();
    second.close();
  });

  it("enforces component prerequisites, supports debt funding, and records sunk cancellation cost", () => {
    const db = openGameDatabase(makeSave("infrastructure-finance"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "infrastructure-finance" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as {
      id: EntityId;
    };
    expect(() =>
      createInfrastructureProject(db, {
        clubId: club.id,
        projectType: "RECOVERY_CENTRE",
        date: "2026-08-01",
        seed: "infrastructure-finance",
      }),
    ).toThrow("requires completed TRAINING_GROUND");
    const project = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "TRAINING_GROUND",
      date: "2026-08-01",
      seed: "infrastructure-finance",
      financing: { debt: 5200000 },
    });
    expect(
      new ClubEconomyRepository(db).debts(club.id).some((debt) => debt.principal === 5200000),
    ).toBe(true);
    advanceInfrastructureProjects(db, { date: "2026-09-01", seed: "infrastructure-finance" });
    const cancelled = cancelInfrastructureProject(db, project.id, "2026-09-15");
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.sunkCost).toBeGreaterThan(0);
    db.close();
  });
});
