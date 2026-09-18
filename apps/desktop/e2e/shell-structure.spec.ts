import { expect, test, type Page } from "@playwright/test";

/**
 * Pins the career shell's structure so the landmark/heading hierarchy cannot
 * drift back or be "verified" by a one-off manual probe again.
 *
 * This exists because the UI Phase 1 restructure was originally confirmed by
 * hand against a running app, and a later measurement of the same claims was
 * taken against a stale checkout on another port — so the evidence for "one
 * h1, nav outside main" was, for a while, not evidence at all. These are the
 * same assertions, made durable and pointed at whichever server
 * NEPAL_E2E_BASE_URL selects.
 *
 * Deliberately declares no per-spec base URL override: it is also the standing
 * proof that the global override reaches this worktree.
 */

const assertNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow, "page must not scroll horizontally").toBe(false);
};

/** Same creation path manager-flow.spec.ts uses, so this spec exercises the
 * real runtime and a real SQLite save rather than a fixture shortcut. */
const createManagerCareer = async (page: Page): Promise<string> => {
  const saveName = `Shell Structure ${Date.now()}`;
  await page.goto("/");
  // /i matters: the button carries aria-label="New career", which wins over
  // its visible "New Career" text, so a case-sensitive matcher never resolves.
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByLabel("Full name").fill("Maya Adhikari");
  await page.getByLabel("Display name").fill("Maya");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // The picker is a role="group" of club buttons, not a <select>: getByLabel
  // matches the group, so an <option> lookup inside it never resolves.
  const clubPicker = page.getByLabel("Starting club");
  await expect(clubPicker).toBeVisible();
  const clubName = ((await clubPicker.locator("button.club-row strong").first().textContent()) ?? "").trim();

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: 120_000 });
  return clubName;
};

test("the career shell has one page title, one main landmark, and navigation outside it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const clubName = await createManagerCareer(page);

  // ---- exactly one <h1>, and it is the club ----
  const headings = page.getByRole("heading", { level: 1 });
  await expect(headings, "the shell must expose exactly one level-1 heading").toHaveCount(1);
  await expect(headings.first()).toHaveText(clubName);

  // ---- exactly one main landmark, and it is the workspace ----
  const mainCount = await page.locator("main").count();
  expect(mainCount, "a loaded career must have exactly one <main>").toBe(1);
  await expect(page.locator("main")).toHaveClass(/workspace/);

  // ---- navigation is a sibling of main, never inside it ----
  const navInsideMain = await page.evaluate(
    () => document.querySelector("main")?.querySelector("nav") != null,
  );
  expect(navInsideMain, "primary navigation must sit outside the main landmark").toBe(false);
  await expect(page.locator("nav[aria-label='Primary navigation']")).toHaveCount(1);

  // ---- the sidebar the nav-clipping regression depends on still exists ----
  await expect(page.locator("aside.sidebar")).toHaveCount(1);
  await expect(page.locator(".topbar")).toHaveCount(1);

  // ---- the screen title is an h2 that still *reads* as a page title ----
  const pageTitle = page.locator(".page-header h2");
  await expect(pageTitle).toBeVisible();
  const titleSize = await pageTitle.evaluate((node) =>
    parseFloat(window.getComputedStyle(node).fontSize),
  );
  // Demoting the markup must not silently drop it to the global 1rem h2 rule.
  expect(titleSize, "page title must keep page-title scale, not collapse to body h2").toBeGreaterThanOrEqual(20);

  await assertNoHorizontalOverflow(page);
  expect(consoleErrors, "the shell should raise no console errors").toEqual([]);
});
