// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type {
  ClubProfile,
  EntityId,
  InfrastructureStoryEntry,
  ManagerCareerHistoryView,
  SupporterReadModel,
} from "@nepal-football-sim/shared-types";

const eid = (value: string): EntityId => value as unknown as EntityId;
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const supporter: SupporterReadModel = ({
  clubId: eid("club-1"),
  gender: "men",
  profile: {},
  supporterBase: { potentialReach: 120000, activeFanbase: 78000, matchgoingBase: 24000, seasonTicketBase: 9000, casualAudience: 41000 },
  mood: 62,
  expectations: 55,
  managerApproval: 70,
  ownershipTrust: 61,
  unrest: "CONTENT",
  commercialEngagementIndex: 58,
  topRivalries: [],
  fanFavourites: [],
  recentEvents: [
    { id: eid("ev1"), clubId: eid("club-1"), gender: "men", date: "2025-09-01", type: "MATCH_RESULT", magnitude: 60, moodDelta: 4, summary: "A dominant home victory lifted supporters", subjectIds: [], provenanceStatus: "SIMULATION_ONLY" },
  ],
  reaction: "SUPPORTIVE",
  activeConcerns: ["Ticketing queues on derby day"],
  factions: ["TRADITIONALISTS", "RESULTS_FIRST"],
  provenanceStatus: "SIMULATION_ONLY",
}) as unknown as SupporterReadModel;

const career: ManagerCareerHistoryView = ({
  managerName: "Maya",
  reputationProfile: "Rising",
  jobsHeld: 2,
  history: [
    { contractId: eid("c1"), clubName: "Another SC", teamName: "First", jobTitle: "Manager", start: "2024-07-01", end: "2025-06-30", outcome: "PROMOTED" },
    { contractId: eid("c2"), clubName: "Church Boys United", teamName: "First", jobTitle: "Manager", start: "2025-07-01", outcome: "ACTIVE" },
  ],
  trophies: [{ competitionName: "Martyrs Memorial A-Division League", teamName: "Church Boys United", wonOn: "2025-08-01" }],
}) as unknown as ManagerCareerHistoryView;

const milestone: InfrastructureStoryEntry = {
  headline: "Stadium refurbishment completed",
  occurredOn: "2025-05-01",
  tone: "ok",
  entities: [],
};

const club: ClubProfile = ({
  entityReference: { id: eid("club-1"), label: "Kathmandu United", type: "CLUB", visible: true, destination: "DESTINATION" as never },
  owner: { id: eid("owner-1"), label: "R. Shrestha", type: "PERSON", visible: true, destination: "DESTINATION" as never },
  recentFixtures: [],
  squad: [],
  activeSponsors: [
    { id: eid("sp1"), entityType: "SPONSOR", label: "Yeti Airlines", visible: true, allowedActions: [], provenanceStatus: "SIMULATION_ONLY", destination: "DESTINATION" as never },
  ],
  infrastructureProjects: [],
  campusProjects: [],
  infrastructureHistory: [milestone],
}) as unknown as ClubProfile;

const clubNoPartners: ClubProfile = ({ ...club, activeSponsors: [], infrastructureHistory: [] }) as unknown as ClubProfile;

vi.mock("../managerBridge.js", () => ({
  managerBridge: {
    getSupporterOverview: vi.fn(() => ok(supporter)),
    getCareerHistory: vi.fn(() => ok(career)),
    getClubProfile: vi.fn(() => ok(club)),
  },
}));

let supportersMod: typeof import("./ClubSupportersScreen.js");
let commercial: typeof import("./ClubCommercialScreen.js");
let history: typeof import("./ClubHistoryScreen.js");

beforeAll(async () => {
  supportersMod = await import("./ClubSupportersScreen.js");
  commercial = await import("./ClubCommercialScreen.js");
  history = await import("./ClubHistoryScreen.js");
});

describe("Supporters", () => {
  it("1. maps canonical supporter mood/unrest/reaction states", () => {
    expect(supportersMod.unrestLabel("CONTENT")).toBe("content");
    expect(supportersMod.unrestLabel(undefined)).toBe("Unknown");
    expect(supportersMod.reactionLabel("SUPPORTIVE")).toBe("supportive");
    expect(supportersMod.humanizeEventType("MATCH_RESULT")).toBe("match result");
  });

  it("2. surfaces the exact mood/unrest from the read model", async () => {
    render(<supportersMod.ClubSupportersScreen />);
    await screen.findByText(/content/i);
    expect(document.body.textContent).toMatch(/mood 62\/100/i);
  });

  it("3. never invents a supporter score or hidden engagement formula", async () => {
    render(<supportersMod.ClubSupportersScreen />);
    await screen.findByText(/content/i);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/supporter score|\+\d+(\.\d+)?%/i);
    expect(page).not.toMatch(/formula|multiplier/i);
  });

  it("4. has no Owner-only engagement controls for the Manager", async () => {
    render(<supportersMod.ClubSupportersScreen />);
    await screen.findByText(/content/i);
    const buttons = Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").toLowerCase());
    expect(buttons.some((t) => /ticket price|invest|consult|community project/i.test(t))).toBe(false);
  });

  it("5. shows an honest empty state without supporter data", async () => {
    const bridge = (await import("../managerBridge.js")).managerBridge;
    (bridge.getSupporterOverview as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
      Promise.resolve({ ok: true as const, data: undefined as SupporterReadModel | undefined }),
    );
    render(<supportersMod.ClubSupportersScreen />);
    expect(await screen.findByText(/no supporter data/i)).toBeTruthy();
    (bridge.getSupporterOverview as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(supporter));
  });

  it("6. does not expose hidden formulas/weights as text", async () => {
    render(<supportersMod.ClubSupportersScreen />);
    await screen.findByText(/content/i);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/volatility|passion|patience|loyalty/i);
  });
});

describe("Commercial", () => {
  it("7. maps the club's canonical sponsor partners", () => {
    expect(commercial.sponsors(club).map((s) => s.label)).toEqual(["Yeti Airlines"]);
    expect(commercial.sponsors(clubNoPartners)).toEqual([]);
  });

  it("11. never invents a sponsor or kit supplier", () => {
    expect(commercial.sponsors(club).some((s) => /nike|adidas|kit/i.test(s.label))).toBe(false);
  });

  it("12. Manager sees partners and no Owner-only deal controls", async () => {
    render(<commercial.ClubCommercialScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findByText(/yeti airlines/i);
    const buttons = Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").toLowerCase());
    expect(buttons.some((t) => /negotiate|approve|reject|renew|kit supplier/i.test(t))).toBe(false);
  });

  it("13. shows an honest empty state with no partners", async () => {
    const bridge = (await import("../managerBridge.js")).managerBridge;
    (bridge.getClubProfile as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(clubNoPartners));
    render(<commercial.ClubCommercialScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findByText(/no active commercial partners/i);
    (bridge.getClubProfile as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(club));
  });

  it("8/10. does not show Owner-private deal values/terms/ticketing to the Manager", async () => {
    render(<commercial.ClubCommercialScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findByText(/yeti airlines/i);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/annual value|deal term|ticket price|revenue:/i);
  });
});
describe("History & Honours", () => {
  it("20. maps canonical honours, career record and club milestones", () => {
    expect(history.honours(career).map((t) => t.competitionName)).toEqual(["Martyrs Memorial A-Division League"]);
    expect(history.careerRecord(career).length).toBe(2);
    expect(history.clubMilestones(club).map((m) => m.headline)).toEqual(["Stadium refurbishment completed"]);
  });

  it("21. preserves chronological order of the career record", () => {
    const record = history.careerRecord(career);
    expect(record[0]!.start).toBe("2024-07-01");
    expect(record[1]!.start).toBe("2025-07-01");
  });

  it("22. never reconstructs or fabricates events", async () => {
    render(<history.ClubHistoryScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findByText(/stadium refurbishment completed/i);
    expect(document.body.textContent).not.toMatch(/won the league.*18\d\d|founded in \d{3,4} and/i);
  });

  it("27/28. honours come only from recorded trophies with season/year", async () => {
    render(<history.ClubHistoryScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findByText(/martyrs memorial a-division league/i);
    expect(document.body.textContent).toMatch(/2025/);
  });

  it("24. shows honest empty history states for a club with no milestones", async () => {
    const bridge = (await import("../managerBridge.js")).managerBridge;
    (bridge.getClubProfile as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(clubNoPartners));
    render(<history.ClubHistoryScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findByText(/no recorded milestones/i);
    (bridge.getClubProfile as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(club));
  });

  it("35. never surfaces hidden commercial/supporter formulas", async () => {
    render(<history.ClubHistoryScreen clubId={eid("club-1")} onOpenEntity={() => {}} />);
    await screen.findByText(/stadium refurbishment completed/i);
    expect(document.body.textContent).not.toMatch(/multiplier|weight|coefficient|threshold/i);
  });
});
afterEach(() => cleanup());