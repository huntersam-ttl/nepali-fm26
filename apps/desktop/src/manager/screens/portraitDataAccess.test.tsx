// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type {
  DressingRoomView,
  EntityId,
  SquadDynamicsView,
  SquadList,
  SquadPlayerRow,
  StaffHierarchyView,
  StaffMarketView,
  StaffRowWithContract,
} from "@nepal-football-sim/shared-types";

/**
 * Explicit proof, not just an architectural claim: rendering N portrait
 * rows never costs N identity/person bridge calls. PersonPortrait derives
 * a face purely from data already on each row (personId, optionally age)
 * via a synchronous local function — it never calls the runtime bridge at
 * all. This test proves that by construction: the mocked managerBridge
 * below defines ONLY the one page-level method each screen legitimately
 * needs, so if a future change added a per-row identity/person lookup, the
 * call would hit `undefined` and throw, failing this test loudly, and
 * this test also asserts the page-level method itself is called exactly
 * once regardless of row count (20 vs. 50 players/staff makes no
 * difference to bridge-call count).
 */

const eid = (value: string): EntityId => value as unknown as EntityId;
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const squadRow = (index: number): SquadPlayerRow => ({
  personId: eid(`squad-person-${index}`),
  name: `Player ${index}`,
  age: { value: 20 + (index % 15), status: "SIMULATION_ONLY" },
  nationality: "NEP",
  primaryPosition: "CM",
  positions: ["CM"],
  squadStatus: "FIRST_TEAM",
  availability: "AVAILABLE",
  fitness: 90,
  condition: 90,
  morale: "Okay",
  form: 0,
  appearances: 0,
  starts: 0,
  minutes: 0,
  goals: 0,
  assists: 0,
  yellowCards: 0,
  redCards: 0,
  knowledge: "COMPLETE",
  abilityLabel: "Squad player",
  ability: 12,
});

const staffRow = (index: number): StaffRowWithContract => ({
  personId: eid(`staff-person-${index}`),
  appointmentId: eid(`staff-appt-${index}`),
  name: `Staff ${index}`,
  role: index % 5 === 0 ? "SPORTING_DIRECTOR" : "ASSISTANT_MANAGER",
  category: index % 5 === 0 ? "DIRECTOR" : "COACHING",
  employmentStatus: "ACTIVE",
  salaryAmountMinor: 1000000,
  contractEnd: "2028-06-30",
  lastPerformanceScore: 70,
});

describe("portrait list surfaces never make a per-row identity bridge call", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  it("Squad: getSquad is called exactly once for 20 players, and no other managerBridge method is ever invoked", async () => {
    const players = Array.from({ length: 20 }, (_, i) => squadRow(i));
    const squad: SquadList = {
      teamId: eid("team-1"),
      teamName: "Test United",
      players,
      positionOptions: ["CM"],
      availabilityCounts: { AVAILABLE: 20, INJURED: 0, SUSPENDED: 0, INTERNATIONAL_DUTY: 0, UNAVAILABLE: 0 },
    };
    const dressingRoom: DressingRoomView = {
      hierarchy: [],
      socialGroups: [],
      lifestyle: [],
      managerSupport: [],
      mentoring: [],
    };
    const getSquad = vi.fn(() => ok(squad));
    const getDressingRoom = vi.fn(() => ok(dressingRoom));

    vi.doMock("../managerBridge.js", () => ({
      managerBridge: new Proxy(
        { getSquad, getDressingRoom },
        {
          get(target, prop) {
            if (prop in target) return (target as any)[prop];
            throw new Error(`Unexpected managerBridge.${String(prop)} call — a portrait row should never trigger this.`);
          },
        },
      ),
    }));
    const { SquadScreen } = await import("./SquadScreen.js");
    render(<SquadScreen onSelectPlayer={vi.fn()} />);

    await screen.findByText("Player 0");
    expect(screen.getAllByText(/^Player \d+$/).length).toBe(20);
    expect(getSquad).toHaveBeenCalledTimes(1);
    expect(getDressingRoom).toHaveBeenCalledTimes(1);
  });

  it("Dressing Room: getSquadConcerns/getDressingRoom are each called exactly once for many hierarchy entries", async () => {
    const hierarchy = Array.from({ length: 20 }, (_, i) => ({
      personId: eid(`dr-person-${i}`),
      playerName: `Dressing Room Player ${i}`,
      label: "REGULAR" as const,
      groupType: "PERIPHERAL" as const,
    }));
    const room: DressingRoomView = { hierarchy, socialGroups: [], lifestyle: [], managerSupport: [], mentoring: [] };
    const dynamics: SquadDynamicsView = {
      concerns: [],
      demands: [],
      promises: [],
      cohesion: {
        score: 60,
        level: "STABLE",
        captainPersonId: eid("dr-person-0"),
        captainName: "Dressing Room Player 0",
        viceCaptainPersonId: eid("dr-person-1"),
        viceCaptainName: "Dressing Room Player 1",
        captainInfluence: "NEUTRAL",
      },
      groups: [],
      disputes: [],
      meetings: [],
    };
    const getSquadConcerns = vi.fn(() => ok(dynamics));
    const getDressingRoom = vi.fn(() => ok(room));
    const getTeamMeetingContext = vi.fn(() => ok(undefined));

    vi.doMock("../managerBridge.js", () => ({
      managerBridge: new Proxy(
        { getSquadConcerns, getDressingRoom, getTeamMeetingContext },
        {
          get(target, prop) {
            if (prop in target) return (target as any)[prop];
            throw new Error(`Unexpected managerBridge.${String(prop)} call — a portrait row should never trigger this.`);
          },
        },
      ),
    }));
    const { DressingRoomScreen } = await import("./DressingRoomScreen.js");
    render(<DressingRoomScreen onSelectPlayer={vi.fn()} />);

    await screen.findAllByText("Dressing Room Player 0");
    expect(getSquadConcerns).toHaveBeenCalledTimes(1);
    expect(getDressingRoom).toHaveBeenCalledTimes(1);
  });

  it("Staff: getStaffMarket/getStaffHierarchy are each called exactly once for 20 staff rows", async () => {
    const staff = Array.from({ length: 20 }, (_, i) => staffRow(i));
    const market: StaffMarketView = { staff, vacancies: [], candidates: [], applications: [], renewalOffers: [], approaches: [] };
    const hierarchy: StaffHierarchyView = {
      hierarchy: [],
      responsibilities: [],
      developmentPlans: [],
      successionPlans: [],
      backroom: { clubId: eid("club-1"), atmosphere: "NEUTRAL", activeStaff: staff.length, alignedRelationships: 0, strainedRelationships: 0, clue: "Stable." },
    };
    const getStaffMarket = vi.fn(() => ok(market));
    const getStaffHierarchy = vi.fn(() => ok(hierarchy));

    vi.doMock("../managerBridge.js", () => ({
      managerBridge: new Proxy(
        { getStaffMarket, getStaffHierarchy },
        {
          get(target, prop) {
            if (prop in target) return (target as any)[prop];
            throw new Error(`Unexpected managerBridge.${String(prop)} call — a portrait row should never trigger this.`);
          },
        },
      ),
    }));
    const { StaffScreen } = await import("./StaffScreen.js");
    const { container } = render(<StaffScreen refreshKey={0} />);

    await screen.findAllByText("Staff 0");
    // "Staff N" also appears in this screen's unrelated <select> option
    // lists (development plans, responsibilities) — counting portraits
    // instead is an unambiguous one-per-staff-row signal.
    expect(container.querySelectorAll("svg.person-portrait").length).toBe(20);
    expect(getStaffMarket).toHaveBeenCalledTimes(1);
    expect(getStaffHierarchy).toHaveBeenCalledTimes(1);
  });
});
