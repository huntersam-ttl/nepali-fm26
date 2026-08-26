import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StaffMarketRepository, WorldRepository, loadSave, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, ensureAiStaffAssigned } from "@nepal-football-sim/simulation";
import { validateNepalWorldDataset, validateNepalWorldReferences, personnelCoverageReport } from "@nepal-football-sim/data-import";
import type { EntityId } from "@nepal-football-sim/shared-types";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "personnel-nt-staff-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("Nepal personnel database phase A — verified national-team head coaches", () => {
  it("has zero reference issues and reports the two verified national-team head coaches with REPORTED provenance", () => {
    const dataset = validateNepalWorldDataset(JSON.parse(readFileSync(registryPath, "utf8")) as unknown);
    expect(validateNepalWorldReferences(dataset)).toEqual([]);

    const arena = dataset.persons.find((p) => p.fullName === "Guglielmo Arena");
    const neupane = dataset.persons.find((p) => p.fullName === "Nabin Neupane");
    expect(arena).toBeDefined();
    expect(neupane).toBeDefined();
    expect(arena!.dateOfBirth.status).toBe("UNKNOWN"); // unverified fact stays UNKNOWN, never invented
    expect(arena!.provenance.status).toBe("REPORTED");
    expect(neupane!.provenance.status).toBe("REPORTED");

    const report = personnelCoverageReport(dataset);
    expect(report.totalRealStaff).toBeGreaterThanOrEqual(2);
    expect(report.nationalTeams).toBeGreaterThanOrEqual(2);
    expect(report.women).toBeGreaterThanOrEqual(1);
  });

  it("imports real national-team staff as ACTIVE staff-market appointments, preserving UNKNOWN factual fields", () => {
    const path = makeSave("personnel-nt-import");
    const db = openGameDatabase(path);
    const world = new WorldRepository(db);
    const market = new StaffMarketRepository(db);

    const arenaId = (db.prepare("SELECT id FROM persons WHERE full_name = ?").get("Guglielmo Arena") as { id: EntityId }).id;
    const neupaneId = (db.prepare("SELECT id FROM persons WHERE full_name = ?").get("Nabin Neupane") as { id: EntityId }).id;

    const arenaAppointment = market.activeAppointment(arenaId);
    const neupaneAppointment = market.activeAppointment(neupaneId);
    expect(arenaAppointment?.role).toBe("NATIONAL_TEAM_HEAD_COACH");
    expect(arenaAppointment?.employmentStatus).toBe("ACTIVE");
    expect(arenaAppointment?.organisationType).toBe("NATIONAL_TEAM");
    expect(neupaneAppointment?.role).toBe("NATIONAL_TEAM_HEAD_COACH");
    expect(neupaneAppointment?.employmentStatus).toBe("ACTIVE");

    const arenaPerson = world.getPerson(arenaId);
    expect(arenaPerson.dateOfBirth).toBeUndefined(); // UNKNOWN fact must not become a fabricated date
    db.close();
  });

  it("does not let generated SIMULATION_ONLY staff overwrite or duplicate the real national-team appointments", () => {
    const path = makeSave("personnel-nt-no-overwrite");
    const db = openGameDatabase(path);
    const market = new StaffMarketRepository(db);
    const arenaId = (db.prepare("SELECT id FROM persons WHERE full_name = ?").get("Guglielmo Arena") as { id: EntityId }).id;

    // The normal AI staffing tick must not disturb a real, already-employed appointment.
    const save = loadSave(db);
    expect(() => ensureAiStaffAssigned(db, save, undefined)).not.toThrow();
    const stillReal = market.activeAppointment(arenaId);
    expect(stillReal?.role).toBe("NATIONAL_TEAM_HEAD_COACH");

    const realPersonIds = new Set(
      (db.prepare("SELECT id FROM persons WHERE full_name IN (?, ?)").all("Guglielmo Arena", "Nabin Neupane") as Array<{ id: EntityId }>).map(
        (row) => row.id,
      ),
    );
    expect(realPersonIds.size).toBe(2);
    db.close();
  });

  it("persists the imported national-team staff appointments across save/load", () => {
    const path = makeSave("personnel-nt-persist");
    let db = openGameDatabase(path);
    db.close();

    db = openGameDatabase(path);
    const market = new StaffMarketRepository(db);
    const arenaId = (db.prepare("SELECT id FROM persons WHERE full_name = ?").get("Guglielmo Arena") as { id: EntityId }).id;
    expect(market.activeAppointment(arenaId)?.role).toBe("NATIONAL_TEAM_HEAD_COACH");
    db.close();
  });
});
