import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventRepository, MediaRepository, ManagerRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, initializeMediaForSave, publishMediaForDate } from "@nepal-football-sim/simulation";
import { createStableEntityId, type HistoricalEvent } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => { const dir = mkdtempSync(join(tmpdir(), "media-phase-a-")); dirs.push(dir); const path = join(dir, "career.sqlite"); createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name }); return path; };
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("Media phase A", () => {
  it("publishes deterministic high-importance save-state events and inbox stories", () => {
    const first = openGameDatabase(makeSave("media-deterministic")); const second = openGameDatabase(makeSave("media-deterministic"));
    const event: HistoricalEvent = { id: createStableEntityId("history", "media-event"), occurredOn: "2026-09-01", eventType: "COMPETITION_FINAL", involvedEntities: [], title: "Domestic final completed", importance: "high", scope: "club" };
    new EventRepository(first).insertHistoricalEvent(event); new EventRepository(second).insertHistoricalEvent(event); initializeMediaForSave(first); initializeMediaForSave(second);
    const a = publishMediaForDate(first, { date: "2026-09-02" }); const b = publishMediaForDate(second, { date: "2026-09-02" }); expect(a).toEqual(b); expect(new MediaRepository(first).stories()).toHaveLength(1); expect(new ManagerRepository(first).inboxItems().some((item) => item.id === createStableEntityId("media-inbox", a[0].id))).toBe(true); expect(publishMediaForDate(first, { date: "2026-09-02" })).toEqual([]); first.close(); second.close();
  });
});
