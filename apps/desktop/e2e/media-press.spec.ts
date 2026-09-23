import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 7B — Press Requests (canonical interaction flows only).
 * Press Requests is a supported destination in the Media family; it drives the
 * canonical request/interview flow when real stories are eligible. Response
 * submission and request actions persist via canonical commands.
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

test("1. Media family includes Press Requests with one h1 and contextual nav", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Press family ${Date.now()}`);
  for (const label of ["Newsroom", "Media Outlets", "Journalists", "Press Requests"]) {
    await goTo(page, label);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: label, level: 2 }).last()).toBeVisible();
  }
});

test("2. Press Requests shows real state or an honest empty", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Press requests ${Date.now()}`);
  await goTo(page, "Press Requests");
  await expect(page.getByRole("heading", { name: "Press Requests", level: 2 }).last()).toBeVisible();
  // Wait for the media read to resolve before inspecting the panel body.
  await expect(page.locator("main").getByText(/press request|question/i).first()).toBeVisible();
  const body = await page.locator("main").innerText();
  // The panel rendered (real open state or honest empty) and never invents urgency.
  expect(body).toMatch(/press request/i);
  expect(body).not.toMatch(/deadline|expir/i);
});

test("3. a real response is submitted through the canonical answer command", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Press answer ${Date.now()}`);
  await goTo(page, "Press Requests");
  // Only runs if an interview is actually open (canonically the pairing of the
  // previous test's request — otherwise the honest empty state).
  const give = page.getByRole("button", { name: /give response/i });
  if (await give.count()) {
    const textarea = page.getByRole("textbox", { name: /your public response/i });
    await textarea.fill("Calm and confident about the season ahead.");
    await give.click();
    await expect(page.getByText("Response given — the interview is complete.")).toBeVisible();
    // Persists: navigating away and back keeps the interaction completed.
    await goTo(page, "Newsroom");
    await goTo(page, "Press Requests");
    await expect(page.getByText(/open press request|recent press/i).first()).toBeVisible();
  } else {
    await expect(page.getByText(/no press request is currently open/i)).toBeVisible();
  }
});

test("4. journalist/outlet canonical links from an open interview resolve and Back returns", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Press people ${Date.now()}`);
  await goTo(page, "Press Requests");
  // Journalist/outlet links appear only when an interview is open and a real
  // journalist/outlet is on record; otherwise there is nothing to link.
  const anyPersonLink = page.locator("main").locator("button.link").first();
  if (await anyPersonLink.count()) {
    await anyPersonLink.click();
    await expect(page.locator(".page-header h2").first()).not.toHaveText("Press Requests");
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByRole("heading", { name: "Press Requests", level: 2 }).last()).toBeVisible();
  }
});