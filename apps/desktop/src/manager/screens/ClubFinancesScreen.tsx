import React, { useState } from "react";
import type { ClubBudgetCategory, TransferBudgetView } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Metrics, Panel, money, useRuntimeData } from "../ui.js";

/**
 * Phase 6B — Club Finances (Manager football-department view).
 *
 * The Manager's canonical, role-appropriate finance surface. It reads exactly
 * the same `TransferBudgetView` that backs Recruitment / Transfers (the board's
 * allocation to the football department, NOT the club's institutional cash) and
 * lets the Manager REQUEST an increase — never edit the allocation directly.
 *
 * Institutional values (club cash balance, income/expense breakdown, debt,
 * financial health, ledger) are Owner-facing and live in the Owner's own
 * Finances workspace. They deliberately stay out of this Manager view: a
 * Manager has no canonical permission to see the Owner's private economic state.
 */

const BUDGET_CATEGORY_LABEL: Record<string, string> = {
  TRANSFER_BUDGET: "Transfer budget",
  WAGE_BUDGET: "Wage budget",
  STAFF_BUDGET: "Staff budget",
};

/** Whether the allocation has at least one live (non-zero) budget row. */
export const hasAllocation = (budget: TransferBudgetView | undefined): boolean =>
  Boolean(budget && (budget.transferBudget > 0 || budget.wageBudget > 0));

const budgetTone = (allocated: number, remaining: number): "ok" | "warn" | "bad" | "info" =>
  allocated <= 0 ? "info" : remaining === 0 ? "bad" : remaining <= allocated * 0.2 ? "warn" : "ok";

const transferStatus = (allocated: number, remaining: number): string =>
  allocated <= 0
    ? "no allocation"
    : remaining === 0
      ? "exhausted"
      : remaining <= allocated * 0.2
        ? "low"
        : "healthy";

const wageStatus = (allocated: number, remaining: number): string =>
  allocated <= 0
    ? "no allocation"
    : remaining === 0
      ? "fully committed"
      : remaining <= allocated * 0.2
        ? "tight"
        : "healthy";

export const ClubFinancesScreen = (): React.ReactElement => {
  const [centre, refresh] = useRuntimeData(() => managerBridge.getTransferCentre(), []);
  const [requestCategory, setRequestCategory] = useState<ClubBudgetCategory>("TRANSFER_BUDGET");
  const [requestAmount, setRequestAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submitRequest = async (seasonLabel: string): Promise<void> => {
    setBusy(true);
    setMessage(null);
    const result = await managerBridge.requestManagerBudget(
      seasonLabel,
      requestCategory,
      Number(requestAmount),
    );
    setBusy(false);
    if (!result.ok) {
      setMessage(`Request failed: ${result.error?.message ?? "unknown error"}`);
      return;
    }
    setRequestAmount("");
    setMessage("Budget increase requested — the board will decide.");
    await refresh();
  };

  return (
    <AsyncPanel state={centre}>
      {(view) => {
        const budget = view.budget;
        const hasBudgets = hasAllocation(budget);
        return (
          <>
            <Panel title="Football department budget" className="panel-wide">
              {hasBudgets ? (
                <Metrics
                  items={[
                    {
                      label: "Transfer allocation",
                      value: `${money(budget.transferBudget, budget.currency)} · ${money(budget.transferRemaining, budget.currency)} remaining`,
                    },
                    {
                      label: "Wage allocation",
                      value: `${money(budget.wageBudget, budget.currency)} · ${money(budget.wageRemaining, budget.currency)} remaining`,
                    },
                  ]}
                />
              ) : (
                <p className="empty-state">No transfer or wage allocation is currently set for this department.</p>
              )}
              <p className="subtle">
                These are the board&rsquo;s allocations to the football department for {budget.seasonLabel}, not the
                club&rsquo;s overall cash balance. <Badge tone="info">simulated allocation</Badge>
              </p>
            </Panel>
<Panel title="Commitments" className="panel-wide">
              {hasBudgets ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Allocated</th>
                        <th>Spent / committed</th>
                        <th>Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Transfers</td>
                        <td>{money(budget.transferBudget, budget.currency)}</td>
                        <td>{money(budget.transferSpent, budget.currency)}</td>
                        <td>
                          {money(budget.transferRemaining, budget.currency)}{" "}
                          <Badge tone={budgetTone(budget.transferBudget, budget.transferRemaining)}>
                            {transferStatus(budget.transferBudget, budget.transferRemaining)}
                          </Badge>
                        </td>
                      </tr>
                      <tr>
                        <td>Wages</td>
                        <td>{money(budget.wageBudget, budget.currency)}</td>
                        <td>{money(budget.committedWages, budget.currency)}</td>
                        <td>
                          {money(budget.wageRemaining, budget.currency)}{" "}
                          <Badge tone={budgetTone(budget.wageBudget, budget.wageRemaining)}>
                            {wageStatus(budget.wageBudget, budget.wageRemaining)}
                          </Badge>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty-state">No live commitments to show.</p>
              )}
            </Panel>

            <Panel title="Request an increase">
              <p className="subtle">
                The Manager does not set budgets directly — that is institutional authority. You can request a
                higher allocation for the board to approve.
              </p>
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitRequest(budget.seasonLabel);
                }}
              >
                <label>
                  Category
                  <select
                    value={requestCategory}
                    onChange={(event) => setRequestCategory(event.target.value as ClubBudgetCategory)}
                  >
                    <option value="TRANSFER_BUDGET">Transfer budget</option>
                    <option value="WAGE_BUDGET">Wage budget</option>
                    <option value="STAFF_BUDGET">Staff budget</option>
                  </select>
                </label>
                <label>
                  New total
                  <input
                    type="number"
                    min="0"
                    aria-label="Requested new budget total"
                    value={requestAmount}
                    onChange={(event) => setRequestAmount(event.target.value)}
                  />
                </label>
                <button className="primary small" disabled={busy || !requestAmount || Number(requestAmount) <= 0}>
                  Request {BUDGET_CATEGORY_LABEL[requestCategory] ?? "increase"}
                </button>
              </form>
              {message && <p className="notice" role="status">{message}</p>}
            </Panel>

            <Panel title="Financial health">
              <p className="subtle">
                Institutional financial health (club cash, income/expenses, debt and the financial status) is
                Owner-facing and not part of the Manager&rsquo;s authority. This page shows only what the football
                department may see.
              </p>
            </Panel>
          </>
        );
      }}
    </AsyncPanel>
  );
};