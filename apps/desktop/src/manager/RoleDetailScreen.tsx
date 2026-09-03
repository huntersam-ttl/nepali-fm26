import React, { useEffect, useState } from "react";
import type {
  ChairmanDashboard,
  CareerHeader,
  CareerRole,
  CareerRoleState,
  ClubDebt,
  ClubFinanceMeetingOverview,
  ClubInfrastructureGovernmentContext,
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
  PresidentCommercialPropertyView,
  PresidentCommercialHistoryEntry,
  OwnerManagerMeetingOverview,
  OwnerManagerMeetingTopic,
  OwnerManagerMeetingStance,
  OwnerManagerCommitmentType,
  UniversalInteraction,
  OwnerMatchdayView,
  LiveMatchView,
  FacilityPlanningView,
  FacilityProjectPlanInput,
  FacilityProjectPlanResult,
  FacilitySiteOption,
  FacilityProjectPlan,
  FacilityProjectMode,
  FacilityProjectScope,
  FacilityFundingSource,
  InfrastructureProject,
  InfrastructureProjectType,
  ManagerPromise,
  EntityReference,
  ActorPlayerActions,
  PlayerContractContext,
  PlayerTransferContext,
  OwnerPlayerRequestIntent,
  OwnerPostMatchSuggestion,
  StructuredMatchEvent,
  MatchEventParticipant,
  OrganizationCommercialDeal,
  OrganizationProfileEntityType,
  ClubProfile,
  StaffProfileReadModel,
  CompetitionProfile,
  OrganizationProfile,
  NationalTeamSquadReadModel,
  NationalTeamSquadPlayer,
  NationalTeamSelectionHistoryEntry,
} from "@nepal-football-sim/shared-types";
import type { EntityId } from "@nepal-football-sim/shared-types";
import type { AppError, AppResult, DesktopRuntimeApi } from "../appBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Metrics, Panel, money, useRuntimeData } from "./ui.js";
import {
  MeetingBrief,
  MeetingOptions,
  MeetingOutcome,
  MeetingParticipants,
  MeetingShell,
  type MeetingOption,
  type MeetingTone,
} from "./meetings.js";

export type ChairmanScreen =
  | "dashboard"
  | "finance"
  | "manager"
  | "facilities"
  | "sponsorship"
  | "supporters"
  | "investors"
  | "bank"
  | "meeting"
  | "matchday";
export type PresidentScreen =
  | "dashboard"
  | "governance"
  | "finance"
  | "commercial"
  | "national-teams"
  | "national-development"
  | "government-relations"
  | "tenure";

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
  "president-finance": {
    title: "Federation finance",
    subtitle: "Balance, revenue, expenses, and profit or loss.",
  },
  manager: { title: "Manager", subtitle: "Appoint and review the person running the team." },
  facilities: { title: "Facilities", subtitle: "Ground and infrastructure projects." },
  sponsorship: { title: "Sponsorship", subtitle: "Commercial agreements and offers." },
  supporters: { title: "Supporters", subtitle: "Attendance and supporter sentiment." },
  bank: { title: "Bank", subtitle: "Loan requests, approvals, and the club's repayment schedule." },
  meeting: {
    title: "Talk to Manager",
    subtitle: "Board confidence, form, budgets, and commitments.",
  },
  matchday: {
    title: "Matchday",
    subtitle: "Fixtures, results, and league position — no tactical control.",
  },
  investors: { title: "Investors", subtitle: "Ownership stakes and equity interest." },
  governance: { title: "Governance", subtitle: "Proposals, policy, and federation decisions." },
  "national-teams": {
    title: "National teams",
    subtitle: "Squads, staff, and international programme.",
  },
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

const SectionHeader = ({ screen, role }: { screen: string; role: CareerRole }): React.ReactElement | null => {
  const section =
    role === "FEDERATION_PRESIDENT" ? (SECTION_TITLES[`president-${screen}`] ?? SECTION_TITLES[screen]) : SECTION_TITLES[screen];
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

export const RoleDetailScreen = ({
  screen,
  header,
  roles,
  bridge,
  onNavigate,
}: Props): React.ReactElement => (
  <>
    <SectionHeader screen={screen} role={header.activeRole} />
    {header.activeRole === "CHAIRMAN_OWNER" ? (
      <ChairmanDetail screen={screen as ChairmanScreen} bridge={bridge} onNavigate={onNavigate} />
    ) : (
      <PresidentDetail screen={screen as PresidentScreen} bridge={bridge} onNavigate={onNavigate} />
    )}
  </>
);

const ChairmanDetail = ({
  screen,
  bridge,
  onNavigate,
}: {
  screen: ChairmanScreen;
  bridge: DesktopRuntimeApi;
  onNavigate: Props["onNavigate"];
}): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getChairmanDashboard());
  return (
    <AsyncPanel state={state}>
      {(dashboard) => {
        if (screen === "dashboard")
          return <p className="subtle">Select an owner-office section from the sidebar.</p>;
        if (screen === "finance")
          return <ChairmanFinance dashboard={dashboard} bridge={bridge} refresh={refresh} />;
        if (screen === "manager")
          return <ChairmanManager dashboard={dashboard} bridge={bridge} refresh={refresh} />;
        if (screen === "facilities")
          return <FacilityPlanner bridge={bridge} clubId={dashboard.club.id} />;
        if (screen === "sponsorship")
          return (
            <SponsorMeeting bridge={bridge} role="CHAIRMAN_OWNER" clubId={dashboard.club.id} />
          );
        if (screen === "investors") return <InvestorMeeting bridge={bridge} />;
        if (screen === "bank")
          return <BankMeeting bridge={bridge} role="CHAIRMAN_OWNER" clubId={dashboard.club.id} />;
        if (screen === "meeting")
          return <OwnerManagerMeeting bridge={bridge} clubId={dashboard.club.id} />;
        if (screen === "matchday")
          return <OwnerMatchday bridge={bridge} onTalkToManager={() => onNavigate("meeting")} />;
        return <ChairmanSupporters dashboard={dashboard} />;
      }}
    </AsyncPanel>
  );
};

const ChairmanFinance = ({
  dashboard,
  bridge,
  refresh,
}: {
  dashboard: ChairmanDashboard;
  bridge: DesktopRuntimeApi;
  refresh: () => void;
}): React.ReactElement => {
  const income = dashboard.finances.ledgerEntries
    .filter((entry) => entry.direction === "CREDIT")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const expenses = dashboard.finances.ledgerEntries
    .filter((entry) => entry.direction === "DEBIT")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const wages = dashboard.finances.ledgerEntries
    .filter((entry) => entry.category === "PLAYER_WAGES" || entry.category === "STAFF_WAGES")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const sponsorship = dashboard.finances.ledgerEntries
    .filter((entry) => entry.category === "SPONSORSHIP")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const projects = dashboard.finances.ledgerEntries
    .filter((entry) => entry.category === "FACILITY_COST")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const [principal, setPrincipal] = useState("100000");
  const [term, setTerm] = useState("12");
  const [message, setMessage] = useState<string | null>(null);
  const [busyDebt, setBusyDebt] = useState<string | null>(null);
  const [busyLoan, setBusyLoan] = useState(false);
  const applyLoan = async (): Promise<void> => {
    const lender = dashboard.finances.lenders[0];
    if (!lender || busyLoan) return;
    setBusyLoan(true);
    const result = await bridge.applyClubLoan(
      lender.id,
      Number(principal),
      Number(term),
      "club operations",
    );
    setBusyLoan(false);
    setMessage(
      result.ok ? `Loan application ${result.data.status.toLowerCase()}.` : result.error.message,
    );
    if (result.ok) refresh();
  };
  const repay = async (debtId: EntityId, amount: number): Promise<void> => {
    setBusyDebt(debtId);
    const result = await bridge.repayClubLoan(debtId, amount);
    setBusyDebt(null);
    setMessage(result.ok ? "Loan repayment recorded." : result.error.message);
    if (result.ok) refresh();
  };
  return (
    <section className="role-detail">
      <Panel title="Club finance">
        <Metrics
          items={[
            { label: "Balance", value: money(dashboard.finances.account.cashBalance) },
            { label: "Income recorded", value: money(income) },
            { label: "Expenses recorded", value: money(expenses) },
            { label: "Wages", value: money(wages) },
            { label: "Sponsorship", value: money(sponsorship) },
            { label: "Project spending", value: money(projects) },
            {
              label: "Debt",
              value: money(
                dashboard.finances.debts.reduce((sum, debt) => sum + debt.outstandingPrincipal, 0),
              ),
            },
            { label: "Financial health", value: dashboard.finances.account.financialHealth },
          ]}
        />
      </Panel>
      <Panel title="Club loan application">
        <p className="subtle">
          Lender identity is verified; rates and approval are simulated from club affordability.
        </p>
        <div className="inline-form">
          <label>
            Principal
            <input
              type="number"
              min="1"
              value={principal}
              onChange={(event) => setPrincipal(event.target.value)}
            />
          </label>
          <label>
            Term (months)
            <input
              type="number"
              min="3"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </label>
          <button className="small" disabled={busyLoan} onClick={() => void applyLoan()}>
            {busyLoan ? "Applying…" : "Apply"}
          </button>
        </div>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
      </Panel>
      <Panel title="Debt schedule">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Lender</th>
                <th>Outstanding</th>
                <th>Rate</th>
                <th>Next payment</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dashboard.finances.debts.length === 0 ? (
                <tr>
                  <td colSpan={5}>No club loans.</td>
                </tr>
              ) : (
                dashboard.finances.debts.map((debt) => (
                  <tr key={debt.id}>
                    <td>
                      {dashboard.finances.lenders.find((lender) => lender.id === debt.lenderId)
                        ?.name ?? debt.lenderType}
                    </td>
                    <td>{money(debt.outstandingPrincipal)}</td>
                    <td>{(debt.interestRate * 100).toFixed(2)}%</td>
                    <td>{debt.nextPaymentDate ?? "—"}</td>
                    <td>
                      <button
                        className="small"
                        disabled={busyDebt !== null}
                        onClick={() =>
                          void repay(debt.id, debt.scheduledPayment || debt.outstandingPrincipal)
                        }
                      >
                        {busyDebt === debt.id ? "Repaying…" : "Repay"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Equipment effects">
        <ul className="compact-list">
          {dashboard.equipment.length === 0 ? (
            <li>No completed equipment assets.</li>
          ) : (
            dashboard.equipment.map((asset) => (
              <li key={asset.id}>
                {band(asset.assetType)} ·{" "}
                {Object.entries(asset.effect ?? {})
                  .map(([key, value]) => `${effectLabel(key)}: +${(value * 100).toFixed(1)}%`)
                  .join(", ") || "operational asset"}
              </li>
            ))
          )}
        </ul>
      </Panel>
      <Ledger entries={dashboard.finances.ledgerEntries} />
    </section>
  );
};

const ChairmanManager = ({
  dashboard,
  bridge,
  refresh,
}: {
  dashboard: ChairmanDashboard;
  bridge: DesktopRuntimeApi;
  refresh: () => void;
}): React.ReactElement => {
  const [candidates, refreshCandidates] = useRuntimeData(() => bridge.listOwnerManagerCandidates());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const active =
    candidates.status === "ready"
      ? candidates.data.filter((candidate) =>
          `${candidate.name} ${candidate.nationality} ${candidate.qualification}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
      : [];
  const appoint = async (candidate: OwnerManagerCandidate): Promise<void> => {
    setBusy(candidate.managerProfileId);
    const result = await bridge.appointManager(candidate.vacancyId, candidate.managerProfileId);
    setBusy(null);
    if (result.ok) {
      setMessage(`${candidate.name} appointed.`);
      setError(null);
      refresh();
      refreshCandidates();
    } else setError(result.error);
  };
  const [busyBudget, setBusyBudget] = useState<string | null>(null);
  const decideBudget = async (requestId: EntityId, approve: boolean): Promise<void> => {
    if (busyBudget) return;
    setBusyBudget(requestId);
    const result = await bridge.decideManagerBudgetRequest(requestId, approve);
    setBusyBudget(null);
    setMessage(
      result.ok
        ? approve
          ? "Budget request approved."
          : "Budget request rejected."
        : result.error.message,
    );
    if (result.ok) refresh();
  };
  return (
    <section className="role-detail">
      {error && <ErrorBanner error={error} />}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <Panel title="Manager oversight" className="panel-wide">
        <Metrics
          items={[
            { label: "Current manager", value: dashboard.manager?.name ?? "Vacant" },
            {
              label: "Contract",
              value: dashboard.manager?.contract.contractEnd ?? "No active contract",
            },
          ]}
        />
        {dashboard.manager ? (
          <p className="subtle">
            The club has an active manager contract. Search becomes available when the vacancy is
            open.
          </p>
        ) : (
          <>
            <label>
              Search candidates
              <input
                aria-label="Manager candidate search"
                placeholder="Name, nationality, qualification"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <AsyncPanel
              state={candidates}
              isEmpty={() => active.length === 0}
              empty="No matching available candidates."
            >
              {() => (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Nationality</th>
                        <th>Qualification</th>
                        <th>Reputation</th>
                        <th>Wage/year</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {active.map((candidate) => (
                        <tr key={candidate.managerProfileId}>
                          <td>{candidate.name}</td>
                          <td>{candidate.nationality}</td>
                          <td>{candidate.qualification}</td>
                          <td>{candidate.reputation}</td>
                          <td>{money(candidate.wageExpectation)}</td>
                          <td>
                            <button
                              className="primary small"
                              disabled={busy !== null}
                              onClick={() => void appoint(candidate)}
                            >
                              {busy === candidate.managerProfileId
                                ? "Appointing…"
                                : "Appoint manager"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </AsyncPanel>
          </>
        )}
      </Panel>
      <Panel title="Pending budget requests">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Requested total</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dashboard.finances.budgetRequests.filter((request) => request.status === "PENDING")
                .length === 0 ? (
                <tr>
                  <td colSpan={4}>No pending manager requests.</td>
                </tr>
              ) : (
                dashboard.finances.budgetRequests
                  .filter((request) => request.status === "PENDING")
                  .map((request) => (
                    <tr key={request.id}>
                      <td>{request.category.replaceAll("_", " ")}</td>
                      <td>{money(request.requestedAmount)}</td>
                      <td>{request.status}</td>
                      <td>
                        <span className="button-row">
                          <button
                            className="primary small"
                            disabled={busyBudget !== null}
                            onClick={() => void decideBudget(request.id, true)}
                          >
                            {busyBudget === request.id ? "Approving…" : "Approve"}
                          </button>
                          <button
                            className="ghost small"
                            disabled={busyBudget !== null}
                            onClick={() => void decideBudget(request.id, false)}
                          >
                            {busyBudget === request.id ? "Deciding…" : "Reject"}
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
};

/*
 * Deep facility planner replaces the old one-click "Approve training
 * ground/academy" buttons (which just called createInfrastructureProject
 * with no scope, components, site, or funding choice) with a believable
 * project-planning workflow on the SAME canonical engine
 * (createFacilityProjectPlan / getFacilitySiteOptions /
 * getFacilityPlanning) — see below, exported as FacilityPlanner.
 */

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
  tier === "PREMIUM"
    ? "a premium national"
    : tier === "NATIONAL"
      ? "a national"
      : tier === "REGIONAL"
        ? "a regional"
        : "a local";

const sponsorStatusTone = (statusValue: SponsorMeetingContract["status"]): MeetingTone =>
  statusValue === "ACTIVE"
    ? "ok"
    : statusValue === "REJECTED" || statusValue === "EXPIRED"
      ? "bad"
      : "info";

/**
 * Contextual briefing built only from fields the offer/sponsor record
 * genuinely carries (industry, budget tier, property type, exclusivity,
 * bonuses, expectations) — never a fabricated claim about the real company
 * behind a VERIFIED identity like Nepal Telecom or Chaudhary Group.
 */
const sponsorNarrative = (contract: SponsorMeetingContract): string => {
  const property =
    SPONSORSHIP_TYPE_LABELS[contract.type] ?? contract.type.replaceAll("_", " ").toLowerCase();
  const tier = budgetTierPhrase(contract.sponsorBudgetTier);
  const exclusivity = contract.exclusivityGroup
    ? ` They are seeking sector exclusivity in ${contract.exclusivityGroup.replaceAll("_", " ").toLowerCase()}.`
    : "";
  const bonusKeys = Object.keys(contract.bonuses ?? {});
  const bonusText =
    bonusKeys.length > 0
      ? ` They have offered performance bonuses tied to ${bonusKeys.join(" and ")}.`
      : "";
  const appearances = contract.expectations?.appearances;
  const expectationText = appearances
    ? ` They expect at least ${appearances} matchday appearances for the branding.`
    : "";
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
      {(overview) => (
        <SponsorMeetingView overview={overview} bridge={bridge} role={role} refresh={refresh} />
      )}
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
  const [openOrgId, setOpenOrgId] = useState<EntityId | undefined>(undefined);

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
        {
          id: "accept",
          label: "Accept",
          description: money(selected.annualValue, selected.currency),
          tone: "primary",
        },
        { id: "reject", label: "Reject", tone: "neutral" },
        {
          id: "counter",
          label: "Counter",
          description:
            "Request a higher annual value — the sponsor may walk away instead of paying more.",
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
          {
            label: "Active annual value",
            value: money(overview.active.reduce((sum, item) => sum + item.annualValue, 0)),
          },
          ...(selected
            ? [
                { label: "Industry", value: selected.sponsorIndustry },
                { label: "Budget tier", value: selected.sponsorBudgetTier },
                {
                  label: "Identity",
                  value:
                    selected.sponsorIdentityProvenance === "VERIFIED"
                      ? "Verified company"
                      : "Simulation-only",
                  tone: (selected.sponsorIdentityProvenance === "VERIFIED"
                    ? "ok"
                    : "info") as MeetingTone,
                },
              ]
            : []),
        ]}
      >
        {overview.offers.length === 0 ? (
          <p className="empty-state">
            No open sponsorship offers. Offers appear here once the club's commercial pipeline
            surfaces one.
          </p>
        ) : (
          <>
            {overview.offers.length > 1 && (
              <div className="inline-form">
                <label>
                  Offer
                  <select
                    value={selected?.id}
                    onChange={(event) => setSelectedId(event.target.value as EntityId)}
                  >
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
                  initiator={{
                    name: "You",
                    role: role === "CEO" ? "Chief Executive Officer" : "Chairman / Owner",
                  }}
                  counterpart={{ name: selected.sponsorName, role: selected.sponsorIndustry }}
                />
                <MeetingBrief heading={SPONSORSHIP_TYPE_LABELS[selected.type] ?? selected.type}>
                  <p>{sponsorNarrative(selected)}</p>
                  <p className="subtle">
                    {money(selected.annualValue, selected.currency)} per year · {selected.startDate}{" "}
                    – {selected.endDate}
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
        {[...overview.active, ...overview.history].length > 0 && (
          <Panel title="Sponsors">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Sponsor</th>
                    <th>Property</th>
                    <th>Value</th>
                    <th>Term</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...overview.active, ...overview.history].map((item) => (
                    <tr key={item.id}>
                      <td>
                        <button className="link" onClick={() => setOpenOrgId(item.sponsorId)}>
                          {item.sponsorName}
                        </button>
                      </td>
                      <td>{SPONSORSHIP_TYPE_LABELS[item.type] ?? item.type}</td>
                      <td>{money(item.annualValue, item.currency)} / year</td>
                      <td>
                        {item.startDate} – {item.endDate}
                      </td>
                      <td>
                        <Badge tone={sponsorStatusTone(item.status)}>{item.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
        {openOrgId && (
          <OrganizationProfilePanel
            bridge={bridge}
            entityType="SPONSOR"
            entityId={openOrgId}
            onClose={() => setOpenOrgId(undefined)}
          />
        )}
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
  statusValue === "ACCEPTED"
    ? "ok"
    : statusValue === "REJECTED" || statusValue === "WITHDRAWN"
      ? "bad"
      : "info";

const InvestorMeeting = ({ bridge }: { bridge: DesktopRuntimeApi }): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getInvestorMeeting());
  return (
    <AsyncPanel state={state}>
      {(overview) => <InvestorMeetingView overview={overview} bridge={bridge} refresh={refresh} />}
    </AsyncPanel>
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

  const [offerPercentage, setOfferPercentage] = useState(
    String(Math.min(10, Math.max(1, Math.round(currentPercentage)))),
  );
  const [injectAmount, setInjectAmount] = useState("500000");
  const [injectBusy, setInjectBusy] = useState(false);
  const [openOrgId, setOpenOrgId] = useState<EntityId | undefined>(undefined);

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
    setMessage(
      result.ok
        ? `Invested ${money(result.data.amount)} of personal capital into the club.`
        : result.error.message,
    );
    if (result.ok) refresh();
  };

  const resultingPercentage = selectedBid
    ? Math.max(0, currentPercentage - selectedBid.offer.percentage)
    : currentPercentage;
  const wouldLoseControl =
    Boolean(selectedBid) &&
    currentPercentage >= overview.majorityThreshold &&
    resultingPercentage < overview.majorityThreshold;

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
            value:
              currentPercentage >= overview.majorityThreshold
                ? "Majority control"
                : "Minority stake",
            tone: currentPercentage >= overview.majorityThreshold ? "ok" : "warn",
          },
          { label: "Your personal cash", value: money(overview.ownerPersonalCash) },
          ...(selectedBid
            ? [
                { label: "Resulting stake if accepted", value: `${resultingPercentage}%` },
                {
                  label: "Resulting control",
                  value: wouldLoseControl
                    ? "Majority control lost"
                    : resultingPercentage >= overview.majorityThreshold
                      ? "Majority retained"
                      : "Minority stake",
                  tone: (wouldLoseControl ? "bad" : "ok") as MeetingTone,
                },
              ]
            : []),
        ]}
      >
        {openBids.length === 0 ? (
          <p className="empty-state">
            No open investor bids. Offer a stake below to invite simulation bids.
          </p>
        ) : (
          <>
            {openBids.length > 1 && (
              <div className="inline-form">
                <label>
                  Investor
                  <select
                    value={selectedBid?.offer.id}
                    onChange={(event) => {
                      setSelectedBidId(event.target.value as EntityId);
                      setConfirmingControlLoss(false);
                    }}
                  >
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
                  counterpart={{
                    name: selectedBid.investorName,
                    role: selectedBid.investorType.replaceAll("_", " "),
                  }}
                />
                <button
                  className="ghost small"
                  onClick={() => setOpenOrgId(selectedBid.offer.buyerPersonId)}
                >
                  View organization profile
                </button>
                {openOrgId && (
                  <OrganizationProfilePanel
                    bridge={bridge}
                    entityType="INVESTOR"
                    entityId={openOrgId}
                    onClose={() => setOpenOrgId(undefined)}
                  />
                )}
                <MeetingBrief heading="Terms offered">
                  <p>
                    {selectedBid.offer.rationale ?? "Simulation investor bid."} Implied club
                    valuation at this price: {money(selectedBid.impliedValuation)}. A personal share
                    sale pays you directly — club cash is unaffected.
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
        {market.bids.length > 0 && (
          <Panel title="Investors">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Investor</th>
                    <th>Stake</th>
                    <th>Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...openBids, ...decidedBids].map((bid) => (
                    <tr key={bid.offer.id}>
                      <td>
                        <button
                          className="link"
                          onClick={() => setOpenOrgId(bid.offer.buyerPersonId)}
                        >
                          {bid.investorName}
                        </button>
                      </td>
                      <td>{bid.offer.percentage}%</td>
                      <td>{money(bid.offer.counterAmount ?? bid.offer.offerAmount)}</td>
                      <td>{band(bid.offer.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
        {openOrgId && !selectedBid && (
          <OrganizationProfilePanel
            bridge={bridge}
            entityType="INVESTOR"
            entityId={openOrgId}
            onClose={() => setOpenOrgId(undefined)}
          />
        )}
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
            Invites simulation investor bids for a percentage of your own stake. A sale pays you
            personally; club cash does not change.
          </p>
          <div className="inline-form">
            <label>
              Stake to offer (%)
              <input
                type="number"
                min="1"
                max={Math.max(1, currentPercentage)}
                value={offerPercentage}
                onChange={(event) => setOfferPercentage(event.target.value)}
              />
            </label>
            <button
              className="primary small"
              disabled={busyId !== null}
              onClick={() => void offerStake()}
            >
              {busyId === "offer" ? "Inviting…" : "Offer stake"}
            </button>
          </div>
        </Panel>
        <Panel title="Invest your own capital" className="investor-capital-panel">
          <p className="subtle">
            Distinct from a share sale above: this is your own money going into the club&rsquo;s
            cash, in exchange for more equity — every existing stake (including your own) is diluted
            by the same amount the new equity represents. This is not a third-party investor; it is
            you funding the club further.
          </p>
          <div className="inline-form">
            <label>
              Amount (NPR)
              <input
                type="number"
                min="1"
                value={injectAmount}
                onChange={(event) => setInjectAmount(event.target.value)}
              />
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

const ChairmanSupporters = ({
  dashboard,
}: {
  dashboard: ChairmanDashboard;
}): React.ReactElement => (
  <section className="role-detail">
    <Panel title="Supporters">
      <p className="subtle">
        Supporter data is provided by the club economy read model and marked simulation-only by the
        runtime.
      </p>
      <Metrics
        items={[
          { label: "Supporter profile", value: dashboard.club.name },
          {
            label: "Active sponsors",
            value: dashboard.sponsorships.filter((item) => item.status === "ACTIVE").length,
          },
        ]}
      />
      <p className="empty-state">
        Detailed attendance history is not exposed by the current owner contract.
      </p>
    </Panel>
  </section>
);

const PresidentDetail = ({
  screen,
  bridge,
  onNavigate,
}: {
  screen: PresidentScreen;
  bridge: DesktopRuntimeApi;
  onNavigate: Props["onNavigate"];
}): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getFederationPresidentDashboard());
  return (
    <AsyncPanel state={state}>
      {(dashboard) => {
        if (screen === "dashboard")
          return <p className="subtle">Select a federation-office section from the sidebar.</p>;
        if (screen === "governance")
          return <Governance dashboard={dashboard} bridge={bridge} refresh={refresh} />;
        if (screen === "finance") return <FederationFinance dashboard={dashboard} />;
        if (screen === "commercial") return <PresidentCommercial bridge={bridge} />;
        if (screen === "national-teams")
          return <NationalTeams dashboard={dashboard} bridge={bridge} />;
        if (screen === "national-development") return <NationalDevelopment bridge={bridge} />;
        if (screen === "government-relations") return <GovernmentRelations bridge={bridge} />;
        return <Tenure dashboard={dashboard} />;
      }}
    </AsyncPanel>
  );
};

const Governance = ({
  dashboard,
  bridge,
  refresh,
}: {
  dashboard: FederationPresidentDashboard;
  bridge: DesktopRuntimeApi;
  refresh: () => void;
}): React.ReactElement => {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const approved = dashboard.proposals.find((item) => item.status === "APPROVED");
  const implement = async (): Promise<void> => {
    if (!approved) return;
    setBusy(true);
    const result = await bridge.implementFederationGovernanceProposal(approved.id);
    setBusy(false);
    setMessage(result.ok ? "Proposal implemented." : result.error.message);
    if (result.ok) refresh();
  };
  return (
    <section className="role-detail">
      <Panel
        title="Governance"
        actions={
          approved && (
            <button className="primary small" disabled={busy} onClick={() => void implement()}>
              {busy ? "Implementing…" : "Implement approved"}
            </button>
          )
        }
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Proposal</th>
                <th>Policy area</th>
                <th>Status</th>
                <th>Proposed</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.proposals.map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>{item.policyArea}</td>
                  <td>
                    <Badge
                      tone={
                        item.status === "APPROVED"
                          ? "ok"
                          : item.status === "REJECTED"
                            ? "bad"
                            : "info"
                      }
                    >
                      {item.status}
                    </Badge>
                  </td>
                  <td>{item.proposedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {dashboard.proposals.length === 0 && (
          <p className="empty-state">No governance proposals recorded.</p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
      </Panel>
      <Panel title="Federation programmes">
        <ProjectList projects={dashboard.projects} />
      </Panel>
    </section>
  );
};

const FederationFinance = ({
  dashboard,
}: {
  dashboard: FederationPresidentDashboard;
}): React.ReactElement => (
  <section className="role-detail">
    <Panel title="Federation finance">
      <Metrics
        items={[
          {
            label: "Balance",
            value: money(
              dashboard.finances.account.cashBalance,
              dashboard.finances.account.currency,
            ),
          },
          {
            label: "Revenue",
            value: money(
              dashboard.finances.account.seasonRevenue,
              dashboard.finances.account.currency,
            ),
          },
          {
            label: "Expenses",
            value: money(
              dashboard.finances.account.seasonExpenses,
              dashboard.finances.account.currency,
            ),
          },
          {
            label: "Profit / loss",
            value: money(
              dashboard.finances.account.seasonProfitLoss,
              dashboard.finances.account.currency,
            ),
          },
          {
            label: "Government / grants",
            value: money(
              dashboard.finances.ledgerEntries
                .filter((entry) => entry.category.includes("GRANT"))
                .reduce((sum, entry) => sum + entry.amount, 0),
              dashboard.finances.account.currency,
            ),
          },
        ]}
      />
    </Panel>
    <Ledger entries={dashboard.finances.ledgerEntries} />
  </section>
);

const PROPERTY_STATUS_TONE: Record<string, MeetingTone> = {
  ACTIVE: "ok",
  RENEWED: "ok",
  AWARDED: "ok",
  OFFERED: "info",
  NEGOTIATED: "info",
  AVAILABLE: "info",
  EXPIRED: "bad",
};

/** Distinguishes Senior Men / Youth / Women & Girls programme cards from one another — never implied as generic senior-team money. */
const PROGRAMME_LABEL: Record<string, string> = {
  SENIOR_MENS: "Senior Men programme",
  YOUTH: "Youth programme",
  WOMENS_GIRLS: "Women & Girls programme",
};

/**
 * One commercial property (A/B/C Division title, federation main partner, or
 * a national programme partner), driven entirely by its own
 * PresidentCommercialPropertyView.availableActions — the same authority the
 * backend commands themselves check, so a button never appears only to be
 * rejected after the click.
 *
 * "RENEW" is one of the backend's own availableActions for an
 * ACTIVE/RENEWED property, but no renewFederationCommercialOffer command is
 * wired to the desktop app (renewCommercialRights exists only in the
 * simulation layer) — rendered as an honest note, never a dead button.
 */
const PropertyCard = ({
  property,
  bridge,
  refresh,
  onOpenOrg,
  groupLabel,
}: {
  property: PresidentCommercialPropertyView;
  bridge: DesktopRuntimeApi;
  refresh: () => void;
  onOpenOrg: (id: EntityId) => void;
  groupLabel?: string;
}): React.ReactElement => {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCounter, setShowCounter] = useState(false);
  const [counterValue, setCounterValue] = useState(
    property.annualValue !== undefined ? String(property.annualValue) : "",
  );
  const [counterTerm, setCounterTerm] = useState(
    property.termYears !== undefined ? String(property.termYears) : "",
  );

  const negotiate = async (): Promise<void> => {
    if (!property.offerId || !bridge.negotiateFederationCommercialOffer) return;
    setBusy("negotiate");
    setMessage(null);
    const result = await bridge.negotiateFederationCommercialOffer(property.offerId);
    setBusy(null);
    setMessage(result.ok ? "Offer marked as under negotiation." : result.error.message);
    if (result.ok) refresh();
  };

  const accept = async (): Promise<void> => {
    if (!property.offerId || !bridge.acceptFederationCommercialOffer) return;
    setBusy("accept");
    setMessage(null);
    const result = await bridge.acceptFederationCommercialOffer(property.offerId);
    setBusy(null);
    setMessage(result.ok ? `Accepted at ${money(result.data.annualValue)} / year.` : result.error.message);
    if (result.ok) refresh();
  };

  const reject = async (): Promise<void> => {
    if (!property.offerId || !bridge.rejectFederationCommercialOffer) return;
    setBusy("reject");
    setMessage(null);
    const result = await bridge.rejectFederationCommercialOffer(property.offerId);
    setBusy(null);
    setMessage(result.ok ? "Offer rejected." : result.error.message);
    if (result.ok) refresh();
  };

  const counter = async (): Promise<void> => {
    if (!property.offerId || !bridge.counterFederationCommercialOffer) return;
    const amount = Number(counterValue);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const term = counterTerm ? Number(counterTerm) : undefined;
    setBusy("counter");
    setMessage(null);
    const result = await bridge.counterFederationCommercialOffer(property.offerId, amount, term);
    setBusy(null);
    setMessage(result.ok ? `Countered at ${money(result.data.annualValue)} / year.` : result.error.message);
    if (result.ok) {
      setShowCounter(false);
      refresh();
    }
  };

  const items: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: "Sponsor",
      value: property.sponsor ? (
        <EntityRefLink reference={property.sponsor} onOpen={(reference) => onOpenOrg(reference.id)} />
      ) : (
        "No sponsor yet"
      ),
    },
    ...(property.termYears !== undefined ? [{ label: "Term", value: `${property.termYears}y` }] : []),
    ...(property.annualValue !== undefined
      ? [{ label: "Annual value", value: money(property.annualValue) }]
      : []),
    { label: "Settlement", value: band(property.settlementState) },
    ...(property.startDate ? [{ label: "Start", value: property.startDate }] : []),
    ...(property.endDate ? [{ label: "Expiry", value: property.endDate }] : []),
    ...(property.revenueDestination
      ? [{ label: "Revenue destination", value: band(property.revenueDestination) }]
      : []),
    ...(property.competingOfferCount > 0
      ? [{ label: "Competing offers", value: property.competingOfferCount }]
      : []),
  ];

  return (
    <div className="commercial-property-card">
      <header>
        <h4>{property.commercialDisplayTitle ?? property.canonicalName}</h4>
        <Badge tone={PROPERTY_STATUS_TONE[property.status] ?? "info"}>{band(property.status)}</Badge>
      </header>
      {groupLabel && <p className="subtle">{groupLabel}</p>}
      {property.commercialDisplayTitle && property.commercialDisplayTitle !== property.canonicalName && (
        <p className="subtle">{property.canonicalName}</p>
      )}
      <Metrics items={items} />
      {property.blockedReason && <p className="empty-state">{property.blockedReason}</p>}
      <div className="button-row">
        {property.status === "OFFERED" && bridge.negotiateFederationCommercialOffer && (
          <button className="ghost small" disabled={busy !== null} onClick={() => void negotiate()}>
            {busy === "negotiate" ? "Marking…" : "Mark in negotiation"}
          </button>
        )}
        {property.availableActions.includes("ACCEPT") && bridge.acceptFederationCommercialOffer && (
          <button className="primary small" disabled={busy !== null} onClick={() => void accept()}>
            {busy === "accept" ? "Accepting…" : "Accept"}
          </button>
        )}
        {property.availableActions.includes("COUNTER") && bridge.counterFederationCommercialOffer && (
          <button
            className="ghost small"
            disabled={busy !== null}
            onClick={() => setShowCounter((value) => !value)}
          >
            Counter
          </button>
        )}
        {property.availableActions.includes("REJECT") && bridge.rejectFederationCommercialOffer && (
          <button className="ghost small" disabled={busy !== null} onClick={() => void reject()}>
            {busy === "reject" ? "Rejecting…" : "Reject"}
          </button>
        )}
      </div>
      {showCounter && (
        <div className="inline-form">
          <label>
            Counter annual value
            <input
              type="number"
              min="1"
              value={counterValue}
              onChange={(event) => setCounterValue(event.target.value)}
            />
          </label>
          <label>
            Term (years)
            <input
              type="number"
              min="1"
              max="4"
              value={counterTerm}
              onChange={(event) => setCounterTerm(event.target.value)}
            />
          </label>
          <button
            className="primary small"
            disabled={busy !== null || !Number.isFinite(Number(counterValue)) || Number(counterValue) <= 0}
            onClick={() => void counter()}
          >
            {busy === "counter" ? "Countering…" : "Submit counter"}
          </button>
        </div>
      )}
      {property.availableActions.includes("RENEW") && (
        <p className="subtle">Active — renewal isn&rsquo;t available from this app yet.</p>
      )}
      {property.availableActions.length === 1 &&
        property.availableActions[0] === "VIEW_OFFERS" &&
        !property.sponsor && <p className="empty-state">No sponsor or open offer for this property yet.</p>}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </div>
  );
};

const COMMERCIAL_HISTORY_STATUS_TONE: Record<string, MeetingTone> = {
  ACTIVE: "ok",
  AWARDED: "ok",
  RENEWED: "ok",
  EXPIRED: "bad",
};

const CommercialHistoryPanel = ({
  history,
  onOpenOrg,
}: {
  history: PresidentCommercialHistoryEntry[];
  onOpenOrg: (id: EntityId) => void;
}): React.ReactElement => (
  <Panel title="Commercial history" className="panel-wide">
    {history.length === 0 ? (
      <p className="empty-state">No commercial history recorded yet.</p>
    ) : (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Sponsor</th>
              <th>Value</th>
              <th>Status</th>
              <th>Settlement</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {history.map((item) => (
              <tr key={item.id}>
                <td>{item.canonicalName}</td>
                <td>
                  {item.sponsor ? (
                    <EntityRefLink
                      reference={item.sponsor}
                      onOpen={(reference) => onOpenOrg(reference.id)}
                    />
                  ) : (
                    "—"
                  )}
                </td>
                <td>{item.annualValue !== undefined ? `${money(item.annualValue)} / year` : "—"}</td>
                <td>
                  <Badge tone={COMMERCIAL_HISTORY_STATUS_TONE[item.status] ?? "info"}>
                    {band(item.status)}
                  </Badge>
                </td>
                <td>{band(item.settlementState)}</td>
                <td>
                  {item.date ?? "—"}
                  {item.endDate ? ` – ${item.endDate}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Panel>
);

/**
 * PRESIDENT COMMERCIAL — the unified negotiate/counter/accept/reject
 * workflow over federationCommercialOverview's `properties`/`history`
 * (5c81086). Every property card acts through the real President-only
 * command; nothing here computes a probability, score, or fabricated offer.
 * Broadcast/media rights stay read-only by design: settleFederationMedia-
 * RightsForCompetition creates and settles its deal in one step, with no
 * OFFERED state for a president to decide.
 */
const PresidentCommercial = ({ bridge }: { bridge: DesktopRuntimeApi }): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getFederationCommercialOverview());
  const [openOrgId, setOpenOrgId] = useState<EntityId | undefined>(undefined);
  return (
    <AsyncPanel state={state}>
      {(overview) => {
        const competitions = overview.properties.filter((item) => item.scope === "COMPETITION");
        const federation = overview.properties.filter((item) => item.scope === "FEDERATION");
        const programmes = overview.properties.filter((item) =>
          (["SENIOR_MENS", "YOUTH", "WOMENS_GIRLS"] as const).includes(
            item.scope as "SENIOR_MENS" | "YOUTH" | "WOMENS_GIRLS",
          ),
        );
        // Defensive fallback only: federationCommercialOverview already folds the
        // legacy auto-generated sponsorship into `properties` whenever no
        // FEDERATION-scope commercial-rights property exists yet — this covers the
        // rare case where both records exist independently, without duplicating.
        const legacySponsorshipUnrepresented =
          overview.sponsorship &&
          !federation.some((item) => item.sponsor?.id === overview.sponsorship!.sponsorId);
        return (
          <section className="role-detail">
            <Panel title="Competitions">
              {competitions.length === 0 ? (
                <p className="empty-state">No competition title-sponsorship properties recorded yet.</p>
              ) : (
                <div className="commercial-property-grid">
                  {competitions.map((property) => (
                    <PropertyCard
                      key={property.id}
                      property={property}
                      bridge={bridge}
                      refresh={refresh}
                      onOpenOrg={setOpenOrgId}
                    />
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="Federation">
              {federation.length === 0 && !legacySponsorshipUnrepresented ? (
                <p className="empty-state">No federation main-partner property recorded yet.</p>
              ) : (
                <div className="commercial-property-grid">
                  {federation.map((property) => (
                    <PropertyCard
                      key={property.id}
                      property={property}
                      bridge={bridge}
                      refresh={refresh}
                      onOpenOrg={setOpenOrgId}
                    />
                  ))}
                  {legacySponsorshipUnrepresented && (
                    <div className="commercial-property-card">
                      <header>
                        <h4>Federation main partner</h4>
                        <Badge tone="ok">{band(overview.sponsorship!.status)}</Badge>
                      </header>
                      <Metrics
                        items={[
                          {
                            label: "Sponsor",
                            value: (
                              <button
                                className="link"
                                onClick={() => setOpenOrgId(overview.sponsorship!.sponsorId)}
                              >
                                {overview.sponsorship!.sponsorName}
                              </button>
                            ),
                          },
                          {
                            label: "Annual value",
                            value: money(
                              overview.sponsorship!.annualValue,
                              overview.sponsorship!.currency,
                            ),
                          },
                          {
                            label: "Term",
                            value: `${overview.sponsorship!.startDate} – ${overview.sponsorship!.endDate}`,
                          },
                        ]}
                      />
                      <p className="subtle">
                        Generated and settled automatically by the federation&rsquo;s commercial
                        cadence — no negotiation step to act on here.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </Panel>
            <Panel title="National programmes">
              {programmes.length === 0 ? (
                <p className="empty-state">
                  No national-programme sponsorship properties recorded yet.
                </p>
              ) : (
                <div className="commercial-property-grid">
                  {programmes.map((property) => (
                    <PropertyCard
                      key={property.id}
                      property={property}
                      bridge={bridge}
                      refresh={refresh}
                      onOpenOrg={setOpenOrgId}
                      groupLabel={property.programme ? PROGRAMME_LABEL[property.programme] : undefined}
                    />
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="Broadcast & other rights">
              <p className="subtle">
                Generated and settled automatically by the federation&rsquo;s media-rights cadence —
                no negotiation step to act on here.
              </p>
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
                            <Badge
                              tone={
                                item.status === "ACTIVE"
                                  ? "ok"
                                  : item.status === "EXPIRED"
                                    ? "bad"
                                    : "info"
                              }
                            >
                              {item.status}
                            </Badge>
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
            <CommercialHistoryPanel history={overview.history} onOpenOrg={setOpenOrgId} />
            {openOrgId && (
              <OrganizationProfilePanel
                bridge={bridge}
                entityType="SPONSOR"
                entityId={openOrgId}
                onClose={() => setOpenOrgId(undefined)}
              />
            )}
          </section>
        );
      }}
    </AsyncPanel>
  );
};
const NationalTeams = ({
  dashboard,
  bridge,
}: {
  dashboard: FederationPresidentDashboard;
  bridge: DesktopRuntimeApi;
}): React.ReactElement => {
  const [squadTeamId, setSquadTeamId] = useState<EntityId | undefined>(undefined);
  return (
    <section className="role-detail">
      <Panel title="National teams">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>Level</th>
                <th>Gender</th>
                <th>Head coach</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.nationalTeams.map((team) => (
                <tr key={team.id}>
                  <td>
                    <button className="link" onClick={() => setSquadTeamId(team.id)}>
                      {team.name}
                    </button>
                  </td>
                  <td>{team.level}</td>
                  <td>{team.gender}</td>
                  <td>{team.headCoach ?? "Not recorded"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {squadTeamId && (
        <NationalTeamSquadPanel
          bridge={bridge}
          teams={dashboard.nationalTeams}
          initialTeamId={squadTeamId}
          onClose={() => setSquadTeamId(undefined)}
        />
      )}
    </section>
  );
};

const SELECTION_STATUS_TONE: Record<string, MeetingTone> = {
  CALLED_UP: "ok",
  CONFIRMED: "ok",
  STANDBY: "info",
  DECLINED: "bad",
  WITHDRAWN: "warn",
  RELEASED: "info",
};
const AVAILABILITY_TONE: Record<NationalTeamSquadPlayer["availability"], MeetingTone> = {
  AVAILABLE: "ok",
  INJURED: "bad",
  SUSPENDED: "warn",
  UNAVAILABLE: "info",
};
const PROGRAMME_DISPLAY_LABEL: Record<string, string> = {
  SENIOR_MENS: "Senior Men",
  YOUTH: "Youth",
  WOMENS_GIRLS: "Women & Girls",
};

/**
 * NATIONAL-TEAM SQUAD — the canonical persisted call-up state
 * (getNationalTeamSquad, 0f714b4/acc9003). "Programme" here always means
 * whichever real team you are looking at (Senior Men / Senior Women / a
 * specific youth age group) — the backend derives one programme per team id,
 * so switching teams IS switching programme; there is no separate
 * programme override that would make sense against a single team's own
 * call-ups. Read-only throughout: no selection/call-up mutation exists on
 * this command surface, so none is exposed here.
 */
const NationalTeamSquadPanel = ({
  bridge,
  teams,
  initialTeamId,
  onClose,
}: {
  bridge: DesktopRuntimeApi;
  teams: FederationPresidentDashboard["nationalTeams"];
  initialTeamId: EntityId;
  onClose: () => void;
}): React.ReactElement => {
  const [teamId, setTeamId] = useState<EntityId>(initialTeamId);
  const [state] = useRuntimeData(async () => {
    if (!bridge.getNationalTeamSquad)
      return {
        ok: false as const,
        error: { code: "RUNTIME_UNAVAILABLE" as const, message: "National-team squads are unavailable right now." },
      };
    return bridge.getNationalTeamSquad(teamId);
  }, [teamId]);
  const [openPlayerId, setOpenPlayerId] = useState<EntityId | undefined>(undefined);
  const [openClubId, setOpenClubId] = useState<EntityId | undefined>(undefined);
  const [openStaffId, setOpenStaffId] = useState<EntityId | undefined>(undefined);

  const openEntity = (reference: EntityReference): void => {
    if (reference.entityType === "PLAYER") setOpenPlayerId(reference.id);
    else if (reference.entityType === "CLUB") setOpenClubId(reference.id);
    else if (reference.entityType === "STAFF") setOpenStaffId(reference.id);
  };

  return (
    <Panel
      title="National team squad"
      className="panel-wide"
      actions={
        <button className="ghost small" onClick={onClose}>
          Close
        </button>
      }
    >
      {teams.length > 1 && (
        <div className="inline-form">
          <label>
            National team
            <select value={teamId} onChange={(event) => setTeamId(event.target.value as EntityId)}>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <AsyncPanel state={state}>
        {(squad) => (
          <>
            <h2>{squad.nationalTeam.label}</h2>
            <div className="button-row">
              <Badge tone="info">{PROGRAMME_DISPLAY_LABEL[squad.programme] ?? band(squad.programme)}</Badge>
            </div>
            {!squad.supported ? (
              <p className="empty-state">
                {squad.unsupportedReason ?? "This national team's squad is not available."}
              </p>
            ) : (
              <>
                <Metrics
                  items={[
                    { label: "Squad size", value: squad.squadSize },
                    { label: "Selected", value: squad.selectedCount },
                    { label: "Unavailable", value: squad.unavailableCount },
                    {
                      label: "Head coach",
                      value: squad.headCoach ? (
                        <EntityRefLink reference={squad.headCoach} onOpen={openEntity} />
                      ) : (
                        "Not recorded"
                      ),
                    },
                    ...(squad.currentWindow
                      ? [{ label: "Current window", value: squad.currentWindow.callupDate }]
                      : []),
                    { label: "As of", value: squad.asOf },
                  ]}
                />
                <Panel title="Club distribution">
                  {squad.clubDistribution.length === 0 ? (
                    <p className="empty-state">No club distribution recorded.</p>
                  ) : (
                    <div className="button-row">
                      {squad.clubDistribution.map((entry, index) => (
                        <span className="entity-chip" key={entry.club?.id ?? `unattached-${index}`}>
                          {entry.club ? (
                            <EntityRefLink reference={entry.club} onOpen={openEntity} />
                          ) : (
                            "Unattached"
                          )}{" "}
                          · {entry.count}
                        </span>
                      ))}
                    </div>
                  )}
                </Panel>
                <Panel title="Squad" className="panel-wide">
                  {squad.players.length === 0 ? (
                    <p className="empty-state">No players currently called up to this squad.</p>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Player</th>
                            <th>Position</th>
                            <th>Age</th>
                            <th>Club</th>
                            <th>Squad type</th>
                            <th>Status</th>
                            <th>Availability</th>
                            <th>Caps</th>
                            <th>Called up</th>
                          </tr>
                        </thead>
                        <tbody>
                          {squad.players.map((player) => (
                            <tr key={player.personId}>
                              <td>
                                <EntityRefLink reference={player.player} onOpen={openEntity} />
                              </td>
                              <td>{player.position ? band(player.position) : "—"}</td>
                              <td>{player.age ?? "—"}</td>
                              <td>
                                {player.currentClub ? (
                                  <EntityRefLink reference={player.currentClub} onOpen={openEntity} />
                                ) : (
                                  "Unattached"
                                )}
                              </td>
                              <td>{band(player.squadType)}</td>
                              <td>
                                <Badge tone={SELECTION_STATUS_TONE[player.selectionStatus] ?? "info"}>
                                  {band(player.selectionStatus)}
                                </Badge>
                              </td>
                              <td>
                                <Badge tone={AVAILABILITY_TONE[player.availability]}>
                                  {band(player.availability)}
                                </Badge>
                              </td>
                              <td>{player.internationalAppearances}</td>
                              <td>{player.callupDate}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
                <Panel title="Recent call-up history" className="panel-wide">
                  {squad.selectionHistory.length === 0 ? (
                    <p className="empty-state">No call-up history recorded.</p>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Player</th>
                            <th>Status</th>
                            <th>Appearance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {squad.selectionHistory.map((entry) => (
                            <tr key={entry.id}>
                              <td>{entry.callupDate}</td>
                              <td>
                                <EntityRefLink reference={entry.player} onOpen={openEntity} />
                              </td>
                              <td>
                                <Badge tone={SELECTION_STATUS_TONE[entry.selectionStatus] ?? "info"}>
                                  {band(entry.selectionStatus)}
                                </Badge>
                              </td>
                              <td>
                                {entry.appearance
                                  ? `${entry.appearance.date} vs ${entry.appearance.opponent} · ${entry.appearance.minutes}'${entry.appearance.goals > 0 ? ` · ${entry.appearance.goals}g` : ""}`
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              </>
            )}
          </>
        )}
      </AsyncPanel>
      {openPlayerId && (
        <PlayerContextPanel
          bridge={bridge}
          playerId={openPlayerId}
          onClose={() => setOpenPlayerId(undefined)}
        />
      )}
      {openClubId && (
        <OrganizationProfilePanel
          bridge={bridge}
          entityType="CLUB"
          entityId={openClubId}
          onClose={() => setOpenClubId(undefined)}
        />
      )}
      {openStaffId && (
        <OrganizationProfilePanel
          bridge={bridge}
          entityType="STAFF"
          entityId={openStaffId}
          onClose={() => setOpenStaffId(undefined)}
        />
      )}
    </Panel>
  );
};
const Tenure = ({ dashboard }: { dashboard: FederationPresidentDashboard }): React.ReactElement => (
  <section className="role-detail">
    <Panel title="Presidency and tenure">
      <Metrics
        items={[
          { label: "Federation", value: dashboard.federation.name },
          {
            label: "Current term",
            value: dashboard.tenure
              ? `${dashboard.tenure.termStart} – ${dashboard.tenure.termEnd ?? "current"}`
              : "Not recorded",
          },
          { label: "Status", value: dashboard.tenure?.status ?? "Unknown" },
          { label: "Candidacy", value: "See ANFA Presidency Path on Home" },
        ]}
      />
    </Panel>
  </section>
);

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
  band === "ESTABLISHED"
    ? "ok"
    : band === "PROGRESSING"
      ? "info"
      : band === "BUILDING"
        ? "warn"
        : "bad";
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
const participationBandLabel = (
  band: "LIMITED" | "BUILDING" | "PROGRESSING" | "ESTABLISHED",
): string =>
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
  const fixtureRecord = (record: {
    fixtures: number;
    wins: number;
    draws: number;
    losses: number;
  }): string =>
    record.fixtures === 0
      ? "No fixtures recorded"
      : `${record.wins}W ${record.draws}D ${record.losses}L (${record.fixtures} played)`;
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
              summary.strengths.map((item) => (
                <li key={item}>{item.replaceAll("_", " ").toLowerCase()}</li>
              ))
            ) : (
              <li className="empty-state">No standout strengths identified yet.</li>
            )}
          </ul>
        </Panel>
        <Panel title="Priorities">
          <ul className="compact-list">
            {summary.priorities.length ? (
              summary.priorities.map((item) => (
                <li key={item}>{item.replaceAll("_", " ").toLowerCase()}</li>
              ))
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
            {
              label: "Regular first-team players",
              value: outcomes.pathway.regularFirstTeamPlayers,
            },
            { label: "Youth national call-ups", value: outcomes.pathway.youthNationalPlayers },
            { label: "Senior national call-ups", value: outcomes.pathway.seniorNationalPlayers },
          ]}
        />
        <p className="subtle">
          Strongest stage: {outcomes.strongestPathwayStage.replaceAll("_", " ").toLowerCase()} ·
          Weakest stage: {outcomes.weakestPathwayStage.replaceAll("_", " ").toLowerCase()}
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
                          season.confidence === "HIGH"
                            ? "ok"
                            : season.confidence === "MEDIUM"
                              ? "info"
                              : "warn"
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
              {
                label: "Participation",
                value: participationBandLabel(outcomes.womenProgramme.participationBand),
              },
              {
                label: "Girls development",
                value: participationBandLabel(outcomes.girlsDevelopment),
              },
              {
                label: "Coaching infrastructure",
                value:
                  outcomes.womenProgramme.coachingInfrastructureSupport === "PRESENT"
                    ? "Present"
                    : "Limited",
              },
            ]}
          />
          <Metrics
            items={[
              { label: "Intake", value: outcomes.womenProgramme.intakeCount },
              { label: "Academy progression", value: outcomes.womenProgramme.academyProgression },
              {
                label: "Youth national progression",
                value: outcomes.womenProgramme.youthNationalProgression,
              },
              {
                label: "Senior national progression",
                value: outcomes.womenProgramme.seniorNationalProgression,
              },
            ]}
          />
        </Panel>
      </div>
    </section>
  );
};

const ProjectList = ({
  projects,
}: {
  projects: FederationPresidentDashboard["projects"];
}): React.ReactElement => (
  <ul className="compact-list">
    {projects.length ? (
      projects.map((project) => (
        <li key={project.id}>
          {project.name} · {project.status} · {project.expectedCompletion}
        </li>
      ))
    ) : (
      <li>No federation projects recorded.</li>
    )}
  </ul>
);

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
const LAND_FUNDING_TYPES: GovernmentFundingType[] = [
  "MUNICIPAL_LAND_OR_VENUE",
  "REGIONAL_GROUND",
  "INFRASTRUCTURE",
];

const relationshipLabel = (band: GovernmentRelationshipBand): string =>
  band === "NOT_ESTABLISHED" ? "Not yet established" : band[0] + band.slice(1).toLowerCase();
const relationshipTone = (band: GovernmentRelationshipBand): MeetingTone =>
  band === "STRONG"
    ? "ok"
    : band === "COOPERATIVE"
      ? "info"
      : band === "CAUTIOUS"
        ? "warn"
        : band === "STRAINED"
          ? "bad"
          : "info";
const priorityLabel = (band: GovernmentPriorityBand): string =>
  band.replaceAll("_", " ")[0] + band.replaceAll("_", " ").slice(1).toLowerCase();
const priorityTone = (band: GovernmentPriorityBand): MeetingTone =>
  band === "VERY_HIGH" ? "ok" : band === "HIGH" ? "info" : band === "MODERATE" ? "warn" : "bad";
const applicationStatusLabel = (status: GovernmentFundingApplication["status"]): string =>
  status[0] + status.slice(1).toLowerCase().replaceAll("_", " ");
const applicationStatusTone = (status: GovernmentFundingApplication["status"]): MeetingTone =>
  status === "APPROVED" || status === "COMPLETED"
    ? "ok"
    : status === "REJECTED"
      ? "bad"
      : status === "CONDITIONAL"
        ? "warn"
        : "info";

const GovernmentRelations = ({ bridge }: { bridge: DesktopRuntimeApi }): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getGovernmentOverview());
  return (
    <AsyncPanel
      state={state}
      isEmpty={(overview) => overview.institutions.length === 0}
      empty="No government institution has engaged with the federation yet. Institutions and relationships appear here once one first proposes or reviews funding — typically through the federation's annual grassroots funding cycle."
    >
      {(overview) => (
        <GovernmentRelationsView overview={overview} bridge={bridge} refresh={refresh} />
      )}
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
  const institution =
    overview.institutions.find((item) => item.id === selectedId) ?? overview.institutions[0]!;
  const [fundingType, setFundingType] = useState<GovernmentFundingType>("MUNICIPAL_LAND_OR_VENUE");
  const [amount, setAmount] = useState("2000000");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const applications = overview.applications.filter(
    (application) => application.institutionId === institution.id,
  );
  const requestedAmount = Number(amount);
  const canRequest = Number.isFinite(requestedAmount) && requestedAmount > 0;

  const requestFunding = async (): Promise<void> => {
    setBusyId("request");
    setMessage(null);
    const result = await bridge.requestGovernmentFunding(
      institution.id,
      fundingType,
      requestedAmount,
    );
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
          {
            label: "Relationship",
            value: relationshipLabel(institution.relationshipBand),
            tone: relationshipTone(institution.relationshipBand),
          },
          {
            label: "Infrastructure priority",
            value: priorityLabel(institution.infrastructurePriorityBand),
            tone: priorityTone(institution.infrastructurePriorityBand),
          },
          {
            label: "Youth & women priority",
            value: priorityLabel(institution.youthWomenPriorityBand),
            tone: priorityTone(institution.youthWomenPriorityBand),
          },
          {
            label: "Estimated available funding",
            value: money(institution.estimatedAvailableFunding),
          },
        ]}
      >
        {overview.institutions.length > 1 && (
          <div className="inline-form">
            <label>
              Institution
              <select
                value={institution.id}
                onChange={(event) => setSelectedId(event.target.value as EntityId)}
              >
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
          counterpart={{
            name: institution.name,
            role: institution.institutionType.replaceAll("_", " "),
          }}
        />
        <MeetingBrief heading="Land and ground funding">
          <p>
            Municipal land, regional grounds, and infrastructure grants are the government&rsquo;s
            route to helping fund a stadium, training ground, or academy site. There is no separate
            purchase-versus-lease structure modelled yet, so a request is a single funding amount
            tied to one of these purposes.
          </p>
        </MeetingBrief>
        <div className="inline-form">
          <label>
            Purpose
            <select
              value={fundingType}
              onChange={(event) => setFundingType(event.target.value as GovernmentFundingType)}
            >
              {LAND_FUNDING_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FUNDING_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Requested amount
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
        </div>
        <MeetingOptions options={options} busyId={busyId} onChoose={() => void requestFunding()} />
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <MeetingOutcome
          history={applications.map((application) => ({
            date: application.decidedOn ?? application.proposedOn,
            label: applicationStatusLabel(application.status),
            tone: applicationStatusTone(application.status),
            detail: `${FUNDING_TYPE_LABELS[application.fundingType]} · requested ${money(application.requestedAmount)}${
              application.approvedAmount !== undefined
                ? ` · approved ${money(application.approvedAmount)}`
                : ""
            }${application.decisionReason ? ` · ${application.decisionReason}` : ""}`,
          }))}
        />
      </MeetingShell>
    </section>
  );
};
const Ledger = ({
  entries,
}: {
  entries: Array<{
    id: string;
    date: string;
    description: string;
    direction: string;
    amount: number;
    currency: string;
  }>;
}): React.ReactElement => (
  <Panel title="Recent transactions">
    <ul className="compact-list">
      {entries.length ? (
        entries.slice(0, 12).map((entry) => (
          <li key={entry.id}>
            {entry.date} · {entry.description} · {entry.direction === "DEBIT" ? "−" : "+"}
            {money(entry.amount, entry.currency)}
          </li>
        ))
      ) : (
        <li>No transactions recorded.</li>
      )}
    </ul>
  </Panel>
);

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
      {(overview) => (
        <BankMeetingView overview={overview} bridge={bridge} role={role} refresh={refresh} />
      )}
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
  const [openOrgId, setOpenOrgId] = useState<EntityId | undefined>(undefined);

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
        ? await bridge.applyExecutiveClubLoan(
            overview.clubId,
            lender.id,
            principalAmount,
            termMonths,
            purpose,
          )
        : await bridge.applyClubLoan(lender.id, principalAmount, termMonths, purpose);
    setBusyId(null);
    setMessage(
      result.ok
        ? `${lender.name} ${result.data.status.toLowerCase()} the loan request.`
        : result.error.message,
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
              initiator={{
                name: "You",
                role: role === "CEO" ? "Chief Executive Officer" : "Chairman / Owner",
              }}
              counterpart={{
                name: lender?.name ?? "Lender",
                role: lender ? lender.institutionType.replaceAll("_", " ") : "Bank",
              }}
            />
            {lender && (
              <button className="ghost small" onClick={() => setOpenOrgId(lender.id)}>
                View organization profile
              </button>
            )}
            {openOrgId && (
              <OrganizationProfilePanel
                bridge={bridge}
                entityType="LENDER"
                entityId={openOrgId}
                onClose={() => setOpenOrgId(undefined)}
              />
            )}
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
                <select
                  value={lenderId}
                  onChange={(event) => setLenderId(event.target.value as EntityId)}
                >
                  {overview.lenders.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Principal
                <input
                  type="number"
                  min="1"
                  value={principal}
                  onChange={(event) => setPrincipal(event.target.value)}
                />
              </label>
              <label>
                Term (months)
                <input
                  type="number"
                  min="3"
                  max="60"
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                />
              </label>
              <label>
                Purpose
                <input
                  type="text"
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                />
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
                      <td>
                        {overview.lenders.find((item) => item.id === debt.lenderId)?.name ??
                          debt.lenderType}
                      </td>
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
                            onClick={() =>
                              void repay(
                                debt.id,
                                debt.scheduledPayment ?? debt.outstandingPrincipal,
                              )
                            }
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

const OWNER_PLAYER_REQUEST_LABELS: Record<OwnerPlayerRequestIntent, string> = {
  CONSIDER_TRANSFER_LIST: "Request transfer consideration",
  CONSIDER_LOAN_LIST: "Ask Manager to loan-list",
  CONSIDER_RENEWAL: "Ask Manager to consider renewal",
  REVIEW_SQUAD_ROLE: "Ask Manager to review squad role",
  STRENGTHEN_POSITION: "Ask Manager to strengthen this position",
  CONSIDER_RELEASE: "Ask Manager to consider release",
};
const OWNER_PLAYER_REQUEST_INTENTS = Object.keys(
  OWNER_PLAYER_REQUEST_LABELS,
) as OwnerPlayerRequestIntent[];

const OWNER_MANAGER_COMMITMENT_LABELS: Record<OwnerManagerCommitmentType, string> = {
  PROMOTION_CHALLENGE: "Promotion challenge",
  YOUTH_USAGE: "Youth usage",
  FINANCIAL_DISCIPLINE: "Financial discipline",
  SQUAD_STRENGTHENING: "Squad strengthening",
  FACILITY_PROJECT: "Facility project",
  TACTICAL_STYLE: "Tactical style",
};
const OWNER_MANAGER_COMMITMENT_TYPES = Object.keys(
  OWNER_MANAGER_COMMITMENT_LABELS,
) as OwnerManagerCommitmentType[];

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
const ownerManagerNarrative = (
  overview: OwnerManagerMeetingOverview,
  topic: OwnerManagerMeetingTopic,
): string => {
  const confidenceLine = `Board confidence currently sits at ${overview.boardConfidence}${overview.boardExpectation ? `, with the board expecting ${overview.boardExpectation.replaceAll("_", " ").toLowerCase()}` : ""}.`;
  switch (topic) {
    case "FORM": {
      const form = overview.recentForm.length
        ? overview.recentForm.join("")
        : "no results recorded yet";
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
      if (!overview.vision)
        return "The club has no recorded playing identity yet — this meeting is a chance to set one.";
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
      {(overview) => (
        <OwnerManagerMeetingView overview={overview} bridge={bridge} refresh={refresh} />
      )}
    </AsyncPanel>
  );
};

const OWNER_MANAGER_TERMINAL_STAGES = new Set([
  "ACCEPTED",
  "REJECTED",
  "WALKED_AWAY",
  "COMPLETED",
  "CANCELLED",
]);

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
  const [commitmentType, setCommitmentType] =
    useState<OwnerManagerCommitmentType>("SQUAD_STRENGTHENING");
  const [targetCriteria, setTargetCriteria] = useState("");
  const [description, setDescription] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openManagerId, setOpenManagerId] = useState<EntityId | undefined>(undefined);

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
        label:
          value === "SUPPORT"
            ? "Extend support"
            : value === "REQUEST"
              ? "Ask for improvement"
              : "Raise a concern",
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
            ? [
                {
                  label: "Board pressure on manager",
                  value: overview.pressure,
                  tone: pressureTone(overview.pressure),
                },
              ]
            : []),
          ...(overview.leaguePosition
            ? [
                {
                  label: "League position",
                  value: `${ordinal(overview.leaguePosition)} · ${overview.points ?? 0} pts`,
                },
              ]
            : []),
          {
            label: "Recent form",
            value: overview.recentForm.length ? overview.recentForm.join(" ") : "No results yet",
          },
          ...(overview.activePromises !== undefined
            ? [{ label: "Active promises", value: overview.activePromises }]
            : []),
        ]}
      >
        <MeetingParticipants
          initiator={{ name: "You", role: "Chairman / Owner" }}
          counterpart={{
            name: overview.managerName,
            role: "Manager",
            organisation: overview.clubName,
          }}
        />
        <button className="ghost small" onClick={() => setOpenManagerId(overview.managerPersonId)}>
          View manager profile
        </button>
        {openManagerId && (
          <OrganizationProfilePanel
            bridge={bridge}
            entityType="STAFF"
            entityId={openManagerId}
            onClose={() => setOpenManagerId(undefined)}
          />
        )}
        {!session ? (
          <>
            <MeetingBrief heading="Choose a topic">
              <p>
                Open a meeting with {overview.managerName} to discuss one real, current aspect of
                the club.
              </p>
            </MeetingBrief>
            <div className="inline-form">
              <label>
                Topic
                <select
                  value={topic}
                  onChange={(event) => setTopic(event.target.value as OwnerManagerMeetingTopic)}
                >
                  {OWNER_MANAGER_TOPICS.map((value) => (
                    <option key={value} value={value}>
                      {OWNER_MANAGER_TOPIC_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary small"
                disabled={busyId !== null}
                onClick={() => void openMeeting()}
              >
                {busyId === "open" ? "Opening…" : "Start meeting"}
              </button>
            </div>
          </>
        ) : (
          <>
            <MeetingBrief
              heading={
                OWNER_MANAGER_TOPIC_LABELS[
                  (session.demands.topic as OwnerManagerMeetingTopic) ?? topic
                ]
              }
            >
              <p>
                {ownerManagerNarrative(
                  overview,
                  (session.demands.topic as OwnerManagerMeetingTopic) ?? topic,
                )}
              </p>
            </MeetingBrief>
            <div className="inline-form">
              <label>
                <input
                  type="checkbox"
                  checked={addCommitment}
                  onChange={(event) => setAddCommitment(event.target.checked)}
                />{" "}
                Attach a measurable commitment
              </label>
            </div>
            {addCommitment && (
              <div className="inline-form">
                <label>
                  Commitment type
                  <select
                    value={commitmentType}
                    onChange={(event) =>
                      setCommitmentType(event.target.value as OwnerManagerCommitmentType)
                    }
                  >
                    {OWNER_MANAGER_COMMITMENT_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {OWNER_MANAGER_COMMITMENT_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Target criteria
                  <input
                    type="text"
                    value={targetCriteria}
                    onChange={(event) => setTargetCriteria(event.target.value)}
                    placeholder="e.g. IMPROVE_SQUAD_DEPTH"
                  />
                </label>
                <label>
                  Description
                  <input
                    type="text"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="What is being promised"
                  />
                </label>
                <label>
                  Due on
                  <input
                    type="date"
                    value={dueOn}
                    onChange={(event) => setDueOn(event.target.value)}
                  />
                </label>
              </div>
            )}
            <MeetingOptions
              options={options}
              busyId={busyId}
              onChoose={(id) => void resolve(id as OwnerManagerMeetingStance)}
            />
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
            tone:
              item.stage === "ACCEPTED"
                ? "ok"
                : item.stage === "REJECTED" || item.stage === "WALKED_AWAY"
                  ? "bad"
                  : "info",
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
const MATCH_PERIOD_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  FIRST_HALF: "First half",
  HALF_TIME: "Half time",
  SECOND_HALF: "Second half",
  EXTRA_TIME_FIRST_HALF: "Extra time — first half",
  EXTRA_TIME_HALF_TIME: "Extra time — half time",
  EXTRA_TIME_SECOND_HALF: "Extra time — second half",
  PENALTY_SHOOTOUT: "Penalty shootout",
  FULL_TIME: "Full time",
};
const matchClock = (live: LiveMatchView): string =>
  live.period === "FULL_TIME" || live.period === "NOT_STARTED"
    ? (MATCH_PERIOD_LABEL[live.period] ?? band(live.period))
    : `${live.minute}'${live.stoppageTime > 0 ? `+${live.stoppageTime}` : ""}`;

/** Real goal/card tallies read off the lineup's own player states — never parsed from commentary text. */
const LiveMatchLineup = ({
  team,
  onSelectPlayer,
}: {
  team: LiveMatchView["home"];
  onSelectPlayer: (playerId: EntityId) => void;
}): React.ReactElement => (
  <div>
    <h3>{team.teamName}</h3>
    <ul className="compact-list">
      {team.onPitch.map((player) => (
        <li key={player.personId}>
          <button className="link" onClick={() => onSelectPlayer(player.personId)}>
            {player.name}
          </button>{" "}
          <span className="subtle">
            {player.position} · {player.rating > 0 ? player.rating.toFixed(1) : "—"}
            {player.goals > 0 && ` · ${player.goals} goal${player.goals > 1 ? "s" : ""}`}
            {player.yellowCards > 0 && " · Y"}
            {player.redCard && " · R"}
          </span>
        </li>
      ))}
    </ul>
  </div>
);

const MATCH_EVENT_GROUPS: Record<string, { title: string; types: string[] }> = {
  goals: { title: "Goals", types: ["GOAL", "OWN_GOAL"] },
  cards: { title: "Cards", types: ["YELLOW_CARD", "SECOND_YELLOW", "RED_CARD"] },
  subs: { title: "Substitutions", types: ["SUBSTITUTION"] },
};

const eventParticipantLabel = (
  event: StructuredMatchEvent,
  role: MatchEventParticipant["role"],
): MatchEventParticipant | undefined =>
  event.participants.find((participant) => participant.role === role);

/**
 * One event, rendered from its real typed participants (never parsed from
 * commentary text) — a scorer/assist pair for a goal, on/off pair for a
 * substitution, or the carded/injured player otherwise. Each name opens the
 * real Player Context Panel.
 */
const MatchEventRow = ({
  event,
  onSelectPlayer,
}: {
  event: StructuredMatchEvent;
  onSelectPlayer: (playerId: EntityId) => void;
}): React.ReactElement => {
  const nameButton = (participant: MatchEventParticipant, key: string): React.ReactElement => (
    <button key={key} className="link" onClick={() => onSelectPlayer(participant.personId)}>
      {participant.reference.label}
    </button>
  );
  const scorer = eventParticipantLabel(event, "SCORER");
  const assist = eventParticipantLabel(event, "ASSIST");
  const on = eventParticipantLabel(event, "PLAYER_ON");
  const off = eventParticipantLabel(event, "PLAYER_OFF");
  const plain = eventParticipantLabel(event, "PLAYER");
  return (
    <li>
      {event.minute !== undefined ? `${event.minute}' ` : ""}
      {event.type === "SUBSTITUTION" && on && off ? (
        <>
          {nameButton(on, "on")} on for {nameButton(off, "off")}
        </>
      ) : scorer ? (
        <>
          {nameButton(scorer, "scorer")}
          {assist && <> (assist: {nameButton(assist, "assist")})</>}
          {event.type === "OWN_GOAL" && " — own goal"}
        </>
      ) : plain ? (
        nameButton(plain, "plain")
      ) : (
        <span className="subtle">{band(event.type)}</span>
      )}
    </li>
  );
};

const MatchEventsPanel = ({
  live,
  onSelectPlayer,
}: {
  live: LiveMatchView;
  onSelectPlayer: (playerId: EntityId) => void;
}): React.ReactElement => (
  <>
    {Object.values(MATCH_EVENT_GROUPS).map((group) => {
      const events = live.structuredEvents.filter((event) => group.types.includes(event.type));
      if (events.length === 0) return null;
      return (
        <div className="action-group" key={group.title}>
          <h3>{group.title}</h3>
          <ul className="compact-list">
            {events.map((event) => (
              <MatchEventRow key={event.eventId} event={event} onSelectPlayer={onSelectPlayer} />
            ))}
          </ul>
        </div>
      );
    })}
    {live.injuryDecisions.length > 0 && (
      <div className="action-group">
        <h3>Injuries</h3>
        <ul className="compact-list">
          {live.injuryDecisions.map((player) => (
            <li key={player.personId}>
              <button className="link" onClick={() => onSelectPlayer(player.personId)}>
                {player.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    )}
    <div className="action-group">
      <h3>Commentary</h3>
      {live.commentary.length === 0 ? (
        <p className="empty-state">No commentary recorded yet.</p>
      ) : (
        <ul className="compact-list">
          {live.commentary.slice(-12).map((line) => (
            <li key={line.eventId}>
              {line.minute !== undefined ? `${line.minute}' ` : ""}
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  </>
);

const BoardroomContext = ({
  overview,
}: {
  overview: OwnerManagerMeetingOverview;
}): React.ReactElement => (
  <Panel title="Boardroom context">
    <Metrics
      items={[
        { label: "Manager", value: overview.managerName },
        { label: "Board confidence", value: overview.boardConfidence },
        ...(overview.boardExpectation
          ? [{ label: "Board expects", value: band(overview.boardExpectation) }]
          : []),
        ...(overview.pressure
          ? [
              {
                label: "Pressure on manager",
                value: (
                  <Badge tone={pressureTone(overview.pressure)}>{band(overview.pressure)}</Badge>
                ),
              },
            ]
          : []),
      ]}
    />
    {overview.recentForm.length > 0 && (
      <p className="subtle">Recent form: {overview.recentForm.slice(-5).join(" ")}</p>
    )}
  </Panel>
);

export const OwnerMatchday = ({
  bridge,
  onTalkToManager,
}: {
  bridge: DesktopRuntimeApi;
  onTalkToManager?: () => void;
}): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getOwnerMatchday());
  const [overviewState] = useRuntimeData(() => bridge.getOwnerManagerMeeting());
  const [live, setLive] = useState<LiveMatchView | null>(null);
  const [mode, setMode] = useState<"TEXT_LIVE" | "KEY_EVENTS">("TEXT_LIVE");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<EntityId | null>(null);
  const [suggestion, setSuggestion] = useState<{
    loaded: boolean;
    data?: OwnerPostMatchSuggestion;
  }>({ loaded: false });

  const loadSuggestion = async (): Promise<void> => {
    const result = await bridge.getOwnerPostMatchSuggestion();
    setSuggestion({ loaded: true, data: result.ok ? result.data : undefined });
  };

  const applyProgress = (
    result: Awaited<ReturnType<typeof bridge.watchOwnerFixture>>,
    refreshList: boolean,
  ): void => {
    if (result.ok) {
      setLive(result.data);
      if (result.data.finalized) {
        void loadSuggestion();
        refresh();
      } else if (refreshList) refresh();
    } else setMessage(result.error.message);
  };

  const watch = async (fixtureId: EntityId): Promise<void> => {
    setBusy(`watch:${fixtureId}`);
    setMessage(null);
    setSuggestion({ loaded: false });
    const result = await bridge.watchOwnerFixture(fixtureId);
    setBusy(null);
    applyProgress(result, false);
  };

  const quickSim = async (fixtureId: EntityId): Promise<void> => {
    setBusy(`sim:${fixtureId}`);
    setMessage(null);
    setSuggestion({ loaded: false });
    const result = await bridge.quickSimOwnerFixture(fixtureId);
    setBusy(null);
    applyProgress(result, true);
    if (result.ok) setMessage("Match simulated.");
  };

  const advance = async (): Promise<void> => {
    if (!live || live.finalized) return;
    setBusy("advance");
    const command =
      mode === "KEY_EVENTS"
        ? { toNextEvent: true, minImportance: "NOTABLE" as const }
        : { minutes: 5 };
    const result = await bridge.advanceOwnerFixture(command, live.fixtureId, mode);
    setBusy(null);
    applyProgress(result, false);
  };

  const fastForward = async (): Promise<void> => {
    if (!live || live.finalized) return;
    setBusy("fast");
    const command = ["FIRST_HALF", "EXTRA_TIME_FIRST_HALF"].includes(live.period)
      ? { toHalfTime: true }
      : { minutes: 45 };
    const result = await bridge.advanceOwnerFixture(command, live.fixtureId, mode);
    setBusy(null);
    applyProgress(result, false);
  };

  const continueSecondHalf = async (): Promise<void> => {
    if (!live) return;
    setBusy("continue");
    const result = await bridge.continueOwnerFixture(live.fixtureId, mode);
    setBusy(null);
    applyProgress(result, false);
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
                      {
                        label: "League position",
                        value: ordinal(matchday.positionContext.position),
                      },
                      { label: "Played", value: matchday.positionContext.played },
                      { label: "Points", value: matchday.positionContext.points },
                    ]
                  : []
              }
            />
          </Panel>
          {overviewState.status === "ready" && <BoardroomContext overview={overviewState.data} />}
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          {selectedPlayerId && (
            <PlayerContextPanel
              bridge={bridge}
              playerId={selectedPlayerId}
              onClose={() => setSelectedPlayerId(null)}
              onTalkToManager={onTalkToManager}
            />
          )}

          {!live?.finalized && (
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
                        <th>Venue</th>
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
                          <td>{fixture.venue ?? "—"}</td>
                          <td>
                            <span className="button-row">
                              <button
                                className="primary small"
                                disabled={busy !== null}
                                onClick={() => void watch(fixture.id)}
                              >
                                {busy === `watch:${fixture.id}` ? "Opening…" : "Watch"}
                              </button>
                              <button
                                className="ghost small"
                                disabled={busy !== null}
                                onClick={() => void quickSim(fixture.id)}
                              >
                                {busy === `sim:${fixture.id}` ? "Simulating…" : "Quick sim"}
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
          )}

          {live && (
            <Panel title="Match" className="panel-wide">
              <div className="match-clock-header">
                <div className="match-clock-score">
                  <strong>{live.home.teamName}</strong>
                  <span className="match-clock-goals">
                    {live.home.goals} – {live.away.goals}
                  </span>
                  <strong>{live.away.teamName}</strong>
                </div>
                <Metrics
                  items={[
                    { label: "Status", value: matchClock(live) },
                    { label: "Competition", value: live.competitionName },
                    ...(live.venue ? [{ label: "Venue", value: live.venue }] : []),
                    ...(live.attendance !== undefined
                      ? [{ label: "Attendance", value: live.attendance.toLocaleString() }]
                      : []),
                  ]}
                />
              </div>

              {live.period === "HALF_TIME" || live.period === "EXTRA_TIME_HALF_TIME" ? (
                <>
                  <p className="subtle">Half time — no tactical options for the Owner.</p>
                  <MatchEventsPanel live={live} onSelectPlayer={setSelectedPlayerId} />
                  <button
                    className="primary small"
                    disabled={busy !== null}
                    onClick={() => void continueSecondHalf()}
                  >
                    {busy === "continue" ? "Continuing…" : "Continue second half"}
                  </button>
                </>
              ) : live.finalized ? (
                <>
                  <p>
                    <Badge tone={live.home.goals === live.away.goals ? "info" : "ok"}>
                      Full time
                    </Badge>
                  </p>
                  <MatchEventsPanel live={live} onSelectPlayer={setSelectedPlayerId} />
                  <div className="summary-grid">
                    <LiveMatchLineup team={live.home} onSelectPlayer={setSelectedPlayerId} />
                    <LiveMatchLineup team={live.away} onSelectPlayer={setSelectedPlayerId} />
                  </div>
                  {suggestion.loaded && suggestion.data && (
                    <div className="action-group boardroom-followup">
                      <h3>Boardroom follow-up</h3>
                      <p className="subtle">{suggestion.data.reason}</p>
                      {onTalkToManager && (
                        <button className="ghost small" onClick={onTalkToManager}>
                          Talk to Manager
                        </button>
                      )}
                    </div>
                  )}
                  {/* Results/fixtures already refreshed the instant the match
                      finalised (applyProgress above) — this only clears the
                      local match-summary view so the Owner has an explicit
                      way back to Next fixture / Recent results instead of
                      having to navigate to another screen and back. */}
                  <button className="ghost small" onClick={() => setLive(null)}>
                    Back to fixtures
                  </button>
                </>
              ) : (
                <>
                  <div className="button-row">
                    <button
                      className={mode === "TEXT_LIVE" ? "primary small" : "ghost small"}
                      onClick={() => setMode("TEXT_LIVE")}
                    >
                      Text Live
                    </button>
                    <button
                      className={mode === "KEY_EVENTS" ? "primary small" : "ghost small"}
                      onClick={() => setMode("KEY_EVENTS")}
                    >
                      Key Events
                    </button>
                  </div>
                  <MatchEventsPanel live={live} onSelectPlayer={setSelectedPlayerId} />
                  <div className="button-row">
                    <button
                      className="primary small"
                      disabled={busy !== null}
                      onClick={() => void advance()}
                    >
                      {busy === "advance"
                        ? "Advancing…"
                        : mode === "KEY_EVENTS"
                          ? "Next key event"
                          : "Advance 5 minutes"}
                    </button>
                    <button
                      className="ghost small"
                      disabled={busy !== null}
                      onClick={() => void fastForward()}
                    >
                      {busy === "fast"
                        ? "Fast forwarding…"
                        : ["FIRST_HALF", "EXTRA_TIME_FIRST_HALF"].includes(live.period)
                          ? "Skip to half time"
                          : "Fast forward"}
                    </button>
                  </div>
                  <div className="summary-grid">
                    <LiveMatchLineup team={live.home} onSelectPlayer={setSelectedPlayerId} />
                    <LiveMatchLineup team={live.away} onSelectPlayer={setSelectedPlayerId} />
                  </div>
                </>
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

/*
 * DEEP FACILITY / INFRASTRUCTURE PLANNER
 *
 * Everything here reads and writes through the canonical project engine
 * (getFacilityPlanning / getFacilitySiteOptions / createFacilityProjectPlan)
 * — no parallel facility state, no invented component/scope vocabulary.
 * The pre-commit "Review project" step calls createFacilityProjectPlan with
 * dryRun so its cost/duration bands come from the real formula without
 * writing anything; "Confirm & create project" repeats the same call
 * without dryRun to actually persist it.
 */

const FACILITY_PROJECT_TYPES: Array<{ type: InfrastructureProjectType; label: string }> = [
  { type: "TRAINING_GROUND", label: "Training ground" },
  { type: "ACADEMY", label: "Academy" },
  { type: "STADIUM", label: "Stadium / ground" },
];
const FACILITY_MODE_LABELS: Record<FacilityProjectMode, string> = {
  UPGRADE_EXISTING: "Upgrade existing",
  NEW_SITE: "New site",
};
const FACILITY_SCOPE_LABELS: Record<FacilityProjectScope, string> = {
  BASIC: "Modest",
  STANDARD: "Standard",
  EXPANDED: "Advanced",
  ELITE: "Elite",
};
const FACILITY_SCOPE_HINT: Record<FacilityProjectScope, string> = {
  BASIC: "A lean, low-cost approach — the fastest and cheapest option.",
  STANDARD: "The club's normal standard.",
  EXPANDED: "A larger, more ambitious build than standard.",
  ELITE: "Top-tier investment — the highest cost and the longest build.",
};
const FACILITY_FUNDING_LABELS: Record<FacilityFundingSource, string> = {
  CLUB_CASH: "Club cash",
  DEBT: "Loan (adds club debt)",
  GOVERNMENT_GRANT: "Government grant / co-funding",
  MIXED: "Mixed (club cash + loan)",
};
const FACILITY_STATUS_LABEL: Record<InfrastructureProject["status"], string> = {
  IDEA: "Idea",
  PLANNING: "Planning",
  APPROVED: "Approved",
  FINANCING: "Awaiting financing",
  CONSTRUCTION: "Under construction",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
const FACILITY_STATUS_TONE: Record<InfrastructureProject["status"], MeetingTone> = {
  IDEA: "info",
  PLANNING: "info",
  APPROVED: "info",
  FINANCING: "warn",
  CONSTRUCTION: "warn",
  COMPLETED: "ok",
  CANCELLED: "bad",
};
const band = (value: string): string => value.replaceAll("_", " ").toLowerCase();
/** Equipment effect keys are camelCase (e.g. "trainingEffectiveness") — split
 * them into words the same way band() reads SNAKE_CASE, rather than showing
 * the raw key. */
const effectLabel = (key: string): string => key.replace(/([A-Z])/g, " $1").trim().toLowerCase();

/**
 * Generated from real, already-fetched state only: which project types this
 * club already has (and their status), the chosen site's real bands, scope,
 * funding source, and any real outstanding manager facility request. Never
 * asserts a specific engineering fact that isn't backed by one of these
 * fields.
 */
const facilityNarrative = (input: {
  projectType: InfrastructureProjectType;
  mode: FacilityProjectMode;
  scope: FacilityProjectScope;
  existing: InfrastructureProject[];
  site?: FacilitySiteOption;
  fundingSource: FacilityFundingSource;
  managerRequests: ManagerPromise[];
}): string => {
  const typeLabel = (
    FACILITY_PROJECT_TYPES.find((item) => item.type === input.projectType)?.label ??
    band(input.projectType)
  ).toLowerCase();
  const sameType = input.existing.filter((project) => project.projectType === input.projectType);
  const active = sameType.find((project) => !["COMPLETED", "CANCELLED"].includes(project.status));
  const completed = sameType.find((project) => project.status === "COMPLETED");
  const sentences: string[] = [];
  if (active)
    sentences.push(
      `A ${typeLabel} project is already ${FACILITY_STATUS_LABEL[active.status].toLowerCase()} for this club.`,
    );
  else if (completed)
    sentences.push(
      `The club already has a completed ${typeLabel}; this would be a further upgrade.`,
    );
  else sentences.push(`The club has no dedicated ${typeLabel} on record yet.`);
  if (input.mode === "NEW_SITE") {
    sentences.push(
      input.site
        ? `A new-site project at ${input.site.municipalityName} (${band(input.site.siteType)}, ${input.site.arrangement.toLowerCase()}) provides room to build from scratch, at a larger upfront commitment than upgrading what already exists.`
        : "A new-site project provides room to build from scratch, at a larger upfront commitment than upgrading what already exists.",
    );
    if (input.site?.readiness === "GOVERNMENT_REVIEW")
      sentences.push("This site requires municipal/government approval before work can begin.");
  } else {
    sentences.push(
      "Upgrading the existing site keeps costs and disruption lower than starting fresh.",
    );
  }
  if (input.scope === "ELITE")
    sentences.push("An elite scope is a significant investment with the longest build time.");
  else if (input.scope === "BASIC")
    sentences.push("A modest scope keeps this affordable but limits how much it improves things.");
  if (input.fundingSource === "DEBT" || input.fundingSource === "MIXED")
    sentences.push(
      "Financing with a loan adds to the club's debt rather than drawing down cash reserves.",
    );
  if (input.fundingSource === "GOVERNMENT_GRANT")
    sentences.push("Government co-funding is contingent on approval and is not guaranteed.");
  // Only claim this plan responds to a manager request when the request's
  // own text actually mentions this project type — never attach an
  // unrelated request just because one happens to exist.
  const typeKeywords: Record<InfrastructureProjectType, string[]> = {
    TRAINING_GROUND: ["training"],
    ACADEMY: ["academy", "youth"],
    STADIUM: ["stadium", "ground", "stand"],
    GYM: ["gym"],
    MEDICAL_ROOM: ["medical"],
    RECOVERY_CENTRE: ["recovery", "medical"],
    OFFICE: ["office"],
    SCOUTING_DEPARTMENT: ["scouting"],
    ANALYSIS_ROOM: ["analysis"],
    STAND: ["stand", "stadium"],
    FLOODLIGHTS: ["floodlight"],
    PITCH: ["pitch"],
    DRAINAGE: ["drainage"],
    REFURBISHMENT: ["refurbish"],
  };
  const keywords = typeKeywords[input.projectType] ?? [];
  const request = input.managerRequests.find((item) =>
    keywords.some((keyword) =>
      `${item.description} ${item.targetCriteria}`.toLowerCase().includes(keyword),
    ),
  );
  if (request)
    sentences.push(
      `This would respond to an outstanding request from the manager: "${request.description}"${request.dueOn ? ` (due ${request.dueOn})` : ""}.`,
    );
  return sentences.join(" ");
};

const GOVERNMENT_NEXT_ACTION_LABEL: Record<ClubInfrastructureGovernmentContext["nextAction"], string> = {
  OPEN_REQUEST: "Open a government support request to proceed.",
  WAIT_FOR_REVIEW: "Awaiting the institution's review — no further action is needed yet.",
  START_PROJECT: "Approved — this site is ready to plan.",
  NONE: "",
};

/**
 * Facility Planner's government-support integration
 * (getClubInfrastructureGovernmentContext / openClubInfrastructureGovernmentRequest,
 * f70fe5d/6c6cbdb) — replaces the former dead-end message for a
 * GOVERNMENT_REVIEW site.
 *
 * Real, confirmed backend gap this works within rather than around: no
 * command lets an Owner/CEO discover a real GovernmentInstitution id —
 * getGovernmentOverview (the only institution listing) is
 * FEDERATION_PRESIDENT-gated, and no institution is ever seeded anywhere
 * except once a year (August) via the federation's own
 * proposeAnnualGovernmentFunding cadence. So a club with no prior
 * government application has no real institution to submit against —
 * submission below only enables once at least one real application already
 * exists for this club, whose real institution id is then known and reused.
 * See CODEX_UI_BRIDGE_NEEDED in the commit message.
 */
const GovernmentSupportPanel = ({
  bridge,
  clubId,
  projectType,
  planning,
  refresh,
}: {
  bridge: DesktopRuntimeApi;
  clubId: EntityId;
  projectType: InfrastructureProjectType;
  planning: FacilityPlanningView;
  refresh: () => void;
}): React.ReactElement => {
  const applications = [...planning.governmentApplications].sort((a, b) =>
    `${b.proposedOn}:${b.id}`.localeCompare(`${a.proposedOn}:${a.id}`),
  );
  const current =
    applications.find((application) => LAND_FUNDING_TYPES.includes(application.fundingType)) ??
    applications[0];
  const knownInstitutionId = current?.institutionId;

  const [context, setContext] = useState<ClubInfrastructureGovernmentContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  useEffect(() => {
    if (!current?.projectId || !bridge.getClubInfrastructureGovernmentContext) {
      setContext(null);
      return;
    }
    let cancelled = false;
    void bridge.getClubInfrastructureGovernmentContext(current.projectId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setContext(result.data);
        setContextError(null);
      } else setContextError(result.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [current?.projectId]);

  const [institutionName, setInstitutionName] = useState<string | undefined>();
  useEffect(() => {
    if (!knownInstitutionId) {
      setInstitutionName(undefined);
      return;
    }
    let cancelled = false;
    void bridge.getEntityReference("GOVERNMENT_INSTITUTION", knownInstitutionId).then((result) => {
      if (!cancelled && result.ok && result.data.visible) setInstitutionName(result.data.label);
    });
    return () => {
      cancelled = true;
    };
  }, [knownInstitutionId]);

  const [fundingType, setFundingType] = useState<
    "INFRASTRUCTURE" | "REGIONAL_GROUND" | "MUNICIPAL_LAND_OR_VENUE"
  >("MUNICIPAL_LAND_OR_VENUE");
  const [amount, setAmount] = useState("2000000");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const openNonTerminal = applications.find(
    (application) => !["REJECTED", "COMPLETED"].includes(application.status),
  );
  const canOpenNew = Boolean(knownInstitutionId) && !openNonTerminal;

  const submit = async (): Promise<void> => {
    if (!knownInstitutionId) return;
    const requestedAmount = Number(amount);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) return;
    setBusy(true);
    setMessage(null);
    // No existing project anchors this brand-new request yet — a plain
    // project (the same real createInfrastructureProject command the
    // Owner dashboard's own "Order..." actions already use) is created
    // first so the request has a real projectId to attach to, exactly as
    // requestClubInfrastructureGovernmentSupport requires.
    if (!bridge.openClubInfrastructureGovernmentRequest) {
      setBusy(false);
      setMessage("Government support requests are unavailable right now.");
      return;
    }
    const projectResult = await bridge.createInfrastructureProject(clubId, projectType);
    if (!projectResult.ok) {
      setBusy(false);
      setMessage(projectResult.error.message);
      return;
    }
    const result = await bridge.openClubInfrastructureGovernmentRequest({
      projectId: projectResult.data.id,
      institutionId: knownInstitutionId,
      fundingType,
      requestedAmount,
    });
    setBusy(false);
    setConfirming(false);
    setMessage(
      result.ok
        ? `Government support request submitted for ${money(requestedAmount)}.`
        : result.error.message,
    );
    if (result.ok) refresh();
  };

  return (
    <Panel title="Government support">
      {!current ? (
        <>
          <p className="empty-state">
            No government support request has been opened for this club yet.
          </p>
          {!knownInstitutionId && (
            <p className="subtle">
              No government institution has engaged with this club yet — support requests become
              available once one has.
            </p>
          )}
        </>
      ) : (
        <>
          <Metrics
            items={[
              { label: "Institution", value: institutionName ?? "Unknown institution" },
              { label: "Request type", value: FUNDING_TYPE_LABELS[current.fundingType] },
              {
                label: "Status",
                value: (
                  <Badge tone={applicationStatusTone(current.status)}>
                    {applicationStatusLabel(current.status)}
                  </Badge>
                ),
              },
              { label: "Requested support", value: money(current.requestedAmount) },
              ...(current.approvedAmount !== undefined
                ? [{ label: "Approved support", value: money(current.approvedAmount) }]
                : []),
              { label: "Submitted", value: current.proposedOn },
              ...(current.decidedOn ? [{ label: "Decided", value: current.decidedOn }] : []),
            ]}
          />
          {current.conditions.length > 0 && (
            <p className="subtle">Conditions: {current.conditions.join(", ")}</p>
          )}
          {context && (
            <Metrics
              items={[
                {
                  label: "Site readiness",
                  value: context.siteReadiness ? band(context.siteReadiness) : "—",
                },
                {
                  label: "Settlement",
                  value: (
                    <Badge tone={context.fundingSettled ? "ok" : "info"}>
                      {context.fundingSettled ? "Settled to club ledger" : "Not yet settled"}
                    </Badge>
                  ),
                },
              ]}
            />
          )}
          {context?.nextAction && GOVERNMENT_NEXT_ACTION_LABEL[context.nextAction] && (
            <p className="subtle">{GOVERNMENT_NEXT_ACTION_LABEL[context.nextAction]}</p>
          )}
          {context?.blockedReason && <p className="empty-state">{context.blockedReason}</p>}
          {contextError && <p className="subtle">{contextError}</p>}
        </>
      )}
      {canOpenNew && !confirming && (
        <button className="ghost small" onClick={() => setConfirming(true)}>
          Open government request
        </button>
      )}
      {canOpenNew && confirming && (
        <div className="inline-form">
          <label>
            Purpose
            <select
              value={fundingType}
              onChange={(event) => setFundingType(event.target.value as typeof fundingType)}
            >
              {LAND_FUNDING_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FUNDING_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Requested amount
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <div className="button-row">
            <button
              className="primary small"
              disabled={busy || !Number.isFinite(Number(amount)) || Number(amount) <= 0}
              onClick={() => void submit()}
            >
              {busy ? "Submitting…" : "Confirm request"}
            </button>
            <button className="ghost small" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {openNonTerminal && (
        <p className="subtle">
          A government support request is already{" "}
          {applicationStatusLabel(openNonTerminal.status).toLowerCase()} for this club — a new one
          cannot be opened until it is resolved.
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </Panel>
  );
};

export const FacilityPlanner = ({
  bridge,
  clubId,
}: {
  bridge: DesktopRuntimeApi;
  clubId: EntityId;
}): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getFacilityPlanning(clubId), [clubId]);
  return (
    <AsyncPanel state={state}>
      {(planning) => (
        <FacilityPlannerView
          planning={planning}
          bridge={bridge}
          clubId={clubId}
          refresh={refresh}
        />
      )}
    </AsyncPanel>
  );
};

const FacilityPlannerView = ({
  planning,
  bridge,
  clubId,
  refresh,
}: {
  planning: FacilityPlanningView;
  bridge: DesktopRuntimeApi;
  clubId: EntityId;
  refresh: () => void;
}): React.ReactElement => {
  const [projectType, setProjectType] = useState<InfrastructureProjectType>("TRAINING_GROUND");
  const [mode, setMode] = useState<FacilityProjectMode>("UPGRADE_EXISTING");
  const [scope, setScope] = useState<FacilityProjectScope>("STANDARD");
  const catalog = planning.componentCatalog[projectType] ?? [];
  const [components, setComponents] = useState<string[]>([...catalog]);
  useEffect(
    () => setComponents([...(planning.componentCatalog[projectType] ?? [])]),
    [projectType, planning.componentCatalog],
  );
  const [siteOptions, setSiteOptions] = useState<FacilitySiteOption[] | null>(null);
  const [siteOptionId, setSiteOptionId] = useState<EntityId | undefined>(undefined);
  const [fundingSource, setFundingSource] = useState<FacilityFundingSource>("CLUB_CASH");
  const [debtAmount, setDebtAmount] = useState("1000000");
  const [grantAmount, setGrantAmount] = useState("1000000");
  const [cashAmount, setCashAmount] = useState("1000000");
  const [preview, setPreview] = useState<FacilityProjectPlanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const selectedSite = siteOptions?.find((site) => site.id === siteOptionId);
  const approvedApplication = planning.governmentApplications.find((application) =>
    ["APPROVED", "CONDITIONAL"].includes(application.status),
  );
  const blockedByGovernment =
    mode === "NEW_SITE" && selectedSite?.readiness === "GOVERNMENT_REVIEW" && !approvedApplication;
  const financing: Record<string, number> | undefined =
    fundingSource === "CLUB_CASH"
      ? undefined
      : fundingSource === "DEBT"
        ? { debt: Number(debtAmount) || 0 }
        : fundingSource === "GOVERNMENT_GRANT"
          ? { governmentGrant: Number(grantAmount) || 0 }
          : { clubCash: Number(cashAmount) || 0, debt: Number(debtAmount) || 0 };

  const loadSites = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await bridge.getFacilitySiteOptions(clubId);
    setBusy(false);
    if (result.ok) setSiteOptions(result.data);
    else setError(result.error);
  };

  const rationale = facilityNarrative({
    projectType,
    mode,
    scope,
    existing: planning.projects,
    site: selectedSite,
    fundingSource,
    managerRequests: planning.managerFacilityRequests,
  });

  const buildInput = (dryRun: boolean): FacilityProjectPlanInput => ({
    clubId,
    projectType,
    mode,
    scope,
    components,
    siteOptionId: mode === "NEW_SITE" ? siteOptionId : undefined,
    fundingSource,
    financing,
    governmentApplicationId:
      selectedSite?.readiness === "GOVERNMENT_REVIEW" ? approvedApplication?.id : undefined,
    rationale,
    dryRun,
  });

  const review = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await bridge.createFacilityProjectPlan(buildInput(true));
    setBusy(false);
    if (result.ok) setPreview(result.data);
    else setError(result.error);
  };

  const confirm = async (): Promise<void> => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const result = await bridge.createFacilityProjectPlan(buildInput(false));
    setBusy(false);
    if (result.ok) {
      const typeLabel =
        FACILITY_PROJECT_TYPES.find((item) => item.type === projectType)?.label ?? projectType;
      setMessage(
        `${typeLabel} project created — ${band(result.data.plan.costBand)} cost, ${band(result.data.plan.durationBand)} duration.`,
      );
      setPreview(null);
      setSiteOptions(null);
      setSiteOptionId(undefined);
      refresh();
    } else setError(result.error);
  };

  return (
    <section className="role-detail facility-planner">
      {error && <ErrorBanner error={error} />}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}

      <FacilityLifecycle planning={planning} />

      {planning.managerFacilityRequests.length > 0 && (
        <Panel title="Manager facility requests">
          <p className="subtle">
            The manager has raised these through a board meeting — the plan below can respond to
            one.
          </p>
          <ul className="compact-list">
            {planning.managerFacilityRequests.map((promise) => (
              <li key={promise.id}>
                {promise.description} · due {promise.dueOn}
                {promise.status === "AT_RISK" && <Badge tone="warn">At risk</Badge>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {!preview ? (
        <Panel title="Plan a new facility project" className="panel-wide">
          <div className="facility-form-grid">
            <label>
              Project type
              <select
                value={projectType}
                onChange={(event) => {
                  setProjectType(event.target.value as InfrastructureProjectType);
                  setSiteOptions(null);
                  setSiteOptionId(undefined);
                }}
              >
                {FACILITY_PROJECT_TYPES.map((item) => (
                  <option key={item.type} value={item.type}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Strategy
              <select
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value as FacilityProjectMode);
                  setSiteOptionId(undefined);
                }}
              >
                {(Object.keys(FACILITY_MODE_LABELS) as FacilityProjectMode[]).map((item) => (
                  <option key={item} value={item}>
                    {FACILITY_MODE_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scope
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value as FacilityProjectScope)}
              >
                {(Object.keys(FACILITY_SCOPE_LABELS) as FacilityProjectScope[]).map((item) => (
                  <option key={item} value={item}>
                    {FACILITY_SCOPE_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="subtle">{FACILITY_SCOPE_HINT[scope]}</p>

          {catalog.length > 0 && (
            <fieldset className="facility-components">
              <legend>Components</legend>
              <div className="component-tiles">
                {catalog.map((component) => (
                  <label
                    key={component}
                    className={
                      components.includes(component) ? "component-tile selected" : "component-tile"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={components.includes(component)}
                      onChange={(event) =>
                        setComponents(
                          event.target.checked
                            ? [...components, component]
                            : components.filter((item) => item !== component),
                        )
                      }
                    />
                    {band(component)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {mode === "NEW_SITE" && (
            <div className="facility-site-step">
              <h3>Site</h3>
              {!planning.homeDistrict ? (
                <p className="empty-state">
                  This club has no district on record to site a new project in.
                </p>
              ) : !siteOptions ? (
                <button className="small" disabled={busy} onClick={() => void loadSites()}>
                  {busy
                    ? "Generating…"
                    : `Generate site options near ${planning.homeDistrict.districtName}`}
                </button>
              ) : (
                <div className="site-cards">
                  {siteOptions.map((site) => (
                    <label
                      key={site.id}
                      className={siteOptionId === site.id ? "site-card selected" : "site-card"}
                    >
                      <input
                        type="radio"
                        name="facility-site"
                        checked={siteOptionId === site.id}
                        onChange={() => setSiteOptionId(site.id)}
                      />
                      <strong>
                        {site.municipalityName} · {band(site.siteType)}
                      </strong>
                      <span className="subtle">
                        Simulation-only project option, not a verified land listing.
                      </span>
                      <Metrics
                        items={[
                          { label: "Arrangement", value: site.arrangement.toLowerCase() },
                          { label: "Cost", value: site.costBand.toLowerCase() },
                          { label: "Accessibility", value: site.accessibilityBand.toLowerCase() },
                          { label: "Catchment", value: site.catchmentBand.toLowerCase() },
                          {
                            label: "Community value",
                            value: site.communityValueBand.toLowerCase(),
                          },
                          { label: "Readiness", value: band(site.readiness) },
                        ]}
                      />
                      {site.governmentConditions.length > 0 && (
                        <p className="subtle">Conditions: {site.governmentConditions.join(", ")}</p>
                      )}
                    </label>
                  ))}
                </div>
              )}
              {selectedSite?.readiness === "GOVERNMENT_REVIEW" && (
                <>
                  <p className={blockedByGovernment ? "warning" : "notice"} role={blockedByGovernment ? "alert" : "status"}>
                    {blockedByGovernment
                      ? "This site requires government approval before planning can proceed."
                      : "This site's government application has been approved and can be used for this plan."}
                  </p>
                  <GovernmentSupportPanel
                    bridge={bridge}
                    clubId={clubId}
                    projectType={projectType}
                    planning={planning}
                    refresh={refresh}
                  />
                </>
              )}
            </div>
          )}

          <div className="facility-funding-step">
            <h3>Funding</h3>
            <label>
              Source
              <select
                value={fundingSource}
                onChange={(event) => setFundingSource(event.target.value as FacilityFundingSource)}
              >
                {(Object.keys(FACILITY_FUNDING_LABELS) as FacilityFundingSource[]).map((item) => (
                  <option key={item} value={item}>
                    {FACILITY_FUNDING_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
            {fundingSource === "CLUB_CASH" && (
              <p className="subtle">Funded in full from club cash, if the club can afford it.</p>
            )}
            {fundingSource === "DEBT" && (
              <label>
                Loan amount (NPR)
                <input
                  type="number"
                  min="0"
                  value={debtAmount}
                  onChange={(event) => setDebtAmount(event.target.value)}
                />
              </label>
            )}
            {fundingSource === "GOVERNMENT_GRANT" && (
              <label>
                Expected grant amount (NPR)
                <input
                  type="number"
                  min="0"
                  value={grantAmount}
                  onChange={(event) => setGrantAmount(event.target.value)}
                />
              </label>
            )}
            {fundingSource === "MIXED" && (
              <>
                <label>
                  Club cash (NPR)
                  <input
                    type="number"
                    min="0"
                    value={cashAmount}
                    onChange={(event) => setCashAmount(event.target.value)}
                  />
                </label>
                <label>
                  Loan amount (NPR)
                  <input
                    type="number"
                    min="0"
                    value={debtAmount}
                    onChange={(event) => setDebtAmount(event.target.value)}
                  />
                </label>
              </>
            )}
            <p className="subtle">
              Club cash and loans are both club money — a loan adds to the club's debt. Personal
              funds are separate: inject owner capital from Investors first if you want to fund this
              from your own money.
            </p>
          </div>

          <button
            className="primary"
            disabled={busy || (mode === "NEW_SITE" && (!siteOptionId || blockedByGovernment))}
            onClick={() => void review()}
          >
            {busy ? "Reviewing…" : "Review project"}
          </button>
        </Panel>
      ) : (
        <FacilitySummary
          preview={preview}
          rationale={rationale}
          fundingSource={fundingSource}
          financing={financing}
          site={selectedSite}
          busy={busy}
          onBack={() => setPreview(null)}
          onConfirm={() => void confirm()}
        />
      )}
    </section>
  );
};

const FacilitySummary = ({
  preview,
  rationale,
  fundingSource,
  financing,
  site,
  busy,
  onBack,
  onConfirm,
}: {
  preview: FacilityProjectPlanResult;
  rationale: string;
  fundingSource: FacilityFundingSource;
  financing?: Record<string, number>;
  site?: FacilitySiteOption;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}): React.ReactElement => {
  const { project, plan } = preview;
  return (
    <Panel
      title="Project summary — review before committing"
      className="panel-wide facility-summary"
    >
      <p>{rationale}</p>
      <Metrics
        items={[
          {
            label: "Project type",
            value:
              FACILITY_PROJECT_TYPES.find((item) => item.type === plan.projectType)?.label ??
              plan.projectType,
          },
          { label: "Strategy", value: FACILITY_MODE_LABELS[plan.mode] },
          { label: "Scope", value: FACILITY_SCOPE_LABELS[plan.scope] },
          { label: "Estimated cost", value: band(plan.costBand) },
          { label: "Estimated duration", value: band(plan.durationBand) },
          { label: "Funding source", value: FACILITY_FUNDING_LABELS[fundingSource] },
          {
            label: "Ongoing maintenance (once completed)",
            value: `${money(project.ongoingCost)} / month`,
          },
        ]}
      />
      <p className="subtle">
        Target improvement:{" "}
        {plan.expectedImprovement.map(band).join(", ") || "General facility renewal"}.
      </p>
      {site && (
        <p className="subtle">
          Site: {site.municipalityName} · {band(site.siteType)} · {site.arrangement.toLowerCase()}
          {site.governmentConditions.length > 0 &&
            ` · conditions: ${site.governmentConditions.join(", ")}`}
        </p>
      )}
      <p className="subtle">
        Funding split:{" "}
        {Object.entries(financing ?? {})
          .map(([key, value]) => `${band(key.replace(/([A-Z])/g, "_$1"))}: ${money(value)}`)
          .join(", ") || "automatically drawn from club cash"}{" "}
        —{" "}
        {project.fundingStatus === "FUNDED"
          ? "fully funded"
          : project.fundingStatus === "PARTIALLY_FUNDED"
            ? "partially funded"
            : "not yet funded"}
        .
      </p>
      <p className="subtle">
        Once construction begins, a real 0–45 day delay and up to a 12% cost overrun can occur.
        Cancelling a project later forfeits any funds already committed as a sunk cost.
      </p>
      <div className="button-row">
        <button className="ghost" disabled={busy} onClick={onBack}>
          Back to edit
        </button>
        <button className="primary" disabled={busy} onClick={onConfirm}>
          {busy ? "Creating…" : "Confirm & create project"}
        </button>
      </div>
    </Panel>
  );
};

const FacilityLifecycle = ({
  planning,
}: {
  planning: FacilityPlanningView;
}): React.ReactElement => {
  if (planning.projects.length === 0) {
    return (
      <Panel title="Facility projects">
        <p className="empty-state">No infrastructure projects recorded for this club yet.</p>
      </Panel>
    );
  }
  const planFor = (projectId: EntityId): FacilityProjectPlan | undefined =>
    planning.plans.find((item) => item.projectId === projectId);
  return (
    <Panel title="Facility projects" className="panel-wide">
      <div className="facility-lifecycle-grid">
        {planning.projects.map((project) => {
          const plan = planFor(project.id);
          return (
            <article key={project.id} className="facility-project-card">
              <header>
                <strong>{band(project.projectType)}</strong>
                <Badge tone={FACILITY_STATUS_TONE[project.status]}>
                  {FACILITY_STATUS_LABEL[project.status]}
                </Badge>
              </header>
              {plan && (
                <p className="subtle">
                  {FACILITY_MODE_LABELS[plan.mode]} · {FACILITY_SCOPE_LABELS[plan.scope]} scope
                </p>
              )}
              <Metrics
                items={[
                  { label: "Capital cost", value: money(project.capitalCost) },
                  {
                    label: "Funding",
                    value: project.fundingStatus ? band(project.fundingStatus) : "—",
                  },
                  {
                    label:
                      project.status === "COMPLETED"
                        ? "Completed"
                        : project.status === "CANCELLED"
                          ? "Cancelled"
                          : "Expected completion",
                    value: project.completedAt ?? project.cancelledOn ?? project.expectedCompletion,
                  },
                ]}
              />
              {project.status === "CONSTRUCTION" && (project.delayDays ?? 0) > 0 && (
                <p className="subtle">Running {project.delayDays} days behind schedule.</p>
              )}
              {project.status === "CANCELLED" && (
                <p className="subtle">
                  Sunk cost: {money(project.sunkCost ?? 0)}
                  {project.recoveryPlan ? ` — ${project.recoveryPlan}` : ""}
                </p>
              )}
              {plan?.rationale && <p className="subtle">"{plan.rationale}"</p>}
            </article>
          );
        })}
      </div>
    </Panel>
  );
};

/**
 * Owner/President player view. Read-only by construction: it never calls a
 * football-mutating command, it only shows getPlayerActions' own real
 * reason for why this actor cannot act, plus a pointer into the existing
 * Owner<->Manager meeting path when one is available. Reused everywhere an
 * Owner or President screen needs to open a player — never a per-screen
 * bespoke profile.
 */
export const PlayerContextPanel = ({
  bridge,
  playerId,
  onClose,
  onTalkToManager,
}: {
  bridge: DesktopRuntimeApi;
  playerId: EntityId;
  onClose: () => void;
  /** Present only where a real Owner<->Manager meeting path exists to route into. */
  onTalkToManager?: () => void;
}): React.ReactElement => {
  const [state, refresh] = useRuntimeData(async () => {
    const [reference, contract, transfer, actions, request] = await Promise.all([
      bridge.getEntityReference("PLAYER", playerId),
      bridge.getPlayerContractContext(playerId),
      bridge.getPlayerTransferContext(playerId),
      bridge.getPlayerActions(playerId),
      // Owner-only, and only meaningful for a player at the owner's own
      // club — a failed/unauthorized result here just means no request path
      // is offered, not that the whole panel breaks.
      bridge.getOwnerPlayerRequestContext(playerId),
    ]);
    if (!reference.ok) return reference;
    if (!contract.ok) return contract;
    if (!transfer.ok) return transfer;
    if (!actions.ok) return actions;
    return {
      ok: true as const,
      data: {
        reference: reference.data,
        contract: contract.data,
        transfer: transfer.data,
        actions: actions.data,
        request: request.ok ? request.data : undefined,
      },
    };
  }, [playerId]);
  const [requestBusy, setRequestBusy] = useState<OwnerPlayerRequestIntent | null>(null);
  const [openClubId, setOpenClubId] = useState<EntityId | undefined>(undefined);

  return (
    <Panel
      title="Player"
      className="panel-wide player-context-panel"
      actions={
        <button className="ghost small" onClick={onClose}>
          Close
        </button>
      }
    >
      <AsyncPanel state={state}>
        {(data) =>
          !data.reference.visible ? (
            <p className="empty-state">
              This player is no longer on record — they may have retired, transferred away and left
              this database's scope, or the reference is stale.
            </p>
          ) : (
            <>
              <h2>{data.reference.label}</h2>
              <Metrics
                items={[
                  {
                    label: "Club",
                    value: data.transfer.currentClubId ? (
                      <button className="link" onClick={() => setOpenClubId(data.transfer.currentClubId)}>
                        {data.contract.clubName ?? "Club"}
                      </button>
                    ) : (
                      (data.contract.clubName ?? "Unattached")
                    ),
                  },
                  { label: "Squad role", value: data.contract.contract?.squadRole ?? "—" },
                  {
                    label: "Contract status",
                    value: data.contract.contract?.status ?? "No active contract",
                  },
                ]}
              />
              {data.contract.contract && (
                <Panel title="Contract">
                  <Metrics
                    items={[
                      {
                        label: "Wages",
                        value: `${money(data.contract.contract.salary, data.contract.contract.currency)} / month`,
                      },
                      { label: "Expires", value: data.contract.contract.endDate },
                      {
                        label: "Release clause",
                        value: data.contract.contract.releaseClause
                          ? money(
                              data.contract.contract.releaseClause,
                              data.contract.contract.currency,
                            )
                          : "None",
                      },
                    ]}
                  />
                </Panel>
              )}
              <Panel title="Transfer status">
                <Metrics
                  items={[
                    { label: "Status", value: band(data.transfer.transferStatus) },
                    { label: "Active offers", value: data.transfer.activeOfferCount },
                  ]}
                />
                {data.transfer.transferReason && (
                  <p className="subtle">{data.transfer.transferReason}</p>
                )}
              </Panel>
              <Panel title="Football authority">
                <p className="subtle">
                  {data.actions.actions[0]?.reason ??
                    "Football decisions for this player belong to the Manager or a delegated Director."}
                </p>
                {data.request ? (
                  <div className="action-group">
                    <h3>Open request</h3>
                    <p className="subtle">
                      {OWNER_PLAYER_REQUEST_LABELS[data.request.requestIntent]} · raised{" "}
                      {data.request.requestedOn}
                      {data.request.deadline ? ` · due ${data.request.deadline}` : ""}
                    </p>
                    <p className="subtle">
                      Stage: {band(data.request.meeting.stage)}
                      {data.request.meeting.outcome ? ` — ${data.request.meeting.outcome}` : ""}
                    </p>
                  </div>
                ) : (
                  <div className="action-group">
                    <h3>Ask the Manager</h3>
                    <div className="button-row">
                      {OWNER_PLAYER_REQUEST_INTENTS.map((intent) => (
                        <button
                          key={intent}
                          className="ghost small"
                          disabled={requestBusy !== null}
                          onClick={async () => {
                            setRequestBusy(intent);
                            const result = await bridge.openOwnerPlayerRequest(playerId, intent);
                            setRequestBusy(null);
                            if (result.ok) refresh();
                          }}
                        >
                          {requestBusy === intent
                            ? "Raising…"
                            : OWNER_PLAYER_REQUEST_LABELS[intent]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {onTalkToManager && (
                  <button className="ghost small" onClick={onTalkToManager}>
                    Discuss with Manager
                  </button>
                )}
              </Panel>
              {openClubId && (
                <OrganizationProfilePanel
                  bridge={bridge}
                  entityType="CLUB"
                  entityId={openClubId}
                  onClose={() => setOpenClubId(undefined)}
                />
              )}
            </>
          )
        }
      </AsyncPanel>
    </Panel>
  );
};

/**
 * ORGANIZATION PROFILE — one canonical dossier for sponsors, lenders, and
 * investors, opened from anywhere an EntityReference of that type exists.
 * Everything here reads getOrganizationProfile as-is: no fabricated
 * revenue/valuation/employee-count/executives/founding-year, and the
 * involved-entities list is already deduplicated by the backend, not here.
 */

// profile.sector is real backend text, but its source column varies by organization
// type: sponsor industry/sector text arrives already human-readable (e.g. "Sports
// Equipment"), while lender institution_type arrives as a raw enum (e.g.
// "COMMERCIAL_BANK"). Only reformat the latter shape so we never mangle real text.
const formatSector = (value: string): string => (/^[A-Z0-9_]+$/.test(value) ? band(value) : value);

const ORGANIZATION_ENTITY_TYPES = new Set(["SPONSOR", "LENDER", "INVESTOR"]);
/** Club/Staff/Competition profiles (b0d0871) render through the same host as
 * organizations — see OrganizationProfilePanel below, which now covers both. */
const WORLD_PROFILE_ENTITY_TYPES = new Set(["CLUB", "STAFF", "COMPETITION"]);
const isOpenableReference = (reference: EntityReference): boolean =>
  reference.visible &&
  (reference.entityType === "PLAYER" ||
    ORGANIZATION_ENTITY_TYPES.has(reference.entityType) ||
    WORLD_PROFILE_ENTITY_TYPES.has(reference.entityType));

const DEAL_STATUS_TONE: Record<string, MeetingTone> = {
  ACTIVE: "ok",
  COMPLETED: "info",
  EXPIRED: "warn",
  REJECTED: "bad",
  WITHDRAWN: "bad",
  COUNTERED: "info",
  OFFERED: "info",
  NEGOTIATED: "info",
  PROPOSED: "info",
};

/** A single reference, rendered clickable only when it actually has somewhere to go. */
const EntityRefLink = ({
  reference,
  onOpen,
}: {
  reference: EntityReference;
  onOpen: (reference: EntityReference) => void;
}): React.ReactElement =>
  isOpenableReference(reference) ? (
    <button className="link" onClick={() => onOpen(reference)}>
      {reference.label}
    </button>
  ) : (
    <span>{reference.visible ? reference.label : "Unknown entity"}</span>
  );

const EntityRefChip = ({
  reference,
  onOpen,
}: {
  reference: EntityReference;
  onOpen: (reference: EntityReference) => void;
}): React.ReactElement => (
  <span className="entity-chip">
    <Badge tone="info">{band(reference.entityType)}</Badge>{" "}
    <EntityRefLink reference={reference} onOpen={onOpen} />
  </span>
);

const OrganizationDealSection = ({
  title,
  deals,
  onOpenReference,
  empty,
}: {
  title: string;
  deals: OrganizationCommercialDeal[];
  onOpenReference: (reference: EntityReference) => void;
  empty: string;
}): React.ReactElement => (
  <Panel title={title}>
    {deals.length === 0 ? (
      <p className="empty-state">{empty}</p>
    ) : (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Counterpart</th>
              <th>Property</th>
              <th>Value</th>
              <th>Term</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => (
              <tr key={deal.id}>
                <td>
                  {deal.counterpartReference ? (
                    <EntityRefLink reference={deal.counterpartReference} onOpen={onOpenReference} />
                  ) : (
                    (deal.counterpartLabel ?? band(deal.scope))
                  )}
                </td>
                <td>{band(deal.property)}</td>
                <td>
                  {deal.annualValue !== undefined ? `${money(deal.annualValue)} / year` : "—"}
                </td>
                <td>
                  {deal.startDate ?? "—"}
                  {deal.endDate
                    ? ` – ${deal.endDate}`
                    : deal.termYears
                      ? ` (${deal.termYears}y)`
                      : ""}
                </td>
                <td>
                  <Badge tone={DEAL_STATUS_TONE[deal.status] ?? "info"}>{band(deal.status)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Panel>
);

/** Every entity type this shared host can open — organizations plus the
 * world-profile trio from b0d0871. */
export type ProfileEntityType = OrganizationProfileEntityType | "CLUB" | "STAFF" | "COMPETITION";

type ProfileTarget = { entityType: ProfileEntityType; entityId: EntityId };

type ProfileData =
  | { kind: "ORGANIZATION"; data: OrganizationProfile }
  | { kind: "CLUB"; data: ClubProfile }
  | { kind: "STAFF"; data: StaffProfileReadModel }
  | { kind: "COMPETITION"; data: CompetitionProfile };

const missingProfileMethod = (message: string): { ok: false; error: AppError } => ({
  ok: false,
  error: { code: "RUNTIME_UNAVAILABLE", message },
});

/**
 * ONE canonical dossier host for every clickable world entity — sponsors,
 * lenders, investors (getOrganizationProfile), and clubs/staff/competitions
 * (getClubProfile/getStaffProfile/getCompetitionProfile, b0d0871). Every
 * screen that makes an EntityReference clickable opens it through this same
 * component and the same internal back/history stack, so a Club → Manager →
 * Club → Competition chain works uniformly no matter where it started.
 */
export const OrganizationProfilePanel = ({
  bridge,
  entityType,
  entityId,
  onClose,
  onOpenPlayer,
}: {
  bridge: DesktopRuntimeApi;
  entityType: ProfileEntityType;
  entityId: EntityId;
  onClose: () => void;
  /** Present wherever the caller already has a player-profile surface to route PLAYER references into. */
  onOpenPlayer?: (playerId: EntityId) => void;
}): React.ReactElement => {
  const [target, setTarget] = useState<ProfileTarget>({ entityType, entityId });
  const [history, setHistory] = useState<ProfileTarget[]>([]);
  const [state] = useRuntimeData(async (): Promise<AppResult<ProfileData>> => {
    if (ORGANIZATION_ENTITY_TYPES.has(target.entityType)) {
      const result = await bridge.getOrganizationProfile(
        target.entityType as OrganizationProfileEntityType,
        target.entityId,
      );
      return result.ok ? { ok: true as const, data: { kind: "ORGANIZATION" as const, data: result.data } } : result;
    }
    if (target.entityType === "CLUB") {
      if (!bridge.getClubProfile) return missingProfileMethod("Club profiles are unavailable right now.");
      const result = await bridge.getClubProfile(target.entityId);
      return result.ok ? { ok: true as const, data: { kind: "CLUB" as const, data: result.data } } : result;
    }
    if (target.entityType === "STAFF") {
      if (!bridge.getStaffProfile) return missingProfileMethod("Staff profiles are unavailable right now.");
      const result = await bridge.getStaffProfile(target.entityId);
      return result.ok ? { ok: true as const, data: { kind: "STAFF" as const, data: result.data } } : result;
    }
    if (!bridge.getCompetitionProfile)
      return missingProfileMethod("Competition profiles are unavailable right now.");
    const result = await bridge.getCompetitionProfile(target.entityId);
    return result.ok ? { ok: true as const, data: { kind: "COMPETITION" as const, data: result.data } } : result;
  }, [target.entityType, target.entityId]);

  const openReference = (reference: EntityReference): void => {
    if (reference.entityType === "PLAYER") {
      onOpenPlayer?.(reference.id);
      return;
    }
    if (!isOpenableReference(reference)) return;
    setHistory((previous) => [...previous, target]);
    setTarget({ entityType: reference.entityType as ProfileEntityType, entityId: reference.id });
  };

  const goBack = (): void => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((entries) => entries.slice(0, -1));
    setTarget(previous);
  };

  const title =
    target.entityType === "CLUB"
      ? "Club"
      : target.entityType === "STAFF"
        ? "Staff"
        : target.entityType === "COMPETITION"
          ? "Competition"
          : "Organization";

  return (
    <Panel
      title={title}
      className="panel-wide organization-profile-panel"
      actions={
        <span className="button-row">
          {history.length > 0 && (
            <button className="ghost small" onClick={goBack}>
              Back
            </button>
          )}
          <button className="ghost small" onClick={onClose}>
            Close
          </button>
        </span>
      }
    >
      <AsyncPanel state={state}>
        {(profile) =>
          profile.kind === "ORGANIZATION" ? (
            <OrganizationProfileBody profile={profile.data} onOpenReference={openReference} />
          ) : profile.kind === "CLUB" ? (
            <ClubProfileBody profile={profile.data} onOpenReference={openReference} />
          ) : profile.kind === "STAFF" ? (
            <StaffProfileBody profile={profile.data} onOpenReference={openReference} />
          ) : (
            <CompetitionProfileBody profile={profile.data} onOpenReference={openReference} />
          )
        }
      </AsyncPanel>
    </Panel>
  );
};

const OrganizationProfileBody = ({
  profile,
  onOpenReference,
}: {
  profile: OrganizationProfile;
  onOpenReference: (reference: EntityReference) => void;
}): React.ReactElement => (
  <>
    <h2>{profile.entityReference.label}</h2>
    <div className="button-row">
      <Badge tone="info">{band(profile.entityReference.entityType)}</Badge>
      {profile.sector && <Badge tone="info">{formatSector(profile.sector)}</Badge>}
      <Badge tone={profile.provenanceStatus === "VERIFIED" ? "ok" : "info"}>
        {profile.provenanceStatus === "VERIFIED" ? "Verified company" : "Simulation-only"}
      </Badge>
    </div>
    {profile.relationshipClues.length > 0 && (
      <p className="subtle">{profile.relationshipClues.join(" · ")}</p>
    )}

    <OrganizationDealSection
      title="Active relationships"
      deals={profile.activeDeals}
      onOpenReference={onOpenReference}
      empty="No active commercial relationships."
    />
    <OrganizationDealSection
      title="Current negotiations"
      deals={profile.currentNegotiations}
      onOpenReference={onOpenReference}
      empty="No open negotiations."
    />
    <OrganizationDealSection
      title="Partnership history"
      deals={profile.dealHistory}
      onOpenReference={onOpenReference}
      empty="No historical deals recorded."
    />

    {profile.involvedEntities.length > 0 && (
      <Panel title="Involved entities">
        <div className="button-row">
          {profile.involvedEntities.map((reference) => (
            <EntityRefChip
              key={`${reference.entityType}:${reference.id}`}
              reference={reference}
              onOpen={onOpenReference}
            />
          ))}
        </div>
      </Panel>
    )}
  </>
);

/** Never fabricates club history/metadata — only fields buildClubProfile actually returns. */
const ClubProfileBody = ({
  profile,
  onOpenReference,
}: {
  profile: ClubProfile;
  onOpenReference: (reference: EntityReference) => void;
}): React.ReactElement => (
  <>
    <h2>{profile.entityReference.label}</h2>
    <div className="button-row">
      <Badge tone="info">{band(profile.entityReference.entityType)}</Badge>
      {profile.division && <Badge tone="info">{band(profile.division)}</Badge>}
    </div>
    {profile.locationLabel && <p className="subtle">{profile.locationLabel}</p>}
    <Metrics
      items={[
        {
          label: "Manager",
          value: profile.manager ? (
            <EntityRefLink reference={profile.manager} onOpen={onOpenReference} />
          ) : (
            "Vacant"
          ),
        },
        {
          label: "Owner",
          value: profile.owner ? (
            <EntityRefLink reference={profile.owner} onOpen={onOpenReference} />
          ) : (
            "Unknown"
          ),
        },
      ]}
    />
    <Panel title="Active sponsors">
      {profile.activeSponsors.length === 0 ? (
        <p className="empty-state">No active sponsors on record.</p>
      ) : (
        <div className="button-row">
          {profile.activeSponsors.map((reference) => (
            <EntityRefChip
              key={`${reference.entityType}:${reference.id}`}
              reference={reference}
              onOpen={onOpenReference}
            />
          ))}
        </div>
      )}
    </Panel>
    <Panel title="Infrastructure projects">
      {profile.infrastructureProjects.length === 0 ? (
        <p className="empty-state">No infrastructure projects in progress.</p>
      ) : (
        <ul className="compact-list">
          {profile.infrastructureProjects.map((reference) => (
            <li key={reference.id}>{reference.visible ? reference.label : "Unknown project"}</li>
          ))}
        </ul>
      )}
    </Panel>
    <Panel title="Recent fixtures">
      {profile.recentFixtures.length === 0 ? (
        <p className="empty-state">No fixtures on record.</p>
      ) : (
        <ul className="compact-list">
          {profile.recentFixtures.map((reference) => (
            <li key={reference.id}>
              {reference.visible ? reference.label : "Unknown fixture"}
              {reference.subtitle ? ` · ${reference.subtitle}` : ""}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  </>
);

/** No hidden personality/attribute scores — only the identity, appointment,
 * and career fields buildStaffProfile actually returns. */
const StaffProfileBody = ({
  profile,
  onOpenReference,
}: {
  profile: StaffProfileReadModel;
  onOpenReference: (reference: EntityReference) => void;
}): React.ReactElement => (
  <>
    <h2>{profile.entityReference.label}</h2>
    <div className="button-row">
      <Badge tone="info">{band(profile.entityReference.entityType)}</Badge>
      {profile.role && <Badge tone="info">{band(profile.role)}</Badge>}
    </div>
    <Metrics
      items={[
        {
          label: "Club",
          value: profile.club ? (
            <EntityRefLink reference={profile.club} onOpen={onOpenReference} />
          ) : (
            "Unattached"
          ),
        },
        {
          label: "Federation",
          value: profile.federation ? (
            <EntityRefLink reference={profile.federation} onOpen={onOpenReference} />
          ) : (
            "—"
          ),
        },
        { label: "Contract ends", value: profile.contractEnd ?? "—" },
      ]}
    />
    {profile.careerHistory.length > 0 && (
      <Panel title="Career history">
        <div className="button-row">
          {profile.careerHistory.map((reference) => (
            <EntityRefChip
              key={`${reference.entityType}:${reference.id}`}
              reference={reference}
              onOpen={onOpenReference}
            />
          ))}
        </div>
      </Panel>
    )}
  </>
);

/** Sponsor naming never overwrites the canonical competition name — the two
 * are always rendered as distinct fields, exactly as CompetitionProfile
 * itself distinguishes them. */
const CompetitionProfileBody = ({
  profile,
  onOpenReference,
}: {
  profile: CompetitionProfile;
  onOpenReference: (reference: EntityReference) => void;
}): React.ReactElement => (
  <>
    <h2>{profile.canonicalName}</h2>
    {profile.commercialDisplayTitle && profile.commercialDisplayTitle !== profile.canonicalName && (
      <p className="subtle">Commercially known as {profile.commercialDisplayTitle}</p>
    )}
    <Metrics
      items={[
        {
          label: "Season",
          value: profile.currentSeason
            ? `${profile.currentSeason.name} · ${profile.currentSeason.startDate} – ${profile.currentSeason.endDate}`
            : "No active season",
        },
        {
          label: "Title sponsor",
          value: profile.titleSponsor ? (
            <EntityRefLink reference={profile.titleSponsor} onOpen={onOpenReference} />
          ) : (
            "None"
          ),
        },
      ]}
    />
    <Panel title="Standings">
      {profile.standings.length === 0 ? (
        <p className="empty-state">No standings recorded for the current season.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Club</th>
                <th>Played</th>
                <th>Points</th>
                <th>Goal difference</th>
              </tr>
            </thead>
            <tbody>
              {profile.standings.map((row) => (
                <tr key={row.team.id}>
                  <td>
                    <EntityRefLink reference={row.team} onOpen={onOpenReference} />
                  </td>
                  <td>{row.played}</td>
                  <td>{row.points}</td>
                  <td>{row.goalDifference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
    <Panel title="Participants">
      {profile.participants.length === 0 ? (
        <p className="empty-state">No participating clubs on record.</p>
      ) : (
        <div className="button-row">
          {profile.participants.map((reference) => (
            <EntityRefChip
              key={`${reference.entityType}:${reference.id}`}
              reference={reference}
              onOpen={onOpenReference}
            />
          ))}
        </div>
      )}
    </Panel>
    {profile.fixtures.length > 0 && (
      <Panel title="Recent fixtures">
        <ul className="compact-list">
          {profile.fixtures.map((reference) => (
            <li key={reference.id}>
              {reference.visible ? reference.label : "Unknown fixture"}
              {reference.subtitle ? ` · ${reference.subtitle}` : ""}
            </li>
          ))}
        </ul>
      </Panel>
    )}
  </>
);
