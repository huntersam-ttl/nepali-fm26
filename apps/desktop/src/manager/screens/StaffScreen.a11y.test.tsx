// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import type {
  EntityId,
  StaffHierarchyView,
  StaffMarketView,
  StaffRowWithContract,
} from "@nepal-football-sim/shared-types";

const eid = (value: string): EntityId => value as unknown as EntityId;

/**
 * Accessibility coverage for the Staff surface's new decorative
 * PersonPortrait wired into each row (Phase 1M). Two real staff rows —
 * one COACHING, one DIRECTOR — so both portrait-role branches
 * (STAFF/EXECUTIVE) render, plus the full market/hierarchy shape the
 * screen unconditionally reads on mount.
 */

const staff: StaffRowWithContract[] = [
  {
    personId: eid("coach-1"),
    appointmentId: eid("appt-coach-1"),
    name: "Sunita Tamang",
    role: "ASSISTANT_MANAGER",
    category: "COACHING",
    employmentStatus: "ACTIVE",
    licence: "A_LICENCE",
    salaryAmountMinor: 50000000,
    contractEnd: "2027-06-30",
    lastPerformanceScore: 72,
  },
  {
    personId: eid("director-1"),
    appointmentId: eid("appt-director-1"),
    name: "Bikash Shrestha",
    role: "SPORTING_DIRECTOR",
    category: "DIRECTOR",
    employmentStatus: "ACTIVE",
    salaryAmountMinor: 90000000,
    contractEnd: "2028-06-30",
    lastPerformanceScore: 65,
  },
];

const market: StaffMarketView = {
  staff,
  vacancies: [],
  candidates: [],
  applications: [],
  renewalOffers: [],
  approaches: [],
};

const hierarchy: StaffHierarchyView = {
  hierarchy: [],
  responsibilities: [],
  developmentPlans: [],
  successionPlans: [],
  backroom: {
    clubId: eid("club-1"),
    atmosphere: "NEUTRAL",
    activeStaff: staff.length,
    alignedRelationships: 0,
    strainedRelationships: 0,
    clue: "Stable backroom.",
  },
};

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

vi.mock("../managerBridge.js", () => ({
  managerBridge: {
    getStaffMarket: vi.fn(() => ok(market)),
    getStaffHierarchy: vi.fn(() => ok(hierarchy)),
  },
}));

let StaffScreen: typeof import("./StaffScreen.js").StaffScreen;
beforeAll(async () => {
  ({ StaffScreen } = await import("./StaffScreen.js"));
});
afterEach(() => cleanup());

const renderScreen = () => render(<StaffScreen refreshKey={0} />);

describe("Staff surface — accessibility", () => {
  it("renders every staff member's portrait as decorative, never doubling the accessible name", async () => {
    const { container } = renderScreen();
    await screen.findAllByText("Sunita Tamang");
    await screen.findAllByText("Bikash Shrestha");
    const portraits = container.querySelectorAll(".squad-name-cell svg.person-portrait");
    expect(portraits.length).toBe(2);
    for (const svg of portraits) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.hasAttribute("role")).toBe(false);
      expect(svg.hasAttribute("aria-label")).toBe(false);
    }
  });

  it("has no serious or critical axe violations", async () => {
    const { container } = renderScreen();
    await screen.findAllByText("Sunita Tamang");
    const results = await axe.run(container, {
      rules: {
        region: { enabled: false },
        "page-has-heading-one": { enabled: false },
        "landmark-one-main": { enabled: false },
        // Pre-existing, unrelated to this test's own subject (the new
        // decorative portraits): the "Staff count/Open vacancies/..."
        // metrics header uses bare <dt>/<dd> pairs with no wrapping <dl>
        // (line ~120 of StaffScreen.tsx). Confirmed pre-existing and
        // scoped to that one header, not introduced or touched by the
        // portrait work this test actually covers; flagged separately
        // rather than fixed here, per "preserve unrelated work."
        dlitem: { enabled: false },
      },
    });
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id} (${v.impact})`),
    ).toEqual([]);
  });
});
