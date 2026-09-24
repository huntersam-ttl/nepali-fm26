import { expect, test, type Page } from "@playwright/test";

/**
 * Career Jobs and career transitions. Only canonical, supported flows: the
 * manager vacancy market, the player's own applications, apply / accept /
 * decline, and the Career-owned Resign action. Interviews and qualifications
 * are backend-only today and intentionally have no screens. The world date is
 * advanced with the same continueCareer command the app exposes.
 */
const LONG = 180_000;

const createCareer = async (page: Page, saveName: string): Promise<void> => {
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Starting club")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: LONG });
};

const goTo = (page: Page, screen: string) =>
  page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: screen, exact: true })
    .click();

type Envelope = { ok: boolean; error?: { code: string; message: string } };

const runtime = async (page: Page, name: string, data: object = {}): Promise<Envelope> => {
  const response = await page.request.post(`/runtime/command/${name}`, { data });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Envelope;
};

const advanceDay = async (page: Page): Promise<void> => {
  // Best effort: a matchday can legitimately block advancing while employed.
  await runtime(page, "continueCareer");
};

const openJobs = async (page: Page): Promise<void> => {
  await goTo(page, "Career Jobs");
  await expect(page.getByRole("heading", { name: "Career Jobs", level: 2 }).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "My applications", level: 2 })).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
};

const reopenJobs = async (page: Page): Promise<void> => {
  await goTo(page, "Career Overview");
  await openJobs(page);
};

const resignViaCareer = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: /^Resign from / }).click();
  await expect(page.getByRole("group", { name: "Confirm career move" })).toContainText(/recorded as resigned/i);
  await page.getByRole("button", { name: "Confirm resignation" }).click();
  await expect(page.getByText(/You are currently unemployed/i)).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
};

/** Applies to eligible vacancies until an offer exists; returns the offering club. */
const applyUntilOffered = async (page: Page): Promise<string> => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const apply = page.getByRole("button", { name: /^Apply to / }).and(page.locator(":enabled"));
    if ((await apply.count()) > 0) {
      const label = (await apply.first().getAttribute("aria-label")) ?? "";
      const club = label.replace(/^Apply to /, "");
      await apply.first().click();
      const applications = page.getByRole("table", { name: "My job applications" });
      await expect(applications).toContainText(club);

      // Persisted: leave and return, and the application is still listed.
      await reopenJobs(page);
      await expect(applications).toContainText(club);

      if ((await page.getByRole("button", { name: /^Accept offer from / }).count()) > 0) return club;
    }
    await advanceDay(page);
    await reopenJobs(page);
  }
  throw new Error("no job offer was received within the attempt budget");
};

test("1. Employed manager: Jobs is honest and offers a confirmed Resign", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Jobs employed ${Date.now()}`);
  await goTo(page, "Career Jobs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Career Jobs", level: 2 }).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Open vacancies", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "My applications", level: 2 })).toBeVisible();
  await expect(page.getByText(/You are currently employed/i)).toBeVisible();

  // Resign needs an explicit confirmation and can be cancelled without effect.
  await page.getByRole("button", { name: /^Resign from / }).click();
  await expect(page.getByRole("group", { name: "Confirm career move" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("group", { name: "Confirm career move" })).toHaveCount(0);
  await expect(page.getByText(/You are currently employed/i)).toBeVisible();

  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/salary|wage|deadline|closing date|probability|shortlist|interview score/i);
});

test("2. Resign, apply (persists), accept, then move again while employed; history keeps every spell", async ({
  page,
}) => {
  test.setTimeout(900_000);
  await createCareer(page, `Jobs transitions ${Date.now()}`);
  const firstClub = (await page.getByRole("heading", { level: 1 }).innerText()).trim();

  // Resign through the live Career workspace.
  await goTo(page, "Career Jobs");
  await resignViaCareer(page);
  await goTo(page, "Career History");
  await expect(page.getByRole("heading", { name: "Appointments", level: 2 })).toBeVisible();
  await expect(page.locator("main")).toContainText(/resigned/i);

  // Unemployed: apply, application persists, accept the offer.
  await openJobs(page);
  const secondClub = await applyUntilOffered(page);
  await page.getByRole("button", { name: `Accept offer from ${secondClub}` }).click();
  await expect(page.getByText(/You are currently employed/i)).toBeVisible({ timeout: 30_000 });

  await goTo(page, "Career Overview");
  await expect(page.locator("main")).toContainText(secondClub);
  await goTo(page, "Career History");
  await expect(page.getByRole("heading", { name: "Appointments", level: 2 })).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
  expect(await page.getByText("current", { exact: true }).count()).toBe(1);

  // Employed: another job can be taken, but only after confirmation, and the
  // current appointment is recorded as resigned.
  await openJobs(page);
  const thirdClub = await applyUntilOffered(page);
  await page.getByRole("button", { name: `Accept offer from ${thirdClub}` }).click();
  await expect(page.getByRole("group", { name: "Confirm career move" })).toContainText(/recorded as resigned/i);
  await page.getByRole("button", { name: "Confirm move" }).click();
  await expect(page.getByRole("group", { name: "Confirm career move" })).toHaveCount(0);
  await expect(page.getByText(new RegExp(`employed at ${thirdClub}`, "i"))).toBeVisible({ timeout: 30_000 });

  await goTo(page, "Career Overview");
  await expect(page.locator("main")).toContainText(thirdClub);
  await goTo(page, "Career History");
  await expect(page.getByRole("heading", { name: "Appointments", level: 2 })).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
  const history = await page.locator("main").innerText();
  expect(history).toContain(firstClub);
  expect(history).toContain(secondClub);
  expect(history).toContain(thirdClub);
  // One current appointment only; the two earlier spells are closed.
  expect(await page.getByText("current", { exact: true }).count()).toBe(1);
});

test("3. Owner and President cannot use Manager job commands; the same person returns to Manager", async ({
  page,
}) => {
  test.setTimeout(700_000);
  await createCareer(page, `Jobs roles ${Date.now()}`);
  expect((await runtime(page, "seedE2ERoleFixture")).ok).toBe(true);

  const personId = async (): Promise<string> => {
    const response = await page.request.post("/runtime/command/getCareerOverview", { data: {} });
    return (await response.json()).data.personId as string;
  };
  const manager = await personId();

  for (const role of ["CHAIRMAN_OWNER", "FEDERATION_PRESIDENT"]) {
    expect((await runtime(page, "switchActiveCareerRole", { targetRole: role })).ok).toBe(true);
    for (const [command, data] of [
      ["applyForJob", { vacancyId: "none" }],
      ["acceptJobOffer", { applicationId: "none" }],
      ["declineJobOffer", { applicationId: "none" }],
      ["resignFromClub", {}],
    ] as const) {
      const result = await runtime(page, command, data);
      expect(result.ok, `${command} as ${role}`).toBe(false);
      expect(result.error?.code, `${command} as ${role}`).toBe("ROLE_NOT_AUTHORIZED");
    }
    expect(await personId()).toBe(manager);
  }

  expect((await runtime(page, "switchActiveCareerRole", { targetRole: "MANAGER" })).ok).toBe(true);
  const back = await runtime(page, "applyForJob", { vacancyId: "none" });
  expect(back.ok).toBe(false);
  expect(back.error?.code).not.toBe("ROLE_NOT_AUTHORIZED");
  expect(await personId()).toBe(manager);
});

test("4. Career family order and Back navigation include Jobs", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Jobs nav ${Date.now()}`);
  await goTo(page, "Career Overview");
  await goTo(page, "Career Jobs");
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByRole("heading", { name: "Career Overview", level: 2 }).last()).toBeVisible();
});
