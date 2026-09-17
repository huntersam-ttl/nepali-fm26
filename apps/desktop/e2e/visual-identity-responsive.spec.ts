import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

// Same axe-core injection pattern already used by role-boundary.spec.ts
// and portrait-continuity.spec.ts's Squad/Dressing Room checks — extends
// that coverage to Player Profile and the shared role header, which
// hadn't been axe-checked by any prior phase.
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const expectNoSeriousA11yViolations = async (page: Page, label: string): Promise<void> => {
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axe = (window as any).axe;
    return axe.run(document, { resultTypes: ["violations"] });
  });
  const serious = (results.violations as Array<{ id: string; impact: string; nodes: unknown[] }>).filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  if (serious.length > 0) console.log(`axe violations at ${label}:`, JSON.stringify(serious, null, 2));
  expect(serious, `axe serious/critical violations at ${label}`).toHaveLength(0);
};

// createExistingClubOwner needs NEPAL_E2E_ROLE_FIXTURE=1, not guaranteed on
// the shared ambient dev server other specs' reuseExistingServer may be
// pointed at. Point only this file at an isolated instance, same pattern
// as the other portrait/nav specs.
if (process.env.NEPAL_RESPONSIVE_E2E_BASE_URL) {
  test.use({ baseURL: process.env.NEPAL_RESPONSIVE_E2E_BASE_URL });
}

const WIDTHS = [1024, 1280, 1440, 1600] as const;

const assertNoPageOverflow = async (page: Page, label: string): Promise<void> => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow, `${label}: page should not overflow horizontally`).toBe(false);
};

/** Bounding-box containment, not mere DOM visibility — this is the same
 * check style that caught the real Owner-nav clipping bug (Phase 1G):
 * an element can be `visible` per the DOM/axe sense while still
 * rendering outside the viewport a real person could see or reach. */
const assertWithinViewport = async (page: Page, locator: ReturnType<Page["locator"]>, label: string): Promise<void> => {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a bounding box`).not.toBeNull();
  if (!box) return;
  const viewport = page.viewportSize();
  expect(viewport, "viewport size should be known").not.toBeNull();
  if (!viewport) return;
  expect(box.x, `${label} left edge within viewport`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${label} right edge within viewport width`).toBeLessThanOrEqual(viewport.width + 1);
};

test("Player Profile is responsive at 1024/1280/1440/1600", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await createExistingClubOwner(page, "A");
  await page.getByLabel("Active career role").selectOption("MANAGER");
  await page.getByRole("button", { name: "Squad", exact: true }).click();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  const playerName = (await page.locator("table tbody tr").nth(0).locator("td").first().innerText()).trim();
  await page.locator("table tbody tr").nth(0).click();
  await expect(page.getByRole("heading", { name: playerName })).toBeVisible();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoPageOverflow(page, `Player Profile @${width}`);
    await assertWithinViewport(page, page.locator(".player-card-avatar svg.person-portrait"), `Player Profile portrait @${width}`);
    await expect(page.getByRole("heading", { name: playerName })).toBeVisible();
    await expect(page.getByText("Market value")).toBeVisible();
  }

  await expectNoSeriousA11yViolations(page, "Player Profile");
  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Squad is responsive at 1024/1280/1440/1600", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await createExistingClubOwner(page, "A");
  await page.getByLabel("Active career role").selectOption("MANAGER");
  await page.getByRole("button", { name: "Squad", exact: true }).click();
  await expect(page.locator("table tbody tr").first()).toBeVisible();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoPageOverflow(page, `Squad @${width}`);
    const firstAvatar = page.locator("table tbody tr svg.person-portrait").first();
    await assertWithinViewport(page, firstAvatar, `Squad avatar @${width}`);
    // Avatars stay SMALL regardless of width — never scale up with layout.
    const box = await firstAvatar.boundingBox();
    expect(box!.width, `Squad avatar should remain small @${width}`).toBeLessThanOrEqual(32);
    await expect(page.locator("table tbody tr").first().locator("td").first()).toBeVisible();
  }

  // Row navigation still works at the final (widest) size tested.
  const playerName = (await page.locator("table tbody tr").nth(0).locator("td").first().innerText()).trim();
  await page.locator("table tbody tr").nth(0).click();
  await expect(page.getByRole("heading", { name: playerName })).toBeVisible();

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Dressing Room is responsive at 1024/1280/1440/1600", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await createExistingClubOwner(page, "A");
  await page.getByLabel("Active career role").selectOption("MANAGER");
  await page.getByRole("button", { name: "Dressing Room", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hierarchy" })).toBeVisible();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoPageOverflow(page, `Dressing Room @${width}`);
    const link = page.locator(".dressing-room-player-link").first();
    await assertWithinViewport(page, link, `Dressing Room link @${width}`);
    await expect(link).toBeVisible();
  }

  const playerName = (await page.locator(".dressing-room-player-link").first().innerText()).trim();
  await page.locator(".dressing-room-player-link").first().click();
  await expect(page.getByRole("heading", { name: playerName })).toBeVisible();

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("The shared role header is responsive for Manager (all widths) and Owner/President (1024 and 1600)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await createExistingClubOwner(page, "A");

  await page.getByLabel("Active career role").selectOption("MANAGER");
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoPageOverflow(page, `Manager header @${width}`);
    await assertWithinViewport(page, page.locator(".identity svg.person-portrait"), `Manager header portrait @${width}`);
    await expect(page.getByLabel("Active career role")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  }
  await expectNoSeriousA11yViolations(page, "Manager header");

  for (const role of ["CHAIRMAN_OWNER", "FEDERATION_PRESIDENT"] as const) {
    await page.getByLabel("Active career role").selectOption(role);
    for (const width of [1024, 1600] as const) {
      await page.setViewportSize({ width, height: 900 });
      await assertNoPageOverflow(page, `${role} header @${width}`);
      await assertWithinViewport(page, page.locator(".identity svg.person-portrait"), `${role} header portrait @${width}`);
      await expect(page.getByLabel("Active career role")).toBeVisible();
    }
    await expectNoSeriousA11yViolations(page, `${role} header`);
  }

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Create-a-Club identity/kit step is responsive at 1024/1280/1600", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  const saveName = `Responsive Founder ${Date.now()}`;
  await page.getByLabel("Save name").fill(saveName);
  await page.getByLabel("Full name").fill(`${saveName} Owner`);
  await page.getByLabel("Display name").fill(`${saveName} Owner`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Career mode").selectOption("OWNER");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Club name").fill(`${saveName} FC`);
  await page.getByLabel("Province / district").selectOption({ index: 1 });

  for (const width of [1024, 1280, 1600] as const) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoPageOverflow(page, `Create-a-Club identity step @${width}`);
    await expect(page.getByLabel("Primary colour")).toBeVisible();
    const kitEditorTabs = page.getByRole("tab", { name: "Away" });
    await expect(kitEditorTabs).toBeVisible();
    await assertWithinViewport(page, kitEditorTabs, `Create-a-Club Away tab @${width}`);
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  }

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Club Profile / Kit History is responsive at 1024/1280/1600", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await createExistingClubOwner(page, "A");
  await page.getByLabel("Active career role").selectOption("MANAGER");
  await page.getByRole("button", { name: "Competition", exact: true }).click();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  // Open a different club's profile from the standings table (own club's
  // row is not a link — see Phase 1J's live verification for why).
  const opponentRow = page.locator("table tbody tr").nth(1);
  const opponentName = (await opponentRow.locator("td").nth(1).innerText()).trim();
  await opponentRow.locator("td").nth(1).getByRole("button", { name: new RegExp(opponentName) }).click();
  await expect(page.getByRole("heading", { name: opponentName })).toBeVisible();

  for (const width of [1024, 1280, 1600] as const) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoPageOverflow(page, `Club Profile @${width}`);
    await expect(page.locator(".club-kit-strip").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kit history" })).toBeVisible();
  }

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});
