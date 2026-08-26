import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { HIGHEST_KNOWN_SCHEMA_VERSION, maxAppliedSchemaVersion, pendingMigrationCount } from "@nepal-football-sim/database";
import type { GameDatabase } from "@nepal-football-sim/database";
import type { EntityId, SaveMetadata } from "@nepal-football-sim/shared-types";

const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000);

export const DEFAULT_AUTOSAVE_INTERVAL_DAYS = 7;
export const AUTOSAVE_SLOT_COUNT = 3;

export class SaveIncompatibleError extends Error {
  constructor(
    readonly code: "SCHEMA_TOO_NEW" | "SAVE_CORRUPT",
    message: string,
  ) {
    super(message);
  }
}

/** Refuses a save written by a newer build rather than silently mangling it with an incomplete migration set. */
export const assertSchemaCompatible = (db: GameDatabase): void => {
  let applied: number;
  try {
    applied = maxAppliedSchemaVersion(db);
  } catch {
    throw new SaveIncompatibleError("SAVE_CORRUPT", "This file does not look like a valid career save.");
  }
  if (applied > HIGHEST_KNOWN_SCHEMA_VERSION) {
    throw new SaveIncompatibleError(
      "SCHEMA_TOO_NEW",
      `This save was created by a newer version of the game (schema ${applied}); this build only understands up to schema ${HIGHEST_KNOWN_SCHEMA_VERSION}.`,
    );
  }
};

/** SQLite's own structural check — cheap, reused rather than inventing a parallel corruption detector. */
export const checkSaveIntegrity = (db: GameDatabase): { ok: boolean; detail?: string } => {
  try {
    const rows = db.prepare("PRAGMA quick_check;").all() as Array<Record<string, unknown>>;
    const result = rows.map((row) => String(Object.values(row)[0])).join("; ");
    return result === "ok" ? { ok: true } : { ok: false, detail: result };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
};

const escapeSqlLiteral = (value: string): string => value.replace(/'/g, "''");

/**
 * Copies the live database into a brand-new file via SQLite's own VACUUM
 * INTO — the destination is either written completely or not at all, so a
 * crash or error partway through never leaves a half-written file, and the
 * source is never touched.
 */
export const atomicCopyDatabase = (db: GameDatabase, destPath: string): void => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${destPath}${suffix}`, { force: true });
  db.exec(`VACUUM INTO '${escapeSqlLiteral(destPath)}';`);
};

/**
 * Backs up a save file before migrating it, only when migrations are
 * actually pending — a fresh, already-current save has nothing to protect.
 * Returns the backup path, or undefined when no backup was needed.
 */
export const backupBeforeMigrationIfNeeded = (db: GameDatabase, filePath: string): string | undefined => {
  if (pendingMigrationCount(db) === 0) return undefined;
  const fromVersion = maxAppliedSchemaVersion(db);
  const backupPath = `${filePath}.pre-migration-v${fromVersion}.bak`;
  atomicCopyDatabase(db, backupPath);
  return backupPath;
};

export type AutosaveSlotInfo = {
  slotIndex: number;
  filePath: string;
  savedAt: string;
};

export const autosaveDirectory = (savesDirectory: string, saveId: EntityId): string =>
  join(savesDirectory, "autosaves", String(saveId));

/** Lists the rotating autosave slots for one save, oldest slot index first. */
export const listAutosaveSlots = (savesDirectory: string, saveId: EntityId): AutosaveSlotInfo[] => {
  const dir = autosaveDirectory(savesDirectory, saveId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sqlite"))
    .map((file) => {
      const filePath = join(dir, file);
      const slotIndex = Number(/slot-(\d+)\.sqlite$/.exec(file)?.[1] ?? -1);
      return { slotIndex, filePath, savedAt: statSync(filePath).mtime.toISOString() };
    })
    .filter((slot) => slot.slotIndex >= 0)
    .sort((a, b) => a.slotIndex - b.slotIndex);
};

const nextAutosaveSlotIndex = (slots: AutosaveSlotInfo[], slotCount: number): number => {
  if (slots.length < slotCount) return slots.length;
  return slots.reduce((oldest, slot) => (slot.savedAt < oldest.savedAt ? slot : oldest)).slotIndex;
};

/** Writes the next rotating autosave slot atomically, overwriting the oldest slot once the ring is full. */
export const performAutosave = (
  db: GameDatabase,
  savesDirectory: string,
  saveId: EntityId,
  slotCount: number = AUTOSAVE_SLOT_COUNT,
): AutosaveSlotInfo => {
  const dir = autosaveDirectory(savesDirectory, saveId);
  mkdirSync(dir, { recursive: true });
  const slots = listAutosaveSlots(savesDirectory, saveId);
  const slotIndex = nextAutosaveSlotIndex(slots, slotCount);
  const filePath = join(dir, `slot-${slotIndex}.sqlite`);
  atomicCopyDatabase(db, filePath);
  return { slotIndex, filePath, savedAt: new Date().toISOString() };
};

/**
 * Whether an autosave is due: after a configurable number of in-game days,
 * or at a major season transition where the architecture already exposes
 * one (ContinueStopReason "SEASON_COMPLETE") — never on every single tick.
 */
export const isAutosaveDue = (input: {
  lastAutosaveWorldDate?: string;
  createdAt: string;
  currentWorldDate: string;
  stopReason?: string;
  intervalDays?: number;
}): boolean => {
  if (input.stopReason === "SEASON_COMPLETE") return true;
  const baseline = input.lastAutosaveWorldDate ?? input.createdAt.slice(0, 10);
  return daysBetween(baseline, input.currentWorldDate) >= (input.intervalDays ?? DEFAULT_AUTOSAVE_INTERVAL_DAYS);
};

export const withAutosaveStamp = (save: SaveMetadata, worldDate: string): SaveMetadata => ({
  ...save,
  lastAutosaveWorldDate: worldDate,
  lastAutosaveAt: new Date().toISOString(),
});
