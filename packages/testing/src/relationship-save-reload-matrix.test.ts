import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ManagerRepository,
  PlayerRepository,
  SquadDynamicsRepository,
  TransferMarketRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { createCareerCharacter, testLicence } from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type Club,
  type EntityId,
  type ManagerPromise,
  type PlayerConcern,
  type PlayerDemand,
  type PlayerTransferRequest,
  type SquadMeeting,
  type Team,
  type TransferOffer,
} from "@nepal-football-sim/shared-types";

/**
 * The consolidated relationship persistence matrix — every major
 * relationship state category, each represented in every status that
 * matters, all built directly against the real repositories (the same
 * ones every command in squad-dynamics.ts/transfer-market.ts itself
 * writes through) and verified identical after a genuine file close/reopen.
 * This does not re-derive the business rules that PRODUCE each state
 * (concern escalation, promise resolution, etc. — already covered end to
 * end elsewhere: squad-dynamics.test.ts, squad-dynamics-promises.test.ts,
 * player-demands.test.ts, blocked-transfer-chain.test.ts); its only job is
 * proving persistence itself is complete and duplicate-free across a real
 * reload, for every state value the sprint's own gates require.
 */

const attributesFor = (personId: EntityId) => ({
  id: createStableEntityId("attributes", personId),
  personId,
  primaryPosition: "CM" as const,
  secondaryPositions: [],
  technical: { firstTouch: 10, passing: 10, crossing: 10, dribbling: 10, finishing: 10, heading: 10, tackling: 10, technique: 10, longShots: 10, setPieces: 10 },
  mental: { decisions: 10, vision: 10, composure: 10, positioning: 10, anticipation: 10, workRate: 10, teamwork: 10, leadership: 12, aggression: 10, determination: 12, professionalism: 12 },
  physical: { pace: 10, acceleration: 10, strength: 10, stamina: 10, agility: 10, balance: 10, jumping: 10, naturalFitness: 10 },
  goalkeeping: { handling: 1, reflexes: 1, oneOnOnes: 1, aerialReach: 1, kicking: 1, distribution: 1, commandOfArea: 1 },
});

describe("relationship save/reload matrix — every major state, one real file reload", () => {
  const dir = mkdtempSync(join(tmpdir(), "relationship-save-reload-"));
  const dbPath = join(dir, "career.sqlite");
  let db: GameDatabase = openGameDatabase(dbPath);
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "rsr"), name: "RSR Country", isoCode: "RS" };
  const foreignCountry = { id: createStableEntityId("country", "rsr-foreign"), name: "RSR Foreign Country", isoCode: "RF" };
  const foreignFederation = { id: createStableEntityId("federation", "rsr-foreign-fed"), countryId: foreignCountry.id, name: "RSR Foreign Federation" };
  const club: Club = { id: createStableEntityId("club", "rsr-club"), name: "RSR Club", countryId: country.id, ownershipType: "PRIVATE" };
  const team: Team = { id: createStableEntityId("team", "rsr-senior"), clubId: club.id, name: "RSR Club", level: "senior", gender: "men" };
  const competitionId = createStableEntityId("competition", "rsr-league");
  const seasonId = createStableEntityId("season", "rsr-league-2026");
  const foreignClub: Club = { id: createStableEntityId("club", "rsr-foreign-club"), name: "RSR Foreign Club", countryId: foreignCountry.id, ownershipType: "PRIVATE" };
  const leagueId = createStableEntityId("competition", "rsr-foreign-league");

  // One player per concern/demand/promise status combination.
  const players = {
    concernActive: createStableEntityId("person", "rsr-concern-active"),
    concernEscalated: createStableEntityId("person", "rsr-concern-escalated"),
    concernResolved: createStableEntityId("person", "rsr-concern-resolved"),
    demandOpen: createStableEntityId("person", "rsr-demand-open"),
    demandAccepted: createStableEntityId("person", "rsr-demand-accepted"),
    demandRejected: createStableEntityId("person", "rsr-demand-rejected"),
    demandDeferred: createStableEntityId("person", "rsr-demand-deferred"),
    promiseActive: createStableEntityId("person", "rsr-promise-active"),
    promiseFulfilled: createStableEntityId("person", "rsr-promise-fulfilled"),
    promiseBroken: createStableEntityId("person", "rsr-promise-broken"),
    promiseExpired: createStableEntityId("person", "rsr-promise-expired"),
    transferRequest: createStableEntityId("person", "rsr-transfer-request"),
    meetingSubject: createStableEntityId("person", "rsr-meeting-subject"),
    captainA: createStableEntityId("person", "rsr-captain-a"),
    captainB: createStableEntityId("person", "rsr-captain-b"),
  };
  const allPlayerIds = Object.values(players);
  let managerProfileId: EntityId;

  it("sets up every relationship state category directly against the real repositories", () => {
    const world = new WorldRepository(db);
    world.insertCountry(country);
    world.insertCountry(foreignCountry);
    world.insertFederation(foreignFederation);
    world.insertClub(club);
    world.insertTeam(team);
    world.insertClub(foreignClub);
    world.insertCompetition({ id: competitionId, name: "RSR League", scope: "domestic" });
    world.insertCompetitionSeason({ id: seasonId, competitionId, name: "2026 RSR League", startDate: "2026-08-01", endDate: "2027-05-31" });
    world.insertClubMembership({
      id: createStableEntityId("membership", "rsr-club"), clubId: club.id, teamId: team.id,
      competitionId, competitionSeasonId: seasonId, membershipType: "LEAGUE_MEMBER", status: "ACTIVE",
    });
    world.insertCompetition({ id: leagueId, federationId: foreignFederation.id, name: "RSR Foreign League", scope: "domestic" });
    db.prepare(
      `INSERT INTO external_league_context (league_id, federation_id, country_id, tier, reputation, simulation_depth, continental_qualification)
       VALUES (?, ?, ?, 1, 9, 'CONTEXT_ONLY', 1)`,
    ).run(leagueId, foreignFederation.id, foreignCountry.id);
    db.prepare(
      `INSERT INTO external_club_context (club_id, league_id, federation_id, country_id, reputation, financial_band, academy_strength, scouting_reach, recruitment_regions_json, simulation_depth)
       VALUES (?, ?, ?, ?, 9, 'HIGH', 9, 9, '[]', 'CONTEXT_ONLY')`,
    ).run(foreignClub.id, leagueId, foreignFederation.id, foreignCountry.id);

    for (const id of allPlayerIds) {
      world.insertPerson({ id, fullName: `Player ${id}`, nationalityCountryId: country.id, languages: ["en"] });
      world.insertPersonRole({ id: createStableEntityId("role", `${id}:player`), personId: id, role: "PLAYER", activeFrom: "2026-08-01" });
      world.insertTeamPersonAssignment({ id: createStableEntityId("assignment", `${id}:player`), personId: id, teamId: team.id, role: "PLAYER", startedOn: "2026-08-01" });
      new PlayerRepository(db).insertAttributes(attributesFor(id));
    }

    const character = createCareerCharacter({
      fullName: "RSR Test Manager", dateOfBirth: "1980-01-01", startingAge: 46, nationalityCountryId: country.id,
      languages: ["en"], footballBackground: "LOCAL_FOOTBALL", education: "UNIVERSITY",
      playingExperience: "PROFESSIONAL_PLAYER", coachingExperience: "SENIOR_COACH",
      coachingLicences: [testLicence("Testing A Licence", 3)], businessBackground: "NONE",
      startingReputationProfile: "FORMER_PLAYER", careerStartDate: "2026-08-01",
    });
    world.insertPerson(character.person);
    new ManagerRepository(db).insertProfile(character.managerProfile);
    managerProfileId = character.managerProfile.id;
    new ManagerRepository(db).insertContract({
      id: createStableEntityId("manager-contract", "rsr-club"),
      managerProfileId, personId: character.person.id, teamId: team.id, clubId: club.id,
      jobTitle: "Manager", contractStart: "2026-08-01", salaryAmountMinor: 100_000, currency: "NPR", status: "ACTIVE",
    });

    const dynamics = new SquadDynamicsRepository(db);
    const transfers = new TransferMarketRepository(db);

    // CONCERNS: ACTIVE, ESCALATED, RESOLVED.
    const concernOf = (personId: EntityId, status: PlayerConcern["status"]): PlayerConcern => ({
      id: createStableEntityId("concern", `rsr:${personId}`),
      personId, teamId: team.id, type: "PLAYING_TIME", status, severity: 6,
      raisedOn: "2026-08-01", updatedOn: "2026-08-08",
      resolvedOn: status === "RESOLVED" ? "2026-08-08" : undefined,
    });
    dynamics.upsertConcern(concernOf(players.concernActive, "ACTIVE"));
    dynamics.upsertConcern(concernOf(players.concernEscalated, "ESCALATED"));
    dynamics.upsertConcern(concernOf(players.concernResolved, "RESOLVED"));

    // DEMANDS: OPEN, ACCEPTED, REJECTED, DEFERRED.
    const demandOf = (personId: EntityId, status: PlayerDemand["status"], response?: PlayerDemand["managerResponse"]): PlayerDemand => ({
      id: createStableEntityId("demand", `rsr:${personId}`),
      personId, teamId: team.id, type: "CONTRACT_REQUEST", status, severity: 5,
      openedOn: "2026-08-01", updatedOn: "2026-08-08", reviewOn: "2026-08-22",
      trigger: "test trigger", requestedOutcome: "A new deal",
      managerResponse: response, resolvedOn: status === "OPEN" ? undefined : "2026-08-08",
    });
    dynamics.upsertDemand(demandOf(players.demandOpen, "OPEN"));
    dynamics.upsertDemand(demandOf(players.demandAccepted, "ACCEPTED", "ACCEPT"));
    dynamics.upsertDemand(demandOf(players.demandRejected, "REJECTED", "REJECT"));
    dynamics.upsertDemand(demandOf(players.demandDeferred, "DEFERRED", "DEFER"));

    // PROMISES: ACTIVE, FULFILLED, BROKEN, EXPIRED.
    const promiseOf = (personId: EntityId, status: ManagerPromise["status"]): ManagerPromise => ({
      id: createStableEntityId("promise", `rsr:${personId}`),
      managerProfileId, personId, teamId: team.id, type: "PLAYING_TIME",
      description: "Promised more minutes.", madeOn: "2026-08-01", dueOn: "2026-08-15",
      status, baselineMetric: 0, resolvedOn: status === "ACTIVE" ? undefined : "2026-08-15",
    });
    dynamics.upsertPromise(promiseOf(players.promiseActive, "ACTIVE"));
    dynamics.upsertPromise(promiseOf(players.promiseFulfilled, "FULFILLED"));
    dynamics.upsertPromise(promiseOf(players.promiseBroken, "BROKEN"));
    dynamics.upsertPromise(promiseOf(players.promiseExpired, "EXPIRED"));

    // TRANSFER REQUEST: PENDING, plus a real foreign offer for context.
    const request: PlayerTransferRequest = {
      id: createStableEntityId("transfer-request", `rsr:${players.transferRequest}`),
      playerId: players.transferRequest, clubId: club.id, requestedAt: "2026-08-01",
      reason: "A foreign move the player finds genuinely appealing has gone unresolved.",
      pressureScore: 55, status: "PENDING",
    };
    transfers.upsertTransferRequest(request);
    transfers.upsertPlayerContract({
      id: createStableEntityId("contract", `rsr:${players.transferRequest}`), playerId: players.transferRequest, clubId: club.id,
      startDate: "2026-08-01", endDate: "2028-05-31", contractType: "PROFESSIONAL", salary: 100_000,
      appearanceFee: 0, goalBonus: 0, cleanSheetBonus: 0, signingBonus: 0, loyaltyBonus: 0, currency: "NPR",
      squadRole: "IMPORTANT_PLAYER", status: "ACTIVE", provenance: { sourceName: "test", confidence: 1, status: "SIMULATION_ONLY" },
    });
    const offer: TransferOffer = {
      id: createStableEntityId("transfer-offer", `rsr:${players.transferRequest}`),
      buyingClubId: foreignClub.id, sellingClubId: club.id, playerId: players.transferRequest,
      offerType: "PERMANENT", transferFee: 1_500_000, installments: 0, addOns: 0, sellOnPercentage: 5,
      submittedAt: "2026-08-01", expiresAt: "2027-06-01", status: "NEGOTIATING", currency: "NPR",
      agentFee: 0, signingFee: 0,
    };
    transfers.insertTransferOffer(offer);

    // CAPTAINCY: override + a real reaction event.
    dynamics.upsertCaptaincyOverride({
      teamId: team.id, captainPersonId: players.captainA, viceCaptainPersonId: players.captainB,
      setOn: "2026-08-05", setByManagerProfileId: managerProfileId,
    });
    dynamics.insertHistoryEvent({
      id: createStableEntityId("history", "rsr-captaincy-reaction"),
      personId: players.captainB, teamId: team.id, managerProfileId,
      eventType: "CAPTAINCY_REACTION", occurredOn: "2026-08-05", data: { newRole: "FRINGE_PLAYER", influence: 80 },
    });

    // PLAYER MEETING: a real ONE_TO_ONE meeting with history/cooldown-relevant fields.
    const meeting: SquadMeeting = {
      id: createStableEntityId("meeting", "rsr-player-meeting"), teamId: team.id, managerProfileId,
      type: "ONE_TO_ONE", personId: players.meetingSubject, outcome: "POSITIVE",
      summary: "A real, measurable commitment was made and well received.", occurredOn: "2026-08-08",
      concernId: players.concernActive ? concernOf(players.concernActive, "ACTIVE").id : undefined,
    };
    dynamics.insertMeeting(meeting);

    // TEAM MEETING: a real SQUAD_MEETING with context/message/outcome/date.
    const teamMeeting: SquadMeeting = {
      id: createStableEntityId("meeting", "rsr-team-meeting"), teamId: team.id, managerProfileId,
      type: "SQUAD_MEETING", outcome: "NEUTRAL",
      summary: "The meeting was heard, but the underlying situation remains.", occurredOn: "2026-08-10",
    };
    dynamics.insertMeeting(teamMeeting);
    db.prepare(
      `INSERT INTO historical_events (id, occurred_on, event_type, involved_entities_json, title, data_json, importance, scope)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      "rsr-team-meeting-story", "2026-08-10", "TEAM_MEETING_RESULT",
      JSON.stringify([{ id: club.id, type: "club" }]), "Team meeting held",
      JSON.stringify({ context: "POOR_RUN", messageId: "focus-on-basics", outcome: "NEUTRAL", teamId: team.id, managerProfileId }),
      "low", "club",
    );

    // RELATIONSHIP: a real bounded score.
    dynamics.upsertRelationship({
      id: createStableEntityId("relationship", `${managerProfileId}:${players.meetingSubject}`),
      managerProfileId, personId: players.meetingSubject, score: 42, level: "STRONG", updatedOn: "2026-08-08",
    });

    expect(dynamics.concernsForTeam(team.id).length).toBeGreaterThanOrEqual(3);
  });

  it("persists every category identically across a real file close/reopen, with no duplicates", () => {
    const dynamics = new SquadDynamicsRepository(db);
    const transfers = new TransferMarketRepository(db);

    const before = {
      concerns: dynamics.concernsForTeam(team.id),
      demands: allPlayerIds.flatMap((id) => dynamics.demandsForPerson(id, team.id)),
      promises: allPlayerIds.flatMap((id) => dynamics.promisesForPerson(id, team.id)),
      request: transfers.transferRequests(players.transferRequest)[0],
      captaincyOverride: dynamics.captaincyOverride(team.id),
      reactionCount: dynamics.historyForPerson(players.captainB).filter((e) => e.eventType === "CAPTAINCY_REACTION").length,
      meeting: dynamics.meetingsForTeam(team.id).find((m) => m.id === "rsr-player-meeting" || m.type === "ONE_TO_ONE"),
      teamMeeting: dynamics.meetingsForTeam(team.id).find((m) => m.type === "SQUAD_MEETING"),
      relationship: dynamics.relationship(managerProfileId, players.meetingSubject),
      storyRow: db.prepare("SELECT * FROM historical_events WHERE id = 'rsr-team-meeting-story'").get(),
    };

    db.close();
    db = openGameDatabase(dbPath);
    const reloaded = new SquadDynamicsRepository(db);
    const reloadedTransfers = new TransferMarketRepository(db);

    const after = {
      concerns: reloaded.concernsForTeam(team.id),
      demands: allPlayerIds.flatMap((id) => reloaded.demandsForPerson(id, team.id)),
      promises: allPlayerIds.flatMap((id) => reloaded.promisesForPerson(id, team.id)),
      request: reloadedTransfers.transferRequests(players.transferRequest)[0],
      captaincyOverride: reloaded.captaincyOverride(team.id),
      reactionCount: reloaded.historyForPerson(players.captainB).filter((e) => e.eventType === "CAPTAINCY_REACTION").length,
      meeting: reloaded.meetingsForTeam(team.id).find((m) => m.id === "rsr-player-meeting" || m.type === "ONE_TO_ONE"),
      teamMeeting: reloaded.meetingsForTeam(team.id).find((m) => m.type === "SQUAD_MEETING"),
      relationship: reloaded.relationship(managerProfileId, players.meetingSubject),
      storyRow: db.prepare("SELECT * FROM historical_events WHERE id = 'rsr-team-meeting-story'").get(),
    };

    // CONCERNS — same ids/statuses, no duplicates.
    expect(after.concerns.map((c) => c.id).sort()).toEqual(before.concerns.map((c) => c.id).sort());
    expect(after.concerns.find((c) => c.personId === players.concernActive)?.status).toBe("ACTIVE");
    expect(after.concerns.find((c) => c.personId === players.concernEscalated)?.status).toBe("ESCALATED");
    // concernsForTeam only returns team-scoped rows; RESOLVED concern still
    // persists as a row, checked directly.
    expect(reloaded.concernById(createStableEntityId("concern", `rsr:${players.concernResolved}`))?.status).toBe("RESOLVED");

    // DEMANDS.
    expect(after.demands.map((d) => d.id).sort()).toEqual(before.demands.map((d) => d.id).sort());
    expect(reloaded.demandById(createStableEntityId("demand", `rsr:${players.demandOpen}`))?.status).toBe("OPEN");
    expect(reloaded.demandById(createStableEntityId("demand", `rsr:${players.demandAccepted}`))?.status).toBe("ACCEPTED");
    expect(reloaded.demandById(createStableEntityId("demand", `rsr:${players.demandRejected}`))?.status).toBe("REJECTED");
    expect(reloaded.demandById(createStableEntityId("demand", `rsr:${players.demandDeferred}`))?.status).toBe("DEFERRED");

    // PROMISES.
    expect(after.promises.map((p) => p.id).sort()).toEqual(before.promises.map((p) => p.id).sort());
    expect(reloaded.promiseById(createStableEntityId("promise", `rsr:${players.promiseActive}`))?.status).toBe("ACTIVE");
    expect(reloaded.promiseById(createStableEntityId("promise", `rsr:${players.promiseFulfilled}`))?.status).toBe("FULFILLED");
    expect(reloaded.promiseById(createStableEntityId("promise", `rsr:${players.promiseBroken}`))?.status).toBe("BROKEN");
    expect(reloaded.promiseById(createStableEntityId("promise", `rsr:${players.promiseExpired}`))?.status).toBe("EXPIRED");

    // TRANSFER REQUEST + real offer/club reference.
    expect(after.request?.id).toBe(before.request?.id);
    expect(after.request?.status).toBe("PENDING");
    const reloadedOffer = reloadedTransfers.transferOffers().find((o) => o.playerId === players.transferRequest);
    expect(reloadedOffer?.buyingClubId).toBe(foreignClub.id);
    expect(reloadedOffer?.status).toBe("NEGOTIATING");

    // CAPTAINCY — override + exactly one reaction, no reroll.
    expect(after.captaincyOverride).toEqual(before.captaincyOverride);
    expect(after.captaincyOverride?.captainPersonId).toBe(players.captainA);
    expect(after.captaincyOverride?.viceCaptainPersonId).toBe(players.captainB);
    expect(after.reactionCount).toBe(1);
    expect(after.reactionCount).toBe(before.reactionCount);

    // PLAYER MEETING — response/result/history all persisted.
    expect(after.meeting?.id).toBe(before.meeting?.id);
    expect(after.meeting?.outcome).toBe("POSITIVE");
    expect(after.meeting?.summary).toBe(before.meeting?.summary);

    // TEAM MEETING — context/message/result/date via its own story row.
    expect(after.teamMeeting?.id).toBe(before.teamMeeting?.id);
    expect(after.teamMeeting?.outcome).toBe("NEUTRAL");
    const storyData = JSON.parse((after.storyRow as { data_json: string }).data_json);
    expect(storyData.context).toBe("POOR_RUN");
    expect(storyData.messageId).toBe("focus-on-basics");

    // RELATIONSHIP — same score/state.
    expect(after.relationship?.score).toBe(before.relationship?.score);
    expect(after.relationship?.level).toBe(before.relationship?.level);

    // STORY — exact-once, same row, no duplicate.
    expect(after.storyRow).toEqual(before.storyRow);
    const storyCount = (
      db.prepare("SELECT COUNT(*) AS c FROM historical_events WHERE id = 'rsr-team-meeting-story'").get() as { c: number }
    ).c;
    expect(storyCount).toBe(1);
  });
});
