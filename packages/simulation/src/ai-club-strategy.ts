import {
  createStableEntityId,
  type ClubAiDecision,
  type ClubBoardPolicy,
  type ClubStrategicIdentity,
  type EntityId,
} from "@nepal-football-sim/shared-types";
import { ClubEconomyRepository, TransferMarketRepository, type GameDatabase } from "@nepal-football-sim/database";
import {
  acceptSponsorOffer,
  createInfrastructureProject,
  generateSponsorOffers,
} from "./club-economy.js";
import { preferredForeignMarkets } from "./external-football-world.js";
import { createProcurementRequest, selectProcurementOffer } from "./clubmart.js";
import { analyzeSquadNeeds, positionGroupForPlayer, recallLoan } from "./transfer-market.js";
import { considerInternationalTrialsForClub } from "./international-trials.js";
import { manageClubInsuranceForSeason } from "./insurance.js";

const seasonLabel = (date: string): string => date.slice(0, 4);

const objectiveFor = (policy: ClubBoardPolicy, health: string, cash: number): ClubBoardPolicy["strategicObjective"] => {
  if (health === "INSOLVENT" || health === "DISTRESSED" || cash < 1000000) return "SURVIVE";
  return policy.strategicObjective;
};

const candidateIdentity = (ownershipType: string, policy: ClubBoardPolicy, facilityQuality: number, reputation: number, commercialReputation: number): ClubStrategicIdentity => {
  if (ownershipType === "DEPARTMENTAL" || policy.infrastructurePriority >= 0.78 || facilityQuality >= 7.5) return "INFRASTRUCTURE_FIRST";
  if (ownershipType === "FRANCHISE" || policy.commercialPriority >= 0.78 || commercialReputation >= 8.5) return "COMMERCIAL_GROWTH";
  if (policy.youthPriority >= 0.72) return "ACADEMY_FIRST";
  if (policy.transferPhilosophy === "PLAYER_TRADING") return "DEVELOPMENT_SELLING";
  if (policy.transferPhilosophy === "AGGRESSIVE") return "AMBITIOUS_SPENDER";
  if (policy.transferPhilosophy === "CONSERVATIVE" || facilityQuality < 3 || reputation < 4) return "FINANCIALLY_CAUTIOUS";
  return "VETERAN_FOCUSED";
};

const stableIdentity = (candidate: ClubStrategicIdentity, previous: ClubAiDecision | undefined, crisis: boolean): ClubStrategicIdentity => {
  if (!previous?.identity) return candidate;
  if (crisis && previous.objective === "SURVIVE") return "FINANCIALLY_CAUTIOUS";
  if (candidate === previous.identity) return candidate;
  return previous.context.previousIdentity === candidate ? candidate : previous.identity;
};

const prioritiesFor = (policy: ClubBoardPolicy, health: string, identity: ClubStrategicIdentity): Record<string, number> => {
  const pressure = health === "TIGHT" ? 1.2 : health === "STABLE" ? 1 : 0.82;
  const priorities = {
    squad: Number((Math.max(0.1, 1 - policy.youthPriority) * pressure).toFixed(3)),
    wages: Number((health === "DISTRESSED" ? 0.8 : 1).toFixed(3)),
    staff: Number((0.35 + policy.youthPriority * 0.35).toFixed(3)),
    infrastructure: Number((policy.infrastructurePriority * pressure).toFixed(3)),
    youth: Number((policy.youthPriority * pressure).toFixed(3)),
    commercial: Number((policy.commercialPriority * pressure).toFixed(3)),
  };
  if (identity === "ACADEMY_FIRST" || identity === "DEVELOPMENT_SELLING" || identity === "LOAN_DEVELOPMENT_HEAVY") priorities.youth += 0.25;
  if (identity === "COMMERCIAL_GROWTH") priorities.commercial += 0.3;
  if (identity === "INFRASTRUCTURE_FIRST") priorities.infrastructure += 0.3;
  if (identity === "AMBITIOUS_SPENDER" || identity === "VETERAN_FOCUSED") priorities.squad += 0.2;
  if (identity === "FINANCIALLY_CAUTIOUS") { priorities.squad *= 0.7; priorities.infrastructure *= 0.7; }
  return Object.fromEntries(Object.entries(priorities).map(([key, value]) => [key, Number(value.toFixed(3))]));
};

export type AiLoanRecallDiagnostics = {
  activeLoansConsidered: number;
  recallEligible: number;
  recallRejectedByAgreementOrDate: number;
  squadNeedCandidates: number;
  recallsRequested: number;
  recallsCompleted: number;
};

const MAX_RECALL_EVALUATIONS_PER_CLUB = 4;
const MAX_RECALLS_PER_CLUB = 1;

const reviewAiLoanRecalls = (
  db: GameDatabase,
  market: TransferMarketRepository,
  clubId: EntityId,
  worldDate: string,
): AiLoanRecallDiagnostics => {
  const diagnostics: AiLoanRecallDiagnostics = {
    activeLoansConsidered: 0,
    recallEligible: 0,
    recallRejectedByAgreementOrDate: 0,
    squadNeedCandidates: 0,
    recallsRequested: 0,
    recallsCompleted: 0,
  };
  const loans = market
    .activeLoansForParent(clubId, worldDate)
    .slice(0, MAX_RECALL_EVALUATIONS_PER_CLUB);
  if (loans.length === 0) return diagnostics;
  const needs = analyzeSquadNeeds(db, clubId, worldDate).needs;
  for (const loan of loans) {
    diagnostics.activeLoansConsidered += 1;
    const eligible =
      loan.recallAllowed && worldDate >= loan.startDate && worldDate < loan.endDate;
    if (!eligible) {
      diagnostics.recallRejectedByAgreementOrDate += 1;
      continue;
    }
    diagnostics.recallEligible += 1;
    const positionGroup = positionGroupForPlayer(db, loan.playerId);
    const squadNeed = needs.find(
      (need) => need.positionGroup === positionGroup && need.severity === "HIGH",
    );
    if (!squadNeed) continue;
    diagnostics.squadNeedCandidates += 1;
    if (diagnostics.recallsRequested >= MAX_RECALLS_PER_CLUB) continue;
    diagnostics.recallsRequested += 1;
    try {
      const recalled = recallLoan(db, {
        loanId: loan.id,
        parentClubId: clubId,
        worldDate,
      });
      if (recalled.status === "ENDED") diagnostics.recallsCompleted += 1;
    } catch {
      // The canonical command remains authoritative if state changed between review and action.
    }
  }
  return diagnostics;
};

export const runClubAiSeasonPlanning = (db: GameDatabase, input: { date: string; seed: string }): ClubAiDecision[] => {
  if (!input.date.endsWith("-08-28")) return [];
  const economy = new ClubEconomyRepository(db);
  const market = new TransferMarketRepository(db);
  const decisions: ClubAiDecision[] = [];
  // Context-only foreign clubs have economy records so global market and
  // reporting paths can see them, but they do not run Nepal's detailed AI
  // planning/scouting/trial cadence. Keeping the scope in SQL prevents the
  // per-club candidate scan from widening with the imported world.
  const clubs = db
    .prepare(
      `SELECT c.id
       FROM clubs c
       WHERE NOT EXISTS (
         SELECT 1 FROM external_club_context ecc
         WHERE ecc.club_id = c.id AND ecc.simulation_depth = 'CONTEXT_ONLY'
       )
       ORDER BY c.id`,
    )
    .all() as Array<{ id: EntityId }>;
  for (const { id: clubId } of clubs) {
    const account = economy.financialAccount(clubId);
    const policy = economy.boardPolicy(clubId);
    if (!account || !policy) continue;
    const insurance = manageClubInsuranceForSeason(db, { clubId, date: input.date });
    const objective = objectiveFor(policy, account.financialHealth, account.cashBalance);
    const previous = economy.aiDecisions(clubId).at(-1);
    const ownership = (db.prepare("SELECT ownership_type FROM clubs WHERE id = ?").get(clubId) as { ownership_type?: string } | undefined)?.ownership_type ?? "UNKNOWN";
    const supporter = economy.supporterProfile(clubId);
    const commercial = economy.commercialProfile(clubId);
    const facilityQuality = economy.facilityProfile(clubId)?.trainingFacilityQuality ?? 3;
    const reputation = supporter?.footballReputation ?? 5;
    const commercialReputation = supporter?.commercialReputation ?? commercial?.brandStrength ?? 4;
    const candidate = candidateIdentity(ownership, policy, facilityQuality, reputation, commercialReputation);
    const identity = stableIdentity(candidate, previous, objective === "SURVIVE");
    const identityStrength = Math.min(1, (previous?.identity === identity ? (previous.identityStrength ?? 0.55) + 0.08 : 0.55));
    const priorities = prioritiesFor(policy, account.financialHealth, identity);
    const foreignMarkets = preferredForeignMarkets(db, seasonLabel(input.date));
    const contracts = market.activeContractsForClub(clubId, input.date);
    const activeProjects = economy.infrastructureProjects(clubId).filter((project) => !["COMPLETED", "CANCELLED"].includes(project.status));
    const procurement = economy.assets(clubId).filter((asset) => asset.assetType === "EQUIPMENT");
    const sponsorships = economy.sponsorships(clubId).filter((item) => item.status === "ACTIVE" && item.endDate >= input.date);
    const loanRecall = reviewAiLoanRecalls(db, market, clubId, input.date);
    const trialReviews = considerInternationalTrialsForClub(db, {
      clubId,
      worldDate: input.date,
      seed: `${input.seed}:trials:${clubId}`,
      maxCandidates: 2,
    });
    const actions = [
      contracts.length < 18 ? "ASSESS_SQUAD_NEEDS" : "REVIEW_SQUAD_DEPTH",
      contracts.filter((contract) => contract.endDate <= `${Number(input.date.slice(0, 4)) + 1}-08-28`).length > 0 ? "PRIORITISE_RENEWALS" : "MONITOR_CONTRACTS",
      account.financialHealth === "DISTRESSED" || account.financialHealth === "INSOLVENT" ? "RELEASE_OR_SELL_BEFORE_SPENDING" : "KEEP_WAGE_COMMITMENTS_WITHIN_BUDGET",
      priorities.youth >= priorities.squad ? "PROTECT_YOUTH_PATHWAY" : "RECRUIT_PUBLICLY_IDENTIFIED_SQUAD_NEEDS",
      sponsorships.length < 4 ? "REVIEW_COMMERCIAL_OFFERS" : "RETAIN_COMMERCIAL_PARTNERS",
    ];
    /*
     * Commercial AI. Until now "REVIEW_COMMERCIAL_OFFERS" was a label with
     * nothing behind it: `generateSponsorOffers`/`acceptSponsorOffer` were
     * only ever reached from the desktop service, so ONLY the human player's
     * club ever signed a sponsorship and every AI club's commercial income
     * stayed permanently at zero. An uncovered club now goes to market on the
     * same canonical path a player-controlled club uses, and takes the best
     * offer it is actually allowed to hold.
     *
     * A club can hold up to four concurrent sponsors (one per exclusivity
     * slot); gating on "any active sponsorship" rather than "still has an
     * open slot" meant a club's very first (baseline) sponsor permanently
     * blocked every other slot from ever being filled. generateSponsorOffers
     * itself now only proposes genuinely open slots, so this only needs to
     * skip clubs that are already fully sponsored.
     */
    if (sponsorships.length < 4 && account.financialHealth !== "INSOLVENT") {
      try {
        const offers = generateSponsorOffers(db, {
          clubId,
          date: input.date,
          seed: `${input.seed}:sponsor:${clubId}`,
        });
        // Highest annual value first — an AI board takes the best deal on the
        // table; exclusivity conflicts are rejected by the canonical command.
        const best = [...offers].sort((a, b) => b.annualValue - a.annualValue)[0];
        if (best) {
          acceptSponsorOffer(db, best.id, input.date);
          actions.push("SIGN_COMMERCIAL_PARTNER");
        }
      } catch {
        actions.push("DEFER_COMMERCIAL_PARTNERSHIP");
      }
    }
    if (insurance) actions.push(insurance.status === "ACTIVE" && insurance.startDate === input.date ? "ACTIVATE_INJURY_INSURANCE" : "RETAIN_INJURY_INSURANCE");
    if (trialReviews.length > 0) actions.push("REVIEW_INTERNATIONAL_TRIALS");
    if (loanRecall.activeLoansConsidered > 0) actions.push("REVIEW_ACTIVE_LOAN_RECALLS");
    if (loanRecall.recallsCompleted > 0) actions.push("RECALL_ON_LOAN_FOR_SQUAD_EMERGENCY");
    const movement = (db.prepare("SELECT movement_type FROM competition_movements WHERE club_id = ? ORDER BY rowid DESC LIMIT 1").get(clubId) as { movement_type?: string } | undefined)?.movement_type;
    if (movement === "PROMOTED") actions.push("CONSOLIDATE_AFTER_PROMOTION");
    if (movement === "RELEGATED") actions.push("REBUILD_AFTER_RELEGATION");
    if (identity === "ACADEMY_FIRST" || identity === "LOAN_DEVELOPMENT_HEAVY") actions.push("PRIORITISE_YOUTH_AND_DEVELOPMENT_PATHWAY");
    if (identity === "DEVELOPMENT_SELLING") actions.push("RECYCLE_PLAYER_SALES_INTO_SQUAD");
    if (identity === "COMMERCIAL_GROWTH") actions.push("PROTECT_COMMERCIAL_AUDIENCE_GROWTH");
    if (identity === "VETERAN_FOCUSED") actions.push("RETAIN_EXPERIENCED_CORE_WITHIN_WAGE_LIMIT");
    actions.push(identity === "DEVELOPMENT_SELLING" || identity === "ACADEMY_FIRST" ? `EXPORT_PATHWAY_${foreignMarkets.destination}` : `RECRUITMENT_MARKET_${foreignMarkets.source}`);
    if (procurement.length === 0 && account.financialHealth !== "INSOLVENT") {
      try {
        const request = createProcurementRequest(db, { clubId, category: identity === "ACADEMY_FIRST" ? "FOOTBALL_EQUIPMENT" : "MEDICAL_SUPPLIES", quantity: identity === "ACADEMY_FIRST" ? 12 : 4, date: input.date, seed: `${input.seed}:ai:${clubId}` });
        const selected = [...request.offers].sort((a, b) => a.unitPrice * request.request.quantity + a.shippingCost - (b.unitPrice * request.request.quantity + b.shippingCost) || b.reliability - a.reliability)[0];
        if (selected) { selectProcurementOffer(db, { offerId: selected.id, date: input.date }); actions.push("PROCURE_OPERATIONAL_EQUIPMENT"); }
      } catch { actions.push("DEFER_PROCUREMENT_FOR_AFFORDABILITY"); }
    }
    if (priorities.infrastructure >= 0.5 && activeProjects.length === 0 && account.cashBalance > 3500000) {
      try {
        createInfrastructureProject(db, { clubId, projectType: "TRAINING_GROUND", date: input.date, seed: `${input.seed}:ai:${clubId}` });
        actions.push("START_TRAINING_GROUND_PROJECT");
      } catch {
        actions.push("DEFER_INFRASTRUCTURE_FOR_AFFORDABILITY");
      }
    } else if (activeProjects.length > 0) {
      actions.push("REVIEW_EXISTING_PROJECT_DELIVERY");
    } else {
      actions.push("DEFER_INFRASTRUCTURE_FOR_AFFORDABILITY");
    }
    const decision: ClubAiDecision = {
      id: createStableEntityId("club-ai-decision", `${clubId}:${input.date}`),
      clubId,
      date: input.date,
      seasonLabel: seasonLabel(input.date),
      objective,
      priorities,
      actions,
      identity,
      identityStrength,
      context: { financialHealth: account.financialHealth, cash: account.cashBalance, reputation, commercialReputation, squadContracts: contracts.length, activeProjects: activeProjects.length, strategicIdentity: identity, identityStrength, previousIdentity: previous?.identity ?? "", lastMovement: movement ?? "NONE", foreignSource: foreignMarkets.source, foreignDestination: foreignMarkets.destination, activeLoansConsidered: loanRecall.activeLoansConsidered, recallEligible: loanRecall.recallEligible, recallRejectedByAgreementOrDate: loanRecall.recallRejectedByAgreementOrDate, squadNeedCandidates: loanRecall.squadNeedCandidates, recallsRequested: loanRecall.recallsRequested, recallsCompleted: loanRecall.recallsCompleted },
      status: "SIMULATION_ONLY",
    };
    economy.upsertAiDecision(decision);
    decisions.push(decision);
  }
  return decisions;
};
