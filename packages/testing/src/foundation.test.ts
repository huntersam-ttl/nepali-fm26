import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateImportRecord } from "@nepal-football-sim/data-import";
import {
  createNewSave,
  EventRepository,
  FinanceRepository,
  loadSave,
  migrateDatabase,
  openGameDatabase,
  SaveRepository,
  WorldRepository,
} from "@nepal-football-sim/database";
import { assertFinanceAccountOwner } from "@nepal-football-sim/rules";
import { SimulationClock, SeededRandom, createTestWorld } from "@nepal-football-sim/simulation";
import { createEntityId, createStableEntityId } from "@nepal-football-sim/shared-types";
import type { Country, FinanceAccount, Person, PersonRole } from "@nepal-football-sim/shared-types";

const tempDirs: string[] = [];

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-test-"));
  tempDirs.push(dir);
  return join(dir, "save.sqlite");
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("stage one foundation", () => {
  it("creates and loads save metadata", () => {
    const db = openGameDatabase(":memory:");
    const save = createNewSave(db, {
      name: "Unit Save",
      worldDate: "2026-01-01",
      gameVersion: "0.1.0",
      randomSeed: "seed",
    });

    expect(loadSave(db, save.id)).toMatchObject({
      name: "Unit Save",
      worldDate: "2026-01-01",
      databaseVersion: 4,
      randomSeed: "seed",
    });
    db.close();
  });

  it("applies database migrations once", () => {
    const db = openGameDatabase(":memory:");
    expect(migrateDatabase(db)).toBe(4);
    expect(migrateDatabase(db)).toBe(4);
    const rows = db.prepare("SELECT version FROM schema_migrations").all();
    expect(rows).toHaveLength(4);
    db.close();
  });

  it("creates stable IDs for imported entities", () => {
    expect(createStableEntityId("club", "nepal-police-club")).toBe(
      createStableEntityId("club", "nepal-police-club"),
    );
    expect(createStableEntityId("club", "a")).not.toBe(createStableEntityId("club", "b"));
  });

  it("keeps one person identity across roles", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const country: Country = {
      id: createStableEntityId("country", "NP"),
      name: "Nepal",
      isoCode: "NP",
    };
    const person: Person = {
      id: createStableEntityId("person", "same-human"),
      fullName: "Same Human",
      nationalityCountryId: country.id,
      languages: ["ne"],
    };
    const player: PersonRole = {
      id: createStableEntityId("role", "same-human-player"),
      personId: person.id,
      role: "PLAYER",
      activeFrom: "2026-01-01",
      activeTo: "2036-01-01",
    };
    const manager: PersonRole = {
      id: createStableEntityId("role", "same-human-manager"),
      personId: person.id,
      role: "MANAGER",
      activeFrom: "2036-01-02",
    };

    world.insertCountry(country);
    world.insertPerson(person);
    world.insertPersonRole(player);
    world.insertPersonRole(manager);

    expect(world.getPersonRoles(person.id).map((role) => role.role)).toEqual(["PLAYER", "MANAGER"]);
    db.close();
  });

  it("separates personal, club and federation money", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    const repo = new FinanceRepository(db);
    const personAccount: FinanceAccount = {
      id: createEntityId(),
      ownerType: "PERSON",
      ownerId: createEntityId(),
      name: "Personal",
      currency: "NPR",
    };
    const clubAccount: FinanceAccount = {
      id: createEntityId(),
      ownerType: "CLUB",
      ownerId: createEntityId(),
      name: "Club",
      currency: "NPR",
    };
    const federationAccount: FinanceAccount = {
      id: createEntityId(),
      ownerType: "FEDERATION",
      ownerId: createEntityId(),
      name: "Federation",
      currency: "NPR",
    };
    repo.insertAccount(personAccount);
    repo.insertAccount(clubAccount);
    repo.insertAccount(federationAccount);

    expect(() => assertFinanceAccountOwner(personAccount, "PERSON")).not.toThrow();
    expect(() => assertFinanceAccountOwner(personAccount, "FEDERATION")).toThrow();
    expect(repo.getAccount(clubAccount.id)?.ownerType).toBe("CLUB");
    expect(repo.getAccount(federationAccount.id)?.ownerType).toBe("FEDERATION");
    db.close();
  });

  it("advances simulation dates and processes scheduled events into history", () => {
    const db = openGameDatabase(":memory:");
    const save = createNewSave(db, {
      name: "Clock Save",
      worldDate: "2026-01-01",
      gameVersion: "0.1.0",
      randomSeed: "seed",
    });
    const clock = new SimulationClock(db, save);
    clock.schedule({
      dueOn: "2026-01-03",
      eventType: "TEST_EVENT",
      payload: { ok: true },
    });

    clock.advanceDays(2);

    expect(new SaveRepository(db).get(save.id)?.worldDate).toBe("2026-01-03");
    expect(new EventRepository(db).historicalEvents()).toHaveLength(1);
    db.close();
  });

  it("produces deterministic random sequences", () => {
    const a = new SeededRandom("same-seed");
    const b = new SeededRandom("same-seed");

    expect([a.next(), a.integer(1, 10), a.pick(["a", "b", "c"])]).toEqual([
      b.next(),
      b.integer(1, 10),
      b.pick(["a", "b", "c"]),
    ]);
  });

  it("validates data import records with provenance", () => {
    expect(
      validateImportRecord({
        entityType: "club",
        payload: { name: "Testing-only Club" },
        provenance: {
          sourceName: "Automated test fixture",
          confidence: 1,
          status: "SIMULATION_ONLY",
        },
      }),
    ).toMatchObject({ entityType: "club" });

    expect(() =>
      validateImportRecord({
        entityType: "club",
        payload: {},
        provenance: { sourceName: "", confidence: 2, status: "VERIFIED" },
      }),
    ).toThrow();
  });

  it("persists historical events across save reload and continues simulation", () => {
    const result = createTestWorld(tempDbPath());

    expect(result.worldDate).toBe("2027-01-31");
    expect(result.historicalEventCount).toBe(1);
    expect(result.saveId).toBeTruthy();
  });
});
