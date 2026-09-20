import type { TransferCentre } from "@nepal-football-sim/shared-types";

export type LoanEntry = TransferCentre["loans"][number];

/** Truthful split of active loans into out (our players elsewhere) and in
 * (others at our club), each ordered by end date (canonical dates only). */
export const splitLoans = (loans: LoanEntry[]): { out: LoanEntry[]; in: LoanEntry[] } => {
  const byEnd = (a: LoanEntry, b: LoanEntry) => a.endDate.localeCompare(b.endDate);
  return {
    out: loans.filter((loan) => loan.direction === "OUT").sort(byEnd),
    in: loans.filter((loan) => loan.direction === "IN").sort(byEnd),
  };
};

export const loanSummary = (loans: LoanEntry[]): { outCount: number; inCount: number } => {
  const { out, in: inside } = splitLoans(loans);
  return { outCount: out.length, inCount: inside.length };
};