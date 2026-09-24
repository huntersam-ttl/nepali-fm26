import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 9A — Federation Overview and Federation Projects for the active
 * President. The role fixture gives one person Manager, Owner and President
 * with a real ACTIVE term and a real "National Training Centre" programme.
 */
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const seriousViolations = async (page: Page): Promise<unknown[]> => {
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (root: Document, options: unknown) => Promise<unknown> } }).axe;
    return axe.run(document, { resultTypes: ["violations"] });
  });
  return (results.violations as Array<{ id: string; impact: string; nodes: unknown[] }>).filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
};

const becomePresident = async (page: Page): Promise<void> => {
  await createExistingClubOwner(page, "A");
  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByText("Federation balance")).toBeVisible();
};

const nav = (page: Page, label: string) =>
  page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: label, exact: true });

const sectionTitle = (page: Page) => page.locator(".page-header h2");

const runtime = async (page: Page, name: string, data: object = {}) => {
  const response = await page.request.post(`/runtime/command/${name}`, { data });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string } };
};

test("1. President: Federation Overview and Projects show real state, and Back works", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);

  await nav(page, "Federation Overview").click();
  await expect(sectionTitle(page)).toHaveText("Federation overview");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  for (const panel of [
    "Federation and presidency",
    "Needs your attention",
    "National football system",
    "What this office governs",
  ]) {
    await expect(page.getByRole("heading", { name: panel, level: 2 })).toBeVisible();
  }
  const main = page.locator("main");
  await expect(main).toContainText("All Nepal Football Association");
  await expect(main).toContainText(/– 2030-01-01/);
  await expect(main).toContainText("Active");
  await expect(main).toContainText(/same person across every role/i);
  await expect(main).toContainText(/base career as (Manager|Club Owner)/i);
  const text = await main.innerText();
  expect(text).not.toMatch(/election|probabilit|coalition|influence|voting/i);

  await nav(page, "Federation Projects").click();
  await expect(sectionTitle(page)).toHaveText("Federation projects");
  const inProgress = page.getByRole("table", { name: "Federation programmes in progress" });
  await expect(inProgress).toContainText("National Training Centre");
  await expect(inProgress).toContainText("Construction");
  await expect(page.locator('[role="progressbar"], progress')).toHaveCount(0);

  // Overview shortcuts use the shared navigation model, so Back returns to it.
  await nav(page, "Federation Overview").click();
  await page.locator("main").getByRole("button", { name: "Governance", exact: true }).click();
  await expect(sectionTitle(page)).toHaveText("Governance");
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(sectionTitle(page)).toHaveText("Federation overview");
});

test("2. Role boundary and career continuity across President, Manager and Owner", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  const person = async (): Promise<string> => {
    const result = await runtime(page, "getCareerOverview");
    return result.data?.personId as string;
  };
  const presidentPerson = await person();

  // President has the Federation destinations and its own dashboard command.
  await expect(nav(page, "Federation Overview")).toBeVisible();
  expect((await runtime(page, "getFederationPresidentDashboard")).ok).toBe(true);

  for (const [role, label] of [
    ["MANAGER", "Manager"],
    ["CHAIRMAN_OWNER", "Chairman / Owner"],
  ] as const) {
    await page.getByLabel("Active career role").selectOption(role);
    await expect(page.getByRole("button", { name: "Federation Overview", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Federation Projects", exact: true })).toHaveCount(0);
    const denied = await runtime(page, "getFederationPresidentDashboard");
    expect(denied.ok, `dashboard as ${label}`).toBe(false);
    expect(denied.error?.code).toBe("ROLE_NOT_AUTHORIZED");
    const overview = await runtime(page, "getCareerOverview");
    expect(overview.data?.personId).toBe(presidentPerson);
    expect(overview.data?.isTemporaryPresidentOffice).toBe(false);
  }

  // Back to the presidency: same person, base career still present.
  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(nav(page, "Federation Overview")).toBeVisible();
  const overview = await runtime(page, "getCareerOverview");
  expect(overview.data?.personId).toBe(presidentPerson);
  expect(overview.data?.isTemporaryPresidentOffice).toBe(true);
  expect(overview.data?.baseRole).toBeTruthy();
});

test("3. Federation screens: no overflow at every width, one h1, axe clean, keyboard reachable", async ({ page }) => {
  test.setTimeout(600_000);
  await becomePresident(page);
  const screens: Array<[string, string]> = [
    ["Federation Overview", "Federation overview"],
    ["Federation Projects", "Federation projects"],
  ];
  for (const width of [721, 1024, 1280, 1440, 1600]) {
    await page.setViewportSize({ width, height: 800 });
    for (const [label, title] of screens) {
      await nav(page, label).click();
      await expect(sectionTitle(page)).toHaveText(title);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      );
      expect(noOverflow, `${label} at ${width}px must not overflow the page`).toBe(true);
    }
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  for (const [label, title] of screens) {
    await nav(page, label).click();
    await expect(sectionTitle(page)).toHaveText(title);
    const violations = await seriousViolations(page);
    if (violations.length > 0) console.log(`axe serious/critical on ${label}:`, JSON.stringify(violations, null, 2));
    expect(violations, `serious/critical axe on ${label}`).toHaveLength(0);
  }

  // Keyboard: the sidebar entry is focusable and activates with Enter.
  await nav(page, "Federation Overview").focus();
  await page.keyboard.press("Enter");
  await expect(sectionTitle(page)).toHaveText("Federation overview");
});
