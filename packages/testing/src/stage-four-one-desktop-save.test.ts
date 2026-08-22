import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CURRENT_DATABASE_VERSION,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const tempDirs: string[] = [];

const tempSaveDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-desktop-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("stage four one desktop save integration", () => {
  it("creates, lists, loads and summarizes a persisted manager career save", () => {
    const service = new DesktopApplicationService(tempSaveDir());
    const created = service.createCareer(command("Stage 4.1 Save", 33));

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.home.managerName).toBe("Maya");
    expect(created.data.home.clubName).toBe("Kathmandu Testing Club");
    expect(created.data.squad).toHaveLength(18);
    expect(created.data.fixtures.length).toBeGreaterThan(0);
    expect(created.data.activeTactic?.assignments).toHaveLength(11);
    expect(created.data.activeTactic?.bench).toHaveLength(7);

    const listed = service.listSaves();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]).toMatchObject({
      displayName: "Stage 4.1 Save",
      characterName: "Maya",
      currentRole: "Manager",
    });

    const loaded = service.loadSave(created.data.save.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.data.squad[0]?.name).toContain("Kathmandu");
    expect(loaded.data.activeTactic?.name).toBe("Saved 4-3-3");
  });

  it("persists edited tactics, XI, bench and set pieces across reload", () => {
    const service = new DesktopApplicationService(tempSaveDir());
    const created = service.createCareer(command("Tactic Save", 33));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const tactic = created.data.activeTactic!;
    const saved = service.saveTactic(created.data.save.id, {
      ...tactic,
      name: "High press saved tactic",
      style: "HIGH_PRESS",
      assignments: tactic.assignments.map((assignment, index) =>
        index === 1 ? { ...assignment, roleId: "WING_BACK" } : assignment,
      ),
      bench: [...tactic.bench].reverse(),
      setPieces: { ...tactic.setPieces, penaltyTaker: tactic.assignments[10]?.playerId },
    });

    expect(saved.ok).toBe(true);
    const reloaded = service.loadSave(created.data.save.id);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.data.activeTactic?.name).toBe("High press saved tactic");
    expect(reloaded.data.activeTactic?.style).toBe("HIGH_PRESS");
    expect(reloaded.data.activeTactic?.assignments[1]?.roleId).toBe("WING_BACK");
    expect(reloaded.data.activeTactic?.bench[0]).toBe(tactic.bench.at(-1));
    expect(reloaded.data.activeTactic?.setPieces.penaltyTaker).toBe(
      tactic.assignments[10]?.playerId,
    );
  });

  it("quick sims through the application service and reloads persisted match state", () => {
    const service = new DesktopApplicationService(tempSaveDir());
    const created = service.createCareer(command("Quick Sim Save", 33));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const simulated = service.quickSimMatch(
      created.data.save.id,
      created.data.home.nextFixture?.id,
    );
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;
    expect(simulated.data.home.previousResult?.score).toMatch(/\d-\d/);
    expect(simulated.data.home.inbox.some((item) => item.type === "MATCH_RESULT")).toBe(true);
    expect(simulated.data.competition.table.some((row) => row.played === 1)).toBe(true);
    expect(simulated.data.squad.some((player) => player.appearances > 0)).toBe(true);
    expect(simulated.data.squad.some((player) => player.fitness < 84)).toBe(true);

    const reloaded = service.loadSave(created.data.save.id);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.data.fixtures.some((fixture) => fixture.status === "played")).toBe(true);
    expect(reloaded.data.home.previousResult?.events.length).toBeGreaterThan(0);
    expect(reloaded.data.home.inbox.some((item) => item.title.startsWith("Match result"))).toBe(
      true,
    );
  });

  it("continues to the next manager fixture without creating duplicate worlds", () => {
    const service = new DesktopApplicationService(tempSaveDir());
    const created = service.createCareer(command("Continue Save", 33));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const continued = service.continueToNextFixture(created.data.save.id);
    expect(continued.ok).toBe(true);
    if (!continued.ok) return;
    expect(continued.data.save.worldDate).toBe(created.data.home.nextFixture?.date);
    const loaded = service.loadSave(created.data.save.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.data.saveListItem.saveId).toBe(created.data.save.id);
    const listed = service.listSaves();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data).toHaveLength(1);
  });

  it("validates age and returns structured errors for corrupted saves", () => {
    const dir = tempSaveDir();
    const service = new DesktopApplicationService(dir);
    const invalid = service.createCareer(command("Bad Age", 22));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe("DATABASE_UNAVAILABLE");
      expect(invalid.error.detail).toContain("inconsistent");
    }

    writeFileSync(join(dir, "broken.sqlite"), "not a sqlite database");
    const listed = service.listSaves();
    expect(listed.ok).toBe(true);
    const missing = service.loadSave("missing" as EntityId);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("SAVE_MISSING");
  });

  it("migrates an older Stage 4-compatible schema when opening a save", () => {
    const dir = tempSaveDir();
    const path = join(dir, "old.sqlite");
    const db = openGameDatabase(path);
    db.exec(
      "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
    );
    db.close();

    const migrated = openGameDatabase(path);
    expect(migrateDatabase(migrated)).toBe(CURRENT_DATABASE_VERSION);
    migrated.close();
  });
});

const command = (saveName: string, startingAge: number) => ({
  saveName,
  character: {
    fullName: "Maya Adhikari",
    preferredDisplayName: "Maya",
    dateOfBirth: "1993-05-12",
    startingAge,
    languages: ["ne", "en"],
    footballBackground: "COMMUNITY_COACHING" as const,
    education: "SPORTS_RELATED_DEGREE" as const,
    playingExperience: "AMATEUR_PLAYER" as const,
    coachingExperience: "YOUTH_COACH" as const,
    businessBackground: "SMALL_BUSINESS" as const,
    startingReputationProfile: "LOCAL_RESPECTED" as const,
    careerStartDate: "2026-08-01",
  },
});
