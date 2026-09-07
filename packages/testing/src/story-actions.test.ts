import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  CommercialRightsRepository,
  GovernmentRepository,
  OwnershipRepository,
  TransferMarketRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  acceptSponsorOffer,
  awardCommercialRightsForPresident,
  buildStoryActions,
  calculateCommercialRightsOffer,
  createInfrastructureProject,
  createNepalSave,
  ensureFederationMainPartnerPackage,
  generateSponsorOffers,
  initializeClubEconomyForSave,
  requestClubInfrastructureGovernmentSupport,
  resolveGovernmentInstitutionForClub,
  runChairmanDemo,
} from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId, type HistoricalEvent, type OwnershipAcquisitionOffer, type TransferOffer } from "@nepal-football-sim/shared-types";

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
