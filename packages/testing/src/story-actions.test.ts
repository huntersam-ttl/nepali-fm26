import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GovernmentRepository, OwnershipRepository, TransferMarketRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  buildStoryActions,
  createInfrastructureProject,
  createNepalSave,
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
