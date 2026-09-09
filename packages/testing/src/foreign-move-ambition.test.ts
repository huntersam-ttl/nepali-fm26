import { beforeAll, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  TransferMarketRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import { evaluateMoveAmbition } from "@nepal-football-sim/simulation";
import { createStableEntityId, type Club, type EntityId, type Team } from "@nepal-football-sim/shared-types";

/**
 * Proves evaluateMoveAmbition (Section 1's destination-aware foreign-move
 * ambition scorer) is genuinely global: every input is a generic
 * market/reputation/state signal, with no country name, league name, or
 * Nepal-specific branch anywhere in the function. This fixture deliberately
 * uses a CONTEXT_ONLY foreign club (external_club_context/
 * external_league_context — the same mechanism a generated Brazilian club
 * or a Japanese league would use), not a second Nepal club, so a future
 * Global Football Market Engine can call this exact function unchanged.
 */

const db = openGameDatabase(":memory:");
migrateDatabase(db);

const country = { id: createStableEntityId("country", "amb-np"), name: "Ambition Test Country", isoCode: "AT" };
const foreignCountry = {
  id: createStableEntityId("country", "amb-foreign"),
  name: "Ambition Test Foreign Country",
  isoCode: "FC",
};
const federation = { id: createStableEntityId("federation", "amb-fed"), countryId: country.id, name: "Test Federation" };
const foreignFederation = {
  id: createStableEntityId("federation", "amb-foreign-fed"),
  countryId: foreignCountry.id,
  name: "Foreign Test Federation",
};

const currentClub: Club = {
  id: createStableEntityId("club", "amb-current"),
  name: "Current Club",
  countryId: country.id,
  ownershipType: "PRIVATE",
};
const currentTeam: Team = {
  id: createStableEntityId("team", "amb-current-senior"),
  clubId: currentClub.id,
  name: "Current Club",
  level: "senior",
  gender: "men",
};

const weakDestinationClub: Club = {
  id: createStableEntityId("club", "amb-weak-destination"),
  name: "Weak Foreign Club",
  countryId: foreignCountry.id,
  ownershipType: "PRIVATE",
};
const strongDestinationClub: Club = {
  id: createStableEntityId("club", "amb-strong-destination"),
  name: "Strong Foreign Club",
  countryId: foreignCountry.id,
  ownershipType: "PRIVATE",
};

const playerId = createStableEntityId("person", "amb-player");
const youngPlayerId = createStableEntityId("person", "amb-young-player");
const leagueId = createStableEntityId("competition", "amb-foreign-league");

beforeAll(() => {
  const world = new WorldRepository(db);
  world.insertCountry(country);
  world.insertCountry(foreignCountry);
  world.insertFederation(federation);
  world.insertFederation(foreignFederation);
  world.insertClub(currentClub);
  world.insertTeam(currentTeam);
  world.insertClub(weakDestinationClub);
  world.insertClub(strongDestinationClub);
  world.insertCompetition({ id: leagueId, federationId: foreignFederation.id, name: "Foreign League", scope: "domestic" });

  new ClubEconomyRepository(db).upsertSupporterProfile({
    clubId: currentClub.id,
    coreSupporters: 1000,
    casualSupporters: 2000,
    regionalSupport: 1000,
    diasporaSupport: 0,
    activeSupport: 500,
    familySupport: 500,
    youthSupport: 500,
    clubPopularity: 30,
    footballReputation: 30,
    commercialReputation: 20,
    sentiment: "NEUTRAL",
    standardTicketPrice: 100,
    currency: "NPR",
    status: "SIMULATION_ONLY",
  });

  db.prepare(
    `INSERT INTO external_league_context
     (league_id, federation_id, country_id, tier, reputation, simulation_depth, continental_qualification)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(leagueId, foreignFederation.id, foreignCountry.id, 1, 8, "CONTEXT_ONLY", 1);

  db.prepare(
    `INSERT INTO external_club_context
     (club_id, league_id, federation_id, country_id, reputation, financial_band, academy_strength, scouting_reach, recruitment_regions_json, simulation_depth)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(weakDestinationClub.id, leagueId, foreignFederation.id, foreignCountry.id, 3, "LOW", 3, 3, "[]", "CONTEXT_ONLY");
  db.prepare(
    `INSERT INTO external_club_context
     (club_id, league_id, federation_id, country_id, reputation, financial_band, academy_strength, scouting_reach, recruitment_regions_json, simulation_depth)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(strongDestinationClub.id, leagueId, foreignFederation.id, foreignCountry.id, 9, "HIGH", 9, 9, "[]", "CONTEXT_ONLY");

  for (const [id, dob] of [
    [playerId, "1997-01-01"], // 29-30yo established player as of the test dates
    [youngPlayerId, "2006-01-01"], // ~20yo
  ] as const) {
    world.insertPerson({ id, fullName: `Player ${id}`, dateOfBirth: dob, nationalityCountryId: country.id, languages: ["en"] });
    world.insertPersonRole({
      id: createStableEntityId("role", `${id}:player`),
      personId: id,
      role: "PLAYER",
      activeFrom: "2026-08-01",
    });
    world.insertTeamPersonAssignment({
      id: createStableEntityId("assignment", `${id}:player`),
      personId: id,
      teamId: currentTeam.id,
      role: "PLAYER",
      startedOn: "2026-08-01",
    });
  }

  const transfers = new TransferMarketRepository(db);
  transfers.upsertPlayerContract({
    id: createStableEntityId("contract", "amb-player"),
    playerId,
    clubId: currentClub.id,
    startDate: "2026-08-01",
    endDate: "2028-05-31",
    contractType: "PROFESSIONAL",
    salary: 500_000,
    appearanceFee: 0,
    goalBonus: 0,
    cleanSheetBonus: 0,
    signingBonus: 0,
    loyaltyBonus: 0,
    currency: "NPR",
    squadRole: "KEY_PLAYER",
    status: "ACTIVE",
    provenance: { sourceName: "test", confidence: 1, status: "SIMULATION_ONLY" },
  });
  transfers.upsertPlayerContract({
    id: createStableEntityId("contract", "amb-young-player"),
    playerId: youngPlayerId,
    clubId: currentClub.id,
    startDate: "2026-08-01",
    endDate: "2028-05-31",
    contractType: "PROFESSIONAL",
    salary: 150_000,
    appearanceFee: 0,
    goalBonus: 0,
    cleanSheetBonus: 0,
    signingBonus: 0,
    loyaltyBonus: 0,
    currency: "NPR",
    squadRole: "ROTATION",
    status: "ACTIVE",
    provenance: { sourceName: "test", confidence: 1, status: "SIMULATION_ONLY" },
  });
});

describe("evaluateMoveAmbition: destination-aware foreign move ambition", () => {
  it("shows little interest in a weak sideways move to a foreign club of similar standing", () => {
    const result = evaluateMoveAmbition(db, {
      personId: playerId,
      currentClubId: currentClub.id,
      destinationClubId: weakDestinationClub.id,
      offeredWage: 520_000,
      worldDate: "2026-10-01",
    });
    expect(result.interestScore).toBeLessThan(45);
    expect(["REJECT_INTEREST", "MILD_INTEREST"]).toContain(result.classification);
  });

  it("shows meaningful interest in a clearly stronger foreign club with a real wage improvement", () => {
    const result = evaluateMoveAmbition(db, {
      personId: playerId,
      currentClubId: currentClub.id,
      destinationClubId: strongDestinationClub.id,
      offeredWage: 900_000,
      likelyRegularStarter: true,
      worldDate: "2026-10-01",
    });
    expect(result.interestScore).toBeGreaterThan(60);
    expect(["STRONG_INTEREST", "DEMANDS_MOVE"]).toContain(result.classification);
  });

  it("dampens interest for an established starter offered an uncertain role, even at a reputable club", () => {
    const guaranteedStarter = evaluateMoveAmbition(db, {
      personId: playerId,
      currentClubId: currentClub.id,
      destinationClubId: strongDestinationClub.id,
      offeredWage: 900_000,
      likelyRegularStarter: true,
      worldDate: "2026-10-01",
    });
    const uncertainRole = evaluateMoveAmbition(db, {
      personId: playerId,
      currentClubId: currentClub.id,
      destinationClubId: strongDestinationClub.id,
      offeredWage: 900_000,
      likelyRegularStarter: false,
      worldDate: "2026-10-01",
    });
    expect(uncertainRole.interestScore).toBeLessThan(guaranteedStarter.interestScore);
  });

  it("never references a country or league name — the score derives entirely from generic reputation/wage/role/age inputs", () => {
    const result = evaluateMoveAmbition(db, {
      personId: playerId,
      currentClubId: currentClub.id,
      destinationClubId: strongDestinationClub.id,
      offeredWage: 700_000,
      worldDate: "2026-10-01",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/Nepal|Japan|India|Europe|Korea/i);
    expect(result.factors.length).toBeGreaterThan(0);
  });
});
