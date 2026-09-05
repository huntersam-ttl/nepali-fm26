import {
  CareerWorldRepository,
  ClubEconomyRepository,
  GlobalFootballContextRepository,
  EventRepository,
  OwnershipRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type ClubOwnershipModel,
  type ClubOwnershipStake,
  type ClubValuationBreakdown,
  type CompletedOwnershipDeal,
  type EntityId,
  type OwnershipAcquisitionOffer,
  type OwnershipAcquisitionTransaction,
  type OwnershipBoardStance,
  type OwnershipDealStructure,
  type OwnershipInvestorBidView,
  type OwnershipInvestorMarketView,
  type OwnershipInvestorType,
  type OwnershipNegotiationPendingParty,
  type OwnershipNegotiationRound,
  type InvestorMeetingOverview,
  type HistoricalEvent,
  type Person,
} from "@nepal-football-sim/shared-types";
import { calculateClubValuation, investPersonalFunds } from "./club-economy.js";
import { applySupporterOwnershipOutcome } from "./supporter-culture.js";
import {
  MAX_NEGOTIATION_ROUNDS,
  evaluateInvestorCounter,
  investorStanceFor,
  stanceProfile,
} from "./ownership-investor-stance.js";

const status = "SIMULATION_ONLY" as const;
const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

/** A stable, deterministic [0,100) integer from a string key — used for
 * "roll" decisions that must be reproducible across reloads, never
 * Math.random. */
const hashString = (key: string): number => {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % 100;
};

const acquisitionValuationFactors = (db: GameDatabase, clubId: EntityId, date: string) => {
  const base = calculateClubValuation(db, clubId, date).valuation;
  const economy = new ClubEconomyRepository(db);
  const supporters = economy.supporterProfile(clubId);
  const commercial = economy.commercialProfile(clubId);
  const facility = economy.facilityProfile(clubId);
  const account = economy.financialAccount(clubId);
  const competitions = Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM club_memberships WHERE club_id = ? AND status IN ('ACTIVE','QUALIFIED','PROMOTED')",
        )
        .get(clubId) as { count?: number }
    )?.count ?? 0,
  );
  const supportValue =
    ((supporters?.coreSupporters ?? 0) +
      (supporters?.casualSupporters ?? 0) * 0.4 +
      (supporters?.diasporaSupport ?? 0) * 0.7) *
    40;
  const commercialValue =
    ((commercial?.brandStrength ?? 0) + (commercial?.digitalReach ?? 0)) * 80000;
  const facilityValue =
    ((facility?.trainingFacilityQuality ?? 0) +
      (facility?.youthFacilityQuality ?? 0) +
      (facility?.medicalFacilityQuality ?? 0)) *
    50000;
  const competitionValue = competitions * 100000;
  return {
    base,
    supportValue,
    commercialValue,
    facilityValue,
    competitionValue,
    debtBalance: account?.debtBalance ?? 0,
  };
};

export const calculateAcquisitionValuation = (db: GameDatabase, clubId: EntityId, date: string) => {
  const factors = acquisitionValuationFactors(db, clubId, date);
  return Math.max(
    250000,
    Math.round(
      factors.base + factors.supportValue + factors.commercialValue + factors.facilityValue + factors.competitionValue,
    ),
  );
};

/**
 * The richer, negotiation-facing counterpart to calculateAcquisitionValuation
 * — same underlying factors (financialFoundation already nets out debt, the
 * way calculateClubValuation always has), but exposed as a labelled
 * breakdown plus a negotiation range instead of one flat number, so the
 * ownership meeting can show a real range to argue over rather than a
 * single number either side must simply accept or reject.
 */
export const calculateAcquisitionValuationBreakdown = (
  db: GameDatabase,
  clubId: EntityId,
  date: string,
): ClubValuationBreakdown => {
  const factors = acquisitionValuationFactors(db, clubId, date);
  const midpoint = calculateAcquisitionValuation(db, clubId, date);
  return {
    clubId,
    currency: "NPR",
    midpoint,
    negotiationRange: { min: Math.round(midpoint * 0.85), max: Math.round(midpoint * 1.15) },
    factors: {
      financialFoundation: Math.round(factors.base),
      supporterBase: Math.round(factors.supportValue),
      commercialStrength: Math.round(factors.commercialValue),
      facilityQuality: Math.round(factors.facilityValue),
      competitionStanding: Math.round(factors.competitionValue),
      debtBurden: Math.round(factors.debtBalance),
    },
    provenanceStatus: "SIMULATION_ONLY",
  };
};

/**
 * A SIMULATION_ONLY due-diligence pass — findings derived strictly from real
 * persisted club state (debt, cash flow, sponsorship expiry, facility
 * strength), never fabricated. severity drives what the investor does next
 * in processDueOwnershipOffer: CLEAN/MINOR proceeds to board review,
 * CONCERNING makes the investor counter down or walk away.
 */
export type DueDiligenceFinding = {
  description: string;
  /** Percentage points knocked off (positive) or added to (negative) the
   * deal's valuation as a direct consequence of this finding. */
  valuationImpactPercent: number;
  /** How much this finding, on its own, pushes the investor toward walking
   * away — combined across findings and scaled by investor sensitivity. */
  walkAwayRisk: number;
};

export type DueDiligenceResult = {
  findings: DueDiligenceFinding[];
  severity: "CLEAN" | "MINOR" | "MODERATE" | "CONCERNING";
  /** Combined valuation adjustment across every finding — negative shrinks
   * the deal, positive (rare — a standout asset) can nudge it up slightly. */
  valuationAdjustmentPercent: number;
  walkAwayRisk: number;
};

/**
 * Every finding here is derived from real persisted club state and carries
 * a real consequence (valuation move and/or walk-away pressure) — never a
 * decorative line with no effect on the deal.
 */
export const runDueDiligence = (db: GameDatabase, clubId: EntityId, date: string): DueDiligenceResult => {
  const economy = new ClubEconomyRepository(db);
  const account = economy.financialAccount(clubId);
  const facility = economy.facilityProfile(clubId);
  const supporter = economy.supporterProfile(clubId);
  const stakes = economy.ownershipStakes(clubId).filter((stake) => stake.status === "ACTIVE");
  const club = db.prepare("SELECT ownership_type FROM clubs WHERE id = ?").get(clubId) as
    | { ownership_type?: string }
    | undefined;
  const findings: DueDiligenceFinding[] = [];

  if (account) {
    if (account.debtBalance > Math.max(account.cashBalance, 1) * 2) {
      findings.push({ description: "Club debt is high relative to cash reserves.", valuationImpactPercent: -8, walkAwayRisk: 0.2 });
    }
    if (account.cashBalance < Math.max(account.seasonExpenses, 1) * 0.1) {
      findings.push({ description: "Liquidity is thin — the club has little cash buffer against expenses.", valuationImpactPercent: -5, walkAwayRisk: 0.15 });
    }
    if (account.financialHealth === "DISTRESSED" || account.financialHealth === "INSOLVENT") {
      findings.push({ description: "Club finances are assessed as weak overall.", valuationImpactPercent: -10, walkAwayRisk: 0.25 });
    }
    if (account.seasonProfitLoss < 0) {
      findings.push({ description: "The club is currently running at a loss this season.", valuationImpactPercent: -4, walkAwayRisk: 0.05 });
    } else if (account.seasonProfitLoss > 0) {
      findings.push({ description: "The club is currently profitable this season.", valuationImpactPercent: 3, walkAwayRisk: 0 });
    }
  }

  const wageBudget = economy.budgets(clubId).find((budget) => budget.category === "WAGE_BUDGET" && budget.status === "ACTIVE");
  if (wageBudget && wageBudget.amount > 0 && wageBudget.usedAmount / wageBudget.amount >= 0.95) {
    findings.push({ description: "The wage budget is fully committed, leaving little room to manoeuvre.", valuationImpactPercent: -3, walkAwayRisk: 0.05 });
  }

  const expiringSponsorships = economy
    .sponsorships(clubId)
    .filter((deal) => deal.status === "ACTIVE" && deal.endDate <= daysAfter(date, 90));
  if (expiringSponsorships.length > 0) {
    findings.push({
      description: `${expiringSponsorships.length} sponsorship deal(s) expire within 90 days.`,
      valuationImpactPercent: -3 * expiringSponsorships.length,
      walkAwayRisk: 0.05,
    });
  }

  const activeProjects = economy
    .infrastructureProjects(clubId)
    .filter((project) => ["PLANNING", "APPROVED", "FINANCING", "CONSTRUCTION"].includes(project.status));
  if (activeProjects.length > 0) {
    findings.push({
      description: `${activeProjects.length} infrastructure commitment(s) already in progress will need continued funding.`,
      valuationImpactPercent: -2 * activeProjects.length,
      walkAwayRisk: 0.05,
    });
  }

  if (facility && (facility.youthFacilityQuality ?? 0) >= 14) {
    findings.push({ description: "The academy is a valuable, well-regarded asset.", valuationImpactPercent: 5, walkAwayRisk: 0 });
  }

  if (["DEPARTMENTAL", "MUNICIPALITY_BACKED", "STATE_CONTROLLED"].includes(club?.ownership_type ?? "")) {
    findings.push({ description: "The club carries government/municipal-backed exposure, which can complicate private control.", valuationImpactPercent: -4, walkAwayRisk: 0.15 });
  }

  const dominant = stakes.find((stake) => (stake.percentage ?? 0) >= 90);
  if (dominant) {
    findings.push({ description: "Ownership is heavily concentrated in a single existing holder.", valuationImpactPercent: 0, walkAwayRisk: 0.05 });
  }

  if (supporter && supporter.footballReputation < 20) {
    findings.push({ description: "The club's football reputation is currently low.", valuationImpactPercent: -3, walkAwayRisk: 0.05 });
  } else if (supporter && supporter.footballReputation >= 60) {
    findings.push({ description: "The club carries strong football reputation.", valuationImpactPercent: 4, walkAwayRisk: 0 });
  }

  if (findings.length === 0) {
    findings.push({ description: "No material concerns were found.", valuationImpactPercent: 0, walkAwayRisk: 0 });
  }

  const valuationAdjustmentPercent = findings.reduce((sum, finding) => sum + finding.valuationImpactPercent, 0);
  const walkAwayRisk = Math.min(0.95, findings.reduce((sum, finding) => sum + finding.walkAwayRisk, 0));
  const negativeCount = findings.filter((finding) => finding.valuationImpactPercent < 0 || finding.walkAwayRisk > 0).length;
  const severity: DueDiligenceResult["severity"] =
    negativeCount >= 3 || walkAwayRisk >= 0.4
      ? "CONCERNING"
      : negativeCount === 2 || walkAwayRisk >= 0.2
        ? "MODERATE"
        : negativeCount === 1
          ? "MINOR"
          : "CLEAN";
  return { findings, severity, valuationAdjustmentPercent, walkAwayRisk };
};

/** Minority / significant-minority / blocking / controlling — the real
 * governance consequence of a stake size, given the club's own majority
 * threshold. Purely descriptive: it does not invent legal mechanics beyond
 * what the existing ownership model (majority = 51%+) already implies. */
export const describeOwnershipControl = (
  percentage: number,
  majorityThreshold = 51,
): { label: string; detail: string } => {
  if (percentage >= majorityThreshold) {
    return { label: "Controlling stake", detail: "Would take majority control of the club." };
  }
  if (percentage >= 25) {
    return {
      label: "Significant minority",
      detail: "Large enough to influence major decisions without controlling them.",
    };
  }
  if (percentage >= 10) {
    return { label: "Minority investor", detail: "A meaningful stake, but no special influence." };
  }
  return { label: "Small minority", detail: "A limited financial interest with no real influence." };
};

const ownershipRespondByDate = (worldDate: string, stage: "DUE_DILIGENCE" | "BOARD_REVIEW" | "FINAL_TERMS" | "INVESTOR_REVIEW"): string =>
  daysAfter(
    worldDate,
    stage === "DUE_DILIGENCE" ? 3 : stage === "BOARD_REVIEW" ? 2 : stage === "FINAL_TERMS" ? 2 : 2,
  );

const insertOwnershipRound = (
  db: GameDatabase,
  input: { offerId: EntityId; actor: OwnershipNegotiationRound["actor"]; action: OwnershipNegotiationRound["action"]; message: string; date: string },
): void => {
  const repo = new OwnershipRepository(db);
  const roundNumber = repo.negotiationRounds(input.offerId).length + 1;
  repo.insertNegotiationRound({
    id: createStableEntityId("ownership-negotiation-round", `${input.offerId}:${roundNumber}`),
    offerId: input.offerId,
    roundNumber,
    actor: input.actor,
    action: input.action,
    message: input.message,
    createdAt: input.date,
  });
};

const insertOwnershipStoryEvent = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    buyerPersonId: EntityId;
    eventType: string;
    title: string;
    date: string;
    data?: Record<string, unknown>;
    importance?: HistoricalEvent["importance"];
    /** Disambiguates repeat events of the same type for the same club/
     * investor/date — e.g. an offer id plus round count, so a multi-round
     * negotiation that fires the same event type twice in one simulated
     * day doesn't collide on a duplicate history-row id. */
    dedupeKey?: string;
  },
): void => {
  new EventRepository(db).insertHistoricalEvent({
    id: createStableEntityId(
      "history",
      `${input.eventType}:${input.clubId}:${input.buyerPersonId}:${input.date}:${input.dedupeKey ?? ""}`,
    ),
    occurredOn: input.date,
    eventType: input.eventType,
    involvedEntities: [
      { id: input.clubId, type: "club" },
      { id: input.buyerPersonId, type: "person" },
    ],
    title: input.title,
    data: input.data,
    importance: input.importance ?? "medium",
    scope: "club",
  });
};

/** The last ownership/investor story beats for this club, drawn from the
 * same canonical historical-event log every other system writes to — not a
 * second event feed. */
export const ownershipStoryFeed = (
  db: GameDatabase,
  clubId: EntityId,
  limit = 15,
): HistoricalEvent[] =>
  new EventRepository(db)
    .historicalEvents()
    .filter(
      (event) =>
        event.eventType.startsWith("OWNERSHIP_") &&
        event.involvedEntities.some((entity) => entity.type === "club" && entity.id === clubId),
    )
    .slice(-limit)
    .reverse();

const investorTypeFor = (sequence: number): OwnershipInvestorType =>
  (["LOCAL_BUSINESS", "STRATEGIC_COMPANY", "WEALTHY_INDIVIDUAL", "INSTITUTIONAL"] as const)[sequence % 4];

const investorNameFor = (db: GameDatabase, personId: EntityId): string => {
  const person = db.prepare("SELECT display_name,full_name FROM persons WHERE id=?").get(personId) as { display_name?: string; full_name?: string } | undefined;
  return person?.display_name ?? person?.full_name ?? personId;
};

const OPEN_BID_STATUSES = ["OFFER", "COUNTER", "DUE_DILIGENCE", "BOARD_REVIEW", "FINAL_TERMS"] as const;
const DECIDED_OR_OPEN_BID_STATUSES = [...OPEN_BID_STATUSES, "ACCEPTED", "COMPLETED", "REJECTED", "WITHDRAWN"] as const;

export const buildOwnershipInvestorMarket = (db: GameDatabase, clubId: EntityId, date?: string): OwnershipInvestorMarketView => {
  const repo = new OwnershipRepository(db);
  const ownership = new ClubEconomyRepository(db).ownershipStakes(clubId);
  const active = ownership.filter((stake) => stake.status === "ACTIVE");
  const open = repo.offers(clubId).filter((offer) => (OPEN_BID_STATUSES as readonly string[]).includes(offer.status));
  const bids: OwnershipInvestorBidView[] = repo
    .offers(clubId)
    .filter((offer) => offer.sellerHolderId && (DECIDED_OR_OPEN_BID_STATUSES as readonly string[]).includes(offer.status))
    .map((offer) => ({
      offer,
      investorName: investorNameFor(db, offer.buyerPersonId),
      investorType: offer.investorType ?? investorTypeFor(0),
      impliedValuation: Math.round((offer.counterAmount ?? offer.offerAmount) * 100 / Math.max(offer.percentage, 0.01)),
      negotiation: repo.negotiationRounds(offer.id),
      simulationOnly: true,
    }));
  const controller = active.filter((stake) => (stake.percentage ?? 0) >= 51).sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))[0];
  return { valuation: calculateAcquisitionValuation(db, clubId, date ?? new Date().toISOString().slice(0, 10)), ownership, controllingOwnerId: controller?.holderId, openOffer: open[0], bids, provenanceStatus: "SIMULATION_ONLY" };
};

/**
 * Read model behind the investor-meeting UI. Ownership decisions carry no
 * delegable executive authority (see ExecutiveAuthority) so this is owner-
 * only by construction — market is the exact OwnershipInvestorMarketView the
 * owner dashboard already renders, plus the owner's own personal cash and
 * the majority threshold, so neither number is ever hardcoded client-side.
 */
export const investorMeetingOverview = (
  db: GameDatabase,
  clubId: EntityId,
  ownerPersonId: EntityId,
  date: string,
): InvestorMeetingOverview => {
  const club = db.prepare("SELECT name FROM clubs WHERE id=?").get(clubId) as { name?: string } | undefined;
  if (!club?.name) throw new Error(`Club not found: ${clubId}`);
  const personal = new ClubEconomyRepository(db).personalFinancialProfile(ownerPersonId);
  return {
    clubId,
    clubName: club.name,
    ownerPersonId,
    ownerPersonalCash: personal?.cash ?? 0,
    majorityThreshold: 51,
    worldDate: date,
    market: buildOwnershipInvestorMarket(db, clubId, date),
    valuation: calculateAcquisitionValuationBreakdown(db, clubId, date),
    recentActivity: ownershipStoryFeed(db, clubId).map((event) => ({
      occurredOn: event.occurredOn,
      title: event.title,
      eventType: event.eventType,
    })),
    completedDeals: completedOwnershipDeals(db, clubId),
  };
};

/** Ownership-history entries built strictly from the real, persisted
 * offer/transaction records — never a separately maintained summary. */
const completedOwnershipDeals = (db: GameDatabase, clubId: EntityId): CompletedOwnershipDeal[] => {
  const repo = new OwnershipRepository(db);
  const transactionsByOffer = new Map(repo.transactions(clubId).map((transaction) => [transaction.offerId, transaction]));
  return repo
    .offers(clubId)
    .filter((offer) => offer.sellerHolderId && ["COMPLETED", "REJECTED", "WITHDRAWN"].includes(offer.status))
    .map((offer) => {
      const transaction = transactionsByOffer.get(offer.id);
      const amount = transaction?.amount ?? offer.counterAmount ?? offer.offerAmount;
      return {
        offerId: offer.id,
        clubId: offer.clubId,
        investorPersonId: offer.buyerPersonId,
        investorName: investorNameFor(db, offer.buyerPersonId),
        dealStructure: offer.dealStructure,
        date: offer.decidedOn ?? offer.createdOn,
        percentage: offer.percentage,
        amount,
        ownerProceedsAmount: offer.ownerProceedsAmount ?? (offer.dealStructure === "PRIMARY_CAPITAL_INJECTION" ? 0 : amount),
        capitalInjectionAmount: offer.capitalInjectionAmount ?? (offer.dealStructure === "PRIMARY_CAPITAL_INJECTION" ? amount : 0),
        impliedValuation: Math.round((amount * 100) / Math.max(offer.percentage, 0.01)),
        outcome: offer.status as "COMPLETED" | "REJECTED" | "WITHDRAWN",
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
};

export const createInvestorStakeOffer = (db: GameDatabase, input: { clubId: EntityId; sellerHolderId: EntityId; percentage: number; minimumAmount?: number; date: string }): OwnershipInvestorMarketView => {
  if (input.percentage <= 0 || input.percentage > 100) throw new Error("Stake offered must be greater than 0 and no more than 100%.");
  const seller = new ClubEconomyRepository(db).ownershipStakes(input.clubId).find((stake) => stake.holderId === input.sellerHolderId && stake.status === "ACTIVE");
  if (!seller || (seller.percentage ?? 0) < input.percentage) throw new Error("Stake offered exceeds the seller's active ownership.");
  const valuation = calculateAcquisitionValuation(db, input.clubId, input.date);
  const minimum = Math.max(1, Math.round(input.minimumAmount ?? valuation * input.percentage / 100 * 0.85));
  const repo = new OwnershipRepository(db);
  const existing = repo.offers(input.clubId).filter((offer) => offer.sellerHolderId === input.sellerHolderId && offer.percentage === input.percentage && (OPEN_BID_STATUSES as readonly string[]).includes(offer.status));
  if (existing.length === 0) {
    for (let sequence = 0; sequence < 3; sequence += 1) {
      const buyerPersonId = generateOwnershipCandidate(db, input.clubId, input.date, valuation, sequence);
      const multiplier = 0.92 + sequence * 0.05;
      const amount = Math.max(minimum, Math.round(valuation * input.percentage / 100 * multiplier));
      const investorType = investorTypeFor(sequence);
      // The third simulated bidder proposes fresh capital into the club
      // (diluting existing holders) rather than paying the seller directly
      // — a distinct deal structure with a distinct money flow, not a
      // cosmetic variant of the other two.
      const dealStructure: OwnershipDealStructure = sequence === 2 ? "PRIMARY_CAPITAL_INJECTION" : "SECONDARY_STAKE_SALE";
      const offerId = createStableEntityId("ownership-investor-bid", `${input.clubId}:${input.sellerHolderId}:${input.percentage}:${sequence}`);
      const investorStance = investorStanceFor(offerId);
      const profile = stanceProfile(investorStance);
      repo.upsertOffer({
        id: offerId,
        clubId: input.clubId,
        buyerPersonId,
        sellerHolderId: input.sellerHolderId,
        percentage: input.percentage,
        offerAmount: amount,
        status: "OFFER",
        createdOn: input.date,
        investorType,
        investorStance,
        negotiationRoundCount: 0,
        boardSeatRequested: profile.boardSeatLikely && input.percentage >= 25,
        rationale: `Simulation bid from ${investorType.replaceAll("_", " ").toLowerCase()} investor.`,
        dealStructure,
        ownerProceedsAmount: dealStructure === "SECONDARY_STAKE_SALE" ? amount : 0,
        capitalInjectionAmount: dealStructure === "PRIMARY_CAPITAL_INJECTION" ? amount : 0,
        provenanceStatus: status,
      });
      insertOwnershipRound(db, {
        offerId,
        actor: "INVESTOR",
        action: "OFFER",
        message:
          (dealStructure === "PRIMARY_CAPITAL_INJECTION"
            ? `Proposes ${amount.toLocaleString()} NPR as fresh capital into the club for ${input.percentage}% (existing holders diluted).`
            : `Proposes ${amount.toLocaleString()} NPR paid directly to the selling owner for ${input.percentage}%.`) +
          ` (${profile.description}${profile.boardSeatLikely && input.percentage >= 25 ? ", requesting a board seat" : ""})`,
        date: input.date,
      });
    }
    insertOwnershipStoryEvent(db, {
      clubId: input.clubId,
      buyerPersonId: input.sellerHolderId,
      eventType: "OWNERSHIP_INVESTOR_INTEREST",
      title: "Investor interest emerges",
      date: input.date,
      data: { percentage: input.percentage },
      dedupeKey: `${input.percentage}`,
    });
  }
  return buildOwnershipInvestorMarket(db, input.clubId);
};

/**
 * The owner's first response to a bid — no longer settles in the same
 * call. Accepting opens due diligence (a real multi-day stage, see
 * processDueOwnershipOffer) instead of moving money and ownership
 * immediately; rejecting is still final and immediate, since there is
 * nothing further to negotiate once the owner has said no outright.
 */
export const decideInvestorBid = (db: GameDatabase, input: { offerId: EntityId; date: string; accept: boolean }): OwnershipAcquisitionOffer => {
  const repo = new OwnershipRepository(db);
  const current = repo.offer(input.offerId);
  if (!current || !current.sellerHolderId || !["OFFER", "COUNTER"].includes(current.status)) throw new Error("Investor bid is no longer open.");
  if (!input.accept) {
    const rejected = { ...current, status: "REJECTED" as const, decidedOn: input.date, rationale: "Owner rejected the simulation investor bid." };
    repo.upsertOffer(rejected);
    insertOwnershipRound(db, { offerId: current.id, actor: "OWNER", action: "REJECT", message: "Owner rejected the bid.", date: input.date });
    return rejected;
  }
  const accepted: OwnershipAcquisitionOffer = {
    ...current,
    status: "DUE_DILIGENCE",
    pendingDecisionBy: "INVESTOR",
    respondBy: ownershipRespondByDate(input.date, "DUE_DILIGENCE"),
    rationale: "Owner accepted the terms — due diligence has begun.",
  };
  repo.upsertOffer(accepted);
  insertOwnershipRound(db, { offerId: current.id, actor: "OWNER", action: "ACCEPT", message: "Owner accepted the proposed terms — due diligence begins.", date: input.date });
  db.prepare(
    "UPDATE ownership_acquisition_offers SET status='REJECTED', decided_on=?, rationale=? WHERE club_id=? AND id<>? AND seller_holder_id=? AND status IN ('OFFER','COUNTER')",
  ).run(input.date, "Competing bid closed after another bid was accepted.", current.clubId, current.id, current.sellerHolderId);
  return accepted;
};

/**
 * The owner asking for more before committing — the investor genuinely
 * re-evaluates this once due (processDueOwnershipOffer/evaluateInvestorCounter),
 * rather than the owner being able to name any number and have it silently
 * accepted. Can also revise the requested stake % and/or ask for a board
 * seat, not just the price — bounded to MAX_NEGOTIATION_ROUNDS total
 * owner<->investor rounds so haggling can't run forever.
 */
export const counterInvestorBid = (
  db: GameDatabase,
  input: { offerId: EntityId; amount: number; percentage?: number; boardSeatRequested?: boolean; date: string },
): OwnershipAcquisitionOffer => {
  if (input.amount <= 0) throw new Error("Counter amount must be positive.");
  if (input.percentage !== undefined && (input.percentage <= 0 || input.percentage > 100))
    throw new Error("Counter stake must be greater than 0 and no more than 100%.");
  const repo = new OwnershipRepository(db);
  const current = repo.offer(input.offerId);
  if (!current || !current.sellerHolderId || !["OFFER", "COUNTER"].includes(current.status))
    throw new Error("Investor bid is no longer open to counter.");
  const roundCount = current.negotiationRoundCount ?? 0;
  if (roundCount >= MAX_NEGOTIATION_ROUNDS)
    throw new Error("This negotiation has reached its round limit — accept, reject, or withdraw instead.");
  const next: OwnershipAcquisitionOffer = {
    ...current,
    counterAmount: Math.round(input.amount),
    counterPercentage: input.percentage,
    boardSeatRequested: input.boardSeatRequested ?? current.boardSeatRequested,
    status: "COUNTER",
    pendingDecisionBy: "INVESTOR",
    respondBy: ownershipRespondByDate(input.date, "INVESTOR_REVIEW"),
    negotiationRoundCount: roundCount + 1,
    rationale: "Owner revised the proposed terms.",
  };
  repo.upsertOffer(next);
  insertOwnershipRound(db, {
    offerId: current.id,
    actor: "OWNER",
    action: "COUNTER",
    message:
      `Owner countered at ${Math.round(input.amount).toLocaleString()} NPR` +
      (input.percentage !== undefined ? ` for ${input.percentage}%` : "") +
      (input.boardSeatRequested ? ", requesting a board seat" : "") +
      ".",
    date: input.date,
  });
  return next;
};

export const withdrawInvestorBidResponse = (db: GameDatabase, input: { offerId: EntityId; date: string }): OwnershipAcquisitionOffer => {
  const repo = new OwnershipRepository(db);
  const current = repo.offer(input.offerId);
  if (!current || !current.sellerHolderId || (["ACCEPTED", "COMPLETED", "REJECTED", "WITHDRAWN"] as string[]).includes(current.status))
    throw new Error("This negotiation is no longer open to withdraw.");
  const next: OwnershipAcquisitionOffer = {
    ...current,
    status: "WITHDRAWN",
    decidedOn: input.date,
    pendingDecisionBy: undefined,
    respondBy: undefined,
    rationale: "Owner withdrew from the negotiation.",
  };
  repo.upsertOffer(next);
  insertOwnershipRound(db, { offerId: current.id, actor: "OWNER", action: "WITHDRAW", message: "Owner withdrew from the negotiation.", date: input.date });
  return next;
};

export const createOwnershipEnquiry = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    buyerPersonId: EntityId;
    percentage: number;
    date: string;
    sellerHolderId?: EntityId;
  },
): OwnershipAcquisitionOffer => {
  if (input.percentage <= 0 || input.percentage > 100)
    throw new Error("Ownership percentage is invalid");
  if (!db.prepare("SELECT 1 FROM clubs WHERE id = ?").get(input.clubId))
    throw new Error("Club does not exist");
  if (
    new GlobalFootballContextRepository(db)
      .clubs()
      .some((club) => club.clubId === input.clubId && club.simulationDepth === "CONTEXT_ONLY") ||
    (db.prepare("SELECT canonical_external_id AS value FROM clubs WHERE id = ?").get(input.clubId) as { value?: string } | undefined)?.value?.startsWith("SIM-FOREIGN-")
  )
    throw new Error("Context-only external clubs cannot be owned by the player.");
  const value: OwnershipAcquisitionOffer = {
    id: createStableEntityId(
      "ownership-offer",
      `${input.clubId}:${input.buyerPersonId}:${input.date}:${input.percentage}`,
    ),
    clubId: input.clubId,
    buyerPersonId: input.buyerPersonId,
    sellerHolderId: input.sellerHolderId,
    percentage: input.percentage,
    offerAmount: 0,
    status: "ENQUIRY",
    createdOn: input.date,
    provenanceStatus: status,
  };
  new OwnershipRepository(db).upsertOffer(value);
  return value;
};

export const submitOwnershipOffer = (
  db: GameDatabase,
  input: { enquiryId: EntityId; amount: number; date: string },
): OwnershipAcquisitionOffer => {
  const repo = new OwnershipRepository(db);
  const enquiry = repo.offer(input.enquiryId);
  if (!enquiry || enquiry.status !== "ENQUIRY") throw new Error("Ownership enquiry is unavailable");
  if (input.amount <= 0) throw new Error("Ownership offer must be positive");
  const value = {
    ...enquiry,
    offerAmount: Math.round(input.amount),
    status: "OFFER" as const,
    createdOn: enquiry.createdOn,
  };
  repo.upsertOffer(value);
  return value;
};

export const counterOwnershipOffer = (
  db: GameDatabase,
  input: { offerId: EntityId; amount: number; date: string },
): OwnershipAcquisitionOffer => {
  const repo = new OwnershipRepository(db);
  const current = repo.offer(input.offerId);
  if (!current || !["OFFER", "COUNTER"].includes(current.status))
    throw new Error("Ownership offer is unavailable");
  const next = {
    ...current,
    counterAmount: Math.round(input.amount),
    status: "COUNTER" as const,
    rationale: "Existing owners requested terms closer to the club valuation.",
  };
  repo.upsertOffer(next);
  return next;
};

export const decideOwnershipOffer = (
  db: GameDatabase,
  input: { offerId: EntityId; date: string; accept?: boolean },
): OwnershipAcquisitionOffer => {
  const repo = new OwnershipRepository(db);
  const current = repo.offer(input.offerId);
  if (!current || !["OFFER", "COUNTER"].includes(current.status))
    throw new Error("Ownership offer is unavailable");
  const amount = current.counterAmount ?? current.offerAmount;
  const club = db.prepare("SELECT ownership_type FROM clubs WHERE id = ?").get(current.clubId) as
    { ownership_type?: string } | undefined;
  const valuation = calculateAcquisitionValuation(db, current.clubId, input.date);
  const personal = new ClubEconomyRepository(db).personalFinancialProfile(current.buyerPersonId);
  const offered =
    input.accept !== false &&
    (personal?.cash ?? 0) >= amount &&
    amount >= Math.round(valuation * 0.85) &&
    !(
      current.percentage > 49 &&
      ["DEPARTMENTAL", "MUNICIPALITY_BACKED"].includes(club?.ownership_type ?? "")
    );
  const next = {
    ...current,
    status: offered ? ("ACCEPTED" as const) : ("REJECTED" as const),
    decidedOn: input.date,
    rationale: offered
      ? "Owners accepted a financially credible offer."
      : "Owners declined because value, control, or ownership restrictions were not met.",
  };
  repo.upsertOffer(next);
  if (offered) completeAcquisition(db, next, amount, input.date);
  return next;
};

const completeAcquisition = (
  db: GameDatabase,
  offer: OwnershipAcquisitionOffer,
  amount: number,
  date: string,
): OwnershipAcquisitionTransaction => {
  const economy = new ClubEconomyRepository(db);
  const priorTransaction = new OwnershipRepository(db)
    .transactions(offer.clubId)
    .find((item) => item.offerId === offer.id);
  if (priorTransaction) return priorTransaction;
  const personal = economy.personalFinancialProfile(offer.buyerPersonId);
  if (!personal || personal.cash < amount)
    throw new Error("Personal cash is insufficient for acquisition");
  const active = economy.ownershipStakes(offer.clubId).filter((stake) => stake.status === "ACTIVE");
  const existing = active.find((stake) => stake.holderId === offer.buyerPersonId);
  const controlTransfer =
    offer.percentage >= 51 &&
    Boolean(offer.sellerHolderId || active.some((stake) => !stake.holderId));
  const replaced = controlTransfer
    ? offer.percentage >= 100
      ? active
      : active.filter(
          (stake) =>
            !offer.sellerHolderId || stake.holderId === offer.sellerHolderId || !stake.holderId,
        )
    : [];
  const retained = active.filter((stake) => !replaced.includes(stake));
  const definedTotal =
    retained.reduce((sum, stake) => sum + (stake.percentage ?? 0), 0) - (existing?.percentage ?? 0);
  const totalPercentage = (existing?.percentage ?? 0) + offer.percentage;
  if (definedTotal + totalPercentage > 100)
    throw new Error("Ownership percentage exceeds available shares");
  const person = db
    .prepare("SELECT display_name, full_name FROM persons WHERE id = ?")
    .get(offer.buyerPersonId) as { display_name?: string; full_name: string } | undefined;
  const model: ClubOwnershipModel = totalPercentage >= 51 ? "BUYABLE" : "PARTIALLY_BUYABLE";
  const stake: ClubOwnershipStake = {
    id: createStableEntityId("ownership-stake", `${offer.clubId}:${offer.buyerPersonId}`),
    clubId: offer.clubId,
    holderType: "PERSON",
    holderId: offer.buyerPersonId,
    holderName: person?.display_name ?? person?.full_name ?? offer.buyerPersonId,
    role: totalPercentage >= 51 ? "MAJORITY_OWNER" : "MINORITY_OWNER",
    percentage: totalPercentage,
    votingPercentage: totalPercentage,
    startDate: existing?.startDate ?? date,
    status: "ACTIVE",
    ownershipModel: model,
    provenanceStatus: status,
  };
  economy.updatePersonalCash(offer.buyerPersonId, -amount, date);
  if (
    offer.sellerHolderId &&
    offer.sellerHolderId !== offer.buyerPersonId &&
    economy.personalFinancialProfile(offer.sellerHolderId)
  )
    economy.updatePersonalCash(offer.sellerHolderId, amount, date);
  for (const prior of replaced) {
    recordOwnershipEra(db, offer.clubId, prior, date);
    db.prepare(
      "UPDATE club_ownership_stakes SET status='FORMER', end_date=? WHERE id=? AND status='ACTIVE'",
    ).run(date, prior.id);
    db.prepare(
      "UPDATE club_ownership_history SET end_date=?, exit_reason=?, successor_holder_id=?, acquisition_price=?, percentage=? WHERE club_id=? AND holder_id IS ? AND end_date IS NULL",
    ).run(
      date,
      "VOLUNTARY_SALE",
      offer.buyerPersonId,
      amount,
      prior.percentage ?? null,
      offer.clubId,
      prior.holderId ?? null,
    );
  }
  economy.upsertOwnershipStake(stake);
  db.prepare(
    "INSERT OR IGNORE INTO club_ownership_history (id,club_id,holder_id,holder_name,start_date,end_date,exit_reason,successor_holder_id,acquisition_price,percentage,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    stake.id,
    offer.clubId,
    offer.buyerPersonId,
    stake.holderName,
    date,
    null,
    null,
    null,
    amount,
    offer.percentage,
    status,
  );
  if (totalPercentage >= 51)
    db.prepare("UPDATE clubs SET ownership_type = 'PRIVATE' WHERE id = ?").run(offer.clubId);
  const transaction: OwnershipAcquisitionTransaction = {
    id: createStableEntityId("ownership-transaction", offer.id),
    offerId: offer.id,
    clubId: offer.clubId,
    buyerPersonId: offer.buyerPersonId,
    sellerHolderId: offer.sellerHolderId,
    date,
    amount,
    percentage: offer.percentage,
    status: "POSTED",
    provenanceStatus: status,
  };
  new OwnershipRepository(db).insertTransaction(transaction);
  applySupporterOwnershipOutcome({ db, clubId: offer.clubId, date, trustImpact: 4 });
  new EventRepository(db).insertHistoricalEvent({
    id: createStableEntityId("history", `OWNERSHIP_TRANSFER:${offer.id}`),
    occurredOn: date,
    eventType: "CLUB_OWNERSHIP_TRANSFERRED",
    involvedEntities: [
      { id: offer.clubId, type: "club" },
      { id: offer.buyerPersonId, type: "person" },
    ],
    title: "Club ownership transferred",
    data: { amount, percentage: offer.percentage },
    importance: "high",
    scope: "club",
  });
  return transaction;
};

const completeShareSale = (db: GameDatabase, offer: OwnershipAcquisitionOffer, amount: number, date: string): OwnershipAcquisitionTransaction => {
  const repo = new OwnershipRepository(db);
  const prior = repo.transactions(offer.clubId).find((transaction) => transaction.offerId === offer.id);
  if (prior) return prior;
  const economy = new ClubEconomyRepository(db);
  const seller = economy.ownershipStakes(offer.clubId).find((stake) => stake.holderId === offer.sellerHolderId && stake.status === "ACTIVE");
  if (!seller || (seller.percentage ?? 0) < offer.percentage) throw new Error("Seller stake is no longer available.");
  const buyerCash = economy.personalFinancialProfile(offer.buyerPersonId);
  if (!buyerCash || buyerCash.cash < amount) throw new Error("Investor cash is insufficient for this bid.");
  const remaining = Math.round(((seller.percentage ?? 0) - offer.percentage) * 100) / 100;
  if (remaining < 0) throw new Error("Share sale would create negative ownership.");
  economy.updatePersonalCash(offer.buyerPersonId, -amount, date);
  economy.updatePersonalCash(offer.sellerHolderId!, amount, date);
  recordOwnershipEra(db, offer.clubId, seller, date, "VOLUNTARY_SALE");
  const sellerEnd = remaining === 0 ? { ...seller, status: "FORMER" as const, endDate: date, role: "MINORITY_OWNER" as const, percentage: 0, votingPercentage: 0 } : { ...seller, percentage: remaining, votingPercentage: remaining, role: remaining >= 51 ? "MAJORITY_OWNER" as const : "MINORITY_OWNER" as const, endDate: undefined };
  economy.upsertOwnershipStake(sellerEnd);
  db.prepare("UPDATE club_ownership_history SET end_date=?, exit_reason=?, acquisition_price=?, percentage=? WHERE id=?").run(date, "VOLUNTARY_SALE", amount, seller.percentage ?? null, seller.id);
  if (remaining > 0) db.prepare("INSERT OR IGNORE INTO club_ownership_history (id,club_id,holder_id,holder_name,start_date,end_date,exit_reason,successor_holder_id,acquisition_price,percentage,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(createStableEntityId("ownership-history", `${seller.id}:remaining:${date}`), offer.clubId, seller.holderId ?? null, seller.holderName, date, null, null, null, null, remaining, status);
  const buyer = economy.ownershipStakes(offer.clubId).find((stake) => stake.holderId === offer.buyerPersonId && stake.status === "ACTIVE");
  const buyerPercentage = (buyer?.percentage ?? 0) + offer.percentage;
  const buyerStake: ClubOwnershipStake = { id: buyer?.id ?? createStableEntityId("club-ownership-stake", `${offer.clubId}:${offer.buyerPersonId}`), clubId: offer.clubId, holderType: "PERSON", holderId: offer.buyerPersonId, holderName: investorNameFor(db, offer.buyerPersonId), role: buyerPercentage >= 51 ? "MAJORITY_OWNER" : "MINORITY_OWNER", percentage: buyerPercentage, votingPercentage: buyerPercentage, startDate: buyer?.startDate ?? date, status: "ACTIVE", ownershipModel: buyerPercentage >= 51 ? "BUYABLE" : "PARTIALLY_BUYABLE", provenanceStatus: status };
  economy.upsertOwnershipStake(buyerStake);
  if (!buyer) db.prepare("INSERT OR IGNORE INTO club_ownership_history (id,club_id,holder_id,holder_name,start_date,end_date,exit_reason,successor_holder_id,acquisition_price,percentage,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(buyerStake.id, offer.clubId, buyerStake.holderId ?? null, buyerStake.holderName, date, null, null, null, amount, offer.percentage, status);
  const transaction: OwnershipAcquisitionTransaction = { id: createStableEntityId("ownership-transaction", offer.id), offerId: offer.id, clubId: offer.clubId, buyerPersonId: offer.buyerPersonId, sellerHolderId: offer.sellerHolderId, date, amount, percentage: offer.percentage, status: "POSTED", provenanceStatus: status };
  repo.insertTransaction(transaction);
  new EventRepository(db).insertHistoricalEvent({ id: createStableEntityId("history", `OWNERSHIP_SHARE_SALE:${offer.id}`), occurredOn: date, eventType: "CLUB_OWNERSHIP_TRANSFERRED", involvedEntities: [{ id: offer.clubId, type: "club" }, { id: offer.buyerPersonId, type: "person" }, { id: offer.sellerHolderId!, type: "person" }], title: "Club ownership share sold", data: { amount, percentage: offer.percentage, transactionType: "PERSONAL_SHARE_SALE" }, importance: "high", scope: "club" });
  applySupporterOwnershipOutcome({ db, clubId: offer.clubId, date, trustImpact: 1 });
  return transaction;
};

/**
 * Settlement for a PRIMARY_CAPITAL_INJECTION deal — money goes into the
 * club's own ledger (via investPersonalFunds, the same club-economy
 * mechanism owner top-ups already use), and every existing holder is
 * diluted by the investor's new percentage, rather than any cash moving to
 * an existing owner. This is the money-flow distinction Sprint 3 requires:
 * a primary deal must never silently credit an owner for cash that
 * actually went to the club, or vice versa.
 */
const completeCapitalInjectionAcquisition = (
  db: GameDatabase,
  offer: OwnershipAcquisitionOffer,
  amount: number,
  date: string,
): OwnershipAcquisitionTransaction => {
  const repo = new OwnershipRepository(db);
  const prior = repo.transactions(offer.clubId).find((transaction) => transaction.offerId === offer.id);
  if (prior) return prior;
  const economy = new ClubEconomyRepository(db);
  const buyerCash = economy.personalFinancialProfile(offer.buyerPersonId);
  if (!buyerCash || buyerCash.cash < amount) throw new Error("Investor cash is insufficient for this capital injection.");
  investPersonalFunds(db, { personId: offer.buyerPersonId, clubId: offer.clubId, date, amount, form: "EQUITY" });
  const active = economy.ownershipStakes(offer.clubId).filter((stake) => stake.status === "ACTIVE");
  const diluted = clamp(offer.percentage / 100, 0, 0.9);
  for (const stake of active) {
    const percentage = (stake.percentage ?? 0) * (1 - diluted);
    economy.upsertOwnershipStake({ ...stake, percentage, votingPercentage: percentage });
  }
  const existingBuyerStake = active.find((stake) => stake.holderId === offer.buyerPersonId);
  const buyerPercentage = (existingBuyerStake?.percentage ?? 0) * (1 - diluted) + offer.percentage;
  const buyerStake: ClubOwnershipStake = {
    id: existingBuyerStake?.id ?? createStableEntityId("club-ownership-stake", `${offer.clubId}:${offer.buyerPersonId}`),
    clubId: offer.clubId,
    holderType: "PERSON",
    holderId: offer.buyerPersonId,
    holderName: investorNameFor(db, offer.buyerPersonId),
    role: buyerPercentage >= 51 ? "MAJORITY_OWNER" : "MINORITY_OWNER",
    percentage: buyerPercentage,
    votingPercentage: buyerPercentage,
    startDate: existingBuyerStake?.startDate ?? date,
    status: "ACTIVE",
    ownershipModel: buyerPercentage >= 51 ? "BUYABLE" : "PARTIALLY_BUYABLE",
    provenanceStatus: status,
  };
  economy.upsertOwnershipStake(buyerStake);
  if (!existingBuyerStake)
    db.prepare(
      "INSERT OR IGNORE INTO club_ownership_history (id,club_id,holder_id,holder_name,start_date,end_date,exit_reason,successor_holder_id,acquisition_price,percentage,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(buyerStake.id, offer.clubId, buyerStake.holderId ?? null, buyerStake.holderName, date, null, null, null, amount, offer.percentage, status);
  const transaction: OwnershipAcquisitionTransaction = {
    id: createStableEntityId("ownership-transaction", offer.id),
    offerId: offer.id,
    clubId: offer.clubId,
    buyerPersonId: offer.buyerPersonId,
    sellerHolderId: offer.sellerHolderId,
    date,
    amount,
    percentage: offer.percentage,
    status: "POSTED",
    provenanceStatus: status,
  };
  repo.insertTransaction(transaction);
  insertOwnershipStoryEvent(db, {
    clubId: offer.clubId,
    buyerPersonId: offer.buyerPersonId,
    eventType: "OWNERSHIP_CAPITAL_INJECTION_COMPLETED",
    title: "Capital injection arrives",
    date,
    data: { amount, percentage: offer.percentage },
    importance: "high",
  });
  applySupporterOwnershipOutcome({ db, clubId: offer.clubId, date, trustImpact: 2 });
  return transaction;
};

/**
 * Runs whichever decision is due for one ownership negotiation — due
 * diligence, board review, or final settlement — and never more than once
 * per call, mirroring processDueTransferOffer for transfers. Clears its own
 * respondBy before returning, so re-running this for an offer that hasn't
 * moved is a no-op.
 */
/**
 * Shared final settlement — used both by the automatic daily tick (a
 * supportive/cautious board) and by acknowledgeBoardOpposition (an owner
 * explicitly proceeding despite an opposed board). Exactly-once via the
 * same idempotent completeShareSale/completeCapitalInjectionAcquisition
 * transaction guards.
 */
const settleOwnershipDeal = (db: GameDatabase, offer: OwnershipAcquisitionOffer, date: string): OwnershipAcquisitionOffer => {
  const repo = new OwnershipRepository(db);
  const amount = offer.counterAmount ?? offer.offerAmount;
  const transaction =
    offer.dealStructure === "PRIMARY_CAPITAL_INJECTION"
      ? completeCapitalInjectionAcquisition(db, offer, amount, date)
      : completeShareSale(db, offer, amount, date);
  const completed: OwnershipAcquisitionOffer = {
    ...offer,
    status: "COMPLETED",
    decidedOn: date,
    pendingDecisionBy: undefined,
    respondBy: undefined,
    ownerProceedsAmount: offer.dealStructure === "PRIMARY_CAPITAL_INJECTION" ? 0 : transaction.amount,
    capitalInjectionAmount: offer.dealStructure === "PRIMARY_CAPITAL_INJECTION" ? transaction.amount : 0,
    rationale: "Deal completed.",
  };
  repo.upsertOffer(completed);
  insertOwnershipRound(db, { offerId: offer.id, actor: "SYSTEM", action: "ACCEPT", message: "Ownership deal completed.", date });
  insertOwnershipStoryEvent(db, { clubId: offer.clubId, buyerPersonId: offer.buyerPersonId, eventType: offer.percentage >= 51 ? "OWNERSHIP_CONTROLLING_STAKE_AGREED" : "OWNERSHIP_DEAL_COMPLETED", title: offer.percentage >= 51 ? "Controlling stake agreed" : "Ownership deal completed", date, data: { amount, percentage: offer.percentage }, importance: "high", dedupeKey: offer.id });
  return completed;
};

/** The owner explicitly proceeding with a deal despite an OPPOSED board —
 * the only way an opposed-board FINAL_TERMS offer ever settles, since the
 * daily tick deliberately leaves it with no respondBy (see the
 * BOARD_REVIEW branch below). Ownership authority stays with the owner:
 * this is a confirmation, not a veto being overridden by force. */
export const acknowledgeBoardOpposition = (db: GameDatabase, input: { offerId: EntityId; date: string }): OwnershipAcquisitionOffer => {
  const repo = new OwnershipRepository(db);
  const current = repo.offer(input.offerId);
  if (!current || current.status !== "FINAL_TERMS" || current.pendingDecisionBy !== "OWNER")
    throw new Error("This deal is not waiting on your confirmation.");
  insertOwnershipRound(db, { offerId: current.id, actor: "OWNER", action: "ACCEPT", message: "Owner proceeded despite the board's opposition.", date: input.date });
  return settleOwnershipDeal(db, current, input.date);
};

export const processDueOwnershipOffer = (
  db: GameDatabase,
  offer: OwnershipAcquisitionOffer,
  date: string,
): { title: string; body: string } | undefined => {
  const repo = new OwnershipRepository(db);
  const stance = offer.investorStance ?? investorStanceFor(offer.id);
  const profile = stanceProfile(stance);

  if (offer.status === "DUE_DILIGENCE") {
    const result = runDueDiligence(db, offer.clubId, date);
    const scaledAdjustment = result.valuationAdjustmentPercent * profile.dueDiligenceSensitivity;
    const scaledWalkRisk = result.walkAwayRisk * profile.dueDiligenceSensitivity;
    const findingDescriptions = result.findings.map((finding) => finding.description);
    // A deterministic "roll" from the offer id — never Math.random — so the
    // same offer always resolves the same way across reloads.
    const roll = hashString(`${offer.id}:due-diligence`) / 100;
    if (roll < scaledWalkRisk && scaledAdjustment < -10) {
      const rejected: OwnershipAcquisitionOffer = {
        ...offer,
        status: "REJECTED",
        decidedOn: date,
        pendingDecisionBy: undefined,
        respondBy: undefined,
        dueDiligenceFindings: findingDescriptions,
        rationale: "Due diligence uncovered concerns serious enough that the investor withdrew.",
      };
      repo.upsertOffer(rejected);
      insertOwnershipRound(db, { offerId: offer.id, actor: "INVESTOR", action: "REJECT", message: `Due diligence concern: ${findingDescriptions[0]} The investor walked away.`, date });
      insertOwnershipStoryEvent(db, { clubId: offer.clubId, buyerPersonId: offer.buyerPersonId, eventType: "OWNERSHIP_NEGOTIATION_COLLAPSED", title: "Negotiation collapses after due diligence", date, data: { findings: findingDescriptions }, dedupeKey: offer.id });
      return { title: "Investor withdrew", body: "Due diligence findings were serious enough that the investor walked away." };
    }
    if (scaledAdjustment < -4) {
      const loweredAmount = Math.round((offer.counterAmount ?? offer.offerAmount) * (1 + scaledAdjustment / 100));
      const next: OwnershipAcquisitionOffer = {
        ...offer,
        status: "COUNTER",
        counterAmount: loweredAmount,
        pendingDecisionBy: "OWNER",
        respondBy: undefined,
        negotiationRoundCount: (offer.negotiationRoundCount ?? 0) + 1,
        dueDiligenceFindings: findingDescriptions,
        rationale: "Due diligence raised concerns — the investor wants a lower price.",
      };
      repo.upsertOffer(next);
      insertOwnershipRound(db, { offerId: offer.id, actor: "INVESTOR", action: "DUE_DILIGENCE", message: `Due diligence concern: ${findingDescriptions[0]} Revised offer: ${loweredAmount.toLocaleString()} NPR.`, date });
      insertOwnershipStoryEvent(db, { clubId: offer.clubId, buyerPersonId: offer.buyerPersonId, eventType: "OWNERSHIP_DUE_DILIGENCE_CONCERN", title: "Due diligence concern raised", date, data: { findings: findingDescriptions }, dedupeKey: `${offer.id}:${repo.negotiationRounds(offer.id).length}` });
      return { title: "Due diligence concern", body: "The investor has revised their offer down after due diligence." };
    }
    const next: OwnershipAcquisitionOffer = {
      ...offer,
      status: "BOARD_REVIEW",
      pendingDecisionBy: "INVESTOR",
      respondBy: ownershipRespondByDate(date, "BOARD_REVIEW"),
      dueDiligenceFindings: findingDescriptions,
    };
    repo.upsertOffer(next);
    insertOwnershipRound(db, { offerId: offer.id, actor: "INVESTOR", action: "DUE_DILIGENCE", message: result.severity === "CLEAN" ? "Due diligence complete — no material concerns. Moving to board review." : "Due diligence complete — nothing serious enough to change terms. Moving to board review.", date });
    return { title: "Due diligence complete", body: "The deal now goes to board review." };
  }

  if (offer.status === "COUNTER" && offer.pendingDecisionBy === "INVESTOR") {
    const roundCount = offer.negotiationRoundCount ?? 1;
    const evaluation = evaluateInvestorCounter({
      initialOfferAmount: offer.offerAmount,
      ownerAsk: offer.counterAmount ?? offer.offerAmount,
      profile,
      roundCount,
    });
    if (evaluation.decision === "ACCEPT") {
      // Fold any owner-revised stake into the agreed percentage now that
      // both sides have accepted it — everything downstream (due diligence,
      // board review, settlement) operates on this final figure.
      const next: OwnershipAcquisitionOffer = {
        ...offer,
        percentage: offer.counterPercentage ?? offer.percentage,
        counterPercentage: undefined,
        status: "DUE_DILIGENCE",
        pendingDecisionBy: "INVESTOR",
        respondBy: ownershipRespondByDate(date, "DUE_DILIGENCE"),
        rationale: "Investor accepted the revised price — due diligence begins.",
      };
      repo.upsertOffer(next);
      insertOwnershipRound(db, { offerId: offer.id, actor: "INVESTOR", action: "ACCEPT", message: "Investor accepted the revised terms.", date });
      return { title: "Investor accepted terms", body: "Due diligence has begun." };
    }
    if (evaluation.decision === "COUNTER") {
      const next: OwnershipAcquisitionOffer = {
        ...offer,
        status: "COUNTER",
        counterAmount: evaluation.amount,
        pendingDecisionBy: "OWNER",
        respondBy: undefined,
        negotiationRoundCount: roundCount + 1,
        rationale: `Investor (${profile.description}) revised their proposal.`,
      };
      repo.upsertOffer(next);
      insertOwnershipRound(db, { offerId: offer.id, actor: "INVESTOR", action: "COUNTER", message: `Investor revised their proposal to ${evaluation.amount.toLocaleString()} NPR.`, date });
      insertOwnershipStoryEvent(db, { clubId: offer.clubId, buyerPersonId: offer.buyerPersonId, eventType: "OWNERSHIP_REVISED_PROPOSAL", title: "Investor revises proposal", date, data: { amount: evaluation.amount }, dedupeKey: `${offer.id}:${repo.negotiationRounds(offer.id).length}` });
      return { title: "Investor revised their offer", body: `New proposal: ${evaluation.amount.toLocaleString()} NPR.` };
    }
    const rejected: OwnershipAcquisitionOffer = { ...offer, status: "REJECTED", decidedOn: date, pendingDecisionBy: undefined, respondBy: undefined, rationale: `Investor walked away — ${evaluation.reason}.` };
    repo.upsertOffer(rejected);
    insertOwnershipRound(db, { offerId: offer.id, actor: "INVESTOR", action: "REJECT", message: "Investor walked away from the negotiation.", date });
    insertOwnershipStoryEvent(db, { clubId: offer.clubId, buyerPersonId: offer.buyerPersonId, eventType: "OWNERSHIP_INVESTOR_WALKED_AWAY", title: "Investor walks away", date, data: { reason: evaluation.reason }, dedupeKey: offer.id });
    return { title: "Investor walked away", body: `The gap to your asking price never closed (${evaluation.reason}).` };
  }

  if (offer.status === "BOARD_REVIEW") {
    const confidence = new CareerWorldRepository(db).boardConfidence(offer.clubId);
    const tier: OwnershipBoardStance =
      confidence === undefined ? "CAUTIOUS" : confidence.confidence >= 60 ? "SUPPORTIVE" : confidence.confidence >= 35 ? "CAUTIOUS" : "OPPOSED";
    const stanceLine =
      tier === "SUPPORTIVE"
        ? "The board is supportive of this deal."
        : tier === "CAUTIOUS"
          ? "The board is cautious but does not object."
          : "The board has real reservations and opposes this deal — proceeding will need your explicit confirmation.";
    // An opposed board deliberately gets no respondBy: the deal stalls at
    // FINAL_TERMS, pending the owner, until acknowledgeBoardOpposition is
    // called. A supportive/cautious board proceeds automatically.
    const next: OwnershipAcquisitionOffer = {
      ...offer,
      status: "FINAL_TERMS",
      pendingDecisionBy: tier === "OPPOSED" ? "OWNER" : "INVESTOR",
      respondBy: tier === "OPPOSED" ? undefined : ownershipRespondByDate(date, "FINAL_TERMS"),
      boardStance: stanceLine,
      boardStanceTier: tier,
    };
    repo.upsertOffer(next);
    insertOwnershipRound(db, { offerId: offer.id, actor: "BOARD", action: "BOARD_REVIEW", message: stanceLine, date });
    insertOwnershipStoryEvent(db, { clubId: offer.clubId, buyerPersonId: offer.buyerPersonId, eventType: "OWNERSHIP_BOARD_REVIEWED", title: tier === "OPPOSED" ? "Board opposes ownership deal" : "Board reviews ownership deal", date, data: { stance: stanceLine, tier }, dedupeKey: offer.id });
    return { title: "Board reviewed the deal", body: stanceLine };
  }

  if (offer.status === "FINAL_TERMS" && offer.pendingDecisionBy === "INVESTOR") {
    settleOwnershipDeal(db, offer, date);
    return { title: "Ownership deal completed", body: "The deal has been finalised." };
  }

  return undefined;
};

/** Called once per simulated day from whichever career-progression loop
 * drives ownership state — mirrors processDueTransferOffers. */
export const processDueOwnershipOffers = (
  db: GameDatabase,
  date: string,
): Array<{ clubId: EntityId; title: string; body: string }> => {
  const repo = new OwnershipRepository(db);
  const due = repo.dueOffers(date);
  const results: Array<{ clubId: EntityId; title: string; body: string }> = [];
  for (const offer of due) {
    const outcome = processDueOwnershipOffer(db, offer, date);
    if (outcome) results.push({ clubId: offer.clubId, ...outcome });
  }
  return results;
};

export const withdrawOwnershipOffer = (
  db: GameDatabase,
  offerId: EntityId,
  date: string,
): OwnershipAcquisitionOffer => {
  const repo = new OwnershipRepository(db);
  const current = repo.offer(offerId);
  if (!current || ["ACCEPTED", "REJECTED", "WITHDRAWN"].includes(current.status))
    throw new Error("Ownership offer is unavailable");
  const next = { ...current, status: "WITHDRAWN" as const, decidedOn: date };
  repo.upsertOffer(next);
  return next;
};

export type OwnershipSuccessionState = {
  clubId: EntityId;
  status: "TRANSITION" | "INTERIM" | "COMPLETED";
  exitReason: string;
  startedOn: string;
  nextReviewOn: string;
  interimHolderId?: EntityId;
  candidatePersonId?: EntityId;
  activeOfferId?: EntityId;
  completedOn?: string;
  attemptCount: number;
};

const daysAfter = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const successionState = (
  db: GameDatabase,
  clubId: EntityId,
): OwnershipSuccessionState | undefined => {
  const row = db
    .prepare("SELECT * FROM club_ownership_succession WHERE club_id=?")
    .get(clubId) as any;
  return row
    ? {
        clubId: row.club_id,
        status: row.status,
        exitReason: row.exit_reason,
        startedOn: row.started_on,
        nextReviewOn: row.next_review_on,
        interimHolderId: row.interim_holder_id ?? undefined,
        candidatePersonId: row.candidate_person_id ?? undefined,
        activeOfferId: row.active_offer_id ?? undefined,
        completedOn: row.completed_on ?? undefined,
        attemptCount: row.attempt_count,
      }
    : undefined;
};

const recordOwnershipEra = (
  db: GameDatabase,
  clubId: EntityId,
  stake: ClubOwnershipStake,
  date: string,
  exitReason?: string,
): void => {
  if (db.prepare("SELECT 1 FROM club_ownership_history WHERE id=?").get(stake.id)) return;
  db.prepare(
    "INSERT INTO club_ownership_history (id,club_id,holder_id,holder_name,start_date,end_date,exit_reason,successor_holder_id,acquisition_price,percentage,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    stake.id,
    clubId,
    stake.holderId ?? null,
    stake.holderName,
    stake.startDate,
    stake.endDate ?? null,
    exitReason ?? null,
    null,
    null,
    stake.percentage ?? null,
    stake.provenanceStatus,
  );
  if (date < stake.startDate) throw new Error("Ownership transition predates ownership era");
};

export const ownershipHistory = (
  db: GameDatabase,
  clubId?: EntityId,
): Array<Record<string, unknown>> => {
  const rows = (
    clubId
      ? db
          .prepare("SELECT * FROM club_ownership_history WHERE club_id=? ORDER BY start_date,id")
          .all(clubId)
      : db.prepare("SELECT * FROM club_ownership_history ORDER BY club_id,start_date,id").all()
  ) as any[];
  return rows.map((row) => ({
    id: row.id,
    clubId: row.club_id,
    holderId: row.holder_id ?? undefined,
    holderName: row.holder_name,
    startDate: row.start_date,
    endDate: row.end_date ?? undefined,
    exitReason: row.exit_reason ?? undefined,
    successorHolderId: row.successor_holder_id ?? undefined,
    acquisitionPrice: row.acquisition_price ?? undefined,
    percentage: row.percentage ?? undefined,
    provenanceStatus: row.provenance_status,
  }));
};

export const exitClubOwnership = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    ownerPersonId: EntityId;
    date: string;
    reason?: string;
    seed?: string;
  },
): OwnershipSuccessionState => {
  const economy = new ClubEconomyRepository(db);
  const stake = economy
    .ownershipStakes(input.clubId)
    .find((item) => item.holderId === input.ownerPersonId && item.status === "ACTIVE");
  if (!stake) throw new Error("Active owner stake not found");
  const current = successionState(db, input.clubId);
  if (current && current.status !== "COMPLETED") return current;
  recordOwnershipEra(db, input.clubId, stake, input.date, input.reason ?? "OWNER_EXIT");
  db.prepare(
    "UPDATE club_ownership_stakes SET status='FORMER', end_date=? WHERE id=? AND status='ACTIVE'",
  ).run(input.date, stake.id);
  db.prepare(
    "INSERT INTO club_ownership_succession (club_id,status,exit_reason,started_on,next_review_on,candidate_person_id,active_offer_id,attempt_count,provenance_status) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(club_id) DO UPDATE SET status=excluded.status,exit_reason=excluded.exit_reason,started_on=excluded.started_on,next_review_on=excluded.next_review_on,candidate_person_id=NULL,active_offer_id=NULL,completed_on=NULL,attempt_count=0,provenance_status=excluded.provenance_status",
  ).run(
    input.clubId,
    "TRANSITION",
    input.reason ?? "OWNER_EXIT",
    input.date,
    input.date,
    null,
    null,
    0,
    status,
  );
  new EventRepository(db).insertHistoricalEvent({
    id: createStableEntityId(
      "history",
      `OWNERSHIP_SUCCESSION_STARTED:${input.clubId}:${input.date}`,
    ),
    occurredOn: input.date,
    eventType: "CLUB_OWNERSHIP_SUCCESSION_STARTED",
    involvedEntities: [
      { id: input.clubId, type: "club" },
      { id: input.ownerPersonId, type: "person" },
    ],
    title: "Club ownership succession started",
    data: { reason: input.reason ?? "OWNER_EXIT" },
    importance: "high",
    scope: "club",
  });
  applySupporterOwnershipOutcome({ db, clubId: input.clubId, date: input.date, trustImpact: -4 });
  return successionState(db, input.clubId)!;
};

const candidateForClub = (
  db: GameDatabase,
  clubId: EntityId,
  valuation: number,
): EntityId | undefined => {
  const row = db
    .prepare(
      "SELECT p.id FROM personal_financial_profiles pf JOIN persons p ON p.id=pf.person_id WHERE pf.cash>=? AND NOT EXISTS (SELECT 1 FROM club_ownership_stakes s WHERE s.holder_id=pf.person_id AND s.status='ACTIVE' AND s.percentage>=51 AND s.club_id<>?) ORDER BY pf.cash DESC, p.id LIMIT 1",
    )
    .get(valuation, clubId) as { id?: EntityId } | undefined;
  return row?.id;
};

const generateOwnershipCandidate = (
  db: GameDatabase,
  clubId: EntityId,
  date: string,
  valuation: number,
  sequence: number,
): EntityId => {
  const club = db
    .prepare("SELECT name,country_id,location_id FROM clubs WHERE id=?")
    .get(clubId) as { name: string; country_id: EntityId; location_id?: EntityId };
  const id = createStableEntityId("ownership-candidate", `${clubId}:${sequence}`);
  const person: Person = {
    id,
    fullName: `Simulation Ownership Candidate ${club.name}`,
    displayName: `Simulation Candidate ${club.name}`,
    dateOfBirth: "1974-01-01",
    nationalityCountryId: club.country_id,
    placeOfBirthLocationId: club.location_id,
    hometownLocationId: club.location_id,
    genderPresentation: "unknown",
    languages: ["Nepali"],
  };
  const world = new WorldRepository(db);
  if (!world.getPerson(id)) {
    world.insertPerson(person);
    world.insertPersonRole({
      id: createStableEntityId("person-role", `${id}:CHAIRMAN`),
      personId: id,
      role: "CHAIRMAN",
      activeFrom: date,
    });
  }
  if (!new ClubEconomyRepository(db).personalFinancialProfile(id)) {
    new ClubEconomyRepository(db).upsertPersonalFinancialProfile({
      personId: id,
      cash: Math.max(Math.round(valuation * 1.25), 3000000),
      investments: 0,
      assets: Math.max(Math.round(valuation * 1.25), 3000000),
      liabilities: 0,
      netWorth: Math.max(Math.round(valuation * 1.25), 3000000),
      currency: "NPR",
      lastUpdatedAt: date,
      status,
    });
  }
  return id;
};

export const processOwnershipSuccession = (
  db: GameDatabase,
  input: { clubId: EntityId; date: string; seed: string; allowGeneratedCandidate?: boolean },
): OwnershipSuccessionState | undefined => {
  let state = successionState(db, input.clubId);
  if (!state || state.status === "COMPLETED" || state.nextReviewOn > input.date) return state;
  const valuation = calculateAcquisitionValuation(db, input.clubId, input.date);
  const candidate =
    state.candidatePersonId ??
    candidateForClub(db, input.clubId, valuation) ??
    (input.allowGeneratedCandidate === false
      ? undefined
      : generateOwnershipCandidate(db, input.clubId, input.date, valuation, state.attemptCount));
  if (!candidate) {
    db.prepare(
      "UPDATE club_ownership_succession SET status='INTERIM',next_review_on=?,attempt_count=attempt_count+1 WHERE club_id=?",
    ).run(daysAfter(input.date, 90), input.clubId);
    return successionState(db, input.clubId);
  }
  const seller = db
    .prepare(
      "SELECT holder_id FROM club_ownership_history WHERE club_id=? AND end_date=? ORDER BY id DESC LIMIT 1",
    )
    .get(input.clubId, input.date) as { holder_id?: EntityId } | undefined;
  const enquiry = createOwnershipEnquiry(db, {
    clubId: input.clubId,
    buyerPersonId: candidate,
    percentage: 100,
    sellerHolderId: seller?.holder_id,
    date: input.date,
  });
  const offer = submitOwnershipOffer(db, {
    enquiryId: enquiry.id,
    amount: valuation,
    date: input.date,
  });
  const decided = decideOwnershipOffer(db, { offerId: offer.id, date: input.date });
  if (decided.status !== "ACCEPTED") {
    db.prepare(
      "UPDATE club_ownership_succession SET status='INTERIM',candidate_person_id=?,next_review_on=?,attempt_count=attempt_count+1 WHERE club_id=?",
    ).run(candidate, daysAfter(input.date, 90), input.clubId);
    return successionState(db, input.clubId);
  }
  db.prepare(
    "UPDATE club_ownership_succession SET status='COMPLETED',candidate_person_id=?,active_offer_id=?,completed_on=?,next_review_on=?,attempt_count=attempt_count+1 WHERE club_id=?",
  ).run(candidate, offer.id, input.date, input.date, input.clubId);
  db.prepare(
    "UPDATE club_ownership_history SET successor_holder_id=?,acquisition_price=? WHERE club_id=? AND end_date=? AND successor_holder_id IS NULL",
  ).run(candidate, valuation, input.clubId, input.date);
  state = successionState(db, input.clubId);
  return state;
};

export const processOwnershipContinuity = (
  db: GameDatabase,
  input: { date: string; seed: string; allowGeneratedCandidate?: boolean },
): OwnershipSuccessionState[] => {
  const clubs = db.prepare("SELECT id FROM clubs ORDER BY id").all() as Array<{ id: EntityId }>;
  const states: OwnershipSuccessionState[] = [];
  for (const club of clubs) {
    const current = successionState(db, club.id);
    const active = new ClubEconomyRepository(db)
      .ownershipStakes(club.id)
      .filter((stake) => stake.status === "ACTIVE");
    if (!current && active.length === 0) {
      db.prepare(
        "INSERT INTO club_ownership_succession (club_id,status,exit_reason,started_on,next_review_on,attempt_count,provenance_status) VALUES (?,?,?,?,?,?,?)",
      ).run(club.id, "INTERIM", "OWNERLESS_STATE", input.date, input.date, 0, status);
    }
    const next = processOwnershipSuccession(db, { ...input, clubId: club.id });
    if (next) states.push(next);
  }
  return states;
};
