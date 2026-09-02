import {
  ClubEconomyRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type ClubBudgetCategory,
  type ClubDebt,
  type ClubFinanceMeetingOverview,
  type ClubLender,
  type ClubLoanApplication,
  type EntityId,
  type ManagerBudgetRequest,
} from "@nepal-football-sim/shared-types";
import { calculateClubValuation, postClubTransaction, setClubBudget } from "./club-economy.js";
import { executiveHasAuthority } from "./executive-roles.js";

export class ClubFinanceAuthorityError extends Error {
  constructor(
    readonly code: "NOT_AUTHORIZED",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Club loan administration is a controlling-owner decision by default, the
 * same as club budgets and sponsorship — but a CEO the owner has actually
 * assigned to BUDGET_ADMINISTRATION may also act, using the same
 * executive-authority model already governing budgets/sponsorship/
 * infrastructure. This never removes the owner's own authority (majority
 * control is always authoritative); it only adds the CEO as a second
 * legitimate actor when one has genuinely been delegated the domain.
 */
const assertClubFinanceAuthority = (
  db: GameDatabase,
  clubId: EntityId,
  personId: EntityId,
  callerRole: "MANAGER" | "CHAIRMAN_OWNER" | "FEDERATION_PRESIDENT" | "CEO",
): void => {
  if (callerRole === "CHAIRMAN_OWNER") {
    const controllingStake = db
      .prepare(
        "SELECT 1 FROM club_ownership_stakes WHERE club_id=? AND holder_type='PERSON' AND holder_id=? AND status='ACTIVE' AND percentage>=51 LIMIT 1",
      )
      .get(clubId, personId);
    if (!controllingStake) {
      throw new ClubFinanceAuthorityError(
        "NOT_AUTHORIZED",
        "Only a controlling owner or an assigned CEO may administer club finance.",
      );
    }
    return;
  }
  if (callerRole === "CEO" && executiveHasAuthority(db, clubId, personId, "BUDGET_ADMINISTRATION")) {
    return;
  }
  throw new ClubFinanceAuthorityError(
    "NOT_AUTHORIZED",
    "Only a controlling owner or an assigned CEO may administer club finance.",
  );
};

const currency = "NPR";
const status = "SIMULATION_ONLY" as const;
const addMonths = (date: string, months: number): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
};

const lenders: Array<Omit<ClubLender, "id" | "countryId">> = [
  { name: "Nabil Bank Limited", institutionType: "COMMERCIAL_BANK", sourceUrl: "https://www.nabilbank.com/aboutus", status: "VERIFIED" },
  { name: "Nepal Bank Limited", institutionType: "COMMERCIAL_BANK", sourceUrl: "https://www.nrb.org.np/bfr/bfis-list-in-english-mid-january-2026/", status: "VERIFIED" },
  { name: "Agriculture Development Bank Limited", institutionType: "COMMERCIAL_BANK", sourceUrl: "https://www.nrb.org.np/bfr/bfis-list-in-english-mid-january-2026/", status: "VERIFIED" },
  { name: "Himalayan Bank Limited", institutionType: "COMMERCIAL_BANK", sourceUrl: "https://www.nrb.org.np/bfr/bfis-list-in-english-mid-january-2026/", status: "VERIFIED" },
  { name: "Muktinath Bikas Bank Limited", institutionType: "DEVELOPMENT_BANK", sourceUrl: "https://www.nrb.org.np/bfr/bfis-list-in-english-mid-january-2026/", status: "VERIFIED" },
];

const nepalCountryId = (db: GameDatabase): EntityId | undefined =>
  (db.prepare("SELECT id FROM countries WHERE iso_code IN ('NP','NPL') ORDER BY id LIMIT 1").get() as { id?: EntityId } | undefined)?.id;

export const initializeClubFinanceMarkets = (db: GameDatabase): ClubLender[] => {
  const economy = new ClubEconomyRepository(db);
  const countryId = nepalCountryId(db);
  for (const lender of lenders) {
    economy.upsertLender({ ...lender, id: createStableEntityId("club-lender", lender.name), countryId });
  }
  return economy.lenders();
};

/**
 * The exact affordability ceilings applyForClubLoan decides approval with —
 * factored out so a read-only "what could this club plausibly borrow" view
 * (the bank-meeting UI's affordability context) can never drift from the
 * real approval math instead of duplicating it.
 */
export const clubLoanCeilings = (valuation: number, existingDebt: number): { maxNewPrincipal: number; maxTotalDebt: number; headroom: number } => {
  const maxNewPrincipal = Math.max(500_000, valuation * 0.35);
  const maxTotalDebt = Math.max(750_000, valuation * 0.55);
  return { maxNewPrincipal, maxTotalDebt, headroom: Math.max(0, Math.min(maxNewPrincipal, maxTotalDebt - existingDebt)) };
};

export const applyForClubLoan = (db: GameDatabase, input: { clubId: EntityId; lenderId: EntityId; principal: number; termMonths: number; purpose: string; date: string }): ClubLoanApplication => {
  const economy = new ClubEconomyRepository(db);
  if (!economy.financialAccount(input.clubId)) throw new Error("Club finance account is unavailable");
  if (!economy.lenders().some((lender) => lender.id === input.lenderId)) throw new Error("Lender is unavailable");
  const principal = Math.round(input.principal);
  const termMonths = Math.max(3, Math.min(60, Math.round(input.termMonths)));
  if (principal <= 0) throw new Error("Loan principal must be positive");
  const valuation = calculateClubValuation(db, input.clubId, input.date).valuation;
  const existingDebt = economy.debts(input.clubId).filter((debt) => debt.status === "ACTIVE").reduce((sum, debt) => sum + debt.outstandingPrincipal, 0);
  const ceilings = clubLoanCeilings(valuation, existingDebt);
  const approved = principal <= ceilings.maxNewPrincipal && existingDebt + principal <= ceilings.maxTotalDebt;
  const application: ClubLoanApplication = {
    id: createStableEntityId("club-loan-application", `${input.clubId}:${input.lenderId}:${input.date}:${principal}`),
    clubId: input.clubId, lenderId: input.lenderId, principal, termMonths, purpose: input.purpose,
    status: approved ? "APPROVED" : "REJECTED", createdOn: input.date, decidedOn: input.date,
    reason: approved ? "Affordability and leverage checks passed." : "Requested principal exceeds the club's simulated affordability limit.", provenanceStatus: status,
  };
  economy.upsertLoanApplication(application);
  if (!approved) return application;
  const interestRate = 0.065 + ((principal + termMonths) % 25) / 1000;
  const scheduledPayment = Math.ceil((principal * (1 + interestRate * termMonths / 12)) / termMonths);
  const debt: ClubDebt = {
    id: createStableEntityId("club-debt", application.id), clubId: input.clubId, lenderType: "BANK", lenderId: input.lenderId,
    principal, outstandingPrincipal: principal, interestRate, currency, startDate: input.date,
    maturityDate: addMonths(input.date, termMonths), nextPaymentDate: addMonths(input.date, 1), scheduledPayment,
    repaymentSchedule: "MONTHLY", purpose: input.purpose, status: "ACTIVE", provenanceStatus: status,
  };
  economy.upsertDebt(debt);
  postClubTransaction(db, { clubId: input.clubId, date: input.date, category: "OTHER", direction: "CREDIT", amount: principal, description: "Club loan drawdown", relatedEntityId: debt.id, idempotencyKey: `loan-drawdown:${application.id}` });
  const account = economy.financialAccount(input.clubId);
  if (account) economy.upsertFinancialAccount({ ...account, debtBalance: account.debtBalance + principal, lastUpdatedAt: input.date });
  return application;
};

/** Role-facing adapter for club loan applications: owner or delegated CEO only. */
export const applyForClubLoanCommand = (
  db: GameDatabase,
  input: {
    clubId: EntityId;
    personId: EntityId;
    callerRole: "MANAGER" | "CHAIRMAN_OWNER" | "FEDERATION_PRESIDENT" | "CEO";
    lenderId: EntityId;
    principal: number;
    termMonths: number;
    purpose: string;
    date: string;
  },
): ClubLoanApplication => {
  assertClubFinanceAuthority(db, input.clubId, input.personId, input.callerRole);
  return applyForClubLoan(db, input);
};

export const repayClubLoan = (db: GameDatabase, input: { debtId: EntityId; date: string; amount?: number }): ClubDebt => {
  const economy = new ClubEconomyRepository(db);
  const debt = economy.debts().find((item) => item.id === input.debtId);
  if (!debt || debt.status !== "ACTIVE") throw new Error("Active club loan not found");
  const interest = Math.min(debt.outstandingPrincipal, Math.ceil(debt.outstandingPrincipal * debt.interestRate / 12));
  const payment = Math.min(debt.outstandingPrincipal + interest, Math.max(interest, Math.round(input.amount ?? debt.scheduledPayment ?? debt.outstandingPrincipal)));
  const account = economy.financialAccount(debt.clubId);
  if (!account || account.cashBalance < payment) throw new Error("Club cash cannot cover this loan payment");
  postClubTransaction(db, { clubId: debt.clubId, date: input.date, category: "LOAN_PAYMENT", direction: "DEBIT", amount: payment - interest, description: "Club loan principal repayment", relatedEntityId: debt.id, idempotencyKey: `loan-principal:${debt.id}:${input.date}` });
  if (interest > 0) postClubTransaction(db, { clubId: debt.clubId, date: input.date, category: "DEBT_INTEREST", direction: "DEBIT", amount: interest, description: "Club loan interest", relatedEntityId: debt.id, idempotencyKey: `loan-interest:${debt.id}:${input.date}` });
  const outstandingPrincipal = Math.max(0, debt.outstandingPrincipal - (payment - interest));
  const next = { ...debt, outstandingPrincipal, nextPaymentDate: outstandingPrincipal > 0 ? addMonths(input.date, 1) : undefined, status: outstandingPrincipal > 0 ? "ACTIVE" as const : "REPAID" as const };
  economy.upsertDebt(next);
  const updatedAccount = economy.financialAccount(debt.clubId);
  if (updatedAccount) economy.upsertFinancialAccount({ ...updatedAccount, debtBalance: Math.max(0, updatedAccount.debtBalance - (debt.outstandingPrincipal - outstandingPrincipal)), lastUpdatedAt: input.date });
  return next;
};

/** Role-facing adapter for club loan repayment: owner or delegated CEO only. */
export const repayClubLoanCommand = (
  db: GameDatabase,
  input: {
    debtId: EntityId;
    personId: EntityId;
    callerRole: "MANAGER" | "CHAIRMAN_OWNER" | "FEDERATION_PRESIDENT" | "CEO";
    date: string;
    amount?: number;
  },
): ClubDebt => {
  const debt = new ClubEconomyRepository(db).debts().find((item) => item.id === input.debtId);
  if (!debt) throw new Error("Active club loan not found");
  assertClubFinanceAuthority(db, debt.clubId, input.personId, input.callerRole);
  return repayClubLoan(db, input);
};

export const advanceClubLoanRepayments = (db: GameDatabase, date: string): ClubDebt[] => {
  const changed: ClubDebt[] = [];
  for (const debt of new ClubEconomyRepository(db).debts().filter((item) => item.status === "ACTIVE" && item.nextPaymentDate && item.nextPaymentDate <= date)) {
    try { changed.push(repayClubLoan(db, { debtId: debt.id, date: debt.nextPaymentDate! })); }
    catch { changed.push({ ...debt, status: "DEFAULTED" }); new ClubEconomyRepository(db).upsertDebt({ ...debt, status: "DEFAULTED" }); }
  }
  return changed;
};

/**
 * Read model behind the bank-meeting UI, shared by both the controlling
 * owner and a CEO with delegated BUDGET_ADMINISTRATION — the same two
 * actors applyForClubLoanCommand/repayClubLoanCommand already authorize.
 * The headroom figures are the club's real, current affordability ceiling
 * (see clubLoanCeilings) — never a fabricated "risk score".
 */
export const clubFinanceMeetingOverview = (
  db: GameDatabase,
  clubId: EntityId,
  date: string,
): ClubFinanceMeetingOverview => {
  const economy = new ClubEconomyRepository(db);
  const club = db.prepare("SELECT name FROM clubs WHERE id=?").get(clubId) as { name?: string } | undefined;
  const account = economy.financialAccount(clubId);
  if (!account || !club?.name) throw new Error(`Club finance is unavailable for club ${clubId}`);
  const existingDebt = economy.debts(clubId).filter((debt) => debt.status === "ACTIVE").reduce((sum, debt) => sum + debt.outstandingPrincipal, 0);
  const valuation = calculateClubValuation(db, clubId, date).valuation;
  const ceilings = clubLoanCeilings(valuation, existingDebt);
  return {
    clubId,
    clubName: club.name,
    account,
    debts: economy.debts(clubId),
    loans: economy.loanApplications(clubId),
    lenders: economy.lenders(),
    existingDebt,
    maxNewPrincipal: ceilings.maxNewPrincipal,
    maxTotalDebt: ceilings.maxTotalDebt,
    headroom: ceilings.headroom,
  };
};

export const submitManagerBudgetRequest = (db: GameDatabase, input: { clubId: EntityId; managerPersonId: EntityId; seasonLabel: string; category: ClubBudgetCategory; requestedAmount: number; date: string }): ManagerBudgetRequest => {
  if (!db.prepare("SELECT 1 FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id WHERE mc.person_id=? AND mc.status='ACTIVE' AND t.club_id=?").get(input.managerPersonId, input.clubId)) throw new Error("Manager does not control this club");
  if (!Number.isFinite(input.requestedAmount) || input.requestedAmount < 0) throw new Error("Requested budget must be non-negative");
  const request: ManagerBudgetRequest = { id: createStableEntityId("manager-budget-request", `${input.clubId}:${input.managerPersonId}:${input.seasonLabel}:${input.category}:${input.date}`), clubId: input.clubId, managerPersonId: input.managerPersonId, seasonLabel: input.seasonLabel, category: input.category, requestedAmount: Math.round(input.requestedAmount), status: "PENDING", createdOn: input.date, provenanceStatus: status };
  new ClubEconomyRepository(db).upsertBudgetRequest(request);
  return request;
};

export const decideManagerBudgetRequest = (db: GameDatabase, input: { requestId: EntityId; date: string; approve: boolean }): ManagerBudgetRequest => {
  const economy = new ClubEconomyRepository(db);
  const request = economy.budgetRequests().find((item) => item.id === input.requestId);
  if (!request || request.status !== "PENDING") throw new Error("Budget request is unavailable");
  const current = economy.budgets(request.clubId).find((item) => item.seasonLabel === request.seasonLabel && item.category === request.category);
  const approved = input.approve && request.requestedAmount >= (current?.amount ?? 0);
  const next = { ...request, status: approved ? "APPROVED" as const : "REJECTED" as const, decidedOn: input.date, decisionNote: approved ? "Owner approved the requested allocation." : "Owner rejected the requested allocation." };
  economy.upsertBudgetRequest(next);
  if (approved) setClubBudget(db, { clubId: request.clubId, seasonLabel: request.seasonLabel, category: request.category, amount: request.requestedAmount });
  return next;
};
