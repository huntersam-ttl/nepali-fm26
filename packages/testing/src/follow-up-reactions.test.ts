import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, EventRepository, MediaRepository, openGameDatabase } from "@nepal-football-sim/database";
import { acceptSponsorOffer, createNepalSave, generateSponsorOffers, initializeClubEconomyForSave, publishMediaForDate } from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId, type HistoricalEvent } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "follow-up-reactions-"));
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

const insertEvent = (db: ReturnType<typeof openGameDatabase>, event: HistoricalEvent): void => {
  new EventRepository(db).insertHistoricalEvent(event);
};

describe("canonical follow-up reactions", () => {
  it("creates a real, derived supporter-welcome story after a transfer completes, exactly once across repeated publishing", () => {
    const db = openGameDatabase(makeSave("reaction-transfer"));
    const club = db.prepare("SELECT id, name FROM clubs LIMIT 1").get() as { id: EntityId; name: string };
    const player = db.prepare("SELECT id, full_name FROM persons LIMIT 1").get() as { id: EntityId; full_name: string };
    const transfer: HistoricalEvent = {
      id: createStableEntityId("history", "reaction-test-transfer"),
      occurredOn: "2026-08-01",
      eventType: "TRANSFER_COMPLETED",
      involvedEntities: [
        { id: player.id, type: "person" },
        { id: club.id, type: "club" },
      ],
      title: `${player.full_name} completes move to ${club.name}`,
      importance: "high",
      scope: "club",
    };
    insertEvent(db, transfer);
    publishMediaForDate(db, { date: "2026-08-01" });
    publishMediaForDate(db, { date: "2026-08-01" });
    publishMediaForDate(db, { date: "2026-08-01" });

    const stories = new MediaRepository(db).stories();
    const reactionStories = stories.filter((story) => story.headline.includes("supporters welcome"));
    expect(reactionStories).toHaveLength(1);
    expect(reactionStories[0]!.headline).toContain(`${club.name} supporters welcome the arrival of ${player.full_name}.`);
    db.close();
  });

  it("derives an ownership supporter reaction and a distinct investor-priorities story, both exact-once", () => {
    const db = openGameDatabase(makeSave("reaction-ownership"));
    const club = db.prepare("SELECT id, name FROM clubs LIMIT 1").get() as { id: EntityId; name: string };
    const deal: HistoricalEvent = {
      id: createStableEntityId("history", "reaction-test-ownership"),
      occurredOn: "2026-08-01",
      eventType: "CLUB_OWNERSHIP_TRANSFERRED",
      involvedEntities: [{ id: club.id, type: "club" }],
      title: "Club ownership share sold",
      importance: "high",
      scope: "club",
    };
    insertEvent(db, deal);
    publishMediaForDate(db, { date: "2026-08-01" });
    publishMediaForDate(db, { date: "2026-08-01" });

    const stories = new MediaRepository(db).stories();
    expect(stories.filter((story) => story.headline.includes("react to the change"))).toHaveLength(1);
    expect(stories.filter((story) => story.headline.includes("prioritize"))).toHaveLength(1);
    db.close();
  });

  it("derives a facility-opening reaction and a government-response reaction, both exact-once", () => {
    const db = openGameDatabase(makeSave("reaction-facility-gov"));
    const club = db.prepare("SELECT id, name FROM clubs LIMIT 1").get() as { id: EntityId; name: string };
    const facility: HistoricalEvent = {
      id: createStableEntityId("history", "reaction-test-facility"),
      occurredOn: "2026-08-01",
      eventType: "FACILITY_PROJECT_COMPLETED",
      involvedEntities: [{ id: club.id, type: "club" }],
      title: `${club.name} completes new training facility`,
      importance: "high",
      scope: "club",
    };
    const support: HistoricalEvent = {
      id: createStableEntityId("history", "reaction-test-government"),
      occurredOn: "2026-08-01",
      eventType: "GOVERNMENT_SUPPORT_REQUESTED",
      involvedEntities: [{ id: club.id, type: "club" }],
      title: `${club.name} requests government funding`,
      importance: "high",
      scope: "club",
    };
    insertEvent(db, facility);
    insertEvent(db, support);
    publishMediaForDate(db, { date: "2026-08-01" });
    publishMediaForDate(db, { date: "2026-08-01" });
    publishMediaForDate(db, { date: "2026-08-01" });

    const stories = new MediaRepository(db).stories();
    expect(stories.filter((story) => story.headline.includes("officially opens"))).toHaveLength(1);
    expect(stories.filter((story) => story.headline.includes("notes"))).toHaveLength(1);
    db.close();
  });

  it("never derives a reaction for an event type with no defined follow-up", () => {
    const db = openGameDatabase(makeSave("reaction-none"));
    const club = db.prepare("SELECT id, name FROM clubs LIMIT 1").get() as { id: EntityId; name: string };
    const generic: HistoricalEvent = {
      id: createStableEntityId("history", "reaction-test-none"),
      occurredOn: "2026-08-01",
      eventType: "YOUTH_INTAKE_HELD",
      involvedEntities: [{ id: club.id, type: "club" }],
      title: `${club.name} completes its annual youth intake`,
      importance: "high",
      scope: "club",
    };
    insertEvent(db, generic);
    publishMediaForDate(db, { date: "2026-08-01" });
    const stories = new MediaRepository(db).stories();
    expect(stories).toHaveLength(1);
    db.close();
  });
});

describe("sponsor-activation noise control", () => {
  it("never floods a fresh career with an activation story per world-seed club sponsorship", () => {
    const db = openGameDatabase(makeSave("sponsor-noise-seed"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "sponsor-noise-seed" });
    publishMediaForDate(db, { date: "2026-08-01" });
    const stories = new MediaRepository(db).stories();
    // The seed genuinely gives every club a baseline sponsorship — confirm
    // that actually happened, so a passing assertion below isn't vacuous.
    expect(new ClubEconomyRepository(db).sponsorships().filter((c) => c.status === "ACTIVE").length).toBeGreaterThan(10);
    expect(stories.filter((story) => story.headline.includes("activates matchday branding"))).toHaveLength(0);
    expect(stories.filter((story) => story.headline === "Club sponsorship accepted")).toHaveLength(0);
    db.close();
  });

  it("still generates exactly one activation story for a genuinely new in-game sponsorship deal", () => {
    const db = openGameDatabase(makeSave("sponsor-noise-real-deal"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "sponsor-noise-real-deal" });
    // Consume the seed's own baseline setup first (silent, produces nothing).
    publishMediaForDate(db, { date: "2026-08-01" });
    const club = db.prepare("SELECT id, name FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId; name: string };
    // End the seed's own baseline deal first so a fresh, real in-game offer
    // for the same exclusivity slot doesn't hit the (correct, pre-existing)
    // exclusivity-conflict guard.
    for (const existing of new ClubEconomyRepository(db).sponsorships(club.id)) {
      if (existing.status === "ACTIVE") new ClubEconomyRepository(db).upsertSponsorship({ ...existing, status: "EXPIRED" });
    }
    const freshOffer = generateSponsorOffers(db, { clubId: club.id, date: "2026-08-05", seed: "sponsor-noise-real-deal", count: 1 })[0]!;
    acceptSponsorOffer(db, freshOffer.id, "2026-08-05");
    publishMediaForDate(db, { date: "2026-08-05" });
    publishMediaForDate(db, { date: "2026-08-05" });
    const stories = new MediaRepository(db).stories();
    const activations = stories.filter((story) => story.headline.includes("agrees new partnership") || story.headline.includes("agrees a new sponsorship deal"));
    expect(activations).toHaveLength(1);
    const reactions = stories.filter((story) => story.headline.includes("activates matchday branding"));
    expect(reactions).toHaveLength(1);
    db.close();
  });
});
