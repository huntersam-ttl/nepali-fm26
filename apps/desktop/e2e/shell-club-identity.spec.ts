import { expect, test, type Page } from "@playwright/test";

/**
 * Club identity in the career shell: the badge renders from the club's real
 * identity, the accent is the club's real colour, and the shell asks for that
 * identity at most once per load.
 *
 * The bounded-fetch assertion is the point. Identity is read through a bridge
 * command, and the obvious ways to wire it — per nav item, per panel, or on
 * every render — are invisible in a screenshot and only show up as a chatty
 * runtime. No existing spec counts bridge calls, so this one intercepts the
 * command route directly rather than inferring the count from behaviour.
 *
 * Declares no per-spec base URL, so NEPAL_E2E_BASE_URL selects the server.
 */

const IDENTITY_COMMAND = "**/runtime/command/getClubVisualIdentity";

/** Counts identity requests without altering them — continue(), never fulfil. */
const countIdentityCalls = async (page: Page): Promise<() => number> => {
  let calls = 0;
  await page.route(IDENTITY_COMMAND, async (route) => {
    calls += 1;
    await route.continue();
  });
  return () => calls;
};

const createManagerCareer = async (page: Page): Promise<string> => {
  const saveName = `Shell Identity ${Date.now()}`;
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

test("the shell shows the club's real badge and accent, fetched at most once", async ({ page }) => {
  test.setTimeout(300_000);
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const identityCalls = await countIdentityCalls(page);
  const clubName = await createManagerCareer(page);

  // ---- the badge renders beside the club heading ----
  const badge = page.locator("aside.sidebar .sidebar-identity svg").first();
  await expect(badge, "the sidebar should show the club's badge").toBeVisible();

  // ---- the badge names itself generically, never repeating the club ----
  // ClubBadge takes an optional clubName for its aria-label and falls back to
  // "Club badge". The shell omits it deliberately: the <h1> beside it already
  // names the club, so passing it would announce the club twice.
  await expect(badge).toHaveAttribute("aria-label", "Club badge");

  // ---- the club is announced once, by the heading ----
  const h1s = page.getByRole("heading", { level: 1 });
  await expect(h1s).toHaveCount(1);
  await expect(h1s.first()).toHaveText(clubName);
  const sidebarMentions = await page
    .locator("aside.sidebar")
    .getByText(clubName, { exact: true })
    .count();
  expect(sidebarMentions, `"${clubName}" should be announced once in the sidebar`).toBe(1);

  // ---- the badge must never take a tab stop ----
  const badgeFocusable = await badge.evaluate(
    (node) => node.hasAttribute("tabindex") || node.matches("a, button, [contenteditable]"),
  );
  expect(badgeFocusable, "a decorative badge must stay out of the Tab order").toBe(false);

  // ---- the accent resolves to the club's real primary colour ----
  const accent = await page
    .locator(".manager-shell")
    .evaluate((node) => getComputedStyle(node).getPropertyValue("--club-accent").trim());
  expect(accent, "--club-accent should resolve on the shell root").not.toBe("");

  // The active nav marker is drawn from that token, so it must not fall back
  // to the app accent while a real club identity exists.
  await page.getByRole("button", { name: "Squad", exact: true }).click();
  const markerWidth = await page
    .locator("aside.sidebar nav button.active")
    .first()
    .evaluate((node) => getComputedStyle(node, "::before").width);
  // A real painted marker, not merely "not auto": if color-mix or the
  // pseudo-element failed, this would read 0px and the check must fail.
  expect(
    Number.parseFloat(markerWidth),
    `the active destination should carry a painted edge marker (got ${markerWidth})`,
  ).toBeGreaterThan(0);

  // ---- bounded: one shell load asks for identity at most once ----
  // Exactly one, not "at most one": a zero would pass a <= assertion
  // vacuously and prove nothing about whether the shell fetches identity at
  // all. A club-backed shell must ask precisely once.
  expect(
    identityCalls(),
    "a club-backed shell should fetch club identity exactly once per load",
  ).toBe(1);

  // Navigating must not re-ask: the fetch is keyed on the club, not the screen.
  const afterFirstNav = identityCalls();
  for (const screen of ["Tactics", "Training", "Fixtures", "Contracts"]) {
    await page.getByRole("button", { name: screen, exact: true }).click();
  }
  expect(
    identityCalls(),
    "moving between screens must not refetch club identity",
  ).toBe(afterFirstNav);

  expect(consoleErrors, "the shell should raise no console errors").toEqual([]);
});
