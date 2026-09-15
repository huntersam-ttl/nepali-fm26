import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";

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

/** Creates a real career, switches to Federation President (via the real
 * seeded fixture, which grants a real tenure and initializes federation
 * governance), and lands on the President Dashboard where the federation
 * 3D scene lives. */
const createPresidentCareer = async (page: Page, saveName: string): Promise<void> => {
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
  expect((await fixture.json()).ok).toBeTruthy();

  // The role picker's option list is fetched once at load; a save/reload
  // cycle is required before the freshly-seeded Owner/President roles
  // appear as selectable options (same pattern role-dashboard.spec.ts uses).
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Load career/i }).click();
  await page.getByRole("button", { name: new RegExp(saveName) }).click();
  await expect(page.getByLabel("Active career role")).toHaveValue("MANAGER");

  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByRole("heading", { name: "Federation President" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Federation environment" })).toBeVisible({ timeout: 15_000 });
};

test.describe("Federation President 3D presentation", () => {
  test("federation scene renders, role switch shows the federation context, camera presets and click-through work, zero console errors", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    await createPresidentCareer(page, `E2E Federation ${Date.now()}`);

    const region = page.getByRole("region", { name: /federation environment/i });
    const canvas = region.locator("canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);

    // Real first frame: a genuine screenshot, not a blank/solid canvas.
    const screenshot = await canvas.screenshot();
    expect(screenshot.byteLength).toBeGreaterThan(3_000);

    // Camera presets: real buttons, aria-pressed state, move the camera.
    const cameras = region.getByRole("group", { name: "Camera view" });
    const overview = cameras.getByRole("button", { name: "Overview" });
    const hq = cameras.getByRole("button", { name: "Headquarters" });
    await expect(overview).toHaveAttribute("aria-pressed", "true");
    const before = await canvas.screenshot();
    await hq.click();
    await expect(hq).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(200);
    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);

    // Clicking through to a real canonical destination (never a fake link).
    await region.getByRole("button", { name: "Open governance" }).click();
    await expect(page.getByRole("heading", { name: "Governance", exact: true })).toBeVisible();

    // Role switch away and back: presidency ends the federation context,
    // returning to it shows the same federation scene again.
    await page.getByLabel("Active career role").selectOption("MANAGER");
    await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible();
    await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
    await expect(page.getByRole("heading", { name: "Federation environment" })).toBeVisible({ timeout: 15_000 });

    await expectNoSeriousA11yViolations(page, "Federation President dashboard");
    expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  test("3D OFF: fallback renders, federation info remains readable, zero console errors", async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    await page.addInitScript(() => {
      window.localStorage.setItem(
        "nepal.presentation.preferences.v1",
        JSON.stringify({ enabled3d: false, quality: "MEDIUM", motion: "FULL" }),
      );
    });

    await createPresidentCareer(page, `E2E Federation Off ${Date.now()}`);
    const region = page.getByRole("region", { name: /federation environment/i });
    await expect(region.locator("canvas")).toHaveCount(0);
    await expect(page.getByText(/headquarters and national football centre/i)).toBeVisible();

    await expectNoSeriousA11yViolations(page, "Federation President dashboard 3D OFF");
    expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  test("keyboard: camera and destination controls are reachable and operable without a mouse", async ({ page }) => {
    test.setTimeout(120_000);
    await createPresidentCareer(page, `E2E Federation Keyboard ${Date.now()}`);
    const region = page.getByRole("region", { name: /federation environment/i });
    const nationalCentre = region.getByRole("button", { name: "National football centre", exact: true });
    await nationalCentre.focus();
    await expect(nationalCentre).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(nationalCentre).toHaveAttribute("aria-pressed", "true");

    const openNationalDevelopment = region.getByRole("button", { name: "Open national development" });
    await openNationalDevelopment.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "National development" })).toBeVisible();
  });
});
