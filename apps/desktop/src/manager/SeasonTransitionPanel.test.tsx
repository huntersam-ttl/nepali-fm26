// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SeasonTransitionPanel } from "./SeasonTransitionPanel.js";

afterEach(() => cleanup());

const stages = (done: number, failedAt?: number) =>
  ["Closing competitions", "Promotion and relegation", "Transfer window"].map((label, index) => ({
    key: `s${index}`,
    label,
    state: (failedAt === index ? "FAILED" : index < done ? "DONE" : index === done ? "CURRENT" : "PENDING") as "DONE" | "CURRENT" | "PENDING" | "FAILED",
  }));

const complete = {
  phase: "COMPLETE" as const,
  seasonName: "Martyr's Memorial A-Division League 2026",
  competitions: { total: 6, completed: 6 },
  stages: stages(0),
  summary: { competition: "A-Division", champion: "Jawalakhel Youth Club", humanClub: "Church Boys United", humanClubPosition: 2, teams: 14 },
};

const running = (done: number) => ({
  phase: "TRANSITIONING" as const,
  competitions: { total: 6, completed: 6 },
  transition: { status: "RUNNING" as const, completedStages: done, totalStages: 3, currentStageLabel: stages(done)[done]?.label },
  stages: stages(done),
});

describe("SeasonTransitionPanel", () => {
  it("renders nothing while the season is in progress", () => {
    const { container } = render(
      <SeasonTransitionPanel status={{ phase: "IN_PROGRESS", competitions: { total: 6, completed: 2 }, stages: stages(0) }} bridge={{} as never} onStatus={() => {}} onFinished={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });

  it("shows what the finished season came to and offers to begin the next one", () => {
    render(<SeasonTransitionPanel status={complete} bridge={{} as never} onStatus={() => {}} onFinished={() => {}} />);
    expect(screen.getByRole("heading", { name: "Season complete", level: 2 })).toBeTruthy();
    expect(document.body.textContent).toMatch(/Jawalakhel Youth Club/);
    expect(document.body.textContent).toMatch(/Church Boys United finished2 of 14/);
    expect(screen.getByRole("button", { name: "Begin next season" })).toBeTruthy();
    // No fabricated progress before it starts.
    expect(screen.queryByRole("list", { name: "Season transition stages" })).toBeNull();
  });

  it("runs the stages one request at a time, reports progress, and finishes", async () => {
    const statuses = [running(1), running(2), { ...running(3), phase: "IN_PROGRESS" as const, transition: undefined, stages: stages(3) }];
    const advance = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { seasonStatus: statuses[0], finished: false } })
      .mockResolvedValueOnce({ ok: true, data: { seasonStatus: statuses[1], finished: false } })
      .mockResolvedValueOnce({ ok: true, data: { seasonStatus: statuses[2], finished: true } });
    const onStatus = vi.fn();
    const onFinished = vi.fn();
    render(<SeasonTransitionPanel status={complete} bridge={{ advanceSeasonTransition: advance } as never} onStatus={onStatus} onFinished={onFinished} />);
    fireEvent.click(screen.getByRole("button", { name: "Begin next season" }));
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(advance).toHaveBeenCalledTimes(3);
    expect(onStatus.mock.calls.map((call) => call[0].phase)).toEqual(["TRANSITIONING", "TRANSITIONING", "IN_PROGRESS"]);
  });

  it("announces the current stage as a polite status and lists every stage with its state", () => {
    render(<SeasonTransitionPanel status={running(1)} bridge={{} as never} onStatus={() => {}} onFinished={() => {}} />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Processing new season — 2 of 3: Promotion and relegation");
    const list = screen.getByRole("list", { name: "Season transition stages" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Closing competitions — Done",
      "Promotion and relegation — In progress",
      "Transfer window — Waiting",
    ]);
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("states a failed stage plainly and lets the player try again", async () => {
    const failed = {
      phase: "TRANSITION_FAILED" as const,
      competitions: { total: 6, completed: 6 },
      transition: { status: "FAILED" as const, completedStages: 1, totalStages: 3, currentStageLabel: "Promotion and relegation", error: "disk is full" },
      stages: stages(1, 1),
    };
    const advance = vi.fn().mockResolvedValue({ ok: true, data: { seasonStatus: failed, finished: false } });
    render(<SeasonTransitionPanel status={failed} bridge={{ advanceSeasonTransition: advance } as never} onStatus={() => {}} onFinished={() => {}} />);
    expect(screen.getByRole("heading", { name: "The new season could not be prepared", level: 2 })).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Promotion and relegation failed: disk is full/);
    expect(alert.textContent).toMatch(/Nothing from that stage was kept/);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(advance).toHaveBeenCalledTimes(1));
  });

  it("shows a request failure without losing the place", async () => {
    const advance = vi.fn().mockResolvedValue({ ok: false, error: { code: "SIMULATION_ERROR", message: "The career command failed." } });
    render(<SeasonTransitionPanel status={complete} bridge={{ advanceSeasonTransition: advance } as never} onStatus={() => {}} onFinished={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Begin next season" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Begin next season" })).toBeTruthy();
  });
});
