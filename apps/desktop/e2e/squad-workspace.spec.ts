import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 3A — Squad workspace (Overview + First Team).
 * Pins the Squad family contextual nav, Overview summary, First Team table,
 * canonical player navigation/Back, and the manager-only role boundary.
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
const squadNav = (page: Page) => page.locator('nav[aria-label="Workspace sections"]');
const squadItem = (page: Page, name: string) => squadNav(page).getByRole("button", { name, exact: true });

const createManagerCareer = async (page: Page): Promise<string> => {
  const saveName = `Squad ${Date.now()}`;
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

test("Squad family: First Team (landing) -> Overview -> First Team with active state", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Squad", exact: true }).click();
  await expect(page.locator(".page-header h2")).toHaveText("Squad");
  await expect(squadNav(page)).toBeVisible();
  await expect(squadItem(page, "First Team")).toHaveAttribute("aria-current", "true");

  await squadItem(page, "Overview").click();
  await expect(page.locator(".page-header h2")).toHaveText("Squad Overview");
  await expect(squadItem(page, "Overview")).toHaveAttribute("aria-current", "true");

  await squadItem(page, "First Team").click();
  await expect(page.locator(".page-header h2")).toHaveText("Squad");
  await expect(squadItem(page, "First Team")).toHaveAttribute("aria-current", "true");

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Squad Overview summarizes availability and navigates to First Team", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Squad", exact: true }).click();
  await squadItem(page, "Overview").click();
  await expect(page.locator(".page-header h2")).toHaveText("Squad Overview");
  await expect(page.getByRole("heading", { name: "Availability" })).toBeVisible();

  await page.getByRole("button", { name: "First Team", exact: true }).first().click();
  await expect(page.locator(".page-header h2")).toHaveText("Squad");

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("First Team: click a player -> canonical Player -> Back = First Team", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Squad", exact: true }).click();
  const rows = page.locator("tbody tr:has(td.squad-name-cell)");
  await expect(rows.first()).toBeVisible();
  const firstName = ((await rows.first().locator("td.squad-name-cell").textContent()) ?? "").trim();
  await rows.first().click();
  await expect(page.getByRole("heading", { name: firstName }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  await backButton(page).click();
  await expect(page.locator(".page-header h2")).toHaveText("Squad");

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Role boundary: Owner/President do not show the manager Squad contextual nav", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);

  await createExistingClubOwner(page, "A");
  await expect(page.getByText("Club balance")).toBeVisible();
  await expect(squadNav(page)).toHaveCount(0);

  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByText("Federation balance")).toBeVisible();
  await expect(squadNav(page)).toHaveCount(0);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});