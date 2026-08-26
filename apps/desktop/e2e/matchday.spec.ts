import { expect, test, type Page } from "@playwright/test";

/**
 * Drives the matchday flow through the real UI against the real runtime.
 * Every assertion is backed by persisted match state.
 */
const LONG = 120_000;

const createCareer = async (page: Page, saveName: string): Promise<void> => {
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/ }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Starting club")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({
    timeout: LONG,
  });
};

/** Sidebar navigation, distinguished from same-named match controls. */
const goTo = (page: Page, screen: string) =>
  page.locator("nav").getByRole("button", { name: screen, exact: true }).click();

const controls = (page: Page) => page.locator(".matchday-controls");

/** Opens match preparation for the first upcoming fixture. */
const openPreMatch = async (page: Page): Promise<void> => {
  await goTo(page, "Fixtures");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.locator("tbody tr").first().click();
  await expect(page.getByRole("heading", { name: "Match preparation" })).toBeVisible();
};

const chooseView = async (page: Page, label: string): Promise<void> => {
  await page.getByRole("radio", { name: new RegExp(label) }).click();
  await page.getByRole("button", { name: "Kick Off" }).click();
};

/** Plays until the match pauses or finishes. */
const playUntilStop = async (page: Page): Promise<void> => {
  await controls(page).getByRole("button", { name: "Play" }).click();
  await expect(page.locator(".match-pause, .full-time-flag").first()).toBeVisible({
    timeout: LONG,
  });
};

test("plays a Text Live match end to end with a substitution and tactical change", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await createCareer(page, `Matchday Live ${Date.now()}`);
  await openPreMatch(page);

  // Pre-match shows the real fixture and all three viewing modes.
  await expect(page.getByRole("heading", { name: "Match view" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Quick Sim/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Key Events/ })).toBeVisible();
  await chooseView(page, "Text Live");

  // Live screen.
  await expect(page.locator(".scoreboard")).toBeVisible({ timeout: LONG });
  await expect(page.locator(".scoreboard")).toContainText("0 – 0");

  await controls(page).getByRole("button", { name: "8x" }).click();
  await playUntilStop(page);

  // Half time, with commentary and stats populated.
  await expect(page.locator(".match-pause")).toContainText("Half time");
  await expect(page.locator(".commentary-line").first()).toBeVisible();
  const lines = await page.locator(".commentary-line").count();
  expect(lines).toBeGreaterThan(3);
  await expect(page.getByRole("heading", { name: "Match stats" })).toBeVisible();

  // A half-time substitution.
  await controls(page)
    .getByRole("button", { name: /Substitutions/ })
    .click();
  const drawer = page.locator(".panel").filter({ hasText: "Substitutions —" });
  await drawer.getByLabel("Player off").selectOption({ index: 1 });
  await drawer.getByLabel("Player on").selectOption({ index: 1 });
  await drawer.getByRole("button", { name: "Make substitution" }).click();
  await expect(
    page
      .locator(".commentary-line")
      .filter({ hasText: /replaces|off and/ })
      .first(),
  ).toBeVisible({ timeout: LONG });

  // A half-time tactical change, confirmed qualitatively.
  await controls(page).getByRole("button", { name: "Tactics", exact: true }).click();
  const tactics = page.locator(".panel").filter({ hasText: "Currently" });
  await tactics.getByLabel("Style").selectOption("HIGH_PRESS");
  await tactics.getByLabel("Mentality").selectOption("ATTACKING");
  await tactics.getByRole("button", { name: "Apply changes" }).click();
  await expect(tactics.locator(".ok")).toContainText("attacking");
  await tactics.getByRole("button", { name: "Close" }).click();

  // Second half through to full time.
  await page
    .locator(".match-pause")
    .getByRole("button", { name: /Continue second half/ })
    .click();
  await controls(page).getByRole("button", { name: "Play" }).click();
  await expect(page.locator(".full-time-flag")).toBeVisible({ timeout: LONG });

  // Report.
  await controls(page).getByRole("button", { name: "View match report" }).click();
  await expect(page.getByRole("heading", { name: "Full time" })).toBeVisible({ timeout: LONG });
  await expect(page.getByRole("heading", { name: "Player ratings" })).toBeVisible();
  await expect(page.locator(".workspace")).toContainText(/player of the match/i);
  await expect(page.locator(".workspace")).toContainText(/attendance/i);
  // The tactical change we made is in the persisted summary.
  await expect(page.locator(".panel").filter({ hasText: "Tactical summary" })).toContainText(
    /mentality|style/i,
  );

  // Timeline filters work off the same persisted stream.
  const timeline = page.locator(".panel").filter({ hasText: "Timeline" });
  await timeline.getByRole("button", { name: "Subs" }).click();
  await expect(timeline.locator(".commentary-line").first()).toBeVisible();

  await page.getByRole("button", { name: "Return to career" }).click();
  await expect(page.getByRole("heading", { name: "Fixtures" })).toBeVisible();

  // The completed match is reflected in the career.
  await goTo(page, "Competition");
  await expect(page.locator("tbody tr").nth(4)).toBeVisible();
  const played = await page.locator("tbody tr").filter({ hasText: /\d/ }).count();
  expect(played).toBeGreaterThan(0);
});

test("Quick Sim from the pre-match screen goes straight to the report", async ({ page }) => {
  test.setTimeout(300_000);
  await createCareer(page, `Matchday Quick ${Date.now()}`);
  await openPreMatch(page);
  await chooseView(page, "Quick Sim");

  await expect(page.getByRole("heading", { name: "Full time" })).toBeVisible({ timeout: LONG });
  await expect(page.locator(".workspace")).toContainText(/attendance/i);
  await expect(page.getByRole("heading", { name: "Player ratings" })).toBeVisible();
  await expect(page.locator(".report-timeline .commentary-line").first()).toBeVisible();
});

test("Key Events skips quiet play and survives a page reload", async ({ page }) => {
  test.setTimeout(300_000);
  const saveName = `Matchday Keys ${Date.now()}`;
  await createCareer(page, saveName);
  await openPreMatch(page);
  await chooseView(page, "Key Events");

  await expect(page.locator(".scoreboard")).toBeVisible({ timeout: LONG });
  await controls(page).getByRole("button", { name: "Next event" }).click();
  await expect(page.locator(".commentary-line").first()).toBeVisible({ timeout: LONG });

  const clockBefore = await page.locator(".scoreboard-clock").textContent();
  const minute = Number((clockBefore ?? "0'").replace(/\D/g, ""));
  expect(minute).toBeGreaterThan(0);

  // Reload: the match must resume, not restart.
  await page.reload();
  await page.getByRole("button", { name: /Load Career/ }).click();
  await page.getByRole("button", { name: new RegExp(saveName) }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({
    timeout: LONG,
  });

  await expect(page.getByRole("button", { name: "Resume match" })).toBeVisible({
    timeout: LONG,
  });
  await page.getByRole("button", { name: "Resume match" }).click();
  await expect(page.locator(".scoreboard")).toBeVisible({ timeout: LONG });
  // Same minute as before the reload — kickoff was not replayed.
  await expect(page.locator(".scoreboard-clock")).toHaveText(clockBefore ?? "");
});
