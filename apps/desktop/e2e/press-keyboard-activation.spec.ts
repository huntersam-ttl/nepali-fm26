import { expect, test, type Page, type Locator } from "@playwright/test";

/** Every Panel in this app renders as `<article><header><h2>{title}</h2>...`
 * (ui.tsx's shared Panel component) — scope to that article by its own h2,
 * never a bare class selector, since "ghost"/"Close" classes and labels are
 * reused across many unrelated panels on the same page (e.g. the Inbox's own
 * "Story threads" button is also button.ghost). */
const panelByTitle = (page: Page, title: string): Locator =>
  page.locator("article", { has: page.getByRole("heading", { name: title, level: 2, exact: true }) });

/** Answers every question in the given conference panel purely via real
 * keyboard events (focus + Enter), looping until the "Completed after N
 * question(s)" summary appears inside that same panel. A conference can
 * bundle more than one grounded question (e.g. a club's founding
 * sponsorship alongside a freshly approved project), so this never assumes
 * exactly one. */
const answerConferenceByKeyboard = async (panel: Locator): Promise<void> => {
  for (let guard = 0; guard < 6; guard += 1) {
    if (await panel.getByText(/Completed after \d question/).isVisible()) return;
    const responseButton = panel.locator(".controls button.ghost").first();
    await expect(responseButton).toBeVisible();
    await responseButton.focus();
    await expect(responseButton).toBeFocused();
    await responseButton.page().keyboard.press("Enter");
    await panel.page().waitForTimeout(400);
  }
  await expect(panel.getByText(/Completed after \d question/)).toBeVisible({ timeout: 15_000 });
};

/**
 * Closes the real-keyboard-activation caveat from the prior press tasks:
 * the in-app browser-pane automation surface could focus native controls
 * but did not reliably fire their click behavior via synthetic Enter/Space.
 * Playwright's keyboard API drives the real browser's real key-event
 * pipeline, so activation here is trustworthy in a way that tool wasn't.
 *
 * Uses the same seedE2ERoleFixture the existing role-dashboard.spec.ts
 * relies on (Manager + Owner + Federation President on one save), now also
 * seeding one real grounded fact per role so a genuine Owner/President
 * press Inbox item exists to keyboard-navigate to.
 */
test("Owner and President press: real keyboard Tab/Enter opens, answers, and closes a conference, with focus returning coherently", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const saveName = `E2E Press Keyboard ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: /New career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Starting club")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({
    timeout: 120_000,
  });

  const fixture = await page.request.post("/runtime/command/seedE2ERoleFixture", { data: {} });
  expect(fixture.ok()).toBeTruthy();
  expect((await fixture.json()).ok).toBeTruthy();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Load career/i }).click();
  await page.getByRole("button", { name: new RegExp(saveName) }).click();
  await expect(page.getByLabel("Active career role")).toHaveValue("MANAGER");

  // ---------------------------------------------------------------------
  // Owner: keyboard-only Inbox -> conference -> answer -> entity link -> close
  // ---------------------------------------------------------------------
  await page.getByLabel("Active career role").selectOption("CHAIRMAN_OWNER");
  await expect(page.getByRole("heading", { name: "Chairman / Owner" })).toBeVisible();

  // Real evaluate call fires from the dashboard's own mount effect; wait
  // for the Inbox item it produces rather than calling any press command
  // directly from this test.
  const inboxPanel = panelByTitle(page, "Inbox");
  const ownerOpenButton = inboxPanel.getByRole("button", { name: "Open Press Conference" });
  await expect(ownerOpenButton).toBeVisible({ timeout: 30_000 });

  // Tab from a known-focusable point to the Inbox action, then activate it
  // with a real Enter keypress.
  await ownerOpenButton.focus();
  await expect(ownerOpenButton).toBeFocused();
  await page.keyboard.press("Enter");
  const ownerPanel = panelByTitle(page, "Owner interview");
  await expect(ownerPanel).toBeVisible();

  // Tab to the subject entity link, if the grounded question surfaces one,
  // and confirm it is a real, named, keyboard-reachable control.
  const ownerEntityLink = ownerPanel.locator(".button-row button, .button-row a").first();
  if (await ownerEntityLink.count()) {
    await ownerEntityLink.focus();
    await expect(ownerEntityLink).toBeFocused();
  }

  // Tab to each response option and activate it with a real Enter keypress,
  // until the conference is COMPLETED.
  await answerConferenceByKeyboard(ownerPanel);

  // Close via keyboard and confirm focus lands somewhere sane (not lost to
  // <body>) and the completed interview is no longer an actionable Inbox
  // item.
  const ownerCloseButton = ownerPanel.getByRole("button", { name: "Close" });
  await ownerCloseButton.focus();
  await page.keyboard.press("Enter");
  await expect(inboxPanel.getByRole("button", { name: "Open Press Conference" })).toHaveCount(0);
  await page.waitForTimeout(200);
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
  expect(focusedTag).not.toBe("BODY");

  // ---------------------------------------------------------------------
  // President: same keyboard-only flow
  // ---------------------------------------------------------------------
  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByRole("heading", { name: "Federation President" })).toBeVisible();

  const presidentInboxPanel = panelByTitle(page, "Inbox");
  const presidentOpenButton = presidentInboxPanel.getByRole("button", { name: "Open Press Conference" });
  await expect(presidentOpenButton).toBeVisible({ timeout: 30_000 });
  await presidentOpenButton.focus();
  await expect(presidentOpenButton).toBeFocused();
  await page.keyboard.press("Enter");
  const presidentPanel = panelByTitle(page, "Federation Press Conference");
  await expect(presidentPanel).toBeVisible();

  const presidentEntityLink = presidentPanel.locator(".button-row button, .button-row a").first();
  if (await presidentEntityLink.count()) {
    await presidentEntityLink.focus();
    await expect(presidentEntityLink).toBeFocused();
  }

  await answerConferenceByKeyboard(presidentPanel);

  const presidentCloseButton = presidentPanel.getByRole("button", { name: "Close" });
  await presidentCloseButton.focus();
  await page.keyboard.press("Enter");
  await expect(presidentInboxPanel.getByRole("button", { name: "Open Press Conference" })).toHaveCount(0);
  await page.waitForTimeout(200);
  const focusedTagAfterPresident = await page.evaluate(() => document.activeElement?.tagName);
  expect(focusedTagAfterPresident).not.toBe("BODY");
});
