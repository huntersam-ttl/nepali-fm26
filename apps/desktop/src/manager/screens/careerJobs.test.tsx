// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JobApplicationView, JobCentreView, JobVacancyView, ManagerDashboard } from "@nepal-football-sim/shared-types";

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });
const id = <T extends string>(value: T) => value as unknown as never;

const vacancy = (over: Partial<JobVacancyView>): JobVacancyView =>
  ({
    id: id("v1"),
    clubName: "Church Boys United",
    teamName: "Church Boys United",
    competitionName: "A-Division League",
    openedOn: "2025-08-01",
    reason: "SACKED",
    boardExpectation: "MID_TABLE",
    eligible: true,
    ...over,
  }) as JobVacancyView;

const application = (over: Partial<JobApplicationView>): JobApplicationView =>
  ({
    id: id("a1"),
    vacancyId: id("v1"),
    clubName: "Church Boys United",
    teamName: "Church Boys United",
    status: "OFFERED",
    createdOn: "2025-08-02",
    decidedOn: "2025-08-02",
    offeredSalaryMinor: 6_000_000,
    offeredContractEnd: "2027-08-02",
    ...over,
  }) as JobApplicationView;

let centre: JobCentreView;
let dashboard: ManagerDashboard;

const bridge = {
  getJobCentre: vi.fn(() => ok(centre)),
  getManagerDashboard: vi.fn(() => ok(dashboard)),
  applyForJob: vi.fn(() => ok(centre)),
  acceptJobOffer: vi.fn(() => ok({})),
  declineJobOffer: vi.fn(() => ok(centre)),
  resignFromClub: vi.fn(() => ok({})),
};

vi.mock("../managerBridge.js", () => ({ managerBridge: bridge }));

let mod: typeof import("./CareerJobsScreen.js");

beforeAll(async () => {
  mod = await import("./CareerJobsScreen.js");
});

beforeEach(() => {
  vi.clearAllMocks();
  dashboard = { employmentStatus: "UNEMPLOYED", clubName: undefined } as unknown as ManagerDashboard;
  centre = {
    reputationProfile: "LOCAL_RESPECTED",
    vacancies: [
      vacancy({ id: id("v2"), clubName: "Zeta FC", openedOn: "2025-07-01", eligible: false, eligibilityNote: "This club expects a manager with an established reputation." }),
      vacancy({ id: id("v1"), clubName: "Alpha FC", openedOn: "2025-08-01" }),
    ],
    applications: [application({ clubName: "Alpha FC" })],
  };
});

afterEach(() => cleanup());

const renderScreen = () => render(<mod.CareerJobsScreen refreshKey={0} onCareerChanged={async () => {}} />);

describe("Career Jobs mapping (Phase 8C)", () => {
  it("orders vacancies newest first, then by club", () => {
    const ordered = mod.sortedVacancies(centre.vacancies);
    expect(ordered.map((v) => v.clubName)).toEqual(["Alpha FC", "Zeta FC"]);
  });

  it("orders applications newest first and maps status text and tone", () => {
    const ordered = mod.sortedApplications([
      application({ id: id("a1"), createdOn: "2025-08-01" }),
      application({ id: id("a2"), createdOn: "2025-08-05", status: "REJECTED" }),
    ]);
    expect(ordered.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(mod.statusLabel("OFFERED")).toBe("Offered");
    expect(mod.statusTone("OFFERED")).toBe("ok");
    expect(mod.statusTone("REJECTED")).toBe("bad");
    expect(mod.statusTone("PENDING")).toBe("info");
  });

  it("finds the latest application per vacancy", () => {
    const latest = mod.latestApplicationByVacancy([
      application({ id: id("a1"), createdOn: "2025-08-01", status: "REJECTED" }),
      application({ id: id("a2"), createdOn: "2025-08-09", status: "OFFERED" }),
    ]);
    expect(latest.get("v1")?.id).toBe("a2");
  });
});

describe("Career Jobs screen", () => {
  it("shows the unemployed situation, vacancies and eligibility reasons from the read model", async () => {
    renderScreen();
    await screen.findByText(/You are currently unemployed/i);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Alpha FC/);
    expect(body).toMatch(/Not eligible/);
    expect(body).toMatch(/established reputation/);
    expect(body).toMatch(/Respected locally/);
  });

  it("never fabricates salary, deadlines or hidden scoring", async () => {
    renderScreen();
    await screen.findByText(/You are currently unemployed/i);
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/salary|wage|deadline|closing|closes|probability|ranking|shortlist|interview score/i);
    expect(body).not.toMatch(/6,000,000|6000000/);
  });

  it("applies through the canonical command with the vacancy id", async () => {
    centre = { ...centre, applications: [] };
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Apply to Alpha FC" }));
    await waitFor(() => expect(bridge.applyForJob).toHaveBeenCalledWith("v1"));
  });

  it("does not offer Apply on a vacancy that already has an offer", async () => {
    renderScreen();
    const button = (await screen.findByRole("button", { name: "Apply to Alpha FC" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("does not offer Apply for an ineligible vacancy", async () => {
    renderScreen();
    const button = (await screen.findByRole("button", { name: "Apply to Zeta FC" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("accepts and declines an offer through the canonical commands", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Accept offer from Alpha FC" }));
    await waitFor(() => expect(bridge.acceptJobOffer).toHaveBeenCalledWith("a1"));
    fireEvent.click(await screen.findByRole("button", { name: "Decline offer from Alpha FC" }));
    await waitFor(() => expect(bridge.declineJobOffer).toHaveBeenCalledWith("a1"));
  });

  it("lets an employed manager apply, and asks for confirmation before an offer ends the current job", async () => {
    dashboard = { employmentStatus: "EMPLOYED", clubName: "Some United" } as unknown as ManagerDashboard;
    centre = { ...centre, applications: [application({ vacancyId: id("v9") })] };
    renderScreen();
    await screen.findByText(/You are currently employed at Some United/i);

    fireEvent.click(await screen.findByRole("button", { name: "Accept offer from Church Boys United" }));
    // Nothing is sent until the move is confirmed.
    expect(bridge.acceptJobOffer).not.toHaveBeenCalled();
    const group = await screen.findByRole("group", { name: "Confirm career move" });
    expect(group.textContent).toMatch(/ends your appointment at Some United, recorded as resigned/i);

    fireEvent.click(screen.getByRole("button", { name: "Confirm move" }));
    await waitFor(() => expect(bridge.acceptJobOffer).toHaveBeenCalledWith("a1"));
  });

  it("can cancel a pending move without sending a command", async () => {
    dashboard = { employmentStatus: "EMPLOYED", clubName: "Some United" } as unknown as ManagerDashboard;
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Accept offer from Alpha FC" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(bridge.acceptJobOffer).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Confirm career move" })).toBeNull();
  });

  it("resigns through the canonical command only after confirmation, and only while employed", async () => {
    dashboard = { employmentStatus: "EMPLOYED", clubName: "Some United" } as unknown as ManagerDashboard;
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Resign from Some United" }));
    expect(bridge.resignFromClub).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm resignation" }));
    await waitFor(() => expect(bridge.resignFromClub).toHaveBeenCalledTimes(1));

    cleanup();
    dashboard = { employmentStatus: "UNEMPLOYED" } as unknown as ManagerDashboard;
    renderScreen();
    await screen.findByText(/You are currently unemployed/i);
    expect(screen.queryByRole("button", { name: /^Resign/ })).toBeNull();
  });

  it("shows honest empty states", async () => {
    centre = { reputationProfile: "UNKNOWN", vacancies: [], applications: [] };
    renderScreen();
    expect(await screen.findByText(/No manager vacancies are open right now/i)).toBeTruthy();
    expect(await screen.findByText(/You have not applied anywhere yet/i)).toBeTruthy();
  });

  it("surfaces a backend rejection instead of changing status locally", async () => {
    centre = { ...centre, applications: [] };
    bridge.applyForJob.mockResolvedValueOnce({ ok: false as const, error: { message: "Vacancy is no longer open." } } as never);
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Apply to Alpha FC" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/no longer open/i);
  });
});
