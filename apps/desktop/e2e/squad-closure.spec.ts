import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 3D — Squad closure: Loans workspace + deferred-pages boundary.
 *
 * Loans is the only new live Squad destination (real transfer-centre active
 * loans, read-only). Discipline, Promises/Relationships, Internationals,
 * Registration/Eligibility and Youth remain deferred — no fabricated tabs.
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
  const saveName = `Closure ${Date.now()}`;
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

test("Squad family final order includes Loans; deferred pages omitted", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Squad", exact: true }).click();
  await expect(squadNav(page)).toBeVisible();
  const labels = await squadNav(page).getByRole("button").allTextContents();
  expect(labels).toEqual(["Overview", "First Team", "Training", "Dynamics", "Medical", "Loans"]);
  // Deferred systems must not appear as nav destinations.
  await expect(squadNav(page).getByRole("button", { name: /Discipline|Promises|Relationships|Internationals|Registration|Eligibility|Youth|U16|U18|U21/i })).toHaveCount(0);

  await squadItem(page, "Loans").click();
  await expect(page.locator(".page-header h2")).toHaveText("Loans");
  await expect(squadItem(page, "Loans")).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Loans: player link -> canonical destination -> Back = Loans", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Squad", exact: true }).click();
  await squadItem(page, "Loans").click();
  await expect(page.locator(".page-header h2")).toHaveText("Loans");

  // Loading-safe: either a loan player link or the truthful empty state.
  await expect(
    page.locator(".loans-layout .report-list button.link, p:has-text('No players are currently on loan')").first(),
  ).toBeVisible({ timeout: 20_000 });
  const playerLink = page.locator(".loans-layout .report-list button.link").first();
  if ((await playerLink.count()) > 0) {
    const name = (await playerLink.textContent()).trim();
    await playerLink.click();
    await expect(page.getByRole("heading", { name }).first()).toBeVisible();
    await backButton(page).click();
    await expect(page.locator(".page-header h2")).toHaveText("Loans");
  }

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});