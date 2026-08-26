import {
  createStableEntityId,
  type ClubAiDecision,
  type ClubBoardPolicy,
  type EntityId,
} from "@nepal-football-sim/shared-types";
import { ClubEconomyRepository, TransferMarketRepository, type GameDatabase } from "@nepal-football-sim/database";
import { createInfrastructureProject } from "./club-economy.js";

const seasonLabel = (date: string): string => date.slice(0, 4);

const objectiveFor = (policy: ClubBoardPolicy, health: string, cash: number): ClubBoardPolicy["strategicObjective"] => {
  if (health === "INSOLVENT" || health === "DISTRESSED" || cash < 1000000) return "SURVIVE";
  return policy.strategicObjective;
};

const prioritiesFor = (policy: ClubBoardPolicy, health: string): Record<string, number> => {
  const pressure = health === "TIGHT" ? 1.2 : health === "STABLE" ? 1 : 0.82;
  return {
    squad: Number((Math.max(0.1, 1 - policy.youthPriority) * pressure).toFixed(3)),
    wages: Number((health === "DISTRESSED" ? 0.8 : 1).toFixed(3)),
    staff: Number((0.35 + policy.youthPriority * 0.35).toFixed(3)),
    infrastructure: Number((policy.infrastructurePriority * pressure).toFixed(3)),
    youth: Number((policy.youthPriority * pressure).toFixed(3)),
    commercial: Number((policy.commercialPriority * pressure).toFixed(3)),
  };
};

export const runClubAiSeasonPlanning = (db: GameDatabase, input: { date: string; seed: string }): ClubAiDecision[] => {
  if (!input.date.endsWith("-08-28")) return [];
  const economy = new ClubEconomyRepository(db);
  const market = new TransferMarketRepository(db);
  const decisions: ClubAiDecision[] = [];
  const clubs = db.prepare("SELECT id FROM clubs ORDER BY id").all() as Array<{ id: EntityId }>;
  for (const { id: clubId } of clubs) {
    const account = economy.financialAccount(clubId);
    const policy = economy.boardPolicy(clubId);
    if (!account || !policy) continue;
    const objective = objectiveFor(policy, account.financialHealth, account.cashBalance);
    const priorities = prioritiesFor(policy, account.financialHealth);
    const contracts = market.activeContractsForClub(clubId, input.date);
    const activeProjects = economy.infrastructureProjects(clubId).filter((project) => !["COMPLETED", "CANCELLED"].includes(project.status));
    const sponsorships = economy.sponsorships(clubId).filter((item) => item.status === "ACTIVE" && item.endDate >= input.date);
    const actions = [
      contracts.length < 18 ? "ASSESS_SQUAD_NEEDS" : "REVIEW_SQUAD_DEPTH",
      contracts.filter((contract) => contract.endDate <= `${Number(input.date.slice(0, 4)) + 1}-08-28`).length > 0 ? "PRIORITISE_RENEWALS" : "MONITOR_CONTRACTS",
      account.financialHealth === "DISTRESSED" || account.financialHealth === "INSOLVENT" ? "RELEASE_OR_SELL_BEFORE_SPENDING" : "KEEP_WAGE_COMMITMENTS_WITHIN_BUDGET",
      priorities.youth >= priorities.squad ? "PROTECT_YOUTH_PATHWAY" : "RECRUIT_PUBLICLY_IDENTIFIED_SQUAD_NEEDS",
      sponsorships.length === 0 ? "REVIEW_COMMERCIAL_OFFERS" : "RETAIN_COMMERCIAL_PARTNERS",
    ];
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
      context: { financialHealth: account.financialHealth, cash: account.cashBalance, squadContracts: contracts.length, activeProjects: activeProjects.length },
      status: "SIMULATION_ONLY",
    };
    economy.upsertAiDecision(decision);
    decisions.push(decision);
  }
  return decisions;
};
