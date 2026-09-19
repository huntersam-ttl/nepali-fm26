import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 1C global search — E2E.
 *
 * Pins that global search behaves as navigation: a persistent control on every
 * role shell, a keyboard-usable palette, and results that navigate to the same
 * canonical Phase 1B entity destinations (Club / Player / Competition), with
 * Back returning through the shared history.
 *
 * STAFF search is covered by unit tests but not E2E here: the real-world test
 * career ships no staff profiles (the registry intentionally carries none), so
 * there is no truthful staff member to search. We do not fabricate one.
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

const searchTrigger = (page: Page) => page.getByRole("button", { name: "Search football world" });
const searchInput = (page: Page) => page.getByRole("textbox", { name: "Search football world" });
const backButton = (page: Page) => page.getByRole("button", { name: "Go back" });

const createManagerCareer = async (page: Page): Promise<string> => {
  const saveName = `Search ${Date.now()}`;
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

const openSearchAndType = async (page: Page, query: string): Promise<void> => {
  await searchTrigger(page).click();
  await expect(searchInput(page)).toBeFocused();
  await searchInput(page).fill(query);
};

const clickResult = async (page: Page, name: string): Promise<void> => {
  // Scope to the palette dialog and match by visible text: the accessible name
  // may include a secondary context label, and unrelated main-content buttons
  // with the same name must never be picked.
  const result = page.locator(".global-search .global-search-result").filter({ hasText: name }).first();
  await expect(result).toBeVisible();
  await result.click();
};

test("Club search navigates to the canonical Club destination and Back returns", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  const clubName = await createManagerCareer(page);

  await openSearchAndType(page, clubName);
  await clickResult(page, clubName);

  await expect(page.locator(".page-header h2")).toHaveText("Club");
  await expect(page.getByRole("heading", { name: clubName }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(backButton(page)).toBeEnabled();

  await backButton(page).click();
  await expect(page.locator(".page-header h2")).toHaveText("Home / Inbox");

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Player search navigates to the canonical Player destination and its club link", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Squad", exact: true }).click();
  const playerName = ((await page.locator("main button.link").first().textContent()) ?? "").trim();
  await searchTrigger(page).click();
  await searchInput(page).fill(playerName);
  await clickResult(page, playerName);

  await expect(page.getByRole("heading", { name: playerName }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  const clubLink = page.locator(".player-card button.link").first();
  await expect(clubLink).toBeVisible();
  const clubName = ((await clubLink.textContent()) ?? "").trim();
  await clubLink.click();
  await expect(page.locator(".page-header h2")).toHaveText("Club");
  await expect(page.getByRole("heading", { name: clubName }).first()).toBeVisible();

  await backButton(page).click();
  await expect(page.getByRole("heading", { name: playerName }).first()).toBeVisible();
  await backButton(page).click();
  await expect(page.locator(".page-header h2")).toHaveText("Squad");

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Competition search navigates to the canonical Competition destination", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await openSearchAndType(page, "league");
  await expect(page.locator(".global-search-result").first()).toBeVisible();
  await page.locator(".global-search-result").first().click();

  await expect(page.locator(".page-header h2")).toHaveText("Competition");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("the single search control is present for Manager, Owner and President", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);

  // Manager shell (from a plain manager career).
  await createManagerCareer(page);
  await expect(searchTrigger(page)).toBeVisible();

  // Owner shell, then President — same persistent control, no separate impl.
  await createExistingClubOwner(page, "A");
  await expect(searchTrigger(page)).toBeVisible();
  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByText("Federation balance")).toBeVisible();
  await expect(searchTrigger(page)).toBeVisible();

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Keyboard: trigger reachable, Escape closes, no-results state, single h1", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await expect(searchTrigger(page)).toBeVisible();
  await searchTrigger(page).focus();
  await page.keyboard.press("Enter");
  await expect(searchInput(page)).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(searchInput(page)).not.toBeVisible();

  await searchTrigger(page).click();
  await searchInput(page).fill("zzzznotaclubzzzz");
  await expect(page.getByText(/No matches/)).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});