import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventRepository, MediaPhaseBRepository, openGameDatabase } from "@nepal-football-sim/database";
import { answerMediaInterviewAsAi, createMediaInterview, createNepalSave, initializeMediaForSave, publishMediaForDate } from "@nepal-football-sim/simulation";
import { createStableEntityId, type HistoricalEvent } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => { const dir = mkdtempSync(join(tmpdir(), "media-phase-b-")); dirs.push(dir); const path = join(dir, "career.sqlite"); createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name }); return path; };
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("Media phase B", () => {
  it("creates deterministic event-backed interviews and journalist memory", () => {
    const db = openGameDatabase(makeSave("media-phase-b")); const event: HistoricalEvent = { id: createStableEntityId("history", "media-interview-event"), occurredOn: "2026-09-01", eventType: "MATCH_RESULT", involvedEntities: [], title: "Cup final won", importance: "high", scope: "club" }; new EventRepository(db).insertHistoricalEvent(event); initializeMediaForSave(db); const story = publishMediaForDate(db, { date: "2026-09-02" })[0]; const interview = createMediaInterview(db, { storyId: story.id, date: "2026-09-02", context: "POST_MATCH" }); const completed = answerMediaInterviewAsAi(db, { interviewId: interview.id, seed: "media-phase-b" }); expect(completed.status).toBe("COMPLETED"); expect(completed.responses).toHaveLength(1); expect(new MediaPhaseBRepository(db).interviews()[0].summary).toContain("manager responded"); expect(new MediaPhaseBRepository(db).relationships()[0].lastInteraction).toBe("2026-09-02"); db.close();
  });
});
