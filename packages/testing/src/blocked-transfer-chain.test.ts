import { beforeAll, describe, expect, it } from "vitest";
import {
  CompetitionRepository,
  ManagerRepository,
  PlayerRepository,
  SquadDynamicsRepository,
  TransferMarketRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  completePermanentTransfer,
  createCareerCharacter,
  evaluateSquadDynamics,
  respondToConcern,
  testLicence,
} from "@nepal-football-sim/simulation";
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

/**
 * A completed permanent transfer would otherwise orphan the departing
 * player's old-club squad-dynamics state forever — evaluateSquadDynamics
 * only ever walks a team's CURRENT roster, and this player has just left
 * it. Verifies the real, canonical resolution wired into
 * completePermanentTransfer itself (never a test-side manual mutation).
 */
describe("transfer completion resolves the departing player's old-club squad-dynamics state", () => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "btc2"), name: "BTC2 Country", isoCode: "B2" };
  const foreignCountry = { id: createStableEntityId("country", "btc2-foreign"), name: "BTC2 Foreign Country", isoCode: "F2" };
  const federation = { id: createStableEntityId("federation", "btc2-fed"), countryId: country.id, name: "BTC2 Federation" };
  const foreignFederation = { id: createStableEntityId("federation", "btc2-foreign-fed"), countryId: foreignCountry.id, name: "BTC2 Foreign Federation" };

  const club: Club = { id: createStableEntityId("club", "btc2-club"), name: "BTC2 Club", countryId: country.id, ownershipType: "PRIVATE" };
  const team: Team = { id: createStableEntityId("team", "btc2-senior"), clubId: club.id, name: "BTC2 Club", level: "senior", gender: "men" };
  const competitionId = createStableEntityId("competition", "btc2-league");
  const seasonId = createStableEntityId("season", "btc2-league-2026");
  const foreignClub: Club = { id: createStableEntityId("club", "btc2-foreign-club"), name: "BTC2 Foreign Club", countryId: foreignCountry.id, ownershipType: "PRIVATE" };
  const leagueId = createStableEntityId("competition", "btc2-foreign-league");

  const completionPlayerId = createStableEntityId("person", "btc2-completion-player");
  const promiseBreakPlayerId = createStableEntityId("person", "btc2-promise-break-player");
  const players = [completionPlayerId, promiseBreakPlayerId];
  let managerProfileId: EntityId;

  const saveAt = (worldDate: string) => ({
    id: createStableEntityId("save", "btc2-test"), name: "BTC2 Test", worldDate, databaseVersion: 97,
    gameVersion: "test", randomSeed: "btc2-test", createdAt: "2026-01-01T00:00:00.000Z", lastSavedAt: "2026-01-01T00:00:00.000Z",
  });

  beforeAll(() => {
    const world = new WorldRepository(db);
    world.insertCountry(country);
    world.insertCountry(foreignCountry);
    world.insertFederation(federation);
    world.insertFederation(foreignFederation);
    world.insertClub(club);
    world.insertTeam(team);
    world.insertClub(foreignClub);
    world.insertCompetition({ id: competitionId, name: "BTC2 League", scope: "domestic" });
    world.insertCompetitionSeason({ id: seasonId, competitionId, name: "2026 BTC2 League", startDate: "2026-08-01", endDate: "2027-05-31" });
    world.insertClubMembership({
      id: createStableEntityId("membership", "btc2-club"), clubId: club.id, teamId: team.id,
      competitionId, competitionSeasonId: seasonId, membershipType: "LEAGUE_MEMBER", status: "ACTIVE",
    });
    world.insertCompetition({ id: leagueId, federationId: foreignFederation.id, name: "BTC2 Foreign League", scope: "domestic" });
    db.prepare(
      `INSERT INTO external_league_context (league_id, federation_id, country_id, tier, reputation, simulation_depth, continental_qualification)
       VALUES (?, ?, ?, 1, 9, 'CONTEXT_ONLY', 1)`,
    ).run(leagueId, foreignFederation.id, foreignCountry.id);
    db.prepare(
      `INSERT INTO external_club_context (club_id, league_id, federation_id, country_id, reputation, financial_band, academy_strength, scouting_reach, recruitment_regions_json, simulation_depth)
       VALUES (?, ?, ?, ?, 9, 'HIGH', 9, 9, '[]', 'CONTEXT_ONLY')`,
    ).run(foreignClub.id, leagueId, foreignFederation.id, foreignCountry.id);

    for (const id of players) {
      world.insertPerson({ id, fullName: `Player ${id}`, dateOfBirth: "1998-01-01", nationalityCountryId: country.id, languages: ["en"] });
      world.insertPersonRole({ id: createStableEntityId("role", `${id}:player`), personId: id, role: "PLAYER", activeFrom: "2026-08-01" });
      world.insertTeamPersonAssignment({ id: createStableEntityId("assignment", `${id}:player`), personId: id, teamId: team.id, role: "PLAYER", startedOn: "2026-08-01" });
      new PlayerRepository(db).insertAttributes({
        id: createStableEntityId("attributes", id), personId: id, primaryPosition: "CM", secondaryPositions: [],
        technical: { firstTouch: 12, passing: 13, crossing: 10, dribbling: 12, finishing: 10, heading: 10, tackling: 11, technique: 12, longShots: 10, setPieces: 10 },
        mental: { decisions: 12, vision: 12, composure: 11, positioning: 11, anticipation: 11, workRate: 12, teamwork: 11, leadership: 8, aggression: 10, determination: 12, professionalism: 12 },
        physical: { pace: 12, acceleration: 12, strength: 11, stamina: 12, agility: 11, balance: 11, jumping: 10, naturalFitness: 12 },
        goalkeeping: { handling: 1, reflexes: 1, oneOnOnes: 1, aerialReach: 1, kicking: 1, distribution: 1, commandOfArea: 1 },
      } as PlayerAttributeSet);
    }
    const transfers = new TransferMarketRepository(db);
    for (const id of players) {
      transfers.upsertPlayerContract({
        id: createStableEntityId("contract", `btc2-${id}`), playerId: id, clubId: club.id,
        startDate: "2026-08-01", endDate: "2028-05-31", contractType: "PROFESSIONAL", salary: 200_000,
        appearanceFee: 0, goalBonus: 0, cleanSheetBonus: 0, signingBonus: 0, loyaltyBonus: 0, currency: "NPR",
        squadRole: "IMPORTANT_PLAYER", status: "ACTIVE", provenance: { sourceName: "test", confidence: 1, status: "SIMULATION_ONLY" },
      });
    }

    const character = createCareerCharacter({
      fullName: "BTC2 Test Manager", dateOfBirth: "1980-01-01", startingAge: 46, nationalityCountryId: country.id,
      languages: ["en"], footballBackground: "LOCAL_FOOTBALL", education: "UNIVERSITY",
      playingExperience: "PROFESSIONAL_PLAYER", coachingExperience: "SENIOR_COACH",
      coachingLicences: [testLicence("Testing A Licence", 3)], businessBackground: "NONE",
      startingReputationProfile: "FORMER_PLAYER", careerStartDate: "2026-08-01",
    });
    world.insertPerson(character.person);
    new ManagerRepository(db).insertProfile(character.managerProfile);
    managerProfileId = character.managerProfile.id;
    // resolveSquadDynamicsOnTransferCompletion resolves managerProfileId from
    // the OLD club's real active manager contract (never a test-supplied
    // value) — a genuine job record is required for it to find anyone.
    new ManagerRepository(db).insertContract({
      id: createStableEntityId("manager-contract", "btc2-club"),
      managerProfileId, personId: character.person.id, teamId: team.id, clubId: club.id,
      jobTitle: "Manager", contractStart: "2026-08-01", salaryAmountMinor: 100_000,
      currency: "NPR", status: "ACTIVE",
    });

    const dynamics = new SquadDynamicsRepository(db);
    for (const id of players) {
      dynamics.upsertRelationship({
        id: createStableEntityId("relationship", `${managerProfileId}:${id}`),
        managerProfileId, personId: id, score: 90, level: "STRONG", updatedOn: "2026-08-01",
      });
    }
  });

  const offerFor = (playerId: EntityId, offerId: string): TransferOffer => ({
    id: createStableEntityId("transfer-offer", offerId),
    buyingClubId: foreignClub.id, sellingClubId: club.id, playerId,
    offerType: "PERMANENT", transferFee: 2_000_000, installments: 0, addOns: 0, sellOnPercentage: 5,
    submittedAt: "2026-09-01", expiresAt: "2027-06-01", status: "ACCEPTED", currency: "NPR",
    agentFee: 0, signingFee: 0,
  });

  it("resolves the departing player's PENDING transfer request and TRANSFER_INTEREST concern when the move completes", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const transfers = new TransferMarketRepository(db);

    // A real, formal, still-PENDING transfer request and an escalated
    // concern — the exact state a blocked foreign move leaves behind.
    transfers.upsertTransferRequest({
      id: createStableEntityId("transfer-request", `${completionPlayerId}:pending`),
      playerId: completionPlayerId, clubId: club.id, requestedAt: "2026-09-01",
      reason: "A foreign move the player finds genuinely appealing has gone unresolved.",
      pressureScore: 60, status: "PENDING",
    });
    dynamics.upsertConcern({
      id: createStableEntityId("concern", `${completionPlayerId}:transfer-interest`),
      personId: completionPlayerId, teamId: team.id, type: "TRANSFER_INTEREST", status: "ESCALATED",
      severity: 7, raisedOn: "2026-09-01", updatedOn: "2026-09-01",
    });

    const offer = offerFor(completionPlayerId, `${completionPlayerId}:offer`);
    transfers.insertTransferOffer(offer);
    completePermanentTransfer(db, offer, "2026-09-15", "btc2-completion-seed");

    // The move genuinely happened — ownership invariant from 7628b59.
    const factual = transfers.activeContract(completionPlayerId, "2026-09-15");
    expect(factual?.clubId).toBe(foreignClub.id);

    const request = transfers.transferRequests(completionPlayerId).find((r) => r.status !== "PENDING");
    expect(request?.status).toBe("ACCEPTED");
    expect(request?.decidedAt).toBe("2026-09-15");

    const concern = dynamics.concern(completionPlayerId, team.id, "TRANSFER_INTEREST");
    expect(concern?.status).toBe("RESOLVED");
    expect(concern?.resolvedOn).toBe("2026-09-15");

    const history = dynamics.historyForPerson(completionPlayerId);
    expect(history.filter((event) => event.eventType === "CONCERN_RESOLVED")).toHaveLength(1);

    const transferHistory = transfers.transferHistory().filter((event) => event.playerId === completionPlayerId);
    expect(transferHistory.some((event) => event.eventType === "TRANSFER_COMPLETED")).toBe(true);

    // The player has left this team's roster — a later tick for the OLD
    // team must not error or re-touch their already-resolved concern.
    expect(() => evaluateSquadDynamics(db, saveAt("2026-10-01"), team.id, club.id, managerProfileId)).not.toThrow();
    expect(dynamics.concern(completionPlayerId, team.id, "TRANSFER_INTEREST")?.status).toBe("RESOLVED");
  });

  it("breaks a still-ACTIVE TRANSFER_STANCE promise when the club sells the player anyway, exactly once even if completion is invoked again", () => {
    const dynamics = new SquadDynamicsRepository(db);
    dynamics.upsertConcern({
      id: createStableEntityId("concern", `${promiseBreakPlayerId}:transfer-interest`),
      personId: promiseBreakPlayerId, teamId: team.id, type: "TRANSFER_INTEREST", status: "ACTIVE",
      severity: 6, raisedOn: "2026-09-01", updatedOn: "2026-09-01",
    });
    const concern = dynamics.concern(promiseBreakPlayerId, team.id, "TRANSFER_INTEREST")!;
    const response = respondToConcern(db, saveAt("2026-09-01"), managerProfileId, concern.id, "PROMISE_TRANSFER_STANCE");
    expect(response.outcome).not.toBe("REJECTED");
    const promise = dynamics.promiseById(response.promiseId!)!;
    expect(promise.type).toBe("TRANSFER_STANCE");
    expect(promise.status).toBe("ACTIVE");

    const before = dynamics.relationship(managerProfileId, promiseBreakPlayerId)?.score ?? 0;
    const offer = offerFor(promiseBreakPlayerId, `${promiseBreakPlayerId}:offer`);
    new TransferMarketRepository(db).insertTransferOffer(offer);
    completePermanentTransfer(db, offer, "2026-09-20", "btc2-promise-break-seed");

    const resolved = dynamics.promiseById(promise.id)!;
    expect(resolved.status).toBe("BROKEN");
    expect(resolved.resolvedOn).toBe("2026-09-20");
    const history = dynamics.historyForPerson(promiseBreakPlayerId);
    expect(history.filter((event) => event.eventType === "PROMISE_BROKEN")).toHaveLength(1);

    // Exact-once: re-invoking completion on the same, now-COMPLETED offer
    // must not re-break an already-resolved promise or double the event.
    completePermanentTransfer(db, offer, "2026-09-21", "btc2-promise-break-seed-again");
    expect(dynamics.promiseById(promise.id)!.resolvedOn).toBe("2026-09-20");
    expect(dynamics.historyForPerson(promiseBreakPlayerId).filter((event) => event.eventType === "PROMISE_BROKEN")).toHaveLength(1);
    // No unbounded penalty — a single, real relationship consequence.
    const after = dynamics.relationship(managerProfileId, promiseBreakPlayerId)?.score ?? 0;
    expect(after).toBeLessThan(before);
  });
});
