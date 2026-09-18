import { expect, test, type Page } from "@playwright/test";

const openCareer = async (page: Page, saveName: string): Promise<void> => {
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  // The picker is a role="group" of club buttons, not a <select>, so it has no
  // options to select — pick the second club by clicking its button.
  await page.getByLabel("Starting club").locator("button.club-row").nth(1).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Transfers", exact: true })).toBeVisible({
    timeout: 120_000,
  });
};

test("runs a realistic transfer enquiry through offer construction and persisted history", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openCareer(page, `Phase E transfer ${Date.now()}`);
  await page.getByRole("button", { name: "Scouting", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recruitment search" })).toBeVisible();
  // Shortlist someone who does not already play for us. The first search row
  // can be one of our own players, and "Make offer" then fails with
  // INVALID_SELECTION ("That player already plays for you") instead of
  // exercising an offer at all. The sidebar h1 is the club we manage.
  const ourClub = ((await page.getByRole("heading", { level: 1 }).first().textContent()) ?? "").trim();
  const searchPanel = page
    .locator("article.panel")
    .filter({ has: page.getByRole("heading", { name: "Recruitment search" }) });
  const searchRows = searchPanel.locator("tbody tr");
  const nextPage = searchPanel.getByRole("button", { name: "Next", exact: true });

  /**
   * The search panel renders "Loading…" in place of its table while the page
   * resolves, and under load that can outlast a default expect timeout. A scan
   * of a still-loading panel sees zero rows and wrongly concludes no player is
   * reachable, so wait for real rows before reading any of them.
   */
  const searchLoaded = async (): Promise<void> => {
    await expect(searchPanel.getByText("Loading…")).toHaveCount(0, { timeout: 60_000 });
    await expect(searchRows.first()).toBeVisible({ timeout: 60_000 });
  };
  await searchLoaded();

  // The search is knowledge-gated but not squad-limited — the pager reports
  // hundreds of reachable players, and the first page simply happens to be our
  // own squad. Page forward until another club's player appears: offering for
  // one of our own is rejected with INVALID_SELECTION ("That player already
  // plays for you") and never exercises the offer form at all.
  let shortlisted = false;
  for (let pageIndex = 0; pageIndex < 8 && !shortlisted; pageIndex += 1) {
    const rowCount = await searchRows.count();
    for (let index = 0; index < rowCount; index += 1) {
      const row = searchRows.nth(index);
      const club = ((await row.locator("td").nth(1).textContent()) ?? "").trim();
      if (club && club !== ourClub) {
        await row.getByRole("button", { name: "Shortlist", exact: true }).click();
        shortlisted = true;
        break;
      }
    }
    if (shortlisted) break;
    if (!(await nextPage.isEnabled())) break;
    await nextPage.click();
    // Not just "rows are visible": the previous page's rows still are, so that
    // would pass instantly and rescan the same page. Wait for the panel to
    // finish loading the next one.
    await searchLoaded();
  }
  expect(shortlisted, "the recruitment search should reach a player from another club").toBe(true);
  await page.getByRole("button", { name: "Transfers", exact: true }).click();
  // "Transfer budget" also appears in explanatory prose and in a budget-request
  // <option>, so match the definition-list term that actually labels the figure.
  await expect(page.getByRole("term").filter({ hasText: "Transfer budget" }).first()).toBeVisible();
  await page.getByRole("button", { name: "targets", exact: true }).click();
  await expect(page.getByRole("button", { name: "Make offer" }).first()).toBeVisible();
  await page.getByLabel("Cash").fill("100000");
  await page.getByLabel("Installments").fill("50000");
  await page.getByLabel("Add-ons").fill("25000");
  await page.getByLabel("Sell-on %").fill("10");
  await page.getByLabel("Appearance trigger").fill("10");
  await page.getByLabel("Trigger amount").fill("15000");
  await page.getByRole("button", { name: "Make offer" }).first().click();
  await expect(page.locator(".workspace")).toContainText(
    /offer|negotiat|rejected|accepted|completed/i,
  );
  await page.getByRole("button", { name: "offers", exact: true }).click();
  await expect(page.locator(".workspace")).toContainText(
    /History|direct player contact|Agent contact/,
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Career saved.");
});
