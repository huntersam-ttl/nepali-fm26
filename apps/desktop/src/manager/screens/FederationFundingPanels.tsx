import React, { useState } from "react";
import type {
  FederationBudget,
  FederationFinancialAccount,
  FederationGrantView,
  FederationPresidentDashboard,
} from "@nepal-football-sim/shared-types";
import type { DesktopRuntimeApi } from "../../appBridge.js";
import { humanizeToken } from "../storyHumanizer.js";
import { AsyncPanel, Badge, Metrics, Panel, money, useRuntimeData } from "../ui.js";

/**
 * Phase 9B — Federation funding panels, shown on the existing Finance screen.
 *
 * Everything is the canonical account, budget and grant state. Restricted funds
 * are a portion of the cash balance that is tied to specific purposes, so the
 * remainder is what is not restricted. There is no health score or forecast.
 * Budgets are season allocation targets: setting one moves no money, and it can
 * never be set below what has already been used. The backend enforces that and
 * the President-only authority; the form here only makes it convenient.
 */

export type FundingTarget = "national-development" | "federation-projects" | "government-relations";

export const notRestrictedFunds = (account: Pick<FederationFinancialAccount, "cashBalance" | "restrictedFunds">): number =>
  account.cashBalance - account.restrictedFunds;

export const budgetRemaining = (budget: Pick<FederationBudget, "amount" | "usedAmount">): number =>
  budget.amount - budget.usedAmount;

/** The most recent season's budgets, by category label. */
export const currentBudgets = (budgets: FederationBudget[]): { season?: string; rows: FederationBudget[] } => {
  if (budgets.length === 0) return { rows: [] };
  const season = [...budgets].map((budget) => budget.seasonLabel).sort().at(-1)!;
  const rows = budgets
    .filter((budget) => budget.seasonLabel === season)
    .sort((a, b) => humanizeToken(a.category).localeCompare(humanizeToken(b.category)) || a.id.localeCompare(b.id));
  return { season, rows };
};

/** A whole number of zero or more; anything else is undefined. */
export const parseBudgetInput = (text: string): number | undefined => {
  const trimmed = text.trim();
  return /^\d{1,15}$/.test(trimmed) ? Number(trimmed) : undefined;
};

export const grantStatusTone = (status: string): "ok" | "warn" | "bad" | "info" =>
  status === "ACTIVE" || status === "APPROVED" || status === "COMPLETED"
    ? "ok"
    : status === "REJECTED" || status === "CANCELLED" || status === "FROZEN" || status === "SUSPENDED" || status === "RECOVERY_REQUIRED"
      ? "bad"
      : status === "DELAYED" || status === "REPORTING_DUE"
        ? "warn"
        : "info";

export const sortedGrants = (grants: FederationGrantView[]): FederationGrantView[] =>
  [...grants].sort((a, b) => b.fundingPeriodStart.localeCompare(a.fundingPeriodStart) || a.id.localeCompare(b.id));

export const FederationFundingPanels = ({
  dashboard,
  bridge,
  refresh,
  onNavigate,
  notice,
  onNotice,
}: {
  dashboard: Pick<FederationPresidentDashboard, "finances">;
  bridge: Pick<DesktopRuntimeApi, "getFederationGrants" | "setFederationBudget">;
  refresh: () => void;
  onNavigate: (target: FundingTarget) => void;
  /** A confirmation kept by a parent that outlives the post-save refresh. */
  notice?: string | null;
  onNotice?: (text: string) => void;
}): React.ReactElement => {
  const { account } = dashboard.finances;
  const { season, rows } = currentBudgets(dashboard.finances.budgets);
  const [grants] = useRuntimeData(
    () => (bridge.getFederationGrants ? bridge.getFederationGrants() : Promise.resolve({ ok: true as const, data: [] as FederationGrantView[] })),
    [],
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const save = async (budget: FederationBudget): Promise<void> => {
    const amount = parseBudgetInput(draft);
    const label = humanizeToken(budget.category);
    if (amount === undefined) {
      setMessage({ tone: "bad", text: "Enter a whole number of zero or more." });
      return;
    }
    if (!bridge.setFederationBudget) return;
    setBusy(true);
    setMessage(null);
    const result = await bridge.setFederationBudget(budget.category, amount);
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "bad", text: result.error.message });
      return;
    }
    const confirmation = `${label} budget set to ${money(result.data.amount, result.data.currency)}.`;
    if (onNotice) onNotice(confirmation);
    else setMessage({ tone: "ok", text: confirmation });
    setEditing(null);
    refresh();
  };

  return (
    <>
      <Panel title="Funds and commitments" className="panel-wide">
        <Metrics
          items={[
            { label: "Cash balance", value: money(account.cashBalance, account.currency) },
            { label: "Restricted funds", value: money(account.restrictedFunds, account.currency) },
            { label: "Not restricted", value: money(notRestrictedFunds(account), account.currency) },
            { label: "Receivables", value: money(account.receivables, account.currency) },
            { label: "Payables", value: money(account.payables, account.currency) },
            { label: "Debt", value: money(account.debt, account.currency) },
            { label: "Financial standing", value: humanizeToken(account.financialHealth) },
          ]}
        />
        <p className="subtle">
          <Badge tone="info">simulated</Badge> Restricted funds are included in the cash balance and are tied to
          specific purposes.
        </p>
      </Panel>

      <Panel title={season ? `Season budgets · ${season}` : "Season budgets"} className="panel-wide">
        {message ? (
          <p className={message.tone === "bad" ? "warning" : "subtle"} role={message.tone === "bad" ? "alert" : "status"}>
            {message.text}
          </p>
        ) : notice ? (
          <p className="subtle" role="status">
            {notice}
          </p>
        ) : null}
        {rows.length === 0 ? (
          <p className="empty-state">No season budgets are on record.</p>
        ) : (
          <div className="table-scroll" role="region" aria-label="Season budgets" tabIndex={0}>
            <table>
              <caption className="visually-hidden">Federation season budgets by category</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Allocated</th>
                  <th scope="col">Used</th>
                  <th scope="col">Remaining</th>
                  <th scope="col">Status</th>
                  {bridge.setFederationBudget && <th scope="col">Change</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((budget) => {
                  const label = humanizeToken(budget.category);
                  const open = editing === budget.id;
                  return (
                    <tr key={budget.id}>
                      <th scope="row">{label}</th>
                      <td>{money(budget.amount, budget.currency)}</td>
                      <td>{money(budget.usedAmount, budget.currency)}</td>
                      <td>{money(budgetRemaining(budget), budget.currency)}</td>
                      <td>
                        <Badge tone={budget.status === "ACTIVE" ? "ok" : "info"}>{humanizeToken(budget.status)}</Badge>
                      </td>
                      {bridge.setFederationBudget && (
                        <td>
                          {budget.status !== "ACTIVE" ? (
                            <span className="subtle">—</span>
                          ) : open ? (
                            <div className="button-row">
                              <label>
                                <span className="visually-hidden">New budget for {label}</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={draft}
                                  onChange={(event) => setDraft(event.target.value)}
                                  disabled={busy}
                                />
                              </label>
                              <button className="primary small" disabled={busy} onClick={() => void save(budget)}>
                                {busy ? "Saving…" : `Set ${label} budget`}
                              </button>
                              <button className="ghost small" disabled={busy} onClick={() => setEditing(null)}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              className="ghost small"
                              aria-label={`Change ${label} budget`}
                              onClick={() => {
                                setEditing(budget.id);
                                setDraft(String(budget.amount));
                                setMessage(null);
                              }}
                            >
                              Change
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="subtle">
          Budgets are this season&rsquo;s allocation targets. Changing one moves no money, and it cannot be set below
          the amount already used.
        </p>
      </Panel>

      <Panel title="Grants and external funding" className="panel-wide">
        <AsyncPanel state={grants} isEmpty={(list) => list.length === 0} empty="No grants are on record for the federation.">
          {(list: FederationGrantView[]) => (
            <div className="table-scroll" role="region" aria-label="Federation grants" tabIndex={0}>
              <table>
                <caption className="visually-hidden">Federation grants</caption>
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Purpose</th>
                    <th scope="col">Restriction</th>
                    <th scope="col">Status</th>
                    <th scope="col">Period</th>
                    <th scope="col">Approved</th>
                    <th scope="col">Received</th>
                    <th scope="col">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedGrants(list).map((grant) => (
                    <tr key={grant.id}>
                      <th scope="row">{humanizeToken(grant.sourceInstitution)}</th>
                      <td>{grant.purpose}</td>
                      <td>{humanizeToken(grant.restrictionType)}</td>
                      <td>
                        <Badge tone={grantStatusTone(grant.status)}>{humanizeToken(grant.status)}</Badge>
                      </td>
                      <td>
                        {grant.fundingPeriodStart} – {grant.fundingPeriodEnd}
                      </td>
                      <td>{money(grant.approvedAmount, grant.currency)}</td>
                      <td>{money(grant.receivedAmount, grant.currency)}</td>
                      <td>{money(grant.remainingAmount, grant.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AsyncPanel>
      </Panel>

      <Panel title="Where funding shows up" className="panel-wide">
        <ul className="report-list">
          <li>
            Programme detail and outcomes{" "}
            <button className="ghost small" onClick={() => onNavigate("national-development")}>
              National Development
            </button>
          </li>
          <li>
            Capital programmes and their funding status{" "}
            <button className="ghost small" onClick={() => onNavigate("federation-projects")}>
              Federation Projects
            </button>
          </li>
          <li>
            Government funding requests{" "}
            <button className="ghost small" onClick={() => onNavigate("government-relations")}>
              Government
            </button>
          </li>
        </ul>
      </Panel>
    </>
  );
};
