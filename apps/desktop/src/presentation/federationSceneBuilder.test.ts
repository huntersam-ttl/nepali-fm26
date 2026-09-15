import { describe, expect, it } from "vitest";
import type { EntityId, FederationPresidentDashboard, FederationProject, FederationSimulationProfile } from "@nepal-football-sim/shared-types";
import { buildFederationSceneProfile } from "./federationScenePresentation.js";
import { buildFederationScene } from "./federationSceneBuilder.js";
import { qualitySettings } from "./scenePreferences.js";

const eid = (value: string): EntityId => value as unknown as EntityId;

const profileWith = (overrides: Partial<FederationSimulationProfile>): FederationSimulationProfile => ({
  federationId: eid("fed-1"),
  countryId: eid("country-1"),
  reputation: 60,
  financialHealth: "STABLE",
  grassrootsDevelopment: 0,
  youthDevelopment: 0,
  coachEducation: 0,
  refereeDevelopment: 0,
  competitionOrganisation: 0,
  commercialStrength: 0,
  internationalRelations: 0,
  governanceStability: 0,
  infrastructureLevel: 0,
  lastUpdatedAt: "2026-01-01",
  status: "SIMULATION_ONLY",
  ...overrides,
});

const projectOf = (projectType: FederationProject["projectType"], status: FederationProject["status"]): FederationProject => ({
  id: eid(`proj-${projectType}`),
  federationId: eid("fed-1"),
  projectType,
  name: "Test Project",
  startDate: "2026-01-01",
  expectedCompletion: "2027-01-01",
  capitalCost: 1_000_000,
  annualOperatingCost: 100_000,
  currency: "NPR",
  status,
  impactJson: {},
  fundingJson: {},
  provenanceStatus: "SIMULATION_ONLY",
});

const dashboardWith = (
  overrides: Partial<Pick<FederationPresidentDashboard, "profile" | "projects">> = {},
): FederationPresidentDashboard => ({
  role: "FEDERATION_PRESIDENT",
  federation: { id: eid("fed-1"), countryId: eid("country-1"), name: "Test Federation" },
  profile: profileWith({}),
  finances: {
    account: {
      federationId: eid("fed-1"),
      currency: "NPR",
      cashBalance: 0,
      restrictedFunds: 0,
      receivables: 0,
      payables: 0,
      debt: 0,
      seasonRevenue: 0,
      seasonExpenses: 0,
      seasonProfitLoss: 0,
      financialHealth: "STABLE",
    } as FederationPresidentDashboard["finances"]["account"],
    budgets: [],
    ledgerEntries: [],
    statements: [],
  },
  proposals: [],
  projects: [],
  nationalTeams: [],
  inbox: [],
  ...overrides,
});

const sceneFor = (motion: "FULL" | "REDUCED" | "OFF", overrides: Partial<Pick<FederationPresidentDashboard, "profile" | "projects">> = {}) =>
  buildFederationScene(buildFederationSceneProfile(dashboardWith(overrides)), qualitySettings("MEDIUM"), motion);

describe("federation scene animation contract", () => {
  it("moves the camera over time on Full", () => {
    const handle = sceneFor("FULL");
    handle.update(0);
    const start = handle.camera.position.clone();
    handle.update(6);
    expect(handle.camera.position.equals(start)).toBe(false);
    handle.dispose();
  });

  it("never sweeps the camera on Reduced", () => {
    const handle = sceneFor("REDUCED");
    handle.update(0);
    const start = handle.camera.position.clone();
    handle.update(6);
    handle.update(18);
    expect(handle.camera.position.equals(start)).toBe(true);
    handle.dispose();
  });

  it("does nothing at all on Off", () => {
    const handle = sceneFor("OFF");
    const start = handle.camera.position.clone();
    handle.update(6);
    expect(handle.camera.position.equals(start)).toBe(true);
    handle.dispose();
  });

  it("is deterministic: the same federation builds an identical camera and object count twice", () => {
    const a = sceneFor("FULL");
    const b = sceneFor("FULL");
    expect(b.camera.position.equals(a.camera.position)).toBe(true);
    expect(b.scene.children.length).toBe(a.scene.children.length);
    a.dispose();
    b.dispose();
  });
});

describe("federation camera presets", () => {
  it("frames a different, real position for each named preset", () => {
    const handle = sceneFor("REDUCED");
    const positions = (["OVERVIEW", "HQ", "NATIONAL_CENTRE"] as const).map((preset) => {
      handle.focus(preset);
      return handle.camera.position.clone();
    });
    const unique = new Set(positions.map((position) => `${position.x},${position.y},${position.z}`));
    expect(unique.size).toBe(positions.length);
    handle.dispose();
  });

  it("jumps instantly on Reduced motion", () => {
    const handle = sceneFor("REDUCED");
    const before = handle.camera.position.clone();
    handle.focus("HQ");
    const after = handle.camera.position.clone();
    expect(after.equals(before)).toBe(false);
    handle.update(1);
    expect(handle.camera.position.equals(after)).toBe(true);
    handle.dispose();
  });
});

describe("federation scene geometry follows real state", () => {
  const buildingObjectCount = (
    handle: { pickables: Array<{ object: { traverse: (fn: () => void) => void }; building: string }> },
    kind: "HQ" | "NATIONAL_CENTRE",
  ): number => {
    let count = 0;
    handle.pickables.find((entry) => entry.building === kind)!.object.traverse(() => {
      count += 1;
    });
    return count;
  };

  it("exposes exactly HQ and NATIONAL_CENTRE as pickables — a 3D click can only ever open a real block", () => {
    const handle = sceneFor("OFF");
    expect(handle.pickables.map((entry) => entry.building).sort()).toEqual(["HQ", "NATIONAL_CENTRE"]);
    handle.dispose();
  });

  it("gives a strong federation visibly more HQ geometry than an undeveloped one", () => {
    const weak = sceneFor("OFF");
    const strong = sceneFor("OFF", { profile: profileWith({ governanceStability: 85, commercialStrength: 80, infrastructureLevel: 75 }) });
    expect(buildingObjectCount(strong, "HQ")).toBeGreaterThan(buildingObjectCount(weak, "HQ"));
    weak.dispose();
    strong.dispose();
  });

  it("gives a real in-progress national-centre project visible construction geometry", () => {
    const idle = sceneFor("OFF");
    const building = sceneFor("OFF", { projects: [projectOf("NATIONAL_TRAINING_CENTRE", "CONSTRUCTION")] });
    expect(buildingObjectCount(building, "NATIONAL_CENTRE")).toBeGreaterThan(buildingObjectCount(idle, "NATIONAL_CENTRE"));
    idle.dispose();
    building.dispose();
  });

  it("adds a referee-development marker to the scene only once the real score justifies it", () => {
    const without = sceneFor("OFF");
    const withReferee = sceneFor("OFF", { profile: profileWith({ refereeDevelopment: 40 }) });
    expect(withReferee.scene.children.length).toBeGreaterThan(without.scene.children.length);
    without.dispose();
    withReferee.dispose();
  });

  it("releases its geometry on dispose rather than leaking it", () => {
    const handle = sceneFor("OFF");
    let disposed = 0;
    handle.scene.traverse((child) => {
      const mesh = child as { geometry?: { dispose: () => void } };
      if (mesh.geometry) {
        const original = mesh.geometry.dispose.bind(mesh.geometry);
        mesh.geometry.dispose = () => {
          disposed += 1;
          original();
        };
      }
    });
    handle.dispose();
    expect(disposed).toBeGreaterThan(0);
    expect(handle.scene.children.length).toBe(0);
  });
});
