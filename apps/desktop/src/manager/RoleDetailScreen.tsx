import React, { useState } from "react";
import type {
  ChairmanDashboard,
  CareerHeader,
  CareerRoleState,
  FederationPresidentDashboard,
  OwnerManagerCandidate,
} from "@nepal-football-sim/shared-types";
import type { EntityId } from "@nepal-football-sim/shared-types";
import type { AppError, DesktopRuntimeApi } from "../appBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Metrics, Panel, money, useRuntimeData } from "./ui.js";

export type ChairmanScreen = "dashboard" | "finance" | "manager" | "facilities" | "sponsorship" | "supporters" | "investors";
export type PresidentScreen = "dashboard" | "governance" | "finance" | "national-teams" | "tenure";

type Props = {
  screen: ChairmanScreen | PresidentScreen;
  header: CareerHeader;
  roles: CareerRoleState;
  bridge: DesktopRuntimeApi;
  onNavigate: (screen: ChairmanScreen | PresidentScreen) => void;
};

/*
 * Every manager screen is titled by the workspace shell, but the owner and
 * president sections arrived as a bare stack of panels with nothing naming the
 * section the sidebar had just opened.
 */
const SECTION_TITLES: Record<string, { title: string; subtitle: string }> = {
  finance: { title: "Finances", subtitle: "Balance, borrowing, and where the money went." },
  manager: { title: "Manager", subtitle: "Appoint and review the person running the team." },
  facilities: { title: "Facilities", subtitle: "Ground and infrastructure projects." },
  sponsorship: { title: "Sponsorship", subtitle: "Commercial agreements and offers." },
  supporters: { title: "Supporters", subtitle: "Attendance and supporter sentiment." },
  investors: { title: "Investors", subtitle: "Ownership stakes and equity interest." },
  governance: { title: "Governance", subtitle: "Proposals, policy, and federation decisions." },
  "national-teams": { title: "National teams", subtitle: "Squads, staff, and international programme." },
  tenure: { title: "Tenure", subtitle: "Term, mandate, and election standing." },
};

const SectionHeader = ({ screen }: { screen: string }): React.ReactElement | null => {
  const section = SECTION_TITLES[screen];
  if (!section) return null;
  return (
    <header className="page-header">
      <div>
        <h1>{section.title}</h1>
        <p className="subtle">{section.subtitle}</p>
      </div>
    </header>
  );
};

export const RoleDetailScreen = ({ screen, header, roles, bridge, onNavigate }: Props): React.ReactElement => (
  <>
    <SectionHeader screen={screen} />
    {header.activeRole === "CHAIRMAN_OWNER" ? (
      <ChairmanDetail screen={screen as ChairmanScreen} bridge={bridge} onNavigate={onNavigate} />
    ) : (
      <PresidentDetail screen={screen as PresidentScreen} bridge={bridge} onNavigate={onNavigate} />
    )}
  </>
);

const ChairmanDetail = ({ screen, bridge, onNavigate }: { screen: ChairmanScreen; bridge: DesktopRuntimeApi; onNavigate: Props["onNavigate"] }): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getChairmanDashboard());
  return <AsyncPanel state={state}>{(dashboard) => {
    if (screen === "dashboard") return <p className="subtle">Select an owner-office section from the sidebar.</p>;
    if (screen === "finance") return <ChairmanFinance dashboard={dashboard} bridge={bridge} refresh={refresh} />;
    if (screen === "manager") return <ChairmanManager dashboard={dashboard} bridge={bridge} refresh={refresh} />;
    if (screen === "facilities") return <ChairmanFacilities dashboard={dashboard} bridge={bridge} refresh={refresh} />;
    if (screen === "sponsorship") return <ChairmanSponsorship dashboard={dashboard} bridge={bridge} refresh={refresh} />;
    if (screen === "investors") return <ChairmanInvestors dashboard={dashboard} bridge={bridge} refresh={refresh} />;
    return <ChairmanSupporters dashboard={dashboard} />;
  }}</AsyncPanel>;
};

const ChairmanFinance = ({ dashboard, bridge, refresh }: { dashboard: ChairmanDashboard; bridge: DesktopRuntimeApi; refresh: () => void }): React.ReactElement => {
  const income = dashboard.finances.ledgerEntries.filter((entry) => entry.direction === "CREDIT").reduce((sum, entry) => sum + entry.amount, 0);
  const expenses = dashboard.finances.ledgerEntries.filter((entry) => entry.direction === "DEBIT").reduce((sum, entry) => sum + entry.amount, 0);
  const wages = dashboard.finances.ledgerEntries.filter((entry) => entry.category === "PLAYER_WAGES" || entry.category === "STAFF_WAGES").reduce((sum, entry) => sum + entry.amount, 0);
  const sponsorship = dashboard.finances.ledgerEntries.filter((entry) => entry.category === "SPONSORSHIP").reduce((sum, entry) => sum + entry.amount, 0);
  const projects = dashboard.finances.ledgerEntries.filter((entry) => entry.category === "FACILITY_COST").reduce((sum, entry) => sum + entry.amount, 0);
  const [principal, setPrincipal] = useState("100000");
  const [term, setTerm] = useState("12");
  const [message, setMessage] = useState<string | null>(null);
  const [busyDebt, setBusyDebt] = useState<string | null>(null);
  const [busyLoan, setBusyLoan] = useState(false);
  const applyLoan = async (): Promise<void> => { const lender = dashboard.finances.lenders[0]; if (!lender || busyLoan) return; setBusyLoan(true); const result = await bridge.applyClubLoan(lender.id, Number(principal), Number(term), "club operations"); setBusyLoan(false); setMessage(result.ok ? `Loan application ${result.data.status.toLowerCase()}.` : result.error.message); if (result.ok) refresh(); };
  const repay = async (debtId: EntityId, amount: number): Promise<void> => { setBusyDebt(debtId); const result = await bridge.repayClubLoan(debtId, amount); setBusyDebt(null); setMessage(result.ok ? "Loan repayment recorded." : result.error.message); if (result.ok) refresh(); };
  return <section className="role-detail"><Panel title="Club finance"><Metrics items={[{ label: "Balance", value: money(dashboard.finances.account.cashBalance) }, { label: "Income recorded", value: money(income) }, { label: "Expenses recorded", value: money(expenses) }, { label: "Wages", value: money(wages) }, { label: "Sponsorship", value: money(sponsorship) }, { label: "Project spending", value: money(projects) }, { label: "Debt", value: money(dashboard.finances.debts.reduce((sum, debt) => sum + debt.outstandingPrincipal, 0)) }, { label: "Financial health", value: dashboard.finances.account.financialHealth }]} /></Panel><Panel title="Club loan application"><p className="subtle">Lender identity is verified; rates and approval are simulated from club affordability.</p><div className="inline-form"><label>Principal<input type="number" min="1" value={principal} onChange={(event) => setPrincipal(event.target.value)} /></label><label>Term (months)<input type="number" min="3" value={term} onChange={(event) => setTerm(event.target.value)} /></label><button className="small" disabled={busyLoan} onClick={() => void applyLoan()}>{busyLoan ? "Applying…" : "Apply"}</button></div>{message && <p className="notice" role="status">{message}</p>}</Panel><Panel title="Debt schedule"><div className="table-scroll"><table><thead><tr><th>Lender</th><th>Outstanding</th><th>Rate</th><th>Next payment</th><th /></tr></thead><tbody>{dashboard.finances.debts.length === 0 ? <tr><td colSpan={5}>No club loans.</td></tr> : dashboard.finances.debts.map((debt) => <tr key={debt.id}><td>{dashboard.finances.lenders.find((lender) => lender.id === debt.lenderId)?.name ?? debt.lenderType}</td><td>{money(debt.outstandingPrincipal)}</td><td>{(debt.interestRate * 100).toFixed(2)}%</td><td>{debt.nextPaymentDate ?? "—"}</td><td><button className="small" disabled={busyDebt !== null} onClick={() => void repay(debt.id, debt.scheduledPayment || debt.outstandingPrincipal)}>{busyDebt === debt.id ? "Repaying…" : "Repay"}</button></td></tr>)}</tbody></table></div></Panel><Panel title="Equipment effects"><ul className="compact-list">{dashboard.equipment.length === 0 ? <li>No completed equipment assets.</li> : dashboard.equipment.map((asset) => <li key={asset.id}>{asset.id} · {Object.entries(asset.effect ?? {}).map(([key, value]) => `${key}: +${(value * 100).toFixed(1)}%`).join(", ") || "operational asset"}</li>)}</ul></Panel><Ledger entries={dashboard.finances.ledgerEntries} /></section>;
};

const ChairmanManager = ({ dashboard, bridge, refresh }: { dashboard: ChairmanDashboard; bridge: DesktopRuntimeApi; refresh: () => void }): React.ReactElement => {
  const [candidates, refreshCandidates] = useRuntimeData(() => bridge.listOwnerManagerCandidates());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const active = candidates.status === "ready" ? candidates.data.filter((candidate) => `${candidate.name} ${candidate.nationality} ${candidate.qualification}`.toLowerCase().includes(query.toLowerCase())) : [];
  const appoint = async (candidate: OwnerManagerCandidate): Promise<void> => { setBusy(candidate.managerProfileId); const result = await bridge.appointManager(candidate.vacancyId, candidate.managerProfileId); setBusy(null); if (result.ok) { setMessage(`${candidate.name} appointed.`); setError(null); refresh(); refreshCandidates(); } else setError(result.error); };
  const [busyBudget, setBusyBudget] = useState<string | null>(null);
  const decideBudget = async (requestId: EntityId, approve: boolean): Promise<void> => { if (busyBudget) return; setBusyBudget(requestId); const result = await bridge.decideManagerBudgetRequest(requestId, approve); setBusyBudget(null); setMessage(result.ok ? (approve ? "Budget request approved." : "Budget request rejected.") : result.error.message); if (result.ok) refresh(); };
  return <section className="role-detail">{error && <ErrorBanner error={error} />}{message && <p className="notice" role="status">{message}</p>}<Panel title="Manager oversight" className="panel-wide"><Metrics items={[{ label: "Current manager", value: dashboard.manager?.name ?? "Vacant" }, { label: "Contract", value: dashboard.manager?.contract.contractEnd ?? "No active contract" }]} />{dashboard.manager ? <p className="subtle">The club has an active manager contract. Search becomes available when the vacancy is open.</p> : <><label>Search candidates<input aria-label="Manager candidate search" placeholder="Name, nationality, qualification" value={query} onChange={(event) => setQuery(event.target.value)} /></label><AsyncPanel state={candidates} isEmpty={() => active.length === 0} empty="No matching available candidates.">{() => <div className="table-scroll"><table><thead><tr><th>Name</th><th>Nationality</th><th>Qualification</th><th>Reputation</th><th>Wage/year</th><th /></tr></thead><tbody>{active.map((candidate) => <tr key={candidate.managerProfileId}><td>{candidate.name}</td><td>{candidate.nationality}</td><td>{candidate.qualification}</td><td>{candidate.reputation}</td><td>{money(candidate.wageExpectation)}</td><td><button className="primary small" disabled={busy !== null} onClick={() => void appoint(candidate)}>{busy === candidate.managerProfileId ? "Appointing…" : "Appoint manager"}</button></td></tr>)}</tbody></table></div>}</AsyncPanel></>}</Panel><Panel title="Pending budget requests"><div className="table-scroll"><table><thead><tr><th>Category</th><th>Requested total</th><th>Status</th><th /></tr></thead><tbody>{dashboard.finances.budgetRequests.filter((request) => request.status === "PENDING").length === 0 ? <tr><td colSpan={4}>No pending manager requests.</td></tr> : dashboard.finances.budgetRequests.filter((request) => request.status === "PENDING").map((request) => <tr key={request.id}><td>{request.category.replaceAll("_", " ")}</td><td>{money(request.requestedAmount)}</td><td>{request.status}</td><td><span className="button-row"><button className="primary small" disabled={busyBudget !== null} onClick={() => void decideBudget(request.id, true)}>{busyBudget === request.id ? "Approving…" : "Approve"}</button><button className="ghost small" disabled={busyBudget !== null} onClick={() => void decideBudget(request.id, false)}>{busyBudget === request.id ? "Deciding…" : "Reject"}</button></span></td></tr>)}</tbody></table></div></Panel></section>;
};

const ChairmanFacilities = ({ dashboard, bridge, refresh }: { dashboard: ChairmanDashboard; bridge: DesktopRuntimeApi; refresh: () => void }): React.ReactElement => {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const approve = async (projectType: "PITCH" | "TRAINING_GROUND" | "ACADEMY"): Promise<void> => { setBusy(projectType); const result = await bridge.createInfrastructureProject(dashboard.club.id, projectType); setBusy(null); if (result.ok) { setMessage(`${projectType.replaceAll("_", " ")} project approved.`); refresh(); } else setMessage(result.error.message); };
  return <section className="role-detail"><Panel title="Ground and facilities"><div className="metrics">{dashboard.infrastructure.map((project) => <div key={project.id}><dt>{project.projectType.replaceAll("_", " ")}</dt><dd>{project.status}</dd><span className="subtle">{money(project.capitalCost)} · completes {project.expectedCompletion}</span></div>)}</div>{dashboard.infrastructure.length === 0 && <p className="empty-state">No infrastructure projects recorded.</p>}<div className="button-row">{(["PITCH", "TRAINING_GROUND", "ACADEMY"] as const).map((type) => <button key={type} className="ghost" disabled={busy !== null} onClick={() => void approve(type)}>{busy === type ? "Submitting…" : `Approve ${type.replaceAll("_", " ").toLowerCase()}`}</button>)}</div>{message && <p className="notice" role="status">{message}</p>}</Panel></section>;
};

const ChairmanSponsorship = ({ dashboard, bridge, refresh }: { dashboard: ChairmanDashboard; bridge: DesktopRuntimeApi; refresh: () => void }): React.ReactElement => {
  const [message, setMessage] = useState<string | null>(null);
  const [counterValue, setCounterValue] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (sponsorshipId: EntityId, accept: boolean): Promise<void> => {
    if (busy) return;
    setBusy(sponsorshipId);
    const result = accept ? await bridge.acceptSponsorOffer(dashboard.club.id, sponsorshipId) : await bridge.rejectSponsorOffer(dashboard.club.id, sponsorshipId);
    setBusy(null);
    setMessage(result.ok ? (accept ? "Sponsorship offer accepted." : "Sponsorship offer rejected.") : result.error.message);
    if (result.ok) refresh();
  };
  const counter = async (sponsorshipId: EntityId, annualValue: number): Promise<void> => { if (busy) return; setBusy(sponsorshipId); const result = await bridge.counterSponsorOffer(dashboard.club.id, sponsorshipId, annualValue); setBusy(null); setMessage(result.ok ? "Counter submitted; sponsor response recorded." : result.error.message); if (result.ok) refresh(); };
  return <section className="role-detail"><Panel title="Sponsorship"><Metrics items={[{ label: "Active sponsors", value: dashboard.sponsorships.filter((item) => item.status === "ACTIVE").length }, { label: "Annual value", value: money(dashboard.sponsorships.filter((item) => item.status === "ACTIVE").reduce((sum, item) => sum + item.annualValue, 0)) }]} /><div className="table-scroll"><table><thead><tr><th>Type</th><th>Value</th><th>Starts</th><th>Expires</th><th>Status</th><th /></tr></thead><tbody>{dashboard.sponsorships.map((item) => <tr key={item.id}><td>{item.type.replaceAll("_", " ")}</td><td>{money(item.annualValue, item.currency)}</td><td>{item.startDate}</td><td>{item.endDate}</td><td><Badge tone={item.status === "ACTIVE" ? "ok" : "info"}>{item.status}</Badge></td><td>{item.status === "OFFERED" && <span className="button-row"><button className="primary small" disabled={busy !== null} onClick={() => void decide(item.id, true)}>{busy === item.id ? "Accepting…" : "Accept"}</button><button className="ghost small" disabled={busy !== null} onClick={() => void decide(item.id, false)}>{busy === item.id ? "Rejecting…" : "Reject"}</button><input aria-label={`Counter value for ${item.id}`} type="number" min="1" value={counterValue[item.id] ?? item.annualValue} onChange={(event) => setCounterValue({ ...counterValue, [item.id]: event.target.value })} /><button className="ghost small" disabled={busy !== null} onClick={() => void counter(item.id, Number(counterValue[item.id] ?? item.annualValue))}>{busy === item.id ? "Countering…" : "Counter"}</button></span>}</td></tr>)}</tbody></table></div>{message && <p className="notice" role="status">{message}</p>}</Panel></section>;
};

const ChairmanInvestors = ({ dashboard, bridge, refresh }: { dashboard: ChairmanDashboard; bridge: DesktopRuntimeApi; refresh: () => void }): React.ReactElement => {
  const [percentage, setPercentage] = useState("10");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const currentStake = dashboard.club.ownershipPercentage;
  const createOffer = async (): Promise<void> => {
    const result = await bridge.createInvestorStakeOffer(Number(percentage));
    setMessage(result.ok ? "Simulation investor bids generated." : result.error.message);
    if (result.ok) refresh();
  };
  const decide = async (offerId: EntityId, amount: number, accept: boolean): Promise<void> => {
    if (accept && currentStake - (dashboard.investorMarket.bids.find((bid) => bid.offer.id === offerId)?.offer.percentage ?? 0) <= 50 && !window.confirm("This sale would end majority control. Accept the control-loss consequence?")) return;
    setBusy(offerId);
    const result = await bridge.decideInvestorBid(offerId, accept);
    setBusy(null);
    setMessage(result.ok ? (accept ? `Accepted ${money(amount)} simulation bid.` : "Investor bid rejected.") : result.error.message);
    if (result.ok) refresh();
  };
  return <section className="role-detail"><Panel title="Ownership and investors"><Metrics items={[{ label: "Current stake", value: `${currentStake}%` }, { label: "Control", value: currentStake >= 51 ? "Majority control" : "Minority stake" }, { label: "Simulated valuation", value: money(dashboard.investorMarket.valuation) }]} /><p className="subtle">All bidders and prices are simulation-only. A personal share sale pays you; club cash is unchanged.</p><div className="inline-form"><label>Offer stake (%)<input type="number" min="1" max={Math.max(1, currentStake)} value={percentage} onChange={(event) => setPercentage(event.target.value)} /></label><button className="primary small" onClick={() => void createOffer()}>Offer stake</button></div></Panel><Panel title="Current ownership"><ul className="compact-list">{dashboard.investorMarket.ownership.filter((stake) => stake.status === "ACTIVE" && (stake.percentage ?? 0) > 0).map((stake) => <li key={stake.id}>{stake.holderName} · {stake.percentage}% · {stake.role}</li>)}</ul></Panel><Panel title="Investor bids"><div className="table-scroll"><table><thead><tr><th>Investor</th><th>Type</th><th>Stake</th><th>Bid</th><th>Implied valuation</th><th>Status</th><th /></tr></thead><tbody>{dashboard.investorMarket.bids.length === 0 ? <tr><td colSpan={7}>No investor bids. Offer a stake to open a simulation process.</td></tr> : dashboard.investorMarket.bids.map((bid) => <tr key={bid.offer.id}><td>{bid.investorName} <span className="subtle">(Simulation bid)</span></td><td>{bid.investorType.replaceAll("_", " ")}</td><td>{bid.offer.percentage}%</td><td>{money(bid.offer.counterAmount ?? bid.offer.offerAmount)}</td><td>{money(bid.impliedValuation)}</td><td><Badge tone={bid.offer.status === "ACCEPTED" ? "ok" : bid.offer.status === "REJECTED" ? "bad" : "info"}>{bid.offer.status}</Badge></td><td>{["OFFER", "COUNTER"].includes(bid.offer.status) && <span className="button-row"><button className="primary small" disabled={busy !== null} onClick={() => void decide(bid.offer.id, bid.offer.counterAmount ?? bid.offer.offerAmount, true)}>{busy === bid.offer.id ? "Saving…" : "Accept"}</button><button className="ghost small" disabled={busy !== null} onClick={() => void decide(bid.offer.id, bid.offer.counterAmount ?? bid.offer.offerAmount, false)}>Reject</button></span>}</td></tr>)}</tbody></table></div>{message && <p className="notice" role="status">{message}</p>}</Panel></section>;
};

const ChairmanSupporters = ({ dashboard }: { dashboard: ChairmanDashboard }): React.ReactElement => <section className="role-detail"><Panel title="Supporters"><p className="subtle">Supporter data is provided by the club economy read model and marked simulation-only by the runtime.</p><Metrics items={[{ label: "Supporter profile", value: dashboard.club.name }, { label: "Active sponsors", value: dashboard.sponsorships.filter((item) => item.status === "ACTIVE").length }]} /><p className="empty-state">Detailed attendance history is not exposed by the current owner contract.</p></Panel></section>;

const PresidentDetail = ({ screen, bridge, onNavigate }: { screen: PresidentScreen; bridge: DesktopRuntimeApi; onNavigate: Props["onNavigate"] }): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getFederationPresidentDashboard());
  return <AsyncPanel state={state}>{(dashboard) => {
    if (screen === "dashboard") return <p className="subtle">Select a federation-office section from the sidebar.</p>;
    if (screen === "governance") return <Governance dashboard={dashboard} bridge={bridge} refresh={refresh} />;
    if (screen === "finance") return <FederationFinance dashboard={dashboard} />;
    if (screen === "national-teams") return <NationalTeams dashboard={dashboard} />;
    return <Tenure dashboard={dashboard} />;
  }}</AsyncPanel>;
};

const Governance = ({ dashboard, bridge, refresh }: { dashboard: FederationPresidentDashboard; bridge: DesktopRuntimeApi; refresh: () => void }): React.ReactElement => {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const approved = dashboard.proposals.find((item) => item.status === "APPROVED");
  const implement = async (): Promise<void> => { if (!approved) return; setBusy(true); const result = await bridge.implementFederationGovernanceProposal(approved.id); setBusy(false); setMessage(result.ok ? "Proposal implemented." : result.error.message); if (result.ok) refresh(); };
  return <section className="role-detail"><Panel title="Governance" actions={approved && <button className="primary small" disabled={busy} onClick={() => void implement()}>{busy ? "Implementing…" : "Implement approved"}</button>}><div className="table-scroll"><table><thead><tr><th>Proposal</th><th>Policy area</th><th>Status</th><th>Proposed</th></tr></thead><tbody>{dashboard.proposals.map((item) => <tr key={item.id}><td>{item.title}</td><td>{item.policyArea}</td><td><Badge tone={item.status === "APPROVED" ? "ok" : item.status === "REJECTED" ? "bad" : "info"}>{item.status}</Badge></td><td>{item.proposedAt}</td></tr>)}</tbody></table></div>{dashboard.proposals.length === 0 && <p className="empty-state">No governance proposals recorded.</p>}{message && <p className="notice" role="status">{message}</p>}</Panel><Panel title="Federation programmes"><ProjectList projects={dashboard.projects} /></Panel></section>;
};

const FederationFinance = ({ dashboard }: { dashboard: FederationPresidentDashboard }): React.ReactElement => <section className="role-detail"><Panel title="Federation finance"><Metrics items={[{ label: "Balance", value: money(dashboard.finances.account.cashBalance, dashboard.finances.account.currency) }, { label: "Revenue", value: money(dashboard.finances.account.seasonRevenue, dashboard.finances.account.currency) }, { label: "Expenses", value: money(dashboard.finances.account.seasonExpenses, dashboard.finances.account.currency) }, { label: "Profit / loss", value: money(dashboard.finances.account.seasonProfitLoss, dashboard.finances.account.currency) }, { label: "Government / grants", value: money(dashboard.finances.ledgerEntries.filter((entry) => entry.category.includes("GRANT")).reduce((sum, entry) => sum + entry.amount, 0), dashboard.finances.account.currency) }]} /></Panel><Ledger entries={dashboard.finances.ledgerEntries} /></section>;
const NationalTeams = ({ dashboard }: { dashboard: FederationPresidentDashboard }): React.ReactElement => <section className="role-detail"><Panel title="National teams"><div className="table-scroll"><table><thead><tr><th>Team</th><th>Level</th><th>Gender</th><th>Head coach</th></tr></thead><tbody>{dashboard.nationalTeams.map((team) => <tr key={team.id}><td>{team.name}</td><td>{team.level}</td><td>{team.gender}</td><td>{team.headCoach ?? "Not recorded"}</td></tr>)}</tbody></table></div></Panel></section>;
const Tenure = ({ dashboard }: { dashboard: FederationPresidentDashboard }): React.ReactElement => <section className="role-detail"><Panel title="Presidency and tenure"><Metrics items={[{ label: "Federation", value: dashboard.federation.name }, { label: "Current term", value: dashboard.tenure ? `${dashboard.tenure.termStart} – ${dashboard.tenure.termEnd ?? "current"}` : "Not recorded" }, { label: "Status", value: dashboard.tenure?.status ?? "Unknown" }, { label: "Candidacy", value: "See ANFA Presidency Path on Home" }]} /></Panel></section>;

const ProjectList = ({ projects }: { projects: FederationPresidentDashboard["projects"] }): React.ReactElement => <ul className="compact-list">{projects.length ? projects.map((project) => <li key={project.id}>{project.name} · {project.status} · {project.expectedCompletion}</li>) : <li>No federation projects recorded.</li>}</ul>;
const Ledger = ({ entries }: { entries: Array<{ id: string; date: string; description: string; direction: string; amount: number; currency: string }> }): React.ReactElement => <Panel title="Recent transactions"><ul className="compact-list">{entries.length ? entries.slice(0, 12).map((entry) => <li key={entry.id}>{entry.date} · {entry.description} · {entry.direction === "DEBIT" ? "−" : "+"}{money(entry.amount, entry.currency)}</li>) : <li>No transactions recorded.</li>}</ul></Panel>;
