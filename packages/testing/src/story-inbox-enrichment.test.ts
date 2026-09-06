import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, initializeClubEconomyForSave, publishMediaForDate, roleInboxItems, runChairmanDemo, storyImportanceBand } from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId, type HistoricalEvent } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "story-inbox-enrichment-"));
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

describe("story importance band", () => {
  it("maps every real HistoricalEvent importance to a distinct band, never inventing a fifth value", () => {
    expect(storyImportanceBand("historic")).toBe("BREAKING");
    expect(storyImportanceBand("high")).toBe("MAJOR");
    expect(storyImportanceBand("medium")).toBe("IMPORTANT");
    expect(storyImportanceBand("low")).toBe("ROUTINE");
  });
});

describe("role inbox story enrichment", () => {
  it("resolves involved club entities into real clickable EntityReferences and attaches an importance band", () => {
    const db = openGameDatabase(makeSave("inbox-enrich"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "inbox-enrich" });
    const demo = runChairmanDemo({ db, seed: "inbox-enrich", worldDate: "2026-08-01", clubId: club.id });
    db.prepare(
      "UPDATE club_ownership_stakes SET holder_id=?, percentage=100, voting_percentage=100, status='ACTIVE' WHERE club_id=? AND holder_type='PERSON'",
    ).run(demo.chairmanPersonId, club.id);
    const event: HistoricalEvent = {
      id: createStableEntityId("history", "inbox-enrich-event"),
      occurredOn: "2026-09-01",
      eventType: "FACILITY_PROJECT_COMPLETED",
      involvedEntities: [{ id: club.id, type: "club" }],
      title: "The training-ground upgrade has opened.",
      importance: "high",
      scope: "club",
    };
    new EventRepository(db).insertHistoricalEvent(event);
    publishMediaForDate(db, { date: "2026-09-01" });
    const items = roleInboxItems(db, { personId: demo.chairmanPersonId, role: "OWNER" });
    const item = items.find((entry) => entry.title === event.title);
    expect(item).toBeDefined();
    expect(item!.importanceBand).toBe("MAJOR");
    expect(item!.entityReferences).toBeDefined();
    const clubRef = item!.entityReferences!.find((ref) => ref.entityType === "CLUB");
    expect(clubRef?.id).toBe(club.id);
    expect(clubRef?.visible).toBe(true);
    db.close();
  });
});
