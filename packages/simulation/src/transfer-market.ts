import {
  createStableEntityId,
  type AgentApproachRecord,
  type AgentProfile,
  type AgentNetworkScope,
  type ClubEmploymentModel,
  type ClubEmploymentProfile,
  type ClubFinancialProfile,
  type CompetitionRegistration,
  type EntityId,
  type KnowledgeRange,
  type NegotiationRound,
  type PlayerContractRecord,
  type PlayerPersonalTerms,
  type PlayerPersonalTermsState,
  type PlayerLoanRecord,
  type PlayerSquadRole,
  type PlayerTransferStatusRecord,
  type PlayerTransferRequest,
  type SellOnEntitlement,
  type SquadNeed,
  type SquadNeedReport,
  type TransferConditionalClause,
  type TransferOffer,
  type TransferPlayerExchange,
  type TransferValuationSnapshot,
} from "@nepal-football-sim/shared-types";
import {
  ClubNetworkRepository,
  EventRepository,
  RecruitmentRepository,
  TransferMarketRepository,
  PeopleFoundationRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  clubCanAffordTransfer,
  clubCanAffordWage,
  postClubTransaction,
  recordTransferEconomy,
} from "./club-economy.js";
import { applySupporterTransferOutcome } from "./supporter-culture.js";
import { applyPlayerRelationshipEvent } from "./press-social-lifestyle.js";
import {
  effectiveAgentPlayerPreferences,
  agentFeeForContract,
  settleAgentFee,
} from "./agent-career.js";
import { evaluateRelatedPartyTransfer } from "./club-networks.js";
import { upsertPersonRelationship } from "./people-foundation.js";
import { SeededRandom } from "./rng.js";
import {
  initializeRecruitmentForSave,
  searchPlayersForClub,
  searchPreferredTransferCandidatesForClub,
  searchRegionalCandidatesForClub,
} from "./scouting.js";

type MarketPlayer = {
  playerId: EntityId;
  fullName: string;
  currentClubId?: EntityId;
  teamId?: EntityId;
  position: string;
  positionGroup: string;
  currentAbility: number;
  potentialAbility: number;
  reputation: number;
  age: number;
  appearances: number;
  goals: number;
};

type MarketClub = {
  id: EntityId;
  name: string;
  canonicalExternalId?: string;
  countryId: EntityId;
};

export type TransferWindowSimulationReport = {
  worldDate: string;
  windowDates: Array<{ openDate: string; closeDate: string; type: string }>;
  offers: number;
  /** Seller agreed to the fee. */
  accepted: number;
  /** Seller declined the fee. */
  rejected: number;
  /** Seller agreed but the player side did not conclude. */
  playerRejected: number;
  /** Deals the repository confirms as COMPLETED. */
  completedTransfers: number;
  freeAgentSignings: number;
  loans: number;
  loanReturns: number;
  renewals: number;
  releases: number;
  transferSpend: number;
  wageChange: number;
  clubSquadSizes: Array<{ clubId: EntityId; clubName: string; players: number }>;
  failedRegistrations: number;
  sampleNegotiationTimeline: NegotiationRound[];
};

const currency = "NPR";

export const initializeTransferMarketForSave = (input: {
  db: GameDatabase;
  worldDate: string;
  seed: string;
}): void => {
  const market = new TransferMarketRepository(input.db);
  /*
   * "Any contract exists" was a valid already-initialized sentinel while this
   * function was the only writer of contracts. World creation now generates
   * lower-league and youth squads first, and those carry youth contracts, so
   * the old guard tripped on someone else's rows and returned before a single
   * imported Nepal player was given a starting contract. Transfer windows are
   * seeded here and nowhere else, which makes them an unambiguous marker for
   * "this market has been initialized".
   */
  if (market.transferWindows().length > 0) {
    return;
  }
  initializeRecruitmentForSave(input);
  const clubs = marketClubs(input.db);
  const playerCounts = new Map(
    (
      input.db
        .prepare(
          "SELECT current_club_id AS club_id, COUNT(*) AS count FROM player_factual_profiles WHERE current_club_id IS NOT NULL GROUP BY current_club_id",
        )
        .all() as Array<{ club_id: EntityId; count: number }>
    ).map((row) => [row.club_id, Number(row.count)]),
  );
  for (const club of clubs) {
    const employment = employmentProfile(club);
    market.upsertClubEmploymentProfile(employment);
    market.upsertClubFinancialProfile({
      ...financialProfile(club, input.seed, playerCounts.get(club.id) ?? 0),
      currentWageSpend: 0,
    });
  }
  seedTransferWindows(input.db, input.worldDate);
  seedAgents(input.db, input.seed, input.worldDate);
  const activeContracts = new Map(
    market
      .allPlayerContracts()
      .filter(
        (contract) =>
          contract.status === "ACTIVE" &&
          contract.startDate <= input.worldDate &&
          contract.endDate >= input.worldDate,
      )
      .map((contract) => [contract.playerId, contract]),
  );
  const clubsById = new Map(clubs.map((club) => [club.id, club]));
  const countryCodes = new Map(
    (
      input.db.prepare("SELECT id, iso_code FROM countries").all() as Array<{
        id: EntityId;
        iso_code: string;
      }>
    ).map((row) => [row.id, row.iso_code]),
  );
  for (const player of marketPlayers(input.db)) {
    if (!player.currentClubId) {
      market.upsertTransferStatus(freeAgentStatus(player.playerId, input.worldDate));
      continue;
    }
    const club = clubsById.get(player.currentClubId);
    if (!club) {
      continue;
    }
    const domesticClub = ["NP", "NPL"].includes(countryCodes.get(club.countryId) ?? "");
    // Imported context clubs have factual identities but no real contract
    // terms. Give their players deterministic simulation-only agreements so
    // the global loan and purchase pathways can see them without claiming
    // that a source supplied the financial terms.
    if (!domesticClub && !club.canonicalExternalId?.startsWith("CLB-")) continue;
    /*
     * A player generated during world creation already holds an active youth
     * contract. Issuing a starting contract on top would leave one player with
     * two live deals, so the existing agreement stands and only the transfer
     * status is brought into line.
     */
    const existing = activeContracts.get(player.playerId);
    const contract =
      existing ?? startingContract(input.db, player, club, input.worldDate, input.seed);
    if (!existing) {
      market.upsertPlayerContract(contract);
    }
    market.upsertTransferStatus(initialTransferStatus(player, contract, input.worldDate));
  }
  refreshClubWageSpend(input.db, input.worldDate);
  seedCompetitionRegistrations(input.db, input.worldDate);
};

/** New-save-only roster trim; existing saves are never migrated implicitly. */
export const rebalanceNewNepalSaveSquads = (db: GameDatabase, worldDate: string): number => {
  let released = 0;
  const clubs = db
    .prepare(
      `SELECT DISTINCT c.id AS club_id, CASE WHEN lower(comp.name) LIKE '%a-division%' THEN 25 WHEN lower(comp.name) LIKE '%b-division%' THEN 22 WHEN lower(comp.name) LIKE '%c-division%' THEN 20 ELSE 0 END AS target FROM clubs c JOIN countries co ON co.id=c.country_id JOIN club_memberships cm ON cm.club_id=c.id JOIN competitions comp ON comp.id=cm.competition_id WHERE co.iso_code IN ('NP','NPL') AND cm.status='ACTIVE' AND lower(comp.name) LIKE '%division%' ORDER BY c.id`,
    )
    .all() as Array<{ club_id: EntityId; target: number }>;
  for (const club of clubs) {
    if (!club.target) continue;
    const rows = new TransferMarketRepository(db)
      .activeContractsForClub(club.club_id, worldDate)
      .sort((a, b) => {
        const rank = (role: string): number =>
          ({ YOUTH: 0, PROSPECT: 1, BACKUP: 2, ROTATION: 3, FIRST_TEAM: 5 })[role] ?? 4;
        return rank(a.squadRole) - rank(b.squadRole) || a.playerId.localeCompare(b.playerId);
      });
    for (const contract of rows.slice(club.target)) {
      releasePlayer(db, contract, worldDate, "New-save squad balancing");
      released += 1;
    }
  }
  if (released) refreshClubWageSpend(db, worldDate);
  return released;
};

export const simulateTransferWindow = (input: {
  db: GameDatabase;
  worldDate: string;
  seed: string;
  maxClubActions?: number;
}): TransferWindowSimulationReport => {
  initializeTransferMarketForSave(input);
  ensureRecruitmentKnowledge(input.db, input.worldDate, input.seed);
  const market = new TransferMarketRepository(input.db);
  const windows = market.openTransferWindows(input.worldDate);
  const windowOpen = windows.length > 0;
  let completedTransfers = 0;
  let freeAgentSignings = 0;
  let loans = 0;
  let loanReturns = 0;
  /** Seller agreed but the player side did not conclude. */
  let playerRejected = 0;
  let renewals = 0;
  let releases = 0;
  let rejected = 0;
  let accepted = 0;
  const beforeWages = totalWages(input.db, input.worldDate);

  processBoundedForeignInterest(input.db, input.worldDate, input.seed, windowOpen);

  for (const loan of market.endingLoans(input.worldDate)) {
    endLoan(input.db, loan, input.worldDate);
    loanReturns += 1;
  }

  const expiry = processContractExpiries(input.db, input.worldDate);
  releases += expiry.releases;

  const clubs = marketClubs(input.db);
  const squadSizes = activeSquadSizes(input.db);
  const activeClubs = clubs
    .filter((club) => (squadSizes.get(club.id) ?? 0) >= 11)
    .sort(
      (a, b) =>
        Number(isNepalClub(input.db, b.id)) - Number(isNepalClub(input.db, a.id)) ||
        a.name.localeCompare(b.name),
    );
  for (const contract of market
    .contractsExpiringBetween(input.worldDate, addDays(input.worldDate, 90))
    .slice(0, 18)) {
    if (shouldRenew(input.db, contract, input.seed)) {
      renewContract(input.db, contract, input.worldDate, input.seed);
      renewals += 1;
    } else if (contract.endDate <= addDays(input.worldDate, 30)) {
      releasePlayer(input.db, contract, input.worldDate, "Contract expiry decision");
      releases += 1;
    }
  }
  if (releases === 0) {
    const fringe = fringeReleaseCandidate(input.db, input.worldDate);
    if (fringe) {
      releasePlayer(input.db, fringe, input.worldDate, "Fringe squad release");
      releases += 1;
    }
  }

  const actionLimit = input.maxClubActions ?? 14;
  for (const club of activeClubs.slice(0, actionLimit)) {
    const needs = analyzeSquadNeeds(input.db, club.id, input.worldDate);
    new TransferMarketRepository(input.db).upsertSquadNeedReport(needs);
    if (needs.needs.length === 0) {
      continue;
    }
    const freeAgent = findFreeAgentForNeed(input.db, club.id, needs.needs[0]!, input.worldDate);
    if (freeAgent) {
      signFreeAgent(input.db, club.id, freeAgent.playerId, input.worldDate, input.seed);
      freeAgentSignings += 1;
      continue;
    }
    if (!windowOpen) {
      continue;
    }
    const offer = createAiTransferOffer(
      input.db,
      club.id,
      needs.needs[0]!,
      input.worldDate,
      input.seed,
    );
    if (offer && completedTransfers < 5) {
      const evaluation = evaluateTransferOffer(input.db, offer, input.worldDate, input.seed);
      if (
        evaluation.accepted &&
        clubCanAffordTransfer(
          input.db,
          offer.buyingClubId,
          offer.transferFee + offer.installments + offer.addOns + offer.agentFee + offer.signingFee,
          input.worldDate,
        )
      ) {
        accepted += 1;
        completePermanentTransfer(input.db, offer, input.worldDate, input.seed);
        /*
         * The seller accepting is not the deal closing: personal terms can still
         * stall, be rejected, or be withdrawn. Count what the repository says
         * actually completed, so the diagnostic reports deals rather than
         * attempts.
         */
        const settled = market.transferOffers().find((item) => item.id === offer.id);
        if (settled?.status === "COMPLETED") {
          completedTransfers += 1;
        } else {
          playerRejected += 1;
        }
        continue;
      }
      rejected += 1;
    }
    const loan = findLoanCandidate(input.db, club.id, needs.needs[0]!, input.worldDate);
    if (loan && loans < 3) {
      startLoan(input.db, loan.parentClubId, club.id, loan.playerId, input.worldDate, input.seed);
      loans += 1;
    }
  }
  if (windowOpen && loans === 0 && activeClubs.length > 1) {
    const receiver = activeClubs[0]!;
    const loan = findLoanCandidate(
      input.db,
      receiver.id,
      { positionGroup: "DEPTH", severity: "LOW", reason: "Depth loan fallback" },
      input.worldDate,
    );
    if (loan) {
      startLoan(
        input.db,
        loan.parentClubId,
        receiver.id,
        loan.playerId,
        input.worldDate,
        input.seed,
      );
      loans += 1;
    }
  }
  if (freeAgentSignings === 0 && activeClubs.length > 0) {
    const freeAgent = marketPlayers(input.db)
      .filter(
        (player) =>
          !new TransferMarketRepository(input.db).activeContract(player.playerId, input.worldDate),
      )
      .sort(
        (a, b) =>
          b.currentAbility - a.currentAbility ||
          String(a.playerId).localeCompare(String(b.playerId)),
      )[0];
    if (freeAgent) {
      signFreeAgent(input.db, activeClubs[0]!.id, freeAgent.playerId, input.worldDate, input.seed);
      freeAgentSignings += 1;
    }
  }

  expirePendingOffers(input.db, input.worldDate);
  refreshClubWageSpend(input.db, input.worldDate);
  seedCompetitionRegistrations(input.db, input.worldDate);

  const offers = market.transferOffers();
  /*
   * Sample the fullest negotiation available rather than the first offer that
   * happens to have a round: an offer still awaiting a response carries only
   * its opening bid, which is not a representative timeline. Ties break on id
   * so the diagnostic stays deterministic.
   */
  const sampleOffer = offers
    .map((offer) => ({ offer, rounds: market.negotiationRounds(offer.id).length }))
    .filter((entry) => entry.rounds > 0)
    .sort((a, b) => b.rounds - a.rounds || a.offer.id.localeCompare(b.offer.id))[0]?.offer;
  return {
    worldDate: input.worldDate,
    windowDates: market.transferWindows().map((window) => ({
      openDate: window.openDate,
      closeDate: window.closeDate,
      type: window.windowType,
    })),
    offers: offers.length,
    accepted,
    rejected,
    playerRejected,
    completedTransfers,
    freeAgentSignings,
    loans,
    loanReturns,
    renewals,
    releases,
    transferSpend: offers
      .filter((offer) => offer.status === "COMPLETED")
      .reduce((total, offer) => total + offer.transferFee, 0),
    wageChange: totalWages(input.db, input.worldDate) - beforeWages,
    clubSquadSizes: clubs.map((club) => ({
      clubId: club.id,
      clubName: club.name,
      players: squadSizes.get(club.id) ?? 0,
    })),
    failedRegistrations: 0,
    sampleNegotiationTimeline: sampleOffer ? market.negotiationRounds(sampleOffer.id) : [],
  };
};

/** Converts a bounded set of persisted global scouting signals into ordinary market offers. */
const processBoundedForeignInterest = (
  db: GameDatabase,
  worldDate: string,
  seed: string,
  windowOpen: boolean,
): void => {
  if (!windowOpen) return;
  const market = new TransferMarketRepository(db);
  const existing = new Set(
    market.transferOffers().map((offer) => `${offer.buyingClubId}:${offer.playerId}`),
  );
  for (const offer of market
    .transferOffers()
    .filter((offer) => offer.offerType === "PERMANENT" && offer.status === "ACCEPTED")
    .slice(0, 3)) {
    if (
      market
        .negotiationRounds(offer.id)
        .some((round) => round.actor === "PLAYER" || round.actor === "PLAYER_AGENT")
    )
      continue;
    completePermanentTransfer(db, offer, worldDate, `${seed}:global-interest`, {
      prefersOverseas: true,
      expectedPlayingTime: "FIRST_TEAM",
      ambition: 15,
      securityPreference: 8,
      continentalOpportunity: true,
    });
  }
  const resolvablePlayers = new Set(
    market
      .transferOffers()
      .filter((offer) => offer.status === "COMPETING_OFFER")
      .map((offer) => offer.playerId),
  );
  for (const playerId of resolvablePlayers) {
    resolveCompetingPlayerOffers(db, playerId, worldDate, `${seed}:global-interest`, {
      prefersOverseas: true,
      expectedPlayingTime: "FIRST_TEAM",
      ambition: 15,
      securityPreference: 8,
      continentalOpportunity: true,
    });
  }
  const rows = db
    .prepare(
      `
    SELECT interest.external_club_id AS buying_club_id, interest.target_player_id AS player_id,
           profile.current_club_id AS selling_club_id
    FROM foreign_scouting_interest interest
    JOIN player_factual_profiles profile ON profile.player_id = interest.target_player_id
    JOIN clubs seller ON seller.id = profile.current_club_id
    WHERE interest.score >= 55 AND seller.country_id IN (SELECT id FROM countries WHERE iso_code IN ('NPL','NP'))
    GROUP BY interest.target_player_id
    ORDER BY MAX(interest.score) DESC, interest.external_club_id, interest.target_player_id
    LIMIT 3
  `,
    )
    .all() as Array<{ buying_club_id: EntityId; player_id: EntityId; selling_club_id: EntityId }>;
  for (const row of rows) {
    if (existing.has(`${row.buying_club_id}:${row.player_id}`)) continue;
    const offer = createTransferOffer(db, {
      buyingClubId: row.buying_club_id,
      sellingClubId: row.selling_club_id,
      playerId: row.player_id,
      submittedAt: worldDate,
    });
    const evaluation = evaluateTransferOffer(db, offer, worldDate, `${seed}:global-interest`);
    if (
      evaluation.accepted &&
      clubCanAffordTransfer(
        db,
        offer.buyingClubId,
        offer.transferFee + offer.addOns + offer.agentFee + offer.signingFee,
        worldDate,
      )
    ) {
      completePermanentTransfer(db, offer, worldDate, `${seed}:global-interest`, {
        prefersOverseas: true,
        expectedPlayingTime: "FIRST_TEAM",
        ambition: 15,
        securityPreference: 8,
        continentalOpportunity: true,
      });
    }
  }
};

export const analyzeSquadNeeds = (
  db: GameDatabase,
  clubId: EntityId,
  worldDate: string,
): SquadNeedReport => {
  const market = new TransferMarketRepository(db);
  const contracts = market.activeContractsForClub(clubId, worldDate);
  const activePlayerIds = new Set(contracts.map((contract) => contract.playerId));
  const outboundLoanPlayerIds = new Set(
    market.activeLoansForParent(clubId, worldDate).map((loan) => loan.playerId),
  );
  const players = playersForClub(db, clubId).filter(
    (player) => activePlayerIds.has(player.playerId) && !outboundLoanPlayerIds.has(player.playerId),
  );
  const byGroup = new Map<string, number>();
  for (const player of players) {
    byGroup.set(player.positionGroup, (byGroup.get(player.positionGroup) ?? 0) + 1);
  }
  const needs: SquadNeed[] = [];
  for (const [group, minimum] of [
    ["GOALKEEPER", 2],
    ["DEFENDER", 7],
    ["MIDFIELDER", 6],
    ["FORWARD", 4],
  ] as const) {
    const count = byGroup.get(group) ?? 0;
    if (count < minimum) {
      needs.push({
        positionGroup: group,
        severity: count <= minimum - 2 ? "HIGH" : "MEDIUM",
        reason: `Squad has ${count} ${group.toLowerCase()} players against target ${minimum}`,
      });
    }
  }
  const expectedDepartures = contracts.filter(
    (contract) => contract.endDate <= addDays(worldDate, 120),
  ).length;
  if (expectedDepartures > 4) {
    needs.push({
      positionGroup: "DEPTH",
      severity: "MEDIUM",
      reason: `${expectedDepartures} contracts approach expiry`,
    });
  }
  return {
    id: createStableEntityId("squad-need-report", `${clubId}:${worldDate}`),
    clubId,
    generatedAt: worldDate,
    needs,
    expectedDepartures,
  };
};

export const createTransferOffer = (
  db: GameDatabase,
  input: {
    buyingClubId: EntityId;
    sellingClubId?: EntityId;
    playerId: EntityId;
    submittedAt: string;
    fee?: number;
    installments?: number;
    addOns?: number;
    sellOnPercentage?: number;
    conditionals?: TransferConditionalClause[];
    exchangePlayerIds?: EntityId[];
    sellerRequestedPlayerId?: EntityId;
  },
): TransferOffer => {
  const valuation = calculateTransferValuation(db, {
    buyingClubId: input.buyingClubId,
    sellingClubId: input.sellingClubId,
    playerId: input.playerId,
    worldDate: input.submittedAt,
  });
  const fee =
    input.fee ??
    Math.round(
      input.sellingClubId ? valuation.askingRange.min * 0.82 : midpoint(valuation.scoutEstimate),
    );
  const playerExchanges = input.exchangePlayerIds?.map((playerId) =>
    buildPlayerExchange(db, {
      playerId,
      fromClubId: input.buyingClubId,
      toClubId: input.sellingClubId ?? input.buyingClubId,
      worldDate: input.submittedAt,
      requestedBy: "BUYING_CLUB",
    }),
  );
  const representative = new TransferMarketRepository(db).agentForPlayer(input.playerId);
  const offer: TransferOffer = {
    id: createStableEntityId(
      "transfer-offer",
      `${input.buyingClubId}:${input.sellingClubId ?? "free"}:${input.playerId}:${input.submittedAt}:${fee}:${input.exchangePlayerIds?.join(",") ?? ""}`,
    ),
    buyingClubId: input.buyingClubId,
    sellingClubId: input.sellingClubId,
    playerId: input.playerId,
    offerType: input.sellingClubId ? "PERMANENT" : "FREE_TRANSFER",
    transferFee: input.sellingClubId ? fee : 0,
    installments: input.installments ?? 0,
    addOns: input.addOns ?? Math.round(fee * 0.1),
    sellOnPercentage: input.sellOnPercentage ?? (input.sellingClubId ? 5 : 0),
    submittedAt: input.submittedAt,
    expiresAt: addDays(input.submittedAt, 14),
    status: "SUBMITTED",
    currency,
    askingRange: input.sellingClubId ? valuation.askingRange : undefined,
    agentFee: representative ? Math.round(fee * (0.025 + representative.feeExpectation / 500)) : 0,
    signingFee: Math.round(fee * 0.08),
    buyerPerceivedValue: valuation.scoutEstimate,
    sellerInternalValue: valuation.internalValue,
    playerDesireToMove: valuation.playerDesireToMove,
    conditionals: input.conditionals,
    playerExchanges,
    sellerRequestedPlayerId: input.sellerRequestedPlayerId,
  };
  const market = new TransferMarketRepository(db);
  const existing = market.transferOffers().find((item) => item.id === offer.id);
  if (existing) return existing;
  market.insertTransferOffer(offer);
  market.insertNegotiationRound({
    id: createStableEntityId("negotiation-round", `${offer.id}:buyer:opening`),
    offerId: offer.id,
    roundNumber: 1,
    actor: "BUYING_CLUB",
    action: "OPENING_OFFER",
    message: "Opening offer submitted from the buying club valuation range",
    createdAt: input.submittedAt,
  });
  return offer;
};

export const evaluateTransferOffer = (
  db: GameDatabase,
  offer: TransferOffer,
  worldDate: string,
  seed: string,
): { accepted: boolean; reason: string } => {
  const market = new TransferMarketRepository(db);
  const network = new ClubNetworkRepository(db);
  if (
    offer.sellingClubId &&
    network.hasSameCompetitionConflict(offer.buyingClubId, offer.sellingClubId, worldDate)
  ) {
    market.updateOfferStatus(offer.id, "REJECTED");
    market.insertNegotiationRound({
      id: createStableEntityId("negotiation-round", `${offer.id}:governance:same-competition`),
      offerId: offer.id,
      roundNumber: market.negotiationRounds(offer.id).length + 1,
      actor: "SYSTEM",
      action: "REJECT",
      message: "Rejected: related clubs cannot complete a transfer while sharing a competition",
      createdAt: worldDate,
    });
    return { accepted: false, reason: "related clubs share a competition" };
  }
  const valuation = offer.sellerInternalValue
    ? {
        internalValue: offer.sellerInternalValue,
        askingRange: offer.askingRange ?? offer.sellerInternalValue,
      }
    : calculateTransferValuation(db, {
        buyingClubId: offer.buyingClubId,
        sellingClubId: offer.sellingClubId,
        playerId: offer.playerId,
        worldDate,
      });
  const packageValue = calculateTransferPackageValue(offer);
  if (
    offer.sellingClubId &&
    network.areRelatedClubs(offer.buyingClubId, offer.sellingClubId, worldDate)
  ) {
    const relatedParty = evaluateRelatedPartyTransfer({
      fee: packageValue,
      askingRange: valuation.askingRange,
      playerKnownToBuyer: Boolean(offer.buyerPerceivedValue),
      registrationAllowed: true,
    });
    if (!relatedParty.allowed) {
      market.updateOfferStatus(offer.id, "REJECTED");
      market.insertNegotiationRound({
        id: createStableEntityId("negotiation-round", `${offer.id}:governance:related-party`),
        offerId: offer.id,
        roundNumber: market.negotiationRounds(offer.id).length + 1,
        actor: "SYSTEM",
        action: "REJECT",
        message: `Rejected: ${relatedParty.reason}`,
        createdAt: worldDate,
      });
      return { accepted: false, reason: relatedParty.reason };
    }
  }
  const repeatedLowballs = market
    .transferOffers()
    .filter(
      (item) =>
        item.id !== offer.id &&
        item.buyingClubId === offer.buyingClubId &&
        item.sellingClubId === offer.sellingClubId &&
        item.playerId === offer.playerId &&
        item.status === "REJECTED" &&
        item.transferFee < valuation.askingRange.min * 0.82,
    ).length;
  const minimum = Math.round(
    valuation.askingRange.min * Math.min(0.98, 0.82 + repeatedLowballs * 0.08),
  );
  const accepted = !offer.sellingClubId || packageValue >= minimum;
  market.insertNegotiationRound({
    id: createStableEntityId("negotiation-round", `${offer.id}:seller:1`),
    offerId: offer.id,
    roundNumber: 2,
    actor: "SELLING_CLUB",
    action: accepted ? "ACCEPT" : "REJECT",
    message: accepted
      ? `Accepted within internal willingness range (${seed})`
      : `Rejected: package ${packageValue} below contextual range ${minimum}${repeatedLowballs > 0 ? " after repeated lowball offers" : ""}`,
    createdAt: worldDate,
  });
  market.updateOfferStatus(offer.id, accepted ? "ACCEPTED" : "REJECTED");
  return { accepted, reason: accepted ? "accepted" : "seller value not met" };
};

export const calculateTransferValuation = (
  db: GameDatabase,
  input: {
    playerId: EntityId;
    worldDate: string;
    buyingClubId?: EntityId;
    sellingClubId?: EntityId;
  },
): TransferValuationSnapshot => {
  const market = new TransferMarketRepository(db);
  const player = marketPlayer(db, input.playerId);
  const contract = market.activeContract(input.playerId, input.worldDate);
  const status = market.transferStatus(input.playerId);
  const sellerId = input.sellingClubId ?? contract?.clubId ?? player?.currentClubId;
  const sellerFinance = sellerId ? market.clubFinancialProfile(sellerId) : undefined;
  const buyerFinance = input.buyingClubId
    ? market.clubFinancialProfile(input.buyingClubId)
    : undefined;
  const role = contract?.squadRole ?? "ROTATION";
  const months = contract ? monthsBetween(input.worldDate, contract.endDate) : 0;
  const currentAbility = player?.currentAbility ?? 7;
  const potentialAbility = player?.potentialAbility ?? currentAbility + 1;
  const reputation = player?.reputation ?? 5;
  const base = Math.round(
    currentAbility * 62000 +
      Math.max(0, potentialAbility - currentAbility) * 36000 +
      reputation * 18000,
  );
  const contractExpiryLeverage = contractExpiryFactor(months);
  const agePotentialUncertainty =
    (player?.age ?? 24) <= 23 && potentialAbility > currentAbility + 1.5
      ? 1.14
      : (player?.age ?? 24) >= 32
        ? 0.84
        : 1;
  const sportingLevel = 0.9 + Math.min(0.35, currentAbility / 40 + squadRoleWeight(role) / 12);
  const reputationForm = 0.92 + Math.min(0.35, reputation / 40 + (player?.goals ?? 0) / 220);
  const leagueEconomicLevel = economicLevelFactor(db, sellerFinance);
  const internationalExposure =
    1 + Math.min(0.16, reputation / 100 + (player?.appearances ?? 0) / 900);
  const positionalScarcity = positionalScarcityFactor(db, sellerId, player?.positionGroup);
  const sellerFinancePressure = sellerFinancePressureFactor(sellerFinance);
  const playerImportance = squadRoleWeight(role);
  const replacementDifficulty = 0.86 + Math.min(0.42, positionalScarcity / 5 + currentAbility / 45);
  const windowTiming = windowTimingFactor(market, input.worldDate);
  const buyerWealthPerception = buyerWealthFactor(buyerFinance, sellerFinance);
  const playerDesire = playerDesireFactor(status?.status, months);
  const reluctance = status?.status === "NOT_FOR_SALE" ? 1.14 : 1;
  const internalMid = Math.round(
    base *
      contractExpiryLeverage *
      agePotentialUncertainty *
      sportingLevel *
      reputationForm *
      leagueEconomicLevel *
      internationalExposure *
      sellerFinancePressure *
      playerImportance *
      playerDesire,
  );
  const askingMid = Math.round(
    internalMid *
      reluctance *
      positionalScarcity *
      replacementDifficulty *
      windowTiming *
      buyerWealthPerception,
  );
  const knowledge = input.buyingClubId
    ? new RecruitmentRepository(db).playerKnowledge(input.buyingClubId, input.playerId)
    : undefined;
  const confidence = knowledgeConfidence(knowledge?.knowledgeLevel);
  const ageUncertainty = (player?.age ?? 24) <= 23 ? 0.18 : 0.1;
  const internalValue = valueRange(internalMid, 0.08 + ageUncertainty);
  const scoutEstimate = valueRange(internalMid, 0.34 - confidence * 0.18 + ageUncertainty);
  const askingRange = valueRange(askingMid, 0.16 + Math.max(0, buyerWealthPerception - 1) / 2);
  return {
    playerId: input.playerId,
    buyingClubId: input.buyingClubId,
    sellingClubId: sellerId,
    internalValue,
    scoutEstimate,
    askingRange,
    confidence,
    playerDesireToMove: playerDesire,
    factors: {
      contractExpiryLeverage,
      agePotentialUncertainty,
      sportingLevel,
      reputationForm,
      leagueEconomicLevel,
      internationalExposure,
      positionalScarcity,
      sellerFinancePressure,
      playerImportance,
      replacementDifficulty,
      windowTiming,
      buyerWealthPerception,
      playerDesire,
    },
  };
};

export const createTransferEnquiry = (
  db: GameDatabase,
  input: {
    buyingClubId: EntityId;
    sellingClubId: EntityId;
    playerId: EntityId;
    submittedAt: string;
  },
): TransferOffer => {
  const offer = createTransferOffer(db, { ...input, fee: 0, addOns: 0, sellOnPercentage: 0 });
  const market = new TransferMarketRepository(db);
  market.insertTransferOffer({ ...offer, status: "NEGOTIATING" });
  market.insertNegotiationRound({
    id: createStableEntityId("negotiation-round", `${offer.id}:buyer:enquiry`),
    offerId: offer.id,
    roundNumber: 2,
    actor: "BUYING_CLUB",
    action: "ENQUIRY",
    message: "Buying club asks whether the player is available",
    createdAt: input.submittedAt,
  });
  return { ...offer, status: "NEGOTIATING" };
};

export const respondToTransferEnquiry = (
  db: GameDatabase,
  offer: TransferOffer,
  worldDate: string,
): TransferOffer => {
  const valuation = calculateTransferValuation(db, {
    buyingClubId: offer.buyingClubId,
    sellingClubId: offer.sellingClubId,
    playerId: offer.playerId,
    worldDate,
  });
  const updated = { ...offer, askingRange: valuation.askingRange, status: "NEGOTIATING" as const };
  const market = new TransferMarketRepository(db);
  market.insertTransferOffer(updated);
  market.insertNegotiationRound({
    id: createStableEntityId("negotiation-round", `${offer.id}:seller:availability`),
    offerId: offer.id,
    roundNumber: 3,
    actor: "SELLING_CLUB",
    action: "AVAILABILITY_RESPONSE",
    message: "Selling club responds with a contextual asking range",
    createdAt: worldDate,
  });
  return updated;
};

export const counterTransferOffer = (
  db: GameDatabase,
  offer: TransferOffer,
  input: {
    worldDate: string;
    transferFee?: number;
    installments?: number;
    addOns?: number;
    sellOnPercentage?: number;
    conditionals?: TransferConditionalClause[];
    sellerRequestedPlayerId?: EntityId;
  },
): TransferOffer => {
  const exchange = input.sellerRequestedPlayerId
    ? [
        ...(offer.playerExchanges ?? []),
        buildPlayerExchange(db, {
          playerId: input.sellerRequestedPlayerId,
          fromClubId: offer.buyingClubId,
          toClubId: offer.sellingClubId ?? offer.buyingClubId,
          worldDate: input.worldDate,
          requestedBy: "SELLING_CLUB",
        }),
      ]
    : offer.playerExchanges;
  const counter: TransferOffer = {
    ...offer,
    transferFee: input.transferFee ?? offer.transferFee,
    installments: input.installments ?? offer.installments,
    addOns: input.addOns ?? offer.addOns,
    sellOnPercentage: input.sellOnPercentage ?? offer.sellOnPercentage,
    conditionals: input.conditionals ?? offer.conditionals,
    playerExchanges: exchange,
    sellerRequestedPlayerId: input.sellerRequestedPlayerId ?? offer.sellerRequestedPlayerId,
    status: "COUNTERED",
    expiresAt: addDays(input.worldDate, 10),
  };
  const market = new TransferMarketRepository(db);
  market.insertTransferOffer(counter);
  market.insertNegotiationRound({
    id: createStableEntityId("negotiation-round", `${offer.id}:seller:counter:${input.worldDate}`),
    offerId: offer.id,
    roundNumber: market.negotiationRounds(offer.id).length + 1,
    actor: "SELLING_CLUB",
    action: "COUNTER",
    message: input.sellerRequestedPlayerId
      ? "Selling club counters and requests a specific player exchange"
      : "Selling club counters with revised package terms",
    createdAt: input.worldDate,
  });
  return counter;
};

export const acceptTransferOffer = (
  db: GameDatabase,
  offer: TransferOffer,
  worldDate: string,
): void => {
  const market = new TransferMarketRepository(db);
  market.updateOfferStatus(offer.id, "ACCEPTED");
  market.insertNegotiationRound({
    id: createStableEntityId("negotiation-round", `${offer.id}:seller:accept:${worldDate}`),
    offerId: offer.id,
    roundNumber: market.negotiationRounds(offer.id).length + 1,
    actor: "SELLING_CLUB",
    action: "ACCEPT",
    message: "Selling club accepts the negotiated package",
    createdAt: worldDate,
  });
};

export const rejectTransferOffer = (
  db: GameDatabase,
  offer: TransferOffer,
  worldDate: string,
): void => {
  const market = new TransferMarketRepository(db);
  market.updateOfferStatus(offer.id, "REJECTED");
  market.insertNegotiationRound({
    id: createStableEntityId("negotiation-round", `${offer.id}:seller:reject:${worldDate}`),
    offerId: offer.id,
    roundNumber: market.negotiationRounds(offer.id).length + 1,
    actor: "SELLING_CLUB",
    action: "REJECT",
    message: "Selling club rejects the negotiated package",
    createdAt: worldDate,
  });
};

export const calculateTransferPackageValue = (offer: TransferOffer): number =>
  Math.round(
    offer.transferFee +
      offer.installments * 0.86 +
      offer.addOns * 0.42 +
      (offer.conditionals ?? []).reduce((total, clause) => total + clause.amount * 0.38, 0) +
      (offer.playerExchanges ?? []).reduce(
        (total, exchange) => total + midpoint(exchange.valuation) * 0.9,
        0,
      ),
  );

export type AgentInterestAssessment = {
  playerId: EntityId;
  score: number;
  shouldApproach: boolean;
  recommendedNetwork: AgentNetworkScope;
  factors: {
    clubLevel: number;
    reputation: number;
    seniorCallups: number;
    seniorAppearances: number;
    youthInternationalExposure: number;
    foreignInterest: number;
    foreignBased: number;
    potentialAge: number;
    marketActivity: number;
    playerAmbition: number;
  };
};

export type PlayerPersonalTermsPreferences = {
  expectedPlayingTime?: PlayerSquadRole;
  preferredCountries?: string[];
  prefersOverseas?: boolean;
  minimumClubLevel?: number;
  continentalOpportunity?: boolean;
  currentClubSatisfaction?: number;
  ambition?: number;
  careerStage?: "PROSPECT" | "PRIME" | "VETERAN";
  securityPreference?: number;
};

export type PlayerPersonalTermsResult = {
  state: PlayerPersonalTermsState;
  proposal: PlayerPersonalTerms;
  score: number;
  reason: string;
  preferredOfferId?: EntityId;
  represented: boolean;
  /**
   * Wage the player treats as the baseline for this move, and the squad role
   * they expect. A stalled buyer needs both to know what "improved personal
   * terms" actually means; without them the AI can only guess, which is why
   * negotiations used to deadlock.
   */
  salaryFloor?: number;
  expectedSquadRole?: PlayerContractRecord["squadRole"];
};

export const assessAgentInterest = (
  db: GameDatabase,
  input: {
    playerId: EntityId;
    worldDate: string;
    foreignInterest?: boolean;
    foreignBased?: boolean;
    youthInternationalExposure?: boolean;
    competitionExposure?: "NONE" | "SAFF" | "ASIAN_CUP" | "FOREIGN_MOVE";
    playerAmbition?: number;
  },
): AgentInterestAssessment => {
  const player = marketPlayer(db, input.playerId);
  const market = new TransferMarketRepository(db);
  const contract = market.activeContract(input.playerId, input.worldDate);
  const club = contract?.clubId
    ? marketClubs(db).find((item) => item.id === contract.clubId)
    : undefined;
  const clubLevel = club ? Math.round(clubSalaryMultiplier(club) * 12) : 3;
  const seniorCallups = seniorCallupCount(db, input.playerId, input.worldDate);
  const seniorAppearances = seniorAppearanceCount(db, input.playerId, input.worldDate);
  const youthInternationalExposure =
    input.youthInternationalExposure || youthCallupCount(db, input.playerId, input.worldDate) > 0
      ? 1
      : 0;
  const foreignInterest =
    input.foreignInterest || foreignInterestCount(db, input.playerId, input.worldDate) > 0 ? 1 : 0;
  const foreignBased = input.foreignBased || isForeignBased(db, player?.currentClubId) ? 1 : 0;
  const marketActivity = Math.min(
    12,
    market.transferOffers().filter((offer) => offer.playerId === input.playerId).length * 3,
  );
  const playerAmbition =
    input.playerAmbition ?? 4 + (Math.abs(hashCode(String(input.playerId))) % 9);
  const potentialAge =
    (player?.age ?? 25) <= 23 ? Math.max(0, (player?.potentialAbility ?? 8) - 7) * 1.8 : 0;
  const competitionBoost =
    input.competitionExposure === "FOREIGN_MOVE"
      ? 16
      : input.competitionExposure === "ASIAN_CUP"
        ? 13
        : input.competitionExposure === "SAFF"
          ? 8
          : 0;
  const score =
    clubLevel +
    (player?.reputation ?? 4) * 0.45 +
    seniorCallups * 18 +
    seniorAppearances * 5 +
    youthInternationalExposure * 7 +
    foreignInterest * 16 +
    foreignBased * 24 +
    potentialAge +
    marketActivity +
    playerAmbition * 1.6 +
    competitionBoost;
  const recommendedNetwork = recommendedAgentNetwork({
    score,
    seniorAppearances,
    foreignInterest,
    foreignBased,
    competitionExposure: input.competitionExposure,
  });
  return {
    playerId: input.playerId,
    score,
    shouldApproach: score >= 52,
    recommendedNetwork,
    factors: {
      clubLevel,
      reputation: player?.reputation ?? 4,
      seniorCallups,
      seniorAppearances,
      youthInternationalExposure,
      foreignInterest,
      foreignBased,
      potentialAge,
      marketActivity,
      playerAmbition,
    },
  };
};

export const processAgentRepresentation = (
  db: GameDatabase,
  input: {
    playerId: EntityId;
    worldDate: string;
    seed: string;
    trigger: AgentApproachRecord["trigger"];
    decision?: AgentApproachRecord["decision"];
    foreignInterest?: boolean;
    foreignBased?: boolean;
    youthInternationalExposure?: boolean;
    competitionExposure?: "NONE" | "SAFF" | "ASIAN_CUP" | "FOREIGN_MOVE";
    playerAmbition?: number;
  },
): AgentApproachRecord | undefined => {
  const market = new TransferMarketRepository(db);
  const assessment = assessAgentInterest(db, input);
  if (!assessment.shouldApproach) {
    return undefined;
  }
  const currentAgent = market.agentForPlayer(input.playerId);
  const agent = selectAgentForPlayer(
    db,
    assessment.recommendedNetwork,
    input.seed,
    currentAgent?.id,
  );
  if (!agent) {
    return undefined;
  }
  const rng = new SeededRandom(`${input.seed}:agent-decision:${input.playerId}:${agent.id}`);
  const decision =
    input.decision ??
    (assessment.score +
      agent.reputation +
      agent.negotiationSkill -
      agent.feeExpectation +
      rng.next() * 18 >
    76
      ? "SIGNED"
      : "DECLINED");
  const approach: AgentApproachRecord = {
    id: createStableEntityId(
      "agent-approach",
      `${agent.id}:${input.playerId}:${input.worldDate}:${input.trigger}`,
    ),
    agentId: agent.id,
    playerId: input.playerId,
    approachedAt: input.worldDate,
    trigger: input.trigger,
    interestScore: Math.round(assessment.score * 100) / 100,
    networkScope: agent.networkScope,
    decision,
    decidedAt: decision === "APPROACHED" ? undefined : input.worldDate,
  };
  market.insertAgentApproach(approach);
  if (decision === "SIGNED") {
    market.endActiveAgentClient(input.playerId);
    market.upsertAgentClient({
      id: createStableEntityId("agent-client", `${agent.id}:${input.playerId}:${input.worldDate}`),
      agentId: agent.id,
      playerId: input.playerId,
      startedAt: input.worldDate,
      status: "ACTIVE",
    });
    upsertPersonRelationship({
      db,
      fromPersonId: input.playerId,
      toPersonId: agent.personId,
      kind: "PLAYER_AGENT",
      affinity: 62,
      trust: 60,
      respect: 58,
      tension: 4,
      date: input.worldDate,
    });
  }
  return approach;
};

const roleRank = (role: PlayerSquadRole): number =>
  ({
    KEY_PLAYER: 6,
    IMPORTANT_PLAYER: 5,
    FIRST_TEAM: 4,
    ROTATION: 3,
    BACKUP: 2,
    PROSPECT: 1,
    YOUTH: 0,
  })[role];

const clubSportingLevel = (db: GameDatabase, clubId: EntityId): number => {
  const rows = db
    .prepare("SELECT level FROM teams WHERE club_id = ? AND gender = 'MEN' ORDER BY level")
    .all(clubId) as Array<{ level: string }>;
  const level = rows[0]?.level?.toUpperCase() ?? "";
  if (level.includes("NATIONAL") || level.includes("PREMIER")) return 5;
  if (level.includes("A")) return 4;
  if (level.includes("B")) return 3;
  return 2;
};

const clubCountryCode = (db: GameDatabase, clubId: EntityId): string | undefined =>
  (
    db
      .prepare(
        "SELECT c.iso_code FROM countries c JOIN clubs cl ON cl.country_id = c.id WHERE cl.id = ?",
      )
      .get(clubId) as { iso_code?: string } | undefined
  )?.iso_code;

const defaultPersonalTerms = (
  db: GameDatabase,
  offer: TransferOffer,
  worldDate: string,
  seed: string,
): PlayerPersonalTerms => {
  const player = marketPlayer(db, offer.playerId);
  const agent = new TransferMarketRepository(db).agentForPlayer(offer.playerId);
  const current = new TransferMarketRepository(db).activeContract(offer.playerId, worldDate);
  const rng = new SeededRandom(`${seed}:player-terms:${offer.id}`);
  const salary = Math.max(
    current?.salary ?? 0,
    Math.round(
      ((player?.currentAbility ?? 7) * 18000 + (agent?.feeExpectation ?? 8) * 2500) *
        (agent ? 1.04 + agent.negotiationSkill / 220 + agent.aggressiveness / 260 : 0.94) *
        (1 + rng.next() * 0.12),
    ),
  );
  return {
    salary,
    contractLengthMonths: 10 + Math.floor(rng.next() * 14),
    squadRole: salary > 190000 ? "FIRST_TEAM" : salary > 130000 ? "ROTATION" : "BACKUP",
    signingFee: offer.signingFee,
    agentFee: agent ? offer.agentFee : 0,
  };
};

const latestPersonalTerms = (
  db: GameDatabase,
  offer: TransferOffer,
  worldDate: string,
  seed: string,
): PlayerPersonalTerms => {
  const fallback = defaultPersonalTerms(db, offer, worldDate, seed);
  const round = new TransferMarketRepository(db)
    .negotiationRounds(offer.id)
    .filter((item) => item.actor === "PLAYER" || item.actor === "PLAYER_AGENT")
    .at(-1);
  return round?.salary && round.squadRole && round.contractLengthMonths
    ? {
        ...fallback,
        salary: round.salary,
        squadRole: round.squadRole,
        contractLengthMonths: round.contractLengthMonths,
        agentFee: round.agentFee ?? fallback.agentFee,
        signingFee: round.signingFee ?? fallback.signingFee,
      }
    : fallback;
};

const playerChoiceScore = (
  offer: TransferOffer,
  terms: PlayerPersonalTerms,
  preferences: PlayerPersonalTermsPreferences = {},
): number => {
  const roleValue: Record<PlayerSquadRole, number> = {
    KEY_PLAYER: 7,
    IMPORTANT_PLAYER: 6,
    FIRST_TEAM: 5,
    ROTATION: 3,
    BACKUP: 1,
    PROSPECT: 2,
    YOUTH: 0,
  };
  const preferredRole = preferences.expectedPlayingTime;
  const roleScore = preferredRole
    ? (roleValue[terms.squadRole] - roleValue[preferredRole]) * 9
    : roleValue[terms.squadRole] * 2;
  const securityScore = (preferences.securityPreference ?? 6) * terms.contractLengthMonths * 0.12;
  const packageScore = Math.min(24, calculateTransferPackageValue(offer) / 250_000);
  const agentFeePenalty = terms.agentFee > 0 ? Math.min(8, terms.agentFee / 100_000) : 0;
  return terms.salary / 10_000 + roleScore + securityScore + packageScore - agentFeePenalty;
};

export const negotiatePlayerTerms = (
  db: GameDatabase,
  offer: TransferOffer,
  input: {
    worldDate: string;
    seed: string;
    proposal?: Partial<PlayerPersonalTerms>;
    preferences?: PlayerPersonalTermsPreferences;
    action?: "ACCEPT" | "REJECT" | "COUNTER";
    counterProposal?: Partial<PlayerPersonalTerms>;
  },
): PlayerPersonalTermsResult => {
  const market = new TransferMarketRepository(db);
  input.preferences = effectiveAgentPlayerPreferences(db, offer.playerId, input.preferences ?? {});
  const agent = market.agentForPlayer(offer.playerId);
  const base = defaultPersonalTerms(db, offer, input.worldDate, input.seed);
  const proposal: PlayerPersonalTerms = {
    ...base,
    ...input.proposal,
  };
  if (input.action === "COUNTER") {
    const counter: PlayerPersonalTerms = {
      ...proposal,
      ...input.counterProposal,
    };
    market.insertNegotiationRound({
      id: createStableEntityId(
        "negotiation-round",
        `${offer.id}:player:counter:${input.worldDate}`,
      ),
      offerId: offer.id,
      roundNumber: market.negotiationRounds(offer.id).length + 1,
      actor: agent ? "PLAYER_AGENT" : "PLAYER",
      action: "COUNTER",
      salary: counter.salary,
      squadRole: counter.squadRole,
      contractLengthMonths: counter.contractLengthMonths,
      agentFee: counter.agentFee,
      signingFee: counter.signingFee,
      message: agent
        ? "Agent counters the personal terms"
        : "Player counters the personal terms directly",
      createdAt: input.worldDate,
    });
    market.updateOfferStatus(offer.id, "PLAYER_NEGOTIATING");
    return {
      state: "COUNTERED",
      proposal: counter,
      score: 0,
      reason: "player counter-proposal",
      represented: Boolean(agent),
    };
  }

  /*
   * Callers hand over the offer object they created, but the selling club's
   * acceptance is written straight to the repository — so that object is
   * routinely a stage behind. Reading the persisted status here is what lets an
   * accepted deal reach the player at all; trusting the caller's copy stalled
   * every AI transfer on "club agreement is not complete".
   */
  const persistedStatus =
    market.transferOffers().find((item) => item.id === offer.id)?.status ?? offer.status;
  /*
   * PLAYER_STALLED belongs here: it means the player is waiting on better
   * terms, which is precisely the state a revised offer has to be judged in.
   * Excluding it made the buying club's improved offer unreachable.
   */
  if (
    !["ACCEPTED", "PLAYER_NEGOTIATING", "PLAYER_ACCEPTED", "PLAYER_STALLED"].includes(
      persistedStatus,
    )
  ) {
    return {
      state: "STALLED",
      proposal,
      score: 0,
      reason: "club agreement is not complete",
      represented: Boolean(agent),
    };
  }
  const player = marketPlayer(db, offer.playerId);
  const current = market.activeContract(offer.playerId, input.worldDate);
  const prefs = input.preferences ?? {};
  const destinationCountry = clubCountryCode(db, offer.buyingClubId);
  const expectedRole = prefs.expectedPlayingTime ?? (player ? squadRoleFor(player) : "ROTATION");
  const destinationLevel = clubSportingLevel(db, offer.buyingClubId);
  const salaryFloor = Math.max(
    current?.salary ? Math.round(current.salary * (agent ? 1.03 : 1.01)) : 0,
    Math.round((player?.currentAbility ?? 7) * 12500),
  );
  const roleDelta = roleRank(proposal.squadRole) - roleRank(expectedRole);
  const roleScore = roleDelta >= 0 ? 24 : roleDelta === -1 ? -8 : -30;
  const salaryScore = Math.max(
    -35,
    Math.min(28, ((proposal.salary - salaryFloor) / Math.max(salaryFloor, 1)) * 28),
  );
  const levelScore = destinationLevel >= (prefs.minimumClubLevel ?? 0) ? 10 : -12;
  const countryPreferred = Boolean(
    destinationCountry && prefs.preferredCountries?.includes(destinationCountry),
  );
  const overseasScore =
    prefs.prefersOverseas === undefined
      ? 0
      : prefs.prefersOverseas === (destinationCountry !== "NP")
        ? 14
        : -14;
  const preferenceScore = (countryPreferred ? 10 : 0) + overseasScore;
  const ambitionScore =
    ((prefs.ambition ?? Math.min(15, Math.round((player?.potentialAbility ?? 8) / 2))) - 7) * 1.8;
  const securityScore =
    (prefs.securityPreference ?? 6) >= 8 && proposal.contractLengthMonths >= 24 ? 10 : 0;
  const continentalScore = prefs.continentalOpportunity ? (destinationLevel >= 4 ? 10 : -8) : 0;
  const careerStageScore =
    prefs.careerStage === "PROSPECT" && proposal.contractLengthMonths >= 24
      ? 7
      : prefs.careerStage === "VETERAN" && destinationLevel < 3
        ? -8
        : 0;
  const satisfactionScore =
    prefs.currentClubSatisfaction !== undefined ? (50 - prefs.currentClubSatisfaction) / 4 : 0;
  const representationRelationship = agent
    ? new PeopleFoundationRepository(db).relationship(
        offer.playerId,
        agent.personId,
        "PLAYER_AGENT",
      )
    : undefined;
  const representationTrustScore = representationRelationship
    ? (representationRelationship.trust - 50) * 0.18 +
      (representationRelationship.affinity - 50) * 0.12 +
      (representationRelationship.respect - 50) * 0.08 -
      representationRelationship.tension * 0.06
    : 0;
  const competing = market
    .transferOffers()
    .filter(
      (item) =>
        item.playerId === offer.playerId &&
        item.id !== offer.id &&
        [
          "SUBMITTED",
          "ACCEPTED",
          "PLAYER_ACCEPTED",
          "NEGOTIATING",
          "COUNTERED",
          "COMPETING_OFFER",
        ].includes(item.status),
    );
  const competingOffer = competing
    .map((item) => ({ item, terms: defaultPersonalTerms(db, item, input.worldDate, input.seed) }))
    .sort(
      (a, b) =>
        b.terms.salary - a.terms.salary || String(a.item.id).localeCompare(String(b.item.id)),
    )[0];
  const competingScore =
    competingOffer && competingOffer.terms.salary > proposal.salary * 1.12 ? -24 : 0;
  let score =
    roleScore +
    salaryScore +
    levelScore +
    preferenceScore +
    ambitionScore +
    securityScore +
    continentalScore +
    careerStageScore +
    satisfactionScore +
    representationTrustScore +
    competingScore;
  let state: PlayerPersonalTermsState;
  let reason: string;
  if (input.action === "REJECT") {
    state = "REJECTED";
    reason = "player or representative rejected the personal terms";
  } else if (input.action === "ACCEPT") {
    state = "ACCEPTED";
    reason = "player accepted the personal terms";
  } else if (competingScore < 0 && competingOffer) {
    state = "COMPETING_OFFER";
    reason = "player prefers a competing offer";
  } else if (score < -20) {
    state = "REJECTED";
    reason =
      roleScore < -20 ? "squad role is below expectations" : "wage and career terms are inadequate";
  } else if (score < 8) {
    state = "STALLED";
    reason = "player wants improved personal terms";
  } else {
    state = "ACCEPTED";
    reason = "player accepted the personal terms";
  }
  const action =
    state === "COMPETING_OFFER"
      ? "COMPETING_OFFER"
      : state === "STALLED"
        ? "STALL"
        : state === "ACCEPTED"
          ? "ACCEPT"
          : "REJECT";
  market.insertNegotiationRound({
    id: createStableEntityId(
      "negotiation-round",
      `${offer.id}:player:${input.worldDate}:${action}:${input.seed}`,
    ),
    offerId: offer.id,
    roundNumber: market.negotiationRounds(offer.id).length + 1,
    actor: agent ? "PLAYER_AGENT" : "PLAYER",
    action,
    salary: proposal.salary,
    squadRole: proposal.squadRole,
    contractLengthMonths: proposal.contractLengthMonths,
    agentFee: proposal.agentFee,
    signingFee: proposal.signingFee,
    message: reason,
    createdAt: input.worldDate,
  });
  const status =
    state === "ACCEPTED"
      ? "PLAYER_ACCEPTED"
      : state === "REJECTED"
        ? "PLAYER_REJECTED"
        : state === "COMPETING_OFFER"
          ? "COMPETING_OFFER"
          : "PLAYER_STALLED";
  market.updateOfferStatus(offer.id, status);
  return {
    salaryFloor,
    expectedSquadRole: expectedRole,
    state,
    proposal,
    score: Math.round(score * 100) / 100,
    reason,
    preferredOfferId: competingOffer?.item.id,
    represented: Boolean(agent),
  };
};

export const negotiatePlayerContract = (
  db: GameDatabase,
  offer: TransferOffer,
  worldDate: string,
  seed: string,
): PlayerContractRecord => {
  const player = marketPlayer(db, offer.playerId);
  const agent = new TransferMarketRepository(db).agentForPlayer(offer.playerId);
  const current = new TransferMarketRepository(db).activeContract(offer.playerId, worldDate);
  const rng = new SeededRandom(`${seed}:player-negotiation:${offer.id}`);
  const representationMultiplier = agent
    ? 1.04 + agent.negotiationSkill / 220 + agent.aggressiveness / 260
    : 0.94;
  const currentSalaryFloor = agent
    ? Math.round((current?.salary ?? 0) * 1.03)
    : (current?.salary ?? 0);
  const salary = Math.max(
    currentSalaryFloor,
    Math.round(
      ((player?.currentAbility ?? 7) * 18000 + (agent?.feeExpectation ?? 8) * 2500) *
        representationMultiplier *
        (1 + rng.next() * 0.12),
    ),
  );
  const role = salary > 190000 ? "FIRST_TEAM" : salary > 130000 ? "ROTATION" : "BACKUP";
  const length = 10 + Math.floor(rng.next() * 14);
  const market = new TransferMarketRepository(db);
  market.insertNegotiationRound({
    id: createStableEntityId("negotiation-round", `${offer.id}:agent:2`),
    offerId: offer.id,
    roundNumber: 2,
    actor: "PLAYER_AGENT",
    action: "DEMAND",
    salary,
    squadRole: role,
    contractLengthMonths: length,
    agentFee: agent ? offer.agentFee : 0,
    signingFee: offer.signingFee,
    message: agent
      ? `${agent.negotiationStyle} ${agent.networkScope} agent seeks role and fee guarantees`
      : "Self-represented player negotiates direct salary and signing terms",
    createdAt: worldDate,
  });
  market.insertNegotiationRound({
    id: createStableEntityId("negotiation-round", `${offer.id}:buyer:3`),
    offerId: offer.id,
    roundNumber: 3,
    actor: "BUYING_CLUB",
    action: "ACCEPT",
    salary,
    squadRole: role,
    contractLengthMonths: length,
    agentFee: agent ? offer.agentFee : 0,
    signingFee: offer.signingFee,
    message: "Buying club accepts within wage budget envelope",
    createdAt: worldDate,
  });
  return {
    id: createStableEntityId(
      "player-contract",
      `${offer.playerId}:${offer.buyingClubId}:${worldDate}`,
    ),
    playerId: offer.playerId,
    clubId: offer.buyingClubId,
    startDate: worldDate,
    endDate: addMonths(worldDate, length),
    contractType: "SIMULATION_ONLY",
    salary,
    appearanceFee: Math.round(salary * 0.08),
    goalBonus: Math.round(salary * 0.12),
    cleanSheetBonus: Math.round(salary * 0.1),
    signingBonus: offer.signingFee,
    loyaltyBonus: 0,
    currency,
    squadRole: role,
    releaseClause: Math.round((offer.transferFee + salary * 6) * 2),
    status: "ACTIVE",
    provenance: simulationOnlyProvenance("Generated player contract negotiation terms"),
  };
};

/**
 * The buying club's single improved offer after a stall: clear the player's
 * wage baseline with a modest margin, and lengthen the deal to the point where
 * contract security counts in the player's favour. Both steps are capped so a
 * revision can never spiral, and the result is still only a proposal.
 */
const MAX_REVISION_MULTIPLE = 1.6;
const SECURE_CONTRACT_MONTHS = 24;

const revisedPersonalTerms = (
  terms: PlayerPersonalTermsResult,
): PlayerPersonalTerms | undefined => {
  const floor = terms.salaryFloor;
  if (!floor || !Number.isFinite(floor)) return undefined;
  const target = Math.max(Math.round(floor * 1.15), Math.round(terms.proposal.salary * 1.15));
  const salary = Math.min(target, Math.round(terms.proposal.salary * MAX_REVISION_MULTIPLE));
  const squadRole = terms.expectedSquadRole ?? terms.proposal.squadRole;
  const contractLengthMonths = Math.max(
    terms.proposal.contractLengthMonths,
    SECURE_CONTRACT_MONTHS,
  );
  const improved =
    salary > terms.proposal.salary ||
    squadRole !== terms.proposal.squadRole ||
    contractLengthMonths > terms.proposal.contractLengthMonths;
  if (!improved) return undefined;
  return {
    ...terms.proposal,
    salary: Math.max(salary, terms.proposal.salary),
    squadRole,
    contractLengthMonths,
  };
};

const persistSellOnEntitlement = (db: GameDatabase, offer: TransferOffer): void => {
  if (!offer.sellingClubId || offer.sellOnPercentage <= 0) return;
  if (!Number.isFinite(offer.sellOnPercentage) || offer.sellOnPercentage > 100) return;
  const entitlement: SellOnEntitlement = {
    id: createStableEntityId("sell-on-entitlement", offer.id),
    playerId: offer.playerId,
    entitledClubId: offer.sellingClubId,
    originatingTransferId: offer.id,
    originatingSellerClubId: offer.sellingClubId,
    originatingBuyerClubId: offer.buyingClubId,
    percentage: offer.sellOnPercentage,
    basis: "TOTAL_RESALE_FEE",
    status: "ACTIVE",
  };
  new TransferMarketRepository(db).upsertSellOnEntitlement(entitlement);
};

const settleSellOnEntitlements = (
  db: GameDatabase,
  resale: TransferOffer,
  worldDate: string,
): void => {
  if (!resale.sellingClubId) return;
  const market = new TransferMarketRepository(db);
  for (const entitlement of market.activeSellOnEntitlements(
    resale.playerId,
    resale.sellingClubId,
  )) {
    const amount = Math.max(0, Math.round((resale.transferFee * entitlement.percentage) / 100));
    if (amount > 0) {
      postClubTransaction(db, {
        clubId: resale.sellingClubId,
        date: worldDate,
        category: "SELL_ON_PAYMENT",
        direction: "DEBIT",
        amount,
        description: "Sell-on clause payment",
        relatedEntityId: resale.id,
        idempotencyKey: `sell-on-payment:${resale.id}:${entitlement.id}:${entitlement.entitledClubId}`,
      });
      postClubTransaction(db, {
        clubId: entitlement.entitledClubId,
        date: worldDate,
        category: "SELL_ON_INCOME",
        direction: "CREDIT",
        amount,
        description: "Sell-on clause income",
        relatedEntityId: resale.id,
        idempotencyKey: `sell-on-income:${resale.id}:${entitlement.id}:${entitlement.entitledClubId}`,
      });
      market.insertTransferHistoryEvent({
        id: createStableEntityId("transfer-history", `${resale.id}:sell-on:${entitlement.id}`),
        playerId: resale.playerId,
        clubId: entitlement.entitledClubId,
        relatedClubId: resale.sellingClubId,
        eventType: "SELL_ON_CLAUSE_PAID",
        occurredOn: worldDate,
        data: {
          resaleTransferId: resale.id,
          originatingTransferId: entitlement.originatingTransferId,
          amount,
          percentage: entitlement.percentage,
        },
      });
    }
    market.upsertSellOnEntitlement({
      ...entitlement,
      status: "SETTLED",
      settledTransferId: resale.id,
      settledOn: worldDate,
    });
  }
};

/**
 * Promote a completed transfer-history transition into the canonical public
 * event stream. The transfer tables remain authoritative; this projection is
 * deliberately Nepal-scoped and insert-idempotent so replaying a settlement
 * cannot create duplicate media or role deliveries.
 */
const emitTransferPublicEvent = (
  db: GameDatabase,
  input: {
    sourceId: EntityId;
    occurredOn: string;
    eventType: string;
    title: string;
    playerId: EntityId;
    clubId: EntityId;
    relatedClubId?: EntityId;
    data?: Record<string, unknown>;
    importance?: "medium" | "high";
  },
): void => {
  const clubs = [input.clubId, input.relatedClubId].filter((clubId): clubId is EntityId =>
    Boolean(clubId),
  );
  if (!clubs.some((clubId) => isNepalClub(db, clubId))) return;
  const id = createStableEntityId("history", `TRANSFER_PUBLIC:${input.sourceId}`);
  if (!db.prepare("SELECT 1 FROM historical_events WHERE id=?").get(id)) {
    new EventRepository(db).insertHistoricalEvent({
      id,
      occurredOn: input.occurredOn,
      eventType: input.eventType,
      involvedEntities: [
        { id: input.playerId, type: "person" },
        ...clubs.map((clubId) => ({ id: clubId, type: "club" as const })),
      ],
      title: input.title,
      data: input.data,
      importance: input.importance ?? "medium",
      scope: "club",
    });
  }
};

export const completePermanentTransfer = (
  db: GameDatabase,
  offer: TransferOffer,
  worldDate: string,
  seed: string,
  playerPreferences?: PlayerPersonalTermsPreferences,
  playerProposal?: Partial<PlayerPersonalTerms>,
): void => {
  const market = new TransferMarketRepository(db);
  const persistedOffer = market.transferOffers().find((item) => item.id === offer.id);
  if (!persistedOffer || persistedOffer.status === "COMPLETED") return;
  const currentContract = market.activeContract(offer.playerId, worldDate);
  if (
    market
      .transferOffers()
      .some((item) => item.playerId === offer.playerId && item.status === "COMPLETED") &&
    (!currentContract || !offer.sellingClubId || currentContract.clubId !== offer.sellingClubId)
  ) {
    market.updateOfferStatus(offer.id, "REJECTED");
    return;
  }
  let personalTerms = negotiatePlayerTerms(db, offer, {
    worldDate,
    seed,
    preferences: playerPreferences,
    proposal: playerProposal,
  });
  /*
   * A stall is the player asking for better terms, not a refusal. The buying
   * club previously never answered, so every permanent deal deadlocked here.
   * It now gets exactly one revision: meet the wage the player is holding out
   * for and offer the security of a longer deal, but only inside the wage
   * budget. The player then re-decides through the same logic — this improves
   * the offer, it does not force acceptance, and a single round keeps the
   * negotiation bounded.
   */
  if (personalTerms.state === "STALLED") {
    const improved = revisedPersonalTerms(personalTerms);
    if (!improved || !clubCanAffordWage(db, offer.buyingClubId, improved.salary, worldDate)) {
      market.updateOfferStatus(offer.id, "WITHDRAWN");
      return;
    }
    personalTerms = negotiatePlayerTerms(db, offer, {
      worldDate,
      seed,
      preferences: playerPreferences,
      proposal: improved,
    });
    if (personalTerms.state === "STALLED") {
      market.updateOfferStatus(offer.id, "WITHDRAWN");
      return;
    }
  }
  if (personalTerms.state !== "ACCEPTED") {
    if (personalTerms.state === "REJECTED" || personalTerms.state === "COMPETING_OFFER") {
      market.updateOfferStatus(
        offer.id,
        personalTerms.state === "REJECTED" ? "PLAYER_REJECTED" : "COMPETING_OFFER",
      );
    }
    return;
  }
  const contract = negotiatePlayerContract(db, offer, worldDate, seed);
  if (!clubCanAffordWage(db, offer.buyingClubId, contract.salary, worldDate)) {
    market.updateOfferStatus(offer.id, "REJECTED");
    return;
  }
  const oldContract = market.activeContract(offer.playerId, worldDate);
  if (oldContract) {
    market.markContractStatus(oldContract.id, "TERMINATED");
  }
  market.upsertPlayerContract(contract);
  movePlayerAssignment(db, offer.playerId, offer.buyingClubId, worldDate);
  market.updatePlayerClub(offer.playerId, offer.buyingClubId);
  market.updateOfferStatus(offer.id, "COMPLETED");
  for (const competing of market
    .transferOffers()
    .filter(
      (item) =>
        item.playerId === offer.playerId &&
        item.id !== offer.id &&
        [
          "SUBMITTED",
          "NEGOTIATING",
          "ACCEPTED",
          "PLAYER_ACCEPTED",
          "COMPETING_OFFER",
          "COUNTERED",
        ].includes(item.status),
    )) {
    market.updateOfferStatus(competing.id, "REJECTED");
  }
  market.upsertTransferStatus({
    id: createStableEntityId("player-transfer-status", offer.playerId),
    playerId: offer.playerId,
    clubId: offer.buyingClubId,
    status: "NOT_FOR_SALE",
    reason: "Recently signed",
    setBy: "SYSTEM",
    updatedAt: worldDate,
  });
  const transferHistoryId = createStableEntityId(
    "transfer-history",
    `${offer.playerId}:transfer:${worldDate}:${offer.id}`,
  );
  market.insertTransferHistoryEvent({
    id: transferHistoryId,
    playerId: offer.playerId,
    clubId: offer.buyingClubId,
    relatedClubId: offer.sellingClubId,
    eventType: offer.offerType === "FREE_TRANSFER" ? "FREE_AGENT_SIGNED" : "TRANSFER_COMPLETED",
    occurredOn: worldDate,
    data: { transferFee: offer.transferFee, currency: offer.currency },
  });
  emitTransferPublicEvent(db, {
    sourceId: transferHistoryId,
    occurredOn: worldDate,
    eventType: offer.offerType === "FREE_TRANSFER" ? "FREE_AGENT_SIGNED" : "TRANSFER_COMPLETED",
    title:
      offer.offerType === "FREE_TRANSFER" ? "Free-agent signing completed" : "Transfer completed",
    playerId: offer.playerId,
    clubId: offer.buyingClubId,
    relatedClubId: offer.sellingClubId,
    data: { transferHistoryId, transferFee: offer.transferFee, currency: offer.currency },
    importance: offer.transferFee >= 1_000_000 ? "high" : "medium",
  });
  recordTransferEconomy(db, offer, worldDate);
  settleAgentFee(db, {
    playerId: offer.playerId,
    payerClubId: offer.buyingClubId,
    amount: offer.agentFee,
    sourceEntityId: offer.id,
    eventType: offer.offerType === "FREE_TRANSFER" ? "FREE_AGENT_SIGNING" : "TRANSFER",
    date: worldDate,
  });
  /* The existing transfer expense already includes the negotiated agent fee. */
  settleSellOnEntitlements(db, offer, worldDate);
  persistSellOnEntitlement(db, offer);
  applySupporterTransferOutcome({
    db,
    buyingClubId: offer.buyingClubId,
    sellingClubId: offer.sellingClubId,
    playerId: offer.playerId,
    date: worldDate,
    transferFee: offer.transferFee,
  });
  // A completed move is a real relationship event for the player's existing
  // representation edge. The cooldown/idempotency rules live in the shared
  // people event adapter, so replaying settlement cannot double-count trust.
  const people = new PeopleFoundationRepository(db);
  for (const relationship of people
    .relationshipsForPerson(offer.playerId)
    .filter((item) => item.kind === "PLAYER_AGENT")) {
    applyPlayerRelationshipEvent({
      db,
      relationship,
      date: worldDate,
      trustDelta: 2,
      respectDelta: 1,
      tensionDelta: -1,
      cooldownDays: 7,
    });
  }
};

/** Resolve a player's open offer set once at a deterministic market tick. */
export const resolveCompetingPlayerOffers = (
  db: GameDatabase,
  playerId: EntityId,
  worldDate: string,
  seed: string,
  preferences?: PlayerPersonalTermsPreferences,
): TransferOffer | undefined => {
  const market = new TransferMarketRepository(db);
  const effectivePreferences = effectiveAgentPlayerPreferences(db, playerId, preferences ?? {});
  if (market.activeContract(playerId, worldDate)) return undefined;
  const offers = market
    .transferOffers()
    .filter(
      (offer) =>
        offer.playerId === playerId &&
        (offer.sellingClubId
          ? ["ACCEPTED", "PLAYER_ACCEPTED", "COMPETING_OFFER"].includes(offer.status)
          : [
              "SUBMITTED",
              "NEGOTIATING",
              "ACCEPTED",
              "PLAYER_ACCEPTED",
              "COMPETING_OFFER",
              "COUNTERED",
            ].includes(offer.status)),
    )
    .sort((a, b) => {
      const aTerms = latestPersonalTerms(db, a, worldDate, seed);
      const bTerms = latestPersonalTerms(db, b, worldDate, seed);
      return (
        playerChoiceScore(b, bTerms, effectivePreferences) -
          playerChoiceScore(a, aTerms, effectivePreferences) ||
        bTerms.salary - aTerms.salary ||
        bTerms.contractLengthMonths - aTerms.contractLengthMonths ||
        String(a.id).localeCompare(String(b.id))
      );
    });
  const winner = offers[0];
  if (!winner) return undefined;
  for (const offer of offers) {
    if (offer.id !== winner.id) market.updateOfferStatus(offer.id, "REJECTED");
  }
  if (winner.status !== "ACCEPTED" && winner.status !== "PLAYER_ACCEPTED") {
    market.updateOfferStatus(winner.id, "ACCEPTED");
  }
  const winnerTerms = latestPersonalTerms(db, winner, worldDate, seed);
  completePermanentTransfer(
    db,
    winner,
    worldDate,
    `${seed}:resolved`,
    effectivePreferences,
    winnerTerms,
  );
  return new TransferMarketRepository(db).transferOffers().find((offer) => offer.id === winner.id);
};

export const startLoan = (
  db: GameDatabase,
  parentClubId: EntityId,
  loanClubId: EntityId,
  playerId: EntityId,
  worldDate: string,
  seed: string,
  options: {
    endDate?: string;
    wageContributionPercent?: number;
    loanFee?: number;
    playingTimeExpectation?: PlayerSquadRole;
    recallAllowed?: boolean;
    purchaseOption?: number;
    purchaseObligation?: number;
  } = {},
): PlayerLoanRecord => {
  const market = new TransferMarketRepository(db);
  if (parentClubId === loanClubId) {
    throw new Error("A loan requires different parent and destination clubs");
  }
  const parentContract = market.activeContract(playerId, worldDate);
  if (!parentContract || parentContract.clubId !== parentClubId) {
    throw new Error("A loan requires an active parent-club contract");
  }
  if (market.activeLoans(worldDate).some((loan) => loan.playerId === playerId)) {
    throw new Error("Player already has an active loan");
  }
  const requestedEndDate = options.endDate ?? addMonths(worldDate, 6);
  if (requestedEndDate < worldDate || requestedEndDate > parentContract.endDate) {
    throw new Error("Loan end date must be within the parent contract");
  }
  const requestedWageContribution = options.wageContributionPercent ?? 55;
  if (
    !Number.isFinite(requestedWageContribution) ||
    requestedWageContribution < 0 ||
    requestedWageContribution > 100
  ) {
    throw new Error("Loan wage contribution must be between 0 and 100");
  }
  const requestedLoanFee = options.loanFee ?? 0;
  if (!Number.isFinite(requestedLoanFee) || requestedLoanFee < 0) {
    throw new Error("Loan fee must be a finite non-negative amount");
  }
  const requestedPurchaseOption = options.purchaseOption;
  const requestedPurchaseObligation = options.purchaseObligation;
  if (requestedPurchaseOption !== undefined && requestedPurchaseObligation !== undefined) {
    throw new Error("A loan cannot have both a purchase option and a purchase obligation");
  }
  if (
    requestedPurchaseOption !== undefined &&
    (!Number.isFinite(requestedPurchaseOption) || requestedPurchaseOption <= 0)
  ) {
    throw new Error("Purchase option must be a finite positive amount");
  }
  if (
    requestedPurchaseObligation !== undefined &&
    (!Number.isFinite(requestedPurchaseObligation) || requestedPurchaseObligation <= 0)
  ) {
    throw new Error("Purchase obligation must be a finite positive amount");
  }
  const loanFee = Math.round(requestedLoanFee);
  if (loanFee > 0 && !clubCanAffordTransfer(db, loanClubId, loanFee, worldDate)) {
    throw new Error("Loan club cannot afford the loan fee");
  }
  const loan: PlayerLoanRecord = {
    id: createStableEntityId(
      "player-loan",
      `${playerId}:${parentClubId}:${loanClubId}:${worldDate}`,
    ),
    parentClubId,
    loanClubId,
    playerId,
    startDate: worldDate,
    endDate: requestedEndDate,
    wageContributionPercent: requestedWageContribution,
    loanFee,
    playingTimeExpectation: options.playingTimeExpectation ?? "ROTATION",
    recallAllowed: options.recallAllowed ?? true,
    purchaseOption: requestedPurchaseOption,
    purchaseObligation: requestedPurchaseObligation,
    status: "ACTIVE",
  };
  market.upsertLoan(loan);
  movePlayerAssignment(db, playerId, loanClubId, worldDate);
  closePlayerRegistrations(db, playerId, parentClubId, "CONTRACTED", worldDate);
  registerLoanPlayer(db, loan, worldDate);
  if (loan.loanFee && loan.loanFee > 0) {
    postClubTransaction(db, {
      clubId: loan.loanClubId,
      date: worldDate,
      category: "LOAN_PAYMENT",
      direction: "DEBIT",
      amount: loan.loanFee,
      description: "Loan fee paid",
      relatedEntityId: loan.id,
      idempotencyKey: `loan-fee-buy:${loan.id}`,
    });
    postClubTransaction(db, {
      clubId: loan.parentClubId,
      date: worldDate,
      category: "LOAN_PAYMENT",
      direction: "CREDIT",
      amount: loan.loanFee,
      description: "Loan fee received",
      relatedEntityId: loan.id,
      idempotencyKey: `loan-fee-sell:${loan.id}`,
    });
  }
  market.insertTransferHistoryEvent({
    id: createStableEntityId("transfer-history", `${loan.id}:loan-started`),
    playerId,
    clubId: parentClubId,
    relatedClubId: loanClubId,
    eventType: "LOAN_STARTED",
    occurredOn: worldDate,
    data: {
      wageContributionPercent: loan.wageContributionPercent,
      loanFee: loan.loanFee,
      purchaseOption: loan.purchaseOption,
      purchaseObligation: loan.purchaseObligation,
      playingTimeExpectation: loan.playingTimeExpectation,
    },
  });
  emitTransferPublicEvent(db, {
    sourceId: loan.id,
    occurredOn: worldDate,
    eventType: "LOAN_STARTED",
    title: "Loan move completed",
    playerId,
    clubId: loan.loanClubId,
    relatedClubId: loan.parentClubId,
    data: { loanId: loan.id, loanFee: loan.loanFee, purchaseOption: loan.purchaseOption },
  });
  return loan;
};

export const runTransferDiagnostic = (
  db: GameDatabase,
  input: { seed: string; worldDate: string },
): TransferWindowSimulationReport => {
  initializeTransferMarketForSave({ db, worldDate: input.worldDate, seed: input.seed });
  return simulateTransferWindow({
    db,
    worldDate: input.worldDate,
    seed: input.seed,
    maxClubActions: 16,
  });
};

export const processContractExpiries = (
  db: GameDatabase,
  worldDate: string,
): { releases: number } => {
  const market = new TransferMarketRepository(db);
  let releases = 0;
  for (const contract of market.expiringContracts(worldDate)) {
    releasePlayer(db, contract, worldDate, "Contract expired");
    releases += 1;
  }
  return { releases };
};

const ensureRecruitmentKnowledge = (db: GameDatabase, worldDate: string, seed: string): void => {
  const existing = (
    db.prepare("SELECT COUNT(*) AS count FROM player_knowledge").get() as {
      count: number;
    }
  ).count;
  if (existing === 0) {
    initializeRecruitmentForSave({ db, worldDate, seed });
  }
};

const renewContract = (
  db: GameDatabase,
  contract: PlayerContractRecord,
  worldDate: string,
  seed: string,
): void => {
  const market = new TransferMarketRepository(db);
  market.markContractStatus(contract.id, "TERMINATED");
  const rng = new SeededRandom(`${seed}:renew:${contract.id}`);
  const renewed: PlayerContractRecord = {
    ...contract,
    id: createStableEntityId(
      "player-contract",
      `${contract.playerId}:${contract.clubId}:renew:${worldDate}`,
    ),
    startDate: worldDate,
    endDate: addMonths(worldDate, 8 + Math.floor(rng.next() * 12)),
    salary: Math.round(contract.salary * (1.02 + rng.next() * 0.12)),
    status: "ACTIVE",
    provenance: simulationOnlyProvenance("Generated renewal terms"),
  };
  market.upsertPlayerContract(renewed);
  market.insertTransferHistoryEvent({
    id: createStableEntityId("transfer-history", `${contract.playerId}:renewed:${worldDate}`),
    playerId: contract.playerId,
    clubId: contract.clubId,
    eventType: "CONTRACT_RENEWED",
    occurredOn: worldDate,
    data: { endDate: renewed.endDate },
  });
  const agent = market.agentForPlayer(contract.playerId);
  if (agent) {
    const fee = agentFeeForContract(renewed.salary, agent);
    postClubTransaction(db, {
      clubId: contract.clubId,
      date: worldDate,
      category: "TRANSFER_EXPENSE",
      direction: "DEBIT",
      amount: fee,
      description: "Player agent renewal fee",
      relatedEntityId: renewed.id,
      idempotencyKey: `agent-renewal-fee:${renewed.id}`,
    });
    settleAgentFee(db, {
      playerId: contract.playerId,
      payerClubId: contract.clubId,
      amount: fee,
      sourceEntityId: renewed.id,
      eventType: "CONTRACT_RENEWAL",
      date: worldDate,
    });
  }
};

const releasePlayer = (
  db: GameDatabase,
  contract: PlayerContractRecord,
  worldDate: string,
  reason: string,
): void => {
  const market = new TransferMarketRepository(db);
  market.markContractStatus(contract.id, contract.endDate <= worldDate ? "EXPIRED" : "TERMINATED");
  market.endActiveTeamAssignments(contract.playerId, worldDate);
  market.updatePlayerClub(contract.playerId, undefined);
  market.upsertTransferStatus(freeAgentStatus(contract.playerId, worldDate));
  market.insertTransferHistoryEvent({
    id: createStableEntityId(
      "transfer-history",
      `${contract.playerId}:released:${worldDate}:${reason}`,
    ),
    playerId: contract.playerId,
    clubId: contract.clubId,
    eventType: contract.endDate <= worldDate ? "CONTRACT_EXPIRED" : "PLAYER_RELEASED",
    occurredOn: worldDate,
    data: { reason },
  });
};

export type FreeAgentSigningAssessment = {
  eligible: boolean;
  competition: number;
  wageDemand: number;
  reason: string;
};

export const assessFreeAgentSigning = (
  db: GameDatabase,
  clubId: EntityId,
  playerId: EntityId,
  worldDate: string,
): FreeAgentSigningAssessment => {
  const market = new TransferMarketRepository(db);
  const player = marketPlayer(db, playerId);
  if (!player || market.activeContract(playerId, worldDate)) {
    return {
      eligible: false,
      competition: 0,
      wageDemand: 0,
      reason: "player is already contracted",
    };
  }
  const recentSigning = market
    .transferHistory()
    .find(
      (event) =>
        event.playerId === playerId &&
        event.eventType === "FREE_AGENT_SIGNED" &&
        daysBetween(event.occurredOn, worldDate) < 90,
    );
  const competition = market
    .transferOffers()
    .filter(
      (offer) =>
        offer.playerId === playerId &&
        offer.buyingClubId !== clubId &&
        ["SUBMITTED", "NEGOTIATING", "ACCEPTED", "PLAYER_ACCEPTED"].includes(offer.status),
    ).length;
  const wageDemand = Math.round(
    (28000 + player.currentAbility * 14500 + player.reputation * 4200) * (1 + competition * 0.08),
  );
  return {
    eligible: !recentSigning,
    competition,
    wageDemand,
    reason: recentSigning
      ? "free-agent flip protection cooling-off period"
      : competition > 0
        ? "competing clubs are pursuing the player"
        : "free agent is available",
  };
};

export const signFreeAgent = (
  db: GameDatabase,
  clubId: EntityId,
  playerId: EntityId,
  worldDate: string,
  seed: string,
): boolean => {
  const assessment = assessFreeAgentSigning(db, clubId, playerId, worldDate);
  if (!assessment.eligible) return false;
  const finances = new TransferMarketRepository(db).clubFinancialProfile(clubId);
  if (finances && finances.wageBudget - finances.currentWageSpend < assessment.wageDemand) {
    return false;
  }
  const offer = createTransferOffer(db, {
    buyingClubId: clubId,
    playerId,
    submittedAt: worldDate,
    fee: 0,
  });
  new TransferMarketRepository(db).updateOfferStatus(offer.id, "ACCEPTED");
  completePermanentTransfer(
    db,
    offer,
    worldDate,
    seed,
    isNepalClub(db, clubId)
      ? {
          preferredCountries: ["NP", "NPL"],
          prefersOverseas: false,
          expectedPlayingTime: "FIRST_TEAM",
          minimumClubLevel: 0,
          securityPreference: 8,
        }
      : undefined,
  );
  return new TransferMarketRepository(db).activeContract(playerId, worldDate)?.clubId === clubId;
};

export type LoanTerminationReason =
  "NORMAL_EXPIRY" | "RECALL" | "PERMANENT_OPTION_PURCHASE" | "PERMANENT_OBLIGATION_PURCHASE";

const finishLoan = (
  db: GameDatabase,
  loan: PlayerLoanRecord,
  worldDate: string,
  reason: LoanTerminationReason,
  returnToParent: boolean,
): boolean => {
  const market = new TransferMarketRepository(db);
  const persisted = market.loan(loan.id);
  if (!persisted || persisted.status !== "ACTIVE") return false;
  market.upsertLoan({ ...persisted, status: "ENDED" });
  if (returnToParent) {
    movePlayerAssignment(db, persisted.playerId, persisted.parentClubId, worldDate);
  }
  closePlayerRegistrations(db, persisted.playerId, persisted.loanClubId, "LOAN", worldDate);
  if (returnToParent) {
    registerContractedPlayer(db, persisted.playerId, persisted.parentClubId, worldDate);
  }
  market.insertTransferHistoryEvent({
    id: createStableEntityId("transfer-history", `${persisted.id}:loan-ended`),
    playerId: persisted.playerId,
    clubId: persisted.parentClubId,
    relatedClubId: persisted.loanClubId,
    eventType: "LOAN_ENDED",
    occurredOn: worldDate,
    data: { terminationReason: reason },
  });
  emitTransferPublicEvent(db, {
    sourceId: `${persisted.id}:loan-ended` as EntityId,
    occurredOn: worldDate,
    eventType: "LOAN_ENDED",
    title: returnToParent ? "Loan spell ended" : "Loan converted to permanent transfer",
    playerId: persisted.playerId,
    clubId: persisted.loanClubId,
    relatedClubId: persisted.parentClubId,
    data: { loanId: persisted.id, terminationReason: reason },
  });
  return true;
};

const completeMandatoryLoanPurchase = (
  db: GameDatabase,
  loan: PlayerLoanRecord,
  worldDate: string,
  seed: string,
): boolean => {
  const market = new TransferMarketRepository(db);
  if (
    !loan.purchaseObligation ||
    !clubCanAffordTransfer(db, loan.loanClubId, loan.purchaseObligation, worldDate)
  ) {
    finishLoan(db, loan, worldDate, "NORMAL_EXPIRY", true);
    return false;
  }
  const offer = createTransferOffer(db, {
    buyingClubId: loan.loanClubId,
    sellingClubId: loan.parentClubId,
    playerId: loan.playerId,
    submittedAt: worldDate,
    fee: loan.purchaseObligation,
    installments: 0,
    addOns: 0,
    sellOnPercentage: 0,
  });
  market.updateOfferStatus(offer.id, "ACCEPTED");
  completePermanentTransfer(db, offer, worldDate, `${seed}:${loan.id}`);
  const settled = new TransferMarketRepository(db)
    .transferOffers()
    .find((item) => item.id === offer.id);
  if (settled?.status !== "COMPLETED") {
    finishLoan(db, loan, worldDate, "NORMAL_EXPIRY", true);
    return false;
  }
  finishLoan(db, loan, worldDate, "PERMANENT_OBLIGATION_PURCHASE", false);
  return true;
};

export const endLoan = (db: GameDatabase, loan: PlayerLoanRecord, worldDate: string): void => {
  if (loan.purchaseObligation && worldDate >= loan.endDate) {
    completeMandatoryLoanPurchase(db, loan, worldDate, "loan-obligation");
    return;
  }
  finishLoan(db, loan, worldDate, "NORMAL_EXPIRY", true);
};

export const recallLoan = (
  db: GameDatabase,
  input: { loanId: EntityId; parentClubId: EntityId; worldDate: string },
): PlayerLoanRecord => {
  const market = new TransferMarketRepository(db);
  const loan = market.loan(input.loanId);
  if (!loan || loan.status !== "ACTIVE") throw new Error("Loan is no longer active");
  if (loan.parentClubId !== input.parentClubId) {
    throw new Error("Only the parent club can recall a player");
  }
  if (input.worldDate < loan.startDate) throw new Error("Loan recall is too early");
  if (input.worldDate >= loan.endDate) throw new Error("Loan has reached its expiry date");
  if (!loan.recallAllowed) throw new Error("This loan does not allow recall");
  finishLoan(db, loan, input.worldDate, "RECALL", true);
  return market.loan(loan.id)!;
};

export type LoanOptionExerciseResult = {
  completed: boolean;
  loan: PlayerLoanRecord;
  offer: TransferOffer;
};

export const exerciseLoanOption = (
  db: GameDatabase,
  input: {
    loanId: EntityId;
    loanClubId: EntityId;
    worldDate: string;
    seed: string;
  },
): LoanOptionExerciseResult => {
  const market = new TransferMarketRepository(db);
  const loan = market.loan(input.loanId);
  if (!loan || loan.status !== "ACTIVE") throw new Error("Loan is no longer active");
  if (loan.loanClubId !== input.loanClubId) {
    throw new Error("Only the destination club can exercise the purchase option");
  }
  if (input.worldDate < loan.startDate) throw new Error("Purchase option is not yet eligible");
  if (input.worldDate >= loan.endDate) throw new Error("Purchase option has expired with the loan");
  if (!loan.purchaseOption || !Number.isFinite(loan.purchaseOption) || loan.purchaseOption <= 0) {
    throw new Error("This loan has no purchase option");
  }
  if (!clubCanAffordTransfer(db, loan.loanClubId, loan.purchaseOption, input.worldDate)) {
    throw new Error("Destination club cannot afford the purchase option");
  }
  const offer = createTransferOffer(db, {
    buyingClubId: loan.loanClubId,
    sellingClubId: loan.parentClubId,
    playerId: loan.playerId,
    submittedAt: input.worldDate,
    fee: loan.purchaseOption,
    installments: 0,
    addOns: 0,
    sellOnPercentage: 0,
  });
  if (!["SUBMITTED", "ACCEPTED", "PLAYER_ACCEPTED"].includes(offer.status)) {
    return { completed: false, loan, offer };
  }
  market.updateOfferStatus(offer.id, "ACCEPTED");
  completePermanentTransfer(db, offer, input.worldDate, `${input.seed}:loan-option:${loan.id}`);
  const settledOffer = new TransferMarketRepository(db)
    .transferOffers()
    .find((item) => item.id === offer.id)!;
  if (settledOffer.status === "COMPLETED") {
    finishLoan(db, loan, input.worldDate, "PERMANENT_OPTION_PURCHASE", false);
  }
  return {
    completed: settledOffer.status === "COMPLETED",
    loan: new TransferMarketRepository(db).loan(loan.id)!,
    offer: settledOffer,
  };
};

export type ReleaseClauseExerciseResult = {
  completed: boolean;
  offer: TransferOffer;
  contract: PlayerContractRecord;
};

/** Execute a player's currently active release clause through the normal offer pipeline. */
export const exerciseReleaseClause = (
  db: GameDatabase,
  input: {
    playerId: EntityId;
    buyingClubId: EntityId;
    worldDate: string;
    seed: string;
  },
): ReleaseClauseExerciseResult => {
  const market = new TransferMarketRepository(db);
  const contract = market.activeContract(input.playerId, input.worldDate);
  if (!contract) throw new Error("Player has no active contract");
  if (contract.clubId === input.buyingClubId)
    throw new Error("Buying club already employs the player");
  if (!contract.releaseClause || contract.releaseClause <= 0) {
    throw new Error("Player contract has no release clause");
  }
  if (!clubCanAffordTransfer(db, input.buyingClubId, contract.releaseClause, input.worldDate)) {
    throw new Error("Buying club cannot afford the release clause");
  }
  const offer = createTransferOffer(db, {
    buyingClubId: input.buyingClubId,
    sellingClubId: contract.clubId,
    playerId: input.playerId,
    submittedAt: input.worldDate,
    fee: contract.releaseClause,
    installments: 0,
    addOns: 0,
    sellOnPercentage: 0,
  });
  market.updateOfferStatus(offer.id, "ACCEPTED");
  completePermanentTransfer(db, offer, input.worldDate, `${input.seed}:release-clause`);
  const settledOffer = new TransferMarketRepository(db)
    .transferOffers()
    .find((item) => item.id === offer.id)!;
  return {
    completed: settledOffer.status === "COMPLETED",
    offer: settledOffer,
    contract:
      new TransferMarketRepository(db).activeContract(input.playerId, input.worldDate) ?? contract,
  };
};

export type ClubTransferIdentity =
  | "DEVELOPMENT_FOCUSED"
  | "ACADEMY_FIRST"
  | "VETERAN_HEAVY"
  | "LOAN_HEAVY"
  | "AGENT_NETWORK_DRIVEN"
  | "SELLING_DEVELOPMENT";

export const clubTransferIdentity = (db: GameDatabase, clubId: EntityId): ClubTransferIdentity => {
  const club = marketClubs(db).find((item) => item.id === clubId);
  const profile = new TransferMarketRepository(db).clubFinancialProfile(clubId);
  const label = `${club?.name ?? clubId}`.toLowerCase();
  if (label.includes("academy") || label.includes("youth")) return "ACADEMY_FIRST";
  if (profile?.financialHealth === "POOR") return "SELLING_DEVELOPMENT";
  const score = [...String(clubId)].reduce((total, char) => total + char.charCodeAt(0), 0) % 5;
  return [
    "DEVELOPMENT_FOCUSED",
    "VETERAN_HEAVY",
    "LOAN_HEAVY",
    "AGENT_NETWORK_DRIVEN",
    "DEVELOPMENT_FOCUSED",
  ][score] as ClubTransferIdentity;
};

export type AiRecruitmentPlan = {
  clubId: EntityId;
  identity: ClubTransferIdentity;
  needs: SquadNeedReport;
  transferBudget: number;
  wageBudgetRemaining: number;
  foreignSlotsRemaining: number;
  preferredRoutes: Array<"ACADEMY" | "LOAN" | "FREE_AGENT" | "TRANSFER" | "AGENT_NETWORK">;
};

const foreignPlayerCount = (db: GameDatabase, clubId: EntityId, worldDate: string): number => {
  const rows = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM player_factual_profiles p
       JOIN player_contracts pc ON pc.player_id = p.player_id AND pc.club_id = ? AND pc.status = 'ACTIVE'
       JOIN persons person ON person.id = p.player_id
       JOIN clubs c ON c.id = ?
       WHERE person.nationality_country_id <> c.country_id
         AND pc.start_date <= ? AND pc.end_date >= ?`,
    )
    .get(clubId, clubId, worldDate, worldDate) as { count: number };
  return rows.count;
};

export const aiRecruitmentPlan = (
  db: GameDatabase,
  clubId: EntityId,
  worldDate: string,
): AiRecruitmentPlan => {
  const market = new TransferMarketRepository(db);
  const finances = market.clubFinancialProfile(clubId);
  const needs = analyzeSquadNeeds(db, clubId, worldDate);
  const identity = clubTransferIdentity(db, clubId);
  const routes: AiRecruitmentPlan["preferredRoutes"] =
    identity === "ACADEMY_FIRST"
      ? ["ACADEMY", "LOAN", "FREE_AGENT"]
      : identity === "LOAN_HEAVY"
        ? ["LOAN", "FREE_AGENT", "TRANSFER"]
        : identity === "AGENT_NETWORK_DRIVEN"
          ? ["AGENT_NETWORK", "TRANSFER", "FREE_AGENT"]
          : identity === "VETERAN_HEAVY"
            ? ["FREE_AGENT", "TRANSFER", "LOAN"]
            : ["TRANSFER", "LOAN", "FREE_AGENT"];
  return {
    clubId,
    identity,
    needs,
    transferBudget: finances?.transferBudget ?? 0,
    wageBudgetRemaining: Math.max(
      0,
      (finances?.wageBudget ?? 0) - (finances?.currentWageSpend ?? 0),
    ),
    foreignSlotsRemaining: Math.max(0, 5 - foreignPlayerCount(db, clubId, worldDate)),
    preferredRoutes: routes,
  };
};

export const requestPlayerTransfer = (
  db: GameDatabase,
  input: {
    playerId: EntityId;
    worldDate: string;
    reason?: string;
    satisfaction?: number;
    ambition?: number;
    foreignInterest?: boolean;
  },
): PlayerTransferRequest => {
  const market = new TransferMarketRepository(db);
  const player = marketPlayer(db, input.playerId);
  const contract = market.activeContract(input.playerId, input.worldDate);
  if (!player?.currentClubId || !contract)
    throw new Error("Transfer request requires an active club contract");
  const playingTime = player.appearances < 5 ? 24 : 0;
  const expiry = contract.endDate <= addDays(input.worldDate, 180) ? 18 : 0;
  const satisfaction =
    input.satisfaction === undefined ? 0 : Math.max(0, 50 - input.satisfaction) / 2;
  const ambition = Math.max(0, (input.ambition ?? Math.round(player.potentialAbility / 2)) - 7) * 2;
  const foreign = input.foreignInterest ? 16 : 0;
  const pressureScore = Math.min(100, playingTime + expiry + satisfaction + ambition + foreign);
  const valuation = calculateTransferValuation(db, {
    playerId: input.playerId,
    sellingClubId: contract.clubId,
    worldDate: input.worldDate,
  });
  const request: PlayerTransferRequest = {
    id: createStableEntityId("transfer-request", `${input.playerId}:${input.worldDate}`),
    playerId: input.playerId,
    clubId: contract.clubId,
    requestedAt: input.worldDate,
    reason: input.reason ?? "Player wants a new challenge",
    pressureScore: Math.round(pressureScore * 100) / 100,
    status: "PENDING",
    askingContext: valuation.askingRange,
  };
  market.upsertTransferRequest(request);
  market.upsertTransferStatus({
    id: createStableEntityId("player-transfer-status", input.playerId),
    playerId: input.playerId,
    clubId: contract.clubId,
    status: "INTERESTED_IN_MOVE",
    reason: request.reason,
    setBy: "PLAYER",
    updatedAt: input.worldDate,
  });
  market.insertTransferHistoryEvent({
    id: createStableEntityId("transfer-history", `${input.playerId}:request:${input.worldDate}`),
    playerId: input.playerId,
    clubId: contract.clubId,
    eventType: "TRANSFER_REQUESTED",
    occurredOn: input.worldDate,
    data: { pressureScore: request.pressureScore, reason: request.reason },
  });
  return request;
};

export const respondToPlayerTransferRequest = (
  db: GameDatabase,
  request: PlayerTransferRequest,
  decision: "ACCEPTED" | "REJECTED",
  worldDate: string,
): PlayerTransferRequest => {
  const market = new TransferMarketRepository(db);
  const updated = {
    ...request,
    status: decision === "ACCEPTED" ? "ACCEPTED" : "REJECTED",
    decidedAt: worldDate,
  } as PlayerTransferRequest;
  market.upsertTransferRequest(updated);
  market.upsertTransferStatus({
    id: createStableEntityId("player-transfer-status", request.playerId),
    playerId: request.playerId,
    clubId: request.clubId,
    status: decision === "ACCEPTED" ? "TRANSFER_LISTED" : "NOT_FOR_SALE",
    reason:
      decision === "ACCEPTED"
        ? "Club accepts player transfer request"
        : "Club rejects player transfer request",
    setBy: "CLUB",
    updatedAt: worldDate,
  });
  return updated;
};

export const findPermanentTransferCandidatesForClub = (
  db: GameDatabase,
  clubId: EntityId,
  need: SquadNeed,
  worldDate: string,
) => {
  const regionalCandidates = searchRegionalCandidatesForClub(db, clubId, {}, worldDate, 12);
  const network = new ClubNetworkRepository(db);
  const preferredClubIds = new Set(
    network
      .activePreferredTransferPartnerships(clubId, worldDate)
      .map((partnership) => partnership.toClubId),
  );
  const preferredCandidates = searchPreferredTransferCandidatesForClub(
    db,
    clubId,
    [...preferredClubIds],
    worldDate,
  );
  const relatedClubIds = new Set(network.activeRelatedClubIds(clubId, worldDate));
  const baseCandidates =
    regionalCandidates.length > 0
      ? regionalCandidates
      : searchPlayersForClub(db, clubId, {}, worldDate);
  const candidates = [
    ...new Map(
      [...baseCandidates, ...preferredCandidates].map((candidate) => [
        candidate.playerId,
        candidate,
      ]),
    ).values(),
  ]
    .filter((candidate) => candidate.clubId && candidate.clubId !== clubId)
    .filter(
      (candidate) =>
        need.positionGroup === "DEPTH" || candidate.publicPositionGroup === need.positionGroup,
    )
    .filter(
      (candidate) =>
        (candidate.estimatedAbility?.max ?? 0) >= 7 || preferredClubIds.has(candidate.clubId!),
    )
    .sort(
      (a, b) =>
        Number(preferredClubIds.has(b.clubId!)) - Number(preferredClubIds.has(a.clubId!)) ||
        Number(relatedClubIds.has(b.clubId!)) - Number(relatedClubIds.has(a.clubId!)) ||
        (b.estimatedAbility?.max ?? 0) - (a.estimatedAbility?.max ?? 0) ||
        String(a.playerId).localeCompare(String(b.playerId)),
    )
    .slice(0, 12);
  return candidates;
};

const createAiTransferOffer = (
  db: GameDatabase,
  clubId: EntityId,
  need: SquadNeed,
  worldDate: string,
  seed: string,
): TransferOffer | undefined => {
  const candidates = findPermanentTransferCandidatesForClub(db, clubId, need, worldDate);
  const rng = new SeededRandom(`${seed}:offer:${clubId}:${need.positionGroup}`);
  const candidate = candidates[Math.floor(rng.next() * Math.min(candidates.length, 4))];
  if (!candidate?.clubId) {
    return undefined;
  }
  return createTransferOffer(db, {
    buyingClubId: clubId,
    sellingClubId: candidate.clubId,
    playerId: candidate.playerId,
    submittedAt: worldDate,
  });
};

const findFreeAgentForNeed = (
  db: GameDatabase,
  clubId: EntityId,
  need: SquadNeed,
  worldDate: string,
): MarketPlayer | undefined => {
  const activeOfferPlayers = new Set(
    new TransferMarketRepository(db)
      .transferOffers()
      .filter((offer) =>
        ["SUBMITTED", "NEGOTIATING", "ACCEPTED", "PLAYER_ACCEPTED"].includes(offer.status),
      )
      .map((offer) => offer.playerId),
  );
  return marketPlayers(db)
    .filter((player) => !activeOfferPlayers.has(player.playerId))
    .filter(
      (player) => !new TransferMarketRepository(db).activeContract(player.playerId, worldDate),
    )
    .filter(
      (player) => need.positionGroup === "DEPTH" || player.positionGroup === need.positionGroup,
    )
    .sort((a, b) => {
      const foreignPreference = isNepalClub(db, clubId)
        ? Number(isForeignBased(db, b.currentClubId)) - Number(isForeignBased(db, a.currentClubId))
        : 0;
      return (
        foreignPreference ||
        b.currentAbility - a.currentAbility ||
        String(a.playerId).localeCompare(String(b.playerId))
      );
    })[0];
};

const isNepalClub = (db: GameDatabase, clubId: EntityId): boolean =>
  Boolean(
    db
      .prepare(
        "SELECT 1 FROM clubs c JOIN countries country ON country.id=c.country_id WHERE c.id=? AND country.iso_code IN ('NP','NPL')",
      )
      .get(clubId),
  );

export const findLoanCandidateForClub = (
  db: GameDatabase,
  clubId: EntityId,
  need: SquadNeed,
  worldDate: string,
): { parentClubId: EntityId; playerId: EntityId } | undefined => {
  const market = new TransferMarketRepository(db);
  /*
   * A player already out on loan cannot be loaned again. Selection is
   * deterministic, so without this the same fringe player is offered to every
   * club in turn and the second attempt trips the loan guard in `startLoan`.
   */
  const alreadyLoaned = new Set(market.activeLoans(worldDate).map((loan) => loan.playerId));
  const network = new ClubNetworkRepository(db);
  const relatedParentClubs = new Set(network.activeRelatedClubIds(clubId, worldDate));
  const partnerParentClubs = new Set([
    ...relatedParentClubs,
    ...network.activeLoanPartnerships(clubId, worldDate).map((partnership) => partnership.toClubId),
  ]);
  for (const player of marketPlayers(db)
    .filter((item) => item.currentClubId && item.currentClubId !== clubId)
    .filter((item) => !alreadyLoaned.has(item.playerId))
    .filter((item) => need.positionGroup === "DEPTH" || item.positionGroup === need.positionGroup)
    .sort(
      (a, b) =>
        Number(partnerParentClubs.has(b.currentClubId!)) -
          Number(partnerParentClubs.has(a.currentClubId!)) ||
        a.appearances - b.appearances ||
        a.age - b.age ||
        String(a.playerId).localeCompare(String(b.playerId)),
    )) {
    const contract = market.activeContract(player.playerId, worldDate);
    if (contract && ["BACKUP", "PROSPECT", "YOUTH", "ROTATION"].includes(contract.squadRole)) {
      return { parentClubId: contract.clubId, playerId: player.playerId };
    }
  }
  return undefined;
};

const findLoanCandidate = findLoanCandidateForClub;

const registerLoanPlayer = (db: GameDatabase, loan: PlayerLoanRecord, worldDate: string): void => {
  const market = new TransferMarketRepository(db);
  const seasons = db
    .prepare(
      `SELECT DISTINCT cs.id AS season_id, cs.end_date
       FROM club_memberships cm
       JOIN competition_seasons cs ON cs.id = cm.competition_season_id
       WHERE cm.club_id = ? AND cm.status = 'ACTIVE'
         AND cs.start_date <= ? AND cs.end_date >= ?
       ORDER BY cs.id`,
    )
    .all(loan.loanClubId, worldDate, worldDate) as Array<{
    season_id: EntityId;
    end_date: string;
  }>;
  for (const season of seasons) {
    market.upsertCompetitionRegistration({
      id: createStableEntityId(
        "competition-registration",
        `${loan.playerId}:${season.season_id}:loan`,
      ),
      playerId: loan.playerId,
      clubId: loan.loanClubId,
      competitionSeasonId: season.season_id,
      registrationType: "LOAN",
      registeredFrom: worldDate,
      registeredUntil: season.end_date < loan.endDate ? season.end_date : loan.endDate,
      status: "ACTIVE",
    });
  }
};

const closePlayerRegistrations = (
  db: GameDatabase,
  playerId: EntityId,
  clubId: EntityId,
  registrationType: "CONTRACTED" | "LOAN",
  worldDate: string,
): void => {
  db.prepare(
    `UPDATE competition_registrations
       SET status = 'EXPIRED',
           registered_until = CASE
             WHEN registered_until IS NULL OR registered_until > ? THEN ?
             ELSE registered_until
           END
       WHERE player_id = ? AND club_id = ? AND registration_type = ? AND status = 'ACTIVE'`,
  ).run(worldDate, worldDate, playerId, clubId, registrationType);
};

const registerContractedPlayer = (
  db: GameDatabase,
  playerId: EntityId,
  clubId: EntityId,
  worldDate: string,
): void => {
  const market = new TransferMarketRepository(db);
  const seasons = db
    .prepare(
      `SELECT DISTINCT cs.id AS season_id, cs.end_date
       FROM club_memberships cm
       JOIN competition_seasons cs ON cs.id = cm.competition_season_id
       WHERE cm.club_id = ? AND cm.status = 'ACTIVE'
         AND cs.start_date <= ? AND cs.end_date >= ?
       ORDER BY cs.id`,
    )
    .all(clubId, worldDate, worldDate) as Array<{
    season_id: EntityId;
    end_date: string;
  }>;
  for (const season of seasons) {
    market.upsertCompetitionRegistration({
      id: createStableEntityId(
        "competition-registration",
        `${playerId}:${season.season_id}:contracted`,
      ),
      playerId,
      clubId,
      competitionSeasonId: season.season_id,
      registrationType: "CONTRACTED",
      registeredFrom: worldDate,
      registeredUntil: season.end_date,
      status: "ACTIVE",
    });
  }
};

const shouldRenew = (db: GameDatabase, contract: PlayerContractRecord, seed: string): boolean => {
  const player = marketPlayer(db, contract.playerId);
  if (!player) return false;
  const rng = new SeededRandom(`${seed}:renew-check:${contract.id}`);
  if (contract.squadRole === "KEY_PLAYER" || contract.squadRole === "IMPORTANT_PLAYER") return true;
  if (player.age > 34 && player.appearances < 5) return false;
  return player.currentAbility + player.potentialAbility / 3 + rng.next() * 4 > 11;
};

const fringeReleaseCandidate = (
  db: GameDatabase,
  worldDate: string,
): PlayerContractRecord | undefined => {
  const market = new TransferMarketRepository(db);
  const ability = new Map(
    marketPlayers(db).map((player) => [player.playerId, player.currentAbility]),
  );
  return market
    .allPlayerContracts()
    .filter(
      (contract) =>
        contract.status === "ACTIVE" &&
        contract.startDate <= worldDate &&
        contract.endDate >= worldDate,
    )
    .filter((contract) => ["BACKUP", "PROSPECT", "YOUTH"].includes(contract.squadRole))
    .sort(
      (a, b) =>
        (ability.get(a.playerId) ?? 20) - (ability.get(b.playerId) ?? 20) ||
        String(a.playerId).localeCompare(String(b.playerId)),
    )[0];
};

const startingContract = (
  db: GameDatabase,
  player: MarketPlayer,
  club: MarketClub,
  worldDate: string,
  seed: string,
): PlayerContractRecord => {
  const rng = new SeededRandom(`${seed}:contract:${player.playerId}`);
  const role = squadRoleFor(player);
  const employment = employmentProfile(club);
  const months =
    employment.contractProfile === "PROFESSIONAL"
      ? 12 + Math.floor(rng.next() * 18)
      : employment.contractProfile === "SEMI_PRO"
        ? 8 + Math.floor(rng.next() * 10)
        : 4 + Math.floor(rng.next() * 8);
  const endDate =
    rng.next() < 0.08
      ? addDays(worldDate, 20 + Math.floor(rng.next() * 70))
      : addMonths(worldDate, months);
  const salary = Math.round(
    (isNepalClub(db, club.id)
      ? 12000 + player.currentAbility * 2800 + player.reputation * 1200
      : 28000 + player.currentAbility * 14500 + player.reputation * 4200) *
      clubSalaryMultiplier(club),
  );
  return {
    id: createStableEntityId("player-contract", `${player.playerId}:${club.id}:starting`),
    playerId: player.playerId,
    clubId: club.id,
    startDate: "2026-08-01",
    endDate,
    contractType:
      employment.contractProfile === "PROFESSIONAL"
        ? "PROFESSIONAL"
        : employment.contractProfile === "SEMI_PRO"
          ? "SEMI_PRO"
          : "SHORT_TERM",
    salary,
    appearanceFee: Math.round(salary * 0.08),
    goalBonus: Math.round(salary * 0.1),
    cleanSheetBonus: Math.round(salary * 0.08),
    signingBonus: Math.round(salary * 0.4),
    loyaltyBonus: 0,
    currency,
    squadRole: role,
    releaseClause: role === "KEY_PLAYER" ? Math.round(salary * 18) : undefined,
    status: "ACTIVE",
    provenance: simulationOnlyProvenance("Generated starting contract; real terms unavailable"),
  };
};

const financialProfile = (
  club: MarketClub,
  seed: string,
  playerCount: number,
): ClubFinancialProfile => {
  const rng = new SeededRandom(`${seed}:finance:${club.id}`);
  const multiplier = clubSalaryMultiplier(club);
  const contextOnly =
    club.canonicalExternalId?.startsWith("CLB-") ||
    club.canonicalExternalId?.startsWith("SIM-FOREIGN-");
  return {
    id: createStableEntityId("club-financial-profile", club.id),
    clubId: club.id,
    wageBudget: Math.round(
      (contextOnly ? 7200000 : 3600000) * multiplier +
        rng.next() * (contextOnly ? 1800000 : 900000),
    ),
    transferBudget: Math.round(
      (contextOnly ? 3600000 : 900000) * multiplier + rng.next() * (contextOnly ? 1400000 : 500000),
    ),
    currentWageSpend: playerCount * Math.round(55000 * multiplier),
    financialHealth: multiplier > 1.25 ? "GOOD" : multiplier > 0.9 ? "STABLE" : "POOR",
    currency,
    status: "SIMULATION_ONLY",
  };
};

const employmentProfile = (club: MarketClub): ClubEmploymentProfile => {
  const key = club.canonicalExternalId ?? "";
  const employmentModel: ClubEmploymentModel = key.startsWith("NEP-DEP-")
    ? "DEPARTMENTAL"
    : key.startsWith("NEP-NSL-")
      ? "FRANCHISE_TEMPORARY"
      : key.includes("DIVB") || key.includes("DIVC")
        ? "SEMI_PRO"
        : "STANDARD";
  return {
    id: createStableEntityId("club-employment-profile", club.id),
    clubId: club.id,
    employmentModel,
    contractProfile:
      employmentModel === "DEPARTMENTAL"
        ? "SEMI_PRO"
        : employmentModel === "FRANCHISE_TEMPORARY"
          ? "SHORT_TERM"
          : employmentModel === "SEMI_PRO"
            ? "SEMI_PRO"
            : "PROFESSIONAL",
    status: "SIMULATION_ONLY",
  };
};

const seedTransferWindows = (db: GameDatabase, worldDate: string): void => {
  const country = db
    .prepare("SELECT id FROM countries WHERE iso_code IN ('NP', 'NPL') LIMIT 1")
    .get() as { id: EntityId } | undefined;
  if (!country) return;
  const market = new TransferMarketRepository(db);
  for (const [type, openDate, closeDate] of [
    ["PRIMARY", worldDate, addDays(worldDate, 45)],
    ["SECONDARY", "2027-01-01", "2027-01-31"],
  ] as const) {
    market.upsertTransferWindow({
      id: createStableEntityId("transfer-window", `${country.id}:${type}:${openDate}`),
      countryId: country.id,
      windowType: type,
      openDate,
      closeDate,
      registrationDeadline: closeDate,
      status: openDate <= worldDate && closeDate >= worldDate ? "OPEN" : "SCHEDULED",
      provenance: simulationOnlyProvenance(
        "Nepal transfer-window dates unavailable; generated for gameplay",
      ),
      rules: {
        freeAgentsAllowedOutsideWindow: true,
        loansAllowed: true,
        youthRegistrationAllowed: true,
        emergencyGoalkeeperAllowed: true,
        domesticOnly: type === "SECONDARY",
      },
    });
  }
};

const seedAgents = (db: GameDatabase, seed: string, worldDate: string): void => {
  const market = new TransferMarketRepository(db);
  const existing = market.agents();
  const country = db
    .prepare("SELECT id FROM countries WHERE iso_code IN ('NP', 'NPL') LIMIT 1")
    .get() as { id: EntityId } | undefined;
  if (existing.length === 0) {
    for (let index = 0; index < 8; index += 1) {
      const personId = createStableEntityId("person", `simulation-agent:${index}`);
      db.prepare(
        `INSERT OR IGNORE INTO persons
        (id, full_name, display_name, nationality_country_id, languages_json)
        VALUES (?, ?, ?, ?, ?)`,
      ).run(
        personId,
        `Simulation Agent ${index + 1}`,
        `Agent ${index + 1}`,
        country?.id ?? null,
        JSON.stringify(["ne"]),
      );
      db.prepare(
        "INSERT OR IGNORE INTO person_roles (id, person_id, role, active_from) VALUES (?, ?, 'AGENT', ?)",
      ).run(createStableEntityId("person-role", `${personId}:agent`), personId, worldDate);
      const rng = new SeededRandom(`${seed}:agent:${index}`);
      const styles: AgentProfile["negotiationStyle"][] = [
        "BALANCED",
        "AGGRESSIVE",
        "LOYAL",
        "CAREER_FIRST",
      ];
      const networkScopes: AgentNetworkScope[] = [
        "NEPAL_DOMESTIC",
        "SOUTH_ASIA",
        "WIDER_ASIA",
        "EUROPE_GLOBAL",
      ];
      const networkScope = networkScopes[index % networkScopes.length]!;
      market.upsertAgent({
        id: createStableEntityId("agent", personId),
        personId,
        agencyName: agencyNameForNetwork(networkScope, index),
        reputation: 5 + Math.floor(rng.next() * 11),
        negotiationSkill: 6 + Math.floor(rng.next() * 12),
        negotiationStyle: styles[index % styles.length]!,
        aggressiveness: 5 + Math.floor(rng.next() * 11),
        loyaltyPreference: 5 + Math.floor(rng.next() * 11),
        feeExpectation: 5 + Math.floor(rng.next() * 11),
        careerAmbition: 5 + Math.floor(rng.next() * 11),
        networkScope,
        preferredMarkets: preferredMarketsForNetwork(networkScope),
        status: "SIMULATION_ONLY",
      });
    }
  }
};

const seedCompetitionRegistrations = (db: GameDatabase, worldDate: string): void => {
  const market = new TransferMarketRepository(db);
  for (const row of db
    .prepare(
      `SELECT DISTINCT pfp.player_id, cm.club_id, cm.competition_season_id
      FROM player_factual_profiles pfp
      JOIN club_memberships cm ON cm.club_id = pfp.current_club_id
      WHERE pfp.current_club_id IS NOT NULL AND cm.competition_season_id IS NOT NULL`,
    )
    .all() as Array<{ player_id: EntityId; club_id: EntityId; competition_season_id: EntityId }>) {
    const registration: CompetitionRegistration = {
      id: createStableEntityId(
        "competition-registration",
        `${row.player_id}:${row.club_id}:${row.competition_season_id}:contracted`,
      ),
      playerId: row.player_id,
      clubId: row.club_id,
      competitionSeasonId: row.competition_season_id,
      registrationType: "CONTRACTED",
      registeredFrom: worldDate,
      status: "ACTIVE",
    };
    market.upsertCompetitionRegistration(registration);
  }
  const nslSeason = db
    .prepare(
      `SELECT cs.id AS seasonId
      FROM competition_seasons cs
      JOIN competitions c ON c.id = cs.competition_id
      WHERE c.category = 'FRANCHISE_LEAGUE'
      ORDER BY cs.start_date LIMIT 1`,
    )
    .get() as { seasonId: EntityId } | undefined;
  const nslClub = db
    .prepare(
      "SELECT id FROM clubs WHERE canonical_external_id LIKE 'NEP-NSL-%' ORDER BY id LIMIT 1",
    )
    .get() as { id: EntityId } | undefined;
  const player = marketPlayers(db).find((item) => item.currentClubId && item.currentAbility >= 8);
  if (nslSeason && nslClub && player) {
    market.upsertCompetitionRegistration({
      id: createStableEntityId(
        "competition-registration",
        `${player.playerId}:${nslSeason.seasonId}:temporary-nsl`,
      ),
      playerId: player.playerId,
      clubId: nslClub.id,
      competitionSeasonId: nslSeason.seasonId,
      registrationType: "TEMPORARY_NSL",
      registeredFrom: worldDate,
      registeredUntil: addDays(worldDate, 60),
      status: "ACTIVE",
    });
  }
};

const movePlayerAssignment = (
  db: GameDatabase,
  playerId: EntityId,
  clubId: EntityId,
  startDate: string,
  temporaryUntil?: string,
): void => {
  const teamId = teamIdForClub(db, clubId);
  if (!teamId) return;
  const market = new TransferMarketRepository(db);
  market.endActiveTeamAssignments(playerId, startDate);
  market.insertTeamAssignment({
    id: createStableEntityId("team-person-assignment", `${playerId}:${teamId}:${startDate}`),
    personId: playerId,
    teamId,
    role: "PLAYER",
    startedOn: startDate,
    endedOn: temporaryUntil,
  });
};

const refreshClubWageSpend = (db: GameDatabase, worldDate: string): void => {
  const market = new TransferMarketRepository(db);
  for (const club of marketClubs(db)) {
    const profile = market.clubFinancialProfile(club.id);
    if (profile) {
      market.upsertClubFinancialProfile({
        ...profile,
        currentWageSpend: market
          .activeContractsForClub(club.id, worldDate)
          .reduce((total, contract) => total + contract.salary, 0),
      });
    }
  }
};

const expirePendingOffers = (db: GameDatabase, worldDate: string): void => {
  const market = new TransferMarketRepository(db);
  for (const offer of market.transferOffers()) {
    if (
      ["SUBMITTED", "NEGOTIATING", "ACCEPTED"].includes(offer.status) &&
      offer.expiresAt < worldDate
    ) {
      market.updateOfferStatus(offer.id, "EXPIRED");
    }
  }
};

const freeAgentStatus = (playerId: EntityId, worldDate: string): PlayerTransferStatusRecord => ({
  id: createStableEntityId("player-transfer-status", playerId),
  playerId,
  status: "FREE_AGENT",
  reason: "No active player contract",
  setBy: "SYSTEM",
  updatedAt: worldDate,
});

const initialTransferStatus = (
  player: MarketPlayer,
  contract: PlayerContractRecord,
  worldDate: string,
): PlayerTransferStatusRecord => ({
  id: createStableEntityId("player-transfer-status", player.playerId),
  playerId: player.playerId,
  clubId: contract.clubId,
  status:
    contract.endDate <= addDays(worldDate, 120)
      ? "CONTRACT_EXPIRING"
      : contract.squadRole === "BACKUP" && player.appearances < 3
        ? "AVAILABLE"
        : "NOT_FOR_SALE",
  reason:
    contract.endDate <= addDays(worldDate, 120)
      ? "Contract approaching expiry"
      : "Starting market assessment",
  setBy: "SYSTEM",
  updatedAt: worldDate,
});

const marketPlayers = (db: GameDatabase, playerId?: EntityId): MarketPlayer[] =>
  db
    .prepare(
      /*
       * A factual profile marks an imported player, not a footballer. Requiring
       * one hid every generated player — including the contracted squads of the
       * context-only foreign clubs — from the whole transfer engine, so they
       * could never be a loan candidate or a purchase target. Player attributes
       * are the real marker, and current club falls back to the active
       * contract when there is no imported profile to read it from.
       */
      `SELECT p.id AS player_id, p.full_name, p.date_of_birth,
        COALESCE(pfp.current_club_id, MAX(pc.club_id)) AS current_club_id,
        pfp.simulation_json, pfp.factual_json, pa.primary_position, tpa.team_id,
        COALESCE(SUM(pss.appearances), 0) AS appearances,
        COALESCE(SUM(pss.goals), 0) AS goals
      FROM persons p
      LEFT JOIN player_attributes pa ON pa.person_id = p.id
      LEFT JOIN player_factual_profiles pfp ON pfp.player_id = p.id
      LEFT JOIN player_contracts pc ON pc.player_id = p.id AND pc.status = 'ACTIVE'
      LEFT JOIN team_person_assignments tpa ON tpa.person_id = p.id AND tpa.role = 'PLAYER' AND tpa.ended_on IS NULL
      LEFT JOIN player_season_stats pss ON pss.person_id = p.id
      WHERE (pa.person_id IS NOT NULL OR pfp.player_id IS NOT NULL)
        AND (? IS NULL OR p.id = ?)
      GROUP BY p.id
      ORDER BY p.full_name, p.id`,
    )
    .all(playerId ?? null, playerId ?? null)
    .map((row: any) => {
      const simulation = JSON.parse(row.simulation_json ?? "{}");
      const factual = JSON.parse(row.factual_json ?? "{}");
      const position =
        simulation.simulationPrimaryPosition ?? row.primary_position ?? factual.primary_position;
      return {
        playerId: row.player_id,
        fullName: row.full_name,
        currentClubId: row.current_club_id ?? undefined,
        teamId: row.team_id ?? undefined,
        position: position || "MID",
        positionGroup: positionGroup(position),
        currentAbility: simulation.currentAbility ?? 7,
        potentialAbility: simulation.potentialAbility ?? 10,
        reputation: simulation.reputation ?? 5,
        age: row.date_of_birth ? ageOn(row.date_of_birth, "2026-08-01") : 24,
        appearances: Number(row.appearances ?? 0),
        goals: Number(row.goals ?? 0),
      };
    });

/*
 * One player used to cost a full market build: every row queried, its JSON
 * parsed and mapped, then all but one discarded. That runs inside per-player
 * and per-club loops, so the market initialization was quadratic in the squad
 * population.
 */
const marketPlayer = (db: GameDatabase, playerId: EntityId): MarketPlayer | undefined =>
  marketPlayers(db, playerId)[0];

export const positionGroupForPlayer = (
  db: GameDatabase,
  playerId: EntityId,
): string | undefined => {
  const row = db
    .prepare(
      `SELECT pa.primary_position, pfp.factual_json, pfp.simulation_json
       FROM persons p
       LEFT JOIN player_attributes pa ON pa.person_id = p.id
       LEFT JOIN player_factual_profiles pfp ON pfp.player_id = p.id
       WHERE p.id = ?`,
    )
    .get(playerId) as
    { primary_position?: string; factual_json?: string; simulation_json?: string } | undefined;
  if (!row) return undefined;
  const factual = JSON.parse(row.factual_json ?? "{}");
  const simulation = JSON.parse(row.simulation_json ?? "{}");
  const position =
    simulation.simulationPrimaryPosition ?? row.primary_position ?? factual.primary_position;
  return position ? positionGroup(position) : undefined;
};

const playersForClub = (db: GameDatabase, clubId: EntityId): MarketPlayer[] =>
  marketPlayers(db).filter(
    (player) => player.currentClubId === clubId || player.teamId === teamIdForClub(db, clubId),
  );

const marketClubs = (db: GameDatabase): MarketClub[] =>
  db
    .prepare("SELECT id, name, canonical_external_id, country_id FROM clubs ORDER BY name")
    .all()
    .map((row: any) => ({
      id: row.id,
      name: row.name,
      canonicalExternalId: row.canonical_external_id ?? undefined,
      countryId: row.country_id,
    }));

const activeSquadSizes = (db: GameDatabase): Map<EntityId, number> =>
  new Map(
    (
      db
        .prepare(
          `SELECT t.club_id AS clubId, COUNT(DISTINCT tpa.person_id) AS players
          FROM teams t
          JOIN team_person_assignments tpa ON tpa.team_id = t.id
          WHERE t.club_id IS NOT NULL AND t.level = 'senior'
            AND tpa.role = 'PLAYER' AND tpa.ended_on IS NULL
          GROUP BY t.club_id`,
        )
        .all() as Array<{ clubId: EntityId; players: number }>
    ).map((row) => [row.clubId, row.players]),
  );

const teamIdForClub = (db: GameDatabase, clubId: EntityId): EntityId | undefined =>
  (
    db
      .prepare("SELECT id FROM teams WHERE club_id = ? AND level = 'senior' ORDER BY id LIMIT 1")
      .get(clubId) as { id: EntityId } | undefined
  )?.id;

const totalWages = (db: GameDatabase, worldDate: string): number =>
  marketClubs(db).reduce(
    (total, club) =>
      total +
      new TransferMarketRepository(db)
        .activeContractsForClub(club.id, worldDate)
        .reduce((clubTotal, contract) => clubTotal + contract.salary, 0),
    0,
  );

const clubSalaryMultiplier = (club: MarketClub): number => {
  const key = club.canonicalExternalId ?? "";
  if (key.startsWith("NEP-DEP-")) return 1.28;
  if (["NEP-DIVA-MAC", "NEP-DIVA-MMC", "NEP-DIVA-CBU"].includes(key)) return 1.22;
  if (key.startsWith("NEP-NSL-")) return 1.18;
  if (key.includes("DIVB")) return 0.76;
  if (key.includes("DIVC")) return 0.58;
  return 1;
};

const squadRoleFor = (player: MarketPlayer): PlayerSquadRole => {
  if (player.currentAbility >= 10) return "KEY_PLAYER";
  if (player.currentAbility >= 8.8) return "IMPORTANT_PLAYER";
  if (player.currentAbility >= 7.8) return "FIRST_TEAM";
  if (player.currentAbility >= 6.8) return "ROTATION";
  if (player.potentialAbility >= 11 && player.age < 23) return "PROSPECT";
  return "BACKUP";
};

const squadRoleWeight = (role: PlayerSquadRole): number =>
  ({
    KEY_PLAYER: 1.9,
    IMPORTANT_PLAYER: 1.55,
    FIRST_TEAM: 1.25,
    ROTATION: 1,
    BACKUP: 0.72,
    PROSPECT: 0.86,
    YOUTH: 0.45,
  })[role];

const valueRange = (mid: number, spread: number): KnowledgeRange => ({
  min: Math.max(0, Math.round(mid * (1 - spread))),
  max: Math.max(0, Math.round(mid * (1 + spread))),
});

const midpoint = (range: KnowledgeRange): number => Math.round((range.min + range.max) / 2);

const contractExpiryFactor = (months: number): number => {
  if (months <= 1) return 0.38;
  if (months <= 6) return 0.58;
  if (months <= 12) return 0.82;
  if (months <= 24) return 1;
  return 1.12;
};

const sellerFinancePressureFactor = (finance?: ClubFinancialProfile): number => {
  if (!finance) return 1;
  if (finance.financialHealth === "POOR") return 0.78;
  if (finance.financialHealth === "GOOD") return 1.06;
  return 1;
};

const economicLevelFactor = (db: GameDatabase, finance?: ClubFinancialProfile): number => {
  if (!finance) return 1;
  const row = db
    .prepare(
      "SELECT AVG(transfer_budget) AS average FROM club_financial_profiles WHERE transfer_budget > 0",
    )
    .get() as { average?: number };
  const average = row.average ?? finance.transferBudget;
  return Math.max(0.78, Math.min(1.28, finance.transferBudget / Math.max(1, average)));
};

const buyerWealthFactor = (buyer?: ClubFinancialProfile, seller?: ClubFinancialProfile): number => {
  if (!buyer || !seller) return 1;
  return Math.max(0.92, Math.min(1.24, buyer.transferBudget / Math.max(1, seller.transferBudget)));
};

const positionalScarcityFactor = (
  db: GameDatabase,
  sellerId?: EntityId,
  positionGroupValue?: string,
): number => {
  if (!sellerId || !positionGroupValue) return 1;
  const sameGroup = playersForClub(db, sellerId).filter(
    (player) => player.positionGroup === positionGroupValue,
  ).length;
  if (sameGroup <= 1) return 1.3;
  if (sameGroup === 2) return 1.16;
  if (sameGroup >= 7) return 0.94;
  return 1;
};

const windowTimingFactor = (market: TransferMarketRepository, worldDate: string): number => {
  const open = market.openTransferWindows(worldDate);
  if (open.length === 0) return 0.94;
  const daysToClose = Math.min(
    ...open.map((window) =>
      Math.max(
        0,
        Math.floor(
          (Date.parse(`${window.closeDate}T00:00:00.000Z`) -
            Date.parse(`${worldDate}T00:00:00.000Z`)) /
            86400000,
        ),
      ),
    ),
  );
  if (daysToClose <= 7) return 1.18;
  if (daysToClose <= 21) return 1.08;
  return 1;
};

const playerDesireFactor = (
  status: PlayerTransferStatusRecord["status"] | undefined,
  months: number,
): number => {
  if (status === "TRANSFER_LISTED" || status === "AVAILABLE" || status === "INTERESTED_IN_MOVE") {
    return 0.86;
  }
  if (status === "UNSETTLED" || status === "CONTRACT_EXPIRING" || months <= 6) return 0.9;
  if (status === "NOT_FOR_SALE") return 1.06;
  return 1;
};

const knowledgeConfidence = (level: unknown): number => {
  if (level === "FULL") return 0.92;
  if (level === "HIGH") return 0.78;
  if (level === "MEDIUM") return 0.58;
  if (level === "LOW") return 0.36;
  return 0.24;
};

const buildPlayerExchange = (
  db: GameDatabase,
  input: {
    playerId: EntityId;
    fromClubId: EntityId;
    toClubId: EntityId;
    worldDate: string;
    requestedBy: "BUYING_CLUB" | "SELLING_CLUB";
  },
): TransferPlayerExchange => {
  const valuation = calculateTransferValuation(db, {
    buyingClubId: input.toClubId,
    sellingClubId: input.fromClubId,
    playerId: input.playerId,
    worldDate: input.worldDate,
  });
  return {
    playerId: input.playerId,
    fromClubId: input.fromClubId,
    toClubId: input.toClubId,
    valuation: valuation.scoutEstimate,
    requestedBy: input.requestedBy,
  };
};

const agentNetworkRank = (scope: AgentNetworkScope): number =>
  ({
    NEPAL_DOMESTIC: 1,
    SOUTH_ASIA: 2,
    WIDER_ASIA: 3,
    EUROPE_GLOBAL: 4,
  })[scope];

const preferredMarketsForNetwork = (scope: AgentNetworkScope): string[] =>
  ({
    NEPAL_DOMESTIC: ["NP"],
    SOUTH_ASIA: ["NP", "IN", "BD", "BT", "LK"],
    WIDER_ASIA: ["NP", "IN", "BD", "TH", "MY", "JP", "KR"],
    EUROPE_GLOBAL: ["NP", "IN", "JP", "KR", "GB", "DE", "ES", "PT"],
  })[scope];

const agencyNameForNetwork = (scope: AgentNetworkScope, index: number): string => {
  const names: Record<AgentNetworkScope, string> = {
    NEPAL_DOMESTIC: "Kathmandu Football Advisory",
    SOUTH_ASIA: "South Asia Sports Counsel",
    WIDER_ASIA: "AFC Pathway Management",
    EUROPE_GLOBAL: "Global Football Partners",
  };
  return `${names[scope]} ${index + 1}`;
};

const recommendedAgentNetwork = (input: {
  score: number;
  seniorAppearances: number;
  foreignInterest: number;
  foreignBased: number;
  competitionExposure?: "NONE" | "SAFF" | "ASIAN_CUP" | "FOREIGN_MOVE";
}): AgentNetworkScope => {
  if (
    input.foreignBased ||
    input.competitionExposure === "FOREIGN_MOVE" ||
    (input.foreignInterest && input.score >= 78)
  ) {
    return "EUROPE_GLOBAL";
  }
  if (input.competitionExposure === "ASIAN_CUP" || input.seniorAppearances >= 5) {
    return "WIDER_ASIA";
  }
  if (
    input.foreignInterest ||
    input.competitionExposure === "SAFF" ||
    input.seniorAppearances > 0
  ) {
    return "SOUTH_ASIA";
  }
  return "NEPAL_DOMESTIC";
};

const selectAgentForPlayer = (
  db: GameDatabase,
  minimumNetwork: AgentNetworkScope,
  seed: string,
  excludedAgentId?: EntityId,
): AgentProfile | undefined => {
  const agents = new TransferMarketRepository(db)
    .agents()
    .filter((agent) => agent.id !== excludedAgentId)
    .filter((agent) => agentNetworkRank(agent.networkScope) >= agentNetworkRank(minimumNetwork))
    .sort(
      (a, b) =>
        b.reputation +
          b.negotiationSkill / 2 -
          b.feeExpectation -
          (a.reputation + a.negotiationSkill / 2 - a.feeExpectation) ||
        String(a.id).localeCompare(String(b.id)),
    );
  if (agents.length === 0) return undefined;
  const rng = new SeededRandom(`${seed}:agent-selection:${minimumNetwork}`);
  return agents[Math.floor(rng.next() * Math.min(agents.length, 2))];
};

const seniorCallupCount = (db: GameDatabase, playerId: EntityId, worldDate: string): number =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS count
        FROM national_team_callups ntc
        JOIN teams t ON t.id = ntc.national_team_id
        WHERE ntc.player_id = ? AND ntc.callup_date <= ?
          AND t.level = 'senior' AND ntc.status = 'CALLED_UP'`,
      )
      .get(playerId, worldDate) as { count: number }
  ).count;

const youthCallupCount = (db: GameDatabase, playerId: EntityId, worldDate: string): number =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS count
        FROM national_team_callups ntc
        JOIN teams t ON t.id = ntc.national_team_id
        WHERE ntc.player_id = ? AND ntc.callup_date <= ?
          AND t.level IN ('u23', 'u20', 'u17') AND ntc.status = 'CALLED_UP'`,
      )
      .get(playerId, worldDate) as { count: number }
  ).count;

const seniorAppearanceCount = (db: GameDatabase, playerId: EntityId, worldDate: string): number =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS count
        FROM national_team_appearances nta
        JOIN teams t ON t.id = nta.national_team_id
        WHERE nta.player_id = ? AND nta.match_date <= ?
          AND t.level = 'senior' AND nta.minutes > 0`,
      )
      .get(playerId, worldDate) as { count: number }
  ).count;

const foreignInterestCount = (db: GameDatabase, playerId: EntityId, worldDate: string): number =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS count
        FROM transfer_offers offer
        JOIN clubs buyer ON buyer.id = offer.buying_club_id
        JOIN countries country ON country.id = buyer.country_id
        WHERE offer.player_id = ? AND offer.submitted_at <= ?
          AND country.iso_code NOT IN ('NP', 'NPL')`,
      )
      .get(playerId, worldDate) as { count: number }
  ).count;

const isForeignBased = (db: GameDatabase, clubId?: EntityId): boolean => {
  if (!clubId) return false;
  const row = db
    .prepare(
      `SELECT country.iso_code AS isoCode
      FROM clubs club
      JOIN countries country ON country.id = club.country_id
      WHERE club.id = ?`,
    )
    .get(clubId) as { isoCode?: string } | undefined;
  return Boolean(row?.isoCode && !["NP", "NPL"].includes(row.isoCode));
};

const positionGroup = (position: string): string => {
  if (position === "GK") return "GOALKEEPER";
  if (["CB", "LB", "RB"].includes(position)) return "DEFENDER";
  if (["DM", "CM", "AM"].includes(position)) return "MIDFIELDER";
  return "FORWARD";
};

const simulationOnlyProvenance = (summary: string) => ({
  sourceName: "Nepal football simulation",
  lastVerifiedDate: "2026-08-01",
  confidence: 0,
  confidenceLevel: "LOW" as const,
  status: "SIMULATION_ONLY" as const,
  notes: summary,
});

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const daysBetween = (from: string, to: string): number =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );

const addMonths = (date: string, months: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + months);
  return parsed.toISOString().slice(0, 10);
};

const monthsBetween = (from: string, to: string): number =>
  Math.max(
    0,
    Math.floor(
      (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 2629800000,
    ),
  );

const ageOn = (dateOfBirth: string, worldDate: string): number =>
  Math.floor(
    (Date.parse(`${worldDate}T00:00:00.000Z`) - Date.parse(`${dateOfBirth}T00:00:00.000Z`)) /
      31557600000,
  );

const hashCode = (value: string): number =>
  [...value].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0);
