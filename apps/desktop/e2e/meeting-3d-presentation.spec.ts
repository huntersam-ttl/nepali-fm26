import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

test.describe("Boardroom meeting 3D presentation", () => {
  test("boardroom scene renders alongside real meeting controls, camera presets work, canonical actions remain functional, zero console errors", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    await createExistingClubOwner(page, "B");
    await page.getByRole("button", { name: "Talk to Manager", exact: true }).click();
    await expect(page.getByText("Owner-manager meeting")).toBeVisible();

    const region = page.getByRole("region", { name: /boardroom/i });
    const canvas = region.locator("canvas");
    await expect(canvas).toBeVisible();
    const screenshot = await canvas.screenshot();
    expect(screenshot.byteLength).toBeGreaterThan(2_000);

    // Camera presets: real buttons, aria-pressed, actually move the camera.
    const cameras = region.getByRole("group", { name: "Camera view" });
    const room = cameras.getByRole("button", { name: "Room" });
    const table = cameras.getByRole("button", { name: "Table" });
    await expect(room).toHaveAttribute("aria-pressed", "true");
    const before = await canvas.screenshot();
    await table.click();
    await expect(table).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(200);
    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);

    // The 3D scene is additive: the real canonical meeting action still works.
    await page.getByRole("button", { name: "Start meeting" }).click();
    await expect(page.getByRole("button", { name: "Extend support" })).toBeVisible();

    expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  test("3D OFF: the meeting remains fully usable with no canvas mounted", async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "nepal.presentation.preferences.v1",
        JSON.stringify({ enabled3d: false, quality: "MEDIUM", motion: "FULL" }),
      );
    });
    await createExistingClubOwner(page, "B");
    await page.getByRole("button", { name: "Talk to Manager", exact: true }).click();
    await expect(page.getByText("Owner-manager meeting")).toBeVisible();
    const region = page.getByRole("region", { name: /boardroom/i });
    await expect(region).toHaveCount(0);
    await expect(page.getByText(/Board confidence/i).first()).toBeVisible();
  });

  test("axe: 0 serious/critical violations on the boardroom meeting screen", async ({ page }) => {
    test.setTimeout(120_000);
    await createExistingClubOwner(page, "B");
    await page.getByRole("button", { name: "Talk to Manager", exact: true }).click();
    await expect(page.getByText("Owner-manager meeting")).toBeVisible();
    await page.evaluate(axeSource);
    const results = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const axe = (window as any).axe;
      return axe.run(document, { resultTypes: ["violations"] });
    });
    const serious = (results.violations as Array<{ id: string; impact: string }>).filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious, JSON.stringify(serious, null, 2)).toHaveLength(0);
  });
});
