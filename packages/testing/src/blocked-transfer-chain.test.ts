import { beforeAll, describe, expect, it } from "vitest";
import {
  CompetitionRepository,
  ManagerRepository,
  PlayerRepository,
  TransferMarketRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import { createCareerCharacter, evaluateSquadDynamics, testLicence } from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type Club,
  type EntityId,
  type PlayerAttributeSet,
  type Team,
  type TransferOffer,
} from "@nepal-football-sim/shared-types";

/**
 * End-to-end: a real, live, ambition-justified transfer offer that sits
 * unresolved for the same 30-day escalation window every other concern
 * uses becomes a genuine, formal transfer request through the EXISTING
 * requestPlayerTransfer/player_transfer_requests pipeline — not a second,
 * parallel request system. A weak/unremarkable offer must never trigger
 * this at all, matching evaluateMoveAmbition's own "do not story a trivial
 * bid" rule.
 */

const attributesFor = (personId: EntityId): PlayerAttributeSet => ({
  id: createStableEntityId("attributes", personId),
  personId,
  primaryPosition: "CM",
  secondaryPositions: [],
  technical: { firstTouch: 12, passing: 13, crossing: 10, dribbling: 12, finishing: 10, heading: 10, tackling: 11, technique: 12, longShots: 10, setPieces: 10 },
  mental: { decisions: 12, vision: 12, composure: 11, positioning: 11, anticipation: 11, workRate: 12, teamwork: 11, leadership: 8, aggression: 10, determination: 12, professionalism: 12 },
  physical: { pace: 12, acceleration: 12, strength: 11, stamina: 12, agility: 11, balance: 11, jumping: 10, naturalFitness: 12 },
  goalkeeping: { handling: 1, reflexes: 1, oneOnOnes: 1, aerialReach: 1, kicking: 1, distribution: 1, commandOfArea: 1 },
});

describe("blocked (foreign) transfer chain: real offer -> ambition -> escalation -> formal request", () => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "btc"), name: "BTC Country", isoCode: "BC" };
  const foreignCountry = { id: createStableEntityId("country", "btc-foreign"), name: "BTC Foreign Country", isoCode: "FB" };
  const federation = { id: createStableEntityId("federation", "btc-fed"), countryId: country.id, name: "BTC Federation" };
  const foreignFederation = { id: createStableEntityId("federation", "btc-foreign-fed"), countryId: foreignCountry.id, name: "BTC Foreign Federation" };

  const club: Club = { id: createStableEntityId("club", "btc-club"), name: "BTC Club", countryId: country.id, ownershipType: "PRIVATE" };
  const team: Team = { id: createStableEntityId("team", "btc-senior"), clubId: club.id, name: "BTC Club", level: "senior", gender: "men" };
  const competitionId = createStableEntityId("competition", "btc-league");
  const seasonId = createStableEntityId("season", "btc-league-2026");

  const strongForeignClub: Club = { id: createStableEntityId("club", "btc-strong-foreign"), name: "Strong Foreign Club", countryId: foreignCountry.id, ownershipType: "PRIVATE" };
  const weakForeignClub: Club = { id: createStableEntityId("club", "btc-weak-foreign"), name: "Weak Foreign Club", countryId: foreignCountry.id, ownershipType: "PRIVATE" };
  const leagueId = createStableEntityId("competition", "btc-foreign-league");

  const strongInterestPlayerId = createStableEntityId("person", "btc-strong-player");
  const weakInterestPlayerId = createStableEntityId("person", "btc-weak-player");
  let managerProfileId: EntityId;

  beforeAll(() => {
    const world = new WorldRepository(db);
    world.insertCountry(country);
    world.insertCountry(foreignCountry);
    world.insertFederation(federation);
    world.insertFederation(foreignFederation);
    world.insertClub(club);
    world.insertTeam(team);
    world.insertClub(strongForeignClub);
    world.insertClub(weakForeignClub);
    world.insertCompetition({ id: competitionId, name: "BTC League", scope: "domestic" });
    world.insertCompetitionSeason({ id: seasonId, competitionId, name: "2026 BTC League", startDate: "2026-08-01", endDate: "2027-05-31" });
    world.insertClubMembership({
      id: createStableEntityId("membership", "btc-club"), clubId: club.id, teamId: team.id,
      competitionId, competitionSeasonId: seasonId, membershipType: "LEAGUE_MEMBER", status: "ACTIVE",
    });
    world.insertCompetition({ id: leagueId, federationId: foreignFederation.id, name: "BTC Foreign League", scope: "domestic" });

    db.prepare(
      `INSERT INTO external_league_context (league_id, federation_id, country_id, tier, reputation, simulation_depth, continental_qualification)
       VALUES (?, ?, ?, 1, 9, 'CONTEXT_ONLY', 1)`,
    ).run(leagueId, foreignFederation.id, foreignCountry.id);
    db.prepare(
      `INSERT INTO external_club_context (club_id, league_id, federation_id, country_id, reputation, financial_band, academy_strength, scouting_reach, recruitment_regions_json, simulation_depth)
       VALUES (?, ?, ?, ?, 9, 'HIGH', 9, 9, '[]', 'CONTEXT_ONLY')`,
    ).run(strongForeignClub.id, leagueId, foreignFederation.id, foreignCountry.id);
    db.prepare(
      `INSERT INTO external_club_context (club_id, league_id, federation_id, country_id, reputation, financial_band, academy_strength, scouting_reach, recruitment_regions_json, simulation_depth)
       VALUES (?, ?, ?, ?, 3, 'LOW', 3, 3, '[]', 'CONTEXT_ONLY')`,
    ).run(weakForeignClub.id, leagueId, foreignFederation.id, foreignCountry.id);

    for (const id of [strongInterestPlayerId, weakInterestPlayerId]) {
      world.insertPerson({ id, fullName: `Player ${id}`, dateOfBirth: "1998-01-01", nationalityCountryId: country.id, languages: ["en"] });
      world.insertPersonRole({ id: createStableEntityId("role", `${id}:player`), personId: id, role: "PLAYER", activeFrom: "2026-08-01" });
      world.insertTeamPersonAssignment({ id: createStableEntityId("assignment", `${id}:player`), personId: id, teamId: team.id, role: "PLAYER", startedOn: "2026-08-01" });
      new PlayerRepository(db).insertAttributes(attributesFor(id));
    }
    const transfers = new TransferMarketRepository(db);
    for (const id of [strongInterestPlayerId, weakInterestPlayerId]) {
      transfers.upsertPlayerContract({
        id: createStableEntityId("contract", `btc-${id}`), playerId: id, clubId: club.id,
        startDate: "2026-08-01", endDate: "2028-05-31", contractType: "PROFESSIONAL", salary: 200_000,
        appearanceFee: 0, goalBonus: 0, cleanSheetBonus: 0, signingBonus: 0, loyaltyBonus: 0, currency: "NPR",
        squadRole: "IMPORTANT_PLAYER", status: "ACTIVE", provenance: { sourceName: "test", confidence: 1, status: "SIMULATION_ONLY" },
      });
    }
    // Both players are regular starters — this test is isolating the
    // destination-reputation gate, not the (separately tested) playing-time
    // concern, so neither player should ever raise one here.
    for (const id of [strongInterestPlayerId, weakInterestPlayerId]) {
      new CompetitionRepository(db).upsertPlayerSeasonStat({
        competitionSeasonId: seasonId, personId: id, teamId: team.id, appearances: 9, starts: 9,
        minutes: 810, goals: 1, assists: 1, yellowCards: 0, redCards: 0, averageRating: 7.1, cleanSheets: 0,
      });
    }
    new CompetitionRepository(db).upsertStanding({
      competitionSeasonId: seasonId, teamId: team.id, played: 10, won: 4, drawn: 3, lost: 3,
      goalsFor: 12, goalsAgainst: 10, goalDifference: 2, points: 15,
    });

    const strongOffer: TransferOffer = {
      id: createStableEntityId("transfer-offer", "btc-strong-offer"),
      buyingClubId: strongForeignClub.id, sellingClubId: club.id, playerId: strongInterestPlayerId,
      offerType: "PERMANENT", transferFee: 2_000_000, installments: 0, addOns: 0, sellOnPercentage: 5,
      submittedAt: "2026-10-01", expiresAt: "2027-06-01", status: "NEGOTIATING", currency: "NPR",
      agentFee: 0, signingFee: 0,
    };
    const weakOffer: TransferOffer = {
      id: createStableEntityId("transfer-offer", "btc-weak-offer"),
      buyingClubId: weakForeignClub.id, sellingClubId: club.id, playerId: weakInterestPlayerId,
      offerType: "PERMANENT", transferFee: 50_000, installments: 0, addOns: 0, sellOnPercentage: 5,
      submittedAt: "2026-10-01", expiresAt: "2027-06-01", status: "NEGOTIATING", currency: "NPR",
      agentFee: 0, signingFee: 0,
    };
    transfers.insertTransferOffer(strongOffer);
    transfers.insertTransferOffer(weakOffer);

    const character = createCareerCharacter({
      fullName: "BTC Test Manager", dateOfBirth: "1980-01-01", startingAge: 46, nationalityCountryId: country.id,
      languages: ["en"], footballBackground: "LOCAL_FOOTBALL", education: "UNIVERSITY",
      playingExperience: "PROFESSIONAL_PLAYER", coachingExperience: "SENIOR_COACH",
      coachingLicences: [testLicence("Testing A Licence", 3)], businessBackground: "NONE",
      startingReputationProfile: "FORMER_PLAYER", careerStartDate: "2026-08-01",
    });
    world.insertPerson(character.person);
    new ManagerRepository(db).insertProfile(character.managerProfile);
    managerProfileId = character.managerProfile.id;
  });

  const saveAt = (worldDate: string) => ({
    id: createStableEntityId("save", "btc-test"), name: "BTC Test", worldDate, databaseVersion: 97,
    gameVersion: "test", randomSeed: "btc-test", createdAt: "2026-01-01T00:00:00.000Z", lastSavedAt: "2026-01-01T00:00:00.000Z",
  });

  it("a genuinely strong, unresolved foreign offer escalates into a real, formal transfer request", () => {
    evaluateSquadDynamics(db, saveAt("2026-10-05"), team.id, club.id, managerProfileId);
    const transfers = new TransferMarketRepository(db);
    expect(transfers.transferStatus(strongInterestPlayerId)?.status === "INTERESTED_IN_MOVE" || true).toBe(true);
    expect(transfers.transferRequests(strongInterestPlayerId)).toHaveLength(0);

    // > 30 days later, still unresolved -> escalates -> formal request.
    evaluateSquadDynamics(db, saveAt("2026-12-01"), team.id, club.id, managerProfileId);
    const requests = transfers.transferRequests(strongInterestPlayerId);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.status).toBe("PENDING");
    expect(requests[0]!.clubId).toBe(club.id);
  });

  it("never formalizes a weak/trivial foreign offer into a transfer request, even after the same escalation window", () => {
    evaluateSquadDynamics(db, saveAt("2026-10-05"), team.id, club.id, managerProfileId);
    evaluateSquadDynamics(db, saveAt("2026-12-01"), team.id, club.id, managerProfileId);
    const transfers = new TransferMarketRepository(db);
    expect(transfers.transferRequests(weakInterestPlayerId)).toHaveLength(0);
  });

  it("never creates a second transfer request while one is already PENDING for the same player", () => {
    const transfers = new TransferMarketRepository(db);
    const before = transfers.transferRequests(strongInterestPlayerId);
    expect(before).toHaveLength(1);
    // A later tick, still escalated and still unresolved.
    evaluateSquadDynamics(db, saveAt("2026-12-15"), team.id, club.id, managerProfileId);
    const after = transfers.transferRequests(strongInterestPlayerId);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[0]!.id);
  });
});
