// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CareerOverviewView, EntityId, ManagerCareerHistoryView } from "@nepal-football-sim/shared-types";

const eid = (value: string): EntityId => value as unknown as EntityId;
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const overviewManager: CareerOverviewView = ({
  personId: eid("p1"),
  name: "Maya Adhikari",
  activeRole: "MANAGER",
  baseRole: "MANAGER",
  isTemporaryPresidentOffice: false,
  currentOrganization: { label: "Church Boys United", reference: { id: eid("c1"), entityType: "CLUB", label: "Church Boys United", visible: true, allowedActions: [], provenanceStatus: "SIMULATION_ONLY", destination: "DESTINATION" as never } },
  tenureStart: "2025-07-01",
  tenureEnd: "2027-06-30",
  heldRoles: [{ role: "MANAGER", organization: { label: "Church Boys United" } }],
}) as unknown as CareerOverviewView;

const overviewPresident: CareerOverviewView = ({ ...overviewManager, activeRole: "FEDERATION_PRESIDENT", baseRole: "MANAGER", isTemporaryPresidentOffice: true, currentOrganization: { label: "All Nepal Football Association" }, heldRoles: [{ role: "MANAGER", organization: { label: "Church Boys United" } }, { role: "FEDERATION_PRESIDENT", organization: { label: "All Nepal Football Association" } }] }) as unknown as CareerOverviewView;

const overviewUnemployed: CareerOverviewView = ({ ...overviewManager, currentOrganization: undefined, tenureStart: undefined, tenureEnd: undefined, heldRoles: [] }) as unknown as CareerOverviewView;

const history: ManagerCareerHistoryView = ({
  managerName: "Maya Adhikari",
  reputationProfile: "Rising",
  jobsHeld: 2,
  history: [
    { contractId: eid("c2"), clubName: "Church Boys United", teamName: "First", jobTitle: "MANAGER", start: "2025-07-01", end: undefined, outcome: "ACTIVE" },
    { contractId: eid("c1"), clubName: "Another SC", teamName: "First", jobTitle: "MANAGER", start: "2024-07-01", end: "2025-06-30", outcome: "PROMOTED" },
  ],
  trophies: [{ competitionName: "Martyrs Memorial A-Division League", teamName: "Church Boys United", wonOn: "2025-08-01" }],
}) as unknown as ManagerCareerHistoryView;

vi.mock("../managerBridge.js", () => ({
  managerBridge: {
    getCareerOverview: vi.fn(() => ok(overviewManager)),
    getCareerHistory: vi.fn(() => ok(history)),
  },
}));

let overviewMod: typeof import("./CareerOverviewScreen.js");
let historyMod: typeof import("./CareerHistoryScreen.js");

beforeAll(async () => {
  overviewMod = await import("./CareerOverviewScreen.js");
  historyMod = await import("./CareerHistoryScreen.js");
});

afterEach(() => cleanup());

describe("Career Overview (identity + role)", () => {
  it("1. maps one persistent human person (name + person id)", () => {
    expect(overviewManager.name).toBe("Maya Adhikari");
    expect(overviewManager.personId).toBe(eid("p1"));
  });

  it("2. maps the current role via roleDisplay", () => {
    expect(overviewMod.roleDisplay("MANAGER")).toBe("Manager");
    expect(overviewMod.roleDisplay("CHAIRMAN_OWNER")).toBe("Club Owner");
    expect(overviewMod.roleDisplay("FEDERATION_PRESIDENT")).toBe("Federation President");
  });

  it("3. base role is distinct from active role", () => {
    expect(overviewManager.baseRole).toBe("MANAGER");
    expect(overviewPresident.baseRole).toBe("MANAGER");
  });

  it("4. temporary President office is flagged separately from the base career", () => {
    expect(overviewPresident.isTemporaryPresidentOffice).toBe(true);
    expect(overviewManager.isTemporaryPresidentOffice).toBe(false);
    render(<overviewMod.CareerOverviewScreen onOpenEntity={() => {}} />);
  });

  it("5. an unemployed person has no current organisation and no tenure", () => {
    expect(overviewUnemployed.currentOrganization).toBeUndefined();
    expect(overviewUnemployed.tenureStart).toBeUndefined();
    expect(overviewUnemployed.heldRoles).toEqual([]);
  });

  it("7/8/9. renders current status (org + tenure + held roles) and never fabrication", async () => {
    render(<overviewMod.CareerOverviewScreen onOpenEntity={() => {}} />);
    await screen.findByText(/maya adhikari/i);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/church boys united/i);
    expect(body).toMatch(/2025-07-01/);
    expect(body).not.toMatch(/bonus|release clause|severance|salary/i);
  });

  it("10. never invents contract clauses on the Overview", async () => {
    render(<overviewMod.CareerOverviewScreen onOpenEntity={() => {}} />);
    await screen.findByText(/maya adhikari/i);
    expect(document.body.textContent ?? "").not.toMatch(/bonus|release clause|severance|salary/i);
  });
});

describe("Career History (appointments + honours)", () => {
  it("12. maps the canonical appointment list", () => {
    expect(historyMod.appointments(history).length).toBe(2);
  });

  it("13. preserves deterministic chronological ordering", () => {
    const roles = historyMod.appointments(history);
    expect(roles[0]!.start).toBe("2025-07-01");
    expect(roles[1]!.start).toBe("2024-07-01");
  });

  it("14. distinguishes the current active appointment from completed ones", () => {
    const roles = historyMod.appointments(history);
    expect(historyMod.isCurrent(roles[0]!)).toBe(true);
    expect(historyMod.isCurrent(roles[1]!)).toBe(false);
  });

  it("15. maps trophies from canonical records only", () => {
    expect(historyMod.honours(history)[0]!.competitionName).toBe("Martyrs Memorial A-Division League");
  });

  it("18. shows an honest empty history when there are none", async () => {
    const bridge = (await import("../managerBridge.js")).managerBridge;
    (bridge.getCareerHistory as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
      Promise.resolve({ ok: true as const, data: { history: [], trophies: [] } as unknown as ManagerCareerHistoryView }),
    );
    render(<historyMod.CareerHistoryScreen />);
    expect(await screen.findByText(/no prior roles are on record/i)).toBeTruthy();
    (bridge.getCareerHistory as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(history));
  });
});