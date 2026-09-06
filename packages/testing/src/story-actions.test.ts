import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OwnershipRepository, TransferMarketRepository, openGameDatabase } from "@nepal-football-sim/database";
import { buildStoryActions, createNepalSave, runChairmanDemo } from "@nepal-football-sim/simulation";
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
