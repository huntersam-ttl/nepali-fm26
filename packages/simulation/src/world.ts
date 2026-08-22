import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEntityId,
  createStableEntityId,
  type CareerCharacter,
  type Club,
  type Country,
  type Federation,
  type FinanceAccount,
  type Location,
  type Person,
  type PersonRole,
  type Team,
} from "@nepal-football-sim/shared-types";
import {
  createNewSave,
  EventRepository,
  loadSave,
  migrateDatabase,
  openGameDatabase,
  WorldRepository,
  FinanceRepository,
} from "@nepal-football-sim/database";
import { SimulationClock } from "./clock.js";

export type TestWorldResult = {
  databasePath: string;
  saveId: string;
  worldDate: string;
  historicalEventCount: number;
};

export const createTestWorld = (
  databasePath = join(tmpdir(), `nepal-football-${Date.now()}.sqlite`),
): TestWorldResult => {
  const db = openGameDatabase(databasePath);
  migrateDatabase(db);

  const country: Country = {
    id: createStableEntityId("country", "NP"),
    name: "Nepal",
    isoCode: "NP",
  };
  const kathmandu: Location = {
    id: createStableEntityId("location", "NP:kathmandu"),
    countryId: country.id,
    name: "Kathmandu",
    kind: "city",
  };
  const federation: Federation = {
    id: createStableEntityId("federation", "all-nepal-football-association"),
    countryId: country.id,
    name: "Testing Federation of Nepal",
  };
  const club: Club = {
    id: createStableEntityId("club", "testing-only-kathmandu"),
    countryId: country.id,
    locationId: kathmandu.id,
    name: "Testing-only Kathmandu Club",
    ownershipType: "COMMUNITY",
  };
  const team: Team = {
    id: createStableEntityId("team", "testing-only-kathmandu-senior"),
    clubId: club.id,
    name: "Testing-only Kathmandu Senior",
    level: "senior",
    gender: "men",
  };
  const person: Person = {
    id: createStableEntityId("person", "test-player-character"),
    fullName: "Test Career Character",
    displayName: "Test Character",
    nationalityCountryId: country.id,
    hometownLocationId: kathmandu.id,
    languages: ["ne", "en"],
  };
  const role: PersonRole = {
    id: createStableEntityId("person-role", "test-player-character-chairman"),
    personId: person.id,
    role: "CHAIRMAN",
    activeFrom: "2026-01-01",
  };
  const character: CareerCharacter = {
    id: createStableEntityId("career-character", "test-player-character"),
    personId: person.id,
    preferredDisplayName: "Test Character",
    startingAge: 34,
    coachingLicences: [],
    businessBackground: "Testing-only",
  };
  const personalAccount: FinanceAccount = {
    id: createEntityId(),
    ownerType: "PERSON",
    ownerId: person.id,
    name: "Personal money",
    currency: "NPR",
  };
  const clubAccount: FinanceAccount = {
    id: createEntityId(),
    ownerType: "CLUB",
    ownerId: club.id,
    name: "Club operating account",
    currency: "NPR",
  };
  const federationAccount: FinanceAccount = {
    id: createEntityId(),
    ownerType: "FEDERATION",
    ownerId: federation.id,
    name: "Federation operating account",
    currency: "NPR",
  };

  const world = new WorldRepository(db);
  world.insertCountry(country);
  world.insertLocation(kathmandu);
  world.insertFederation(federation);
  world.insertClub(club);
  world.insertTeam(team);
  world.insertPerson(person);
  world.insertPersonRole(role);
  world.insertCareerCharacter(character);

  const finance = new FinanceRepository(db);
  finance.insertAccount(personalAccount);
  finance.insertAccount(clubAccount);
  finance.insertAccount(federationAccount);

  const save = createNewSave(db, {
    name: "Testing-only Nepal World",
    worldDate: "2026-01-01",
    gameVersion: "0.1.0",
    randomSeed: "stage-one-seed",
    playerCharacterId: character.id,
  });

  const clock = new SimulationClock(db, save);
  clock.schedule({
    id: createStableEntityId("scheduled-event", "stage-one-foundation-day"),
    dueOn: "2026-06-01",
    eventType: "FOUNDATION_TEST_EVENT",
    payload: { source: "testing-only" },
  });
  clock.advanceDays(365);

  db.close();

  const reloaded = openGameDatabase(databasePath);
  const reloadedSave = loadSave(reloaded, save.id);
  const reloadedClock = new SimulationClock(reloaded, reloadedSave);
  reloadedClock.advanceDays(30);
  const events = new EventRepository(reloaded).historicalEvents();
  const finalSave = loadSave(reloaded, save.id);
  reloaded.close();

  return {
    databasePath,
    saveId: save.id,
    worldDate: finalSave.worldDate,
    historicalEventCount: events.length,
  };
};
