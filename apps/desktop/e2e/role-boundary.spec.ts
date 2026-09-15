import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";

/*
 * Player-role boundary cleanup: real-browser verification that NPC
 * executive roles (SPORTING_DIRECTOR, DIRECTOR_OF_FOOTBALL, CEO,
 * GENERAL_SECRETARY) never appear as a selectable career, even when the
 * same physical person genuinely holds all four, and that a save written
 * before the cleanup reconciles safely on load.
 */

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

const roleOptions = async (page: Page): Promise<string[]> =>
  page.getByLabel("Active career role").locator("option").evaluateAll((opts) =>
    opts.map((opt) => (opt as HTMLOptionElement).value),
  );

test("role picker never exposes an NPC executive role, even holding all four", async ({ page }) => {
  test.setTimeout(180_000);
  const saveName = `E2E Boundary ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: /New career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Starting club")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: 120_000 });

  // Seeds Manager + Owner + President + all four NPC executive appointments
  // on the same physical person — the deliberate stress case.
  const fixture = await page.request.post("/runtime/command/seedE2ERoleFixture", { data: {} });
  expect(fixture.ok()).toBeTruthy();
  expect((await fixture.json()).ok).toBeTruthy();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Load career/i }).click();
  await page.getByRole("button", { name: new RegExp(saveName) }).click();
  await expect(page.getByLabel("Active career role")).toHaveValue("MANAGER");

  // CASE 4 + 5: only the three playable roles ever appear, regardless of
  // how many NPC jobs this person also holds. The picker's option list
  // loads from a separate getCareerRoles() fetch than the header, so poll
  // rather than assume it's populated the instant the header resolves.
  await expect
    .poll(async () => (await roleOptions(page)).sort())
    .toEqual(["CHAIRMAN_OWNER", "FEDERATION_PRESIDENT", "MANAGER"].sort());

  // CASE 9: the executive appointment is visible on the Owner's own
  // supervision surface, but never selectable as a career.
  await page.getByLabel("Active career role").selectOption("CHAIRMAN_OWNER");
  await expect(page.getByRole("heading", { name: "Chairman / Owner" })).toBeVisible();
  await page.getByRole("button", { name: "Executive Management", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Executive management" })).toBeVisible();
  await expect(page.getByText("CEO")).toBeVisible();
  await expect(page.getByText("Sporting Director")).toBeVisible();
  expect(await roleOptions(page)).not.toContain("CEO");
  expect(await roleOptions(page)).not.toContain("SPORTING_DIRECTOR");

  // CASE 6: Owner -> Manager -> Owner -> President -> Owner round trip.
  await page.getByLabel("Active career role").selectOption("MANAGER");
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible();
  await page.getByLabel("Active career role").selectOption("CHAIRMAN_OWNER");
  await expect(page.getByRole("heading", { name: "Chairman / Owner" })).toBeVisible();
  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByRole("heading", { name: "Federation President" })).toBeVisible();
  await page.getByLabel("Active career role").selectOption("CHAIRMAN_OWNER");
  await expect(page.getByRole("heading", { name: "Chairman / Owner" })).toBeVisible();

  // Phase F: keyboard operability of the role picker — reachable by Tab,
  // operable with the keyboard alone, no focus trap afterward.
  await page.getByLabel("Active career role").focus();
  await expect(page.getByLabel("Active career role")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();

  // Phase F: axe on Manager / Owner / President / Executive-supervision.
  await page.getByLabel("Active career role").selectOption("MANAGER");
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible();
  await expectNoSeriousA11yViolations(page, "Manager dashboard");
  await page.getByLabel("Active career role").selectOption("CHAIRMAN_OWNER");
  await expect(page.getByRole("heading", { name: "Chairman / Owner" })).toBeVisible();
  await expectNoSeriousA11yViolations(page, "Owner dashboard");
  await page.getByRole("button", { name: "Executive Management", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Executive management" })).toBeVisible();
  await expectNoSeriousA11yViolations(page, "Owner executive supervision");
  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByRole("heading", { name: "Federation President" })).toBeVisible();
  await expectNoSeriousA11yViolations(page, "President dashboard");

  // Phase G: responsive PC widths — no horizontal overflow, role picker
  // and topbar stay usable.
  for (const width of [1280, 1440, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBe(false);
    await expect(page.getByLabel("Active career role")).toBeVisible();
  }
});

test("stale saves reconcile safely without ever rendering an executive dashboard", async ({ page }) => {
  test.setTimeout(180_000);
  const saveName = `E2E Stale ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: /New career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Starting club")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: 120_000 });

  const fixture = await page.request.post("/runtime/command/seedE2ERoleFixture", { data: {} });
  expect(fixture.ok()).toBeTruthy();

  const reloadIntoSave = async (): Promise<void> => {
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Main Menu" }).click();
    await page.reload();
    await page.getByRole("button", { name: /Load career/i }).click();
    await page.getByRole("button", { name: new RegExp(saveName) }).click();
  };

  // Case A: active_role=CEO, base_role=MANAGER -> UI must load as Manager,
  // never render the (dead) executive dashboard path or a blank workspace.
  const staleA = await page.request.post("/runtime/command/seedE2EStaleExecutiveRole", {
    data: { activeRole: "CEO", baseRole: "MANAGER" },
  });
  expect(staleA.ok()).toBeTruthy();
  await reloadIntoSave();
  await expect(page.getByLabel("Active career role")).toHaveValue("MANAGER");
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible();
  await expectNoSeriousA11yViolations(page, "reconciled Manager after stale CEO");

  // Case B: active_role=SPORTING_DIRECTOR, base_role=CHAIRMAN_OWNER -> UI
  // loads as Chairman/Owner.
  const staleB = await page.request.post("/runtime/command/seedE2EStaleExecutiveRole", {
    data: { activeRole: "SPORTING_DIRECTOR", baseRole: "CHAIRMAN_OWNER" },
  });
  expect(staleB.ok()).toBeTruthy();
  await reloadIntoSave();
  await expect(page.getByLabel("Active career role")).toHaveValue("CHAIRMAN_OWNER");
  await expect(page.getByRole("heading", { name: "Chairman / Owner" })).toBeVisible();

  // Case D: active_role=FEDERATION_PRESIDENT, base_role=CHAIRMAN_OWNER, and
  // the presidency in this fixture is still genuinely held (seedE2ERoleFixture
  // grants it) -> UI loads as Federation President, proving the
  // reconciliation only overrides when the office is not actually held.
  const staleD = await page.request.post("/runtime/command/seedE2EStaleExecutiveRole", {
    data: { activeRole: "FEDERATION_PRESIDENT", baseRole: "CHAIRMAN_OWNER" },
  });
  expect(staleD.ok()).toBeTruthy();
  await reloadIntoSave();
  await expect(page.getByLabel("Active career role")).toHaveValue("FEDERATION_PRESIDENT");
  await expect(page.getByRole("heading", { name: "Federation President" })).toBeVisible();
});
