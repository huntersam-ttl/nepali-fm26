import React, { useState } from "react";
import type { ChairmanDashboard, CareerHeader, CareerRoleState, FederationPresidentDashboard } from "@nepal-football-sim/shared-types";
import type { AppError, DesktopRuntimeApi } from "../appBridge.js";
import { AsyncPanel, ErrorBanner, Metrics, Panel, useRuntimeData } from "./ui.js";
import { CandidacyPanel } from "./screens/HomeScreen.js";

const money = (amount: number, currency = "NPR"): string => `${currency} ${Math.round(amount).toLocaleString()}`;
const roleName = (role: string): string => role === "CHAIRMAN_OWNER" ? "Chairman / Owner" : "Federation President";

export const RoleLandingScreen = ({ header, roles, bridge }: { header: CareerHeader; roles: CareerRoleState; bridge: DesktopRuntimeApi }): React.ReactElement => (
  header.activeRole === "CHAIRMAN_OWNER" ? <ChairmanDashboardScreen header={header} roles={roles} bridge={bridge} /> : <FederationDashboardScreen header={header} roles={roles} bridge={bridge} />
);

const RoleHeader = ({ header, roles, organisation, context }: { header: CareerHeader; roles: CareerRoleState; organisation: string; context: string }): React.ReactElement => <header className="page-header"><div><p className="eyebrow">{organisation}</p><h1>{roleName(header.activeRole)}</h1><p className="subtle">{context}</p></div><span className="role-badge">{roles.heldRoles.length} held roles</span></header>;

const ChairmanDashboardScreen = ({ header, roles, bridge }: { header: CareerHeader; roles: CareerRoleState; bridge: DesktopRuntimeApi }): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getChairmanDashboard());
  return <AsyncPanel state={state}>{(dashboard) => <ChairmanDashboardView dashboard={dashboard} header={header} roles={roles} bridge={bridge} refresh={refresh} />}</AsyncPanel>;
};

const ChairmanDashboardView = ({ dashboard, header, roles, bridge, refresh }: { dashboard: ChairmanDashboard; header: CareerHeader; roles: CareerRoleState; bridge: DesktopRuntimeApi; refresh: () => void }): React.ReactElement => {
  const budget = dashboard.finances.budgets.find((item) => item.status === "ACTIVE") ?? dashboard.finances.budgets[0];
  const [amount, setAmount] = useState(String(budget?.amount ?? ""));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const saveBudget = async (): Promise<void> => { if (!budget) return; const result = await bridge.setClubBudget(dashboard.club.id, budget.seasonLabel, budget.category, Number(amount)); if (result.ok) { setMessage("Budget updated."); setError(null); refresh(); } else setError(result.error); };
  return <section className="role-dashboard"><RoleHeader header={header} roles={roles} organisation={dashboard.club.name} context={`${dashboard.club.ownershipPercentage}% ownership · ${dashboard.club.controllingOwner ? "controlling owner" : "owner context"}`} />{error && <ErrorBanner error={error} />}{message && <p className="notice" role="status">{message}</p>}<CandidacyPanel />
    <div className="summary-grid"><Panel title="Club summary"><Metrics items={[{ label: "Club balance", value: money(dashboard.finances.account.cashBalance, dashboard.finances.account.currency) }, { label: "Budget", value: budget ? money(budget.amount, budget.currency) : "—" }, { label: "Manager", value: dashboard.manager?.name ?? "Vacant" }, { label: "Active sponsors", value: String(dashboard.sponsorships.filter((item) => item.status === "ACTIVE").length) }, { label: "Infrastructure projects", value: String(dashboard.infrastructure.filter((item) => !["COMPLETED", "CANCELLED"].includes(item.status)).length) }]} /></Panel><Panel title="Ownership"><ul className="compact-list">{dashboard.club.ownership.map((item) => <li key={item.id}>{item.holderName} · {item.percentage ?? 0}% · {item.role}</li>)}</ul></Panel></div>
    <div className="summary-grid"><Panel title="Club management"><form className="inline-form" onSubmit={(event) => { event.preventDefault(); void saveBudget(); }}><label>Current budget<input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><button className="primary" type="submit">Save budget</button></form><p className="subtle">Infrastructure: {dashboard.infrastructure.length} total · Sponsorships: {dashboard.sponsorships.length} total</p></Panel><Panel title="Manager"><p>{dashboard.manager ? `${dashboard.manager.name} · ${dashboard.manager.contract.jobTitle}` : "No active manager contract."}</p></Panel></div>
    <Panel title="Recent club transactions"><TransactionList entries={dashboard.finances.ledgerEntries} /></Panel>
  </section>;
};

const FederationDashboardScreen = ({ header, roles, bridge }: { header: CareerHeader; roles: CareerRoleState; bridge: DesktopRuntimeApi }): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getFederationPresidentDashboard());
  return <AsyncPanel state={state}>{(dashboard) => <FederationDashboardView dashboard={dashboard} header={header} roles={roles} bridge={bridge} refresh={refresh} />}</AsyncPanel>;
};

const FederationDashboardView = ({ dashboard, header, roles, bridge, refresh }: { dashboard: FederationPresidentDashboard; header: CareerHeader; roles: CareerRoleState; bridge: DesktopRuntimeApi; refresh: () => void }): React.ReactElement => {
  const [message, setMessage] = useState<string | null>(null);
  const approved = dashboard.proposals.find((item) => item.status === "APPROVED");
  const implement = async (): Promise<void> => { if (!approved) return; const result = await bridge.implementFederationGovernanceProposal(approved.id); if (result.ok) { setMessage("Governance proposal implemented."); refresh(); } else setMessage(result.error.message); };
  return <section className="role-dashboard"><RoleHeader header={header} roles={roles} organisation={dashboard.federation.name} context={`${dashboard.tenure ? `${dashboard.tenure.termStart} – ${dashboard.tenure.termEnd ?? "current"}` : "Presidential tenure not recorded"}`} />{message && <p className="notice" role="status">{message}</p>}
    <div className="summary-grid"><Panel title="Federation summary"><Metrics items={[{ label: "Federation balance", value: money(dashboard.finances.account.cashBalance, dashboard.finances.account.currency) }, { label: "Active programmes", value: String(dashboard.projects.filter((item) => !["COMPLETED", "CANCELLED"].includes(item.status)).length) }, { label: "Pending proposals", value: String(dashboard.proposals.filter((item) => ["PROPOSED", "COMMITTEE_REVIEW", "APPROVED"].includes(item.status)).length) }, { label: "National teams", value: String(dashboard.nationalTeams.length) }, { label: "Financial health", value: dashboard.finances.account.financialHealth }]} /></Panel><Panel title="Presidency"><p>{dashboard.tenure ? `Term began ${dashboard.tenure.termStart}${dashboard.tenure.termEnd ? ` · ends ${dashboard.tenure.termEnd}` : ""}` : "No active tenure dates available."}</p></Panel></div>
    <div className="summary-grid"><Panel title="Governance" actions={approved && <button className="primary small" onClick={() => void implement()}>Implement approved</button>}><ul className="compact-list">{dashboard.proposals.length ? dashboard.proposals.map((item) => <li key={item.id}>{item.title} · {item.status}</li>) : <li>No governance proposals recorded.</li>}</ul></Panel><Panel title="National teams"><ul className="compact-list">{dashboard.nationalTeams.map((team) => <li key={team.id}>{team.name} · {team.headCoach ?? "Head coach not recorded"}</li>)}</ul></Panel></div>
    <Panel title="Programmes and finance"><p>{dashboard.projects.length} federation projects · {dashboard.finances.budgets.length} budget lines</p><TransactionList entries={dashboard.finances.ledgerEntries} /></Panel>
  </section>;
};

const TransactionList = ({ entries }: { entries: Array<{ id: string; date: string; description: string; direction: string; amount: number; currency: string }> }): React.ReactElement => <ul className="compact-list">{entries.length ? entries.slice(0, 8).map((entry) => <li key={entry.id}>{entry.date} · {entry.description} · {entry.direction === "DEBIT" ? "−" : "+"}{money(entry.amount, entry.currency)}</li>) : <li>No transactions recorded.</li>}</ul>;
