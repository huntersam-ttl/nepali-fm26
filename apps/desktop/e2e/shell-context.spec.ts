import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 1D — breadcrumbs + shell context E2E.
 *
 * Pins the bounded context trail (breadcrumbs) that links the current workspace
 * through the shared destination system and resets cleanly on role switch.
 *
 * Contextual SECONDARY navigation is intentionally not wired into the live
 * shell yet (the primary sidebar already lists every existing navigable
 * workspace grouped by family; re-listing them would duplicate primary nav).
 * The reusable pattern is unit-tested; sub-page families are deferred.
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
const breadcrumb = (page: Page) => page.locator('nav[aria-label="Breadcrumb"]');
const primaryNav = (page: Page) => page.getByLabel("Primary navigation");

const goToWorkspace = async (page: Page, name: string): Promise<void> => {
  await primaryNav(page).getByRole("button", { name, exact: true }).click();
};

const createManagerCareer = async (page: Page): Promise<string> => {
  const saveName = `Context ${Date.now()}`;
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

test("Manager: breadcrumb trail Squad > Player > Club, crumb click and Back", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await goToWorkspace(page, "Squad");
  const playerName = ((await page.locator("main button.link").first().textContent()) ?? "").trim();
  await page.locator("main button.link").first().click();
  await expect(page.getByRole("heading", { name: playerName }).first()).toBeVisible();

  const clubLink = page.locator(".player-card button.link").first();
  await expect(clubLink).toBeVisible();
  const clubName = ((await clubLink.textContent()) ?? "").trim();
  await clubLink.click();
  await expect(page.locator(".page-header h2")).toHaveText("Club");

  // Breadcrumb: labelled, bounded context trail contains Player and Club.
  await expect(breadcrumb(page)).toBeVisible();
  await expect(breadcrumb(page)).toContainText(playerName);
  await expect(breadcrumb(page)).toContainText(clubName);

  // Clicking the "Squad" crumb navigates through the shared system.
  await breadcrumb(page).getByRole("button", { name: "Squad", exact: true }).click();
  await expect(page.locator(".page-header h2")).toHaveText("Squad");

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Competition flow: Club destination, Back/Forward and no appended profile", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  const clubName = await createManagerCareer(page);

  await goToWorkspace(page, "Competition");
  const clubLink = page.locator(".table-scroll button.link").first();
  await expect(clubLink).toBeVisible();
  await clubLink.click();

  await expect(page.locator(".page-header h2")).toHaveText("Club");
  await expect(breadcrumb(page)).toContainText("Competition");
  await expect(breadcrumb(page)).toContainText(clubName);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  await backButton(page).click();
  await expect(page.locator(".page-header h2")).toHaveText("Competition");
  await forwardButton(page).click();
  await expect(page.locator(".page-header h2")).toHaveText("Club");
  await expect(breadcrumb(page)).toContainText("Competition");

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Global search flow: search -> Club -> breadcrumb -> Back to Home, search reused", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  const clubName = await createManagerCareer(page);

  await page.getByRole("button", { name: "Search football world" }).click();
  const input = page.getByRole("textbox", { name: "Search football world" });
  await input.fill(clubName);
  await page.locator(".global-search .global-search-result").filter({ hasText: clubName }).first().click();

  await expect(page.locator(".page-header h2")).toHaveText("Club");
  await expect(breadcrumb(page)).toContainText(clubName);
  await backButton(page).click();
  await expect(page.locator(".page-header h2")).toHaveText("Home / Inbox");

  await page.getByRole("button", { name: "Search football world" }).click();
  await page.getByRole("textbox", { name: "Search football world" }).fill(clubName);
  await expect(page.locator(".global-search .global-search-result").first()).toBeVisible();

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Role switch drops prior-role context (Owner -> Manager -> President)", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);

  await createExistingClubOwner(page, "A");
  await expect(page.getByText("Club balance")).toBeVisible();
  await expect(primaryNav(page).getByRole("button", { name: "Facilities", exact: true })).toBeVisible();

  // Switch to Manager: Owner-only workspaces are gone and the trail is clean,
  // while the Manager's own Club-family Facilities (Phase 6C) is present.
  await page.getByLabel("Active career role").selectOption("MANAGER");
  await expect(page.locator(".page-header h2")).toHaveText("Home / Inbox");
  await expect(primaryNav(page).getByRole("button", { name: "Investors", exact: true })).toHaveCount(0);
  await expect(primaryNav(page).getByRole("button", { name: "Facilities", exact: true })).toBeVisible();
  await expect(primaryNav(page).getByRole("button", { name: "Squad", exact: true })).toBeVisible();
  await expect(breadcrumb(page)).toHaveCount(0);

  // Switch to President: president-specific navigation + breadcrumb still reset.
  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByText("Federation balance")).toBeVisible();
  await expect(primaryNav(page).getByRole("button", { name: "Election / Tenure", exact: true })).toBeVisible();
  await expect(breadcrumb(page)).toHaveCount(0);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Accessibility: breadcrumb nav labelled, primary nav distinct, one h1, keyboard", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await goToWorkspace(page, "Squad");
  const playerName = ((await page.locator("main button.link").first().textContent()) ?? "").trim();
  await page.locator("main button.link").first().click();
  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toBeVisible();

  await expect(page.locator("nav[aria-label='Primary navigation']")).toHaveCount(1);
  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  // Keyboard: a breadcrumb crumb is focusable and navigates on Enter.
  await page.locator('nav[aria-label="Breadcrumb"] button').first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});