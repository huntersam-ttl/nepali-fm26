import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

// The shared ambient dev server on the default port (used by
// reuseExistingServer for other specs) is not guaranteed to have
// NEPAL_E2E_ROLE_FIXTURE=1, which this suite's Chairman/Owner setup
// needs. Point only this file at an isolated instance the runner starts
// separately with that flag and a disposable save directory, without
// touching the shared ambient server other specs may already be using.
if (process.env.NEPAL_NAV_E2E_BASE_URL) {
  test.use({ baseURL: process.env.NEPAL_NAV_E2E_BASE_URL });
}

/**
 * Regression for a real bug: below the old 1080px breakpoint, the sidebar
 * nav switched to a 3-column CSS grid while the sidebar itself stayed a
 * fixed ~248px (a later, unconditional `.manager-shell` rule always won
 * the cascade over the media query's intended full-width stack). Later
 * nav groups — including "Club" (Club Identity) for Chairman/Owner —
 * were pushed outside the visible sidebar and became unreachable by
 * click, though still present in the DOM. Fixed by removing the
 * 3-column override so nav groups stay in their natural single column
 * at every width. This test pins that fix across the widths the bug
 * actually reproduced at, plus wider desktop sizes it must not regress.
 */

const WIDTHS = [721, 900, 1024, 1080, 1280, 1440, 1600];

const assertNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow).toBe(false);
};

/**
 * The regression this bug produced is *visual* clipping: the affected nav
 * button was still attached to the DOM with a real, non-zero bounding
 * box (so Playwright's `toBeVisible()` — which only checks display /
 * visibility / opacity and a non-empty box — passed even when the button
 * rendered outside the sidebar's own edge, invisible to a human and
 * unreachable by a real pointer that can't see past the sidebar's right
 * border). Confirm reachability the way a person would: the button's
 * bounding box must fall entirely inside the sidebar element's own box.
 */
const assertWithinSidebar = async (page: Page, buttonName: string): Promise<void> => {
  const sidebar = page.locator("aside.sidebar");
  const button = page.getByRole("button", { name: buttonName, exact: true });
  const [sidebarBox, buttonBox] = await Promise.all([sidebar.boundingBox(), button.boundingBox()]);
  expect(sidebarBox, "sidebar has a bounding box").not.toBeNull();
  expect(buttonBox, `"${buttonName}" nav button has a bounding box`).not.toBeNull();
  if (!sidebarBox || !buttonBox) return;
  expect(buttonBox.x, `"${buttonName}" left edge within sidebar`).toBeGreaterThanOrEqual(sidebarBox.x - 1);
  expect(
    buttonBox.x + buttonBox.width,
    `"${buttonName}" right edge (${buttonBox.x + buttonBox.width}) within sidebar right edge (${sidebarBox.x + sidebarBox.width})`,
  ).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width + 1);
};

test("Chairman/Owner navigation stays reachable across viewport widths", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await createExistingClubOwner(page, "A");

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.getByText("Club", { exact: true })).toBeVisible();
    await expect(page.getByText("External relations", { exact: true })).toBeVisible();
    const identityLink = page.getByRole("button", { name: "Club Identity" });
    await expect(identityLink).toBeVisible();
    await assertWithinSidebar(page, "Club Identity");
    await assertWithinSidebar(page, "Bank");
    await assertNoHorizontalOverflow(page);
  }

  await page.getByRole("button", { name: "Club Identity" }).click();
  await expect(page.getByRole("heading", { name: "Club Identity" })).toBeVisible();
  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Manager navigation is not regressed by the nav-width fix at narrow widths", async ({ page }) => {
  test.setTimeout(120_000);
  const saveName = `Nav Regression Manager ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Starting club")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: 120_000 });

  for (const width of [721, 900, 1080]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.getByText("Team", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Squad", exact: true })).toBeVisible();
    const clubGroupItem = page.getByRole("button", { name: "Media", exact: true });
    await expect(clubGroupItem).toBeVisible();
    await assertWithinSidebar(page, "Media");
    await assertNoHorizontalOverflow(page);
  }
});
