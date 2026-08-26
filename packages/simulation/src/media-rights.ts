import { createStableEntityId, type BroadcasterProfile, type EntityId, type FederationMediaRightsOffer, type FederationMediaRightsPackage } from "@nepal-football-sim/shared-types";
import { MediaRightsRepository, type GameDatabase } from "@nepal-football-sim/database";
import { postFederationTransaction } from "./federation-governance.js";

export type MediaRightsEvidence = { competitionReputation: number; nationalTeamRelevance: number; audience: number; sponsorValue: number; internationalInterest: number };
const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

export const calculateMediaRightsOffer = (input: { packageId: EntityId; federationId: EntityId; broadcaster: BroadcasterProfile; rightsPackage: FederationMediaRightsPackage; evidence: MediaRightsEvidence; offeredOn: string }): FederationMediaRightsOffer => {
  const domestic = input.rightsPackage.category === "INTERNATIONAL_STREAMING" ? input.broadcaster.internationalReach : input.broadcaster.domesticReach;
  const reachScore = clamp(input.broadcaster.marketReach * 0.45 + domestic * 0.35 + input.broadcaster.reliability * 0.2);
  const appeal = input.evidence.competitionReputation * 0.25 + input.evidence.nationalTeamRelevance * 0.15 + Math.min(100, input.evidence.audience / 100) * 0.25 + input.evidence.sponsorValue * 0.15 + input.evidence.internationalInterest * 0.2;
  const value = Math.min(4000000, Math.max(25000, Math.round(50000 + appeal * 3500 + input.broadcaster.financialStrength * 1200)));
  return { id:createStableEntityId("media-rights-offer", `${input.packageId}:${input.broadcaster.id}:${input.offeredOn}`), packageId:input.packageId, federationId:input.federationId, broadcasterId:input.broadcaster.id, value, reachScore, strategicControl:clamp(100 - input.broadcaster.marketReach * 0.4), productionQuality:clamp(input.broadcaster.productionCapability), status:"OFFERED", offeredOn:input.offeredOn, provenanceStatus:"SIMULATION_ONLY" };
};

export const createMediaRightsPackage = (db: GameDatabase, input: Omit<FederationMediaRightsPackage, "id" | "status" | "provenanceStatus">): FederationMediaRightsPackage => {
  const value: FederationMediaRightsPackage = { ...input, id:createStableEntityId("media-rights-package", `${input.federationId}:${input.category}:${input.name}`), status:"AVAILABLE", provenanceStatus:"SIMULATION_ONLY" };
  new MediaRightsRepository(db).upsertPackage(value); return value;
};

export const offerMediaRights = (db: GameDatabase, input: { rightsPackage: FederationMediaRightsPackage; broadcaster: BroadcasterProfile; evidence: MediaRightsEvidence; offeredOn: string }): FederationMediaRightsOffer => {
  if (input.rightsPackage.status !== "AVAILABLE" && input.rightsPackage.status !== "OFFERED") throw new Error("Media-rights package is not available");
  const offer=calculateMediaRightsOffer({ packageId:input.rightsPackage.id, federationId:input.rightsPackage.federationId, broadcaster:input.broadcaster, rightsPackage:input.rightsPackage, evidence:input.evidence, offeredOn:input.offeredOn });
  new MediaRightsRepository(db).upsertOffer(offer); new MediaRightsRepository(db).upsertPackage({ ...input.rightsPackage, status:"OFFERED" }); return offer;
};

/** Awarding is explicit: callers choose the offer and therefore no best-offer shortcut exists. */
export const awardMediaRights = (db: GameDatabase, input: { offerId: EntityId; date: string; startDate: string; endDate: string }): FederationMediaRightsOffer => {
  const repo=new MediaRightsRepository(db); const offer=repo.offers().find((item) => item.id === input.offerId); if (!offer || !["OFFERED", "NEGOTIATED"].includes(offer.status)) throw new Error("Media-rights offer is not awardable");
  const rightsPackage=repo.packages(offer.federationId).find((item) => item.id === offer.packageId); if (!rightsPackage) throw new Error("Media-rights package is missing");
  const ledger=postFederationTransaction(db,{ federationId:offer.federationId, date:input.date, category:rightsPackage.category === "DOMESTIC_STREAMING" || rightsPackage.category === "INTERNATIONAL_STREAMING" ? "STREAMING" : "BROADCASTING", direction:"CREDIT", amount:offer.value, description:`Media rights awarded: ${rightsPackage.name}`, relatedEntityId:offer.id, idempotencyKey:`media-rights-award:${offer.id}` });
  const active: FederationMediaRightsOffer={ ...offer, status:"ACTIVE", startDate:input.startDate, endDate:input.endDate, federationLedgerEntryId:ledger.id }; repo.upsertOffer(active); repo.upsertPackage({ ...rightsPackage, status:"ACTIVE" }); return active;
};

export const expireMediaRights = (db: GameDatabase, date: string): FederationMediaRightsOffer[] => { const repo=new MediaRightsRepository(db); const expired=repo.offers().filter((item) => item.status === "ACTIVE" && item.endDate && item.endDate < date); for (const offer of expired) repo.upsertOffer({ ...offer, status:"EXPIRED" }); return expired.map((offer) => ({ ...offer, status:"EXPIRED" as const })); };
