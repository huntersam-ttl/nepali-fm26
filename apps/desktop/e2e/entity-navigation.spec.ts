import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 1B canonical entity destinations.
 *
 * Pins that a meaningful entity click NAVIGATES to a canonical destination
 * (rendered as the current application destination, not an appended overlay)
 * and that Back/Forward traverse those hops through the Phase 1A history
 * model. Covers the club, player, and EntityRefLink-driven paths.
 *
 * Declares no per-spec base URL, so NEPAL_E2E_BASE_URL selects the server.
 */

const captureErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
};

const backButton = (page: Page) => page.getByRole("button", { name: "Go back" });
const forwardButton = (page: Page) => page.getByRole("button", { name: "Go forward" });

const createManagerCareer = async (page: Page, label: string): Promise<string> => {
  const saveName = `${label} ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByLabel("Full name").fill("Maya Adhikari");
  await page.getByLabel("Display name").fill("Maya");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const clubPicker = page.getByLabel("Starting club");
  await expect(clubPicker).toBeVisible();
  const clubName = ((await clubPicker.locator("button.club-row strong").first().textContent()) ?? "").trim();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: 240_000 });
  return clubName;
};

const goToWorkspace = async (page: Page, name: string): Promise<void> => {
  await page.getByLabel("Primary navigation").getByRole("button", { name, exact: true }).click();
};

test("Club canonical navigation from the Competition workspace, with Back/Forward", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page, "Entity Club");

  await goToWorkspace(page, "Competition");
  await expect(page.locator(".page-header h2")).toHaveText("Competition");

  // The table's club cells are EntityRefLink-driven buttons — the canonical path.
  const clubLink = page.locator(".table-scroll button.link").first();
  await expect(clubLink).toBeVisible();
  const clubName = ((await clubLink.textContent()) ?? "").trim();
  await clubLink.click();

  // Destination (not overlay): the club page header replaces the competition
  // workspace, the club name is a heading, and exactly one h1 (the shell club)
  // is preserved.
  await expect(page.locator(".page-header h2")).toHaveText("Club");
  await expect(page.getByRole("heading", { name: clubName }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(backButton(page)).toBeEnabled();

  // Back to source workspace, Forward returns to the club destination.
  await backButton(page).click();
  await expect(page.locator(".page-header h2")).toHaveText("Competition");
  await expect(forwardButton(page)).toBeEnabled();
  await forwardButton(page).click();
  await expect(page.getByRole("heading", { name: clubName }).first()).toBeVisible();
  await backButton(page).click();
  await expect(page.locator(".page-header h2")).toHaveText("Competition");

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Player canonical navigation: Squad -> Player -> Club -> Back -> Back -> Squad", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page, "Entity Player");

  await goToWorkspace(page, "Squad");
  await expect(page.locator(".page-header h2")).toHaveText("Squad");

  // Open a player from the squad surface.
  const playerLink = page.locator("main button.link").first();
  await expect(playerLink).toBeVisible();
  const playerName = ((await playerLink.textContent()) ?? "").trim();
  await playerLink.click();

  // Canonical player destination.
  await expect(page.getByRole("heading", { name: playerName }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  // Club from the player profile -> Club canonical destination.
  const clubLink = page.locator(".player-card button.link").first();
  await expect(clubLink).toBeVisible();
  const clubName = ((await clubLink.textContent()) ?? "").trim();
  await clubLink.click();
  await expect(page.locator(".page-header h2")).toHaveText("Club");
  await expect(page.getByRole("heading", { name: clubName }).first()).toBeVisible();

  // Back = Player, Back = Squad.
  await backButton(page).click();
  await expect(page.getByRole("heading", { name: playerName }).first()).toBeVisible();
  await backButton(page).click();
  await expect(page.locator(".page-header h2")).toHaveText("Squad");

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});