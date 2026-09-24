// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FederationCompetitionGovernance, FederationDevelopmentProgrammes } from "@nepal-football-sim/shared-types";

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const ref = (id: string, label: string, entityType = "COMPETITION") => ({
  id,
  label,
  entityType,
  destination: "",
  visible: true,
  allowedActions: [],
  provenanceStatus: "SIMULATION_ONLY",
});

const governance = (over: Partial<FederationCompetitionGovernance> = {}): FederationCompetitionGovernance =>
  ({
    competitions: [
      {
        competition: ref("c1", "A-Division League"),
        category: "PYRAMID_LEAGUE",
        seasonName: "2026/27",
        seasonStatus: "In progress",
        teamCount: 12,
        format: "DOUBLE_ROUND_ROBIN",
        rounds: 2,
        promotionSlots: 1,
        relegationSlots: 2,
      },
      { competition: ref("c2", "Women's League"), category: "WOMENS_LEAGUE", teamCount: 8 },
    ],
    reforms: [],
    licensing: { cases: [] },
    provenanceStatus: "SIMULATION_ONLY",
    ...over,
  }) as unknown as FederationCompetitionGovernance;

const programmes = (over: Partial<FederationDevelopmentProgrammes> = {}): FederationDevelopmentProgrammes => ({
  coachEducation: [],
  referee: [],
  budgets: [],
  provenanceStatus: "SIMULATION_ONLY",
  ...over,
});

let panels: typeof import("./FederationGovernancePanels.js");
let logic: typeof import("./federationGovernanceLogic.js");
let overview: typeof import("./FederationOverviewScreen.js");

beforeAll(async () => {
  panels = await import("./FederationGovernancePanels.js");
  logic = await import("./federationGovernanceLogic.js");
  overview = await import("./FederationOverviewScreen.js");
});

afterEach(() => cleanup());

const renderGovernance = (view: FederationCompetitionGovernance, onNavigate: (t: never) => void = () => {}) =>
  render(
    <panels.CompetitionGovernancePanels
      bridge={{ getFederationCompetitionGovernance: vi.fn(() => ok(view)) }}
      onNavigate={onNavigate as never}
      onOpenReference={() => {}}
    />,
  );

describe("Governance mapping (Phase 9C)", () => {
  it("lists only the fields a reform actually changes", () => {
    expect(panels.reformChangeLines({ promotionSlots: 3, relegationSlots: 3 })).toEqual([
      "Promotion places: 3",
      "Relegation places: 3",
    ]);
    expect(panels.reformChangeLines({ teamCount: 14, format: "DOUBLE_ROUND_ROBIN", calendarStart: "2027-01-01" })).toEqual([
      "Teams: 14",
      "Format: Double Round Robin",
      "Calendar: 2027-01-01 – unchanged",
    ]);
    expect(panels.reformChangeLines({})).toEqual([]);
  });

  it("maps statuses to exact tones and counts what needs attention", () => {
    expect(panels.reformStatusTone("IMPLEMENTED")).toBe("ok");
    expect(panels.reformStatusTone("REJECTED")).toBe("bad");
    expect(panels.reformStatusTone("PROPOSED")).toBe("info");
    expect(panels.licenceStatusTone("FAILED")).toBe("bad");
    expect(panels.licenceStatusTone("CONDITIONAL")).toBe("warn");
    expect(panels.licenceStatusTone("PASSED")).toBe("ok");
    expect(logic.reformsAwaitingImplementation([{ status: "APPROVED" }, { status: "PROPOSED" }, { status: "IMPLEMENTED" }])).toBe(1);
    expect(logic.licenceCasesNeedingAttention([{ status: "FAILED" }, { status: "CONDITIONAL" }, { status: "PASSED" }, { status: "PENDING" }])).toBe(2);
    expect(panels.licenceCounts([{ status: "FAILED" }, { status: "PASSED" }, { status: "FAILED" }])).toEqual([
      ["FAILED", 2],
      ["PASSED", 1],
    ]);
    expect(panels.competitionCategoryLabel(undefined)).toBe("Not classified");
  });
});

describe("Competition governance panels", () => {
  it("shows exact competition structure with no invented metrics, and honest empty reform and licensing", async () => {
    renderGovernance(governance());
    await screen.findByText("A-Division League");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Women's League/);
    expect(body).toMatch(/Pyramid league/i);
    expect(body).toMatch(/Womens league/i);
    expect(body).toMatch(/2026\/27/);
    expect(body).toMatch(/In progress/);
    expect(body).toMatch(/No competition reforms have been recorded/);
    expect(body).toMatch(/No club licence cases are on record yet/);
    expect(body).toMatch(/simulated/i);
    expect(body).not.toMatch(/prestige|competitiveness|score|rating|ranking/i);
    expect(screen.getByRole("table", { name: "Domestic competitions of the federation" })).toBeTruthy();
  });

  it("renders recorded reforms with exact status and no way to apply one", async () => {
    renderGovernance(
      governance({
        reforms: [
          {
            id: "r1",
            competition: ref("c1", "A-Division League"),
            effectiveSeason: "2027",
            changes: { promotionSlots: 3 },
            status: "APPROVED",
            proposedAt: "2026-08-10",
            decidedAt: "2026-08-20",
          },
        ] as never,
      }),
    );
    await screen.findByText("Promotion places: 3");
    expect(document.body.textContent).toMatch(/Approved/);
    expect(document.body.textContent).toMatch(/2026-08-20/);
    expect(document.body.textContent).toMatch(/not available from this office/i);
    expect(screen.queryByRole("button", { name: /apply|implement|approve|reject/i })).toBeNull();
  });

  it("renders licence cases with open requirements only and no approve or deny controls", async () => {
    renderGovernance(
      governance({
        licensing: {
          seasonLabel: "2026",
          cases: [
            {
              id: "l1",
              club: ref("club1", "Church Boys United", "CLUB"),
              seasonLabel: "2026",
              status: "FAILED",
              openRequirements: [{ requirement: "Secure an approved venue use right", deadline: "2027-03-31" }],
              sanctions: ["REGISTRATION_RESTRICTION"],
              reviewedAt: "2026-05-01",
            },
            {
              id: "l2",
              club: ref("club2", "Three Star", "CLUB"),
              seasonLabel: "2026",
              status: "PASSED",
              openRequirements: [],
              sanctions: [],
              reviewedAt: "2026-05-01",
            },
          ],
        } as never,
      }),
    );
    await screen.findByText("Church Boys United");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Club licensing · 2026/);
    expect(body).toMatch(/Failed: 1 · Passed: 1/);
    expect(body).toMatch(/Secure an approved venue use right \(by 2027-03-31\)/);
    expect(body).toMatch(/Registration Restriction/);
    expect(body).toMatch(/does not grant or deny them by hand/);
    expect(screen.queryByRole("button", { name: /approve|deny|grant|appeal/i })).toBeNull();
    expect(screen.getByRole("table", { name: "Club licence cases for the latest season" })).toBeTruthy();
  });

  it("routes its cross-links", async () => {
    const onNavigate = vi.fn();
    renderGovernance(governance(), onNavigate);
    await screen.findByText("A-Division League");
    fireEvent.click(screen.getByRole("button", { name: "Open Governance" }));
    fireEvent.click(screen.getByRole("button", { name: "National Development" }));
    fireEvent.click(screen.getByRole("button", { name: "Finance" }));
    expect(onNavigate.mock.calls.map((call) => call[0])).toEqual(["governance", "national-development", "finance"]);
  });
});

describe("Development programmes panel", () => {
  const renderProgrammes = (view: FederationDevelopmentProgrammes, onNavigate: (t: "finance") => void = () => {}) =>
    render(
      <panels.DevelopmentProgrammesPanel
        bridge={{ getFederationDevelopmentProgrammes: vi.fn(() => ok(view)) }}
        onNavigate={onNavigate}
      />,
    );

  it("shows honest empties for coach education and referee programmes", async () => {
    renderProgrammes(programmes());
    await screen.findByText(/No coach-education programme has been run/);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/No referee development programme has been run/);
    expect(body).toMatch(/No development budgets are on record/);
    expect(body).not.toMatch(/%/);
  });

  it("renders recorded programmes and season funding, distinct from career qualifications", async () => {
    const onNavigate = vi.fn();
    renderProgrammes(
      programmes({
        coachEducation: [
          { id: "p1" as never, kind: "COACH_EDUCATION", label: "AFC B", startDate: "2026-09-01", endDate: "2026-11-15", capacity: 20, cost: 840000, currency: "NPR", outcome: 16, outcomeLabel: "Graduates", status: "COMPLETED" },
        ],
        referee: [
          { id: "p2" as never, kind: "REFEREE", label: "TRAINING", startDate: "2026-09-28", endDate: "2026-11-12", capacity: 4, cost: 88000, currency: "NPR", outcome: 4, outcomeLabel: "Officials advanced", status: "COMPLETED" },
        ],
        budgets: [{ category: "COACH_EDUCATION", seasonLabel: "2026", amount: 2000000, usedAmount: 840000, currency: "NPR" }],
      }),
      onNavigate,
    );
    await screen.findByText("AFC B");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/16 graduates/);
    expect(body).toMatch(/4 officials advanced/);
    expect(body).toMatch(/NPR 840,000/);
    expect(body).toMatch(/Coach education/);
    expect(body).toMatch(/separate from your own career\s+qualifications/);
    expect(screen.getByRole("table", { name: "Coach-education programmes" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Referee development programmes" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Finance" }));
    expect(onNavigate).toHaveBeenCalledWith("finance");
  });
});

describe("Overview attention from competition governance", () => {
  const base = { proposals: [], projects: [] } as never;

  it("adds real reform and licence items only when they exist", () => {
    expect(overview.attentionItems(base, { reforms: [], licensing: { cases: [] } } as never)).toEqual([]);
    const items = overview.attentionItems(base, {
      reforms: [{ status: "APPROVED" }, { status: "IMPLEMENTED" }],
      licensing: { cases: [{ status: "FAILED" }, { status: "PASSED" }, { status: "CONDITIONAL" }] },
    } as never);
    expect(items.map((item) => item.key)).toEqual(["reforms", "licences"]);
    expect(items[0]).toMatchObject({ text: "1 competition reform approved but not yet implemented", target: "competition-pyramid" });
    expect(items[1]?.text).toBe("2 club licences failed or conditional");
  });

  it("is unchanged when the competition read is unavailable", () => {
    expect(overview.attentionItems({ proposals: [{ status: "APPROVED" }], projects: [] } as never).map((item) => item.key)).toEqual(["approved"]);
  });
});
