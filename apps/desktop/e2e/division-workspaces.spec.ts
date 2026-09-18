import { expect, test } from "@playwright/test";

test.describe("A/B/C manager workspaces", () => {
  for (const division of ["A", "B", "C"] as const) {
    test(`${division} Division completes the normal matchday workspace flow`, async ({ page }) => {
      test.setTimeout(240_000);
      const saveName = `CI ${division} Division ${Date.now()}`;
      await page.goto("/");
      await page.getByRole("button", { name: /New Career/i }).click();
      await page.getByLabel("Save name").fill(saveName);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("tab", { name: `${division} Division` }).click();
      const club = page.getByRole("button", { name: new RegExp(`${division} Division`) }).first();
      await expect(club).toBeVisible();
      await club.click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Create Save" }).click();
      await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: 240_000 });
      await expect(page.locator(".workspace")).toContainText(`${division}-Division League`);

      await page.getByRole("button", { name: "Squad", exact: true }).click();
      // Squad renders two tables: "Player lifestyle & manager support" comes
      // first in the DOM but its rows carry no click handler, and it only
      // appears when the club has lifestyle/support reads — so an unscoped
      // "tbody tr" silently targets a non-navigating row for some clubs.
      // Scope to the squad list, whose rows are the ones that open a profile.
      const squadRows = page.locator("tbody tr:has(td.squad-name-cell)");
      await expect(squadRows.first()).toBeVisible();
      const firstPlayer = (await squadRows.first().locator("td.squad-name-cell").textContent())?.trim() ?? "";
      await squadRows.first().click();
      await expect(page.getByRole("heading", { name: firstPlayer })).toBeVisible();
      await page.getByRole("button", { name: /Back to squad/ }).click();

      await page.getByRole("button", { name: "Tactics", exact: true }).click();
      await expect(page.getByLabel("Formation")).toBeVisible();
      await page.getByRole("button", { name: "Staff", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Vacancies" })).toBeVisible();
      await page.getByRole("button", { name: "Contracts", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Contracts" })).toBeVisible();
      await page.getByRole("button", { name: "Fixtures", exact: true }).click();
      await expect(page.locator("tbody tr").first()).toBeVisible();

      await page.getByRole("button", { name: "Home / Inbox", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: /Matchday/ }).click();
      await page.getByRole("radio", { name: /Quick Sim/ }).check();
      await page.getByRole("button", { name: "Kick Off", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Full time" })).toBeVisible();
      await page.getByRole("button", { name: "Return to career", exact: true }).click();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.locator(".notice")).toContainText("Career saved");
    });
  }
});
