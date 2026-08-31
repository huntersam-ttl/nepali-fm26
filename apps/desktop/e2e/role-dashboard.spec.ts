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
  await page.getByRole("button", { name: "Finances", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Club finance" })).toBeVisible();
  await page.getByRole("button", { name: "Manager", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Manager oversight" })).toBeVisible();
  await page.getByRole("button", { name: "Facilities", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ground and facilities" })).toBeVisible();
  await page.getByRole("button", { name: "Sponsorship", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sponsorship" })).toBeVisible();

  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByRole("heading", { name: "Federation President" })).toBeVisible();
  await expect(page.getByText("Federation balance")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Governance", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "National teams", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Governance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Governance", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Federation finance" })).toBeVisible();
  await page.getByRole("button", { name: "National Teams", exact: true }).click();
  await expect(page.getByRole("heading", { name: "National teams", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Election / Tenure", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Presidency and tenure" })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Load Career/ }).click();
  await page.getByRole("button", { name: new RegExp(saveName) }).click();
  await expect(page.getByLabel("Active career role")).toHaveValue("FEDERATION_PRESIDENT");
  await expect(page.getByRole("heading", { name: "Federation President" })).toBeVisible();
});
