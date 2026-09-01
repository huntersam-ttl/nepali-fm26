import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EventRepository,
  MediaRepository,
  ManagerRepository,
  SupporterCultureRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  createNepalSave,
  initializeMediaForSave,
  initialSupporterCultureProfile,
  initializeSupporterCultureForSave,
  publishMediaForDate,
  roleInboxEvents,
} from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type EntityId,
  type HistoricalEvent,
} from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "media-phase-a-"));
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

describe("Media phase A", () => {
  it("publishes deterministic high-importance save-state events and inbox stories", () => {
    const first = openGameDatabase(makeSave("media-deterministic"));
    const second = openGameDatabase(makeSave("media-deterministic"));
    const event: HistoricalEvent = {
      id: createStableEntityId("history", "media-event"),
      occurredOn: "2026-09-01",
      eventType: "COMPETITION_FINAL",
      involvedEntities: [],
      title: "Domestic final completed",
      importance: "high",
      scope: "club",
    };
    new EventRepository(first).insertHistoricalEvent(event);
    new EventRepository(second).insertHistoricalEvent(event);
    const lowEvent: HistoricalEvent = {
      id: createStableEntityId("history", "media-low-event"),
      occurredOn: "2026-09-01",
      eventType: "ROUTINE_TRAINING",
      involvedEntities: [],
      title: "Routine training completed",
      importance: "low",
      scope: "club",
    };
    new EventRepository(first).insertHistoricalEvent(lowEvent);
    initializeMediaForSave(first);
    initializeMediaForSave(second);
    const a = publishMediaForDate(first, { date: "2026-09-02" });
    const b = publishMediaForDate(second, { date: "2026-09-02" });
    expect(a).toEqual(b);
    expect(new MediaRepository(first).stories()).toHaveLength(1);
    expect(
      new ManagerRepository(first)
        .inboxItems()
        .some((item) => item.id === createStableEntityId("media-inbox", a[0].id)),
    ).toBe(true);
    expect(publishMediaForDate(first, { date: "2026-09-02" })).toEqual([]);
    first.close();
    second.close();
  });

  it("emits one supporter reaction and media story for an important promise outcome", () => {
    const db = openGameDatabase(makeSave("media-promise"));
    const clubId = (
      db.prepare("SELECT id FROM clubs ORDER BY id LIMIT 1").get() as { id: EntityId }
    ).id;
    initializeSupporterCultureForSave({ db, worldDate: "2026-01-01", seed: "media-promise" });
    const supporters = new SupporterCultureRepository(db);
    if (!supporters.profile(clubId, "men"))
      supporters.upsertProfile(
        initialSupporterCultureProfile({
          clubId,
          date: "2026-01-01",
          seed: "media-promise",
          tier: 1,
        }),
      );
    const event: HistoricalEvent = {
      id: createStableEntityId("history", "promise-public-event"),
      occurredOn: "2026-09-01",
      eventType: "PROMISE_BROKEN",
      involvedEntities: [{ id: clubId, type: "club" }],
      title: "Manager promise broken",
      data: { promiseId: "promise-1" },
      importance: "high",
      scope: "club",
    };
    new EventRepository(db).insertHistoricalEvent(event);
    const before = new SupporterCultureRepository(db).profile(clubId, "men")!;
    const first = publishMediaForDate(db, { date: "2026-09-02" });
    const after = new SupporterCultureRepository(db).profile(clubId, "men")!;
    expect(first).toHaveLength(1);
    expect(after.currentMood).toBeLessThan(before.currentMood);
    expect(
      new SupporterCultureRepository(db)
        .events(clubId)
        .filter((item) => item.subjectIds.includes(clubId)),
    ).toHaveLength(1);
    expect(publishMediaForDate(db, { date: "2026-09-02" })).toEqual([]);
    expect(new SupporterCultureRepository(db).profile(clubId, "men")!.currentMood).toBe(
      after.currentMood,
    );
    db.close();
  });

  it("routes a significant club event to the active manager exactly once", () => {
    const db = openGameDatabase(makeSave("media-routing"));
    const clubId = (
      db.prepare("SELECT id FROM clubs ORDER BY id LIMIT 1").get() as { id: EntityId }
    ).id;
    const teamId = (
      db.prepare("SELECT id FROM teams WHERE club_id=? ORDER BY id LIMIT 1").get(clubId) as {
        id: EntityId;
      }
    ).id;
    const personId = (
      db.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get() as { id: EntityId }
    ).id;
    const managerProfileId = createStableEntityId("manager-profile", "media-routing-manager");
    db.prepare(
      "INSERT INTO manager_profiles (id,person_id,attributes_json,preferred_style,reputation_profile,created_on) VALUES (?,?,?,?,?,?)",
    ).run(managerProfileId, personId, JSON.stringify({}), null, "LOCAL", "2026-01-01");
    db.prepare(
      "INSERT INTO manager_contracts (id,manager_profile_id,person_id,team_id,club_id,job_title,contract_start,contract_end,salary_amount_minor,currency,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      createStableEntityId("manager-contract", "media-routing-manager"),
      managerProfileId,
      personId,
      teamId,
      clubId,
      "Manager",
      "2026-01-01",
      null,
      1,
      "NPR",
      "ACTIVE",
    );
    const manager = db
      .prepare(
        "SELECT person_id AS personId, club_id AS clubId FROM manager_contracts WHERE status='ACTIVE' ORDER BY person_id LIMIT 1",
      )
      .get() as { personId: EntityId; clubId: EntityId } | undefined;
    expect(manager).toBeDefined();
    const event: HistoricalEvent = {
      id: createStableEntityId("history", "manager-routing-event"),
      occurredOn: "2026-09-01",
      eventType: "TRANSFER_COMPLETED",
      involvedEntities: [{ id: manager!.clubId, type: "club" }],
      title: "Important signing completed",
      importance: "high",
      scope: "club",
    };
    new EventRepository(db).insertHistoricalEvent(event);
    publishMediaForDate(db, { date: "2026-09-02" });
    const first = roleInboxEvents(db, manager!.personId, "MANAGER").filter(
      (item) => item.event.id === event.id,
    );
    publishMediaForDate(db, { date: "2026-09-02" });
    const second = roleInboxEvents(db, manager!.personId, "MANAGER").filter(
      (item) => item.event.id === event.id,
    );
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    db.close();
  });

  it("routes ownership to the controlling owner and federation events to the president", () => {
    const db = openGameDatabase(makeSave("media-role-routing"));
    const clubId = (
      db.prepare("SELECT id FROM clubs ORDER BY id LIMIT 1").get() as { id: EntityId }
    ).id;
    const federationId = (
      db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }
    ).id;
    const personId = (
      db.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get() as { id: EntityId }
    ).id;
    db.prepare(
      "INSERT INTO club_ownership_stakes (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      createStableEntityId("ownership-stake", "media-role-owner"),
      clubId,
      "PERSON",
      personId,
      "Routing Owner",
      "MAJORITY_OWNER",
      75,
      75,
      "2026-01-01",
      "ACTIVE",
      "BUYABLE",
      "SIMULATION_ONLY",
    );
    db.prepare(
      "INSERT INTO federation_leadership_tenures (id,person_id,federation_id,role,term_start,status,provenance_status) VALUES (?,?,?,?,?,?,?)",
    ).run(
      createStableEntityId("federation-leadership", "media-role-president"),
      personId,
      federationId,
      "FEDERATION_PRESIDENT",
      "2026-01-01",
      "ACTIVE",
      "SIMULATION_ONLY",
    );
    const ownershipEvent: HistoricalEvent = {
      id: createStableEntityId("history", "owner-routing-event"),
      occurredOn: "2026-09-01",
      eventType: "CLUB_OWNERSHIP_TRANSFERRED",
      involvedEntities: [{ id: clubId, type: "club" }],
      title: "Club ownership transferred",
      importance: "high",
      scope: "club",
    };
    const federationEvent: HistoricalEvent = {
      id: createStableEntityId("history", "president-routing-event"),
      occurredOn: "2026-09-01",
      eventType: "FEDERATION_ELECTION_COMPLETED",
      involvedEntities: [{ id: federationId, type: "federation" }],
      title: "Federation election completed",
      importance: "high",
      scope: "federation",
    };
    const events = new EventRepository(db);
    events.insertHistoricalEvent(ownershipEvent);
    events.insertHistoricalEvent(federationEvent);
    publishMediaForDate(db, { date: "2026-09-02" });
    expect(
      roleInboxEvents(db, personId, "OWNER").some((item) => item.event.id === ownershipEvent.id),
    ).toBe(true);
    expect(
      roleInboxEvents(db, personId, "PRESIDENT").some(
        (item) => item.event.id === federationEvent.id,
      ),
    ).toBe(true);
    expect(
      roleInboxEvents(db, personId, "PRESIDENT").some(
        (item) => item.event.id === ownershipEvent.id,
      ),
    ).toBe(false);
    db.close();
  });
});
