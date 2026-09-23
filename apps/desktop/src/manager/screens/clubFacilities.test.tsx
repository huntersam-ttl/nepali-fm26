// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ClubCampusProject, ClubProfile, EntityId, InfrastructureStoryEntry } from "@nepal-football-sim/shared-types";

const eid = (value: string): EntityId => value as unknown as EntityId;
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const campusProject = (id: string, projectType: string, status: string, expectedCompletion: string): ClubCampusProject => ({
  id: eid(id),
  reference: { id: eid(id), entityType: "INFRASTRUCTURE_PROJECT", label: projectType.replaceAll("_", " ").toLowerCase(), visible: true, allowedActions: [], provenanceStatus: "SIMULATION_ONLY", destination: "DESTINATION" as never },
  projectType,
  status,
  expectedCompletion,
});

const historyEntry = (headline: string, occurredOn: string): InfrastructureStoryEntry => ({
  headline,
  occurredOn,
  tone: "ok",
  entities: [],
});

export const club: ClubProfile = ({
  entityReference: { id: eid("club-1"), label: "Kathmandu United", type: "CLUB", visible: true, destination: "DESTINATION" as never },
  owner: { id: eid("owner-1"), label: "Rajendra Shrestha", type: "PERSON", visible: true, destination: "DESTINATION" as never },
  recentFixtures: [],
  squad: [],
  activeSponsors: [],
  stadium: {
    venueId: eid("v1"),
    name: "Dasharath Rangasala",
    capacity: 15000,
    surfaceType: "grass",
    pitchQuality: "good",
    floodlights: true,
    coveredStands: false,
    yearOpened: 1956,
    confirmedHomeGround: true,
  },
  facilitySnapshot: {
    trainingFacilityQuality: 3,
    youthFacilityQuality: 2,
    medicalFacilityQuality: 4,
    analyticsFacilityQuality: 2,
    academyCapacity: 40,
  },
  campusProjects: [
    campusProject("p1", "STADIUM", "CONSTRUCTION", "2026-06-01"),
    campusProject("p2", "MEDICAL_ROOM", "PLANNING", "2027-01-01"),
  ],
  infrastructureProjects: [],
  infrastructureHistory: [historyEntry("Stadium refurbishment completed", "2025-05-01")],
}) as unknown as ClubProfile;

export const clubWithoutFacilities: ClubProfile = ({
  ...club,
  stadium: undefined,
  facilitySnapshot: undefined,
  campusProjects: [],
  infrastructureHistory: [],
}) as unknown as ClubProfile;

vi.mock("../managerBridge.js", () => ({
  managerBridge: {
    getClubProfile: vi.fn(() => ok(club)),
  },
}));

let facilities: typeof import("./ClubFacilitiesScreen.js");
let projects: typeof import("./ClubProjectsScreen.js");

beforeAll(async () => {
  facilities = await import("./ClubFacilitiesScreen.js");
  projects = await import("./ClubProjectsScreen.js");
});

describe("Club Facilities", () => {
  it("1. maps canonical facility categories and levels", () => {
    const categories = facilities.FACILITY_CATEGORIES.map((c) => c.label);
    expect(categories).toEqual(["Training", "Academy / Youth", "Medical / Performance", "Analysis"]);
    expect(facilities.levelLabel(3)).toBe("Level 3");
    expect(facilities.levelLabel(0)).toBeNull();
    expect(facilities.levelLabel(undefined)).toBeNull();
  });

  it("2. exposes only the canonical category set (no offices/retail standing facilities)", () => {
    const categories = facilities.FACILITY_CATEGORIES.map((c) => c.label);
    expect(categories).not.toContain("Offices / Admin");
    expect(categories).not.toContain("Retail");
    expect(categories).not.toContain("Stadium"); // stadium is the hero, not a snapshot row
  });

  it("3. maps podium-level exactness without invented labels", () => {
    expect(facilities.levelLabel(4)).toBe("Level 4");
    expect(facilities.levelLabel(1)).toBe("Level 1");
  });

  it("4. does not fabricate a category for non-facility project types", () => {
    expect(facilities.projectTypeCategoryLabel("OFFICE")).toBeUndefined();
    expect(facilities.projectTypeCategoryLabel("RETAIL_STORE")).toBeUndefined();
    expect(facilities.projectTypeCategoryLabel("SCOUTING_DEPARTMENT")).toBeUndefined();
    expect(facilities.projectTypeCategoryLabel("STADIUM")).toBe("stadium");
  });

  it("6. stadium name/capacity come only from real state", () => {
    const stadium = facilities.stadiumRef(club);
    expect(stadium?.name).toBe("Dasharath Rangasala");
    expect(stadium?.capacity).toBe(15000);
    expect(facilities.stadiumRef(undefined)).toBeUndefined();
  });

  it("19. maps active projects onto their facility category", () => {
    const map = facilities.facilityProjectsByCategory(club.campusProjects);
    expect(map.stadium.map((p) => p.projectType)).toEqual(["STADIUM"]);
    expect(map.medical.map((p) => p.projectType)).toEqual(["MEDICAL_ROOM"]);
    expect(map.training ?? []).toEqual([]);
  });

  it("5. renders an honest empty state when no facility data exists", async () => {
    const bridge = (await import("../managerBridge.js")).managerBridge;
    (bridge.getClubProfile as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(clubWithoutFacilities));
    render(<facilities.ClubFacilitiesScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findAllByText(/no stadium relation/i);
    expect(document.body.textContent).toMatch(/no facility data/i);
    (bridge.getClubProfile as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(club));
  });

  it("8. offers no Owner-only facility controls", async () => {
    render(<facilities.ClubFacilitiesScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findAllByText(/supporting facilities/i);
    const buttons = Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").toLowerCase());
    expect(buttons.some((t) => /approve|fund|propose|start construction/i.test(t))).toBe(false);
  });

  it("9. never surfaces hidden multipliers or effect percentages", async () => {
    render(<facilities.ClubFacilitiesScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findAllByText(/supporting facilities/i);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/\+?\d+(\.\d+)?\s*%/);
    expect(page).not.toMatch(/multiplier/i);
  });
});
describe("Infrastructure Projects", () => {
  it("10. maps canonical active projects from the campus list", () => {
    const active = projects.activeProjects(club);
    expect(active.map((p) => p.projectType)).toEqual(["STADIUM", "MEDICAL_ROOM"]);
    expect(projects.activeProjects(undefined)).toEqual([]);
  });

  it("11. maps the canonical lifecycle statuses", () => {
    expect(projects.humanizeProjectStatus("CONSTRUCTION")).toBe("construction");
    expect(projects.humanizeProjectStatus("PLANNING")).toBe("planning");
    expect(projects.humanizeProjectType("MEDICAL_ROOM")).toBe("medical room");
  });

  it("12. preserves deterministic project ordering (expected-completion order)", () => {
    const active = projects.activeProjects(club);
    expect(active[0]!.id).toBe(eid("p1")); // earlier expected completion first
    expect(active[1]!.id).toBe(eid("p2"));
  });

  it("14. never invents a progress percentage from non-numeric state", async () => {
    render(<projects.ClubProjectsScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findAllByText(/active projects/i);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/\d+\s*%\s*(complete|progress)/i);
    expect(page).not.toContain("progress");
  });

  it("15. shows each project's canonical approval/status", async () => {
    render(<projects.ClubProjectsScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findByText(/construction/i);
    expect(document.body.textContent).toMatch(/construction/i);
    expect(document.body.textContent).toMatch(/planning/i);
  });

  it("18. completed history comes only from canonical story records", () => {
    const history = projects.historyEntries(club);
    expect(history.map((h) => h.headline)).toEqual(["Stadium refurbishment completed"]);
    expect(projects.historyEntries(clubWithoutFacilities)).toEqual([]);
  });
});

describe("Integration", () => {
  it("20. project rows link to the canonical Infrastructure Project destination", async () => {
    render(<projects.ClubProjectsScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findByText(/construction/i); // wait for the table rows to render
    expect(document.querySelectorAll("table button.link").length).toBeGreaterThan(0);
  });

  it("17. Manager has no project authoring controls", async () => {
    render(<projects.ClubProjectsScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findAllByText(/active projects/i);
    const buttons = Array.from(document.querySelectorAll("button")).filter((b) => (b.textContent ?? "").trim());
    expect(buttons.filter((b) => /approve|fund|propose|cancel|start/i.test(b.textContent ?? "")).length).toBe(0);
  });

  it("23. projects list does not duplicate per-project finance figures", async () => {
    render(<projects.ClubProjectsScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findByText(/construction/i);
    const page = document.body.textContent ?? "";
    expect(page).not.toContain("capital cost");
    expect(page).not.toMatch(/NPR [\d,]+/);
  });
});
afterEach(() => cleanup());