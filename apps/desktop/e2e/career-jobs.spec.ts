import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 8C — Career Jobs. Only canonical, supported flows: the manager vacancy
 * market, the player's own applications, and apply/accept/decline. Interviews
 * and qualifications are backend-only today and intentionally have no screens.
 * To become unemployed the spec calls the same runtime command the app exposes
 * (resignFromClub); the world date is advanced with continueCareer.
 */
const LONG = 180_000;

const createCareer = async (page: Page, saveName: string): Promise<void> => {
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Starting club")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: LONG });
};

const goTo = (page: Page, screen: string) =>
  page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: screen, exact: true })
    .click();

const command = async (page: Page, name: string): Promise<void> => {
  const response = await page.request.post(`/runtime/command/${name}`, { data: {} });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.ok, JSON.stringify(body)).toBeTruthy();
};

const reopenJobs = async (page: Page): Promise<void> => {
  await goTo(page, "Career Overview");
  await goTo(page, "Career Jobs");
  await expect(page.getByRole("heading", { name: "Career Jobs", level: 2 }).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "My applications", level: 2 })).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
};

test("1. Jobs joins the Career family and is honest for an employed manager", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Jobs employed ${Date.now()}`);
  await goTo(page, "Career Jobs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Career Jobs", level: 2 }).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Open vacancies", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "My applications", level: 2 })).toBeVisible();
  await expect(page.getByText(/You are currently employed/i)).toBeVisible();
  const applyButtons = page.getByRole("button", { name: /^Apply to / });
  for (const button of await applyButtons.all()) await expect(button).toBeDisabled();
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/salary|wage|deadline|closing date|probability|shortlist|interview score/i);
});

test("2. Unemployed: apply persists across navigation, an offer can be accepted, Overview and History follow", async ({
  page,
}) => {
  test.setTimeout(900_000);
  await createCareer(page, `Jobs unemployed ${Date.now()}`);
  await goTo(page, "Career Overview");
  await command(page, "resignFromClub");
  await goTo(page, "Career Jobs");
  await expect(page.getByText(/You are currently unemployed/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "My applications", level: 2 })).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);

  let accepted = false;
  let appliedClub = "";
  for (let attempt = 0; attempt < 8 && !accepted; attempt += 1) {
    const apply = page.getByRole("button", { name: /^Apply to / }).and(page.locator(":enabled"));
    if ((await apply.count()) === 0) {
      await command(page, "continueCareer");
      await reopenJobs(page);
      continue;
    }
    const label = (await apply.first().getAttribute("aria-label")) ?? "";
    appliedClub = label.replace(/^Apply to /, "");
    await apply.first().click();
    const applications = page.getByRole("table", { name: "My job applications" });
    await expect(applications).toContainText(appliedClub);

    // The application is persisted: leave and return, and it is still listed.
    await reopenJobs(page);
    await expect(applications).toContainText(appliedClub);

    const accept = page.getByRole("button", { name: /^Accept offer from / });
    if ((await accept.count()) > 0) {
      await accept.first().click();
      accepted = await page
        .getByText(/You are currently employed/i)
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!accepted) await command(page, "continueCareer");
    } else {
      await command(page, "continueCareer");
    }
    await reopenJobs(page);
  }
  expect(accepted, "an offer was accepted within the attempt budget").toBe(true);

  await goTo(page, "Career Overview");
  await expect(page.getByRole("heading", { name: "Career Overview", level: 2 }).last()).toBeVisible();
  await expect(page.locator("main")).toContainText(appliedClub);
  await goTo(page, "Career History");
  await expect(page.getByRole("heading", { name: "Appointments", level: 2 })).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
  const history = await page.locator("main").innerText();
  expect(history).toMatch(/current/i);
  expect(history).toMatch(/resigned/i);
});

test("3. Career family order and Back navigation include Jobs", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Jobs nav ${Date.now()}`);
  await goTo(page, "Career Overview");
  await goTo(page, "Career Jobs");
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByRole("heading", { name: "Career Overview", level: 2 }).last()).toBeVisible();
});
