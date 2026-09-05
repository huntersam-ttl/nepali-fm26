import { describe, expect, it } from "vitest";
import type { ClubCampusProject, ClubFacilitySnapshot } from "@nepal-football-sim/shared-types";
import type { EntityId, InfrastructureProject } from "@nepal-football-sim/shared-types";
import { campusBlockDescriptors, projectProgressPercent, projectStatusLabel } from "./clubWorldPresentation.js";

const snapshot: ClubFacilitySnapshot = {
  trainingFacilityQuality: 14,
  youthFacilityQuality: 3,
  medicalFacilityQuality: 0,
  analyticsFacilityQuality: 8,
  academyCapacity: 20,
};

const project = (overrides: Partial<ClubCampusProject>): ClubCampusProject => ({
  id: "project-1" as EntityId,
  reference: {
    entityType: "INFRASTRUCTURE_PROJECT",
    id: "project-1" as EntityId,
    label: "New academy pitches",
    visible: true,
    destination: "INFRASTRUCTURE_PROJECT_PROFILE",
    allowedActions: [],
    provenanceStatus: "SIMULATION_ONLY",
  },
  projectType: "ACADEMY",
  status: "CONSTRUCTION",
  ...overrides,
});

describe("campusBlockDescriptors", () => {
  it("labels each block from real facility-quality data, never a fixed decorative set", () => {
    const blocks = campusBlockDescriptors(snapshot, []);
    const training = blocks.find((b) => b.key === "training")!;
    const academy = blocks.find((b) => b.key === "academy")!;
    const medical = blocks.find((b) => b.key === "medical")!;
    expect(training.qualityLabel).toBe("Strong");
    expect(academy.qualityLabel).toBe("Basic");
    expect(medical.qualityLabel).toBe("Undeveloped");
    expect(medical.tone).toBe("bad");
  });

  it("shows an honest 'no data' status for blocks with no quality field and no active project", () => {
    const blocks = campusBlockDescriptors(undefined, []);
    const stadium = blocks.find((b) => b.key === "stadium")!;
    expect(stadium.statusLabel).toMatch(/no data/i);
  });

  it("attaches the active project to its real campus block and marks the block as in-progress", () => {
    const blocks = campusBlockDescriptors(snapshot, [project({ status: "CONSTRUCTION" })]);
    const academy = blocks.find((b) => b.key === "academy")!;
    expect(academy.activeProject?.projectType).toBe("ACADEMY");
    expect(academy.statusLabel).toBe("Under construction");
    expect(academy.tone).toBe("warn");
  });

  it("prefers the more advanced of two projects targeting the same block", () => {
    const blocks = campusBlockDescriptors(snapshot, [
      project({ id: "p1" as EntityId, status: "PLANNING" }),
      project({ id: "p2" as EntityId, status: "CONSTRUCTION" }),
    ]);
    const academy = blocks.find((b) => b.key === "academy")!;
    expect(academy.activeProject?.id).toBe("p2");
  });
});

describe("projectStatusLabel", () => {
  it("never renders a raw enum for any known status", () => {
    for (const status of ["IDEA", "PLANNING", "APPROVED", "FINANCING", "CONSTRUCTION", "COMPLETED", "CANCELLED"]) {
      expect(projectStatusLabel(status)).not.toMatch(/^[A-Z_]+$/);
    }
  });
});

const baseProject: InfrastructureProject = {
  id: "p1" as EntityId,
  clubId: "club-1" as EntityId,
  projectType: "ACADEMY",
  planningStart: "2026-01-01",
  constructionStart: "2026-02-01",
  expectedCompletion: "2026-06-01",
  capitalCost: 1_000_000,
  ongoingCost: 10_000,
  currency: "NPR",
  status: "CONSTRUCTION",
  financingJson: {},
  provenanceStatus: "SIMULATION_ONLY",
};

describe("projectProgressPercent", () => {
  it("is 100 for completed and 0 for cancelled/idea, never negative or over 100", () => {
    expect(projectProgressPercent({ ...baseProject, status: "COMPLETED" }, "2026-06-01")).toBe(100);
    expect(projectProgressPercent({ ...baseProject, status: "CANCELLED" }, "2026-06-01")).toBe(0);
    expect(projectProgressPercent({ ...baseProject, status: "IDEA" }, "2026-06-01")).toBe(0);
  });

  it("interpolates construction progress from real start/end dates, not a fabricated animation", () => {
    const midway = projectProgressPercent(baseProject, "2026-04-02");
    const early = projectProgressPercent(baseProject, "2026-02-05");
    const late = projectProgressPercent(baseProject, "2026-05-30");
    expect(early).toBeLessThan(midway);
    expect(midway).toBeLessThan(late);
    expect(late).toBeLessThanOrEqual(95);
    expect(early).toBeGreaterThanOrEqual(25);
  });

  it("gives pre-construction stages a low but distinct band", () => {
    const planning = projectProgressPercent({ ...baseProject, status: "PLANNING" }, "2026-01-15");
    const financing = projectProgressPercent({ ...baseProject, status: "FINANCING" }, "2026-01-15");
    expect(planning).toBeLessThan(financing);
    expect(financing).toBeLessThan(25);
  });
});
