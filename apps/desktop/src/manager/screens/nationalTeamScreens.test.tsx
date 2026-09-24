// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const ref = (id: string, label: string, entityType: string) => ({
  id,
  label,
  entityType,
  destination: "",
  visible: true,
  allowedActions: [],
  provenanceStatus: "SIMULATION_ONLY",
});

const teams = [
  { id: "men", name: "Nepal Senior Men", level: "senior", gender: "men", headCoach: "Coach Rai", squadSize: 23, nextFixture: { opponent: "Maldives", date: "2026-11-01" }, recentResult: { opponent: "Bhutan", result: "2-0" } },
  { id: "women", name: "Nepal Senior Women", level: "senior", gender: "women", squadSize: 0 },
  { id: "u17", name: "Nepal U17 Men", level: "u17", gender: "men", squadSize: 0 },
] as never;

const identity = (id: string, name: string, typeLabel: string) => ({
  id,
  name,
  level: "senior",
  gender: "men",
  programme: "SENIOR_MENS",
  typeLabel,
  federation: { id: "f1", name: "All Nepal Football Association" },
});

const match = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  date: "2026-08-20",
  opponent: "Bhutan",
  kind: "QUALIFIER",
  venueSide: "AWAY",
  status: "PLAYED",
  goalsFor: 2,
  goalsAgainst: 0,
  result: "WIN",
  ...over,
});

const overviewFor = (id: string) =>
  id === "men"
    ? {
        team: identity("men", "Nepal Senior Men", "Senior men"),
        headCoach: ref("c1", "Coach Rai", "STAFF"),
        staffCount: 5,
        squad: { squadSize: 23, selectedCount: 23, unavailableCount: 2, captain: ref("p1", "Anjan Bista", "PLAYER"), currentWindow: "2026-08-01" },
        nextMatch: match({ id: "m2", opponent: "Maldives", status: "SCHEDULED", goalsFor: undefined, goalsAgainst: undefined, result: undefined, venueSide: "NOT_RECORDED", kind: "FRIENDLY", date: "2026-11-01" }),
        recent: [match()],
        competitions: [{ edition: "SAFF Championship 2026", status: "SCHEDULED", startDate: "2026-09-01", endDate: "2026-09-20", entryStatus: "QUALIFIED", group: "Group A", campaign: { name: "c", matchesPlayed: 2, wins: 1, draws: 1, losses: 0, qualificationStatus: "ACTIVE" } }],
        attention: [{ key: "availability", text: "2 called-up players are injured or suspended", target: "squad" }, { key: "match", text: "Next match: Maldives on 2026-11-01", target: "fixtures" }],
        asOf: "2026-08-01",
        provenanceStatus: "SIMULATION_ONLY",
      }
    : {
        team: identity(id, id === "women" ? "Nepal Senior Women" : "Nepal U17 Men", id === "women" ? "Senior women" : "Under-17 men"),
        headCoach: undefined,
        staffCount: 4,
        squad: { squadSize: 0, selectedCount: 0, unavailableCount: 0 },
        nextMatch: undefined,
        recent: [],
        competitions: [],
        attention: [{ key: "coach", text: "No head coach is recorded for this team", target: "staff" }, { key: "squad", text: "No squad has been called up", target: "squad" }],
        asOf: "2026-08-01",
        provenanceStatus: "SIMULATION_ONLY",
      };

const bridge = {
  getNationalTeamOverview: vi.fn((id: string) => ok(overviewFor(id) as never)),
  getNationalTeamStaff: vi.fn((id: string) =>
    ok({
      team: identity(id, "Nepal Senior Men", "Senior men"),
      members:
        id === "men"
          ? [
              { person: ref("c1", "Coach Rai", "STAFF"), role: "NATIONAL_TEAM_HEAD_COACH", roleLabel: "Head coach", startDate: "2026-01-01", contractEnd: "2028-01-01" },
              { person: ref("a1", "Asst Gurung", "STAFF"), role: "NATIONAL_TEAM_ASSISTANT", roleLabel: "Assistant coach", startDate: "2026-01-01" },
            ]
          : [],
      headCoachVacant: id !== "men",
      provenanceStatus: "SIMULATION_ONLY",
    } as never),
  ),
  getNationalTeamFixtures: vi.fn((id: string) =>
    ok({
      team: identity(id, "Nepal Senior Men", "Senior men"),
      upcoming: id === "men" ? [match({ id: "m2", opponent: "Maldives", status: "SCHEDULED", goalsFor: undefined, goalsAgainst: undefined, result: undefined, venueSide: "NOT_RECORDED", kind: "FRIENDLY", date: "2026-11-01" })] : [],
      results: id === "men" ? [match({ competition: "SAFF Championship 2026", stage: "Group stage", group: "Group A", venue: "Dasharath Stadium", venueSide: "NEUTRAL", penaltiesFor: 4, penaltiesAgainst: 3, goalsFor: 1, goalsAgainst: 1 })] : [],
      asOf: "2026-08-01",
      provenanceStatus: "SIMULATION_ONLY",
    } as never),
  ),
  getNationalTeamSquad: vi.fn((id: string) =>
    ok({
      nationalTeam: { id, label: "Nepal Senior Men", entityReference: ref(id, "Nepal Senior Men", "NATIONAL_TEAM") },
      programme: "SENIOR_MENS",
      squadSize: id === "men" ? 2 : 0,
      selectedCount: id === "men" ? 2 : 0,
      unavailableCount: id === "men" ? 1 : 0,
      clubDistribution: id === "men" ? [{ club: ref("club1", "Three Star Club", "CLUB"), count: 2 }] : [],
      headCoach: id === "men" ? ref("c1", "Coach Rai", "STAFF") : undefined,
      players:
        id === "men"
          ? [
              { player: ref("p1", "Anjan Bista", "PLAYER"), personId: "p1", displayName: "Anjan Bista", position: "GOALKEEPER", currentClub: ref("club1", "Three Star Club", "CLUB"), age: 29, availability: "AVAILABLE", selectionStatus: "CALLED_UP", squadType: "FINAL", callupDate: "2026-08-01", internationalAppearances: 12 },
              { player: ref("p2", "Bimal Gurung", "PLAYER"), personId: "p2", displayName: "Bimal Gurung", position: "STRIKER", age: 24, availability: "INJURED", selectionStatus: "CALLED_UP", squadType: "FINAL", callupDate: "2026-08-01", internationalAppearances: 3 },
            ]
          : [],
      selectionHistory: [],
      asOf: "2026-08-01",
      supported: true,
    } as never),
  ),
};

let mod: typeof import("./NationalTeamScreens.js");
let selection: typeof import("./nationalTeamSelection.js");

beforeAll(async () => {
  mod = await import("./NationalTeamScreens.js");
  selection = await import("./nationalTeamSelection.js");
});

beforeEach(() => {
  vi.clearAllMocks();
  selection.selectNationalTeam(undefined);
});
afterEach(() => cleanup());

const props = (over: Record<string, unknown> = {}) => ({
  teams,
  bridge: bridge as never,
  onNavigate: vi.fn(),
  onOpenEntity: vi.fn(),
  ...over,
});

describe("National team helpers (Phase 10A)", () => {
  it("labels teams, scores and competitions from recorded fields only", () => {
    expect(mod.teamKind({ level: "senior", gender: "men" })).toBe("Senior men");
    expect(mod.teamKind({ level: "senior", gender: "women" })).toBe("Women & girls");
    expect(mod.teamKind({ level: "u17", gender: "men" })).toBe("Youth · U17");
    expect(mod.scoreText({ goalsFor: 2, goalsAgainst: 0 })).toBe("2–0");
    expect(mod.scoreText({ goalsFor: 1, goalsAgainst: 1, penaltiesFor: 4, penaltiesAgainst: 3 })).toBe("1–1 (4–3 on penalties)");
    expect(mod.scoreText({})).toBe("—");
    expect(mod.matchCompetition({ kind: "FRIENDLY" })).toBe("Friendly");
    expect(mod.matchCompetition({ kind: "QUALIFIER", competition: "SAFF 2026", stage: "Group stage", group: "Group A" })).toBe("SAFF 2026 · Group stage · Group A");
  });

  it("remembers the selected team, defaults to senior men, and survives a missing team", () => {
    const list = teams as unknown as Array<{ id: string; level: string; gender: string }>;
    expect(selection.resolveNationalTeam(list as never, undefined)?.id).toBe("men");
    expect(selection.resolveNationalTeam(list as never, "u17" as never)?.id).toBe("u17");
    expect(selection.resolveNationalTeam(list as never, "gone" as never)?.id).toBe("men");
    expect(selection.resolveNationalTeam([{ id: "x", level: "u20", gender: "men" }] as never, undefined)?.id).toBe("x");
    expect(selection.resolveNationalTeam([], undefined)).toBeUndefined();
  });
});

describe("National teams hub", () => {
  it("lists every team, opens one workspace and remembers the choice", () => {
    const onNavigate = vi.fn();
    render(<mod.NationalTeamsHub teams={teams} onNavigate={onNavigate} />);
    expect(screen.getAllByRole("article")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Open Nepal U17 Men (Youth · U17)" }));
    expect(onNavigate).toHaveBeenCalledWith("national-team-overview");
    expect(selection.getSelectedNationalTeam()).toBe("u17");
  });

  it("is honest when no team is recorded", () => {
    render(<mod.NationalTeamsHub teams={[] as never} onNavigate={() => {}} />);
    expect(screen.getByText(/No national teams are recorded/)).toBeTruthy();
  });
});

describe("National team overview", () => {
  it("shows identity, coach, squad, matches, competition and routes attention", async () => {
    const p = props();
    render(<mod.NationalTeamOverviewScreen {...p} />);
    await screen.findByText("Coach Rai");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Senior men/);
    expect(body).toMatch(/All Nepal Football Association/);
    expect(body).toMatch(/Anjan Bista/);
    expect(body).toMatch(/Called up23/);
    expect(body).toMatch(/Maldives/);
    expect(body).toMatch(/Away/);
    expect(body).toMatch(/SAFF Championship 2026/);
    expect(body).toMatch(/1W 1D 0L \(2 played\)/);
    expect(body).toMatch(/simulated/i);
    expect(body).not.toMatch(/strength|form rating|familiarity|cohesion|potential|ability/i);
    fireEvent.click(screen.getByRole("button", { name: "Open Squad" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Fixtures" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to Federation Overview" }));
    expect(p.onNavigate.mock.calls.map((call) => call[0])).toEqual(["national-team-squad", "national-team-fixtures", "federation-overview"]);
    fireEvent.click(screen.getByRole("button", { name: "Coach Rai" }));
    expect(p.onOpenEntity).toHaveBeenCalledWith("STAFF", "c1");
  });

  it("shows a vacancy and honest empties for a team with nothing recorded, without leaking the other team", async () => {
    selection.selectNationalTeam("women" as never);
    render(<mod.NationalTeamOverviewScreen {...props()} />);
    await screen.findByText("Nepal Senior Women");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Vacant/);
    expect(body).toMatch(/No match is scheduled/);
    expect(body).toMatch(/No results are recorded yet/);
    expect(body).toMatch(/not entered in a recorded competition/);
    expect(body).not.toMatch(/Maldives|Anjan Bista|Coach Rai/);
    expect(bridge.getNationalTeamOverview).toHaveBeenCalledWith("women");
  });

  it("switches team through the selector and reads that team only", async () => {
    render(<mod.NationalTeamOverviewScreen {...props()} />);
    await screen.findByText("Coach Rai");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "u17" } });
    await screen.findByText("Nepal U17 Men");
    expect(bridge.getNationalTeamOverview).toHaveBeenLastCalledWith("u17");
    expect(document.body.textContent).not.toMatch(/Anjan Bista/);
  });

  it("marks the current section in the family navigation", async () => {
    render(<mod.NationalTeamSquadScreen {...props()} />);
    await screen.findByText("Anjan Bista", { selector: "button" });
    const nav = screen.getByRole("navigation", { name: "National team sections" });
    expect(within(nav).getByRole("button", { name: "Squad" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("button", { name: "Staff" }).getAttribute("aria-current")).toBeNull();
    expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual(["All teams", "Team overview", "Squad", "Staff", "Fixtures"]);
  });
});

describe("National team squad, staff and fixtures", () => {
  it("lists called-up players with clickable player and club and no selection controls", async () => {
    const p = props();
    render(<mod.NationalTeamSquadScreen {...p} />);
    const table = await screen.findByRole("table", { name: "Players called up to this national team" });
    expect(table.textContent).toMatch(/Goalkeeper/);
    expect(table.textContent).toMatch(/Injured/);
    expect(table.textContent).toMatch(/Unattached/);
    fireEvent.click(within(table).getByRole("button", { name: "Anjan Bista" }));
    expect(p.onOpenEntity).toHaveBeenCalledWith("PLAYER", "p1");
    fireEvent.click(within(table).getByRole("button", { name: "Three Star Club" }));
    expect(p.onOpenEntity).toHaveBeenCalledWith("CLUB", "club1");
    expect(screen.queryByRole("button", { name: /call up|drop|replace|select|add player/i })).toBeNull();
    expect(document.body.textContent).toMatch(/cannot be changed from this\s+screen/);
    expect(screen.getByRole("region", { name: "Called-up players" }).getAttribute("tabindex")).toBe("0");
  });

  it("shows an honest empty squad", async () => {
    selection.selectNationalTeam("women" as never);
    render(<mod.NationalTeamSquadScreen {...props()} />);
    await screen.findByText(/No players are currently called up/);
    expect(document.body.textContent).toMatch(/No clubs are represented yet/);
  });

  it("shows staff with contract dates, links people, and states a vacancy without a hire control", async () => {
    const p = props();
    render(<mod.NationalTeamStaffScreen {...p} />);
    await screen.findByText("Asst Gurung");
    expect(document.body.textContent).toMatch(/2028-01-01/);
    expect(document.body.textContent).toMatch(/No contract end recorded/);
    fireEvent.click(screen.getByRole("button", { name: "Coach Rai" }));
    expect(p.onOpenEntity).toHaveBeenCalledWith("STAFF", "c1");
    cleanup();
    selection.selectNationalTeam("women" as never);
    render(<mod.NationalTeamStaffScreen {...props()} />);
    await screen.findByText(/no head coach/i);
    expect(document.body.textContent).toMatch(/No staff are recorded for this team/);
    expect(screen.queryByRole("button", { name: /appoint|hire|sack|dismiss/i })).toBeNull();
  });

  it("shows upcoming matches and results from the team's side", async () => {
    render(<mod.NationalTeamFixturesScreen {...props()} />);
    await waitFor(() => expect(screen.getAllByRole("table")).toHaveLength(2));
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Maldives/);
    expect(body).toMatch(/Not recorded/);
    expect(body).toMatch(/SAFF Championship 2026 · Group stage · Group A/);
    expect(body).toMatch(/Neutral venue · Dasharath Stadium/);
    expect(body).toMatch(/1–1 \(4–3 on penalties\)/);
    expect(body).toMatch(/Win/);
    expect(body).toMatch(/team’s side/);
    expect(body).not.toMatch(/form|rating|%/i);
  });

  it("shows honest empty fixtures", async () => {
    selection.selectNationalTeam("women" as never);
    render(<mod.NationalTeamFixturesScreen {...props()} />);
    await screen.findByText("No matches are scheduled.");
    expect(document.body.textContent).toMatch(/No results are recorded yet/);
  });

  it("has no team to show when the federation has none", () => {
    render(<mod.NationalTeamOverviewScreen {...props({ teams: [] })} />);
    expect(screen.getByText(/No national teams are recorded/)).toBeTruthy();
  });
});
