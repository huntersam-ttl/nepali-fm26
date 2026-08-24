import {
  createStableEntityId,
  type AgentProfile,
  type ClubEmploymentModel,
  type ClubEmploymentProfile,
  type ClubFinancialProfile,
  type CompetitionRegistration,
  type EntityId,
  type KnowledgeRange,
  type NegotiationRound,
  type PlayerContractRecord,
  type PlayerLoanRecord,
  type PlayerSquadRole,
  type PlayerTransferStatusRecord,
  type SquadNeed,
  type SquadNeedReport,
  type TransferOffer,
} from "@nepal-football-sim/shared-types";
import {
  RecruitmentRepository,
  TransferMarketRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { clubCanAffordTransfer, clubCanAffordWage, recordTransferEconomy } from "./club-economy.js";
import { SeededRandom } from "./rng.js";
import { initializeRecruitmentForSave, searchPlayersForClub } from "./scouting.js";

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
  accepted: number;
  rejected: number;
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
  if (market.allPlayerContracts().length > 0) {
    return;
  }
  initializeRecruitmentForSave(input);
  const clubs = marketClubs(input.db);
  for (const club of clubs) {
    const employment = employmentProfile(club);
    market.upsertClubEmploymentProfile(employment);
    market.upsertClubFinancialProfile({
      ...financialProfile(input.db, club, input.seed),
      currentWageSpend: 0,
    });
  }
  seedTransferWindows(input.db, input.worldDate);
  seedAgents(input.db, input.seed, input.worldDate);
  for (const player of marketPlayers(input.db)) {
    if (!player.currentClubId) {
      market.upsertTransferStatus(freeAgentStatus(player.playerId, input.worldDate));
      continue;
    }
    const club = clubs.find((item) => item.id === player.currentClubId);
    if (!club) {
      continue;
    }
    const contract = startingContract(input.db, player, club, input.worldDate, input.seed);
    market.upsertPlayerContract(contract);
    market.upsertTransferStatus(initialTransferStatus(player, contract, input.worldDate));
  }
  refreshClubWageSpend(input.db, input.worldDate);
  seedCompetitionRegistrations(input.db, input.worldDate);
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
  let renewals = 0;
  let releases = 0;
  let rejected = 0;
  let accepted = 0;
  const beforeWages = totalWages(input.db, input.worldDate);

  for (const loan of market.endingLoans(input.worldDate)) {
    endLoan(input.db, loan, input.worldDate);
    loanReturns += 1;
  }

  const expiry = processContractExpiries(input.db, input.worldDate);
  releases += expiry.releases;

  const clubs = marketClubs(input.db);
  const squadSizes = activeSquadSizes(input.db);
  const activeClubs = clubs.filter((club) => (squadSizes.get(club.id) ?? 0) >= 11);
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
        completedTransfers += 1;
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
  const sampleOffer = offers.find((offer) => market.negotiationRounds(offer.id).length > 0);
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

export const analyzeSquadNeeds = (
  db: GameDatabase,
  clubId: EntityId,
  worldDate: string,
): SquadNeedReport => {
  const players = playersForClub(db, clubId);
  const contracts = new TransferMarketRepository(db).activeContractsForClub(clubId, worldDate);
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
  },
): TransferOffer => {
  const knowledge = new RecruitmentRepository(db).playerKnowledge(
    input.buyingClubId,
    input.playerId,
  );
  const ability = knowledge?.abilityKnowledge.estimatedAbility as KnowledgeRange | undefined;
  const fee = input.fee ?? Math.round(((ability?.max ?? 7) + (ability?.min ?? 5)) * 30000);
  const offer: TransferOffer = {
    id: createStableEntityId(
      "transfer-offer",
      `${input.buyingClubId}:${input.sellingClubId ?? "free"}:${input.playerId}:${input.submittedAt}:${fee}`,
    ),
    buyingClubId: input.buyingClubId,
    sellingClubId: input.sellingClubId,
    playerId: input.playerId,
    offerType: input.sellingClubId ? "PERMANENT" : "FREE_TRANSFER",
    transferFee: input.sellingClubId ? fee : 0,
    installments: 0,
    addOns: Math.round(fee * 0.1),
    sellOnPercentage: input.sellingClubId ? 5 : 0,
    submittedAt: input.submittedAt,
    expiresAt: addDays(input.submittedAt, 14),
    status: "SUBMITTED",
    currency,
    askingRange: ability
      ? { min: Math.round(ability.min * 45000), max: Math.round(ability.max * 90000) }
      : undefined,
    agentFee: Math.round(fee * 0.04),
    signingFee: Math.round(fee * 0.08),
  };
  new TransferMarketRepository(db).insertTransferOffer(offer);
  return offer;
};

export const evaluateTransferOffer = (
  db: GameDatabase,
  offer: TransferOffer,
  worldDate: string,
  seed: string,
): { accepted: boolean; reason: string } => {
  const market = new TransferMarketRepository(db);
  const contract = market.activeContract(offer.playerId, worldDate);
  const player = marketPlayer(db, offer.playerId);
  const roleWeight = contract ? squadRoleWeight(contract.squadRole) : 1;
  const months = contract ? monthsBetween(worldDate, contract.endDate) : 0;
  const base = Math.round((player?.currentAbility ?? 7) * 70000 * roleWeight);
  const remaining = Math.max(0.45, Math.min(1.6, months / 12));
  const ask = Math.round(base * remaining);
  const accepted = !offer.sellingClubId || offer.transferFee + offer.addOns >= ask * 0.38;
  market.insertNegotiationRound({
    id: createStableEntityId("negotiation-round", `${offer.id}:seller:1`),
    offerId: offer.id,
    roundNumber: 1,
    actor: "SELLING_CLUB",
    action: accepted ? "ACCEPT" : "REJECT",
    message: accepted
      ? `Accepted within internal willingness range (${seed})`
      : `Rejected because player importance and contract remaining outweighed fee`,
    createdAt: worldDate,
  });
  market.updateOfferStatus(offer.id, accepted ? "ACCEPTED" : "REJECTED");
  return { accepted, reason: accepted ? "accepted" : "seller value not met" };
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
  const salary = Math.max(
    current?.salary ?? 0,
    Math.round(
      ((player?.currentAbility ?? 7) * 18000 + (agent?.feeExpectation ?? 8) * 2500) *
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
    agentFee: offer.agentFee,
    signingFee: offer.signingFee,
    message: `${agent?.negotiationStyle ?? "BALANCED"} agent seeks role and fee guarantees`,
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
    agentFee: offer.agentFee,
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

export const completePermanentTransfer = (
  db: GameDatabase,
  offer: TransferOffer,
  worldDate: string,
  seed: string,
): void => {
  const market = new TransferMarketRepository(db);
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
  market.upsertTransferStatus({
    id: createStableEntityId("player-transfer-status", offer.playerId),
    playerId: offer.playerId,
    clubId: offer.buyingClubId,
    status: "NOT_FOR_SALE",
    reason: "Recently signed",
    setBy: "SYSTEM",
    updatedAt: worldDate,
  });
  market.insertTransferHistoryEvent({
    id: createStableEntityId(
      "transfer-history",
      `${offer.playerId}:transfer:${worldDate}:${offer.id}`,
    ),
    playerId: offer.playerId,
    clubId: offer.buyingClubId,
    relatedClubId: offer.sellingClubId,
    eventType: offer.offerType === "FREE_TRANSFER" ? "FREE_AGENT_SIGNED" : "TRANSFER_COMPLETED",
    occurredOn: worldDate,
    data: { transferFee: offer.transferFee, currency: offer.currency },
  });
  recordTransferEconomy(db, offer, worldDate);
};

export const startLoan = (
  db: GameDatabase,
  parentClubId: EntityId,
  loanClubId: EntityId,
  playerId: EntityId,
  worldDate: string,
  seed: string,
): PlayerLoanRecord => {
  const market = new TransferMarketRepository(db);
  const loan: PlayerLoanRecord = {
    id: createStableEntityId(
      "player-loan",
      `${playerId}:${parentClubId}:${loanClubId}:${worldDate}`,
    ),
    parentClubId,
    loanClubId,
    playerId,
    startDate: worldDate,
    endDate: addMonths(worldDate, 6),
    wageContributionPercent: 55,
    loanFee: 0,
    playingTimeExpectation: "ROTATION",
    recallAllowed: true,
    status: "ACTIVE",
  };
  market.upsertLoan(loan);
  movePlayerAssignment(db, playerId, loanClubId, worldDate);
  market.insertTransferHistoryEvent({
    id: createStableEntityId("transfer-history", `${playerId}:loan:${worldDate}:${seed}`),
    playerId,
    clubId: parentClubId,
    relatedClubId: loanClubId,
    eventType: "LOAN_STARTED",
    occurredOn: worldDate,
    data: { wageContributionPercent: loan.wageContributionPercent },
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

const processContractExpiries = (db: GameDatabase, worldDate: string): { releases: number } => {
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

const signFreeAgent = (
  db: GameDatabase,
  clubId: EntityId,
  playerId: EntityId,
  worldDate: string,
  seed: string,
): void => {
  const offer = createTransferOffer(db, {
    buyingClubId: clubId,
    playerId,
    submittedAt: worldDate,
    fee: 0,
  });
  new TransferMarketRepository(db).updateOfferStatus(offer.id, "ACCEPTED");
  completePermanentTransfer(db, offer, worldDate, seed);
};

const endLoan = (db: GameDatabase, loan: PlayerLoanRecord, worldDate: string): void => {
  const market = new TransferMarketRepository(db);
  market.upsertLoan({ ...loan, status: "ENDED" });
  movePlayerAssignment(db, loan.playerId, loan.parentClubId, worldDate);
  market.insertTransferHistoryEvent({
    id: createStableEntityId("transfer-history", `${loan.playerId}:loan-ended:${worldDate}`),
    playerId: loan.playerId,
    clubId: loan.parentClubId,
    relatedClubId: loan.loanClubId,
    eventType: "LOAN_ENDED",
    occurredOn: worldDate,
  });
};

const createAiTransferOffer = (
  db: GameDatabase,
  clubId: EntityId,
  need: SquadNeed,
  worldDate: string,
  seed: string,
): TransferOffer | undefined => {
  const candidates = searchPlayersForClub(db, clubId, {}, worldDate)
    .filter((candidate) => candidate.clubId && candidate.clubId !== clubId)
    .filter(
      (candidate) =>
        need.positionGroup === "DEPTH" || candidate.publicPositionGroup === need.positionGroup,
    )
    .filter((candidate) => (candidate.estimatedAbility?.max ?? 0) >= 7)
    .sort(
      (a, b) =>
        (b.estimatedAbility?.max ?? 0) - (a.estimatedAbility?.max ?? 0) ||
        String(a.playerId).localeCompare(String(b.playerId)),
    );
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
  _clubId: EntityId,
  need: SquadNeed,
  worldDate: string,
): MarketPlayer | undefined =>
  marketPlayers(db)
    .filter(
      (player) => !new TransferMarketRepository(db).activeContract(player.playerId, worldDate),
    )
    .filter(
      (player) => need.positionGroup === "DEPTH" || player.positionGroup === need.positionGroup,
    )
    .sort(
      (a, b) =>
        b.currentAbility - a.currentAbility || String(a.playerId).localeCompare(String(b.playerId)),
    )[0];

const findLoanCandidate = (
  db: GameDatabase,
  clubId: EntityId,
  need: SquadNeed,
  worldDate: string,
): { parentClubId: EntityId; playerId: EntityId } | undefined => {
  for (const player of marketPlayers(db)
    .filter((item) => item.currentClubId && item.currentClubId !== clubId)
    .filter((item) => need.positionGroup === "DEPTH" || item.positionGroup === need.positionGroup)
    .sort((a, b) => a.appearances - b.appearances || a.age - b.age)) {
    const contract = new TransferMarketRepository(db).activeContract(player.playerId, worldDate);
    if (contract && ["BACKUP", "PROSPECT", "YOUTH"].includes(contract.squadRole)) {
      return { parentClubId: contract.clubId, playerId: player.playerId };
    }
  }
  return undefined;
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
    (28000 + player.currentAbility * 14500 + player.reputation * 4200) * clubSalaryMultiplier(club),
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
  db: GameDatabase,
  club: MarketClub,
  seed: string,
): ClubFinancialProfile => {
  const rng = new SeededRandom(`${seed}:finance:${club.id}`);
  const multiplier = clubSalaryMultiplier(club);
  return {
    id: createStableEntityId("club-financial-profile", club.id),
    clubId: club.id,
    wageBudget: Math.round(3600000 * multiplier + rng.next() * 900000),
    transferBudget: Math.round(900000 * multiplier + rng.next() * 500000),
    currentWageSpend: playersForClub(db, club.id).length * Math.round(55000 * multiplier),
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
      market.upsertAgent({
        id: createStableEntityId("agent", personId),
        personId,
        agencyName: index % 2 === 0 ? `Kathmandu Football Advisory ${index + 1}` : undefined,
        reputation: 5 + Math.floor(rng.next() * 11),
        negotiationStyle: styles[index % styles.length]!,
        aggressiveness: 5 + Math.floor(rng.next() * 11),
        loyaltyPreference: 5 + Math.floor(rng.next() * 11),
        feeExpectation: 5 + Math.floor(rng.next() * 11),
        careerAmbition: 5 + Math.floor(rng.next() * 11),
        status: "SIMULATION_ONLY",
      });
    }
  }
  const agents = market.agents();
  for (const player of marketPlayers(db)) {
    const agent = agents[Math.abs(hashCode(String(player.playerId))) % agents.length];
    if (agent) {
      market.upsertAgentClient({
        id: createStableEntityId("agent-client", `${agent.id}:${player.playerId}`),
        agentId: agent.id,
        playerId: player.playerId,
        startedAt: worldDate,
        status: "ACTIVE",
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

const marketPlayers = (db: GameDatabase): MarketPlayer[] =>
  db
    .prepare(
      `SELECT p.id AS player_id, p.full_name, p.date_of_birth, pfp.current_club_id,
        pfp.simulation_json, pa.primary_position, tpa.team_id,
        COALESCE(SUM(pss.appearances), 0) AS appearances,
        COALESCE(SUM(pss.goals), 0) AS goals
      FROM persons p
      JOIN player_factual_profiles pfp ON pfp.player_id = p.id
      JOIN player_attributes pa ON pa.person_id = p.id
      LEFT JOIN team_person_assignments tpa ON tpa.person_id = p.id AND tpa.role = 'PLAYER' AND tpa.ended_on IS NULL
      LEFT JOIN player_season_stats pss ON pss.person_id = p.id
      GROUP BY p.id
      ORDER BY p.full_name, p.id`,
    )
    .all()
    .map((row: any) => {
      const simulation = JSON.parse(row.simulation_json ?? "{}");
      const position = simulation.simulationPrimaryPosition ?? row.primary_position;
      return {
        playerId: row.player_id,
        fullName: row.full_name,
        currentClubId: row.current_club_id ?? undefined,
        teamId: row.team_id ?? undefined,
        position,
        positionGroup: positionGroup(position),
        currentAbility: simulation.currentAbility ?? 7,
        potentialAbility: simulation.potentialAbility ?? 10,
        reputation: simulation.reputation ?? 5,
        age: row.date_of_birth ? ageOn(row.date_of_birth, "2026-08-01") : 24,
        appearances: Number(row.appearances ?? 0),
        goals: Number(row.goals ?? 0),
      };
    });

const marketPlayer = (db: GameDatabase, playerId: EntityId): MarketPlayer | undefined =>
  marketPlayers(db).find((player) => player.playerId === playerId);

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
