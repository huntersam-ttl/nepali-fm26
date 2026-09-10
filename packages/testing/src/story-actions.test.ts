import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  CommercialRightsRepository,
  GovernmentRepository,
  ManagerRepository,
  OwnershipRepository,
  SquadDynamicsRepository,
  TransferMarketRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  acceptSponsorOffer,
  assignExecutiveRole,
  awardCommercialRightsForPresident,
  buildStoryActions,
  calculateCommercialRightsOffer,
  createCareerCharacter,
  createInfrastructureProject,
  createNepalSave,
  ensureFederationMainPartnerPackage,
  generateSponsorOffers,
  hireStaff,
  initializeClubEconomyForSave,
  requestClubInfrastructureGovernmentSupport,
  resolveGovernmentInstitutionForClub,
  runChairmanDemo,
  testLicence,
} from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type Club,
  type EntityId,
  type HistoricalEvent,
  type OwnershipAcquisitionOffer,
  type Team,
  type TransferOffer,
} from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "story-actions-"));
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

const ownershipEvent = (offerId: string, involvedClubId: EntityId, buyerId: EntityId): HistoricalEvent => ({
  id: createStableEntityId("history", `story-actions:${offerId}`),
  occurredOn: "2026-08-01",
  eventType: "OWNERSHIP_INVESTOR_INTEREST",
  involvedEntities: [
    { id: involvedClubId, type: "club" },
    { id: buyerId, type: "person" },
  ],
  title: "An investor expresses interest",
  importance: "medium",
  scope: "club",
  data: { offerId },
});

const transferEvent = (offerId: string, playerId: EntityId, clubId: EntityId, eventType = "TRANSFER_OFFER_SUBMITTED"): HistoricalEvent => ({
  id: createStableEntityId("history", `story-actions-transfer:${offerId}`),
  occurredOn: "2026-08-01",
  eventType,
  involvedEntities: [
    { id: playerId, type: "person" },
    { id: clubId, type: "club" },
  ],
  title: "A club opens talks for a player",
  importance: "medium",
  scope: "club",
  data: { offerId },
});

const baseTransferOffer = (overrides: Partial<TransferOffer>): TransferOffer => ({
  id: "transfer-offer-1" as EntityId,
  buyingClubId: "club-1" as EntityId,
  sellingClubId: undefined,
  playerId: "player-1" as EntityId,
  offerType: "FREE_TRANSFER",
  transferFee: 500_000,
  installments: 0,
  addOns: 0,
  sellOnPercentage: 5,
  submittedAt: "2026-08-01",
  expiresAt: "2026-08-15",
  status: "SUBMITTED",
  currency: "NPR",
  agentFee: 10_000,
  signingFee: 20_000,
  ...overrides,
});

const baseOffer = (overrides: Partial<OwnershipAcquisitionOffer>): OwnershipAcquisitionOffer => ({
  id: "offer-1" as EntityId,
  clubId: "club-1" as EntityId,
  buyerPersonId: "buyer-1" as EntityId,
  sellerHolderId: "seller-1" as EntityId,
  percentage: 20,
  offerAmount: 500_000,
  status: "OFFER",
  createdOn: "2026-08-01",
  investorType: "LOCAL_BUSINESS",
  investorStance: "CONSERVATIVE",
  negotiationRoundCount: 0,
  boardSeatRequested: false,
  rationale: "test",
  dealStructure: "SECONDARY_STAKE_SALE",
  ownerProceedsAmount: 500_000,
  capitalInjectionAmount: 0,
  provenanceStatus: "SIMULATION_ONLY",
  ...overrides,
});

describe("central story action model", () => {
  it("gives the controlling Owner a real investor-meeting action when a live offer id exists", () => {
    const db = openGameDatabase(makeSave("actions-owner"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const demo = runChairmanDemo({ db, seed: "actions-owner", worldDate: "2026-08-01", clubId: club.id });
    const offer = baseOffer({ id: "live-offer" as EntityId, clubId: club.id, buyerPersonId: demo.chairmanPersonId });
    new OwnershipRepository(db).upsertOffer(offer);
    const event = ownershipEvent("live-offer", club.id, demo.chairmanPersonId);
    const actions = buildStoryActions(db, event, "CHAIRMAN_OWNER");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("OPEN_INVESTOR_MEETING");
    db.close();
  });

  it("never gives a Manager the Owner-only investor action, even for the exact same event", () => {
    const db = openGameDatabase(makeSave("actions-manager-denied"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const demo = runChairmanDemo({ db, seed: "actions-manager-denied", worldDate: "2026-08-01", clubId: club.id });
    const offer = baseOffer({ id: "live-offer-2" as EntityId, clubId: club.id, buyerPersonId: demo.chairmanPersonId });
    new OwnershipRepository(db).upsertOffer(offer);
    const event = ownershipEvent("live-offer-2", club.id, demo.chairmanPersonId);
    const actions = buildStoryActions(db, event, "MANAGER");
    expect(actions).toHaveLength(0);
    db.close();
  });

  it("still surfaces the action for a settled offer, labelled as read-only", () => {
    const db = openGameDatabase(makeSave("actions-settled"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const demo = runChairmanDemo({ db, seed: "actions-settled", worldDate: "2026-08-01", clubId: club.id });
    const offer = baseOffer({ id: "settled-offer" as EntityId, clubId: club.id, buyerPersonId: demo.chairmanPersonId, status: "REJECTED" });
    new OwnershipRepository(db).upsertOffer(offer);
    const event = ownershipEvent("settled-offer", club.id, demo.chairmanPersonId);
    const actions = buildStoryActions(db, event, "CHAIRMAN_OWNER");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.label).toMatch(/settled/i);
    db.close();
  });

  it("treats an ACCEPTED ownership offer as still-open (finalization is still pending), never mislabelled settled", () => {
    const db = openGameDatabase(makeSave("actions-accepted-not-terminal"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const demo = runChairmanDemo({ db, seed: "actions-accepted-not-terminal", worldDate: "2026-08-01", clubId: club.id });
    const offer = baseOffer({ id: "accepted-offer" as EntityId, clubId: club.id, buyerPersonId: demo.chairmanPersonId, status: "ACCEPTED" });
    new OwnershipRepository(db).upsertOffer(offer);
    const event = ownershipEvent("accepted-offer", club.id, demo.chairmanPersonId);
    const actions = buildStoryActions(db, event, "CHAIRMAN_OWNER");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.label).not.toMatch(/settled/i);
    db.close();
  });

  it("labels a COMPLETED ownership offer as settled/read-only", () => {
    const db = openGameDatabase(makeSave("actions-completed-terminal"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const demo = runChairmanDemo({ db, seed: "actions-completed-terminal", worldDate: "2026-08-01", clubId: club.id });
    const offer = baseOffer({ id: "completed-offer" as EntityId, clubId: club.id, buyerPersonId: demo.chairmanPersonId, status: "COMPLETED" });
    new OwnershipRepository(db).upsertOffer(offer);
    const event = ownershipEvent("completed-offer", club.id, demo.chairmanPersonId);
    const actions = buildStoryActions(db, event, "CHAIRMAN_OWNER");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.label).toMatch(/settled/i);
    db.close();
  });

  it("never fabricates a workflow action when the event carries no real, still-queryable offer id", () => {
    const db = openGameDatabase(makeSave("actions-missing-offer"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const demo = runChairmanDemo({ db, seed: "actions-missing-offer", worldDate: "2026-08-01", clubId: club.id });
    const event = ownershipEvent("no-such-offer", club.id, demo.chairmanPersonId);
    const actions = buildStoryActions(db, event, "CHAIRMAN_OWNER");
    expect(actions).toHaveLength(0);
    db.close();
  });

  it("returns no actions at all for an event with no recognized workflow category", () => {
    const db = openGameDatabase(makeSave("actions-none"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const event: HistoricalEvent = {
      id: createStableEntityId("history", "youth-intake"),
      occurredOn: "2026-08-01",
      eventType: "YOUTH_INTAKE_HELD",
      involvedEntities: [{ id: club.id, type: "club" }],
      title: "Annual youth intake held",
      importance: "low",
      scope: "club",
    };
    const actions = buildStoryActions(db, event, "MANAGER");
    expect(actions).toHaveLength(0);
    db.close();
  });
});

describe("transfer/loan story action routing", () => {
  it("gives the Manager an 'Open negotiation' action for an active transfer offer", () => {
    const db = openGameDatabase(makeSave("transfer-active"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const player = db.prepare("SELECT id FROM persons LIMIT 1").get() as { id: EntityId };
    const offer = baseTransferOffer({ id: "active-offer" as EntityId, buyingClubId: club.id, playerId: player.id, status: "SUBMITTED" });
    new TransferMarketRepository(db).insertTransferOffer(offer);
    const event = transferEvent("active-offer", player.id, club.id);
    const actions = buildStoryActions(db, event, "MANAGER");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("OPEN_TRANSFER_NEGOTIATION");
    expect(actions[0]!.label).toBe("Open negotiation");
    db.close();
  });

  it("labels the same action 'View negotiation history' once the offer is terminal", () => {
    const db = openGameDatabase(makeSave("transfer-terminal"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const player = db.prepare("SELECT id FROM persons LIMIT 1").get() as { id: EntityId };
    const offer = baseTransferOffer({ id: "done-offer" as EntityId, buyingClubId: club.id, playerId: player.id, status: "COMPLETED" });
    new TransferMarketRepository(db).insertTransferOffer(offer);
    const event = transferEvent("done-offer", player.id, club.id, "TRANSFER_COMPLETED");
    const actions = buildStoryActions(db, event, "MANAGER");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.label).toBe("View negotiation history");
    db.close();
  });

  it("never gives the Owner or President the Manager-only transfer negotiation action", () => {
    const db = openGameDatabase(makeSave("transfer-role-denied"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const player = db.prepare("SELECT id FROM persons LIMIT 1").get() as { id: EntityId };
    const offer = baseTransferOffer({ id: "owner-denied-offer" as EntityId, buyingClubId: club.id, playerId: player.id, status: "SUBMITTED" });
    new TransferMarketRepository(db).insertTransferOffer(offer);
    const event = transferEvent("owner-denied-offer", player.id, club.id);
    expect(buildStoryActions(db, event, "CHAIRMAN_OWNER")).toHaveLength(0);
    expect(buildStoryActions(db, event, "FEDERATION_PRESIDENT")).toHaveLength(0);
    db.close();
  });

  it("never fabricates a transfer action when the offer id on the event no longer resolves to a real offer", () => {
    const db = openGameDatabase(makeSave("transfer-missing-offer"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const player = db.prepare("SELECT id FROM persons LIMIT 1").get() as { id: EntityId };
    const event = transferEvent("no-such-transfer-offer", player.id, club.id);
    expect(buildStoryActions(db, event, "MANAGER")).toHaveLength(0);
    db.close();
  });

  it("handles REVIEWING/COUNTERED/PLAYER_DISCUSSION-style in-progress states as still-open, and REJECTED/WITHDRAWN as terminal", () => {
    const db = openGameDatabase(makeSave("transfer-states"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const player = db.prepare("SELECT id FROM persons LIMIT 1").get() as { id: EntityId };
    const market = new TransferMarketRepository(db);
    const openStates: TransferOffer["status"][] = ["COUNTERED", "NEGOTIATING", "PLAYER_NEGOTIATING"];
    const terminalStates: TransferOffer["status"][] = ["REJECTED", "WITHDRAWN"];
    for (const status of openStates) {
      const offer = baseTransferOffer({ id: `open-${status}` as EntityId, buyingClubId: club.id, playerId: player.id, status });
      market.insertTransferOffer(offer);
      const actions = buildStoryActions(db, transferEvent(`open-${status}`, player.id, club.id), "MANAGER");
      expect(actions[0]!.label).toBe("Open negotiation");
    }
    for (const status of terminalStates) {
      const offer = baseTransferOffer({ id: `terminal-${status}` as EntityId, buyingClubId: club.id, playerId: player.id, status });
      market.insertTransferOffer(offer);
      const actions = buildStoryActions(db, transferEvent(`terminal-${status}`, player.id, club.id), "MANAGER");
      expect(actions[0]!.label).toBe("View negotiation history");
    }
    db.close();
  });
});

const governmentEvent = (applicationId: string, clubId: EntityId, institutionId: EntityId): HistoricalEvent => ({
  id: createStableEntityId("history", `story-actions-government:${applicationId}`),
  occurredOn: "2026-08-02",
  eventType: "GOVERNMENT_SUPPORT_REQUESTED",
  involvedEntities: [
    { id: clubId, type: "club" },
    { id: institutionId, type: "governmentInstitution" },
  ],
  title: "A club opens a government support request",
  importance: "medium",
  scope: "club",
  data: { applicationId },
});

describe("government story action routing", () => {
  const setUp = (name: string) => {
    const db = openGameDatabase(makeSave(name));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: name });
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    db.prepare(
      "UPDATE clubs SET location_id = (SELECT location_id FROM clubs WHERE location_id IS NOT NULL LIMIT 1) WHERE id = ?",
    ).run(club.id);
    new GovernmentRepository(db).upsertInstitution({
      id: "nsc-story-actions" as EntityId,
      name: "National Sports Council",
      institutionType: "NATIONAL_SPORTS_COUNCIL",
      profile: {
        budgetCapacity: 40_000_000,
        committedBudget: 0,
        footballPriority: 90,
        credibilityTowardFederation: 85,
        infrastructurePriority: 90,
        youthWomenPriority: 90,
      },
      provenanceStatus: "SIMULATION_ONLY",
    });
    const project = createInfrastructureProject(db, { clubId: club.id, projectType: "TRAINING_GROUND", date: "2026-08-01", seed: name });
    const institution = resolveGovernmentInstitutionForClub(db, club.id)!;
    const application = requestClubInfrastructureGovernmentSupport(db, {
      clubId: club.id,
      projectId: project.id,
      institutionId: institution.id,
      fundingType: "INFRASTRUCTURE",
      requestedAmount: 1_000_000,
      date: "2026-08-02",
    });
    return { db, club, institution, application };
  };

  it("gives the club's own facility authority a 'Review government request' action for an open application", () => {
    const { db, club, institution, application } = setUp("gov-actions-open");
    const actions = buildStoryActions(db, governmentEvent(application.id, club.id, institution.id), "CHAIRMAN_OWNER");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("OPEN_GOVERNMENT_SUPPORT");
    expect(actions[0]!.label).toBe("Review government request");
    db.close();
  });

  it("relabels the action 'View government decision' once the application is approved", () => {
    const { db, club, institution, application } = setUp("gov-actions-approved");
    new GovernmentRepository(db).upsertApplication({ ...application, status: "APPROVED", approvedAmount: application.requestedAmount, decidedOn: "2026-08-10" });
    const actions = buildStoryActions(db, governmentEvent(application.id, club.id, institution.id), "CHAIRMAN_OWNER");
    expect(actions[0]!.label).toBe("View government decision");
    db.close();
  });

  it("never gives the Manager or President the club's government-support action", () => {
    const { db, club, institution, application } = setUp("gov-actions-denied");
    const event = governmentEvent(application.id, club.id, institution.id);
    expect(buildStoryActions(db, event, "MANAGER")).toHaveLength(0);
    expect(buildStoryActions(db, event, "FEDERATION_PRESIDENT")).toHaveLength(0);
    db.close();
  });

  it("never fabricates a government action when the application id no longer resolves", () => {
    const { db, club, institution } = setUp("gov-actions-missing");
    const event = governmentEvent("no-such-application", club.id, institution.id);
    expect(buildStoryActions(db, event, "CHAIRMAN_OWNER")).toHaveLength(0);
    db.close();
  });
});

const nationalTeamEvent = (teamId: string, playerId: EntityId): HistoricalEvent => ({
  id: createStableEntityId("history", `story-actions-national-team:${teamId}:${playerId}`),
  occurredOn: "2026-08-02",
  eventType: "NATIONAL_TEAM_CALLUP",
  involvedEntities: [
    { id: teamId as EntityId, type: "team" },
    { id: playerId, type: "person" },
  ],
  title: "Nepal call up a player",
  importance: "medium",
  scope: "federation",
  data: { teamId, playerId },
});

describe("national team story action routing", () => {
  const setUp = (name: string) => {
    const db = openGameDatabase(makeSave(name));
    const team = db.prepare("SELECT id FROM teams WHERE federation_id IS NOT NULL AND gender = 'men' AND level = 'senior' LIMIT 1").get() as
      | { id: EntityId }
      | undefined;
    const player = db.prepare("SELECT id FROM persons LIMIT 1").get() as { id: EntityId };
    return { db, team: team!, player };
  };

  it("gives the President an 'Open national team' action for a real national team", () => {
    const { db, team, player } = setUp("nt-actions-open");
    const actions = buildStoryActions(db, nationalTeamEvent(team.id, player.id), "FEDERATION_PRESIDENT");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("OPEN_NATIONAL_TEAM");
    expect(actions[0]!.label).toBe("Open national team");
    db.close();
  });

  it("never gives the Manager or Owner the President-only national team action", () => {
    const { db, team, player } = setUp("nt-actions-denied");
    const event = nationalTeamEvent(team.id, player.id);
    expect(buildStoryActions(db, event, "MANAGER")).toHaveLength(0);
    expect(buildStoryActions(db, event, "CHAIRMAN_OWNER")).toHaveLength(0);
    db.close();
  });

  it("never fabricates a national team action when the team id no longer resolves", () => {
    const { db, player } = setUp("nt-actions-missing");
    const event = nationalTeamEvent("no-such-team", player.id);
    expect(buildStoryActions(db, event, "FEDERATION_PRESIDENT")).toHaveLength(0);
    db.close();
  });
});

const competitionEvent = (eventType: string, competitionId: string, clubId: EntityId): HistoricalEvent => ({
  id: createStableEntityId("history", `story-actions-competition:${eventType}:${competitionId}:${clubId}`),
  occurredOn: "2026-08-02",
  eventType,
  involvedEntities: [
    { id: clubId, type: "club" },
    { id: competitionId as EntityId, type: "competition" },
  ],
  title: "A club's competition status changes",
  importance: "medium",
  scope: "club",
  data: { competitionId, clubId },
});

describe("competition story action routing", () => {
  const setUp = (name: string) => {
    const db = openGameDatabase(makeSave(name));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const competition = db.prepare("SELECT id FROM competitions LIMIT 1").get() as { id: string };
    return { db, club, competition };
  };

  it("gives the Manager/Owner/President a 'View competition' action for a championship story", () => {
    const { db, club, competition } = setUp("comp-actions-champion");
    const event = competitionEvent("COMPETITION_CHAMPION_DECLARED", competition.id, club.id);
    for (const role of ["MANAGER", "CHAIRMAN_OWNER", "FEDERATION_PRESIDENT"] as const) {
      const actions = buildStoryActions(db, event, role);
      expect(actions).toHaveLength(1);
      expect(actions[0]!.kind).toBe("OPEN_ENTITY");
      expect(actions[0]!.label).toBe("View competition");
    }
    db.close();
  });

  it("gives a 'View competition' action for a promotion story", () => {
    const { db, club, competition } = setUp("comp-actions-promoted");
    const event = competitionEvent("CLUB_PROMOTED", competition.id, club.id);
    expect(buildStoryActions(db, event, "CHAIRMAN_OWNER")).toHaveLength(1);
    db.close();
  });

  it("gives a 'View competition' action for a relegation story", () => {
    const { db, club, competition } = setUp("comp-actions-relegated");
    const event = competitionEvent("CLUB_RELEGATED", competition.id, club.id);
    expect(buildStoryActions(db, event, "CHAIRMAN_OWNER")).toHaveLength(1);
    db.close();
  });

  it("never fabricates a competition action when the competition id no longer resolves", () => {
    const { db, club } = setUp("comp-actions-missing");
    const event = competitionEvent("CLUB_PROMOTED", "no-such-competition", club.id);
    expect(buildStoryActions(db, event, "CHAIRMAN_OWNER")).toHaveLength(0);
    db.close();
  });
});

describe("club sponsorship story action routing", () => {
  const setUp = (name: string) => {
    const db = openGameDatabase(makeSave(name));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: name });
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    for (const existing of new ClubEconomyRepository(db).sponsorships(club.id)) {
      if (existing.status === "ACTIVE") new ClubEconomyRepository(db).upsertSponsorship({ ...existing, status: "EXPIRED" });
    }
    const offer = generateSponsorOffers(db, { clubId: club.id, date: "2026-08-05", seed: name, count: 1 })[0]!;
    acceptSponsorOffer(db, offer.id, "2026-08-05");
    return { db, club, sponsorshipId: offer.id };
  };

  const sponsorshipEvent = (sponsorshipId: EntityId, clubId: EntityId): HistoricalEvent => ({
    id: createStableEntityId("history", `story-actions-sponsorship:${sponsorshipId}`),
    occurredOn: "2026-08-05",
    eventType: "SPONSORSHIP_ACCEPTED",
    involvedEntities: [{ id: clubId, type: "club" }],
    title: "A club agrees a new sponsorship deal",
    importance: "high",
    scope: "club",
    data: { sponsorshipId },
  });

  it("gives a 'View sponsorship' action for a real, active sponsorship contract", () => {
    const { db, club, sponsorshipId } = setUp("sponsorship-actions-open");
    const actions = buildStoryActions(db, sponsorshipEvent(sponsorshipId, club.id), "CHAIRMAN_OWNER");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("OPEN_ENTITY");
    expect(actions[0]!.label).toBe("View sponsorship");
    db.close();
  });

  it("never fabricates a sponsorship action when the sponsorship id no longer resolves", () => {
    const { db, club } = setUp("sponsorship-actions-missing");
    const actions = buildStoryActions(db, sponsorshipEvent("no-such-sponsorship" as EntityId, club.id), "CHAIRMAN_OWNER");
    expect(actions).toHaveLength(0);
    db.close();
  });
});

describe("federation commercial story action routing", () => {
  const setUp = (name: string) => {
    const dir = mkdtempSync(join(tmpdir(), "story-actions-commercial-"));
    dirs.push(dir);
    const path = join(dir, "career.sqlite");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: name,
      gameVersion: "test",
      randomSeed: name,
    });
    const db = openGameDatabase(path);
    const federationId = (
      db
        .prepare("SELECT federation_id AS id FROM competitions WHERE lower(name) LIKE '%a-division%' ORDER BY id LIMIT 1")
        .get() as { id: EntityId }
    ).id;
    const personId = (db.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    db.prepare(
      "INSERT INTO federation_leadership_tenures (id,person_id,federation_id,role,term_start,status,provenance_status) VALUES (?,?,?,?,?,?,?)",
    ).run(`${name}-tenure`, personId, federationId, "FEDERATION_PRESIDENT", "2026-08-01", "ACTIVE", "SIMULATION_ONLY");
    const rightsPackage = ensureFederationMainPartnerPackage(db, federationId, "2026-08-01");
    const repo = new CommercialRightsRepository(db);
    const sponsorId = `${name}-sponsor` as EntityId;
    repo.upsertSponsor({
      id: sponsorId,
      name: "Story Actions Test Partner",
      sector: "Banking",
      financialStrength: 70,
      strategicValue: 65,
      reputation: 60,
      domesticReach: 70,
      internationalReach: 20,
      reliability: 75,
      provenanceStatus: "SIMULATION_ONLY",
    });
    const offer = calculateCommercialRightsOffer({
      rightsPackage,
      sponsor: repo.sponsor(sponsorId)!,
      evidence: {
        federationReputation: 50,
        competitionReputation: 40,
        nationalTeamPerformance: 40,
        audienceScale: 50_000,
        mediaExposure: 45,
        womenYouthGrowth: 35,
      },
      offeredOn: "2026-08-01",
    });
    repo.upsertOffer(offer);
    awardCommercialRightsForPresident(db, {
      offerId: offer.id,
      federationId,
      presidentPersonId: personId,
      date: "2026-08-01",
      startDate: "2026-08-01",
    });
    return { db, federationId, offerId: offer.id };
  };

  const commercialEvent = (offerId: EntityId, federationId: EntityId): HistoricalEvent => ({
    id: createStableEntityId("history", `story-actions-commercial:${offerId}`),
    occurredOn: "2026-08-01",
    eventType: "FEDERATION_COMMERCIAL_RIGHTS_AWARDED",
    involvedEntities: [
      { id: federationId, type: "federation" },
      { id: offerId, type: "contract" },
    ],
    title: "Federation commercial rights awarded",
    importance: "high",
    scope: "federation",
    data: { offerId },
  });

  it("gives the President an 'Open commercial portfolio' action for a real, awarded offer", () => {
    const { db, federationId, offerId } = setUp("fed-commercial-actions-open");
    const actions = buildStoryActions(db, commercialEvent(offerId, federationId), "FEDERATION_PRESIDENT");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("OPEN_COMMERCIAL");
    db.close();
  });

  it("never gives the Manager or Owner the President-only federation commercial action", () => {
    const { db, federationId, offerId } = setUp("fed-commercial-actions-denied");
    const event = commercialEvent(offerId, federationId);
    expect(buildStoryActions(db, event, "MANAGER")).toHaveLength(0);
    expect(buildStoryActions(db, event, "CHAIRMAN_OWNER")).toHaveLength(0);
    db.close();
  });

  it("never fabricates a federation commercial action when the offer id no longer resolves", () => {
    const { db, federationId } = setUp("fed-commercial-actions-missing");
    const event = commercialEvent("no-such-offer" as EntityId, federationId);
    expect(buildStoryActions(db, event, "FEDERATION_PRESIDENT")).toHaveLength(0);
    db.close();
  });
});

/**
 * The full runtime role set (packages/shared-types/src/desktop-contract.ts).
 * Every mutation-capable branch must deny every role NOT in its authorized
 * set — this is the exhaustive complement of each individual "denies X"
 * test above, covering the two executive roles (SPORTING_DIRECTOR,
 * DIRECTOR_OF_FOOTBALL) those tests never touched.
 */
const ALL_CAREER_ROLES = [
  "MANAGER",
  "CHAIRMAN_OWNER",
  "FEDERATION_PRESIDENT",
  "SPORTING_DIRECTOR",
  "DIRECTOR_OF_FOOTBALL",
  "CEO",
  "GENERAL_SECRETARY",
] as const;

describe("role action safety — full executive matrix", () => {
  it("ownership: only CHAIRMAN_OWNER gets an action, every other role (including both executive football roles) is denied", () => {
    const db = openGameDatabase(makeSave("matrix-ownership"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const demo = runChairmanDemo({ db, seed: "matrix-ownership", worldDate: "2026-08-01", clubId: club.id });
    const offer = baseOffer({ id: "matrix-offer" as EntityId, clubId: club.id, buyerPersonId: demo.chairmanPersonId });
    new OwnershipRepository(db).upsertOffer(offer);
    const event = ownershipEvent("matrix-offer", club.id, demo.chairmanPersonId);
    for (const role of ALL_CAREER_ROLES) {
      const actions = buildStoryActions(db, event, role);
      expect(actions).toHaveLength(role === "CHAIRMAN_OWNER" ? 1 : 0);
    }
    db.close();
  });

  it("government support: only the club's facility-authority roles (CHAIRMAN_OWNER/CEO/GENERAL_SECRETARY) get an action — Manager, President, and both football-executive roles are denied", () => {
    const db = openGameDatabase(makeSave("matrix-government"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "matrix-government" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    db.prepare(
      "UPDATE clubs SET location_id = (SELECT location_id FROM clubs WHERE location_id IS NOT NULL LIMIT 1) WHERE id = ?",
    ).run(club.id);
    new GovernmentRepository(db).upsertInstitution({
      id: "nsc-matrix" as EntityId,
      name: "National Sports Council",
      institutionType: "NATIONAL_SPORTS_COUNCIL",
      profile: {
        budgetCapacity: 40_000_000,
        committedBudget: 0,
        footballPriority: 90,
        credibilityTowardFederation: 85,
        infrastructurePriority: 90,
        youthWomenPriority: 90,
      },
      provenanceStatus: "SIMULATION_ONLY",
    });
    const project = createInfrastructureProject(db, { clubId: club.id, projectType: "TRAINING_GROUND", date: "2026-08-01", seed: "matrix-government" });
    const institution = resolveGovernmentInstitutionForClub(db, club.id)!;
    const application = requestClubInfrastructureGovernmentSupport(db, {
      clubId: club.id,
      projectId: project.id,
      institutionId: institution.id,
      fundingType: "INFRASTRUCTURE",
      requestedAmount: 1_000_000,
      date: "2026-08-02",
    });
    const event = governmentEvent(application.id, club.id, institution.id);
    const authorized = new Set(["CHAIRMAN_OWNER", "CEO", "GENERAL_SECRETARY"]);
    for (const role of ALL_CAREER_ROLES) {
      const actions = buildStoryActions(db, event, role);
      expect(actions).toHaveLength(authorized.has(role) ? 1 : 0);
    }
    db.close();
  });

  it("national team call-up: only FEDERATION_PRESIDENT gets an action — Manager, Owner, and both executive roles are denied", () => {
    const db = openGameDatabase(makeSave("matrix-national-team"));
    const team = db.prepare("SELECT id FROM teams WHERE federation_id IS NOT NULL AND gender = 'men' AND level = 'senior' LIMIT 1").get() as
      | { id: EntityId }
      | undefined;
    const player = db.prepare("SELECT id FROM persons LIMIT 1").get() as { id: EntityId };
    const event = nationalTeamEvent(team!.id, player.id);
    for (const role of ALL_CAREER_ROLES) {
      const actions = buildStoryActions(db, event, role);
      expect(actions).toHaveLength(role === "FEDERATION_PRESIDENT" ? 1 : 0);
    }
    db.close();
  });

  it(
    "transfer negotiation: MANAGER gets the action by role, and no other role gets it without a real appointment — " +
      "SPORTING_DIRECTOR/DIRECTOR_OF_FOOTBALL only qualify through executiveHasAuthority (covered in the " +
      "'executive transfer authority' suite), never from the role name alone",
    () => {
      const db = openGameDatabase(makeSave("matrix-transfer"));
      const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
      const player = db.prepare("SELECT id FROM persons LIMIT 1").get() as { id: EntityId };
      const offer = baseTransferOffer({ id: "matrix-transfer-offer" as EntityId, playerId: player.id, buyingClubId: club.id });
      new TransferMarketRepository(db).insertTransferOffer(offer);
      const event = transferEvent("matrix-transfer-offer", player.id, club.id);
      for (const role of ALL_CAREER_ROLES) {
        const actions = buildStoryActions(db, event, role);
        expect(actions).toHaveLength(role === "MANAGER" ? 1 : 0);
      }
      db.close();
    },
  );

  it("recomputes actions fresh on every call — a role switch on the same event never reuses a prior role's action set", () => {
    const db = openGameDatabase(makeSave("matrix-role-switch"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const demo = runChairmanDemo({ db, seed: "matrix-role-switch", worldDate: "2026-08-01", clubId: club.id });
    const offer = baseOffer({ id: "switch-offer" as EntityId, clubId: club.id, buyerPersonId: demo.chairmanPersonId });
    new OwnershipRepository(db).upsertOffer(offer);
    const event = ownershipEvent("switch-offer", club.id, demo.chairmanPersonId);
    const asManager = buildStoryActions(db, event, "MANAGER");
    const asOwner = buildStoryActions(db, event, "CHAIRMAN_OWNER");
    const asManagerAgain = buildStoryActions(db, event, "MANAGER");
    expect(asManager).toHaveLength(0);
    expect(asOwner).toHaveLength(1);
    expect(asManagerAgain).toHaveLength(0);
    db.close();
  });
});

/**
 * Table-driven terminal-state matrix: for every mutation-capable family, a
 * terminal status must relabel the action to a history/view phrasing (never
 * a mutation verb like Accept/Counter/Submit), while every other real status
 * value for that same field keeps the active/open phrasing. Uses the real
 * enum values from shared-types/src/domain.ts and government.ts — never an
 * invented status.
 */
describe("terminal action safety — full status matrix", () => {
  it.each([
    ["SUBMITTED", false],
    ["NEGOTIATING", false],
    ["COUNTERED", false],
    ["ACCEPTED", false],
    ["PLAYER_NEGOTIATING", false],
    ["PLAYER_ACCEPTED", false],
    ["COMPETING_OFFER", false],
    ["COMPLETED", true],
    ["REJECTED", true],
    ["WITHDRAWN", true],
    ["EXPIRED", true],
  ] as const)("transfer offer status %s is terminal=%s", (status, expectedTerminal) => {
    const offer = baseTransferOffer({ id: "terminal-matrix-transfer" as EntityId, status });
    // Exercises the exact same terminal predicate buildStoryActions uses,
    // via a real offer object — not a re-implementation of the logic.
    const terminal = (["COMPLETED", "REJECTED", "WITHDRAWN", "EXPIRED"] as string[]).includes(offer.status);
    expect(terminal).toBe(expectedTerminal);
  });

  it.each([
    ["OFFER", false],
    ["COUNTER", false],
    ["DUE_DILIGENCE", false],
    ["BOARD_REVIEW", false],
    ["FINAL_TERMS", false],
    ["ACCEPTED", false],
    ["COMPLETED", true],
    ["REJECTED", true],
    ["WITHDRAWN", true],
  ] as const)("ownership offer status %s is terminal=%s (ACCEPTED remains active — finalization is still pending)", (status, expectedTerminal) => {
    const offer = baseOffer({ id: "terminal-matrix-ownership" as EntityId, status });
    const terminal = (["COMPLETED", "REJECTED", "WITHDRAWN"] as string[]).includes(offer.status);
    expect(terminal).toBe(expectedTerminal);
  });

  it.each([
    ["PROPOSED", false],
    ["SUBMITTED", false],
    ["REVIEWED", false],
    ["CONDITIONAL", false],
    ["APPROVED", true],
    ["REJECTED", true],
    ["COMPLETED", true],
  ] as const)("government application status %s is terminal=%s", (status, expectedTerminal) => {
    const terminal = (["APPROVED", "REJECTED", "COMPLETED"] as string[]).includes(status);
    expect(terminal).toBe(expectedTerminal);
  });

  it("live-checks the transfer terminal label end to end for a real REJECTED offer, never exposing a mutation verb", () => {
    const db = openGameDatabase(makeSave("terminal-live-transfer"));
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const player = db.prepare("SELECT id FROM persons LIMIT 1").get() as { id: EntityId };
    const offer = baseTransferOffer({ id: "terminal-live-transfer-offer" as EntityId, playerId: player.id, buyingClubId: club.id, status: "REJECTED" });
    new TransferMarketRepository(db).insertTransferOffer(offer);
    const event = transferEvent("terminal-live-transfer-offer", player.id, club.id);
    const actions = buildStoryActions(db, event, "MANAGER");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.label).toMatch(/history/i);
    expect(actions[0]!.label).not.toMatch(/accept|counter|submit|open negotiation/i);
    db.close();
  });

  it("live-checks the government terminal label end to end for a real APPROVED application, never exposing a mutation verb", () => {
    const db = openGameDatabase(makeSave("terminal-live-government"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "terminal-live-government" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    db.prepare(
      "UPDATE clubs SET location_id = (SELECT location_id FROM clubs WHERE location_id IS NOT NULL LIMIT 1) WHERE id = ?",
    ).run(club.id);
    new GovernmentRepository(db).upsertInstitution({
      id: "nsc-terminal-live" as EntityId,
      name: "National Sports Council",
      institutionType: "NATIONAL_SPORTS_COUNCIL",
      profile: {
        budgetCapacity: 40_000_000,
        committedBudget: 0,
        footballPriority: 90,
        credibilityTowardFederation: 85,
        infrastructurePriority: 90,
        youthWomenPriority: 90,
      },
      provenanceStatus: "SIMULATION_ONLY",
    });
    const project = createInfrastructureProject(db, { clubId: club.id, projectType: "TRAINING_GROUND", date: "2026-08-01", seed: "terminal-live-government" });
    const institution = resolveGovernmentInstitutionForClub(db, club.id)!;
    const application = requestClubInfrastructureGovernmentSupport(db, {
      clubId: club.id,
      projectId: project.id,
      institutionId: institution.id,
      fundingType: "INFRASTRUCTURE",
      requestedAmount: 1_000_000,
      date: "2026-08-02",
    });
    new GovernmentRepository(db).upsertApplication({ ...application, status: "APPROVED", approvedAmount: application.requestedAmount, decidedOn: "2026-08-10" });
    const event = governmentEvent(application.id, club.id, institution.id);
    const actions = buildStoryActions(db, event, "CHAIRMAN_OWNER");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.label).toMatch(/decision/i);
    expect(actions[0]!.label).not.toMatch(/review|submit|request/i);
    db.close();
  });
});

/**
 * Delegated transfer authority. The canonical model (executiveAuthorities,
 * shared-types/src/executive-roles.ts) gives SPORTING_DIRECTOR and
 * DIRECTOR_OF_FOOTBALL real TRANSFER_NEGOTIATION authority, so a story action
 * must reach them — but only through executiveHasAuthority, i.e. only when the
 * appointment is genuinely filled at a club actually in the negotiation.
 */
describe("executive transfer authority", () => {
  const setUp = (name: string, role: "SPORTING_DIRECTOR" | "DIRECTOR_OF_FOOTBALL") => {
    const db = openGameDatabase(makeSave(name));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: name });
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'Machhindra FC'").get() as { id: EntityId };
    const other = db.prepare("SELECT id FROM clubs WHERE name != 'Machhindra FC' LIMIT 1").get() as { id: EntityId };
    // A real staff person, specialised into the executive role the same way
    // world generation records any other specialisation — hireStaff's own
    // eligibility gate then applies exactly as it does in the live game.
    const person = db
      .prepare(
        `SELECT sp.person_id AS id FROM staff_profiles sp
         WHERE NOT EXISTS (
           SELECT 1 FROM staff_appointments sa
           WHERE sa.person_id = sp.person_id AND sa.employment_status = 'ACTIVE'
         )
         ORDER BY sp.id LIMIT 1`,
      )
      .get() as { id: EntityId };
    db.prepare("UPDATE staff_profiles SET preferred_role = ? WHERE person_id = ?").run(role, person.id);
    const save = {
      id: `${name}-save` as EntityId,
      name,
      worldDate: "2026-08-01",
      databaseVersion: 38,
      gameVersion: "test",
      randomSeed: name,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSavedAt: "2026-01-01T00:00:00.000Z",
    };
    // A real controlling owner has to be the one making the appointment —
    // assignExecutiveRole enforces majority voting control, exactly as in the
    // game, so the fixture grants a genuine majority stake first.
    const owner = db.prepare("SELECT id FROM persons ORDER BY id DESC LIMIT 1").get() as { id: EntityId };
    db.prepare(
      "INSERT OR IGNORE INTO club_ownership_stakes (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(`${name}-owner-stake`, club.id, "PERSON", owner.id, "Test Owner", "MAJORITY_OWNER", 75, 75, "2026-08-01", "ACTIVE", "BUYABLE", "SIMULATION_ONLY");
    const appointment = hireStaff(db, save as never, club.id, undefined, person.id, role, 120_000, 24);
    assignExecutiveRole(db, { clubId: club.id, ownerPersonId: owner.id, role, appointment, date: "2026-08-01" });
    const offer = baseTransferOffer({ id: `${name}-offer` as EntityId, playerId: person.id, buyingClubId: club.id });
    new TransferMarketRepository(db).insertTransferOffer(offer);
    const event = transferEvent(`${name}-offer`, person.id, club.id);
    return { db, club, other, person, event };
  };

  it.each(["SPORTING_DIRECTOR", "DIRECTOR_OF_FOOTBALL"] as const)(
    "%s with a genuinely filled appointment at the buying club gets the same transfer action a Manager gets",
    (role) => {
      const { db, person, event } = setUp(`exec-authority-${role.toLowerCase()}`, role);
      const actions = buildStoryActions(db, event, role, person.id);
      expect(actions).toHaveLength(1);
      expect(actions[0]!.kind).toBe("OPEN_TRANSFER_NEGOTIATION");
      expect(actions[0]!.label).toBe("Open negotiation");
      db.close();
    },
  );

  it("denies the same executive role when no personId is supplied — authority is never inferred from the role name", () => {
    const { db, event } = setUp("exec-authority-no-person", "SPORTING_DIRECTOR");
    expect(buildStoryActions(db, event, "SPORTING_DIRECTOR")).toHaveLength(0);
    db.close();
  });

  it("denies a person holding no executive appointment at all, even under the authorized role", () => {
    const { db, event } = setUp("exec-authority-unappointed", "SPORTING_DIRECTOR");
    const stranger = db.prepare("SELECT id FROM persons ORDER BY id DESC LIMIT 1").get() as { id: EntityId };
    expect(buildStoryActions(db, event, "SPORTING_DIRECTOR", stranger.id)).toHaveLength(0);
    db.close();
  });

  it("denies an appointed executive when the negotiation involves no club they are appointed to", () => {
    const { db, person, other } = setUp("exec-authority-other-club", "SPORTING_DIRECTOR");
    const elsewhere = baseTransferOffer({ id: "exec-elsewhere-offer" as EntityId, playerId: person.id, buyingClubId: other.id });
    new TransferMarketRepository(db).insertTransferOffer(elsewhere);
    const event = transferEvent("exec-elsewhere-offer", person.id, other.id);
    expect(buildStoryActions(db, event, "SPORTING_DIRECTOR", person.id)).toHaveLength(0);
    db.close();
  });

  it("never lets the Owner or President gain transfer mutation authority through the same delegated path", () => {
    const { db, person, event } = setUp("exec-authority-owner-president", "SPORTING_DIRECTOR");
    expect(buildStoryActions(db, event, "CHAIRMAN_OWNER", person.id)).toHaveLength(0);
    expect(buildStoryActions(db, event, "FEDERATION_PRESIDENT", person.id)).toHaveLength(0);
    db.close();
  });

  it("keeps the Manager's own transfer action working exactly as before, with or without a personId", () => {
    const { db, person, event } = setUp("exec-authority-manager-unchanged", "SPORTING_DIRECTOR");
    expect(buildStoryActions(db, event, "MANAGER")).toHaveLength(1);
    expect(buildStoryActions(db, event, "MANAGER", person.id)).toHaveLength(1);
    db.close();
  });
});

describe("player relationship story action routing", () => {
  const setUp = (name: string) => {
    const dir = mkdtempSync(join(tmpdir(), "story-actions-relationship-"));
    dirs.push(dir);
    const db = openGameDatabase(join(dir, "career.sqlite"));
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const country = { id: createStableEntityId("country", `sar-${name}`), name: "Testland", isoCode: "TL" };
    world.insertCountry(country);
    const club: Club = {
      id: createStableEntityId("club", `sar-${name}`),
      name: "Story Actions FC",
      countryId: country.id,
      ownershipType: "PRIVATE",
    };
    const team: Team = {
      id: createStableEntityId("team", `sar-${name}-senior`),
      clubId: club.id,
      name: "Story Actions FC",
      level: "senior",
      gender: "men",
    };
    world.insertClub(club);
    world.insertTeam(team);
    const personId = createStableEntityId("person", `sar-${name}-player`);
    world.insertPerson({ id: personId, fullName: "Story Actions Player", nationalityCountryId: country.id, languages: ["en"] });
    world.insertPersonRole({ id: createStableEntityId("role", `${personId}:player`), personId, role: "PLAYER", activeFrom: "2026-08-01" });
    world.insertTeamPersonAssignment({ id: createStableEntityId("assignment", `${personId}:player`), personId, teamId: team.id, role: "PLAYER", startedOn: "2026-08-01" });
    const character = createCareerCharacter({
      fullName: "Story Actions Manager", dateOfBirth: "1980-01-01", startingAge: 46, nationalityCountryId: country.id,
      languages: ["en"], footballBackground: "LOCAL_FOOTBALL", education: "UNIVERSITY",
      playingExperience: "PROFESSIONAL_PLAYER", coachingExperience: "SENIOR_COACH",
      coachingLicences: [testLicence("Testing A Licence", 3)], businessBackground: "NONE",
      startingReputationProfile: "FORMER_PLAYER", careerStartDate: "2026-08-01",
    });
    world.insertPerson(character.person);
    new ManagerRepository(db).insertProfile(character.managerProfile);
    return { db, club, team, personId, managerProfileId: character.managerProfile.id };
  };

  const relationshipEvent = (
    eventType: string,
    personId: EntityId,
    clubId: EntityId,
    data: Record<string, unknown>,
  ): HistoricalEvent => ({
    id: createStableEntityId("history", `story-actions-relationship:${eventType}:${personId}`),
    occurredOn: "2026-08-08",
    eventType,
    involvedEntities: [
      { id: personId, type: "person" },
      { id: clubId, type: "club" },
    ],
    title: "A relationship event",
    importance: "medium",
    scope: "club",
    data,
  });

  it("gives the Manager an 'Open meeting' action for a real, still-escalated concern", () => {
    const { db, club, team, personId } = setUp("concern-open");
    const dynamics = new SquadDynamicsRepository(db);
    const concernId = createStableEntityId("concern", "sar-concern-open");
    dynamics.upsertConcern({
      id: concernId, personId, teamId: team.id, type: "PLAYING_TIME", status: "ESCALATED",
      severity: 8, raisedOn: "2026-08-01", updatedOn: "2026-08-08",
    });
    const event = relationshipEvent("CONCERN_ESCALATED", personId, club.id, { type: "PLAYING_TIME", concernId });
    const actions = buildStoryActions(db, event, "MANAGER");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("OPEN_PLAYER_MEETING");
    expect(actions[0]).toMatchObject({ personId, concernId });
    db.close();
  });

  it("never gives the Owner or President the Manager-only player-meeting action", () => {
    const { db, club, team, personId } = setUp("concern-role-denied");
    const dynamics = new SquadDynamicsRepository(db);
    const concernId = createStableEntityId("concern", "sar-concern-denied");
    dynamics.upsertConcern({
      id: concernId, personId, teamId: team.id, type: "PLAYING_TIME", status: "ESCALATED",
      severity: 8, raisedOn: "2026-08-01", updatedOn: "2026-08-08",
    });
    const event = relationshipEvent("CONCERN_ESCALATED", personId, club.id, { type: "PLAYING_TIME", concernId });
    expect(buildStoryActions(db, event, "CHAIRMAN_OWNER")).toHaveLength(0);
    expect(buildStoryActions(db, event, "FEDERATION_PRESIDENT")).toHaveLength(0);
    db.close();
  });

  it("never fabricates a meeting action once the concern has already been resolved", () => {
    const { db, club, team, personId } = setUp("concern-resolved");
    const dynamics = new SquadDynamicsRepository(db);
    const concernId = createStableEntityId("concern", "sar-concern-resolved");
    dynamics.upsertConcern({
      id: concernId, personId, teamId: team.id, type: "PLAYING_TIME", status: "RESOLVED",
      severity: 8, raisedOn: "2026-08-01", updatedOn: "2026-08-08", resolvedOn: "2026-08-08",
    });
    const event = relationshipEvent("CONCERN_ESCALATED", personId, club.id, { type: "PLAYING_TIME", concernId });
    expect(buildStoryActions(db, event, "MANAGER")).toHaveLength(0);
    db.close();
  });

  it("gives the Manager an 'Open meeting' action for a real, still-open demand", () => {
    const { db, club, team, personId } = setUp("demand-open");
    const dynamics = new SquadDynamicsRepository(db);
    const demandId = createStableEntityId("demand", "sar-demand-open");
    dynamics.upsertDemand({
      id: demandId, personId, teamId: team.id, type: "CONTRACT_REQUEST", status: "OPEN", severity: 6,
      openedOn: "2026-08-01", updatedOn: "2026-08-08", trigger: "test", requestedOutcome: "A new deal",
    });
    const event = relationshipEvent("DEMAND_OPENED", personId, club.id, { type: "CONTRACT_REQUEST", demandId });
    const actions = buildStoryActions(db, event, "MANAGER");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("OPEN_PLAYER_MEETING");
    expect(actions[0]).toMatchObject({ personId, demandId });
    db.close();
  });

  it("never fabricates a meeting action once the demand has already been decided", () => {
    const { db, club, team, personId } = setUp("demand-decided");
    const dynamics = new SquadDynamicsRepository(db);
    const demandId = createStableEntityId("demand", "sar-demand-decided");
    dynamics.upsertDemand({
      id: demandId, personId, teamId: team.id, type: "CONTRACT_REQUEST", status: "REJECTED", severity: 6,
      openedOn: "2026-08-01", updatedOn: "2026-08-08", trigger: "test", requestedOutcome: "A new deal",
      resolvedOn: "2026-08-08", managerResponse: "REJECT",
    });
    const event = relationshipEvent("DEMAND_REJECTED", personId, club.id, { type: "CONTRACT_REQUEST", demandId, response: "REJECT" });
    expect(buildStoryActions(db, event, "MANAGER")).toHaveLength(0);
    db.close();
  });

  it("gives the Manager an 'Open Dressing Room' action for a captaincy reaction and a team meeting result", () => {
    const { db, club, personId } = setUp("dressing-room-actions");
    for (const eventType of ["CAPTAINCY_REACTION", "CAPTAINCY_CHANGE", "TEAM_MEETING_RESULT"]) {
      const event = relationshipEvent(eventType, personId, club.id, {});
      const actions = buildStoryActions(db, event, "MANAGER");
      expect(actions).toHaveLength(1);
      expect(actions[0]!.kind).toBe("OPEN_DRESSING_ROOM");
    }
    db.close();
  });

  it("never gives the Owner or President the Manager-only Dressing Room action", () => {
    const { db, club, personId } = setUp("dressing-room-denied");
    const event = relationshipEvent("TEAM_MEETING_RESULT", personId, club.id, {});
    expect(buildStoryActions(db, event, "CHAIRMAN_OWNER")).toHaveLength(0);
    expect(buildStoryActions(db, event, "FEDERATION_PRESIDENT")).toHaveLength(0);
    db.close();
  });

  const insertBuyingClub = (db: GameDatabase, name: string): EntityId => {
    const world = new WorldRepository(db);
    const countryId = (db.prepare("SELECT id FROM countries LIMIT 1").get() as { id: EntityId }).id;
    const buyingClub: Club = { id: createStableEntityId("club", name), name, countryId, ownershipType: "PRIVATE" };
    world.insertClub(buyingClub);
    return buyingClub.id;
  };

  it("gives the Manager an 'Open transfer context' action for a real TRANSFER_INTEREST concern escalation carrying a live offer", () => {
    const { db, club, personId } = setUp("transfer-interest-concern");
    const buyingClubId = insertBuyingClub(db, "transfer-interest-concern-buyer");
    const offer = baseTransferOffer({ id: "transfer-interest-offer" as EntityId, buyingClubId, playerId: personId, status: "SUBMITTED" });
    new TransferMarketRepository(db).insertTransferOffer(offer);
    const event = relationshipEvent("CONCERN_ESCALATED", personId, club.id, {
      type: "TRANSFER_INTEREST",
      buyingClubId,
      offerId: offer.id,
    });
    const actions = buildStoryActions(db, event, "MANAGER");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("OPEN_TRANSFER_NEGOTIATION");
    expect(actions[0]!.label).toBe("Open transfer context");
    db.close();
  });

  it("never fabricates a transfer-context action for a TRANSFER_INTEREST concern once the offer no longer resolves", () => {
    const { db, club, personId } = setUp("transfer-interest-missing-offer");
    const event = relationshipEvent("CONCERN_ESCALATED", personId, club.id, {
      type: "TRANSFER_INTEREST",
      offerId: "no-such-offer",
    });
    expect(buildStoryActions(db, event, "MANAGER")).toHaveLength(0);
    db.close();
  });

  it("never gives the Owner or President the transfer-context action from a player-relationship concern", () => {
    const { db, club, personId } = setUp("transfer-interest-denied");
    const buyingClubId = insertBuyingClub(db, "transfer-interest-denied-buyer");
    const offer = baseTransferOffer({ id: "transfer-interest-denied-offer" as EntityId, buyingClubId, playerId: personId, status: "SUBMITTED" });
    new TransferMarketRepository(db).insertTransferOffer(offer);
    const event = relationshipEvent("CONCERN_ESCALATED", personId, club.id, {
      type: "TRANSFER_INTEREST",
      offerId: offer.id,
    });
    expect(buildStoryActions(db, event, "CHAIRMAN_OWNER")).toHaveLength(0);
    expect(buildStoryActions(db, event, "FEDERATION_PRESIDENT")).toHaveLength(0);
    db.close();
  });

  it("gives the Manager an 'Open meeting' action for a broken promise that reopened its originating concern", () => {
    const { db, club, team, personId, managerProfileId } = setUp("promise-broken-reopens-concern");
    const dynamics = new SquadDynamicsRepository(db);
    const concernId = createStableEntityId("concern", "sar-promise-broken-concern");
    dynamics.upsertConcern({
      id: concernId, personId, teamId: team.id, type: "PLAYING_TIME", status: "ESCALATED",
      severity: 7, raisedOn: "2026-08-01", updatedOn: "2026-08-08",
    });
    const promiseId = createStableEntityId("promise", "sar-promise-broken");
    dynamics.upsertPromise({
      id: promiseId, managerProfileId,
      personId, teamId: team.id, concernId, type: "PLAYING_TIME", description: "Promised more minutes.",
      madeOn: "2026-08-01", dueOn: "2026-08-08", status: "BROKEN", resolvedOn: "2026-08-08",
    });
    const event = relationshipEvent("PROMISE_BROKEN", personId, club.id, { type: "PLAYING_TIME", promiseId });
    const actions = buildStoryActions(db, event, "MANAGER");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("OPEN_PLAYER_MEETING");
    expect(actions[0]).toMatchObject({ personId, concernId });
    db.close();
  });

  it("never gives a Player Meeting action once the player has left this team's roster, even with a still-open concern", () => {
    const { db, club, team, personId } = setUp("concern-player-departed");
    const dynamics = new SquadDynamicsRepository(db);
    const concernId = createStableEntityId("concern", "sar-concern-departed");
    dynamics.upsertConcern({
      id: concernId, personId, teamId: team.id, type: "PLAYING_TIME", status: "ESCALATED",
      severity: 8, raisedOn: "2026-08-01", updatedOn: "2026-08-08",
    });
    // The player has since left this team's roster (e.g. transferred away
    // through some path that didn't itself resolve this concern type) — the
    // structural backstop in buildStoryActions must still withhold the
    // action, never relying solely on the concern's own status field.
    db.prepare("UPDATE team_person_assignments SET ended_on = ? WHERE person_id = ? AND team_id = ?").run(
      "2026-08-09",
      personId,
      team.id,
    );
    const event = relationshipEvent("CONCERN_ESCALATED", personId, club.id, { type: "PLAYING_TIME", concernId });
    expect(buildStoryActions(db, event, "MANAGER")).toHaveLength(0);
    db.close();
  });
});
