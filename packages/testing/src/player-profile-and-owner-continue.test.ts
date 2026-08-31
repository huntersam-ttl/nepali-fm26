import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  reconcilePlayablePlayerProfilesOnce,
} from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const character = {
  fullName: "Owner Progression Test",
  dateOfBirth: "1990-01-01",
  startingAge: 36,
  languages: ["en"],
  footballBackground: "COMMUNITY_COACHING" as const,
  education: "SECONDARY" as const,
  playingExperience: "AMATEUR_PLAYER" as const,
  coachingExperience: "YOUTH_COACH" as const,
  businessBackground: "SMALL_BUSINESS" as const,
  startingReputationProfile: "LOCAL_RESPECTED" as const,
};

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("global gameplay profiles and owner progression", () => {
  it("completes every playable profile and advances owner operations", () => {
    const dir = mkdtempSync(join(tmpdir(), "nepal-profile-owner-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({
      savesDirectory: dir,
      worldDatasetPath: registryPath,
    });
    const clubs = service.listStartingClubs();
    expect(clubs.ok).toBe(true);
    if (!clubs.ok) return;
    const club = clubs.data.find((item) => item.division === "B")!;
    const created = service.createCareer({
      careerMode: "OWNER",
      saveName: "Profile owner",
      joinTeamId: club.teamId,
      character,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = created.data.header.worldDate;
    const continued = service.continueCareer();
    expect(continued.ok).toBe(true);
    if (!continued.ok) return;
    expect(continued.data.header.worldDate).not.toBe(before);
    service.closeCareer();
    const path = created.data.catalogEntry.filePath;
    const db = openGameDatabase(path);
    const save = db.prepare("SELECT world_date, random_seed FROM saves LIMIT 1").get() as {
      world_date: string;
      random_seed: string;
    };
    const audit = reconcilePlayablePlayerProfilesOnce(db, {
      worldDate: save.world_date,
      seed: save.random_seed,
    });
    expect(audit.total).toBeGreaterThan(0);
    expect(audit.complete).toBe(audit.total);
    expect(Object.values(audit.missingGameplay).every((count) => count === 0)).toBe(true);
    expect(audit.byDivision).toEqual(expect.objectContaining({}));
    db.close();
  }, 180_000);
});
