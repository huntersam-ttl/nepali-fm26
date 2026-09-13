import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HIGHEST_KNOWN_SCHEMA_VERSION,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  AUTOSAVE_SLOT_COUNT,
  DesktopApplicationService,
  atomicCopyDatabase,
  assertSchemaCompatible,
  checkSaveIntegrity,
  isAutosaveDue,
  listAutosaveSlots,
  performAutosave,
  SaveIncompatibleError,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const service = (options: Partial<{ autosaveIntervalDays: number; autosaveEnabled: boolean }> = {}) => {
  const savesDirectory = tempDir("save-management-a-");
  return new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET, ...options });
};

const command = (saveName: string, joinTeamId: EntityId) => ({
  saveName,
  joinTeamId,
  character: {
    fullName: "Save Tester",
    preferredDisplayName: "Tester",
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
});

const startCareer = (runtime: DesktopApplicationService, saveName: string) => {
  const clubs = runtime.listStartingClubs();
  if (!clubs.ok) throw new Error("Failed to list starting clubs.");
  const created = runtime.createCareer(command(saveName, clubs.data[0]!.teamId));
  if (!created.ok) throw new Error(`Failed to create career: ${created.error.message}`);
  return created;
};

/**
 * Continue is idempotent on matchday — the manager must play the due match
 * before the calendar moves — so play it first when one is due, exactly as a
 * player would, then continue.
 */
const advanceCareer = (runtime: DesktopApplicationService) => {
  const played = runtime.quickSimMatch();
  if (!played.ok && played.error.code !== "MATCHDAY_REQUIRED") {
    throw new Error(`Failed to play the due match: ${played.error.message}`);
  }
  return runtime.continueCareer();
};

describe("save management phase A — pure decision helpers", () => {
  it("is due after enough in-game days have passed, and not before", () => {
    expect(
      isAutosaveDue({ lastAutosaveWorldDate: "2026-08-01", createdAt: "2026-08-01T00:00:00Z", currentWorldDate: "2026-08-05", intervalDays: 7 }),
    ).toBe(false);
    expect(
      isAutosaveDue({ lastAutosaveWorldDate: "2026-08-01", createdAt: "2026-08-01T00:00:00Z", currentWorldDate: "2026-08-08", intervalDays: 7 }),
    ).toBe(true);
  });

  it("is always due at a major season transition regardless of elapsed days", () => {
    expect(
      isAutosaveDue({
        lastAutosaveWorldDate: "2026-08-01",
        createdAt: "2026-08-01T00:00:00Z",
        currentWorldDate: "2026-08-02",
        stopReason: "SEASON_COMPLETE",
        intervalDays: 30,
      }),
    ).toBe(true);
  });

  it("falls back to the save's creation date as a baseline when never autosaved before", () => {
    expect(
      isAutosaveDue({ createdAt: "2026-08-01T00:00:00Z", currentWorldDate: "2026-08-03", intervalDays: 7 }),
    ).toBe(false);
    expect(
      isAutosaveDue({ createdAt: "2026-08-01T00:00:00Z", currentWorldDate: "2026-08-10", intervalDays: 7 }),
    ).toBe(true);
  });
});

describe("save management phase A — integrity and schema compatibility", () => {
  it("passes integrity check on a healthy migrated database", () => {
    const dir = tempDir("integrity-ok-");
    const db = openGameDatabase(join(dir, "career.sqlite"));
    migrateDatabase(db);
    expect(checkSaveIntegrity(db)).toEqual({ ok: true });
    db.close();
  });

  it("refuses to load a save whose schema is newer than this build understands", () => {
    const dir = tempDir("schema-future-");
    const db = openGameDatabase(join(dir, "career.sqlite"));
    migrateDatabase(db);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
      HIGHEST_KNOWN_SCHEMA_VERSION + 1000,
      new Date().toISOString(),
    );
    expect(() => assertSchemaCompatible(db)).toThrow(SaveIncompatibleError);
    try {
      assertSchemaCompatible(db);
    } catch (error) {
      expect(error).toBeInstanceOf(SaveIncompatibleError);
      expect((error as InstanceType<typeof SaveIncompatibleError>).code).toBe("SCHEMA_TOO_NEW");
    }
    db.close();
  });

  it("accepts a save at or below the highest known schema version", () => {
    const dir = tempDir("schema-ok-");
    const db = openGameDatabase(join(dir, "career.sqlite"));
    migrateDatabase(db);
    expect(() => assertSchemaCompatible(db)).not.toThrow();
    db.close();
  });

  it("reports a file with no recognizable schema as corrupt rather than crashing", () => {
    const dir = tempDir("schema-garbage-");
    const path = join(dir, "career.sqlite");
    const db = openGameDatabase(path);
    db.exec("CREATE TABLE unrelated (id TEXT);"); // never migrated — no schema_migrations table
    expect(() => assertSchemaCompatible(db)).toThrow(SaveIncompatibleError);
    db.close();
  });
});

describe("save management phase A — atomic copy and rotating autosave slots", () => {
  it("copies a live database atomically via VACUUM INTO", () => {
    const dir = tempDir("copy-");
    const db = openGameDatabase(join(dir, "career.sqlite"));
    migrateDatabase(db);
    const destPath = join(dir, "copy.sqlite");
    atomicCopyDatabase(db, destPath);
    expect(existsSync(destPath)).toBe(true);
    const copy = openGameDatabase(destPath);
    expect(checkSaveIntegrity(copy).ok).toBe(true);
    copy.close();
    db.close();
  });

  it("never leaves a half-written destination when the copy target is invalid", () => {
    const dir = tempDir("copy-fail-");
    const db = openGameDatabase(join(dir, "career.sqlite"));
    migrateDatabase(db);
    const badDestPath = join(dir, "no-such-directory", "copy.sqlite");
    expect(() => atomicCopyDatabase(db, badDestPath)).toThrow();
    expect(existsSync(badDestPath)).toBe(false);
    // The source is completely unaffected by a failed copy attempt.
    expect(checkSaveIntegrity(db).ok).toBe(true);
    db.close();
  });

  it("fills empty rotating slots first, then overwrites the oldest once full", () => {
    const savesDirectory = tempDir("rotation-");
    const db = openGameDatabase(join(savesDirectory, "career.sqlite"));
    migrateDatabase(db);
    const saveId = "rotation-save-id" as EntityId;

    const first = performAutosave(db, savesDirectory, saveId, 3);
    const second = performAutosave(db, savesDirectory, saveId, 3);
    const third = performAutosave(db, savesDirectory, saveId, 3);
    expect([first.slotIndex, second.slotIndex, third.slotIndex]).toEqual([0, 1, 2]);
    expect(listAutosaveSlots(savesDirectory, saveId)).toHaveLength(3);

    // A fourth autosave rotates back to slot 0 rather than growing unbounded.
    const fourth = performAutosave(db, savesDirectory, saveId, 3);
    expect(fourth.slotIndex).toBe(0);
    expect(listAutosaveSlots(savesDirectory, saveId)).toHaveLength(3);
    db.close();
  });
});

describe("save management phase A — desktop service integration", () => {
  it("save-as creates an independent new slot without touching or losing the original", () => {
    const runtime = service();
    const created = startCareer(runtime, "Original Slot");
    const originalPath = created.data.catalogEntry.filePath;

    const asResult = runtime.saveCareerAs("Branch Slot");
    expect(asResult.ok).toBe(true);
    if (!asResult.ok) return;
    expect(asResult.data.saveId).not.toBe(created.data.save.id);
    expect(asResult.data.filePath).not.toBe(originalPath);
    expect(existsSync(originalPath)).toBe(true);

    // Both slots are independently loadable afterward.
    const loadOriginal = runtime.loadCareer(created.data.save.id);
    expect(loadOriginal.ok).toBe(true);
    const loadBranch = runtime.loadCareer(asResult.data.saveId);
    expect(loadBranch.ok).toBe(true);
  });

  it("triggers an autosave after the configured number of in-game days and exposes it in the read model", () => {
    const runtime = service({ autosaveIntervalDays: 1 });
    const created = startCareer(runtime, "Autosave Trigger");

    let advanced = advanceCareer(runtime);
    expect(advanced.ok).toBe(true);
    // Keep advancing until at least one autosave has happened, bounded to avoid an infinite loop.
    for (let i = 0; i < 30 && advanced.ok; i += 1) {
      const status = runtime.getAutosaveStatus();
      if (status.ok && status.data.slots.length > 0) break;
      advanced = advanceCareer(runtime);
    }
    const status = runtime.getAutosaveStatus();
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.data.slots.length).toBeGreaterThan(0);
    expect(status.data.lastAutosaveWorldDate).toBeDefined();
    expect(status.data.slots.length).toBeLessThanOrEqual(AUTOSAVE_SLOT_COUNT);
    void created;
  });

  it("does not autosave when disabled", () => {
    const runtime = service({ autosaveIntervalDays: 1, autosaveEnabled: false });
    startCareer(runtime, "Autosave Disabled");
    for (let i = 0; i < 10; i += 1) advanceCareer(runtime);
    const status = runtime.getAutosaveStatus();
    expect(status.ok).toBe(true);
    if (status.ok) expect(status.data.slots).toHaveLength(0);
  });

  it("restores an autosave slot as the active session without deleting the slot itself", () => {
    const runtime = service({ autosaveIntervalDays: 1 });
    startCareer(runtime, "Restore Test");
    let advanced = advanceCareer(runtime);
    for (let i = 0; i < 30; i += 1) {
      const status = runtime.getAutosaveStatus();
      if (status.ok && status.data.slots.length > 0) break;
      advanced = advanceCareer(runtime);
    }
    void advanced;
    const status = runtime.getAutosaveStatus();
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    const slotIndex = status.data.slots[0]!.slotIndex;

    const restored = runtime.loadAutosaveSlot(slotIndex);
    expect(restored.ok).toBe(true);

    // The slot itself is still present after restoring from it.
    const statusAfter = runtime.getAutosaveStatus();
    expect(statusAfter.ok).toBe(true);
    if (statusAfter.ok) expect(statusAfter.data.slots.some((slot) => slot.slotIndex === slotIndex)).toBe(true);
  });

  it("rejects loading a save with a schema newer than this build understands, with an explicit reason", () => {
    const runtime = service();
    const created = startCareer(runtime, "Future Schema");
    const filePath = created.data.catalogEntry.filePath;
    const closed = runtime.closeCareer();
    expect(closed.ok).toBe(true);

    const raw = openGameDatabase(filePath);
    raw.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
      HIGHEST_KNOWN_SCHEMA_VERSION + 1000,
      new Date().toISOString(),
    );
    raw.close();

    const reloaded = runtime.loadCareerByPath(filePath);
    expect(reloaded.ok).toBe(false);
    if (!reloaded.ok) expect(reloaded.error.code).toBe("SCHEMA_TOO_NEW");
  });
});

describe("save management phase A — deterministic long save/load regression", () => {
  it("preserves full career state, including RNG-driven progress, across many ticks then a save/close/reload cycle", () => {
    const runtime = service();
    const created = startCareer(runtime, "Long Regression");
    const saveId = created.data.save.id;

    let last = created.data;
    for (let i = 0; i < 15; i += 1) {
      const advanced = runtime.continueCareer();
      expect(advanced.ok).toBe(true);
      if (advanced.ok) last = advanced.data;
    }

    const beforeSnapshot = {
      worldDate: last.save.worldDate,
      squad: last.squad.map((player) => ({ id: player.personId, overall: player.overall, fitness: player.fitness })),
      clubName: last.header.clubName,
    };

    const saved = runtime.saveCareer();
    expect(saved.ok).toBe(true);
    expect(runtime.closeCareer()).toEqual({ ok: true, data: { closed: true } });

    const reopened = runtime.loadCareer(saveId);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    const afterSnapshot = {
      worldDate: reopened.data.save.worldDate,
      squad: reopened.data.squad.map((player) => ({ id: player.personId, overall: player.overall, fitness: player.fitness })),
      clubName: reopened.data.header.clubName,
    };
    expect(afterSnapshot).toEqual(beforeSnapshot);
  });
});
