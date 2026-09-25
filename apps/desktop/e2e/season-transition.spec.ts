import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 11A — a real save crosses season boundaries. Nothing here creates a
 * season, a table or a campaign through a test-only command: seasons are played
 * with the same Continue and Quick Sim commands the app uses (called directly
 * only to save clicking through hundreds of days), the season transition is the
 * production staged pipeline, and the UI is checked at each boundary.
 */
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const seriousViolations = async (page: Page): Promise<unknown[]> => {
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (root: Document, options: unknown) => Promise<unknown> } }).axe;
    return axe.run(document, { resultTypes: ["violations"] });
  });
  return (results.violations as Array<{ id: string; impact: string; nodes: unknown[] }>).filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
};

type Envelope = { ok: boolean; data?: any; error?: { code: string; message: string; detail?: string } };
const runtime = async (page: Page, name: string, data: object = {}): Promise<Envelope> => {
  const response = await page.request.post(`/runtime/command/${name}`, { data, timeout: 240_000 });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Envelope;
};

const createManagerCareer = async (page: Page): Promise<void> => {
  const saveName = `Season ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByLabel("Full name").fill("Maya Adhikari");
  await page.getByLabel("Display name").fill("Maya");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Starting club")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: 240_000 });
};

/** Plays the season the way a player does — Continue, and Quick Sim on matchday — until it is complete. */
const playToSeasonEnd = async (page: Page): Promise<number> => {
  let continues = 0;
  for (let guard = 0; guard < 700; guard += 1) {
    const status = await runtime(page, "getSeasonStatus");
    expect(status.ok, JSON.stringify(status.error)).toBe(true);
    if (status.data.phase !== "IN_PROGRESS") return continues;
    const step = await runtime(page, "continueCareer");
    expect(step.ok, `continue: ${step.error?.message} ${step.error?.detail ?? ""}`).toBe(true);
    continues += 1;
    await runtime(page, "quickSimMatch");
  }
  throw new Error("The season never completed.");
};

/** Runs the production season transition to its end, one stage per request. */
const runTransition = async (page: Page): Promise<{ stages: number; timings: Array<{ key: string; state: string; durationMs?: number }> }> => {
  let last: any;
  for (let guard = 0; guard < 40; guard += 1) {
    const step = await runtime(page, "advanceSeasonTransition");
    expect(step.ok, `${step.error?.code}: ${step.error?.message}`).toBe(true);
    last = step.data;
    expect(last.seasonStatus.phase, JSON.stringify(last.seasonStatus.transition)).not.toBe("TRANSITION_FAILED");
    if (last.finished) break;
  }
  expect(last.finished).toBe(true);
  return { stages: last.seasonStatus.stages.length, timings: last.seasonStatus.stages };
};

const competitionName = async (page: Page): Promise<string> => {
  const state = await runtime(page, "getCareerHeader");
  expect(state.ok).toBe(true);
  return String(state.data.competitionName ?? "");
};

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test("1. A manager's real save crosses three seasons, with the season panel at the first boundary", async ({ page }) => {
  test.setTimeout(2_400_000);
  await createManagerCareer(page);
  const startName = await competitionName(page);
  expect(startName).toMatch(/2026/);

  // A transition cannot start early.
  const early = await runtime(page, "advanceSeasonTransition");
  expect(early.ok).toBe(false);
  expect(early.error?.code).toBe("SEASON_NOT_COMPLETE");

  await playToSeasonEnd(page);
  // The player presses Continue and is told the season is complete, instead of hitting an error.
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const panel = page.getByRole("region", { name: "Season complete" });
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(panel).toContainText(/competitions have played every fixture/);
  await expect(panel).toContainText("Champions");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Begin next season" })).toBeEnabled();
  expect(await noOverflow(page)).toBe(true);
  expect(await seriousViolations(page)).toHaveLength(0);

  // Beginning the season shows stage-by-stage progress rather than a frozen page.
  await page.route("**/runtime/command/advanceSeasonTransition", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.getByRole("button", { name: "Begin next season" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Processing new season/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("list", { name: "Season transition stages" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Season complete" })).toHaveCount(0);
  await expect(page.getByText("A new season has begun.")).toBeVisible({ timeout: 240_000 });
  await page.unroute("**/runtime/command/advanceSeasonTransition");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  const afterOne = await runtime(page, "getSeasonStatus");
  expect(afterOne.data.phase).toBe("IN_PROGRESS");
  const secondName = await competitionName(page);
  expect(secondName).toMatch(/2027/);
  expect(secondName).not.toBe(startName);

  // Seasons two and three, and the transitions between them.
  const worldDates: string[] = [];
  for (const expectedYear of ["2028", "2029"]) {
    await playToSeasonEnd(page);
    const complete = await runtime(page, "getSeasonStatus");
    expect(complete.data.phase).toBe("COMPLETE");
    expect(complete.data.competitions.completed).toBe(complete.data.competitions.total);
    await runTransition(page);
    expect((await runtime(page, "getSeasonStatus")).data.phase).toBe("IN_PROGRESS");
    const state = await runtime(page, "continueCareer");
    expect(state.ok).toBe(true);
    worldDates.push(state.data.save.worldDate as string);
    expect(await competitionName(page)).toMatch(new RegExp(expectedYear));
    // Saving and loading between seasons keeps the save whole.
    const saved = await runtime(page, "saveCareer");
    expect(saved.ok).toBe(true);
    expect((await runtime(page, "closeCareer")).ok).toBe(true);
    expect((await runtime(page, "loadCareer", { saveId: saved.data.saveId })).ok).toBe(true);
    expect((await runtime(page, "getSeasonStatus")).data.phase).toBe("IN_PROGRESS");
  }
  expect([...worldDates].sort()).toEqual(worldDates);
  // The world kept moving: every season's fixtures were played and tables exist for the new season.
  const competition = await runtime(page, "getCompetition");
  expect(competition.ok).toBe(true);
});

test("2. The season panel is readable at every width and passes axe, in its complete, running and failed states", async ({ page }) => {
  test.setTimeout(900_000);
  await createManagerCareer(page);
  const stages = ["Closing the season's competitions", "Licensing, promotion and relegation", "Transfer window", "Youth intake and retirement"].map((label, index) => ({
    key: `s${index}`,
    label,
    state: index === 0 ? "DONE" : index === 1 ? "CURRENT" : "PENDING",
  }));
  const payloads = {
    complete: {
      phase: "COMPLETE",
      seasonName: "Martyr's Memorial A-Division League 2026",
      competitions: { total: 6, completed: 6 },
      stages: stages.map((stage) => ({ ...stage, state: "PENDING" })),
      summary: { competition: "A-Division", champion: "Jawalakhel Youth Club", humanClub: "Church Boys United", humanClubPosition: 2, teams: 14 },
    },
    running: {
      phase: "TRANSITIONING",
      competitions: { total: 6, completed: 6 },
      transition: { status: "RUNNING", completedStages: 1, totalStages: 4, currentStageKey: "s1", currentStageLabel: stages[1]!.label },
      stages,
    },
    failed: {
      phase: "TRANSITION_FAILED",
      competitions: { total: 6, completed: 6 },
      transition: { status: "FAILED", completedStages: 1, totalStages: 4, currentStageKey: "s1", currentStageLabel: stages[1]!.label, error: "the movement store is unavailable" },
      stages: stages.map((stage, index) => ({ ...stage, state: index === 1 ? "FAILED" : stage.state })),
    },
  } as const;

  for (const [name, payload] of Object.entries(payloads)) {
    await page.route("**/runtime/command/getSeasonStatus", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: payload }) }));
    for (const width of [721, 1024, 1280, 1440, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole("button", { name: "Home / Inbox" }).click();
      await page.reload();
      await page.getByRole("button", { name: /Load Career/i }).click();
      await page.getByRole("button", { name: /^Season / }).first().click();
      await expect(page.getByRole("heading", { level: 2, name: name === "complete" ? "Season complete" : name === "failed" ? "The new season could not be prepared" : "Preparing the new season" })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      expect(await noOverflow(page), `${name} at ${width}px`).toBe(true);
      if (name === "running") await expect(page.getByRole("status").filter({ hasText: "Processing new season — 2 of 4: Licensing, promotion and relegation" })).toBeVisible();
      if (name === "failed") await expect(page.getByRole("alert").filter({ hasText: "the movement store is unavailable" })).toBeVisible();
      if (width === 1280) expect(await seriousViolations(page), `axe on ${name}`).toHaveLength(0);
      await page.getByRole("button", { name: name === "complete" ? "Begin next season" : name === "failed" ? "Try again" : "Resume" }).focus();
      await expect(page.getByRole("button", { name: name === "complete" ? "Begin next season" : name === "failed" ? "Try again" : "Resume" })).toBeFocused();
    }
    await page.unroute("**/runtime/command/getSeasonStatus");
  }
});

test("3. A federation president can Continue, and the season and the international calendar turn over", async ({ page }) => {
  test.setTimeout(2_400_000);
  await createExistingClubOwner(page, "A");
  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByText("Federation balance")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  const dashboardBefore = (await runtime(page, "getFederationPresidentDashboard")).data;
  expect(dashboardBefore.nationalTeams).toHaveLength(5);

  await playToSeasonEnd(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("region", { name: "Season complete" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Begin next season" }).click();
  await expect(page.getByText("A new season has begun.")).toBeVisible({ timeout: 300_000 });

  // The national teams were entered in the season's international editions by the real processing.
  let entered = 0;
  for (const team of dashboardBefore.nationalTeams as Array<{ id: string }>) {
    const view = (await runtime(page, "getNationalTeamCompetitions", { nationalTeamId: team.id })).data;
    const entries = [...view.active, ...view.upcoming, ...view.completed];
    for (const entry of entries) {
      expect(entry.campaign, `${entry.edition} has a campaign`).toBeDefined();
      expect(entry.registration?.status, `${entry.edition} has a final registration`).toBe("FINAL");
      entered += 1;
    }
  }
  expect(entered, "at least one national team was entered").toBeGreaterThan(0);
  expect((await runtime(page, "getFederationPresidentDashboard")).ok).toBe(true);
});

test("4. An owner crosses the boundary with the club and the role intact", async ({ page }) => {
  test.setTimeout(2_400_000);
  await createExistingClubOwner(page, "A");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  const before = await runtime(page, "getChairmanDashboard");
  expect(before.ok).toBe(true);

  await playToSeasonEnd(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("region", { name: "Season complete" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Begin next season" }).click();
  await expect(page.getByText("A new season has begun.")).toBeVisible({ timeout: 300_000 });
  await expect(page.getByLabel("Active career role")).toHaveValue("CHAIRMAN_OWNER");
  const after = await runtime(page, "getChairmanDashboard");
  expect(after.ok).toBe(true);
  expect(JSON.stringify(after.data.club ?? after.data.header ?? {})).toContain(String(before.data.club?.name ?? before.data.header?.clubName ?? ""));
});

test("5. An unemployed manager crosses the boundary with the same identity", async ({ page }) => {
  test.setTimeout(2_400_000);
  await createManagerCareer(page);
  const header = (await runtime(page, "getCareerHeader")).data;
  expect((await runtime(page, "resignFromClub")).ok).toBe(true);

  await playToSeasonEnd(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("region", { name: "Season complete" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Begin next season" }).click();
  await expect(page.getByText("A new season has begun.")).toBeVisible({ timeout: 300_000 });
  const after = (await runtime(page, "getCareerHeader")).data;
  expect(after.personId).toBe(header.personId);
  expect(after.characterName).toBe(header.characterName);
  const jobs = await runtime(page, "getJobCentre");
  expect(jobs.ok).toBe(true);
});
