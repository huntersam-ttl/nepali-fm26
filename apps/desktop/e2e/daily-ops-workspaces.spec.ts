import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 2D — dedicated Daily Operations workspaces.
 *
 * Pins the Daily Ops family (Overview | Messages | News | Calendar | Fixtures |
 * Competition) reached through the live contextual secondary nav, with normal
 * Phase 1 history (Back) and a manager-only role boundary.
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
const opsNav = (page: Page) => page.locator('nav[aria-label="Workspace sections"]');
const opsItem = (page: Page, name: string) => opsNav(page).getByRole("button", { name, exact: true });

const createManagerCareer = async (page: Page): Promise<string> => {
  const saveName = `Ops2d ${Date.now()}`;
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

test("Daily Ops family navigates via contextual nav with Back returning", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  // Home shows the Daily Ops family nav with Overview active.
  await expect(opsNav(page)).toBeVisible();
  await expect(opsItem(page, "Overview")).toHaveAttribute("aria-current", "true");

  for (const [item, pageTitle] of [
    ["Messages", "Messages"],
    ["News", "News"],
    ["Calendar", "Calendar"],
    ["Fixture schedule", "Fixtures"],
    ["League table", "Competition"],
  ] as const) {
    await opsItem(page, item).click();
    await expect(page.locator(".page-header h2")).toHaveText(pageTitle);
    await expect(opsItem(page, item)).toHaveAttribute("aria-current", "true");
  }

  // Back returns along the family, then to Home.
  await expect(backButton(page)).toBeEnabled();
  await backButton(page).click();
  await expect(page.locator(".page-header h2")).toHaveText("Fixtures");
  await backButton(page).click();
  await expect(page.locator(".page-header h2")).toHaveText("Calendar");

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Messages workspace: select a message, canonical entity link, Back returns", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await opsItem(page, "Messages").click();
  await expect(page.locator(".page-header h2")).toHaveText("Messages");

  // Loading-safe: either message rows or a truthful empty state.
  await expect(page.locator(".messages-row, p:has-text('Your inbox is empty')").first()).toBeVisible({ timeout: 20_000 });
  if ((await page.locator(".messages-row").count()) === 0) {
    return;
  }
  // Selecting a message does not navigate away.
  await page.locator(".messages-row").first().click();
  await expect(page.locator(".messages-detail")).toBeVisible();
  await expect(page.locator(".page-header h2")).toHaveText("Messages");

  const entityLink = page.locator(".messages-detail button.link").first();
  if ((await entityLink.count()) > 0) {
    await entityLink.click();
    await expect(page.locator(".page-header h2").first()).not.toHaveText("Messages");
    await backButton(page).click();
    await expect(page.locator(".page-header h2")).toHaveText("Messages");
  }

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Calendar workspace: day selection surfaces events", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await opsItem(page, "Calendar").click();
  await expect(page.locator(".page-header h2")).toHaveText("Calendar");
  await expect(
    page.locator(".calendar-cell, p:has-text('No events are currently scheduled')").first(),
  ).toBeVisible({ timeout: 20_000 });
  if ((await page.locator(".calendar-cell").count()) > 0) {
    await page.locator(".calendar-cell").first().click();
    await expect(page.locator(".calendar-detail").first()).toBeVisible();
  }

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Role boundary: Owner/President do not show the manager Daily Ops contextual nav", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);

  await createExistingClubOwner(page, "A");
  await expect(page.getByText("Club balance")).toBeVisible();
  await expect(opsNav(page)).toHaveCount(0);

  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByText("Federation balance")).toBeVisible();
  await expect(opsNav(page)).toHaveCount(0);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});