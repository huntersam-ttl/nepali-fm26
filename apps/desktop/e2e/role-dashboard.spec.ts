import { expect, test } from "@playwright/test";

test("switches through a deterministic multi-role career dashboard", async ({ page }) => {
  test.setTimeout(180_000);
  const saveName = `E2E Roles ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/ }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Starting club")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible();

  const fixture = await page.request.post("/runtime/command/seedE2ERoleFixture", { data: {} });
  expect(fixture.ok()).toBeTruthy();
  expect((await fixture.json()).ok).toBeTruthy();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Load Career/ }).click();
  await page.getByRole("button", { name: new RegExp(saveName) }).click();
  await expect(page.getByLabel("Active career role")).toHaveValue("MANAGER");

  await page.getByLabel("Active career role").selectOption("CHAIRMAN_OWNER");
  await expect(page.getByRole("heading", { name: "Chairman / Owner" })).toBeVisible();
  await expect(page.getByText("Club balance")).toBeVisible();
  await expect(page.getByText("Recent club transactions")).toBeVisible();
  const budgetAmount = await page.locator("input[type=number]").inputValue();
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.locator("input[type=number]")).toHaveValue(budgetAmount);

  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByRole("heading", { name: "Federation President" })).toBeVisible();
  await expect(page.getByText("Federation balance")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Governance", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "National teams", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Load Career/ }).click();
  await page.getByRole("button", { name: new RegExp(saveName) }).click();
  await expect(page.getByLabel("Active career role")).toHaveValue("FEDERATION_PRESIDENT");
  await expect(page.getByRole("heading", { name: "Federation President" })).toBeVisible();
});
