import {
  createStableEntityId,
  type EntityId,
  type FederationMediaRightsOffer,
  type HostingBid,
  type HostingEventType,
  type BroadcastDistributionModel,
  type FootballEconomySummary,
  type CompetitionMediaRights,
  type HostingEvent,
  type HostingBidReadModel,
} from "@nepal-football-sim/shared-types";
import {
  ClubEconomyRepository,
  FederationGovernanceRepository,
  HostingBidRepository,
  InternationalFootballRepository,
  MediaRightsRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { calculateMediaRightsOffer, offerMediaRights } from "./media-rights.js";
import { postClubTransaction } from "./club-economy.js";
import { createInternationalCompetitionEdition, advanceInternationalCompetition } from "./international-football.js";
import { isHostableCompetitionKey, type InternationalCompetitionKey } from "./international-competition-config.js";
import { EventRepository } from "@nepal-football-sim/database";

const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value));
const round = (value: number): number => Number(value.toFixed(3));

export const evaluateHostingBid = (input: {
  readiness: number;
  fundingPlan: number;
  governmentSupport: number;
  federationContribution: number;
  projectedBenefit: number;
  nationalDevelopment: number;
  reputation: number;
  organisationalCapacity: number;
}): { score: number; status: HostingBid["status"]; rationale: string[] } => {
  const score = round(
    clamp(
      input.readiness * 0.25 +
        input.fundingPlan * 0.2 +
        input.governmentSupport * 0.15 +
        input.federationContribution * 0.12 +
        input.projectedBenefit * 0.1 +
        input.nationalDevelopment * 0.1 +
        input.reputation * 0.04 +
        input.organisationalCapacity * 0.04,
    ),
  );
  return {
    score,
    status: score >= 70 ? "SHORTLISTED" : score >= 45 ? "SUBMITTED" : "PREPARING",
    rationale: [
      input.readiness >= 70 ? "facilities readiness" : undefined,
      input.fundingPlan >= 60 ? "funding plan" : undefined,
      input.governmentSupport >= 60 ? "government support" : undefined,
      input.nationalDevelopment >= 60 ? "national development benefit" : undefined,
    ].filter((item): item is string => Boolean(item)),
  };
};

export const createHostingBid = (
  db: GameDatabase,
  input: Omit<HostingBid, "id" | "status" | "provenanceStatus"> & { status?: HostingBid["status"] },
): HostingBid => {
  const bid: HostingBid = {
    ...input,
    id: createStableEntityId(
      "hosting-bid",
      `${input.federationId}:${input.eventType}:${input.eventName}:${input.proposedOn}`,
    ),
    status: input.status ?? "EXPLORING",
    provenanceStatus: "SIMULATION_ONLY",
  };
  new HostingBidRepository(db).upsert(bid);
  return bid;
};

export const hostingStatusAfterDecision = (
  current: HostingBid["status"],
  decision: Extract<
    HostingBid["status"],
    "SHORTLISTED" | "WON" | "LOST" | "WITHDRAWN" | "HOSTING" | "COMPLETED"
  >,
): HostingBid["status"] =>
  ["COMPLETED", "LOST", "WITHDRAWN"].includes(current) ? current : decision;

/** Resolves a bid once; later retries return the persisted terminal state. */
export const resolveHostingBid = (
  db: GameDatabase,
  input: {
    bidId: EntityId;
    date: string;
    decision: Extract<
      HostingBid["status"],
      "SHORTLISTED" | "WON" | "LOST" | "WITHDRAWN" | "HOSTING" | "COMPLETED"
    >;
  },
): HostingBid => {
  const repository = new HostingBidRepository(db);
  const bid = repository.bids().find((item) => item.id === input.bidId);
  if (!bid) throw new Error("Hosting bid not found");
  const resolved = {
    ...bid,
    status: hostingStatusAfterDecision(bid.status, input.decision),
    decisionDate: bid.decisionDate ?? input.date,
  };
  repository.upsert(resolved);
  return resolved;
};

const hostingCompetitionKey = (eventName: string): InternationalCompetitionKey | undefined => {
  const key = eventName.trim().toUpperCase().replaceAll(" ", "_");
  return isHostableCompetitionKey(key) ? (key as InternationalCompetitionKey) : undefined;
};

export const scheduleHostedCompetition = (
  db: GameDatabase,
  input: { bidId: EntityId; startDate: string; seed: string; venueIds?: EntityId[] },
): HostingEvent => {
  const bids = new HostingBidRepository(db);
  const bid = bids.bids().find((item) => item.id === input.bidId);
  if (!bid) throw new Error("Hosting bid not found");
  const existing = bids.eventByBid(input.bidId);
  if (existing) return existing;
  if (bid.status !== "WON") throw new Error("Only an awarded hosting bid can be scheduled");
  const key = hostingCompetitionKey(bid.eventName);
  if (!key) throw new Error("This hosting bid has no supported competition format");
  if (bid.readiness < 70 || bid.fundingPlan < 50)
    throw new Error("Hosting readiness and funding requirements are not met");
  const venueIds = input.venueIds ?? (bid.venueId ? [bid.venueId] : []);
  if (venueIds.length === 0) throw new Error("A supported hosted event requires a venue");
  const edition = createInternationalCompetitionEdition(db, {
    competitionKey: key,
    cycle: input.startDate.slice(0, 4),
    startDate: input.startDate,
    seed: `${input.seed}:edition`,
  });
  const country = db
    .prepare("SELECT country_id AS countryId FROM federations WHERE id=?")
    .get(bid.federationId) as { countryId?: EntityId } | undefined;
  if (country?.countryId) {
    const repo = new InternationalFootballRepository(db);
    repo.upsertEdition({ ...edition, hostCountryIds: [country.countryId] });
  }
  const event: HostingEvent = {
    id: createStableEntityId("hosting-event", input.bidId),
    bidId: input.bidId,
    federationId: bid.federationId,
    competitionKey: key,
    editionId: edition.id,
    startDate: edition.startDate,
    endDate: edition.endDate,
    venueIds,
    status: "SCHEDULED",
    provenanceStatus: "SIMULATION_ONLY",
  };
  bids.upsertEvent(event);
  return event;
};

export const advanceHostedCompetition = (
  db: GameDatabase,
  input: { eventId: EntityId; date: string; seed: string },
): HostingEvent => {
  const bids = new HostingBidRepository(db);
  const current = bids.event(input.eventId);
  if (!current) throw new Error("Hosted event not found");
  if (current.status === "COMPLETED" || current.status === "CANCELLED") return current;
  if (input.date < current.startDate) throw new Error("Hosted event is not ready to start");
  const active = { ...current, status: "ACTIVE" as const };
  bids.upsertEvent(active);
  advanceInternationalCompetition(db, current.editionId, `${input.seed}:event:${current.id}`);
  const completed: HostingEvent = { ...active, status: "COMPLETED", completedOn: input.date };
  bids.upsertEvent(completed);
  resolveHostingBid(db, { bidId: current.bidId, date: input.date, decision: "COMPLETED" });
  new EventRepository(db).insertHistoricalEvent({
    id: createStableEntityId("history", `HOSTING_COMPLETED:${current.id}`),
    occurredOn: input.date,
    eventType: "HOSTING_COMPLETED",
    involvedEntities: [{ id: current.federationId, type: "federation" }],
    title: "Hosted international competition completed",
    data: { bidId: current.bidId, editionId: current.editionId, competitionKey: current.competitionKey },
    importance: "high",
    scope: "federation",
  });
  return completed;
};

export const hostingBidReadModel = (
  db: GameDatabase,
  federationId: EntityId,
): HostingBidReadModel[] => {
  const repository = new HostingBidRepository(db);
  return repository.bids(federationId).map((bid) => {
    const event = repository.eventByBid(bid.id);
    return {
      bid,
      event,
      readiness: bid.readiness >= 70 ? "READY" : "NOT_READY",
      funding:
        bid.fundingPlan >= 80
          ? "FUNDED"
          : bid.fundingPlan > 0
            ? "PART_FUNDED"
            : "UNFUNDED",
      outcome: event?.status,
    };
  });
};

export const evaluateCompetitionBroadcastValue = (input: {
  competitionReputation: number;
  attendance: number;
  mediaInterest: number;
  clubReputation: number;
  nationalDevelopment: number;
  competitiveness: number;
  broadcasterStrength: number;
}): number =>
  Math.min(
    4200000,
    Math.max(
      25000,
      Math.round(
        50000 +
          input.competitionReputation * 11000 +
          Math.min(100, input.attendance / 100) * 7000 +
          input.mediaInterest * 7000 +
          input.clubReputation * 5000 +
          input.nationalDevelopment * 4000 +
          input.competitiveness * 4000 +
          input.broadcasterStrength * 2000,
      ),
    ),
  );

export const broadcastDistribution = (input: {
  total: number;
  clubIds: readonly EntityId[];
  model: BroadcastDistributionModel;
  meritOrder?: readonly EntityId[];
}): Record<string, number> => {
  const ids = [...input.clubIds];
  if (!ids.length) return {};
  const equal = input.total / ids.length;
  const merit = new Map(
    (input.meritOrder ?? ids).map((id, index) => [
      id,
      input.total * ((ids.length - index) / ((ids.length * (ids.length + 1)) / 2)),
    ]),
  );
  return Object.fromEntries(
    ids.map((id) => [
      id,
      Math.round(
        input.model === "EQUAL_SHARE"
          ? equal
          : input.model === "MERIT_SHARE"
            ? (merit.get(id) ?? 0)
            : equal * 0.7 + (merit.get(id) ?? 0) * 0.3,
      ),
    ]),
  );
};

/** Exact-once club settlement using the existing ledger idempotency key. */
export const settleBroadcastDistribution = (
  db: GameDatabase,
  input: {
    rights: CompetitionMediaRights;
    date: string;
    clubIds: readonly EntityId[];
    model?: BroadcastDistributionModel;
    meritOrder?: readonly EntityId[];
  },
): Record<string, number> => {
  const distribution = broadcastDistribution({
    total: input.rights.annualValue,
    clubIds: input.clubIds,
    model: input.model ?? input.rights.distributionModel ?? "EQUAL_SHARE",
    meritOrder: input.meritOrder,
  });
  for (const [clubId, amount] of Object.entries(distribution))
    if (amount > 0)
      postClubTransaction(db, {
        clubId: clubId as EntityId,
        date: input.date,
        category: "BROADCASTING",
        direction: "CREDIT",
        amount,
        description: `${input.rights.rightsPartner} broadcast distribution`,
        relatedEntityId: input.rights.id,
        idempotencyKey: `broadcast-distribution:${input.rights.id}:${clubId}`,
      });
  return distribution;
};

export const footballEconomySummary = (input: {
  federationId: EntityId;
  revenueTrend: number;
  attendanceTrend: number;
  sponsorshipTrend: number;
  wagePressure: number;
  transferActivity: number;
  infrastructureSpend: number;
  competitionReputationTrend: FootballEconomySummary["competitionReputationTrend"];
  asOf: string;
}): FootballEconomySummary => {
  const reputationAdjustment =
    input.competitionReputationTrend === "RISING"
      ? 10
      : input.competitionReputationTrend === "FALLING"
        ? -10
        : 0;
  const value =
    input.revenueTrend * 0.25 +
    input.attendanceTrend * 0.15 +
    input.sponsorshipTrend * 0.15 +
    input.transferActivity * 0.1 +
    input.infrastructureSpend * 0.1 +
    reputationAdjustment;
  const stress = input.wagePressure > 70 && input.revenueTrend < 45;
  return {
    federationId: input.federationId,
    trend: stress ? "STRESSED" : value >= 60 ? "GROWING" : value <= 35 ? "DECLINING" : "STABLE",
    drivers: [
      input.revenueTrend >= 60 ? "revenue growth" : undefined,
      input.attendanceTrend >= 60 ? "attendance growth" : undefined,
      input.wagePressure >= 70 ? "wage pressure" : undefined,
      input.infrastructureSpend >= 60 ? "infrastructure investment" : undefined,
    ].filter((item): item is string => Boolean(item)),
    competitionReputationTrend: input.competitionReputationTrend,
    asOf: input.asOf,
    provenanceStatus: "SIMULATION_ONLY",
  };
};
