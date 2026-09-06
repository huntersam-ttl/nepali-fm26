import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, deriveStoryThreadsFromEvents, buildStoryDetail } from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId, type HistoricalEvent } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "story-threads-"));
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

const event = (
  id: string,
  eventType: string,
  occurredOn: string,
  involvedEntities: HistoricalEvent["involvedEntities"],
  extra?: Partial<HistoricalEvent>,
): HistoricalEvent => ({
  id: createStableEntityId("history", id) as EntityId,
  occurredOn,
  eventType,
  involvedEntities,
  title: `Event ${id}`,
  importance: "medium",
  scope: "club",
  ...extra,
});

describe("story thread derivation", () => {
  it("groups events into threads by category + primary entity, deterministically regardless of input order", () => {
    const db = openGameDatabase(makeSave("threads-order"));
    const club = db.prepare("SELECT id FROM clubs LIMIT 1").get() as { id: EntityId };
    const player = db.prepare("SELECT id FROM persons LIMIT 1").get() as { id: EntityId };

    const transferA = event("transfer-a", "TRANSFER_OFFER_SUBMITTED", "2026-08-01", [{ id: player.id, type: "person" }]);
    const transferB = event("transfer-b", "TRANSFER_COMPLETED", "2026-08-10", [{ id: player.id, type: "person" }]);
    const ownershipA = event("ownership-a", "OWNERSHIP_INVESTOR_INTEREST", "2026-08-02", [{ id: club.id, type: "club" }]);
    const ownershipB = event("ownership-b", "OWNERSHIP_DEAL_COMPLETED", "2026-08-15", [{ id: club.id, type: "club" }]);
    const unclassified = event("misc", "YOUTH_PLAYER_GENERATED", "2026-08-05", [{ id: player.id, type: "person" }]);

    const forward = deriveStoryThreadsFromEvents(db, [transferA, transferB, ownershipA, ownershipB, unclassified], "MANAGER");
    const shuffled = deriveStoryThreadsFromEvents(db, [unclassified, ownershipB, transferB, ownershipA, transferA], "MANAGER");

    expect(forward).toHaveLength(2);
    expect(forward.map((thread) => thread.id)).toEqual(shuffled.map((thread) => thread.id));
    const transferThread = forward.find((thread) => thread.category === "TRANSFER")!;
    expect(transferThread.events.map((entry) => entry.id)).toEqual([transferA.id, transferB.id]);
    expect(transferThread.resolved).toBe(true);
    expect(transferThread.latestEvent.id).toBe(transferB.id);

    const ownershipThread = forward.find((thread) => thread.category === "OWNERSHIP")!;
    expect(ownershipThread.resolved).toBe(true);
    expect(ownershipThread.primaryEntity.entityType).toBe("CLUB");

    // Threads are sorted newest-latest-event first.
    expect(forward[0]!.id).toBe(ownershipThread.id);
    db.close();
  });

  it("leaves a thread unresolved while its latest event is still an open/pending state", () => {
    const db = openGameDatabase(makeSave("threads-unresolved"));
    const player = db.prepare("SELECT id FROM persons LIMIT 1").get() as { id: EntityId };
    const submitted = event("loan-a", "LOAN_OFFER_SUBMITTED", "2026-08-01", [{ id: player.id, type: "person" }]);
    const countered = event("loan-b", "LOAN_OFFER_COUNTERED", "2026-08-03", [{ id: player.id, type: "person" }]);
    const threads = deriveStoryThreadsFromEvents(db, [submitted, countered], "MANAGER");
    expect(threads).toHaveLength(1);
    expect(threads[0]!.category).toBe("LOAN");
    expect(threads[0]!.resolved).toBe(false);
    expect(threads[0]!.currentState).toBe("Loan offer countered");
    db.close();
  });

  it("never groups two different players' transfers into the same thread", () => {
    const db = openGameDatabase(makeSave("threads-distinct"));
    const players = db.prepare("SELECT id FROM persons LIMIT 2").all() as { id: EntityId }[];
    const first = event("t1", "TRANSFER_REQUESTED", "2026-08-01", [{ id: players[0]!.id, type: "person" }]);
    const second = event("t2", "TRANSFER_REQUESTED", "2026-08-01", [{ id: players[1]!.id, type: "person" }]);
    const threads = deriveStoryThreadsFromEvents(db, [first, second], "MANAGER");
    expect(threads).toHaveLength(2);
    expect(new Set(threads.map((thread) => thread.id)).size).toBe(2);
    db.close();
  });
});

describe("story detail", () => {
  it("surfaces real financial impact and prior thread events, never fabricating either", () => {
    const db = openGameDatabase(makeSave("detail-basic"));
    const player = db.prepare("SELECT id FROM persons LIMIT 1").get() as { id: EntityId };
    const first = event("d1", "TRANSFER_OFFER_SUBMITTED", "2026-08-01", [{ id: player.id, type: "person" }]);
    const second = event("d2", "TRANSFER_COMPLETED", "2026-08-10", [{ id: player.id, type: "person" }], {
      data: { transferFee: 500_000, currency: "NPR" },
    });
    const threads = deriveStoryThreadsFromEvents(db, [first, second], "MANAGER");
    const thread = threads[0]!;
    const detail = buildStoryDetail(db, second, "MANAGER", thread);
    expect(detail.header.headline).toBe(second.title);
    expect(detail.contextRail.financialImpact).toEqual({ amount: 500_000, currency: "NPR" });
    expect(detail.contextRail.priorEvents).toEqual([{ date: first.occurredOn, headline: first.title }]);
    expect(detail.body.immediateConsequence).toMatch(/settled/i);
    db.close();
  });

  it("omits financial impact entirely when no canonical numeric field exists on the event", () => {
    const db = openGameDatabase(makeSave("detail-no-money"));
    const club = db.prepare("SELECT id FROM clubs LIMIT 1").get() as { id: EntityId };
    const solo = event("d3", "FACILITY_PROJECT_COMPLETED", "2026-08-01", [{ id: club.id, type: "club" }]);
    const detail = buildStoryDetail(db, solo, "MANAGER");
    expect(detail.contextRail.financialImpact).toBeUndefined();
    expect(detail.contextRail.priorEvents).toEqual([]);
    db.close();
  });
});
