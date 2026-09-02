import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId, LiveMatchView } from "@nepal-football-sim/shared-types";

const registryPath = resolve("data/nepal/2026-08/club-registry.json");

describe("owner spectator match progression", () => {
  it("advances a watched fixture through half time and full time without tactics", () => {
    const directory = mkdtempSync(join(tmpdir(), "nepal-owner-spectator-"));
    const service = new DesktopApplicationService({
      savesDirectory: directory,
      worldDatasetPath: registryPath,
    });
    try {
      const clubs = service.listStartingClubs();
      expect(clubs.ok).toBe(true);
      if (!clubs.ok) return;
      const club = clubs.data.find((option) => option.division === "C") ?? clubs.data[0]!;
      const created = service.createCareer({
        careerMode: "OWNER",
        saveName: "Owner spectator progression",
        joinTeamId: club.teamId,
        character: {
          fullName: "Owner Spectator",
          dateOfBirth: "1990-01-01",
          startingAge: 36,
          languages: ["en"],
          footballBackground: "COMMUNITY_COACHING",
          education: "SECONDARY",
          playingExperience: "AMATEUR_PLAYER",
          coachingExperience: "YOUTH_COACH",
          businessBackground: "SMALL_BUSINESS",
          startingReputationProfile: "LOCAL_RESPECTED",
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const matchday = service.getOwnerMatchday();
      expect(matchday.ok).toBe(true);
      if (!matchday.ok || !matchday.data.currentFixtureId) return;
      const fixtureId = matchday.data.currentFixtureId as EntityId;
      const started = service.watchOwnerFixture(fixtureId);
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      expect(started.data.finalized).toBe(false);

      let view: LiveMatchView = started.data;
      for (let guard = 0; guard < 80 && view.period !== "FULL_TIME"; guard += 1) {
        const next =
          view.period === "HALF_TIME" || view.period === "EXTRA_TIME_HALF_TIME"
            ? service.continueOwnerFixture(fixtureId)
            : service.advanceOwnerFixture({ minutes: 15 }, fixtureId, "KEY_EVENTS");
        expect(next.ok).toBe(true);
        if (!next.ok) return;
        view = next.data;
      }
      expect(view.period).toBe("FULL_TIME");
      expect(view.finalized).toBe(true);

      const resumed = service.watchOwnerFixture(fixtureId);
      expect(resumed).toMatchObject({ ok: true, data: { period: "FULL_TIME", finalized: true } });
      expect(service.updateLiveTactics({} as never)).toMatchObject({
        ok: false,
        error: { code: "ROLE_NOT_AUTHORIZED" },
      });
      expect(service.getOwnerPostMatchSuggestion().ok).toBe(true);
    } finally {
      service.closeCareer();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 240_000);
});
