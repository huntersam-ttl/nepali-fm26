import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 3C — Squad Dynamics + Medical + Discipline/Promises boundary.
 *
 * Dynamics = the real dressing-room dynamics state (cohesion/hierarchy/
 * concerns). Medical = the real medical centre. Discipline and Promises/
 * Relationships are intentionally deferred (no canonical read/model command),
 * so no fabricated destinations appear.
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

const squadNav = (page: Page) => page.locator('nav[aria-label="Workspace sections"]');
const squadItem = (page: Page, name: string) => squadNav(page).getByRole("button", { name, exact: true });

const createManagerCareer = async (page: Page): Promise<string> => {
  const saveName = `Dyn ${Date.now()}`;
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

test("Squad -> Dynamics context nav active on the real dressing-room workspace", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Squad", exact: true }).click();
  await squadItem(page, "Dynamics").click();
  await expect(page.locator(".page-header h2")).toHaveText("Dressing Room");
  await expect(squadItem(page, "Dynamics")).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Squad -> Medical context nav active on the medical workspace", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Squad", exact: true }).click();
  await squadItem(page, "Medical").click();
  await expect(page.locator(".page-header h2")).toHaveText("Medical");
  await expect(squadItem(page, "Medical")).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("No fabricated Discipline/Promises destinations", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Squad", exact: true }).click();
  await expect(squadNav(page)).toBeVisible();
  // Exactly Overview | First Team | Training | Dynamics | Medical | Loans.
  expect(await squadNav(page).getByRole("button").count()).toBe(6);
  await expect(squadNav(page).getByRole("button", { name: /Discipline|Promises|Relationships|Internationals|Registration|Eligibility/i })).toHaveCount(0);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});