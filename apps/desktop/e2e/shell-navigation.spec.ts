import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 1A navigation history E2E.
 *
 * Pins the shell-level Back/Forward controls: they navigate between workspace
 * destinations recorded by the shared navigation model, disable at the history
 * boundary, stay keyboard-reachable, and never regress the single-h1 / club
 * identity guarantees.
 *
 * The coordinate navigation steps mirror the spec's canonical example:
 * Manager  Home -> Squad -> Tactics -> Back -> Back -> Forward.
 * Owner and President each cross at least two workspaces and come back.
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

/** The shell keeps exactly one <h1> (the club) regardless of workspace. */
const expectSingleClubH1 = async (page: Page, clubName: string): Promise<void> => {
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveCount(1);
  await expect(h1.first()).toHaveText(clubName);
};

const createManagerCareer = async (page: Page): Promise<string> => {
  const saveName = `Nav Manager ${Date.now()}`;
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

const workspaceTitle = (page: Page) => page.locator(".page-header h2");
const backButton = (page: Page) => page.getByRole("button", { name: "Go back" });
const forwardButton = (page: Page) => page.getByRole("button", { name: "Go forward" });

test("Manager: Home -> Squad -> Tactics -> Back -> Back -> Forward with keyboard access", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  const clubName = await createManagerCareer(page);

  // On Home: no history yet, so both controls are disabled.
  await expect(workspaceTitle(page)).toHaveText("Home / Inbox");
  await expect(backButton(page)).toBeDisabled();
  await expect(forwardButton(page)).toBeDisabled();
  await expectSingleClubH1(page, clubName);

  await page.getByRole("button", { name: "Squad", exact: true }).click();
  await expect(workspaceTitle(page)).toHaveText("Squad");
  await expect(backButton(page)).toBeEnabled();
  await expect(forwardButton(page)).toBeDisabled();

  await page.getByRole("button", { name: "Tactics", exact: true }).click();
  await expect(workspaceTitle(page)).toHaveText("Tactics");

  await backButton(page).click();
  await expect(workspaceTitle(page)).toHaveText("Squad");
  await expect(backButton(page)).toBeEnabled();
  await expect(forwardButton(page)).toBeEnabled();

  await backButton(page).click();
  await expect(workspaceTitle(page)).toHaveText("Home / Inbox");
  await expect(backButton(page)).toBeDisabled();
  await expect(forwardButton(page)).toBeEnabled();

  // Forward via the keyboard (focus + Enter), proving the controls stay
  // reachable and activatable without a pointer.
  await forwardButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(workspaceTitle(page)).toHaveText("Squad");

  // The club identity wiring is untouched by navigation.
  await expect(page.locator("aside.sidebar .sidebar-identity svg").first()).toBeVisible();
  const accent = await page
    .locator(".manager-shell")
    .evaluate((node) => getComputedStyle(node).getPropertyValue("--club-accent").trim());
  expect(accent, "--club-accent should still resolve after navigation").not.toBe("");
  await expectSingleClubH1(page, clubName);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Owner: navigates across workspaces and Back, bounded by history", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);

  // Multi-role fixture: lands on the Chairman/Owner dashboard.
  await createExistingClubOwner(page, "A");
  await expect(page.getByText("Club balance")).toBeVisible();
  await expect(backButton(page)).toBeDisabled();
  await expect(forwardButton(page)).toBeDisabled();

  await page.getByRole("button", { name: "Finances", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Club finance" })).toBeVisible();
  await expect(backButton(page)).toBeEnabled();

  await backButton(page).click();
  await expect(page.getByText("Club balance")).toBeVisible();
  await expect(backButton(page)).toBeDisabled();
  await expect(forwardButton(page)).toBeEnabled();

  await forwardButton(page).click();
  await expect(page.getByRole("heading", { name: "Club finance" })).toBeVisible();

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("President: navigates across workspaces and Back across the whole stack", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);

  await createExistingClubOwner(page, "A");
  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByText("Federation balance")).toBeVisible();
  await expect(backButton(page)).toBeDisabled();

  await page.getByRole("button", { name: "Governance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Governance", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Finance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Federation finance" }).first()).toBeVisible();

  await backButton(page).click();
  await expect(page.getByRole("heading", { name: "Governance", exact: true }).first()).toBeVisible();
  await backButton(page).click();
  await expect(page.getByText("Federation balance")).toBeVisible();
  await expect(backButton(page)).toBeDisabled();

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});