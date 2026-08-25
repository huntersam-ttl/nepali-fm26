import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startDesktopServer, type DesktopServerHandle } from "@nepal-football-sim/simulation";
import type {
  AppResult,
  DesktopApplicationState,
  SaveCatalogEntry,
  StartingClubOption,
} from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");

let handle: DesktopServerHandle | undefined;
const tempDirs: string[] = [];

afterEach(async () => {
  await handle?.close();
  handle = undefined;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const startRuntime = async (): Promise<DesktopServerHandle> => {
  const savesDirectory = mkdtempSync(join(tmpdir(), "nepal-runtime-"));
  tempDirs.push(savesDirectory);
  handle = await startDesktopServer({ savesDirectory, worldDatasetPath: WORLD_DATASET });
  return handle;
};

const call = async <T>(
  runtime: DesktopServerHandle,
  command: string,
  args: Record<string, unknown> = {},
  token = runtime.token,
): Promise<{ status: number; body: AppResult<T> }> => {
  const response = await fetch(`http://127.0.0.1:${runtime.port}/command/${command}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-runtime-token": token },
    body: JSON.stringify(args),
  });
  return { status: response.status, body: (await response.json()) as AppResult<T> };
};

describe("desktop runtime transport", () => {
  it("serves the whole career loop over the loopback command surface", async () => {
    const runtime = await startRuntime();

    const clubs = await call<StartingClubOption[]>(runtime, "listStartingClubs");
    expect(clubs.body.ok).toBe(true);
    if (!clubs.body.ok) return;
    const target = clubs.body.data[0]!;

    const created = await call<DesktopApplicationState>(runtime, "createCareer", {
      command: {
        saveName: "Runtime Save",
        joinTeamId: target.teamId,
        character: {
          fullName: "Maya Adhikari",
          preferredDisplayName: "Maya",
          dateOfBirth: "1993-05-12",
          startingAge: 33,
          languages: ["ne", "en"],
          footballBackground: "COMMUNITY_COACHING",
          education: "SPORTS_RELATED_DEGREE",
          playingExperience: "AMATEUR_PLAYER",
          coachingExperience: "YOUTH_COACH",
          businessBackground: "SMALL_BUSINESS",
          startingReputationProfile: "LOCAL_RESPECTED",
        },
      },
    });
    expect(created.body.ok).toBe(true);
    if (!created.body.ok) return;
    expect(created.body.data.header.clubName).toBe(target.clubName);

    const continued = await call<DesktopApplicationState>(runtime, "continueCareer");
    expect(continued.body.ok).toBe(true);
    if (!continued.body.ok) return;
    expect(continued.body.data.save.worldDate).not.toBe(created.body.data.save.worldDate);

    expect((await call<SaveCatalogEntry>(runtime, "saveCareer")).body.ok).toBe(true);
    expect((await call(runtime, "closeCareer")).body).toEqual({ ok: true, data: { closed: true } });
    expect((await call(runtime, "getCareerHeader")).body).toMatchObject({
      ok: false,
      error: { code: "SESSION_NOT_OPEN" },
    });

    const reloaded = await call<DesktopApplicationState>(runtime, "loadCareer", {
      saveId: created.body.data.save.id,
    });
    expect(reloaded.body.ok).toBe(true);
    if (!reloaded.body.ok) return;
    expect(reloaded.body.data.save.worldDate).toBe(continued.body.data.save.worldDate);
    expect(reloaded.body.data.header.clubName).toBe(target.clubName);
    // Importing the full Nepal world is slow, and these are async tests, so the
    // default 5s timeout that never fires for the synchronous suites applies here.
  }, 120_000);

  it("rejects commands without the runtime token and unknown commands with it", async () => {
    const runtime = await startRuntime();
    const unauthorised = await call(runtime, "listSaves", {}, "wrong-token");
    expect(unauthorised.status).toBe(401);
    expect(unauthorised.body).toMatchObject({ error: { code: "RUNTIME_UNAVAILABLE" } });

    const unknown = await call(runtime, "notACommand");
    expect(unknown.body).toMatchObject({ ok: false, error: { code: "RUNTIME_UNAVAILABLE" } });

    const health = await fetch(`http://127.0.0.1:${runtime.port}/health`);
    expect(health.status).toBe(200);
  }, 120_000);
});
