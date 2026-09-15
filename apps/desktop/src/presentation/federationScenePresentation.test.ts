import { describe, expect, it } from "vitest";
import type {
  EntityId,
  FederationPresidentDashboard,
  FederationProject,
  FederationSimulationProfile,
} from "@nepal-football-sim/shared-types";
import { buildFederationSceneProfile, federationTierForScore } from "./federationScenePresentation.js";

const eid = (value: string): EntityId => value as unknown as EntityId;

const profileWith = (overrides: Partial<FederationSimulationProfile>): FederationSimulationProfile => ({
  federationId: eid("fed-1"),
  countryId: eid("country-1"),
  reputation: 0,
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

describe("federation tier bands (0-100 scale, distinct from a club's 0-20 facility scale)", () => {
  it("treats missing/zero score as undeveloped", () => {
    expect(federationTierForScore(undefined)).toBe("UNDEVELOPED");
    expect(federationTierForScore(0)).toBe("UNDEVELOPED");
  });

  it("maps the real 0-100 scale across the bands", () => {
    expect(federationTierForScore(10)).toBe("BASIC");
    expect(federationTierForScore(25)).toBe("MODEST");
    expect(federationTierForScore(45)).toBe("PROFESSIONAL");
    expect(federationTierForScore(65)).toBe("ADVANCED");
    expect(federationTierForScore(85)).toBe("ELITE");
  });
});

describe("federation scene profile — state driven", () => {
  it("gives a federation with no recorded development an undeveloped HQ and national centre", () => {
    const scene = buildFederationSceneProfile(dashboardWith());
    expect(scene.hq.tier).toBe("UNDEVELOPED");
    expect(scene.nationalCentre.tier).toBe("UNDEVELOPED");
    expect(scene.nationalCentrePitchCount).toBe(0);
    expect(scene.refereeDevelopmentPresent).toBe(false);
    expect(scene.womensProgrammePresent).toBe(false);
  });

  it("scales HQ from institutional strength and the national centre from football-development strength — two genuinely different inputs", () => {
    const strongHq = buildFederationSceneProfile(
      dashboardWith({
        profile: profileWith({ governanceStability: 90, commercialStrength: 85, infrastructureLevel: 80, youthDevelopment: 0, coachEducation: 0 }),
      }),
    );
    expect(strongHq.hq.tier).toBe("ELITE");
    // infrastructureLevel alone (youth/coach both 0) averages to ~27 -> MODEST, well below the HQ's own ELITE band.
    expect(strongHq.nationalCentre.tier).toBe("MODEST");

    const strongCentre = buildFederationSceneProfile(
      dashboardWith({
        profile: profileWith({ youthDevelopment: 90, coachEducation: 85, infrastructureLevel: 80, governanceStability: 0, commercialStrength: 0 }),
      }),
    );
    expect(strongCentre.nationalCentre.tier).toBe("ELITE");
    expect(strongCentre.hq.tier).not.toBe("ELITE");
  });

  it("shows a real in-progress national-centre project as construction on the national centre block", () => {
    const scene = buildFederationSceneProfile(
      dashboardWith({ projects: [projectOf("NATIONAL_TRAINING_CENTRE", "CONSTRUCTION")] }),
    );
    expect(scene.nationalCentre.underConstruction).toBe(true);
    expect(scene.nationalCentre.planned).toBe(false);
    expect(scene.hq.underConstruction).toBe(false);
    expect(scene.summary.join(" ")).toContain("under construction");
  });

  it("shows a merely planned HQ-side project as planned, not under construction", () => {
    const scene = buildFederationSceneProfile(dashboardWith({ projects: [projectOf("GRASSROOTS_PROGRAMME", "PLANNING")] }));
    expect(scene.hq.planned).toBe(true);
    expect(scene.hq.underConstruction).toBe(false);
  });

  it("shows the referee-development marker only once the real score justifies it", () => {
    const below = buildFederationSceneProfile(dashboardWith({ profile: profileWith({ refereeDevelopment: 5 }) }));
    const above = buildFederationSceneProfile(dashboardWith({ profile: profileWith({ refereeDevelopment: 25 }) }));
    expect(below.refereeDevelopmentPresent).toBe(false);
    expect(above.refereeDevelopmentPresent).toBe(true);
  });

  it("shows the women's development marker only from a real WOMENS_DEVELOPMENT project, never from unrelated scores", () => {
    const withoutProject = buildFederationSceneProfile(dashboardWith({ profile: profileWith({ youthDevelopment: 90 }) }));
    const withProject = buildFederationSceneProfile(dashboardWith({ projects: [projectOf("WOMENS_DEVELOPMENT", "IDEA")] }));
    expect(withoutProject.womensProgrammePresent).toBe(false);
    expect(withProject.womensProgrammePresent).toBe(true);
  });

  it("is deterministic: the same federation always produces the identical seed and accent", () => {
    const first = buildFederationSceneProfile(dashboardWith());
    const second = buildFederationSceneProfile(dashboardWith());
    expect(second.seed).toBe(first.seed);
    expect(second.accentHue).toBe(first.accentHue);
  });

  it("has no canonical federation HQ location in current state, so geography stays honestly Unknown", () => {
    const scene = buildFederationSceneProfile(dashboardWith());
    expect(scene.geography).toBe("UNKNOWN");
  });

  it("states every fact the scene shows in text", () => {
    const scene = buildFederationSceneProfile(dashboardWith({ profile: profileWith({ reputation: 42 }) }));
    expect(scene.summary.join(" ")).toContain("42 of 100");
    expect(scene.summary.length).toBeGreaterThanOrEqual(6);
  });
});
