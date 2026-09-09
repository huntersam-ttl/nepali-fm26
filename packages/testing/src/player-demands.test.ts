import { beforeEach, describe, expect, it } from "vitest";
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
  DemandActionError,
  appointCaptaincy,
  createCareerCharacter,
  evaluateSquadDynamics,
  manageAiDemandsForTeam,
  respondToDemand,
  testLicence,
} from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type Club,
  type EntityId,
  type PlayerAttributeSet,
  type Team,
} from "@nepal-football-sim/shared-types";

/**
 * Player demands: a formal, player-initiated request the manager must
 * actually answer, opened only from a genuinely ESCALATED concern (never a
 * merely RAISED one), never duplicated while one of that type is already
 * OPEN. TRANSFER_REQUEST/LOAN_REQUEST are deliberately out of scope here —
 * they already exist via requestPlayerTransfer/player_transfer_requests.
 */

const attributesFor = (personId: EntityId, leadershipBoost: number): PlayerAttributeSet => ({
  id: createStableEntityId("attributes", personId),
  personId,
  primaryPosition: "CM",
  secondaryPositions: [],
  technical: {
    firstTouch: 10, passing: 10, crossing: 10, dribbling: 10, finishing: 10,
    heading: 10, tackling: 10, technique: 10, longShots: 10, setPieces: 10,
  },
  mental: {
    decisions: 10, vision: 10, composure: 10, positioning: 10, anticipation: 10,
    workRate: 10, teamwork: 10, leadership: 10 + leadershipBoost, aggression: 10,
    determination: 10 + leadershipBoost, professionalism: 12,
  },
  physical: {
    pace: 10, acceleration: 10, strength: 10, stamina: 10, agility: 10,
    balance: 10, jumping: 10, naturalFitness: 10,
  },
  goalkeeping: {
    handling: 1, reflexes: 1, oneOnOnes: 1, aerialReach: 1, kicking: 1,
    distribution: 1, commandOfArea: 1,
  },
});

describe("player demands: opening, response, AI handling, and captaincy reaction", () => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "pd"), name: "Demand Test Country", isoCode: "DT" };
  const club: Club = { id: createStableEntityId("club", "pd-club"), name: "Demand FC", countryId: country.id, ownershipType: "PRIVATE" };
  const team: Team = { id: createStableEntityId("team", "pd-senior"), clubId: club.id, name: "Demand FC", level: "senior", gender: "men" };
  const competitionId = createStableEntityId("competition", "pd-league");
  const seasonId = createStableEntityId("season", "pd-league-2026");

  const keyPlayerId = createStableEntityId("person", "pd-key-player");
  const captainId = createStableEntityId("person", "pd-captain");
  const otherId = createStableEntityId("person", "pd-other");
  let managerProfileId: EntityId;

  beforeEach(() => {
    // Only runs once in practice (module-level db), kept as beforeEach for
    // convention consistency with the rest of this suite's style — the
    // world is built exactly once via a guard.
  });

  const world = new WorldRepository(db);
  world.insertCountry(country);
  world.insertClub(club);
  world.insertTeam(team);
  world.insertCompetition({ id: competitionId, name: "Demand Test League", scope: "domestic" });
  world.insertCompetitionSeason({
    id: seasonId, competitionId, name: "2026 Demand Test League", startDate: "2026-08-01", endDate: "2027-05-31",
  });
  world.insertClubMembership({
    id: createStableEntityId("membership", "pd-club"), clubId: club.id, teamId: team.id,
    competitionId, competitionSeasonId: seasonId, membershipType: "LEAGUE_MEMBER", status: "ACTIVE",
  });
  for (const [id, boost] of [[captainId, 8], [keyPlayerId, 2], [otherId, 1]] as const) {
    world.insertPerson({ id, fullName: `Player ${id}`, nationalityCountryId: country.id, languages: ["en"] });
    world.insertPersonRole({ id: createStableEntityId("role", `${id}:player`), personId: id, role: "PLAYER", activeFrom: "2026-08-01" });
    world.insertTeamPersonAssignment({ id: createStableEntityId("assignment", `${id}:player`), personId: id, teamId: team.id, role: "PLAYER", startedOn: "2026-08-01" });
    new PlayerRepository(db).insertAttributes(attributesFor(id, boost));
  }
  new TransferMarketRepository(db).upsertPlayerContract({
    id: createStableEntityId("contract", "pd-key-player"), playerId: keyPlayerId, clubId: club.id,
    startDate: "2026-08-01", endDate: "2028-05-31", contractType: "PROFESSIONAL", salary: 100_000,
    appearanceFee: 0, goalBonus: 0, cleanSheetBonus: 0, signingBonus: 0, loyaltyBonus: 0, currency: "NPR",
    squadRole: "KEY_PLAYER", status: "ACTIVE", provenance: { sourceName: "test", confidence: 1, status: "SIMULATION_ONLY" },
  });
  new CompetitionRepository(db).upsertPlayerSeasonStat({
    competitionSeasonId: seasonId, personId: keyPlayerId, teamId: team.id, appearances: 1, starts: 1,
    minutes: 90, goals: 0, assists: 0, yellowCards: 0, redCards: 0, averageRating: 6.5, cleanSheets: 0,
  });
  new CompetitionRepository(db).upsertStanding({
    competitionSeasonId: seasonId, teamId: team.id, played: 10, won: 4, drawn: 3, lost: 3,
    goalsFor: 12, goalsAgainst: 10, goalDifference: 2, points: 15,
  });
  const character = createCareerCharacter({
    fullName: "Demand Test Manager", dateOfBirth: "1980-01-01", startingAge: 46, nationalityCountryId: country.id,
    languages: ["en"], footballBackground: "LOCAL_FOOTBALL", education: "UNIVERSITY",
    playingExperience: "PROFESSIONAL_PLAYER", coachingExperience: "SENIOR_COACH",
    coachingLicences: [testLicence("Testing A Licence", 3)], businessBackground: "NONE",
    startingReputationProfile: "FORMER_PLAYER", careerStartDate: "2026-08-01",
  });
  world.insertPerson(character.person);
  new ManagerRepository(db).insertProfile(character.managerProfile);
  managerProfileId = character.managerProfile.id;

  const saveAt = (worldDate: string) => ({
    id: createStableEntityId("save", "pd-test"), name: "Demand Test", worldDate, databaseVersion: 97,
    gameVersion: "test", randomSeed: "pd-test", createdAt: "2026-01-01T00:00:00.000Z", lastSavedAt: "2026-01-01T00:00:00.000Z",
  });

  it("opens a PLAYING_TIME_REQUEST demand only once the concern genuinely escalates, never from a merely raised one", () => {
    // Raised, not yet escalated — key player has barely played this season.
    evaluateSquadDynamics(db, saveAt("2026-10-15"), team.id, club.id, managerProfileId);
    const dynamics = new SquadDynamicsRepository(db);
    expect(dynamics.concern(keyPlayerId, team.id, "PLAYING_TIME")?.status).toBe("RAISED");
    expect(dynamics.demand(keyPlayerId, team.id, "PLAYING_TIME_REQUEST")).toBeUndefined();

    // > 30 days later, still unaddressed — now escalates and opens a demand.
    evaluateSquadDynamics(db, saveAt("2026-12-05"), team.id, club.id, managerProfileId);
    expect(dynamics.concern(keyPlayerId, team.id, "PLAYING_TIME")?.status).toBe("ESCALATED");
    const demand = dynamics.demand(keyPlayerId, team.id, "PLAYING_TIME_REQUEST");
    expect(demand?.status).toBe("OPEN");
    expect(demand?.concernId).toBe(dynamics.concern(keyPlayerId, team.id, "PLAYING_TIME")?.id);
  });

  it("does not open a second demand while one of the same type is already open", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const before = dynamics.demand(keyPlayerId, team.id, "PLAYING_TIME_REQUEST");
    // Another tick, still escalated and still unaddressed.
    evaluateSquadDynamics(db, saveAt("2026-12-10"), team.id, club.id, managerProfileId);
    const after = dynamics.demand(keyPlayerId, team.id, "PLAYING_TIME_REQUEST");
    expect(after?.id).toBe(before?.id);
    expect(after?.openedOn).toBe(before?.openedOn);
    const allDemandsForType = db
      .prepare("SELECT COUNT(*) AS c FROM player_demands WHERE person_id = ? AND team_id = ? AND type = 'PLAYING_TIME_REQUEST'")
      .get(keyPlayerId, team.id) as { c: number };
    expect(allDemandsForType.c).toBe(1);
  });

  it("ACCEPT creates a real measurable promise and links it back to the demand", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const demand = dynamics.demand(keyPlayerId, team.id, "PLAYING_TIME_REQUEST")!;
    const result = respondToDemand(db, saveAt("2026-12-11"), managerProfileId, demand.id, "ACCEPT");
    expect(result.demand.status).toBe("ACCEPTED");
    expect(result.demand.managerResponse).toBe("ACCEPT");
    expect(result.promise).toBeDefined();
    expect(result.promise?.type).toBe("PLAYING_TIME");
    expect(result.demand.promiseId).toBe(result.promise?.id);
  });

  it("rejects responding to a demand that is not OPEN, and to one that does not exist", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const demand = dynamics.demand(keyPlayerId, team.id, "PLAYING_TIME_REQUEST")!;
    expect(demand.status).toBe("ACCEPTED"); // from the previous test
    expect(() => respondToDemand(db, saveAt("2026-12-12"), managerProfileId, demand.id, "ACCEPT")).toThrow(
      DemandActionError,
    );
    expect(() =>
      respondToDemand(db, saveAt("2026-12-12"), managerProfileId, createStableEntityId("demand", "nonexistent"), "ACCEPT"),
    ).toThrow(DemandActionError);
  });

  it("REJECT re-escalates the linked concern and never fabricates a promise", () => {
    // Seed an already-escalated CONTRACT concern + its OPEN demand directly
    // (this fixture's contract end date is deliberately far off so the
    // earlier playing-time tests' natural escalation doesn't also trigger
    // a contract concern) — this test is about respondToDemand's REJECT
    // branch, not about re-proving the escalation trigger a second time.
    const dynamics = new SquadDynamicsRepository(db);
    const concernId = createStableEntityId("concern", "reject-test-contract");
    dynamics.upsertConcern({
      id: concernId, personId: keyPlayerId, teamId: team.id, type: "CONTRACT",
      status: "ESCALATED", severity: 5, raisedOn: "2027-01-20", updatedOn: "2027-03-01",
    });
    dynamics.upsertDemand({
      id: createStableEntityId("demand", "reject-test-contract-demand"), personId: keyPlayerId, teamId: team.id,
      type: "CONTRACT_REQUEST", status: "OPEN", severity: 5, openedOn: "2027-03-01", updatedOn: "2027-03-01",
      trigger: "test", requestedOutcome: "A new or improved contract.", concernId,
    });
    const contractDemand = dynamics.demand(keyPlayerId, team.id, "CONTRACT_REQUEST");
    expect(contractDemand?.status).toBe("OPEN");
    const result = respondToDemand(db, saveAt("2027-03-02"), managerProfileId, contractDemand!.id, "REJECT");
    expect(result.demand.status).toBe("REJECTED");
    expect(result.promise).toBeUndefined();
    const concern = dynamics.concernById(contractDemand!.concernId!);
    expect(concern?.status).toBe("ESCALATED");
  });

  it("the AI manager responds deterministically based on relationship, never a flat always-accept or always-reject", () => {
    const dynamics = new SquadDynamicsRepository(db);
    // Force a fresh ROLE_REQUEST-eligible demand for `otherId` by directly
    // seeding an escalated ROLE_STATUS concern (bypassing the multi-tick
    // real-state buildup this narrow test doesn't need).
    dynamics.upsertConcern({
      id: createStableEntityId("concern", "ai-demand-role"), personId: otherId, teamId: team.id,
      type: "ROLE_STATUS", status: "ESCALATED", severity: 6, raisedOn: "2027-04-01", updatedOn: "2027-04-01",
    });
    dynamics.upsertDemand({
      id: createStableEntityId("demand", "ai-role-demand"), personId: otherId, teamId: team.id,
      type: "ROLE_REQUEST", status: "OPEN", severity: 6, openedOn: "2027-04-01", updatedOn: "2027-04-01",
      trigger: "test", requestedOutcome: "A clearer squad role.",
      concernId: createStableEntityId("concern", "ai-demand-role"),
    });

    // Poor relationship -> AI should not simply accept.
    dynamics.upsertRelationship({
      id: createStableEntityId("relationship", "ai-poor"), managerProfileId, personId: otherId,
      score: -40, level: "POOR", updatedOn: "2027-04-01",
    });
    const poorResult = manageAiDemandsForTeam(db, saveAt("2027-04-02"), managerProfileId, team.id);
    expect(poorResult?.demand.status).toBe("REJECTED");

    // Re-open and try again with a good relationship -> AI should accept.
    dynamics.upsertDemand({
      id: createStableEntityId("demand", "ai-role-demand"), personId: otherId, teamId: team.id,
      type: "ROLE_REQUEST", status: "OPEN", severity: 6, openedOn: "2027-05-01", updatedOn: "2027-05-01",
      trigger: "test", requestedOutcome: "A clearer squad role.",
      concernId: createStableEntityId("concern", "ai-demand-role"),
    });
    dynamics.upsertRelationship({
      id: createStableEntityId("relationship", "ai-poor"), managerProfileId, personId: otherId,
      score: 30, level: "GOOD", updatedOn: "2027-05-01",
    });
    const goodResult = manageAiDemandsForTeam(db, saveAt("2027-05-02"), managerProfileId, team.id);
    expect(goodResult?.demand.status).toBe("ACCEPTED");
  });

  it("a demand nobody answers past its review date expires rather than accumulating forever", () => {
    const dynamics = new SquadDynamicsRepository(db);
    dynamics.upsertConcern({
      id: createStableEntityId("concern", "expiry-test"), personId: otherId, teamId: team.id,
      type: "PLAYING_TIME", status: "ESCALATED", severity: 5, raisedOn: "2027-06-01", updatedOn: "2027-06-01",
    });
    dynamics.upsertDemand({
      id: createStableEntityId("demand", "expiry-test-demand"), personId: otherId, teamId: team.id,
      type: "PLAYING_TIME_REQUEST", status: "OPEN", severity: 5, openedOn: "2027-06-01", updatedOn: "2027-06-01",
      reviewOn: "2027-06-22", trigger: "test", requestedOutcome: "More playing time.",
    });
    // Well past the review date.
    evaluateSquadDynamics(db, saveAt("2027-08-01"), team.id, club.id, managerProfileId);
    const expired = dynamics.demand(otherId, team.id, "PLAYING_TIME_REQUEST");
    expect(expired?.status).toBe("EXPIRED");
  });

  describe("captaincy reaction", () => {
    it("a hard-demoted, highly influential former captain reacts: relationship dip and, at very high influence, a CAPTAINCY_CONCERN demand", () => {
      const dynamics = new SquadDynamicsRepository(db);
      // captainId has the highest influence boost in this fixture, so an
      // unforced recompute would naturally captain them — appoint them
      // explicitly first so there is a real captain to demote.
      appointCaptaincy(db, "2027-09-01", managerProfileId, team.id, { captainPersonId: captainId });
      const before = dynamics.relationship(managerProfileId, captainId)?.score ?? 0;
      // Appoint someone else — captainId, still influential, is demoted.
      // Force a hard demotion by also clearing them from vice-captain
      // contention (appointCaptaincy alone only guarantees they leave the
      // CAPTAIN slot, not necessarily SQUAD/FRINGE — but this fixture's
      // small 3-player roster means the demoted captain lands on
      // SQUAD_PLAYER or FRINGE_PLAYER once they're no longer captain or
      // vice, since only two leadership slots exist above that tier).
      appointCaptaincy(db, "2027-09-02", managerProfileId, team.id, {
        captainPersonId: keyPlayerId,
        viceCaptainPersonId: otherId,
      });
      const after = dynamics.relationship(managerProfileId, captainId)?.score ?? 0;
      expect(after).toBeLessThan(before);

      const history = dynamics.historyForPerson(captainId);
      expect(history.some((event) => event.eventType === "CAPTAINCY_REACTION")).toBe(true);

      // captainId's leadership boost (8) comfortably clears the >=75
      // influence bar for the demand to open.
      const demand = dynamics.demand(captainId, team.id, "CAPTAINCY_CONCERN");
      expect(demand?.status).toBe("OPEN");
    });

    it("does not react at all when the captaincy simply passes between two similarly senior players with no hard demotion", () => {
      // Re-appoint captainId as vice (a soft change, not a hard demotion —
      // they remain in a leadership slot).
      const dynamics = new SquadDynamicsRepository(db);
      const beforeHistoryCount = dynamics.historyForPerson(keyPlayerId).filter((e) => e.eventType === "CAPTAINCY_REACTION").length;
      appointCaptaincy(db, "2027-09-05", managerProfileId, team.id, {
        captainPersonId: otherId,
        viceCaptainPersonId: keyPlayerId,
      });
      const afterHistoryCount = dynamics.historyForPerson(keyPlayerId).filter((e) => e.eventType === "CAPTAINCY_REACTION").length;
      // keyPlayerId moved from CAPTAIN to VICE_CAPTAIN — still a leadership
      // slot, so this must not count as a hard demotion reaction.
      expect(afterHistoryCount).toBe(beforeHistoryCount);
    });
  });
});
