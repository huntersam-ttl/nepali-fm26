import { expect, type Page } from "@playwright/test";

export type PlayableDivision = "A" | "B" | "C";

const fillCharacter = async (page: Page, saveName: string): Promise<void> => {
  await page.getByLabel("Save name").fill(saveName);
  await page.getByLabel("Full name").fill(`${saveName} Owner`);
  await page.getByLabel("Display name").fill(`${saveName} Owner`);
};

export const createExistingClubOwner = async (page: Page, division: PlayableDivision): Promise<string> => {
  const saveName = `Browser Owner ${division} ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await fillCharacter(page, saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("tab", { name: `${division} Division` }).click();
  const club = page.getByRole("button", { name: new RegExp(`${division} Division`) }).first();
  await expect(club).toBeVisible();
  await club.click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: 120_000 });
  const fixture = await page.request.post("/runtime/command/seedE2ERoleFixture", { data: {} });
  expect(fixture.ok()).toBeTruthy();
  expect((await fixture.json()).ok).toBeTruthy();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Load Career/i }).click();
  await page.getByRole("button", { name: new RegExp(saveName) }).click();
  await page.getByLabel("Active career role").selectOption("CHAIRMAN_OWNER");
  await expect(page.getByRole("heading", { name: "Chairman / Owner" })).toBeVisible();
  return saveName;
};

export const createFounderOwner = async (page: Page): Promise<string> => {
  const saveName = `Browser Founder C ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await fillCharacter(page, saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Career mode").selectOption("OWNER");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Club name").fill(`${saveName} FC`);
  await page.getByLabel("Province / district").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  // World generation plus the founder's follow-up identity write (colours,
  // badge, and now Home/Away/Third kits) can run past the default 15s
  // expect timeout, same as createExistingClubOwner's analogous wait below.
  await expect(page.getByRole("button", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Chairman / Owner" })).toBeVisible();
  return saveName;
};

export const openOwnerRoute = async (page: Page, label: "Finances" | "Sponsorship" | "Investors"): Promise<void> => {
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByRole("heading", { name: label === "Finances" ? "Club finance" : label === "Sponsorship" ? "Sponsorship" : "Ownership and investors" })).toBeVisible();
};

export const saveReloadOwnerCareer = async (page: Page, saveName: string): Promise<void> => {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Load Career/i }).click();
  await page.getByRole("button", { name: new RegExp(saveName) }).click();
  await page.getByLabel("Active career role").selectOption("CHAIRMAN_OWNER");
  await expect(page.getByRole("heading", { name: "Chairman / Owner" })).toBeVisible();
};
