// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CareerOverviewView, FederationPresidentDashboard } from "@nepal-football-sim/shared-types";

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const project = (over: Record<string, unknown>) => ({
  id: "p1",
  federationId: "f1",
  projectType: "GRASSROOTS_PROGRAMME",
  name: "Grassroots Push",
  startDate: "2026-08-01",
  expectedCompletion: "2027-08-01",
  capitalCost: 1_200_000,
  annualOperatingCost: 90_000,
  currency: "NPR",
  status: "IMPLEMENTATION",
  impactJson: { secretImpact: 0.93 },
  fundingJson: { federationCash: 0.7, restrictedGrant: 0.3 },
  fundingStatus: "PARTIALLY_FUNDED",
  delayDays: 0,
  provenanceStatus: "SIMULATION_ONLY",
  ...over,
});

const dashboardWith = (over: Record<string, unknown> = {}): FederationPresidentDashboard =>
  ({
    role: "FEDERATION_PRESIDENT",
    federation: { id: "f1", name: "All Nepal Football Association" },
    profile: { reputation: 71, governanceStability: 40 },
    finances: {
      account: { cashBalance: 15_000_000, restrictedFunds: 4_800_000, currency: "NPR", financialHealth: "STABLE" },
      budgets: [],
      ledgerEntries: [],
      statements: [],
    },
    tenure: { id: "t1", personId: "person", federationId: "f1", role: "FEDERATION_PRESIDENT", termStart: "2026-08-01", termEnd: "2030-01-01", status: "ACTIVE" },
    proposals: [],
    projects: [],
    nationalTeams: [],
    latestStory: undefined,
    ...over,
  }) as unknown as FederationPresidentDashboard;

const careerPresident = {
  personId: "person",
  name: "Maya Adhikari",
  activeRole: "FEDERATION_PRESIDENT",
  baseRole: "MANAGER",
  isTemporaryPresidentOffice: true,
  heldRoles: [
    { role: "MANAGER", organization: { label: "Church Boys United" } },
    { role: "FEDERATION_PRESIDENT", organization: { label: "All Nepal Football Association" } },
  ],
} as unknown as CareerOverviewView;

const bridge = { getCareerOverview: vi.fn(() => ok(careerPresident)) };

let overview: typeof import("./FederationOverviewScreen.js");
let projects: typeof import("./FederationProjectsScreen.js");

beforeAll(async () => {
  overview = await import("./FederationOverviewScreen.js");
  projects = await import("./FederationProjectsScreen.js");
});

afterEach(() => cleanup());

describe("Federation Overview (Phase 9A)", () => {
  it("derives attention items only from real proposal and project state", () => {
    const items = overview.attentionItems({
      proposals: [{ status: "APPROVED" }, { status: "COMMITTEE_REVIEW" }, { status: "REJECTED" }] as never,
      projects: [
        project({ id: "a", delayDays: 4 }),
        project({ id: "b", status: "COMPLETED", fundingStatus: "UNFUNDED", delayDays: 9 }),
        project({ id: "c", fundingStatus: "FUNDED" }),
      ] as never,
    });
    expect(items.map((item) => item.key)).toEqual(["approved", "review", "behind", "unfunded"]);
    expect(items.find((item) => item.key === "behind")?.text).toBe("1 programme running behind schedule");
    expect(items.find((item) => item.key === "unfunded")?.text).toBe("1 programme not yet fully funded");
    expect(overview.attentionItems({ proposals: [], projects: [] })).toEqual([]);
  });

  it("describes the base career the presidency layers on", () => {
    expect(overview.baseCareerLine(careerPresident)).toMatch(/base career as Manager at Church Boys United is preserved/i);
    expect(overview.baseCareerLine({ ...careerPresident, isTemporaryPresidentOffice: false } as CareerOverviewView)).toBe(
      "Base career: Manager at Church Boys United.",
    );
    expect(overview.baseCareerLine({ ...careerPresident, baseRole: undefined } as unknown as CareerOverviewView)).toMatch(
      /no base career/i,
    );
  });

  it("shows identity, term, the same person and the honest empty states", async () => {
    render(<overview.FederationOverviewScreen dashboard={dashboardWith()} bridge={bridge} onNavigate={() => {}} />);
    await screen.findByText(/same person across every role/i);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/All Nepal Football Association/);
    expect(body).toMatch(/2026-08-01 – 2030-01-01/);
    expect(body).toMatch(/Active/);
    expect(body).toMatch(/Maya Adhikari/);
    expect(body).toMatch(/Nothing currently needs a decision/i);
    expect(body).toMatch(/No national teams are recorded/i);
    expect(body).toMatch(/simulated/i);
  });

  it("flags an interim presidency and routes attention actions", async () => {
    const onNavigate = vi.fn();
    const dashboard = dashboardWith({
      tenure: { termStart: "2026-08-01", status: "INTERIM" },
      proposals: [{ status: "APPROVED" }],
    });
    render(<overview.FederationOverviewScreen dashboard={dashboard} bridge={bridge} onNavigate={onNavigate} />);
    await screen.findByText(/interim presidents cannot implement/i);
    fireEvent.click(screen.getByRole("button", { name: "Open Governance" }));
    expect(onNavigate).toHaveBeenCalledWith("governance");
  });

  it("lists national teams without inventing a coach", async () => {
    const dashboard = dashboardWith({
      nationalTeams: [{ id: "n1", name: "Nepal Senior Men", level: "SENIOR", gender: "MALE", headCoach: "", squadSize: 23 }],
    });
    render(<overview.FederationOverviewScreen dashboard={dashboard} bridge={bridge} onNavigate={() => {}} />);
    await screen.findByText("Nepal Senior Men");
    expect(document.body.textContent).toMatch(/None recorded/);
    expect(screen.getByRole("table", { name: "National teams" })).toBeTruthy();
  });

  it("never renders hidden simulation state", async () => {
    render(<overview.FederationOverviewScreen dashboard={dashboardWith()} bridge={bridge} onNavigate={() => {}} />);
    await screen.findByText(/same person across every role/i);
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/election|probability|coalition|influence|support base|voting|confidence|stability/i);
    expect(body).not.toMatch(/\b71\b|\b40\b/);
  });

  it("summarises real funds and links to Finance without becoming a finance page", async () => {
    const onNavigate = vi.fn();
    render(<overview.FederationOverviewScreen dashboard={dashboardWith()} bridge={bridge} onNavigate={onNavigate} />);
    await screen.findByText(/same person across every role/i);
    expect(document.body.textContent).toMatch(/NPR 15,000,000/);
    expect(document.body.textContent).toMatch(/NPR 4,800,000/);
    fireEvent.click(screen.getByRole("button", { name: "Open Finance" }));
    expect(onNavigate).toHaveBeenCalledWith("finance");
  });
});

describe("Federation Projects (Phase 9A)", () => {
  it("orders open programmes newest first and reports exact status", () => {
    const ordered = projects.sortedProjects([
      project({ id: "old", name: "Old", startDate: "2026-01-01" }),
      project({ id: "new", name: "New", startDate: "2026-09-01" }),
    ] as never);
    expect(ordered.map((entry) => entry.id)).toEqual(["new", "old"]);
    expect(projects.isOpenProject({ status: "IMPLEMENTATION" })).toBe(true);
    expect(projects.isOpenProject({ status: "COMPLETED" })).toBe(false);
    expect(projects.isOpenProject({ status: "CANCELLED" })).toBe(false);
    expect(projects.statusTone("COMPLETED")).toBe("ok");
    expect(projects.scheduleNote({ status: "IMPLEMENTATION", delayDays: 5 })).toBe("5 day(s) behind");
    expect(projects.scheduleNote({ status: "COMPLETED", delayDays: 5 })).toBe("—");
  });

  it("renders exact statuses and funding with no progress bar or funding split", () => {
    render(
      <projects.FederationProjectsScreen
        dashboard={dashboardWith({
          projects: [
            project({ id: "a", name: "Grassroots Push" }),
            project({ id: "b", name: "Referee Course", projectType: "REFEREE_PROGRAMME", status: "COMPLETED", completedAt: "2026-12-01", fundingStatus: "FUNDED" }),
          ],
        })}
      />,
    );
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Grassroots Push/);
    expect(body).toMatch(/Referee Course/);
    expect(body).toMatch(/Partially Funded/i);
    expect(body).toMatch(/2026-12-01/);
    expect(document.querySelector('[role="progressbar"], progress')).toBeNull();
    expect(body).not.toMatch(/%|impact|secretImpact|0\.93|federationCash|restrictedGrant/);
    expect(screen.getByRole("table", { name: "Federation programmes in progress" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Completed and cancelled federation programmes" })).toBeTruthy();
  });

  it("shows honest empty states", () => {
    render(<projects.FederationProjectsScreen dashboard={dashboardWith()} />);
    expect(screen.getByText(/No federation programmes are currently in progress/i)).toBeTruthy();
    expect(screen.getByText(/No programmes have been completed or cancelled yet/i)).toBeTruthy();
  });
});
