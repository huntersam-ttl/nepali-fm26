// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FederationBudget, FederationGrantView, FederationPresidentDashboard } from "@nepal-football-sim/shared-types";

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const budget = (over: Record<string, unknown>): FederationBudget =>
  ({
    id: "b1",
    federationId: "f1",
    seasonLabel: "2026",
    category: "ADMINISTRATION",
    amount: 1_000_000,
    usedAmount: 250_000,
    currency: "NPR",
    status: "ACTIVE",
    provenanceStatus: "SIMULATION_ONLY",
    ...over,
  }) as FederationBudget;

const grant = (over: Record<string, unknown>): FederationGrantView =>
  ({
    id: "g1",
    sourceInstitution: "AFC_DEVELOPMENT",
    purpose: "Grassroots development",
    restrictionType: "GRASSROOTS",
    status: "APPROVED",
    fundingPeriodStart: "2026-08-01",
    fundingPeriodEnd: "2027-07-31",
    currency: "NPR",
    approvedAmount: 500_000,
    receivedAmount: 100_000,
    remainingAmount: 400_000,
    provenanceStatus: "SIMULATION_ONLY",
    ...over,
  }) as FederationGrantView;

let budgets: FederationBudget[];
let grants: FederationGrantView[];

const dashboard = (): Pick<FederationPresidentDashboard, "finances"> =>
  ({
    finances: {
      account: {
        cashBalance: 15_000_000,
        restrictedFunds: 4_800_000,
        receivables: 200_000,
        payables: 100_000,
        debt: 0,
        currency: "NPR",
        financialHealth: "STABLE",
        seasonRevenue: 1,
        seasonExpenses: 1,
        seasonProfitLoss: 0,
      },
      budgets,
      ledgerEntries: [],
      statements: [],
    },
  }) as unknown as Pick<FederationPresidentDashboard, "finances">;

const bridge = {
  getFederationGrants: vi.fn(() => ok(grants)),
  setFederationBudget: vi.fn((_category: string, amount: number) => ok(budget({ amount }))),
};

let mod: typeof import("./FederationFundingPanels.js");

beforeAll(async () => {
  mod = await import("./FederationFundingPanels.js");
});

beforeEach(() => {
  vi.clearAllMocks();
  budgets = [
    budget({ id: "b1", category: "ADMINISTRATION" }),
    budget({ id: "b2", category: "GRASSROOTS", amount: 2_000_000, usedAmount: 0 }),
    budget({ id: "old", category: "COMMERCIAL", seasonLabel: "2025" }),
  ];
  grants = [];
});

afterEach(() => cleanup());

const renderPanels = (onNavigate: (target: never) => void = () => {}, refresh: () => void = () => {}) =>
  render(<mod.FederationFundingPanels dashboard={dashboard()} bridge={bridge} refresh={refresh} onNavigate={onNavigate as never} />);

describe("Federation funding mapping (Phase 9B)", () => {
  it("derives the not-restricted remainder and remaining budget without a health score", () => {
    expect(mod.notRestrictedFunds({ cashBalance: 15_000_000, restrictedFunds: 4_800_000 })).toBe(10_200_000);
    expect(mod.budgetRemaining({ amount: 1_000_000, usedAmount: 250_000 })).toBe(750_000);
  });

  it("uses the latest season only and orders categories by label", () => {
    const { season, rows } = mod.currentBudgets(budgets);
    expect(season).toBe("2026");
    expect(rows.map((row) => row.id)).toEqual(["b1", "b2"]);
    expect(mod.currentBudgets([])).toEqual({ rows: [] });
  });

  it("accepts only whole numbers of zero or more", () => {
    expect(mod.parseBudgetInput("1500000")).toBe(1_500_000);
    expect(mod.parseBudgetInput(" 0 ")).toBe(0);
    for (const bad of ["", "-1", "1.5", "1e6", "abc", "1,000", "1234567890123456"]) expect(mod.parseBudgetInput(bad)).toBeUndefined();
  });

  it("maps grant status tone and orders newest period first", () => {
    expect(mod.grantStatusTone("ACTIVE")).toBe("ok");
    expect(mod.grantStatusTone("FROZEN")).toBe("bad");
    expect(mod.grantStatusTone("REPORTING_DUE")).toBe("warn");
    expect(mod.grantStatusTone("PROPOSED")).toBe("info");
    const ordered = mod.sortedGrants([grant({ id: "a", fundingPeriodStart: "2025-01-01" }), grant({ id: "b", fundingPeriodStart: "2026-01-01" })]);
    expect(ordered.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});

describe("Federation funding panels", () => {
  it("shows exact account and budget figures, provenance and honest grant empties", async () => {
    renderPanels();
    await screen.findByText(/No grants are on record for the federation/i);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/NPR 15,000,000/);
    expect(body).toMatch(/NPR 4,800,000/);
    expect(body).toMatch(/NPR 10,200,000/);
    expect(body).toMatch(/Financial standing/);
    expect(body).toMatch(/simulated/i);
    expect(body).toMatch(/Season budgets · 2026/);
    expect(body).not.toMatch(/health score|sustainab|forecast/i);
    expect(screen.getByRole("table", { name: "Federation season budgets by category" })).toBeTruthy();
    expect(body).not.toMatch(/2025/);
  });

  it("renders grant source, purpose, restriction, status, period and amounts only", async () => {
    grants = [grant({ conditions: ["hidden condition"], reportingRequirements: ["hidden report"] })];
    renderPanels();
    await screen.findByText("Grassroots development");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Afc Development/i);
    expect(body).toMatch(/2026-08-01 – 2027-07-31/);
    expect(body).toMatch(/NPR 400,000/);
    expect(body).not.toMatch(/hidden condition|hidden report/);
    expect(screen.getByRole("table", { name: "Federation grants" })).toBeTruthy();
  });

  it("sets a budget through the canonical command and refreshes", async () => {
    const refresh = vi.fn();
    renderPanels(() => {}, refresh);
    fireEvent.click(await screen.findByRole("button", { name: "Change Administration budget" }));
    fireEvent.change(screen.getByLabelText("New budget for Administration"), { target: { value: "1500000" } });
    fireEvent.click(screen.getByRole("button", { name: "Set Administration budget" }));
    await waitFor(() => expect(bridge.setFederationBudget).toHaveBeenCalledWith("ADMINISTRATION", 1_500_000));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect((await screen.findByRole("status")).textContent).toMatch(/Administration budget set to NPR 1,500,000/);
  });

  it("does not send an invalid amount and can cancel without a command", async () => {
    renderPanels();
    fireEvent.click(await screen.findByRole("button", { name: "Change Administration budget" }));
    fireEvent.change(screen.getByLabelText("New budget for Administration"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Set Administration budget" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/whole number/i);
    expect(bridge.setFederationBudget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("New budget for Administration")).toBeNull();
  });

  it("surfaces a backend rejection and leaves the figures unchanged", async () => {
    bridge.setFederationBudget.mockResolvedValueOnce({
      ok: false as const,
      error: { code: "INVALID_SELECTION", message: "A budget cannot be set below the amount already used" },
    } as never);
    renderPanels();
    fireEvent.click(await screen.findByRole("button", { name: "Change Administration budget" }));
    fireEvent.change(screen.getByLabelText("New budget for Administration"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Set Administration budget" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/below the amount already used/i);
    expect(document.body.textContent).toMatch(/NPR 1,000,000/);
  });

  it("offers no budget controls when the command is unavailable, and routes cross-links", async () => {
    const onNavigate = vi.fn();
    render(
      <mod.FederationFundingPanels
        dashboard={dashboard()}
        bridge={{ getFederationGrants: bridge.getFederationGrants }}
        refresh={() => {}}
        onNavigate={onNavigate}
      />,
    );
    await screen.findByText(/No grants are on record/i);
    expect(screen.queryByRole("button", { name: /Change .* budget/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "National Development" }));
    fireEvent.click(screen.getByRole("button", { name: "Federation Projects" }));
    fireEvent.click(screen.getByRole("button", { name: "Government" }));
    expect(onNavigate.mock.calls.map((call) => call[0])).toEqual([
      "national-development",
      "federation-projects",
      "government-relations",
    ]);
  });
});
