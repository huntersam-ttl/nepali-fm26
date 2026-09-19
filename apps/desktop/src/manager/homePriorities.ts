import type { ManagerDashboard } from "@nepal-football-sim/shared-types";

/**
 * Phase 2B — Home role adapters (pure, deterministic).
 *
 * One shared Home shell is driven by these adapters: each returns an ordered
 * priority list derived ONLY from real state, never from invented content. The
 * live Manager Home consumes `managerHomePriorities`; the Owner/President
 * adapters model the same pattern over their institutional reads (their live
 * dashboards already exist and are not duplicated here).
 */

export type HomePriority =
  | "NEXT_MATCH"
  | "DECISION"
  | "SQUAD_READINESS"
  | "UPCOMING"
  | "COMPETITION"
  | "INJURIES"
  | "FINANCE"
  | "PROJECT"
  | "MANAGER_OVERSIGHT"
  | "SUPPORTERS"
  | "GOVERNANCE"
  | "NATIONAL_TEAMS"
  | "UNEMPLOYED";

/** A real, present "next match" wins the Manager hero; otherwise the most
 * actionable decision; otherwise nothing is fabricated — we fall back to an
 * honest secondary priority (or unemployed). */
export const managerPrimaryPriority = (dashboard: ManagerDashboard): HomePriority => {
  if (dashboard.employmentStatus === "UNEMPLOYED") return "UNEMPLOYED";
  if (dashboard.nextFixture) return "NEXT_MATCH";
  if (dashboard.inbox.length > 0) return "DECISION";
  if (dashboard.squadAvailability.total > 0) return "SQUAD_READINESS";
  return "UPCOMING";
};

export const managerHomePriorities = (dashboard: ManagerDashboard): HomePriority[] => {
  const priorities: HomePriority[] = [];
  if (dashboard.employmentStatus === "UNEMPLOYED") return ["UNEMPLOYED"];
  if (dashboard.nextFixture) priorities.push("NEXT_MATCH");
  if (dashboard.inbox.length > 0) priorities.push("DECISION");
  if (dashboard.squadAvailability.total > 0) priorities.push("SQUAD_READINESS");
  if (dashboard.squadAvailability.injured + dashboard.squadAvailability.suspended > 0) priorities.push("INJURIES");
  if (dashboard.recentResults.length > 0) priorities.push("COMPETITION");
  if (priorities.length === 0) priorities.push("UPCOMING");
  return priorities;
};

/** Owner/Chairman institutional reads (presentation-side view). */
export type OwnerHomeView = {
  hasDecision?: boolean;
  hasActiveProject?: boolean;
  hasFixtures?: boolean;
  hasFinanceContext?: boolean;
  hasSupporterContext?: boolean;
};

export const ownerHomePriorities = (view: OwnerHomeView): HomePriority[] => {
  const priorities: HomePriority[] = [];
  if (view.hasDecision) priorities.push("DECISION");
  if (view.hasActiveProject) priorities.push("PROJECT");
  if (view.hasFinanceContext) priorities.push("FINANCE");
  if (view.hasSupporterContext) priorities.push("SUPPORTERS");
  if (view.hasFixtures) priorities.push("NEXT_MATCH");
  if (priorities.length === 0) priorities.push("UPCOMING");
  return priorities;
};

/** President federation/governance reads (presentation-side view). */
export type PresidentHomeView = {
  hasGovDecision?: boolean;
  hasActiveProject?: boolean;
  hasFinanceContext?: boolean;
  hasNationalTeams?: boolean;
  hasCompetition?: boolean;
};

export const presidentHomePriorities = (view: PresidentHomeView): HomePriority[] => {
  const priorities: HomePriority[] = [];
  if (view.hasGovDecision) priorities.push("GOVERNANCE");
  if (view.hasActiveProject) priorities.push("PROJECT");
  if (view.hasFinanceContext) priorities.push("FINANCE");
  if (view.hasNationalTeams) priorities.push("NATIONAL_TEAMS");
  if (view.hasCompetition) priorities.push("COMPETITION");
  if (priorities.length === 0) priorities.push("UPCOMING");
  return priorities;
};

/** Deterministic, bounded inbox attention items (never the whole inbox). */
export const attentionLimit = (length: number, limit = 6): number => Math.max(0, Math.min(limit, length));