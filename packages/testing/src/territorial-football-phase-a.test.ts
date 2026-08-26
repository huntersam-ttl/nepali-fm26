import { describe, expect, it } from "vitest";
import { migrateDatabase, openGameDatabase, TerritorialFootballRepository } from "@nepal-football-sim/database";
import { createDistrictDevelopmentProject, initializeNepalTerritorialStructure, updateDistrictDevelopment } from "@nepal-football-sim/simulation";

describe("Nepal territorial football phase A", () => {
  it("initialises all seven provinces and 77 districts deterministically", () => {
    const db = openGameDatabase(":memory:"); migrateDatabase(db);
    const first = initializeNepalTerritorialStructure(db, "2026-08-01");
    expect(first.provinces).toHaveLength(7); expect(first.districts).toHaveLength(77);
    expect(initializeNepalTerritorialStructure(db, "2026-08-01").districts.map((district) => district.id)).toEqual(first.districts.map((district) => district.id)); db.close();
  });

  it("keeps development bounded and records a project lifecycle state", () => {
    const db = openGameDatabase(":memory:"); migrateDatabase(db); const { districts } = initializeNepalTerritorialStructure(db, "2026-08-01"); const district = districts[0]!;
    const project = createDistrictDevelopmentProject(db, { districtId: district.id, provinceId: district.provinceId, projectType: "SCHOOL_COMPETITION", requestedBudget: 100000, districtContribution: 0, provinceContribution: 0, municipalityContribution: 0, federationContribution: 100000, durationMonths: 12, milestones: ["report"], conditions: ["audit"], createdOn: "2026-08-01" });
    expect(new TerritorialFootballRepository(db).project(project.id)?.status).toBe("PROPOSED"); const updated = updateDistrictDevelopment(db, { districtId: district.id, date: "2027-08-01", funding: 100000 }); expect(updated.developmentReputation).toBeGreaterThan(district.developmentReputation); expect(updated.developmentReputation).toBeLessThanOrEqual(100); db.close();
  });
});
