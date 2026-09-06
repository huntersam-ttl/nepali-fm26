import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OwnershipRepository, openGameDatabase } from "@nepal-football-sim/database";
import { buildStoryActions, createNepalSave, runChairmanDemo } from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId, type HistoricalEvent, type OwnershipAcquisitionOffer } from "@nepal-football-sim/shared-types";

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
