// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type {
  ClubProfile,
  ClubResponsibilitiesView,
  EntityId,
  ManagerDashboard,
  TransferCentre,
} from "@nepal-football-sim/shared-types";

const eid = (value: string): EntityId => value as unknown as EntityId;
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const budget: TransferCentre = ({
  worldDate: "2025-08-10",
  budget: {
    seasonLabel: "2025",
    transferBudget: 40_000_000,
    transferSpent: 12_000_000,
    transferRemaining: 28_000_000,
    wageBudget: 90_000_000,
    committedWages: 81_000_000,
    wageRemaining: 9_000_000,
    currency: "NPR",
  },
  windowOpen: true,
  expiringContracts: [],
  outgoingOffers: [],
  incomingOffers: [],
  loans: [],
  shortlist: [],
  squad: [],
}) as unknown as TransferCentre;

const profile: ClubProfile = ({
  entityReference: { id: eid("club-1"), label: "Kathmandu United", type: "CLUB", visible: true, destination: "DESTINATION" as never },
  owner: { id: eid("owner-1"), label: "Rajendra Shrestha", type: "PERSON", visible: true, destination: "DESTINATION" as never },
  recentFixtures: [],
  squad: [],
  activeSponsors: [],
  infrastructureProjects: [],
  campusProjects: [],
  infrastructureHistory: [],
}) as unknown as ClubProfile;

const dashboard: ManagerDashboard = ({
  employmentStatus: "EMPLOYED",
  teamName: "Kathmandu United",
  competitionName: "Martyrs Memorial",
  worldDate: "2025-08-10",
  boardConfidence: 74,
  boardExpectation: "TITLE_CHALLENGE",
  played: 3,
  points: 4,
  form: [],
  recentResults: [],
  squadAvailability: { total: 0, available: 0, injured: 0, suspended: 0, unavailable: 0 },
  moraleSummary: "",
  trainingSummary: "",
  scoutingUpdates: 0,
  transferActivity: 0,
}) as unknown as ManagerDashboard;

const emptyDashboard: ManagerDashboard = { ...dashboard, boardConfidence: undefined, boardExpectation: undefined };

const responsibilities: ClubResponsibilitiesView = {
  rows: [
    {
      domain: "TRANSFERS",
      currentOwnerType: "STAFF",
      currentOwnerName: "Bikash Shrestha",
      assignees: [
        { ownerType: "MANAGER" },
        { ownerType: "BOARD" },
        { ownerType: "STAFF", appointmentId: eid("a1"), personName: "Bikash Shrestha", role: "SPORTING_DIRECTOR" },
      ],
    },
    {
      domain: "SCOUTING",
      currentOwnerType: "MANAGER",
      assignees: [
        { ownerType: "MANAGER" },
        { ownerType: "BOARD" },
        { ownerType: "STAFF", appointmentId: eid("a2"), personName: "Arjun Lama", role: "CHIEF_SCOUT" },
      ],
    },
    { domain: "CONTRACTS", currentOwnerType: "BOARD", assignees: [{ ownerType: "MANAGER" }, { ownerType: "BOARD" }] },
    { domain: "YOUTH", currentOwnerType: "MANAGER", assignees: [{ ownerType: "MANAGER" }, { ownerType: "BOARD" }] },
    { domain: "TRAINING", currentOwnerType: "STAFF", currentOwnerName: "Sunita Tamang", assignees: [{ ownerType: "MANAGER" }, { ownerType: "BOARD" }] },
    { domain: "MEDICAL", currentOwnerType: "MANAGER", assignees: [{ ownerType: "MANAGER" }, { ownerType: "BOARD" }] },
  ],
};

vi.mock("../managerBridge.js", () => ({
  managerBridge: {
    getTransferCentre: vi.fn(() => ok(budget)),
    getClubProfile: vi.fn(() => ok(profile)),
    getManagerDashboard: vi.fn(() => ok(dashboard)),
    getClubResponsibilities: vi.fn(() => ok(responsibilities)),
    requestManagerBudget: vi.fn(() => ok({ idle: true })),
    assignStaffResponsibility: vi.fn(() => ok(responsibilities)),
    requestStaffBoardApproval: vi.fn(() => ok(responsibilities)),
  },
}));

let finances: typeof import("./ClubFinancesScreen.js");
let board: typeof import("./ClubBoardScreen.js");
let responsibilitiesMod: typeof import("./ClubResponsibilitiesScreen.js");

beforeAll(async () => {
  finances = await import("./ClubFinancesScreen.js");
  board = await import("./ClubBoardScreen.js");
  responsibilitiesMod = await import("./ClubResponsibilitiesScreen.js");
});

describe("Club Finances", () => {
  it("1. maps the canonical TransferBudgetView allocation", () => {
    const centre = budget as TransferCentre;
    expect(finances.hasAllocation(centre.budget)).toBe(true);
    expect(centre.budget.transferBudget).toBe(40_000_000);
    expect(centre.budget.wageRemaining).toBe(9_000_000);
  });

  it("2. shows Manager-visible budget fields on render", async () => {
    render(<finances.ClubFinancesScreen />);
    await screen.findAllByText(/Transfer allocation/i);
    expect(screen.getByText(/Wage allocation/i)).toBeTruthy();
    expect(screen.getByText(/Request an increase/i)).toBeTruthy();
  });

  it("3. exposes no Owner-only controls and no actual institutional figures to the Manager", async () => {
    render(<finances.ClubFinancesScreen />);
    await screen.findAllByText(/Transfer allocation/i);
    const page = document.body.textContent ?? "";
    const lower = page.toLowerCase();
    // Manager has Request, never Edit/Set/Approve budget controls.
    expect(lower).toContain("request an increase");
    const buttons = Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").toLowerCase());
    expect(buttons.some((t) => /set budget|edit budget|approve budget/.test(t))).toBe(false);
    expect(buttons.some((t) => t.startsWith("request"))).toBe(true);
    // No actual Owner institutional figures surface (only a deferral note that
    // such values are Owner-facing). No balance amount or health grade.
    expect(page).not.toMatch(/cash balance[:\n][0-9]|club cash[:\n][0-9]|net profit[:\n][0-9]/i);
    expect(page).not.toMatch(/financial health[:\n](poor|constrained|healthy)/i);
  });

  it("6. treats an empty allocation truthfully", () => {
    const empty: TransferCentre = {
      ...budget,
      budget: {
        seasonLabel: "2025",
        transferBudget: 0,
        transferSpent: 0,
        transferRemaining: 0,
        wageBudget: 0,
        committedWages: 0,
        wageRemaining: 0,
        currency: "NPR",
      },
    };
    expect(finances.hasAllocation(empty.budget)).toBe(false);
    expect(finances.hasAllocation(undefined)).toBe(false);
  });

  it("5. never invents a financial-health score", async () => {
describe("Club Board", () => {
  it("7. maps canonical leadership from the club profile owner", () => {
    expect(board.leadershipRef(profile)?.label).toBe("Rajendra Shrestha");
    expect(board.leadershipRef(undefined)).toBeUndefined();
  });

  it("8. surfaces the canonical board objective / expectation", async () => {
    render(<board.ClubBoardScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findAllByText(/Board expects/i);
    expect(document.body.textContent?.toLowerCase()).toContain("title challenge");
  });

  it("9. shows Manager evaluation only when real board confidence exists", async () => {
    const bridge = (await import("../managerBridge.js")).managerBridge;
    const setDashboard = (bridge.getManagerDashboard as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue;
    setDashboard(ok(emptyDashboard));
    render(<board.ClubBoardScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findAllByText(/Board expects/i);
    expect(document.body.textContent).toContain("—");
    setDashboard(ok(dashboard));
  });

  it("10. does not invent objectives beyond the canonical expectation", async () => {
    render(<board.ClubBoardScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findAllByText(/Board expects/i);
    const page = document.body.textContent ?? "";
    expect(page.toLowerCase()).not.toContain("playing attacking football");
    expect(page.toLowerCase()).not.toContain("academy");
  });

  it("11. does not expose hidden board weights", async () => {
    render(<board.ClubBoardScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findAllByText(/Board expects/i);
    const page = document.body.textContent ?? "";
    expect(page.toLowerCase()).not.toContain("weight");
    expect(page.toLowerCase()).not.toContain("firing threshold");
    expect(page.toLowerCase()).not.toContain("pressure");
  });
});
    render(<finances.ClubFinancesScreen />);
    await screen.findAllByText(/Transfer allocation/i);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/health\s*score|financial health:\s*\d+/i);
    expect(page).not.toContain("financialHealth");
  });
});
describe("Club Responsibilities", () => {
  it("13. maps the canonical responsibility rows into grouped categories", () => {
    const groups = responsibilitiesMod.groupRows(responsibilities);
    const dom = groups.map((g) => g.category);
    expect(dom).toEqual(["Football", "Youth", "Medical"]);
    const football = groups.find((g) => g.category === "Football")!;
    expect(football.rows.map((r) => r.domain)).toEqual(["TRANSFERS", "SCOUTING", "CONTRACTS", "TRAINING"]);
  });

  it("14. maps current assignees truthfully", () => {
    const row = responsibilities.rows.find((r) => r.domain === "TRANSFERS")!;
    expect(row.currentOwnerType).toBe("STAFF");
    expect(row.currentOwnerName).toBe("Bikash Shrestha");
  });

  it("15. presents only valid assignees from the view", () => {
    const row = responsibilities.rows.find((r) => r.domain === "TRANSFERS")!;
    const labels = row.assignees.map((a) => (a.ownerType === "STAFF" ? `STAFF:${a.personName}` : a.ownerType));
    expect(labels).toEqual(["MANAGER", "BOARD", "STAFF:Bikash Shrestha"]);
  });

  it("18. never fabricates staff roles — only the provided eligible staff appear", () => {
    const row = responsibilities.rows.find((r) => r.domain === "CONTRACTS")!;
    expect(row.assignees.filter((a) => a.ownerType === "STAFF")).toEqual([]);
    expect(row.assignees.map((a) => a.ownerType)).toContain("MANAGER");
    expect(row.assignees.map((a) => a.ownerType)).toContain("BOARD");
  });

  it("16. encodes delegation mutations for the canonical command", () => {
    expect(responsibilitiesMod.assigneeOptionValue("MANAGER")).toBe("MANAGER");
    expect(responsibilitiesMod.assigneeOptionValue("STAFF", "a1")).toBe("STAFF:a1");
    expect(responsibilitiesMod.parseAssigneeValue("MANAGER").ownerType).toBe("MANAGER");
    expect(responsibilitiesMod.parseAssigneeValue("STAFF:a1").appointmentId).toBe("a1");
  });

  it("19. treats a row with no staff assignee as having only the default authority options", () => {
    const row = responsibilities.rows.find((r) => r.domain === "MEDICAL")!;
    expect(row.assignees.filter((a) => a.ownerType === "STAFF")).toEqual([]);
  });

  it("renders a semantic table of responsibility rows", async () => {
    render(<responsibilitiesMod.ClubResponsibilitiesScreen />);
    await screen.findAllByText(/Delegation/i);
    const tables = document.querySelectorAll("table");
    expect(tables.length).toBeGreaterThan(0);
    expect(screen.getByText("Transfers")).toBeTruthy();
  });
});
afterEach(() => cleanup());