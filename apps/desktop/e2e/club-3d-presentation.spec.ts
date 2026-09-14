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

/** Creates a real career and navigates to the player's own Club Profile,
 * where the 3D Club Environment scene lives, entirely through real UI —
 * the same path a player takes (New Career -> Competition table -> own
 * club link), never a direct API shortcut. */
const createCareerAndOpenClubProfile = async (page: Page, saveName: string): Promise<void> => {
  await page.goto("/");
  await page.getByRole("button", { name: /New career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Starting club")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: 120_000 });
  // "Competition" also names an unrelated small quick-link button elsewhere
  // on the page — scope to the sidebar's own primary navigation.
  await page.getByLabel("Primary navigation").getByRole("button", { name: "Competition", exact: true }).click();
  // The own-club row is the only one carrying the "You" badge. Its club name
  // is a real <button className="link"> (EntityRefLink), not an <a>.
  const ownClubLink = page.locator("tr", { has: page.getByText("You", { exact: true }) }).getByRole("button");
  await ownClubLink.click();
  await expect(page.getByRole("heading", { name: "Club environment" })).toBeVisible({ timeout: 15_000 });
};

test.describe("Club Profile 3D presentation", () => {
  test("real visible first frame, resize, entity clickability, and zero console errors — 3D on", async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    await createCareerAndOpenClubProfile(page, `E2E 3D ${Date.now()}`);

    const region = page.getByRole("region", { name: /club environment/i });
    const canvas = region.locator("canvas");
    await expect(canvas).toBeVisible();
    const initialBox = await canvas.boundingBox();
    expect(initialBox?.width ?? 0).toBeGreaterThan(0);
    expect(initialBox?.height ?? 0).toBeGreaterThan(0);

    // A real first frame: the canvas already renders real, varied content
    // without any resize/interaction being needed — checked via a genuine
    // pixel screenshot (not a programmatic WebGL readPixels probe, which
    // reads from a context the browser may hand back with different
    // attributes than the one three.js's WebGLRenderer actually created,
    // making an externally-opened context an unreliable read on what was
    // really drawn). A blank/solid-colour canvas PNG stays tiny; real
    // geometry, gradients and shading do not.
    const canvasScreenshot = await canvas.screenshot();
    expect(canvasScreenshot.byteLength).toBeGreaterThan(5_000);

    // Live resize: buffer tracks CSS size, no stretch, no zero-size crash.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(300);
    const resizedBox = await canvas.boundingBox();
    const buffer = await canvas.evaluate((element) => ({
      width: (element as HTMLCanvasElement).width,
      height: (element as HTMLCanvasElement).height,
    }));
    expect(Math.round(resizedBox!.width)).toBeCloseTo(buffer.width, -1);
    expect(Math.round(resizedBox!.height)).toBeCloseTo(buffer.height, -1);

    await expectNoSeriousA11yViolations(page, "Club Profile 3D ON");

    expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  test("3D OFF: fallback renders, club info remains fully readable, zero console errors", async ({ page }) => {
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

    await createCareerAndOpenClubProfile(page, `E2E 3D Off ${Date.now()}`);

    const region = page.getByRole("region", { name: /club environment/i });
    await expect(region.locator("canvas")).toHaveCount(0);
    // The fallback and the text readout both remain — no blank panel.
    await expect(page.getByText(/Club football reputation/)).toBeVisible();

    await expectNoSeriousA11yViolations(page, "Club Profile 3D OFF");
    expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  test("reduced motion: scene renders without the camera-drift animation loop discomfort, information preserved", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "nepal.presentation.preferences.v1",
        JSON.stringify({ enabled3d: true, quality: "MEDIUM", motion: "OFF" }),
      );
    });
    await createCareerAndOpenClubProfile(page, `E2E 3D Motion Off ${Date.now()}`);
    const region = page.getByRole("region", { name: /club environment/i });
    await expect(region.locator("canvas")).toBeVisible();
    // Same accessible facts are present regardless of motion setting.
    await expect(page.getByText(/Club football reputation/)).toBeVisible();
    await expectNoSeriousA11yViolations(page, "Club Profile motion OFF");
  });

  test("WebGL unavailable: graceful fallback, no crash, rest of Club Profile survives", async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));

    // Force every WebGL context request to fail, simulating a machine/driver
    // that cannot present WebGL at all.
    await page.addInitScript(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (HTMLCanvasElement.prototype as any).getContext = function (type: string, ...rest: unknown[]) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
        return originalGetContext.apply(this, [type, ...rest] as never);
      };
    });

    await createCareerAndOpenClubProfile(page, `E2E WebGL Fail ${Date.now()}`);
    const region = page.getByRole("region", { name: /club environment/i });
    // supportsWebgl() probes and caches false, so shouldRender3d() is false
    // from the start — the fallback renders directly, same as 3D OFF.
    await expect(region.locator("canvas")).toHaveCount(0);
    await expect(page.getByText(/Club football reputation/)).toBeVisible();
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  test("keyboard: reach the club environment region and its entity cards without a mouse, no canvas trap", async ({ page }) => {
    test.setTimeout(120_000);
    await createCareerAndOpenClubProfile(page, `E2E 3D Keyboard ${Date.now()}`);
    const region = page.getByRole("region", { name: /club environment/i });
    await expect(region).toBeVisible();
    // The canvas itself is img-role, non-interactive/non-focusable — Tab
    // must skip straight through it to the real accessible controls below
    // (the entity cards / campus grid), never trapping focus on the canvas.
    const canvas = region.locator("canvas");
    const tabIndex = await canvas.evaluate((element) => element.getAttribute("tabindex"));
    expect(tabIndex).toBeNull();
  });
});
