import { isHomeFederation } from "./home-context.js";
import { FederationGovernanceRepository, type GameDatabase } from "@nepal-football-sim/database";
import type {
  EntityId,
  FederationBudget,
  FederationBudgetCategory,
} from "@nepal-football-sim/shared-types";
import { setFederationBudget } from "./federation-governance.js";

export const FEDERATION_BUDGET_CATEGORIES: readonly FederationBudgetCategory[] = [
  "NATIONAL_TEAMS",
  "YOUTH_DEVELOPMENT",
  "GRASSROOTS",
  "COACH_EDUCATION",
  "REFEREE_DEVELOPMENT",
  "COMPETITIONS",
  "INFRASTRUCTURE",
  "CLUB_SUPPORT",
  "COMMERCIAL",
  "ADMINISTRATION",
  "WOMENS_FOOTBALL",
];

export class FederationBudgetError extends Error {}

/**
 * The President's FEDERATION_BUDGETS authority: set this season's allocation for
 * one budget category. The amount already used is preserved, an allocation can
 * never be set below it, and an unchanged amount is rejected rather than
 * silently accepted. Budgets are allocation targets, not cash reserves, so this
 * neither moves money nor posts to the ledger. Like proposals, it requires the
 * ACTIVE (not interim) President of a domestic federation.
 */
export const setFederationBudgetCommand = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    personId: EntityId;
    callerRole: "MANAGER" | "CHAIRMAN_OWNER" | "FEDERATION_PRESIDENT";
    date: string;
    category: FederationBudgetCategory;
    amount: number;
  },
): FederationBudget => {
  if (input.callerRole !== "FEDERATION_PRESIDENT")
    throw new FederationBudgetError("Only the federation president may set a federation budget");
  if (!isHomeFederation(db, input.federationId))
    throw new FederationBudgetError("Budget commands are unavailable for context-only federations");

  const repo = new FederationGovernanceRepository(db);
  const active = repo
    .leadershipTenures(input.federationId)
    .some(
      (tenure) =>
        tenure.personId === input.personId &&
        tenure.role === "FEDERATION_PRESIDENT" &&
        tenure.status === "ACTIVE",
    );
  if (!active)
    throw new FederationBudgetError("Only the active president of this federation may set a budget");

  if (!FEDERATION_BUDGET_CATEGORIES.includes(input.category))
    throw new FederationBudgetError("That is not a federation budget category");
  if (!Number.isSafeInteger(input.amount) || input.amount < 0)
    throw new FederationBudgetError("A budget must be a whole number of zero or more");

  const season = input.date.slice(0, 4);
  const current = repo
    .budgets(input.federationId)
    .find((budget) => budget.seasonLabel === season && budget.category === input.category);
  if (!current || current.status !== "ACTIVE")
    throw new FederationBudgetError("There is no active budget for that category this season");
  if (input.amount < current.usedAmount)
    throw new FederationBudgetError("A budget cannot be set below the amount already used");
  if (input.amount === current.amount)
    throw new FederationBudgetError("That budget is already set to this amount");

  return setFederationBudget(db, {
    federationId: input.federationId,
    seasonLabel: season,
    category: input.category,
    amount: input.amount,
  });
};
