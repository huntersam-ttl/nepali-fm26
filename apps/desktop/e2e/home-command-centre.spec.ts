import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 2B — Home / Daily Hub E2E.
 *
 * Pins that the rebuilt Manager Home answers "who/where/what matters/next/
 * attention" with a hierarchy (hero + club + attention + state + upcoming),
 * routes real actions through Phase 1 navigation, and resolves correctly across
 * role switches (Owner/President keep their own institutional dashboards).
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
const heading = (page: Page, text: string) => page.getByRole("heading", { name: text, exact: true });

const createManagerCareer = async (page: Page): Promise<string> => {
  const saveName = `Home ${Date.now()}`;
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

test("Manager Home: hierarchy, one h1, actions route and Back returns", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await expect(page.locator(".page-header h2")).toHaveText("Home / Inbox");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  // HERO (Next fixture) + Club panel exist; attention + squad sections present.
  await expect(heading(page, "Next fixture")).toBeVisible();
  await expect(heading(page, "Club")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Attention" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Squad", exact: true }).first()).toBeVisible();

  // HERO action: Match Day routes to fixtures, Back returns Home.
  await page.getByRole("button", { name: "Match Day" }).click();
  await expect(page.locator(".page-header h2")).toHaveText("Fixtures");
  await backButton(page).click();
  await expect(page.locator(".page-header h2")).toHaveText("Home / Inbox");

  // Squad route.
  await page.getByRole("button", { name: "View Squad", exact: true }).click();
  await expect(page.locator(".page-header h2")).toHaveText("Squad");
  await backButton(page).click();
  await expect(page.locator(".page-header h2")).toHaveText("Home / Inbox");

  // Workspace summary clickability: League context surfaces a Competition route.
  await page.getByRole("button", { name: "Open table" }).click();
  await expect(page.locator(".page-header h2")).toHaveText("Competition");
  await backButton(page).click();
  await expect(page.locator(".page-header h2")).toHaveText("Home / Inbox");

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Role switch resolves each Home correctly (Manager -> Owner -> President -> Manager)", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);

  await createExistingClubOwner(page, "A");
  await expect(page.getByText("Club balance")).toBeVisible();
  await expect(heading(page, "Next fixture")).toHaveCount(0);

  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByText("Federation balance")).toBeVisible();

  await page.getByLabel("Active career role").selectOption("MANAGER");
  await expect(page.locator(".page-header h2")).toHaveText("Home / Inbox");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(heading(page, "Next fixture")).toBeVisible();

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});