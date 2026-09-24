/** Reforms approved by the federation that no one has implemented yet. */
export const reformsAwaitingImplementation = (reforms: Array<{ status: string }>): number =>
  reforms.filter((reform) => reform.status === "APPROVED").length;

/** Licence cases that need a decision or remediation: everything not passed or resolved. */
export const licenceCasesNeedingAttention = (cases: Array<{ status: string }>): number =>
  cases.filter((item) => item.status === "FAILED" || item.status === "CONDITIONAL").length;
