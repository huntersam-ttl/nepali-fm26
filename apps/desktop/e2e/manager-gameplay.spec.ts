import { expect, test, type Page } from "@playwright/test";

/**
 * Walks the full Manager gameplay loop against the real runtime and real
 * SQLite saves. Every assertion here is backed by persisted world state.
 */
const CAREER_TIMEOUT = 120_000;

const openCareer = async (page: Page, saveName: string): Promise<string> => {
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const clubPicker = page.getByLabel("Starting club");
  await expect(clubPicker).toBeVisible();
  // The picker is a role="group" of club buttons, not a <select>: the club's
  // own name is the button's <strong>, never an <option>'s text.
  const clubName = ((await clubPicker.locator("button.club-row strong").first().textContent()) ?? "").trim();
  expect(clubName).not.toMatch(/Testing|Sample|Demo/);

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({
    timeout: CAREER_TIMEOUT,
  });
  return clubName;
};

const goTo = async (page: Page, screen: string): Promise<void> => {
  await page.getByRole("button", { name: screen, exact: true }).click();
};

test("plays a manager career through every gameplay screen and persists it", async ({ page }) => {
  test.setTimeout(300_000);
  const saveName = `E2E Manager ${Date.now()}`;
  const clubName = await openCareer(page, saveName);

  // --- Home ---------------------------------------------------------------
  await expect(page.getByRole("heading", { name: "Club", exact: true })).toBeVisible();
  // The competition is world data, not a fixed league name. The old
  // "ANFA National League" expectation stopped matching the default club's
  // real competition, so read what the shell reports and prove Home shows the
  // same thing — a cross-check between two regions rather than a pinned name.
  const competition = ((await page.locator(".topbar span[title]").first().textContent()) ?? "").trim();
  expect(competition.length, "the shell should report a competition").toBeGreaterThan(0);
  await expect(page.locator(".panel").filter({ hasText: "Next fixture" })).toContainText(competition);
  const worldDate = await page.locator(".topbar strong").nth(1).textContent();

  // --- Squad and player profile -------------------------------------------
  await goTo(page, "Squad");
  // Squad renders two tables. "Player lifestyle & manager support" comes first
  // in the DOM, its rows carry no click handler, and it only appears when the
  // club has lifestyle/support reads — so an unscoped "tbody tr" targets a
  // non-navigating row for some clubs. Scope to the rows that open a profile.
  const squadRows = page.locator("tbody tr:has(td.squad-name-cell)");
  await expect(squadRows.nth(10)).toBeVisible();
  await page.getByLabel("Availability").selectOption("AVAILABLE");
  await expect(squadRows.first()).toBeVisible();

  const firstPlayer =
    ((await squadRows.first().locator("td.squad-name-cell").textContent()) ?? "").trim();
  await squadRows.first().click();
  await expect(page.getByRole("heading", { name: firstPlayer })).toBeVisible();
  await expect(page.locator(".workspace")).toContainText("Attributes");
  await expect(page.locator(".workspace")).toContainText("Technical");
  await page.getByRole("button", { name: /Back to squad/ }).click();

  // --- Tactics: change formation and confirm it survives a screen change ---
  await goTo(page, "Tactics");
  await expect(page.locator(".pitch .slot")).toHaveCount(11);
  await page.getByLabel("Formation").selectOption({ label: "4-4-2" });
  const selectedFormation = await page.getByLabel("Formation").inputValue();
  await expect(page.getByLabel("Formation").locator("option:checked")).toHaveText("4-4-2");
  await expect(page.locator(".pitch .slot")).toHaveCount(11);
  await page.getByLabel("Style").selectOption("HIGH_PRESS");
  await goTo(page, "Home / Inbox");
  await goTo(page, "Tactics");
  await expect(page.getByLabel("Formation")).toHaveValue(selectedFormation);
  await expect(page.getByLabel("Style")).toHaveValue("HIGH_PRESS");

  // --- Training ------------------------------------------------------------
  await goTo(page, "Training");
  await page.getByLabel("Overall intensity").selectOption("HIGH");
  await expect(page.locator(".workspace")).toContainText("Squad development");

  // --- Scouting and shortlist ---------------------------------------------
  await goTo(page, "Scouting");
  await expect(page.locator(".workspace")).toContainText("Scouting coverage");
  await page.getByRole("button", { name: "Shortlist" }).first().click();
  await expect(page.getByRole("button", { name: "Unshortlist" }).first()).toBeVisible();

  // --- Transfers -----------------------------------------------------------
  await goTo(page, "Transfers");
  await expect(page.locator(".workspace")).toContainText("Transfer budget");
  await page.getByRole("button", { name: "Targets" }).click();
  await expect(page.getByRole("button", { name: "Make offer" }).first()).toBeVisible();

  // --- Contracts -----------------------------------------------------------
  await goTo(page, "Contracts");
  await expect(page.locator(".workspace")).toContainText("Squad wage bill");
  await expect(page.locator("tbody tr").first()).toBeVisible();

  // --- Staff (honest empty state) -----------------------------------------
  await goTo(page, "Staff");
  await expect(page.getByRole("heading", { name: "Vacancies" })).toBeVisible();

  // --- Competition ---------------------------------------------------------
  await goTo(page, "Competition");
  // Wait for the table to render before counting; `count()` does not auto-wait.
  await expect(page.locator("tbody tr").nth(4)).toBeVisible();

  // --- Fixtures and Quick Sim ---------------------------------------------
  await goTo(page, "Fixtures");
  await expect(page.locator("tbody tr").nth(4)).toBeVisible();

  // A fixture is only playable once world time reaches it (4130eeb, "enforce
  // current fixture integrity"): future rows render "Future · read only" with
  // aria-disabled, so the row itself cannot be clicked on a fresh career.
  // Advance the way a player does, then enter through the Matchday CTA.
  // Advancing does not remove the fixture from the upcoming list — only
  // playing it does — so the count invariant below is unaffected.
  const matchdayCta = page.getByRole("button", { name: /Matchday/ });
  const advance = page.locator(".topbar").getByRole("button", { name: "Continue", exact: true });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await matchdayCta.count()) break;
    // Continue disables itself the instant a matchday becomes pending, and the
    // fixtures effect that sets that state resolves asynchronously. isEnabled()
    // is only a snapshot: a click issued while it reads true can become
    // impossible a moment later, and Playwright then retries actionability
    // until the whole test times out. Bound each attempt so the loop gets to
    // re-check the CTA instead of blocking on a button that will never enable.
    await advance.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }
  await goTo(page, "Fixtures");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const upcomingBefore = await page.locator("tbody tr").count();

  await expect(matchdayCta).toBeVisible({ timeout: CAREER_TIMEOUT });
  await matchdayCta.click();
  await expect(page.getByRole("heading", { name: "Match preparation" })).toBeVisible({
    timeout: CAREER_TIMEOUT,
  });
  await expect(page.locator(".workspace")).toContainText("Selected XI");

  // Step 4D routes matches through the matchday flow; Quick Sim is a match view
  // chosen before kick-off. Full matchday coverage lives in matchday.spec.ts.
  await page.getByRole("radio", { name: /Quick Sim/ }).click();
  await page.getByRole("button", { name: "Kick Off" }).click();
  await expect(page.getByRole("heading", { name: "Full time" })).toBeVisible({
    timeout: CAREER_TIMEOUT,
  });
  await expect(page.locator(".report-score")).toContainText(/\d+ – \d+/);

  await page.getByRole("button", { name: "Return to career" }).click();
  // The fixture must leave the upcoming list exactly once.
  await expect(page.locator("tbody tr")).toHaveCount(upcomingBefore - 1);

  // --- Post-match world state ---------------------------------------------
  await goTo(page, "Competition");
  await expect(page.locator("tbody").first()).toContainText(clubName.split(" ")[0]!);

  // --- Continue advances the world ----------------------------------------
  await goTo(page, "Home / Inbox");
  // Quick Sim already moved the world on, so the baseline has to be re-read
  // here rather than reused from career creation.
  const beforeContinue = await page.locator(".topbar strong").nth(1).textContent();
  expect(beforeContinue).not.toBe(worldDate);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".topbar strong").nth(1)).not.toHaveText(beforeContinue ?? "", {
    timeout: CAREER_TIMEOUT,
  });
  const advancedDate = await page.locator(".topbar strong").nth(1).textContent();

  // --- Save, reload from disk, and confirm everything persisted -----------
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // Saving must not move the world on; the date on screen when you leave is
  // the date you must get back.
  await expect(page.locator(".topbar strong").nth(1)).toHaveText(advancedDate ?? "");
  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Load Career/i }).click();
  await page.getByRole("button", { name: new RegExp(saveName) }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({
    timeout: CAREER_TIMEOUT,
  });

  await expect(page.locator(".topbar strong").nth(1)).toHaveText(advancedDate ?? "");
  await goTo(page, "Tactics");
  await expect(page.getByLabel("Style")).toHaveValue("HIGH_PRESS");
  await goTo(page, "Training");
  await expect(page.getByLabel("Overall intensity")).toHaveValue("HIGH");
  await goTo(page, "Scouting");
  await expect(page.getByRole("button", { name: "Unshortlist" }).first()).toBeVisible();
  await goTo(page, "Fixtures");
  await page.getByRole("button", { name: "Results" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
});
