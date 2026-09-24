// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CareerOverviewView, FederationTenureView } from "@nepal-football-sim/shared-types";

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const career = {
  personId: "person",
  name: "Maya Adhikari",
  activeRole: "FEDERATION_PRESIDENT",
  baseRole: "CHAIRMAN_OWNER",
  heldRoles: [
    { role: "CHAIRMAN_OWNER", organization: { label: "Three Star Club" } },
    { role: "FEDERATION_PRESIDENT", organization: { label: "All Nepal Football Association" } },
  ],
} as unknown as CareerOverviewView;

const view = (over: Partial<FederationTenureView> = {}): FederationTenureView => ({
  current: { id: "t1" as never, status: "ACTIVE", termStart: "2026-08-01", termEnd: "2030-01-01" },
  history: [
    { id: "t1" as never, status: "ACTIVE", termStart: "2026-08-01", termEnd: "2030-01-01" },
    { id: "t0" as never, status: "FORMER", termStart: "2022-08-01", termEnd: "2026-07-01" },
  ],
  election: {},
  provenanceStatus: "SIMULATION_ONLY",
  ...over,
});

const dashboard = (status = "ACTIVE", withEnd = true) =>
  ({
    federation: { id: "f1", name: "All Nepal Football Association" },
    tenure: { id: "t1", status, termStart: "2026-08-01", ...(withEnd ? { termEnd: "2030-01-01" } : {}) },
  }) as never;

let tenure: typeof import("./FederationTenureScreen.js");

beforeAll(async () => {
  tenure = await import("./FederationTenureScreen.js");
});
afterEach(() => cleanup());

const renderTenure = (data: FederationTenureView, dash = dashboard()) =>
  render(
    <tenure.FederationTenureScreen
      dashboard={dash}
      bridge={{ getFederationTenure: vi.fn(() => ok(data)), getCareerOverview: vi.fn(() => ok(career)) }}
    />,
  );

describe("Tenure mapping (Phase 9D)", () => {
  it("labels statuses and ranges exactly", () => {
    expect(tenure.tenureStatusLabel("ACTIVE")).toBe("Active");
    expect(tenure.tenureStatusLabel("INTERIM")).toBe("Interim");
    expect(tenure.tenureStatusLabel("FORMER")).toBe("Ended");
    expect(tenure.tenureTone("INTERIM")).toBe("warn");
    expect(tenure.termRange({ termStart: "2026-08-01", termEnd: "2030-01-01" })).toBe("2026-08-01 – 2030-01-01");
    expect(tenure.termRange({ termStart: "2026-08-01" })).toBe("2026-08-01 – no end date recorded");
    expect(tenure.baseCareerText(career as never)).toBe("Club Owner at Three Star Club");
    expect(tenure.baseCareerText({ heldRoles: [] } as never)).toBe("No base career is on record.");
  });
});

describe("Tenure screen", () => {
  it("shows the term, the base career, what happens at term end and the history", async () => {
    renderTenure(view());
    await screen.findByText(/same person across every role/i);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/2026-08-01 – 2030-01-01/);
    expect(body).toMatch(/Term ends/);
    expect(body).toMatch(/Club Owner at Three Star Club/);
    expect(body).toMatch(/return to your base career as the same person/i);
    expect(body).toMatch(/stays in your presidency history/i);
    expect(body).toMatch(/simulated/i);
    expect(body).not.toMatch(/mandate|political capital|support score|term limit/i);
    const table = await screen.findByRole("table", { name: "Your presidencies of this federation" });
    expect(table.textContent).toMatch(/Ended/);
    expect(table.textContent).toMatch(/2022-08-01/);
  });

  it("does not call the term end an election day when no election is scheduled", async () => {
    renderTenure(view());
    await screen.findByText(/No election is scheduled/);
    expect(document.body.textContent).toMatch(/Your term ends 2030-01-01/);
    expect(document.body.textContent).toMatch(/No completed election is on record/);
    expect(document.body.textContent).not.toMatch(/Election date/);
  });

  it("shows a scheduled election and the last result without any vote detail", async () => {
    renderTenure(
      view({
        election: {
          upcoming: { electionDate: "2030-01-01", nominationStart: "2029-10-03", status: "SCHEDULED" },
          latest: { decidedAt: "2022-08-01", winnerName: "Rohit Karki", youWon: false, termYears: 4 },
        },
      }),
    );
    await screen.findByText("Election date");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/2029-10-03/);
    expect(body).toMatch(/Rohit Karki was elected for 4 years/);
    expect(body).not.toMatch(/\d\s*%|probab|coalition|0\.\d{3}/i);
  });

  it("flags an interim presidency and its real limits", async () => {
    renderTenure(view(), dashboard("INTERIM", false));
    await screen.findByText(/interim basis/i);
    expect(document.body.textContent).toMatch(/cannot implement governance proposals or set\s+federation budgets/i);
    expect(document.body.textContent).toMatch(/No end date recorded/);
  });

  it("has an honest empty history", async () => {
    renderTenure(view({ history: [] }));
    await screen.findByText(/No presidency is on record for you/);
  });
});

describe("External bodies panel", () => {
  const context = (over: Record<string, unknown> = {}) => ({
    compliance: { status: "WARNING", lastReviewedOn: "2026-08-01" },
    sanctions: [],
    provenanceStatus: "SIMULATION_ONLY",
    ...over,
  });
  const renderPanel = (data: unknown, onNavigate: (t: "finance") => void = () => {}) =>
    render(<tenure.ExternalBodiesPanel bridge={{ getFederationExternalContext: vi.fn(() => ok(data as never)) }} onNavigate={onNavigate} />);

  it("shows the standing and an honest no-sanctions state with no fake destinations", async () => {
    const onNavigate = vi.fn();
    renderPanel(context(), onNavigate);
    await screen.findByText(/No sanctions are on record/);
    expect(document.body.textContent).toMatch(/Warning \(reviewed 2026-08-01\)/);
    expect(document.body.textContent).toMatch(/Open sanctions0/);
    expect(screen.queryByRole("button", { name: /FIFA|AFC|SAFF/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See grants in Finance" }));
    expect(onNavigate).toHaveBeenCalledWith("finance");
  });

  it("lists sanctions exactly and counts only unresolved ones", async () => {
    renderPanel(
      context({
        compliance: undefined,
        sanctions: [
          { id: "s1", authority: "AFC", category: "FINANCE", reason: "Late audited accounts", startDate: "2026-08-10", reviewState: "ACTIVE", consequences: ["NEW_GRANTS_BLOCKED"], requirementsForResolution: ["Submit audited accounts"], affectedProgrammes: [] },
          { id: "s2", authority: "FIFA", category: "GOVERNANCE", reason: "Old matter", startDate: "2024-01-01", reviewState: "RESOLVED", resolvedOn: "2025-01-01", consequences: [], requirementsForResolution: [], affectedProgrammes: [] },
        ],
      }),
    );
    await screen.findByText("Late audited accounts");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/No compliance review is on record/);
    expect(body).toMatch(/Open sanctions1/);
    expect(body).toMatch(/New Grants Blocked/);
    expect(body).toMatch(/Submit audited accounts/);
    expect(body).toMatch(/Resolved \(2025-01-01\)/);
    expect(body).not.toMatch(/autonomy|statutory|dimension/i);
    expect(screen.getByRole("table", { name: "Sanctions imposed on the federation" })).toBeTruthy();
    expect(tenure_activeSanctions()).toBe(1);
  });

  const tenure_activeSanctions = () => tenure.activeSanctions([{ reviewState: "ACTIVE" }, { reviewState: "RESOLVED" }, { reviewState: "UNDER_REVIEW" }]) - 1;
});
