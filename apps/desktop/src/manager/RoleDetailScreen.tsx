import React, { useState } from "react";
import type {
  ChairmanDashboard,
  CareerHeader,
  CareerRoleState,
  ClubDebt,
  ClubFinanceMeetingOverview,
  ClubLoanApplication,
  FederationDevelopmentBand,
  FederationDevelopmentSummary,
  FederationPresidentDashboard,
  GovernmentFundingApplication,
  GovernmentFundingType,
  GovernmentOverview,
  GovernmentPriorityBand,
  GovernmentRelationshipBand,
  InvestorMeetingOverview,
  OwnershipInvestorBidView,
  OwnerManagerCandidate,
  SponsorMeetingOverview,
  SponsorMeetingContract,
  FederationCommercialOverview,
  OwnerManagerMeetingOverview,
  OwnerManagerMeetingTopic,
  OwnerManagerMeetingStance,
  OwnerManagerCommitmentType,
  UniversalInteraction,
  OwnerMatchdayView,
  LiveMatchView,
} from "@nepal-football-sim/shared-types";
import type { EntityId } from "@nepal-football-sim/shared-types";
import type { AppError, DesktopRuntimeApi } from "../appBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Metrics, Panel, money, useRuntimeData } from "./ui.js";
import { MeetingBrief, MeetingOptions, MeetingOutcome, MeetingParticipants, MeetingShell, type MeetingOption, type MeetingTone } from "./meetings.js";

export type ChairmanScreen = "dashboard" | "finance" | "manager" | "facilities" | "sponsorship" | "supporters" | "investors" | "bank" | "meeting" | "matchday";
export type PresidentScreen = "dashboard" | "governance" | "finance" | "national-teams" | "national-development" | "government-relations" | "tenure";

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
  bank: { title: "Bank", subtitle: "Loan requests, approvals, and the club's repayment schedule." },
  meeting: { title: "Talk to Manager", subtitle: "Board confidence, form, budgets, and commitments." },
  matchday: { title: "Matchday", subtitle: "Fixtures, results, and league position — no tactical control." },
  investors: { title: "Investors", subtitle: "Ownership stakes and equity interest." },
  governance: { title: "Governance", subtitle: "Proposals, policy, and federation decisions." },
  "national-teams": { title: "National teams", subtitle: "Squads, staff, and international programme." },
  "national-development": {
    title: "National development",
    subtitle: "Grassroots, pathway, and federation-wide development outcomes.",
  },
  "government-relations": {
    title: "Government relations",
    subtitle: "Institution relationships and land, ground, and infrastructure funding requests.",
  },
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
    if (screen === "sponsorship") return <SponsorMeeting bridge={bridge} role="CHAIRMAN_OWNER" clubId={dashboard.club.id} />;
    if (screen === "investors") return <InvestorMeeting bridge={bridge} />;
    if (screen === "bank") return <BankMeeting bridge={bridge} role="CHAIRMAN_OWNER" clubId={dashboard.club.id} />;
    if (screen === "meeting") return <OwnerManagerMeeting bridge={bridge} clubId={dashboard.club.id} />;
    if (screen === "matchday") return <OwnerMatchday bridge={bridge} />;
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

// Every sponsorship type this can honestly show maps onto the real
// SponsorshipType enum — there is no separate airline/bank/telecom/beverage/
// equipment/community sponsorship category in the club commercial model
// yet, so those are not offered as selectable properties here (see
// CODEX_UI_BRIDGE_NEEDED in the task report).
const SPONSORSHIP_TYPE_LABELS: Record<string, string> = {
  SHIRT_MAIN: "shirt front",
  SHIRT_SECONDARY: "shirt secondary panel",
  SLEEVE: "sleeve",
  TRAINING_KIT: "training kit",
  STADIUM: "stadium",
  ACADEMY: "academy / youth programme",
  OFFICIAL_PARTNER: "official partner",
  LOCAL_PARTNER: "local partner",
};

const budgetTierPhrase = (tier: SponsorMeetingContract["sponsorBudgetTier"]): string =>
  tier === "PREMIUM" ? "a premium national" : tier === "NATIONAL" ? "a national" : tier === "REGIONAL" ? "a regional" : "a local";

const sponsorStatusTone = (statusValue: SponsorMeetingContract["status"]): MeetingTone =>
  statusValue === "ACTIVE" ? "ok" : statusValue === "REJECTED" || statusValue === "EXPIRED" ? "bad" : "info";

/**
 * Contextual briefing built only from fields the offer/sponsor record
 * genuinely carries (industry, budget tier, property type, exclusivity,
 * bonuses, expectations) — never a fabricated claim about the real company
 * behind a VERIFIED identity like Nepal Telecom or Chaudhary Group.
 */
const sponsorNarrative = (contract: SponsorMeetingContract): string => {
  const property = SPONSORSHIP_TYPE_LABELS[contract.type] ?? contract.type.replaceAll("_", " ").toLowerCase();
  const tier = budgetTierPhrase(contract.sponsorBudgetTier);
  const exclusivity = contract.exclusivityGroup
    ? ` They are seeking sector exclusivity in ${contract.exclusivityGroup.replaceAll("_", " ").toLowerCase()}.`
    : "";
  const bonusKeys = Object.keys(contract.bonuses ?? {});
  const bonusText = bonusKeys.length > 0 ? ` They have offered performance bonuses tied to ${bonusKeys.join(" and ")}.` : "";
  const appearances = contract.expectations?.appearances;
  const expectationText = appearances ? ` They expect at least ${appearances} matchday appearances for the branding.` : "";
  return `${contract.sponsorName}, ${tier} ${contract.sponsorIndustry.toLowerCase()} organisation, has proposed a ${property} partnership.${exclusivity}${bonusText}${expectationText}`;
};

export const SponsorMeeting = ({
  bridge,
  role,
  clubId,
}: {
  bridge: DesktopRuntimeApi;
  role: "CHAIRMAN_OWNER" | "CEO";
  clubId?: EntityId;
}): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getSponsorMeeting(clubId), [clubId]);
  return (
    <AsyncPanel state={state}>
      {(overview) => <SponsorMeetingView overview={overview} bridge={bridge} role={role} refresh={refresh} />}
    </AsyncPanel>
  );
};

const SponsorMeetingView = ({
  overview,
  bridge,
  role,
  refresh,
}: {
  overview: SponsorMeetingOverview;
  bridge: DesktopRuntimeApi;
  role: "CHAIRMAN_OWNER" | "CEO";
  refresh: () => void;
}): React.ReactElement => {
  const [selectedId, setSelectedId] = useState<EntityId | undefined>(overview.offers[0]?.id);
  const selected = overview.offers.find((item) => item.id === selectedId) ?? overview.offers[0];
  const [counterValue, setCounterValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const decide = async (accept: boolean): Promise<void> => {
    if (!selected) return;
    setBusyId(accept ? "accept" : "reject");
    setMessage(null);
    const result =
      role === "CEO"
        ? accept
          ? await bridge.acceptExecutiveSponsorOffer(overview.clubId, selected.id)
          : await bridge.rejectExecutiveSponsorOffer(overview.clubId, selected.id)
        : accept
          ? await bridge.acceptSponsorOffer(overview.clubId, selected.id)
          : await bridge.rejectSponsorOffer(overview.clubId, selected.id);
    setBusyId(null);
    setMessage(
      result.ok
        ? accept
          ? `${selected.sponsorName}'s offer accepted.`
          : `${selected.sponsorName}'s offer rejected.`
        : result.error.message,
    );
    if (result.ok) refresh();
  };

  const counter = async (): Promise<void> => {
    if (!selected) return;
    const amount = Number(counterValue);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setBusyId("counter");
    setMessage(null);
    const result =
      role === "CEO"
        ? await bridge.counterExecutiveSponsorOffer(overview.clubId, selected.id, amount)
        : await bridge.counterSponsorOffer(overview.clubId, selected.id, amount);
    setBusyId(null);
    setMessage(
      result.ok
        ? result.data.status === "ACTIVE"
          ? `${selected.sponsorName} accepted your counter at ${money(result.data.annualValue)}.`
          : `${selected.sponsorName} walked away from the negotiation.`
        : result.error.message,
    );
    if (result.ok) refresh();
  };

  const options: MeetingOption[] = selected
    ? [
        { id: "accept", label: "Accept", description: money(selected.annualValue, selected.currency), tone: "primary" },
        { id: "reject", label: "Reject", tone: "neutral" },
        {
          id: "counter",
          label: "Counter",
          description: "Request a higher annual value — the sponsor may walk away instead of paying more.",
          tone: "risk",
          disabled: !Number.isFinite(Number(counterValue)) || Number(counterValue) <= 0,
          disabledReason: "Enter a counter amount above zero first.",
        },
      ]
    : [];

  return (
    <section className="role-detail">
      <MeetingShell
        title={selected?.sponsorName ?? "Sponsorship"}
        meetingType="Sponsor meeting"
        context={[
          { label: "Active sponsors", value: overview.active.length },
          { label: "Active annual value", value: money(overview.active.reduce((sum, item) => sum + item.annualValue, 0)) },
          ...(selected
            ? [
                { label: "Industry", value: selected.sponsorIndustry },
                { label: "Budget tier", value: selected.sponsorBudgetTier },
                {
                  label: "Identity",
                  value: selected.sponsorIdentityProvenance === "VERIFIED" ? "Verified company" : "Simulation-only",
                  tone: (selected.sponsorIdentityProvenance === "VERIFIED" ? "ok" : "info") as MeetingTone,
                },
              ]
            : []),
        ]}
      >
        {overview.offers.length === 0 ? (
          <p className="empty-state">No open sponsorship offers. Offers appear here once the club's commercial pipeline surfaces one.</p>
        ) : (
          <>
            {overview.offers.length > 1 && (
              <div className="inline-form">
                <label>
                  Offer
                  <select value={selected?.id} onChange={(event) => setSelectedId(event.target.value as EntityId)}>
                    {overview.offers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.sponsorName} · {SPONSORSHIP_TYPE_LABELS[item.type] ?? item.type}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {selected && (
              <>
                <MeetingParticipants
                  initiator={{ name: "You", role: role === "CEO" ? "Chief Executive Officer" : "Chairman / Owner" }}
                  counterpart={{ name: selected.sponsorName, role: selected.sponsorIndustry }}
                />
                <MeetingBrief heading={SPONSORSHIP_TYPE_LABELS[selected.type] ?? selected.type}>
                  <p>{sponsorNarrative(selected)}</p>
                  <p className="subtle">
                    {money(selected.annualValue, selected.currency)} per year · {selected.startDate} – {selected.endDate}
                  </p>
                </MeetingBrief>
                <div className="inline-form">
                  <label>
                    Counter amount
                    <input
                      type="number"
                      min="1"
                      placeholder={String(selected.annualValue)}
                      value={counterValue}
                      onChange={(event) => setCounterValue(event.target.value)}
                    />
                  </label>
                </div>
              </>
            )}
            <MeetingOptions
              options={options}
              busyId={busyId}
              onChoose={(id) => (id === "counter" ? void counter() : void decide(id === "accept"))}
            />
          </>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <MeetingOutcome
          history={[...overview.active, ...overview.history].map((item) => ({
            date: item.endDate,
            label: item.status,
            tone: sponsorStatusTone(item.status),
            detail: `${item.sponsorName} · ${SPONSORSHIP_TYPE_LABELS[item.type] ?? item.type} · ${money(item.annualValue, item.currency)} · ${item.startDate} – ${item.endDate}`,
          }))}
        />
      </MeetingShell>
    </section>
  );
};

// Every open bid already generated by createInvestorStakeOffer decides
// unconditionally at whatever amount decideInvestorBid is given — the
// backend never simulates the investor pushing back on a raised price. A
// "counter" affordance here would just let the owner name any number and
// have it accepted, which is not a negotiation; it is not built for that
// reason (see CODEX_UI_BRIDGE_NEEDED in the task report).
const bidStatusTone = (statusValue: OwnershipInvestorBidView["offer"]["status"]): MeetingTone =>
  statusValue === "ACCEPTED" ? "ok" : statusValue === "REJECTED" || statusValue === "WITHDRAWN" ? "bad" : "info";

const InvestorMeeting = ({ bridge }: { bridge: DesktopRuntimeApi }): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getInvestorMeeting());
  return (
    <AsyncPanel state={state}>{(overview) => <InvestorMeetingView overview={overview} bridge={bridge} refresh={refresh} />}</AsyncPanel>
  );
};

const InvestorMeetingView = ({
  overview,
  bridge,
  refresh,
}: {
  overview: InvestorMeetingOverview;
  bridge: DesktopRuntimeApi;
  refresh: () => void;
}): React.ReactElement => {
  const { market } = overview;
  const openBids = market.bids.filter((bid) => ["OFFER", "COUNTER"].includes(bid.offer.status));
  const decidedBids = market.bids.filter((bid) => !["OFFER", "COUNTER"].includes(bid.offer.status));
  const currentStake = market.ownership.find((stake) => stake.holderId === overview.ownerPersonId);
  const currentPercentage = currentStake?.percentage ?? 0;

  const [selectedBidId, setSelectedBidId] = useState<EntityId | undefined>(openBids[0]?.offer.id);
  const selectedBid = openBids.find((bid) => bid.offer.id === selectedBidId) ?? openBids[0];
  const [confirmingControlLoss, setConfirmingControlLoss] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [offerPercentage, setOfferPercentage] = useState(String(Math.min(10, Math.max(1, Math.round(currentPercentage)))));
  const [injectAmount, setInjectAmount] = useState("500000");
  const [injectBusy, setInjectBusy] = useState(false);

  const offerStake = async (): Promise<void> => {
    setBusyId("offer");
    setMessage(null);
    const result = await bridge.createInvestorStakeOffer(Number(offerPercentage));
    setBusyId(null);
    setMessage(result.ok ? "Simulation investor bids received." : result.error.message);
    if (result.ok) refresh();
  };

  const decide = async (bid: OwnershipInvestorBidView, accept: boolean): Promise<void> => {
    setBusyId(bid.offer.id);
    setMessage(null);
    const result = await bridge.decideInvestorBid(bid.offer.id, accept);
    setBusyId(null);
    setConfirmingControlLoss(false);
    setMessage(
      result.ok
        ? accept
          ? `Accepted ${bid.investorName}'s ${money(bid.offer.counterAmount ?? bid.offer.offerAmount)} bid for ${bid.offer.percentage}%.`
          : `Rejected ${bid.investorName}'s bid.`
        : result.error.message,
    );
    if (result.ok) refresh();
  };

  const injectCapital = async (): Promise<void> => {
    setInjectBusy(true);
    setMessage(null);
    const result = await bridge.injectOwnerCapital(Number(injectAmount));
    setInjectBusy(false);
    setMessage(result.ok ? `Invested ${money(result.data.amount)} of personal capital into the club.` : result.error.message);
    if (result.ok) refresh();
  };

  const resultingPercentage = selectedBid ? Math.max(0, currentPercentage - selectedBid.offer.percentage) : currentPercentage;
  const wouldLoseControl = Boolean(selectedBid) && currentPercentage >= overview.majorityThreshold && resultingPercentage < overview.majorityThreshold;

  const options: MeetingOption[] = selectedBid
    ? confirmingControlLoss
      ? [
          {
            id: "confirm",
            label: "Confirm — accept and lose majority control",
            description: `${selectedBid.investorName} · ${money(selectedBid.offer.counterAmount ?? selectedBid.offer.offerAmount)}`,
            tone: "risk",
          },
          { id: "cancel", label: "Cancel", tone: "neutral" },
        ]
      : [
          {
            id: "accept",
            label: "Accept",
            description: `${money(selectedBid.offer.counterAmount ?? selectedBid.offer.offerAmount)} for ${selectedBid.offer.percentage}%`,
            tone: wouldLoseControl ? "risk" : "primary",
          },
          { id: "reject", label: "Reject", tone: "neutral" },
        ]
    : [];

  const chooseOption = (id: string): void => {
    if (!selectedBid) return;
    if (id === "cancel") {
      setConfirmingControlLoss(false);
      return;
    }
    if (id === "accept" && wouldLoseControl) {
      setConfirmingControlLoss(true);
      return;
    }
    void decide(selectedBid, id === "accept" || id === "confirm");
  };

  return (
    <section className="role-detail">
      <MeetingShell
        title={selectedBid ? selectedBid.investorName : "Investor relations"}
        meetingType="Investor meeting"
        context={[
          { label: "Club valuation", value: money(market.valuation) },
          { label: "Your stake", value: `${currentPercentage}%` },
          {
            label: "Control status",
            value: currentPercentage >= overview.majorityThreshold ? "Majority control" : "Minority stake",
            tone: currentPercentage >= overview.majorityThreshold ? "ok" : "warn",
          },
          { label: "Your personal cash", value: money(overview.ownerPersonalCash) },
          ...(selectedBid
            ? [
                { label: "Resulting stake if accepted", value: `${resultingPercentage}%` },
                {
                  label: "Resulting control",
                  value: wouldLoseControl ? "Majority control lost" : resultingPercentage >= overview.majorityThreshold ? "Majority retained" : "Minority stake",
                  tone: (wouldLoseControl ? "bad" : "ok") as MeetingTone,
                },
              ]
            : []),
        ]}
      >
        {openBids.length === 0 ? (
          <p className="empty-state">No open investor bids. Offer a stake below to invite simulation bids.</p>
        ) : (
          <>
            {openBids.length > 1 && (
              <div className="inline-form">
                <label>
                  Investor
                  <select value={selectedBid?.offer.id} onChange={(event) => { setSelectedBidId(event.target.value as EntityId); setConfirmingControlLoss(false); }}>
                    {openBids.map((bid) => (
                      <option key={bid.offer.id} value={bid.offer.id}>
                        {bid.investorName} · {bid.offer.percentage}%
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {selectedBid && (
              <>
                <MeetingParticipants
                  initiator={{ name: "You", role: "Chairman / Owner" }}
                  counterpart={{ name: selectedBid.investorName, role: selectedBid.investorType.replaceAll("_", " ") }}
                />
                <MeetingBrief heading="Terms offered">
                  <p>
                    {selectedBid.offer.rationale ?? "Simulation investor bid."} Implied club valuation at this price:{" "}
                    {money(selectedBid.impliedValuation)}. A personal share sale pays you directly — club cash is
                    unaffected.
                  </p>
                </MeetingBrief>
              </>
            )}
            <MeetingOptions options={options} busyId={busyId} onChoose={chooseOption} />
          </>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <MeetingOutcome
          history={decidedBids.map((bid) => ({
            date: bid.offer.decidedOn ?? bid.offer.createdOn,
            label: bid.offer.status,
            tone: bidStatusTone(bid.offer.status),
            detail: `${bid.investorName} · ${bid.offer.percentage}% · ${money(bid.offer.counterAmount ?? bid.offer.offerAmount)}${bid.offer.rationale ? ` · ${bid.offer.rationale}` : ""}`,
          }))}
        />
        <Panel title="Ownership breakdown">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Holder</th>
                  <th>Role</th>
                  <th>Stake</th>
                </tr>
              </thead>
              <tbody>
                {market.ownership
                  .filter((stake) => stake.status === "ACTIVE" && (stake.percentage ?? 0) > 0)
                  .map((stake) => (
                    <tr key={stake.id}>
                      <td>{stake.holderName}</td>
                      <td>{stake.role.replaceAll("_", " ")}</td>
                      <td>{stake.percentage}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Offer a stake for sale">
          <p className="subtle">
            Invites simulation investor bids for a percentage of your own stake. A sale pays you personally; club
            cash does not change.
          </p>
          <div className="inline-form">
            <label>
              Stake to offer (%)
              <input type="number" min="1" max={Math.max(1, currentPercentage)} value={offerPercentage} onChange={(event) => setOfferPercentage(event.target.value)} />
            </label>
            <button className="primary small" disabled={busyId !== null} onClick={() => void offerStake()}>
              {busyId === "offer" ? "Inviting…" : "Offer stake"}
            </button>
          </div>
        </Panel>
        <Panel title="Invest your own capital" className="investor-capital-panel">
          <p className="subtle">
            Distinct from a share sale above: this is your own money going into the club&rsquo;s cash, in exchange for
            more equity — every existing stake (including your own) is diluted by the same amount the new equity
            represents. This is not a third-party investor; it is you funding the club further.
          </p>
          <div className="inline-form">
            <label>
              Amount (NPR)
              <input type="number" min="1" value={injectAmount} onChange={(event) => setInjectAmount(event.target.value)} />
            </label>
            <button className="small" disabled={injectBusy} onClick={() => void injectCapital()}>
              {injectBusy ? "Investing…" : "Invest capital"}
            </button>
          </div>
        </Panel>
      </MeetingShell>
    </section>
  );
};

const ChairmanSupporters = ({ dashboard }: { dashboard: ChairmanDashboard }): React.ReactElement => <section className="role-detail"><Panel title="Supporters"><p className="subtle">Supporter data is provided by the club economy read model and marked simulation-only by the runtime.</p><Metrics items={[{ label: "Supporter profile", value: dashboard.club.name }, { label: "Active sponsors", value: dashboard.sponsorships.filter((item) => item.status === "ACTIVE").length }]} /><p className="empty-state">Detailed attendance history is not exposed by the current owner contract.</p></Panel></section>;

const PresidentDetail = ({ screen, bridge, onNavigate }: { screen: PresidentScreen; bridge: DesktopRuntimeApi; onNavigate: Props["onNavigate"] }): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getFederationPresidentDashboard());
  return <AsyncPanel state={state}>{(dashboard) => {
    if (screen === "dashboard") return <p className="subtle">Select a federation-office section from the sidebar.</p>;
    if (screen === "governance") return <Governance dashboard={dashboard} bridge={bridge} refresh={refresh} />;
    if (screen === "finance") return <FederationFinance dashboard={dashboard} bridge={bridge} />;
    if (screen === "national-teams") return <NationalTeams dashboard={dashboard} />;
    if (screen === "national-development") return <NationalDevelopment bridge={bridge} />;
    if (screen === "government-relations") return <GovernmentRelations bridge={bridge} />;
    return <Tenure dashboard={dashboard} />;
  }}</AsyncPanel>;
};

const Governance = ({ dashboard, bridge, refresh }: { dashboard: FederationPresidentDashboard; bridge: DesktopRuntimeApi; refresh: () => void }): React.ReactElement => {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const approved = dashboard.proposals.find((item) => item.status === "APPROVED");
  const implement = async (): Promise<void> => { if (!approved) return; setBusy(true); const result = await bridge.implementFederationGovernanceProposal(approved.id); setBusy(false); setMessage(result.ok ? "Proposal implemented." : result.error.message); if (result.ok) refresh(); };
  return <section className="role-detail"><Panel title="Governance" actions={approved && <button className="primary small" disabled={busy} onClick={() => void implement()}>{busy ? "Implementing…" : "Implement approved"}</button>}><div className="table-scroll"><table><thead><tr><th>Proposal</th><th>Policy area</th><th>Status</th><th>Proposed</th></tr></thead><tbody>{dashboard.proposals.map((item) => <tr key={item.id}><td>{item.title}</td><td>{item.policyArea}</td><td><Badge tone={item.status === "APPROVED" ? "ok" : item.status === "REJECTED" ? "bad" : "info"}>{item.status}</Badge></td><td>{item.proposedAt}</td></tr>)}</tbody></table></div>{dashboard.proposals.length === 0 && <p className="empty-state">No governance proposals recorded.</p>}{message && <p className="notice" role="status">{message}</p>}</Panel><Panel title="Federation programmes"><ProjectList projects={dashboard.projects} /></Panel></section>;
};

const FederationFinance = ({ dashboard, bridge }: { dashboard: FederationPresidentDashboard; bridge: DesktopRuntimeApi }): React.ReactElement => <section className="role-detail"><Panel title="Federation finance"><Metrics items={[{ label: "Balance", value: money(dashboard.finances.account.cashBalance, dashboard.finances.account.currency) }, { label: "Revenue", value: money(dashboard.finances.account.seasonRevenue, dashboard.finances.account.currency) }, { label: "Expenses", value: money(dashboard.finances.account.seasonExpenses, dashboard.finances.account.currency) }, { label: "Profit / loss", value: money(dashboard.finances.account.seasonProfitLoss, dashboard.finances.account.currency) }, { label: "Government / grants", value: money(dashboard.finances.ledgerEntries.filter((entry) => entry.category.includes("GRANT")).reduce((sum, entry) => sum + entry.amount, 0), dashboard.finances.account.currency) }]} /></Panel><FederationCommercial bridge={bridge} /><Ledger entries={dashboard.finances.ledgerEntries} /></section>;

/**
 * Read-only by design: ensureFederationSponsorship and
 * settleFederationMediaRightsForCompetition both create and settle their
 * deal in the same step, so there is no OFFERED state for a president to
 * decide — showing an accept/reject/counter meeting here would be fake.
 */
const FederationCommercial = ({ bridge }: { bridge: DesktopRuntimeApi }): React.ReactElement => {
  const [state] = useRuntimeData(() => bridge.getFederationCommercialOverview());
  return (
    <AsyncPanel state={state}>
      {(overview) => (
        <Panel title="Commercial partnerships">
          <p className="subtle">
            These deals are generated and settled automatically by the federation&rsquo;s commercial cadence —
            there is no negotiation step to act on here.
          </p>
          {overview.sponsorship ? (
            <Metrics
              items={[
                { label: "Federation sponsor", value: overview.sponsorship.sponsorName },
                { label: "Category", value: overview.sponsorship.type.replaceAll("_", " ") },
                { label: "Annual value", value: money(overview.sponsorship.annualValue, overview.sponsorship.currency) },
                { label: "Term", value: `${overview.sponsorship.startDate} – ${overview.sponsorship.endDate}` },
              ]}
            />
          ) : (
            <p className="empty-state">No federation sponsorship has been established yet.</p>
          )}
          {overview.mediaRights.length === 0 ? (
            <p className="empty-state">No competition media-rights deal has been settled yet.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Package</th>
                    <th>Broadcaster</th>
                    <th>Value</th>
                    <th>Status</th>
                    <th>Term</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.mediaRights.map((item, index) => (
                    <tr key={index}>
                      <td>{item.packageName}</td>
                      <td>{item.broadcasterName}</td>
                      <td>{money(item.value)}</td>
                      <td>
                        <Badge tone={item.status === "ACTIVE" ? "ok" : item.status === "EXPIRED" ? "bad" : "info"}>{item.status}</Badge>
                      </td>
                      <td>
                        {item.startDate ?? "—"} – {item.endDate ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </AsyncPanel>
  );
};
const NationalTeams = ({ dashboard }: { dashboard: FederationPresidentDashboard }): React.ReactElement => <section className="role-detail"><Panel title="National teams"><div className="table-scroll"><table><thead><tr><th>Team</th><th>Level</th><th>Gender</th><th>Head coach</th></tr></thead><tbody>{dashboard.nationalTeams.map((team) => <tr key={team.id}><td>{team.name}</td><td>{team.level}</td><td>{team.gender}</td><td>{team.headCoach ?? "Not recorded"}</td></tr>)}</tbody></table></div></Panel></section>;
const Tenure = ({ dashboard }: { dashboard: FederationPresidentDashboard }): React.ReactElement => <section className="role-detail"><Panel title="Presidency and tenure"><Metrics items={[{ label: "Federation", value: dashboard.federation.name }, { label: "Current term", value: dashboard.tenure ? `${dashboard.tenure.termStart} – ${dashboard.tenure.termEnd ?? "current"}` : "Not recorded" }, { label: "Status", value: dashboard.tenure?.status ?? "Unknown" }, { label: "Candidacy", value: "See ANFA Presidency Path on Home" }]} /></Panel></section>;

const DEVELOPMENT_DIMENSION_LABELS: Record<string, string> = {
  youth: "Youth development",
  schoolFootball: "School football",
  talentHotspots: "Talent hotspots",
  coaching: "Coaching",
  refereeing: "Refereeing",
  infrastructure: "Infrastructure",
  womenGirls: "Women & girls",
  participation: "Grassroots participation",
  nationalTeams: "National teams",
  competitionQuality: "Competition quality",
  commercialStrength: "Commercial strength",
  governancePolicy: "Governance & policy",
  internationalPathway: "International pathway",
};

const bandTone = (band: FederationDevelopmentBand): "ok" | "info" | "warn" | "bad" =>
  band === "ESTABLISHED" ? "ok" : band === "PROGRESSING" ? "info" : band === "BUILDING" ? "warn" : "bad";
const bandLabel = (band: FederationDevelopmentBand): string =>
  band === "ESTABLISHED"
    ? "Established"
    : band === "PROGRESSING"
      ? "Progressing"
      : band === "BUILDING"
        ? "Building"
        : "Foundation";
const trendLabel = (trend: FederationDevelopmentSummary["trend"]): string =>
  trend === "IMPROVING" ? "Improving" : trend === "DECLINING" ? "Declining" : "Stable";
const trendTone = (trend: FederationDevelopmentSummary["trend"]): "ok" | "info" | "bad" =>
  trend === "IMPROVING" ? "ok" : trend === "DECLINING" ? "bad" : "info";

// Pathway/participation bands reuse the same four-step scale as the overall
// development band, but their lowest step is spelled "LIMITED" rather than
// "FOUNDATION" — a separate, real read-model type, not a duplicate scale.
const participationBandLabel = (band: "LIMITED" | "BUILDING" | "PROGRESSING" | "ESTABLISHED"): string =>
  band === "ESTABLISHED"
    ? "Established"
    : band === "PROGRESSING"
      ? "Progressing"
      : band === "BUILDING"
        ? "Building"
        : "Limited";

const NationalDevelopment = ({ bridge }: { bridge: DesktopRuntimeApi }): React.ReactElement => {
  const [state] = useRuntimeData(() => bridge.getNationalDevelopment());
  return (
    <AsyncPanel state={state}>
      {(summary) => <NationalDevelopmentView summary={summary} />}
    </AsyncPanel>
  );
};

const NationalDevelopmentView = ({
  summary,
}: {
  summary: FederationDevelopmentSummary;
}): React.ReactElement => {
  const { outcomes } = summary;
  const fixtureRecord = (record: { fixtures: number; wins: number; draws: number; losses: number }): string =>
    record.fixtures === 0 ? "No fixtures recorded" : `${record.wins}W ${record.draws}D ${record.losses}L (${record.fixtures} played)`;
  return (
    <section className="role-detail">
      <Panel
        title="Overall development"
        actions={
          <span className="button-row">
            <Badge tone={bandTone(summary.band)}>{bandLabel(summary.band)}</Badge>
            <Badge tone={trendTone(summary.trend)}>{trendLabel(summary.trend)}</Badge>
          </span>
        }
      >
        <p className="subtle">
          As of {summary.asOf} · Government relationship:{" "}
          <Badge
            tone={
              summary.governmentRelationship === "STRONG"
                ? "ok"
                : summary.governmentRelationship === "WORKING"
                  ? "info"
                  : "warn"
            }
          >
            {summary.governmentRelationship.toLowerCase()}
          </Badge>
        </p>
        <div className="metrics">
          {Object.entries(summary.dimensions).map(([key, band]) => (
            <div key={key}>
              <dt>{DEVELOPMENT_DIMENSION_LABELS[key] ?? key}</dt>
              <dd>
                <Badge tone={bandTone(band)}>{bandLabel(band)}</Badge>
              </dd>
            </div>
          ))}
        </div>
      </Panel>

      <div className="summary-grid">
        <Panel title="Strengths">
          <ul className="compact-list">
            {summary.strengths.length ? (
              summary.strengths.map((item) => <li key={item}>{item.replaceAll("_", " ").toLowerCase()}</li>)
            ) : (
              <li className="empty-state">No standout strengths identified yet.</li>
            )}
          </ul>
        </Panel>
        <Panel title="Priorities">
          <ul className="compact-list">
            {summary.priorities.length ? (
              summary.priorities.map((item) => <li key={item}>{item.replaceAll("_", " ").toLowerCase()}</li>)
            ) : (
              <li className="empty-state">No open development priorities recorded.</li>
            )}
          </ul>
        </Panel>
      </div>

      <Panel title="Recent contributors">
        <ul className="compact-list">
          {summary.impactSummaries.length ? (
            summary.impactSummaries.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)
          ) : (
            <li className="empty-state">No recent development activity recorded.</li>
          )}
        </ul>
      </Panel>

      <div className="summary-grid">
        <Panel title="Senior national team">
          <p>{fixtureRecord(outcomes.senior)}</p>
        </Panel>
        <Panel title="Youth national teams">
          <p>{fixtureRecord(outcomes.youth)}</p>
        </Panel>
        <Panel title="Women's national team">
          <p>{fixtureRecord(outcomes.women)}</p>
        </Panel>
      </div>

      <Panel title="Youth-to-senior pathway">
        <Metrics
          items={[
            { label: "Academy players", value: outcomes.pathway.academyPlayers },
            { label: "First-team debuts", value: outcomes.pathway.firstTeamDebuts },
            { label: "Regular first-team players", value: outcomes.pathway.regularFirstTeamPlayers },
            { label: "Youth national call-ups", value: outcomes.pathway.youthNationalPlayers },
            { label: "Senior national call-ups", value: outcomes.pathway.seniorNationalPlayers },
          ]}
        />
        <p className="subtle">
          Strongest stage: {outcomes.strongestPathwayStage.replaceAll("_", " ").toLowerCase()} · Weakest
          stage: {outcomes.weakestPathwayStage.replaceAll("_", " ").toLowerCase()}
        </p>
      </Panel>

      <Panel title="Academy conversion by season">
        {outcomes.academyConversionBySeason.length === 0 ? (
          <p className="empty-state">No academy conversion history recorded yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Season</th>
                  <th>Intake</th>
                  <th>Graduates</th>
                  <th>Debuts</th>
                  <th>Regulars</th>
                  <th>Youth caps</th>
                  <th>Senior caps</th>
                  <th>Transfers out</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.academyConversionBySeason.map((season) => (
                  <tr key={season.seasonLabel}>
                    <td>{season.seasonLabel}</td>
                    <td>{season.intakeCount}</td>
                    <td>{season.academyGraduates}</td>
                    <td>{season.firstTeamDebuts}</td>
                    <td>{season.regularFirstTeamPlayers}</td>
                    <td>{season.youthNationalCallups}</td>
                    <td>{season.seniorNationalCallups}</td>
                    <td>{season.meaningfulExternalTransfers}</td>
                    <td>
                      <Badge
                        tone={
                          season.confidence === "HIGH" ? "ok" : season.confidence === "MEDIUM" ? "info" : "warn"
                        }
                      >
                        {season.confidence.toLowerCase()} ({season.sampleSize})
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="summary-grid">
        <Panel title="Women & girls programme">
          <Metrics
            items={[
              { label: "Participation", value: participationBandLabel(outcomes.womenProgramme.participationBand) },
              { label: "Girls development", value: participationBandLabel(outcomes.girlsDevelopment) },
              {
                label: "Coaching infrastructure",
                value: outcomes.womenProgramme.coachingInfrastructureSupport === "PRESENT" ? "Present" : "Limited",
              },
            ]}
          />
          <Metrics
            items={[
              { label: "Intake", value: outcomes.womenProgramme.intakeCount },
              { label: "Academy progression", value: outcomes.womenProgramme.academyProgression },
              { label: "Youth national progression", value: outcomes.womenProgramme.youthNationalProgression },
              { label: "Senior national progression", value: outcomes.womenProgramme.seniorNationalProgression },
            ]}
          />
        </Panel>
      </div>
    </section>
  );
};

const ProjectList = ({ projects }: { projects: FederationPresidentDashboard["projects"] }): React.ReactElement => <ul className="compact-list">{projects.length ? projects.map((project) => <li key={project.id}>{project.name} · {project.status} · {project.expectedCompletion}</li>) : <li>No federation projects recorded.</li>}</ul>;

// Land, ground, and infrastructure requests all route through these three
// real funding types — there is no separate "stadium vs training ground vs
// academy" field on the backend application yet, so the purpose picker below
// only ever offers labels the domain model actually understands.
const FUNDING_TYPE_LABELS: Record<GovernmentFundingType, string> = {
  FEDERATION_OPERATIONS: "Federation operations",
  NATIONAL_TEAM_PREPARATION: "National team preparation",
  INFRASTRUCTURE: "Infrastructure programme",
  REGIONAL_GROUND: "Regional ground",
  WOMENS_FOOTBALL: "Women's football",
  YOUTH_GRASSROOTS: "Youth grassroots",
  MUNICIPAL_LAND_OR_VENUE: "Municipal land or venue",
};
const LAND_FUNDING_TYPES: GovernmentFundingType[] = ["MUNICIPAL_LAND_OR_VENUE", "REGIONAL_GROUND", "INFRASTRUCTURE"];

const relationshipLabel = (band: GovernmentRelationshipBand): string =>
  band === "NOT_ESTABLISHED" ? "Not yet established" : band[0] + band.slice(1).toLowerCase();
const relationshipTone = (band: GovernmentRelationshipBand): MeetingTone =>
  band === "STRONG" ? "ok" : band === "COOPERATIVE" ? "info" : band === "CAUTIOUS" ? "warn" : band === "STRAINED" ? "bad" : "info";
const priorityLabel = (band: GovernmentPriorityBand): string => band.replaceAll("_", " ")[0] + band.replaceAll("_", " ").slice(1).toLowerCase();
const priorityTone = (band: GovernmentPriorityBand): MeetingTone =>
  band === "VERY_HIGH" ? "ok" : band === "HIGH" ? "info" : band === "MODERATE" ? "warn" : "bad";
const applicationStatusLabel = (status: GovernmentFundingApplication["status"]): string =>
  status[0] + status.slice(1).toLowerCase().replaceAll("_", " ");
const applicationStatusTone = (status: GovernmentFundingApplication["status"]): MeetingTone =>
  status === "APPROVED" || status === "COMPLETED" ? "ok" : status === "REJECTED" ? "bad" : status === "CONDITIONAL" ? "warn" : "info";

const GovernmentRelations = ({ bridge }: { bridge: DesktopRuntimeApi }): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getGovernmentOverview());
  return (
    <AsyncPanel
      state={state}
      isEmpty={(overview) => overview.institutions.length === 0}
      empty="No government institution has engaged with the federation yet. Institutions and relationships appear here once one first proposes or reviews funding — typically through the federation's annual grassroots funding cycle."
    >
      {(overview) => <GovernmentRelationsView overview={overview} bridge={bridge} refresh={refresh} />}
    </AsyncPanel>
  );
};

const GovernmentRelationsView = ({
  overview,
  bridge,
  refresh,
}: {
  overview: GovernmentOverview;
  bridge: DesktopRuntimeApi;
  refresh: () => void;
}): React.ReactElement => {
  const [selectedId, setSelectedId] = useState<EntityId>(overview.institutions[0]!.id);
  const institution = overview.institutions.find((item) => item.id === selectedId) ?? overview.institutions[0]!;
  const [fundingType, setFundingType] = useState<GovernmentFundingType>("MUNICIPAL_LAND_OR_VENUE");
  const [amount, setAmount] = useState("2000000");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const applications = overview.applications.filter((application) => application.institutionId === institution.id);
  const requestedAmount = Number(amount);
  const canRequest = Number.isFinite(requestedAmount) && requestedAmount > 0;

  const requestFunding = async (): Promise<void> => {
    setBusyId("request");
    setMessage(null);
    const result = await bridge.requestGovernmentFunding(institution.id, fundingType, requestedAmount);
    setBusyId(null);
    setMessage(
      result.ok
        ? `Recorded a ${FUNDING_TYPE_LABELS[fundingType]} request for ${money(requestedAmount)}.`
        : result.error.message,
    );
    if (result.ok) refresh();
  };

  const options: MeetingOption[] = [
    {
      id: "request",
      label: "Request land / ground funding",
      description: `${FUNDING_TYPE_LABELS[fundingType]} · ${money(canRequest ? requestedAmount : undefined)}`,
      tone: "primary",
      disabled: !canRequest,
      disabledReason: canRequest ? undefined : "Enter a requested amount above zero.",
    },
  ];

  return (
    <section className="role-detail">
      <MeetingShell
        title={institution.name}
        meetingType="Government relations"
        context={[
          { label: "Institution type", value: institution.institutionType.replaceAll("_", " ") },
          { label: "Relationship", value: relationshipLabel(institution.relationshipBand), tone: relationshipTone(institution.relationshipBand) },
          { label: "Infrastructure priority", value: priorityLabel(institution.infrastructurePriorityBand), tone: priorityTone(institution.infrastructurePriorityBand) },
          { label: "Youth & women priority", value: priorityLabel(institution.youthWomenPriorityBand), tone: priorityTone(institution.youthWomenPriorityBand) },
          { label: "Estimated available funding", value: money(institution.estimatedAvailableFunding) },
        ]}
      >
        {overview.institutions.length > 1 && (
          <div className="inline-form">
            <label>
              Institution
              <select value={institution.id} onChange={(event) => setSelectedId(event.target.value as EntityId)}>
                {overview.institutions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <MeetingParticipants
          initiator={{ name: "You", role: "Federation President" }}
          counterpart={{ name: institution.name, role: institution.institutionType.replaceAll("_", " ") }}
        />
        <MeetingBrief heading="Land and ground funding">
          <p>
            Municipal land, regional grounds, and infrastructure grants are the government&rsquo;s route to
            helping fund a stadium, training ground, or academy site. There is no separate purchase-versus-lease
            structure modelled yet, so a request is a single funding amount tied to one of these purposes.
          </p>
        </MeetingBrief>
        <div className="inline-form">
          <label>
            Purpose
            <select value={fundingType} onChange={(event) => setFundingType(event.target.value as GovernmentFundingType)}>
              {LAND_FUNDING_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FUNDING_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Requested amount
            <input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
        </div>
        <MeetingOptions options={options} busyId={busyId} onChoose={() => void requestFunding()} />
        {message && <p className="notice" role="status">{message}</p>}
        <MeetingOutcome
          history={applications.map((application) => ({
            date: application.decidedOn ?? application.proposedOn,
            label: applicationStatusLabel(application.status),
            tone: applicationStatusTone(application.status),
            detail: `${FUNDING_TYPE_LABELS[application.fundingType]} · requested ${money(application.requestedAmount)}${
              application.approvedAmount !== undefined ? ` · approved ${money(application.approvedAmount)}` : ""
            }${application.decisionReason ? ` · ${application.decisionReason}` : ""}`,
          }))}
        />
      </MeetingShell>
    </section>
  );
};
const Ledger = ({ entries }: { entries: Array<{ id: string; date: string; description: string; direction: string; amount: number; currency: string }> }): React.ReactElement => <Panel title="Recent transactions"><ul className="compact-list">{entries.length ? entries.slice(0, 12).map((entry) => <li key={entry.id}>{entry.date} · {entry.description} · {entry.direction === "DEBIT" ? "−" : "+"}{money(entry.amount, entry.currency)}</li>) : <li>No transactions recorded.</li>}</ul></Panel>;

// Loan approval is instant and deterministic from real affordability math —
// there is no lender "offer" to accept/reject/counter, and no drawdown step
// separate from approval. The meeting below is honest about that: one
// request action whose outcome is decided the moment it is sent, not a
// back-and-forth negotiation the backend does not support.
const loanStatusTone = (statusValue: ClubLoanApplication["status"]): MeetingTone =>
  statusValue === "APPROVED" ? "ok" : statusValue === "REJECTED" ? "bad" : "info";
const debtStatusTone = (statusValue: ClubDebt["status"]): MeetingTone =>
  statusValue === "ACTIVE" ? "info" : statusValue === "REPAID" ? "ok" : "bad";

export const BankMeeting = ({
  bridge,
  role,
  clubId,
}: {
  bridge: DesktopRuntimeApi;
  role: "CHAIRMAN_OWNER" | "CEO";
  clubId?: EntityId;
}): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getClubFinanceMeeting(clubId), [clubId]);
  return (
    <AsyncPanel state={state}>
      {(overview) => <BankMeetingView overview={overview} bridge={bridge} role={role} refresh={refresh} />}
    </AsyncPanel>
  );
};

const BankMeetingView = ({
  overview,
  bridge,
  role,
  refresh,
}: {
  overview: ClubFinanceMeetingOverview;
  bridge: DesktopRuntimeApi;
  role: "CHAIRMAN_OWNER" | "CEO";
  refresh: () => void;
}): React.ReactElement => {
  const [lenderId, setLenderId] = useState<EntityId | undefined>(overview.lenders[0]?.id);
  const [principal, setPrincipal] = useState("500000");
  const [term, setTerm] = useState("12");
  const [purpose, setPurpose] = useState("Club operations");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const lender = overview.lenders.find((item) => item.id === lenderId);
  const principalAmount = Number(principal);
  const termMonths = Number(term);
  const canRequest =
    Boolean(lender) &&
    Number.isFinite(principalAmount) &&
    principalAmount > 0 &&
    Number.isFinite(termMonths) &&
    termMonths >= 3;

  const requestLoan = async (): Promise<void> => {
    if (!lender) return;
    setBusyId("request");
    setMessage(null);
    const result =
      role === "CEO"
        ? await bridge.applyExecutiveClubLoan(overview.clubId, lender.id, principalAmount, termMonths, purpose)
        : await bridge.applyClubLoan(lender.id, principalAmount, termMonths, purpose);
    setBusyId(null);
    setMessage(
      result.ok ? `${lender.name} ${result.data.status.toLowerCase()} the loan request.` : result.error.message,
    );
    if (result.ok) refresh();
  };

  const repay = async (debtId: EntityId, amount: number): Promise<void> => {
    setBusyId(debtId);
    setMessage(null);
    const result =
      role === "CEO"
        ? await bridge.repayExecutiveClubLoan(overview.clubId, debtId, amount)
        : await bridge.repayClubLoan(debtId, amount);
    setBusyId(null);
    setMessage(result.ok ? "Loan repayment recorded." : result.error.message);
    if (result.ok) refresh();
  };

  const options: MeetingOption[] = [
    {
      id: "request",
      label: "Request loan",
      description: lender
        ? `${lender.name} · ${money(canRequest ? principalAmount : undefined)} over ${termMonths || "—"} months`
        : "Select a lender first.",
      tone: "primary",
      disabled: !canRequest || busyId !== null,
      disabledReason: !lender
        ? "No lender available."
        : !canRequest
          ? "Enter a valid principal above zero and a term of at least 3 months."
          : undefined,
    },
  ];

  return (
    <section className="role-detail">
      <MeetingShell
        title={lender?.name ?? "Club finance"}
        meetingType="Bank meeting"
        context={[
          { label: "Club cash balance", value: money(overview.account.cashBalance) },
          { label: "Financial health", value: overview.account.financialHealth },
          { label: "Outstanding debt", value: money(overview.existingDebt) },
          {
            label: "Borrowing headroom",
            value: money(overview.headroom),
            tone: overview.headroom > 0 ? "ok" : "warn",
          },
        ]}
      >
        {overview.lenders.length === 0 ? (
          <p className="empty-state">No lenders are available to this club yet.</p>
        ) : (
          <>
            <MeetingParticipants
              initiator={{ name: "You", role: role === "CEO" ? "Chief Executive Officer" : "Chairman / Owner" }}
              counterpart={{
                name: lender?.name ?? "Lender",
                role: lender ? lender.institutionType.replaceAll("_", " ") : "Bank",
              }}
            />
            <MeetingBrief heading="Loan terms">
              <p>
                Interest rates and approval are decided from the club&rsquo;s own affordability, not
                negotiated in advance. A rejected request costs nothing; an approved one draws down
                immediately at the rate and schedule shown once decided.
              </p>
            </MeetingBrief>
            <div className="inline-form">
              <label>
                Lender
                <select value={lenderId} onChange={(event) => setLenderId(event.target.value as EntityId)}>
                  {overview.lenders.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Principal
                <input type="number" min="1" value={principal} onChange={(event) => setPrincipal(event.target.value)} />
              </label>
              <label>
                Term (months)
                <input type="number" min="3" max="60" value={term} onChange={(event) => setTerm(event.target.value)} />
              </label>
              <label>
                Purpose
                <input type="text" value={purpose} onChange={(event) => setPurpose(event.target.value)} />
              </label>
            </div>
            <MeetingOptions options={options} busyId={busyId} onChoose={() => void requestLoan()} />
          </>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <MeetingOutcome
          history={overview.loans.map((loan) => ({
            date: loan.decidedOn ?? loan.createdOn,
            label: loan.status,
            tone: loanStatusTone(loan.status),
            detail: `${overview.lenders.find((item) => item.id === loan.lenderId)?.name ?? "Lender"} · ${money(loan.principal)} over ${loan.termMonths} months${loan.reason ? ` · ${loan.reason}` : ""}`,
          }))}
        />
        {overview.debts.length > 0 && (
          <Panel title="Repayment schedule">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Lender</th>
                    <th>Outstanding</th>
                    <th>Rate</th>
                    <th>Next payment</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {overview.debts.map((debt) => (
                    <tr key={debt.id}>
                      <td>{overview.lenders.find((item) => item.id === debt.lenderId)?.name ?? debt.lenderType}</td>
                      <td>{money(debt.outstandingPrincipal)}</td>
                      <td>{(debt.interestRate * 100).toFixed(2)}%</td>
                      <td>{debt.nextPaymentDate ?? "—"}</td>
                      <td>
                        <Badge tone={debtStatusTone(debt.status)}>{debt.status}</Badge>
                      </td>
                      <td>
                        {debt.status === "ACTIVE" && (
                          <button
                            className="small"
                            disabled={busyId !== null}
                            onClick={() => void repay(debt.id, debt.scheduledPayment ?? debt.outstandingPrincipal)}
                          >
                            {busyId === debt.id ? "Repaying…" : "Repay"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </MeetingShell>
    </section>
  );
};

// Every topic below is one createOwnerManagerMeeting already accepts, and
// every stance/commitment type is exactly what resolveOwnerManagerMeeting
// accepts — nothing here invents a category the backend cannot settle.
const OWNER_MANAGER_TOPIC_LABELS: Record<OwnerManagerMeetingTopic, string> = {
  FORM: "Recent form & results",
  TRANSFER_BUDGET: "Transfer budget",
  SQUAD_STRENGTHENING: "Squad strengthening",
  YOUTH_USAGE: "Youth development",
  PLAYING_PHILOSOPHY: "Playing philosophy",
  STAFF_BUDGET: "Staff & coaching budget",
  FACILITIES: "Facilities",
  OBJECTIVES: "Season objectives",
  CONTRACT_SECURITY: "Contract & job security",
};
const OWNER_MANAGER_TOPICS = Object.keys(OWNER_MANAGER_TOPIC_LABELS) as OwnerManagerMeetingTopic[];

const OWNER_MANAGER_COMMITMENT_LABELS: Record<OwnerManagerCommitmentType, string> = {
  PROMOTION_CHALLENGE: "Promotion challenge",
  YOUTH_USAGE: "Youth usage",
  FINANCIAL_DISCIPLINE: "Financial discipline",
  SQUAD_STRENGTHENING: "Squad strengthening",
  FACILITY_PROJECT: "Facility project",
  TACTICAL_STYLE: "Tactical style",
};
const OWNER_MANAGER_COMMITMENT_TYPES = Object.keys(OWNER_MANAGER_COMMITMENT_LABELS) as OwnerManagerCommitmentType[];

const ordinal = (value: number): string => {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
};

const pressureTone = (pressure?: string): MeetingTone =>
  pressure === "HIGH" ? "bad" : pressure === "MEDIUM" ? "warn" : pressure === "LOW" ? "ok" : "info";

/**
 * Every sentence below is built only from fields OwnerManagerMeetingOverview
 * actually carries (recent form, board confidence, real budgets, club
 * vision, infrastructure) — a topic whose backing data is missing gets an
 * honest fallback line, never a fabricated number or claim.
 */
const ownerManagerNarrative = (overview: OwnerManagerMeetingOverview, topic: OwnerManagerMeetingTopic): string => {
  const confidenceLine = `Board confidence currently sits at ${overview.boardConfidence}${overview.boardExpectation ? `, with the board expecting ${overview.boardExpectation.replaceAll("_", " ").toLowerCase()}` : ""}.`;
  switch (topic) {
    case "FORM": {
      const form = overview.recentForm.length ? overview.recentForm.join("") : "no results recorded yet";
      const standing = overview.leaguePosition
        ? `${ordinal(overview.leaguePosition)} in the table after ${overview.played ?? 0} games`
        : "an unclear league position";
      return `Recent form reads ${form}, leaving the club ${standing}. ${confidenceLine}`;
    }
    case "TRANSFER_BUDGET": {
      const budget = overview.budgets.find((item) => item.category === "TRANSFER_BUDGET");
      const philosophy = overview.vision?.transferPhilosophy;
      return `The current transfer budget is ${budget ? money(budget.amount) : "not yet set for this season"}${philosophy ? `, guided by a ${philosophy.toLowerCase()} transfer philosophy` : ""}. The manager wants to know whether that will move before the window closes.`;
    }
    case "SQUAD_STRENGTHENING": {
      const wage = overview.budgets.find((item) => item.category === "WAGE_BUDGET");
      return `The manager believes the squad needs strengthening to meet the club's objective${overview.vision ? ` of ${overview.vision.objective.toLowerCase()}` : ""}. Current wage budget: ${wage ? money(wage.amount) : "not yet set"}.`;
    }
    case "YOUTH_USAGE": {
      const priority = overview.vision?.youthPriority;
      return priority !== undefined
        ? `The board's youth priority is set at ${Math.round(priority * 100)}%. The manager wants to discuss how many academy graduates should feature this season.`
        : "The club has not established a formal youth-development priority yet, but the manager wants to discuss giving young players a pathway.";
    }
    case "PLAYING_PHILOSOPHY": {
      if (!overview.vision) return "The club has no recorded playing identity yet — this meeting is a chance to set one.";
      return `The club's current identity is described as "${overview.vision.identity ?? overview.vision.objective}". The manager wants to confirm this still matches what the board expects on the pitch.`;
    }
    case "STAFF_BUDGET": {
      const staff = overview.budgets.find((item) => item.category === "STAFF_BUDGET");
      return `The current staff budget is ${staff ? money(staff.amount) : "not yet set"}. The manager wants to discuss coaching, medical, and scouting needs.`;
    }
    case "FACILITIES": {
      const count = overview.infrastructure.length;
      return count > 0
        ? `${count} infrastructure project${count === 1 ? " is" : "s are"} currently on record for the club. The manager wants to raise a further facility need.`
        : "No infrastructure projects are currently on record. The manager wants to raise a facility need directly.";
    }
    case "OBJECTIVES":
      return `The board's stated objective is ${overview.vision?.objective.toLowerCase() ?? "not yet formally recorded"}. ${confidenceLine}`;
    case "CONTRACT_SECURITY": {
      const pressureText = overview.pressure ? overview.pressure.toLowerCase() : "unclear";
      const promiseText =
        overview.brokenPromises && overview.brokenPromises > 0
          ? ` ${overview.brokenPromises} promise${overview.brokenPromises === 1 ? " has" : "s have"} been broken.`
          : "";
      return `Board pressure on the manager is currently ${pressureText}.${promiseText} ${confidenceLine}`;
    }
    default:
      return confidenceLine;
  }
};

const OWNER_MANAGER_STANCE_CONSEQUENCE: Record<OwnerManagerMeetingStance, string> = {
  SUPPORT: "Board confidence likely rises; relationship trust may improve.",
  REQUEST: "Board confidence may rise slightly; a commitment can be attached below.",
  CONCERN: "Board confidence may fall; relationship tension may rise.",
};

export const OwnerManagerMeeting = ({
  bridge,
  clubId,
}: {
  bridge: DesktopRuntimeApi;
  clubId?: EntityId;
}): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getOwnerManagerMeeting(clubId), [clubId]);
  return (
    <AsyncPanel state={state}>
      {(overview) => <OwnerManagerMeetingView overview={overview} bridge={bridge} refresh={refresh} />}
    </AsyncPanel>
  );
};

const OWNER_MANAGER_TERMINAL_STAGES = new Set(["ACCEPTED", "REJECTED", "WALKED_AWAY", "COMPLETED", "CANCELLED"]);

const OwnerManagerMeetingView = ({
  overview,
  bridge,
  refresh,
}: {
  overview: OwnerManagerMeetingOverview;
  bridge: DesktopRuntimeApi;
  refresh: () => void;
}): React.ReactElement => {
  const [topic, setTopic] = useState<OwnerManagerMeetingTopic>("FORM");
  const [session, setSession] = useState<UniversalInteraction | undefined>(overview.openMeeting);
  const [stance, setStance] = useState<OwnerManagerMeetingStance>("REQUEST");
  const [addCommitment, setAddCommitment] = useState(false);
  const [commitmentType, setCommitmentType] = useState<OwnerManagerCommitmentType>("SQUAD_STRENGTHENING");
  const [targetCriteria, setTargetCriteria] = useState("");
  const [description, setDescription] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const openMeeting = async (): Promise<void> => {
    setBusyId("open");
    setMessage(null);
    const result = await bridge.openOwnerManagerMeeting(overview.clubId, topic);
    setBusyId(null);
    if (result.ok) setSession(result.data);
    else setMessage(result.error.message);
  };

  const resolve = async (chosenStance: OwnerManagerMeetingStance): Promise<void> => {
    if (!session) return;
    setBusyId(chosenStance);
    setMessage(null);
    const commitment =
      addCommitment && targetCriteria && description && dueOn
        ? { type: commitmentType, targetCriteria, description, dueOn }
        : undefined;
    const result = await bridge.resolveOwnerManagerMeeting(session.id, chosenStance, commitment);
    setBusyId(null);
    setMessage(
      result.ok
        ? commitment
          ? "Meeting concluded — a commitment has been recorded."
          : "Meeting concluded."
        : result.error.message,
    );
    if (result.ok) {
      setSession(undefined);
      setAddCommitment(false);
      setTargetCriteria("");
      setDescription("");
      setDueOn("");
      refresh();
    }
  };

  const options: MeetingOption[] = session
    ? (["SUPPORT", "REQUEST", "CONCERN"] as OwnerManagerMeetingStance[]).map((value) => ({
        id: value,
        label: value === "SUPPORT" ? "Extend support" : value === "REQUEST" ? "Ask for improvement" : "Raise a concern",
        description: OWNER_MANAGER_STANCE_CONSEQUENCE[value],
        tone: value === "CONCERN" ? "risk" : value === "SUPPORT" ? "primary" : "neutral",
      }))
    : [];

  return (
    <section className="role-detail">
      <MeetingShell
        title={overview.managerName}
        meetingType="Owner-manager meeting"
        context={[
          { label: "Board confidence", value: overview.boardConfidence },
          ...(overview.boardExpectation
            ? [{ label: "Board expects", value: overview.boardExpectation.replaceAll("_", " ") }]
            : []),
          ...(overview.pressure
            ? [{ label: "Board pressure on manager", value: overview.pressure, tone: pressureTone(overview.pressure) }]
            : []),
          ...(overview.leaguePosition
            ? [{ label: "League position", value: `${ordinal(overview.leaguePosition)} · ${overview.points ?? 0} pts` }]
            : []),
          { label: "Recent form", value: overview.recentForm.length ? overview.recentForm.join(" ") : "No results yet" },
          ...(overview.activePromises !== undefined
            ? [{ label: "Active promises", value: overview.activePromises }]
            : []),
        ]}
      >
        <MeetingParticipants
          initiator={{ name: "You", role: "Chairman / Owner" }}
          counterpart={{ name: overview.managerName, role: "Manager", organisation: overview.clubName }}
        />
        {!session ? (
          <>
            <MeetingBrief heading="Choose a topic">
              <p>Open a meeting with {overview.managerName} to discuss one real, current aspect of the club.</p>
            </MeetingBrief>
            <div className="inline-form">
              <label>
                Topic
                <select value={topic} onChange={(event) => setTopic(event.target.value as OwnerManagerMeetingTopic)}>
                  {OWNER_MANAGER_TOPICS.map((value) => (
                    <option key={value} value={value}>
                      {OWNER_MANAGER_TOPIC_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary small" disabled={busyId !== null} onClick={() => void openMeeting()}>
                {busyId === "open" ? "Opening…" : "Start meeting"}
              </button>
            </div>
          </>
        ) : (
          <>
            <MeetingBrief heading={OWNER_MANAGER_TOPIC_LABELS[(session.demands.topic as OwnerManagerMeetingTopic) ?? topic]}>
              <p>{ownerManagerNarrative(overview, (session.demands.topic as OwnerManagerMeetingTopic) ?? topic)}</p>
            </MeetingBrief>
            <div className="inline-form">
              <label>
                <input type="checkbox" checked={addCommitment} onChange={(event) => setAddCommitment(event.target.checked)} />
                {" "}Attach a measurable commitment
              </label>
            </div>
            {addCommitment && (
              <div className="inline-form">
                <label>
                  Commitment type
                  <select value={commitmentType} onChange={(event) => setCommitmentType(event.target.value as OwnerManagerCommitmentType)}>
                    {OWNER_MANAGER_COMMITMENT_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {OWNER_MANAGER_COMMITMENT_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Target criteria
                  <input type="text" value={targetCriteria} onChange={(event) => setTargetCriteria(event.target.value)} placeholder="e.g. IMPROVE_SQUAD_DEPTH" />
                </label>
                <label>
                  Description
                  <input type="text" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is being promised" />
                </label>
                <label>
                  Due on
                  <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
                </label>
              </div>
            )}
            <MeetingOptions options={options} busyId={busyId} onChoose={(id) => void resolve(id as OwnerManagerMeetingStance)} />
          </>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <MeetingOutcome
          history={overview.history.map((item) => ({
            date: item.worldDate,
            label: item.outcome ?? item.stage,
            tone: item.stage === "ACCEPTED" ? "ok" : item.stage === "REJECTED" || item.stage === "WALKED_AWAY" ? "bad" : "info",
            detail: `${OWNER_MANAGER_TOPIC_LABELS[(item.demands.topic as OwnerManagerMeetingTopic) ?? "OBJECTIVES"] ?? "Meeting"}${item.offers.stance ? ` · ${String(item.offers.stance).toLowerCase()}` : ""}`,
          }))}
        />
        {overview.budgets.length > 0 && (
          <Panel title="Relevant budgets">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.budgets.map((budget) => (
                    <tr key={budget.id}>
                      <td>{budget.category.replaceAll("_", " ")}</td>
                      <td>{money(budget.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </MeetingShell>
    </section>
  );
};

/**
 * Owner-facing matchday, read-only by construction: watchOwnerFixture and
 * quickSimOwnerFixture are dedicated owner commands with no substitution or
 * tactics path at all (those live only in the manager's own match commands,
 * gated to the MANAGER role) — there is no tactical control to accidentally
 * expose here, because none exists to call.
 */
export const OwnerMatchday = ({ bridge }: { bridge: DesktopRuntimeApi }): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getOwnerMatchday());
  const [live, setLive] = useState<LiveMatchView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const watch = async (fixtureId: EntityId): Promise<void> => {
    setBusyId(`watch:${fixtureId}`);
    setMessage(null);
    const result = await bridge.watchOwnerFixture(fixtureId);
    setBusyId(null);
    if (result.ok) setLive(result.data);
    else setMessage(result.error.message);
  };

  const quickSim = async (fixtureId: EntityId): Promise<void> => {
    setBusyId(`sim:${fixtureId}`);
    setMessage(null);
    const result = await bridge.quickSimOwnerFixture(fixtureId);
    setBusyId(null);
    if (result.ok) {
      setLive(result.data);
      setMessage("Match simulated.");
      refresh();
    } else setMessage(result.error.message);
  };

  return (
    <AsyncPanel state={state}>
      {(matchday) => (
        <section className="role-detail">
          <Panel title={matchday.clubName}>
            <Metrics
              items={
                matchday.positionContext
                  ? [
                      { label: "League position", value: matchday.positionContext.position },
                      { label: "Played", value: matchday.positionContext.played },
                      { label: "Points", value: matchday.positionContext.points },
                    ]
                  : []
              }
            />
          </Panel>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          <Panel title="Next fixture">
            {matchday.upcoming.length === 0 ? (
              <p className="empty-state">No upcoming fixtures scheduled.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Competition</th>
                      <th>Opponent</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {matchday.upcoming.slice(0, 1).map((fixture) => (
                      <tr key={fixture.id}>
                        <td>{fixture.date}</td>
                        <td>{fixture.competition}</td>
                        <td>
                          {fixture.homeAway === "home" ? "vs" : "at"} {fixture.opponent}
                        </td>
                        <td>
                          <span className="button-row">
                            <button className="primary small" disabled={busyId !== null} onClick={() => void watch(fixture.id)}>
                              {busyId === `watch:${fixture.id}` ? "Opening…" : "Watch"}
                            </button>
                            <button className="ghost small" disabled={busyId !== null} onClick={() => void quickSim(fixture.id)}>
                              {busyId === `sim:${fixture.id}` ? "Simulating…" : "Quick sim"}
                            </button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {live && (
            <Panel title="Match">
              <Metrics
                items={[
                  { label: live.home.teamName, value: live.home.goals },
                  { label: live.away.teamName, value: live.away.goals },
                  { label: "Period", value: live.period.replaceAll("_", " ") },
                ]}
              />
              {live.commentary.length === 0 ? (
                <p className="empty-state">No commentary recorded yet.</p>
              ) : (
                <ul className="compact-list">
                  {live.commentary.slice(-10).map((line) => (
                    <li key={line.eventId}>
                      {line.minute !== undefined ? `${line.minute}' ` : ""}
                      {line.text}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          <Panel title="Recent results">
            {matchday.results.length === 0 ? (
              <p className="empty-state">No results recorded yet.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Competition</th>
                      <th>Opponent</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchday.results.map((fixture) => (
                      <tr key={fixture.id}>
                        <td>{fixture.date}</td>
                        <td>{fixture.competition}</td>
                        <td>
                          {fixture.homeAway === "home" ? "vs" : "at"} {fixture.opponent}
                        </td>
                        <td>{fixture.score ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </section>
      )}
    </AsyncPanel>
  );
};
