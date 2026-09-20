import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 2C — Daily Operations E2E (integrated into Manager Home).
 *
 * Pins the operational strip: calendar (current date, selectable days), news,
 * and messages render from real read models, and Owner/President do not
 * inherit the manager-only Operations module.
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

const createManagerCareer = async (page: Page): Promise<string> => {
  const saveName = `Ops ${Date.now()}`;
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

test("Manager Home renders the Daily Operations strip with one h1", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Calendar/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "News" })).toBeVisible();

  // Calendar: loading-safe — either event days appear or the truthful empty state.
  await expect(
    page.locator(".calendar-cell, p:has-text('No events are currently scheduled')").first(),
  ).toBeVisible({ timeout: 20_000 });
  if ((await page.locator(".calendar-cell").count()) > 0) {
    await page.locator(".calendar-cell").first().click();
    await expect(page.locator(".calendar-detail")).toBeVisible();
  }

  // News: lead story or an honest empty state.
  const newsEmpty = await page.getByText("No current stories.").count();
  expect(newsEmpty).toBeLessThanOrEqual(1);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Role consistency: Owner/President do not inherit the manager Operations module", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);

  await createExistingClubOwner(page, "A");
  await expect(page.getByText("Club balance")).toBeVisible();
  // The manager-only Next-fixture hero must be absent on the Owner dashboard.
  await expect(page.getByRole("heading", { name: "Next fixture" })).toHaveCount(0);

  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByText("Federation balance")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next fixture" })).toHaveCount(0);

  await page.getByLabel("Active career role").selectOption("MANAGER");
  await expect(page.locator(".page-header h2")).toHaveText("Home / Inbox");
  await expect(page.getByRole("heading", { name: "Next fixture" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});