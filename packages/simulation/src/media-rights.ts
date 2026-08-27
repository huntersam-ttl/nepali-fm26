import { createStableEntityId, type BroadcasterProfile, type EntityId, type FederationMediaRightsOffer, type FederationMediaRightsPackage } from "@nepal-football-sim/shared-types";
import { ClubEconomyRepository, MediaRightsRepository, type GameDatabase } from "@nepal-football-sim/database";
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

/** Production season hook for the existing federation broadcaster ledger. */
export const settleFederationMediaRightsForCompetition = (db: GameDatabase, input: { federationId: EntityId; competitionSeasonId: EntityId; date: string; seed: string }): FederationMediaRightsOffer | undefined => {
  const repo = new MediaRightsRepository(db);
  const existingPackage = repo.packages(input.federationId).find((item) => item.competitionId === input.competitionSeasonId);
  const existingOffer = existingPackage ? repo.offers(existingPackage.id)[0] : undefined;
  if (existingOffer?.status === "ACTIVE") return existingOffer;
  const broadcaster = repo.broadcasters()[0] ?? {
    id: createStableEntityId("broadcaster", "Himal Broadcast Network"),
    name: "Himal Broadcast Network",
    marketReach: 42,
    reliability: 78,
    financialStrength: 45,
    productionCapability: 48,
    domesticReach: 58,
    internationalReach: 18,
    provenanceStatus: "SIMULATION_ONLY" as const,
  };
  if (!repo.broadcaster(broadcaster.id)) repo.upsertBroadcaster(broadcaster);
  const clubs = db.prepare("SELECT club_id FROM club_memberships WHERE competition_season_id = ? AND status = 'ACTIVE' ORDER BY club_id").all(input.competitionSeasonId) as Array<{ club_id: EntityId }>;
  const audience = clubs.reduce((total, row) => total + (new ClubEconomyRepository(db).supporterProfile(row.club_id)?.coreSupporters ?? 0), 0);
  const rightsPackage = existingPackage ?? {
    id: createStableEntityId("media-rights-package", `${input.federationId}:competition:${input.competitionSeasonId}`),
    federationId: input.federationId,
    name: `Competition broadcast rights ${input.date.slice(0, 4)}`,
    category: "DOMESTIC_TV" as const,
    competitionId: input.competitionSeasonId,
    availableFrom: input.date,
    availableTo: addYears(input.date, 1),
    status: "AVAILABLE" as const,
    retainedByFederation: false,
    provenanceStatus: "SIMULATION_ONLY" as const,
  };
  if (!existingPackage) repo.upsertPackage(rightsPackage);
  const offer = existingOffer ?? calculateMediaRightsOffer({ packageId: rightsPackage.id, federationId: input.federationId, broadcaster, rightsPackage, evidence: { competitionReputation: Math.min(100, 35 + clubs.length * 2), nationalTeamRelevance: 35, audience, sponsorValue: 48, internationalInterest: 20 }, offeredOn: input.date });
  if (!existingOffer) repo.upsertOffer(offer);
  return awardMediaRights(db, { offerId: offer.id, date: input.date, startDate: input.date, endDate: rightsPackage.availableTo });
};

const addYears = (date: string, years: number): string => { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCFullYear(value.getUTCFullYear() + years); return value.toISOString().slice(0, 10); };
