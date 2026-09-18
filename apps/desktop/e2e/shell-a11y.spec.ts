import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";

/**
 * Accessibility baseline for the career shell.
 *
 * Structure is pinned by shell-structure.spec.ts; this pins what the shell
 * *announces*. Both exist because the UI Phase 1 landmark work changed which
 * element is the page's heading and which is its main landmark, and a
 * regression there is invisible in a screenshot.
 *
 * Same axe-core injection pattern as role-boundary and portrait-continuity —
 * reused deliberately rather than introducing a second a11y mechanism.
 *
 * Declares no per-spec base URL, so NEPAL_E2E_BASE_URL selects the server.
 */

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const seriousViolations = async (
  page: Page,
): Promise<Array<{ id: string; impact: string; nodes: unknown[] }>> => {
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (root: Document, options: unknown) => Promise<unknown> } }).axe;
    return axe.run(document, { resultTypes: ["violations"] });
  });
  return (results.violations as Array<{ id: string; impact: string; nodes: unknown[] }>).filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
};

const createManagerCareer = async (page: Page): Promise<string> => {
  const saveName = `Shell A11y ${Date.now()}`;
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

test("the loaded Manager shell is free of serious accessibility violations", async ({ page }) => {
  test.setTimeout(300_000);
  const clubName = await createManagerCareer(page);

  const violations = await seriousViolations(page);
  if (violations.length > 0) {
    console.log("axe serious/critical violations:", JSON.stringify(violations, null, 2));
  }
  expect(violations, "serious/critical axe violations on the Manager shell").toHaveLength(0);

  // ---- landmarks ----
  expect(await page.locator("main").count(), "exactly one main landmark").toBe(1);
  await expect(page.locator("main")).toHaveClass(/workspace/);
  const navInsideMain = await page.evaluate(
    () => document.querySelector("main")?.querySelector("nav") != null,
  );
  expect(navInsideMain, "navigation must sit outside the main landmark").toBe(false);

  // ---- navigation is named, so it is distinguishable from other nav ----
  await expect(page.locator("nav[aria-label='Primary navigation']")).toHaveCount(1);

  // ---- the role selector is labelled rather than relying on nearby text ----
  await expect(page.getByLabel("Active career role")).toBeVisible();

  // ---- heading hierarchy: one h1, and it is the club ----
  const h1s = page.getByRole("heading", { level: 1 });
  await expect(h1s).toHaveCount(1);
  await expect(h1s.first()).toHaveText(clubName);

  // ---- every role shell has one page title, not just Manager ----
  // Owner and President used to render a second level-1 heading in their own
  // page header (RoleLandingScreen/RoleDetailScreen), so those shells
  // announced two page titles while Manager announced one. Assert the rule
  // where it was actually broken, not only where it already held.
  for (const role of ["CHAIRMAN_OWNER", "FEDERATION_PRESIDENT"] as const) {
    const available = await page
      .getByLabel("Active career role")
      .locator(`option[value="${role}"]`)
      .count();
    if (available === 0) continue;
    await page.getByLabel("Active career role").selectOption(role);
    await expect(
      page.getByRole("heading", { level: 1 }),
      `${role} shell should expose exactly one level-1 heading`,
    ).toHaveCount(1);
    expect(await page.locator("main").count(), `${role} keeps one main landmark`).toBe(1);
  }
  await page.getByLabel("Active career role").selectOption("MANAGER");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  // ---- the club must not be announced twice in the sidebar ----
  // A badge or portrait beside the club heading has to be decorative; if it
  // carries its own accessible name, screen-reader users hear the club twice.
  const sidebarClubMentions = await page
    .locator("aside.sidebar")
    .getByText(clubName, { exact: true })
    .count();
  expect(sidebarClubMentions, `"${clubName}" should be announced once in the sidebar`).toBe(1);
});
