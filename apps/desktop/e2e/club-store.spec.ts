import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner, saveReloadOwnerCareer } from "./support/owner-harness.js";

/**
 * Club Store browser coverage (Club Commercial Phase 1C).
 *
 * The save's randomSeed is `desktop:<saveName>:<personId>` and the harness
 * puts Date.now() in the save name, so hard-coding "NPR 51,712" would be a
 * lie dressed as precision — it would differ on the next run. Instead every
 * figure is asserted *exactly* against the authoritative
 * getClubCommercialOverview payload for the same save, which is itself
 * derived from the real MERCHANDISE ledger. That makes this a genuine
 * ledger-to-pixel check rather than a "renders something non-zero" smoke
 * test: if the dashboard ever drifts from the ledger, formats a number
 * differently, or drops a kit slot, these assertions fail.
 */

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

// createExistingClubOwner needs NEPAL_E2E_ROLE_FIXTURE=1, which the shared
// ambient dev server is not guaranteed to carry. Same isolation pattern as
// the portrait/nav/responsive specs.
if (process.env.NEPAL_CLUBSTORE_E2E_BASE_URL) {
  test.use({ baseURL: process.env.NEPAL_CLUBSTORE_E2E_BASE_URL });
}

type Overview = {
  clubName: string;
  seasonKey: string;
  merchandiseAppeal: number;
  seasonMerchandiseRevenue: number;
  seasonShirtRevenue: number;
  seasonShirtUnits: number;
  homeShirtUnits: number;
  awayShirtUnits: number;
  thirdShirtUnits: number;
  retailStatus: string;
  completedRetailStores: number;
  recentMerchandisePostings: Array<{ date: string; amount: number; description: string }>;
  seasonHistory: Array<{ seasonKey: string; merchandiseRevenue: number; shirtUnits: number }>;
};

/** Mirrors apps/desktop/src/manager/ui.tsx `money`. */
const money = (amount: number): string => `NPR ${Math.round(amount).toLocaleString("en-US")}`;

const fetchOverview = async (page: Page): Promise<Overview> => {
  const response = await page.request.post("/runtime/command/getClubCommercialOverview", { data: {} });
  expect(response.ok(), "getClubCommercialOverview should respond").toBeTruthy();
  const body = (await response.json()) as { ok: boolean; data: Overview };
  expect(body.ok, "getClubCommercialOverview should succeed for the owner").toBeTruthy();
  return body.data;
};

const openClubStore = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Club Store", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Club Store", exact: true })).toBeVisible();
  // The panel title carries the season, and only renders once the overview
  // command has resolved — so this is the real "data is on screen" gate.
  await expect(page.getByText(/^Club store — \d{4} season$/)).toBeVisible();
};

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

/** All three kits must be present as described images — never colour alone. */
const expectAllThreeKits = async (page: Page): Promise<void> => {
  for (const slot of ["Home", "Away", "Third"] as const) {
    const kit = page.getByRole("img", { name: new RegExp(`^${slot} kit —`) }).first();
    await expect(kit, `${slot} kit should render with a described label`).toBeVisible();
  }
};

/** Asserts the rendered dashboard equals the authoritative ledger-derived
 * payload, figure for figure. */
const expectDashboardMatchesOverview = async (page: Page, overview: Overview): Promise<void> => {
  const hero = page.locator(".club-store-hero");
  await expect(hero).toContainText(overview.clubName);
  await expect(hero).toContainText(money(overview.seasonMerchandiseRevenue));
  await expect(hero).toContainText(overview.seasonShirtUnits.toLocaleString("en-US"));

  // Per-slot unit counts, each read from its own kit tile rather than from
  // the page at large, so a mislabelled or swapped slot is caught.
  const slots: Array<[string, number]> = [
    ["Home", overview.homeShirtUnits],
    ["Away", overview.awayShirtUnits],
    ["Third", overview.thirdShirtUnits],
  ];
  for (const [label, units] of slots) {
    const tile = hero.locator(".club-kit-strip > div").filter({ hasText: new RegExp(`^${label}`) }).first();
    await expect(tile, `${label} tile should show its own unit count`).toContainText(
      units.toLocaleString("en-US"),
    );
  }

  // The split must be internally consistent on screen, not merely in the payload.
  expect(
    overview.homeShirtUnits + overview.awayShirtUnits + overview.thirdShirtUnits,
    "Home + Away + Third must equal the reported shirt total",
  ).toBe(overview.seasonShirtUnits);
  expect(overview.seasonShirtRevenue).toBeLessThanOrEqual(overview.seasonMerchandiseRevenue);

  const retail = page.locator("article.panel", { has: page.getByRole("heading", { name: "Retail network" }) });
  await expect(retail).toContainText(money(overview.seasonShirtRevenue));
  await expect(retail).toContainText(String(overview.completedRetailStores));
  await expect(retail).toContainText(overview.merchandiseAppeal.toFixed(1));
};

test("Club Store reports the real merchandise ledger, from empty state through a posted month", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const saveName = await createExistingClubOwner(page, "A");
  await openClubStore(page);

  // ---- Zero state: a club that has not traded yet must say so honestly ----
  const empty = await fetchOverview(page);
  expect(empty.seasonMerchandiseRevenue, "a fresh career should not have traded yet").toBe(0);
  expect(empty.seasonShirtUnits).toBe(0);
  expect(empty.seasonHistory).toHaveLength(0);
  expect(empty.recentMerchandisePostings).toHaveLength(0);

  await expect(page.locator(".club-store-hero")).toContainText(money(0));
  await expect(page.getByText("No merchandise trade recorded yet.")).toBeVisible();
  await expect(page.getByText("No merchandise postings yet.")).toBeVisible();
  // Kits and badge belong to the club's identity, not to its sales — they
  // must render even with nothing sold.
  await expectAllThreeKits(page);
  await expect(page.getByRole("img", { name: /badge$/ }).first()).toBeVisible();
  await expect(page.getByText(/Simulation-only commercial figures/)).toBeVisible();

  await expectNoSeriousA11yViolations(page, "Club Store (zero state)");

  // ---- Figures point at their canonical screens, not at duplicates ----
  // Revenue is the club's real finance-ledger trade, so it opens Club
  // finance; the store is a real facility project, so it opens Facilities.
  await expect(
    page.getByRole("button", { name: /Merchandise revenue .* open Club finance/ }),
    "revenue should link to the canonical finance screen",
  ).toBeVisible();
  const planStore = page.getByRole("button", { name: "Plan one from Facilities" });
  await expect(planStore, "a club with no store should link to Facilities").toBeVisible();
  await planStore.click();
  // Following the link really leaves the Club Store for the canonical
  // project screen, rather than opening a second project view in place.
  await expect(page.getByText(/^Club store — \d{4} season$/)).toBeHidden();
  await openClubStore(page);

  // ---- Keyboard reachability (decorative kit SVGs must not steal focus) ----
  await page.getByRole("button", { name: "Club Store", exact: true }).focus();
  await expect(page.getByRole("button", { name: "Club Store", exact: true })).toBeFocused();
  const kitIsFocusable = await page.evaluate(() =>
    [...document.querySelectorAll("svg.club-kit")].some((node) => node.hasAttribute("tabindex")),
  );
  expect(kitIsFocusable, "kit artwork should not be a tab stop").toBe(false);

  // ---- Advance the real economy until the monthly tick posts merchandise ----
  // continueCareer is the same command the Continue button issues; the owner
  // branch advances five simulated days per call and posts the canonical
  // monthly economy tick when it crosses a month boundary.
  let overview = empty;
  for (let attempt = 0; attempt < 12 && overview.seasonMerchandiseRevenue === 0; attempt += 1) {
    const advanced = await page.request.post("/runtime/command/continueCareer", { data: {} });
    expect(advanced.ok(), "continueCareer should succeed").toBeTruthy();
    overview = await fetchOverview(page);
  }
  expect(
    overview.seasonMerchandiseRevenue,
    "the canonical monthly tick should have posted merchandise revenue",
  ).toBeGreaterThan(0);
  expect(overview.recentMerchandisePostings.length).toBeGreaterThan(0);

  // ---- Phase 24: leaving and returning must show the advanced world ----
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await openClubStore(page);

  await expectDashboardMatchesOverview(page, overview);
  await expectAllThreeKits(page);

  // The most recent posting is rendered with its real date and amount.
  const newest = overview.recentMerchandisePostings[0]!;
  const postings = page.locator("article.panel", {
    has: page.getByRole("heading", { name: "Recent merchandise postings" }),
  });
  await expect(postings).toContainText(newest.date);
  await expect(postings).toContainText(money(newest.amount));

  // Season history now exists, and carries this season's row.
  const history = page.locator("article.panel", { has: page.getByRole("heading", { name: "Season history" }) });
  await expect(history).toContainText(overview.seasonKey);
  await expect(history).not.toContainText("No merchandise trade recorded yet.");

  // Retail status text is present as words, not as a colour swatch alone.
  expect(["NONE", "PLANNING", "UNDER_DEVELOPMENT", "OPERATING"]).toContain(overview.retailStatus);
  await expect(page.locator(".club-store-hero")).toContainText(/store/i);

  await expectNoSeriousA11yViolations(page, "Club Store (traded state)");

  // ---- Phase 32: save, reload, and confirm the same ledger-derived figures ----
  await saveReloadOwnerCareer(page, saveName);
  await openClubStore(page);
  const reloaded = await fetchOverview(page);
  expect(reloaded.seasonMerchandiseRevenue).toBe(overview.seasonMerchandiseRevenue);
  expect(reloaded.seasonShirtUnits).toBe(overview.seasonShirtUnits);
  expect(reloaded.homeShirtUnits).toBe(overview.homeShirtUnits);
  expect(reloaded.awayShirtUnits).toBe(overview.awayShirtUnits);
  expect(reloaded.thirdShirtUnits).toBe(overview.thirdShirtUnits);
  expect(reloaded.seasonHistory).toEqual(overview.seasonHistory);
  expect(reloaded.retailStatus).toBe(overview.retailStatus);
  await expectDashboardMatchesOverview(page, reloaded);

  expect(consoleErrors, "Club Store should raise no console errors").toEqual([]);
});

test("Club Store is responsive at 1024/1280/1440/1600", async ({ page }) => {
  test.setTimeout(600_000);
  await createExistingClubOwner(page, "A");
  await openClubStore(page);

  for (const width of [1024, 1280, 1440, 1600] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByText(/^Club store — \d{4} season$/)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow, `${width}px: page should not overflow horizontally`).toBe(false);

    // Bounding-box containment, not mere DOM visibility — the check style
    // that caught the real Owner-nav clipping bug in the identity phases.
    const hero = page.locator(".club-store-hero");
    const heroBox = await hero.boundingBox();
    expect(heroBox, `${width}px: hero should have a bounding box`).not.toBeNull();
    if (heroBox) {
      expect(heroBox.x, `${width}px: hero left edge on screen`).toBeGreaterThanOrEqual(-1);
      expect(heroBox.x + heroBox.width, `${width}px: hero right edge within viewport`).toBeLessThanOrEqual(
        width + 1,
      );
    }

    await expectAllThreeKits(page);
    // The figures a player actually reads must stay on screen at every width.
    await expect(page.locator(".club-store-hero")).toContainText("Merchandise revenue");
    await expect(page.locator(".club-store-hero")).toContainText("Replica shirts sold");
    await expect(
      page.locator("article.panel", { has: page.getByRole("heading", { name: "Retail network" }) }),
    ).toContainText("Merchandise appeal");
  }
});
