import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventRepository, EventRoutingRepository, MediaRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  createNepalSave,
  initializeClubEconomyForSave,
  publishMediaForDate,
  roleStoryThreads,
  runChairmanDemo,
} from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId, type HistoricalEvent } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "story-exact-once-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: name,
    gameVersion: "test",
    randomSeed: name,
  });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("story pipeline exact-once under re-publish", () => {
  it("re-running publishMediaForDate for the same date never duplicates a transfer or facility delivery, media story, or thread", () => {
    const db = openGameDatabase(makeSave("exact-once-replay"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    const player = db.prepare("SELECT id FROM persons LIMIT 1").get() as { id: EntityId };
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "exact-once" });
    const demo = runChairmanDemo({ db, seed: "exact-once", worldDate: "2026-08-01", clubId: club.id });
    db.prepare(
      "UPDATE club_ownership_stakes SET holder_id=?, percentage=100, voting_percentage=100, status='ACTIVE' WHERE club_id=? AND holder_type='PERSON'",
    ).run(demo.chairmanPersonId, club.id);

    const transferEvent: HistoricalEvent = {
      id: createStableEntityId("history", "exact-once-transfer"),
      occurredOn: "2026-09-01",
      eventType: "TRANSFER_COMPLETED",
      involvedEntities: [
        { id: player.id, type: "person" },
        { id: club.id, type: "club" },
      ],
      title: "A transfer completes exactly once.",
      importance: "high",
      scope: "club",
      data: { transferFee: 250_000, currency: "NPR" },
    };
    const facilityEvent: HistoricalEvent = {
      id: createStableEntityId("history", "exact-once-facility"),
      occurredOn: "2026-09-01",
      eventType: "FACILITY_PROJECT_COMPLETED",
      involvedEntities: [{ id: club.id, type: "club" }],
      title: "A facility project completes exactly once.",
      importance: "high",
      scope: "club",
    };
    const events = new EventRepository(db);
    events.insertHistoricalEvent(transferEvent);
    events.insertHistoricalEvent(facilityEvent);

    publishMediaForDate(db, { date: "2026-09-01" });
    publishMediaForDate(db, { date: "2026-09-01" });
    publishMediaForDate(db, { date: "2026-09-01" });

    const deliveries = new EventRoutingRepository(db).deliveries(demo.chairmanPersonId, "OWNER");
    const transferDeliveries = deliveries.filter((delivery) => delivery.eventId === transferEvent.id);
    const facilityDeliveries = deliveries.filter((delivery) => delivery.eventId === facilityEvent.id);
    expect(transferDeliveries).toHaveLength(1);
    expect(facilityDeliveries).toHaveLength(1);

    const stories = new MediaRepository(db).stories();
    expect(stories.filter((story) => story.sourceEntityId === transferEvent.id)).toHaveLength(1);
    expect(stories.filter((story) => story.sourceEntityId === facilityEvent.id)).toHaveLength(1);

    // Re-derive the threads three times over — since threads are computed
    // fresh from the event stream on every read, re-publishing must never
    // grow a thread's event list, and a thread's own events must never
    // contain the same real event id twice.
    for (let i = 0; i < 3; i += 1) {
      const threads = roleStoryThreads(db, { personId: demo.chairmanPersonId, role: "OWNER" });
      const transferThread = threads.find((thread) => thread.category === "TRANSFER");
      const facilityThread = threads.find((thread) => thread.category === "FACILITY");
      expect(transferThread?.events.map((event) => event.id)).toEqual([transferEvent.id]);
      // The fixture's own setup already seeds two real infrastructure events
      // for this club (started, delayed) — a real facility saga our new
      // event legitimately joins as a third chapter, not a duplicate.
      const facilityEventIds = facilityThread?.events.map((event) => event.id) ?? [];
      expect(new Set(facilityEventIds).size).toBe(facilityEventIds.length);
      expect(facilityEventIds).toContain(facilityEvent.id);
      expect(facilityEventIds.filter((id) => id === facilityEvent.id)).toHaveLength(1);
    }
    db.close();
  });
});
