import React, { useState } from "react";
import type {
  ChairmanDashboard,
  CareerHeader,
  CareerRoleState,
  ClubBudgetCategory,
  EntityId,
  EntityReference,
  ExecutiveAuthorityDesktopView,
  FederationPresidentDashboard,
  InboxItem,
  InfrastructureStoryEntry,
  NationDevelopmentScorecard,
  OwnerManagerCandidate,
} from "@nepal-football-sim/shared-types";
import type { AppError, DesktopRuntimeApi } from "../appBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Metrics, Panel, useRuntimeData } from "./ui.js";
import { CandidacyPanel } from "./screens/HomeScreen.js";
import {
  BankMeeting,
  EntityRefLink,
  FacilityPlanner,
  OrganizationProfilePanel,
  RoleDetailScreen,
  SponsorMeeting,
  type ChairmanScreen,
  type PresidentScreen,
  type ProfileEntityType,
} from "./RoleDetailScreen.js";
import { projectStatusLabel } from "./clubWorldPresentation.js";

export const EXECUTIVE_ROLES = ["SPORTING_DIRECTOR", "DIRECTOR_OF_FOOTBALL", "CEO", "GENERAL_SECRETARY"];

const money = (amount: number, currency = "NPR"): string =>
  `${currency} ${Math.round(amount).toLocaleString()}`;
const roleName = (role: string): string =>
  role === "CHAIRMAN_OWNER"
    ? "Chairman / Owner"
    : role === "FEDERATION_PRESIDENT"
      ? "Federation President"
      : role === "CEO"
        ? "CEO"
        : role === "GENERAL_SECRETARY"
          ? "General Secretary"
          : role === "SPORTING_DIRECTOR"
            ? "Sporting Director"
            : role === "DIRECTOR_OF_FOOTBALL"
              ? "Director of Football"
              : role;

export const RoleLandingScreen = ({
  header,
  roles,
  bridge,
  screen,
  onNavigate,
}: {
  header: CareerHeader;
  roles: CareerRoleState;
  bridge: DesktopRuntimeApi;
  screen: ChairmanScreen | PresidentScreen;
  onNavigate: (screen: ChairmanScreen | PresidentScreen) => void;
}): React.ReactElement =>
  EXECUTIVE_ROLES.includes(header.activeRole) ? (
    <ExecutiveDashboardScreen header={header} roles={roles} bridge={bridge} />
  ) : screen !== "dashboard" ? (
    <RoleDetailScreen
      screen={screen}
      header={header}
      roles={roles}
      bridge={bridge}
      onNavigate={onNavigate}
    />
  ) : header.activeRole === "CHAIRMAN_OWNER" ? (
    <ChairmanDashboardScreen header={header} roles={roles} bridge={bridge} />
  ) : (
    <FederationDashboardScreen header={header} roles={roles} bridge={bridge} onNavigate={onNavigate} />
  );

/**
 * Executive roles (CEO, General Secretary, Sporting Director, Director of
 * Football) are held career roles once a persisted, FILLED executive
 * assignment exists — but they are not full alternate workspaces the way
 * Manager/Owner/President are. This surfaces the same UI-safe
 * getExecutiveAuthority read model the backend already computes: banded
 * permitted actions, a truthful vacant/blocked reason, and — for the
 * mutations that have a real, simple trigger (CEO budget administration) —
 * one canonical action, so the role is genuinely usable rather than a bare
 * label with nothing behind it.
 */
const ExecutiveDashboardScreen = ({
  header,
  roles,
  bridge,
}: {
  header: CareerHeader;
  roles: CareerRoleState;
  bridge: DesktopRuntimeApi;
}): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getExecutiveAuthority());
  return (
    <AsyncPanel state={state}>
      {(authority) =>
        !authority ? (
          <section className="role-dashboard">
            <RoleHeader
              header={header}
              roles={roles}
              organisation="Executive office"
              context="This executive role has no assigned club."
            />
            <Panel title="Executive authority">
              <p className="empty-state">No executive assignment could be resolved.</p>
            </Panel>
          </section>
        ) : (
          <ExecutiveDashboardView
            header={header}
            roles={roles}
            bridge={bridge}
            refresh={refresh}
            authority={authority}
          />
        )
      }
    </AsyncPanel>
  );
};

const ExecutiveDashboardView = ({
  header,
  roles,
  bridge,
  refresh,
  authority,
}: {
  header: CareerHeader;
  roles: CareerRoleState;
  bridge: DesktopRuntimeApi;
  refresh: () => void;
  authority: ExecutiveAuthorityDesktopView;
}): React.ReactElement => {
  const [amount, setAmount] = useState("1000000");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const canSetBudget = authority.permittedActions.includes("BUDGET_ADMINISTRATION");
  const canManageCommercial = authority.permittedActions.includes("COMMERCIAL_OVERSIGHT");
  const canManageFacilities = authority.permittedActions.includes("FACILITY_OVERSIGHT");
  const setBudget = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const result = await bridge.setExecutiveClubBudget(
      authority.clubId,
      String(new Date(header.worldDate).getUTCFullYear()),
      "WAGE_BUDGET",
      Number(amount),
    );
    setBusy(false);
    if (result.ok) {
      setMessage(`Wage budget set to ${money(result.data.amount)}.`);
      setError(null);
      refresh();
    } else setError(result.error);
  };
  return (
    <section className="role-dashboard">
      <RoleHeader
        header={header}
        roles={roles}
        organisation={authority.assignment.personName ?? roleName(authority.actorRole)}
        context={
          authority.assignment.status === "FILLED"
            ? authority.assignment.rationale
            : (authority.blockedReason ?? "This executive role is vacant.")
        }
      />
      {error && <ErrorBanner error={error} />}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <Panel title="Executive authority">
        {authority.assignment.status !== "FILLED" ? (
          <p className="empty-state">
            {authority.blockedReason ?? "This executive role is vacant."}
          </p>
        ) : authority.permittedActions.length === 0 ? (
          <p className="empty-state">No mutation authority is currently assigned to this role.</p>
        ) : (
          <ul className="compact-list">
            {authority.permittedActions.map((action) => (
              <li key={action}>
                <Badge tone="info">{action.replace(/_/g, " ").toLowerCase()}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {canSetBudget && (
        <Panel title="Club budget administration">
          <p className="subtle">
            Delegated CEO budget authority acts through the same canonical budget command the
            controlling owner uses — the club's own ownership gate remains authoritative.
          </p>
          <div className="inline-form">
            <label>
              Wage budget (NPR)
              <input
                aria-label="Executive wage budget amount"
                type="number"
                min="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <button className="primary small" disabled={busy} onClick={() => void setBudget()}>
              {busy ? "Saving…" : "Set wage budget"}
            </button>
          </div>
        </Panel>
      )}
      {canSetBudget && <BankMeeting bridge={bridge} role="CEO" clubId={authority.clubId} />}
      {canManageCommercial && <SponsorMeeting bridge={bridge} role="CEO" clubId={authority.clubId} />}
      {canManageFacilities && <FacilityPlanner bridge={bridge} clubId={authority.clubId} />}
    </section>
  );
};

const RoleHeader = ({
  header,
  roles,
  organisation,
  context,
}: {
  header: CareerHeader;
  roles: CareerRoleState;
  organisation: string;
  context: string;
}): React.ReactElement => (
  <header className="page-header">
    <div>
      <p className="eyebrow">{organisation}</p>
      <h1>{roleName(header.activeRole)}</h1>
      <p className="subtle">{context}</p>
    </div>
    <span className="role-badge">{roles.heldRoles.length} held roles</span>
  </header>
);

const ChairmanDashboardScreen = ({
  header,
  roles,
  bridge,
}: {
  header: CareerHeader;
  roles: CareerRoleState;
  bridge: DesktopRuntimeApi;
}): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getChairmanDashboard());
  const [candidates, refreshCandidates] = useRuntimeData(() => bridge.listOwnerManagerCandidates());
  return (
    <AsyncPanel state={state}>
      {(dashboard) => (
        <ChairmanDashboardView
          dashboard={dashboard}
          header={header}
          roles={roles}
          bridge={bridge}
          refresh={refresh}
          candidates={candidates.status === "ready" ? candidates.data : []}
          refreshCandidates={refreshCandidates}
        />
      )}
    </AsyncPanel>
  );
};

const ChairmanDashboardView = ({
  dashboard,
  header,
  roles,
  bridge,
  refresh,
  candidates,
  refreshCandidates,
}: {
  dashboard: ChairmanDashboard;
  header: CareerHeader;
  roles: CareerRoleState;
  bridge: DesktopRuntimeApi;
  refresh: () => void;
  candidates: OwnerManagerCandidate[];
  refreshCandidates: () => void;
}): React.ReactElement => {
  const initialBudget =
    dashboard.finances.budgets.find((item) => item.status === "ACTIVE") ??
    dashboard.finances.budgets[0];
  const [budgetCategory, setBudgetCategory] = useState(initialBudget?.category ?? "WAGE_BUDGET");
  const budget =
    dashboard.finances.budgets.find(
      (item) => item.status === "ACTIVE" && item.category === budgetCategory,
    ) ?? initialBudget;
  const [amount, setAmount] = useState(String(budget?.amount ?? ""));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busyBudget, setBusyBudget] = useState(false);
  const [busyEquipment, setBusyEquipment] = useState(false);
  const [candidateFilter, setCandidateFilter] = useState("");
  const [openReferenceTarget, setOpenReferenceTarget] = useState<{ entityType: ProfileEntityType; entityId: EntityId } | null>(null);
  const openReference = (reference: EntityReference): void =>
    setOpenReferenceTarget({ entityType: reference.entityType as ProfileEntityType, entityId: reference.id });
  const saveBudget = async (): Promise<void> => {
    if (!budget || busyBudget) return;
    setBusyBudget(true);
    const result = await bridge.setClubBudget(
      dashboard.club.id,
      budget.seasonLabel,
      budget.category,
      Number(amount),
    );
    setBusyBudget(false);
    if (result.ok) {
      setMessage("Budget updated.");
      setError(null);
      refresh();
    } else setError(result.error);
  };
  const orderEquipment = async (): Promise<void> => {
    if (busyEquipment) return;
    setBusyEquipment(true);
    const result = await bridge.purchaseEquipment("FOOTBALL_EQUIPMENT", 1);
    setBusyEquipment(false);
    if (result.ok) {
      setMessage("Equipment order placed.");
      setError(null);
      refresh();
    } else setError(result.error);
  };
  const ownership = dashboard.club.ownership.filter(
    (item) => item.percentage == null || item.percentage > 0,
  );
  const visibleCandidates = candidates.filter((candidate) =>
    `${candidate.name} ${candidate.nationality} ${candidate.qualification}`
      .toLowerCase()
      .includes(candidateFilter.toLowerCase()),
  );
  const appoint = async (candidate: OwnerManagerCandidate): Promise<void> => {
    const result = await bridge.appointManager(candidate.vacancyId, candidate.managerProfileId);
    if (result.ok) {
      setMessage(`${candidate.name} appointed as manager.`);
      setError(null);
      refresh();
      refreshCandidates();
    } else setError(result.error);
  };
  return (
    <section className="role-dashboard">
      <RoleHeader
        header={header}
        roles={roles}
        organisation={dashboard.club.name}
        context={`${dashboard.club.ownershipPercentage}% ownership · ${dashboard.club.controllingOwner ? "controlling owner" : "owner context"}`}
      />
      {error && <ErrorBanner error={error} />}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="summary-grid">
        <Panel title="Club summary">
          <Metrics
            items={[
              {
                label: "Club balance",
                value: money(
                  dashboard.finances.account.cashBalance,
                  dashboard.finances.account.currency,
                ),
              },
              { label: "Budget", value: budget ? money(budget.amount, budget.currency) : "—" },
              { label: "Manager", value: dashboard.manager?.name ?? "Vacant — search and appoint" },
              {
                label: "Active sponsors",
                value: String(
                  dashboard.sponsorships.filter((item) => item.status === "ACTIVE").length,
                ),
              },
              {
                label: "Infrastructure projects",
                value: String(
                  dashboard.infrastructure.filter(
                    (item) => !["COMPLETED", "CANCELLED"].includes(item.status),
                  ).length,
                ),
              },
            ]}
          />
        </Panel>
        <Panel title="Ownership">
          <ul className="compact-list">
            {ownership.length ? (
              ownership.map((item) => (
                <li key={item.id}>
                  {item.holderName} · {item.percentage ?? "shared"}% · {item.role}
                </li>
              ))
            ) : (
              <li>No active ownership records.</li>
            )}
          </ul>
        </Panel>
      </div>
      <StoryUpdateCard title="Infrastructure update" update={dashboard.latestInfrastructureUpdate} onOpenReference={openReference} />
      <div className="summary-grid">
        <Panel title="Club management">
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveBudget();
            }}
          >
            <label>
              Budget line
              <select
                aria-label="Budget line"
                value={budgetCategory}
                onChange={(event) => {
                  const category = event.target.value as ClubBudgetCategory;
                  setBudgetCategory(category);
                  setAmount(
                    String(
                      dashboard.finances.budgets.find((item) => item.category === category)
                        ?.amount ?? "",
                    ),
                  );
                }}
              >
                <option value="WAGE_BUDGET">Wage budget</option>
                <option value="TRANSFER_BUDGET">Transfer budget</option>
                <option value="STAFF_BUDGET">Staff budget</option>
                <option value="ACADEMY_BUDGET">Academy budget</option>
                <option value="FACILITY_BUDGET">Facility budget</option>
                <option value="SCOUTING_BUDGET">Scouting budget</option>
                <option value="MARKETING_BUDGET">Marketing budget</option>
              </select>
            </label>
            <label>
              Current budget
              <input
                type="number"
                min="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <button className="primary" type="submit" disabled={busyBudget}>
              {busyBudget ? "Saving…" : "Save budget"}
            </button>
          </form>
          {dashboard.infrastructure.length > 0 && (
            <div className="button-row">
              {Object.entries(
                dashboard.infrastructure.reduce<Record<string, number>>((counts, project) => {
                  counts[project.status] = (counts[project.status] ?? 0) + 1;
                  return counts;
                }, {}),
              ).map(([status, count]) => (
                <Badge key={status} tone={status === "COMPLETED" ? "ok" : status === "CANCELLED" ? "bad" : "warn"}>
                  {count} {projectStatusLabel(status).toLowerCase()}
                </Badge>
              ))}
            </div>
          )}
          <p className="subtle">
            {dashboard.infrastructure.length === 0 ? "No infrastructure projects on record. " : ""}
            Sponsorships: {dashboard.sponsorships.length} total. Plan a new facility project from
            Facilities in the sidebar.
          </p>
        </Panel>
        <Panel title="Manager appointment">
          <p>
            {dashboard.manager
              ? `${dashboard.manager.name} · ${dashboard.manager.contract.jobTitle}`
              : "No active manager contract."}
          </p>
          {!dashboard.manager && (
            <>
              <input
                aria-label="Search manager candidates"
                placeholder="Search name, nationality, qualification"
                value={candidateFilter}
                onChange={(event) => setCandidateFilter(event.target.value)}
              />
              <ul className="compact-list">
                {visibleCandidates.map((candidate) => (
                  <li key={candidate.managerProfileId}>
                    {candidate.name} · {candidate.qualification} · {candidate.nationality} ·
                    reputation {candidate.reputation} · NPR{" "}
                    {candidate.wageExpectation.toLocaleString()} / year{" "}
                    <button className="small" onClick={() => void appoint(candidate)}>
                      Offer contract
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="subtle">
            Owner decisions: appoint the manager, set budgets, approve facilities, and review
            sponsorships.
          </p>
        </Panel>
      </div>
      <Panel title="Operations">
        <p className="subtle">
          Completed assets carry bounded simulation-only operational effects; purchases use club
          cash and the mapped operating budget.
        </p>
        <button className="small" disabled={busyEquipment} onClick={() => void orderEquipment()}>
          {busyEquipment ? "Ordering…" : "Order football equipment"}
        </button>
      </Panel>
      <Panel title="Recent club transactions">
        <TransactionList entries={dashboard.finances.ledgerEntries} />
      </Panel>
      <InboxPanel inbox={dashboard.inbox} />
      {/*
       * Standing for the federation presidency is a long-horizon career option,
       * not the owner's daily business, so it sits below the club rather than
       * above it — the same order the manager workspace uses.
       */}
      <CandidacyPanel />
      {openReferenceTarget && (
        <OrganizationProfilePanel
          bridge={bridge}
          entityType={openReferenceTarget.entityType}
          entityId={openReferenceTarget.entityId}
          onClose={() => setOpenReferenceTarget(null)}
        />
      )}
    </section>
  );
};

const FederationDashboardScreen = ({
  header,
  roles,
  bridge,
  onNavigate,
}: {
  header: CareerHeader;
  roles: CareerRoleState;
  bridge: DesktopRuntimeApi;
  onNavigate: (screen: ChairmanScreen | PresidentScreen) => void;
}): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => bridge.getFederationPresidentDashboard());
  return (
    <AsyncPanel state={state}>
      {(dashboard) => (
        <FederationDashboardView
          dashboard={dashboard}
          header={header}
          roles={roles}
          bridge={bridge}
          refresh={refresh}
          onNavigate={onNavigate}
        />
      )}
    </AsyncPanel>
  );
};

const FederationDashboardView = ({
  dashboard,
  header,
  roles,
  bridge,
  refresh,
  onNavigate,
}: {
  dashboard: FederationPresidentDashboard;
  header: CareerHeader;
  roles: CareerRoleState;
  bridge: DesktopRuntimeApi;
  refresh: () => void;
  onNavigate: (screen: ChairmanScreen | PresidentScreen) => void;
}): React.ReactElement => {
  const [message, setMessage] = useState<string | null>(null);
  const [openReferenceTarget, setOpenReferenceTarget] = useState<{ entityType: ProfileEntityType; entityId: EntityId } | null>(null);
  const openReference = (reference: EntityReference): void =>
    setOpenReferenceTarget({ entityType: reference.entityType as ProfileEntityType, entityId: reference.id });
  const approved = dashboard.proposals.find((item) => item.status === "APPROVED");
  const implement = async (): Promise<void> => {
    if (!approved) return;
    const result = await bridge.implementFederationGovernanceProposal(approved.id);
    if (result.ok) {
      setMessage("Governance proposal implemented.");
      refresh();
    } else setMessage(result.error.message);
  };
  return (
    <section className="role-dashboard">
      <RoleHeader
        header={header}
        roles={roles}
        organisation={dashboard.federation.name}
        context={`${dashboard.tenure ? `${dashboard.tenure.termStart} – ${dashboard.tenure.termEnd ?? "current"}` : "Presidential tenure not recorded"}`}
      />
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="summary-grid">
        <Panel title="Federation summary">
          <Metrics
            items={[
              {
                label: "Federation balance",
                value: money(
                  dashboard.finances.account.cashBalance,
                  dashboard.finances.account.currency,
                ),
              },
              {
                label: "Active programmes",
                value: String(
                  dashboard.projects.filter(
                    (item) => !["COMPLETED", "CANCELLED"].includes(item.status),
                  ).length,
                ),
              },
              {
                label: "Pending proposals",
                value: String(
                  dashboard.proposals.filter((item) =>
                    ["PROPOSED", "COMMITTEE_REVIEW", "APPROVED"].includes(item.status),
                  ).length,
                ),
              },
              { label: "National teams", value: String(dashboard.nationalTeams.length) },
              { label: "Financial health", value: dashboard.finances.account.financialHealth },
            ]}
          />
        </Panel>
        <Panel title="Presidency">
          <p>
            {dashboard.tenure
              ? `Term began ${dashboard.tenure.termStart}${dashboard.tenure.termEnd ? ` · ends ${dashboard.tenure.termEnd}` : ""}`
              : "No active tenure dates available."}
          </p>
        </Panel>
      </div>
      <StoryUpdateCard title="Latest national story" update={dashboard.latestStory} onOpenReference={openReference} />
      <DevelopmentScorecardCard scorecard={dashboard.developmentScorecard} onNavigate={onNavigate} />
      <div className="summary-grid">
        <Panel
          title="Governance"
          actions={
            approved && (
              <button className="primary small" onClick={() => void implement()}>
                Implement approved
              </button>
            )
          }
        >
          <ul className="compact-list">
            {dashboard.proposals.length ? (
              dashboard.proposals.map((item) => (
                <li key={item.id}>
                  {item.title} · {item.status}
                </li>
              ))
            ) : (
              <li>No governance proposals recorded.</li>
            )}
          </ul>
          <button className="link" onClick={() => onNavigate("governance")}>
            Open Governance
          </button>
        </Panel>
        <Panel title="National teams">
          <ul className="compact-list">
            {dashboard.nationalTeams.map((team) => (
              <li key={team.id}>
                {team.name} · {team.headCoach ?? "Head coach not recorded"}
              </li>
            ))}
          </ul>
          <button className="link" onClick={() => onNavigate("national-teams")}>
            Open National Team Hub
          </button>
        </Panel>
      </div>
      <Panel title="Programmes and finance">
        <p>
          {dashboard.projects.length} federation projects · {dashboard.finances.budgets.length}{" "}
          budget lines
        </p>
        <TransactionList entries={dashboard.finances.ledgerEntries} />
        <div className="button-row">
          <button className="link" onClick={() => onNavigate("national-development")}>
            Open National Development
          </button>
          <button className="link" onClick={() => onNavigate("finance")}>
            Open Finance
          </button>
        </div>
      </Panel>
      <Panel title="Explore the federation">
        <div className="button-row">
          <button className="ghost small" onClick={() => onNavigate("nepal-map")}>
            Nepal Map
          </button>
          <button className="ghost small" onClick={() => onNavigate("competition-pyramid")}>
            Domestic Pyramid
          </button>
          <button className="ghost small" onClick={() => onNavigate("commercial")}>
            Commercial Portfolio
          </button>
          <button className="ghost small" onClick={() => onNavigate("government-relations")}>
            Government Relations
          </button>
        </div>
      </Panel>
      <InboxPanel inbox={dashboard.inbox} />
      {openReferenceTarget && (
        <OrganizationProfilePanel
          bridge={bridge}
          entityType={openReferenceTarget.entityType}
          entityId={openReferenceTarget.entityId}
          onClose={() => setOpenReferenceTarget(null)}
        />
      )}
    </section>
  );
};

/*
 * Shared with HomeScreen's own Inbox panel: the role-aware backend already
 * routes club events to Owner and federation events to President (see
 * media.ts's routeHistoricalEvent), so this is presentation only — no new
 * event infrastructure, just the same read-only rendering the manager
 * workspace already uses.
 */
/** A single concise story card — never a feed — driven entirely by the most
 * recent real historical_events row for this club or federation. Shared by
 * Owner Home ("Infrastructure update") and President Home ("Latest
 * national story"). */
const StoryUpdateCard = ({
  title,
  update,
  onOpenReference,
}: {
  title: string;
  update?: InfrastructureStoryEntry;
  onOpenReference: (reference: EntityReference) => void;
}): React.ReactElement | null => {
  if (!update) return null;
  return (
    <Panel title={title}>
      <p>
        <Badge tone={update.tone}>{update.occurredOn}</Badge> {update.headline}
      </p>
      {update.entities.length > 0 && (
        <div className="button-row">
          {update.entities.map((reference) => (
            <span key={`${reference.entityType}:${reference.id}`} className="entity-chip">
              <Badge tone="info">{reference.entityType.replace(/_/g, " ").toLowerCase()}</Badge>{" "}
              <EntityRefLink reference={reference} onOpen={onOpenReference} />
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
};

const scoreTone = (score: number): "ok" | "warn" | "bad" | "info" =>
  score >= 70 ? "ok" : score >= 45 ? "info" : score >= 25 ? "warn" : "bad";

const TREND_LABEL: Record<string, string> = { IMPROVING: "Improving", STABLE: "Stable", DECLINING: "Declining" };
const TREND_TONE: Record<string, "ok" | "warn" | "info"> = { IMPROVING: "ok", STABLE: "info", DECLINING: "warn" };

/** The Build-a-Nation development scorecard — every bar is a direct,
 * already-computed FederationSimulationProfile dimension, never an
 * invented rating. A text summary line accompanies every bar so the score
 * is never conveyed by colour alone. */
/** A simple annual bar chart of the overall Build-a-Nation score — one bar
 * per real persisted snapshot, never one per tick. A plain-text summary
 * accompanies the bars for accessibility. */
const DevelopmentHistoryChart = ({ history }: { history: NationDevelopmentScorecard["history"] }): React.ReactElement => {
  const max = Math.max(100, ...history.map((entry) => entry.overallScore));
  return (
    <div>
      <h3>Development history</h3>
      <div className="history-chart" role="img" aria-label={`Overall score by season: ${history.map((entry) => `${entry.seasonLabel} ${entry.overallScore}`).join(", ")}`}>
        {history.map((entry) => (
          <div key={entry.seasonLabel} className="history-chart-bar-wrap">
            <div className="history-chart-bar" style={{ height: `${(entry.overallScore / max) * 100}%` }} />
            <span className="subtle">{entry.seasonLabel}</span>
            <span className="subtle">{entry.overallScore}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Where clicking each scorecard category should take the President — every
 * category routes somewhere real, never an isolated number. */
const SCORECARD_CATEGORY_SCREEN: Record<string, PresidentScreen> = {
  domesticCompetitions: "competition-pyramid",
  grassrootsYouth: "national-development",
  playerDevelopment: "national-development",
  coachingQuality: "national-development",
  refereeQuality: "national-development",
  infrastructure: "nepal-map",
  commercialStrength: "commercial",
  federationFinances: "finance",
  internationalStanding: "national-teams",
  governance: "governance",
};

const DevelopmentScorecardCard = ({
  scorecard,
  onNavigate,
}: {
  scorecard?: NationDevelopmentScorecard;
  onNavigate: (screen: ChairmanScreen | PresidentScreen) => void;
}): React.ReactElement | null => {
  if (!scorecard) return null;
  return (
    <Panel title="Build-a-Nation development scorecard" className="panel-wide">
      <div className="button-row">
        <Badge tone={scoreTone(scorecard.overallScore)}>Overall {scorecard.overallScore}/100</Badge>
        {scorecard.trend && <Badge tone={TREND_TONE[scorecard.trend]}>{TREND_LABEL[scorecard.trend]}</Badge>}
      </div>
      <div className="development-scorecard-grid">
        {scorecard.categories.map((category) => {
          const target = SCORECARD_CATEGORY_SCREEN[category.key];
          const Wrapper = target ? "button" : "div";
          return (
            <Wrapper
              key={category.key}
              className="development-scorecard-item"
              {...(target ? { onClick: () => onNavigate(target), type: "button" } : {})}
            >
              <div className="project-progress-labels">
                <span>{category.label}</span>
                <span>{category.score}/100</span>
              </div>
              <div className="project-progress-track">
                <div className="project-progress-fill" style={{ width: `${category.score}%` }} />
              </div>
            </Wrapper>
          );
        })}
      </div>
      <p className="subtle">
        Strongest: {scorecard.strongest.label} ({scorecard.strongest.score}) · Weakest: {scorecard.weakest.label} ({scorecard.weakest.score})
      </p>
      {scorecard.nextOpportunities.length > 0 && (
        <ul className="compact-list">
          {scorecard.nextOpportunities.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      {scorecard.history.length === 0 ? (
        <p className="subtle">Trend begins after the next annual snapshot.</p>
      ) : scorecard.history.length === 1 ? (
        <p className="subtle">One season recorded so far ({scorecard.history[0]!.seasonLabel}) — trend begins after the next annual snapshot.</p>
      ) : (
        <DevelopmentHistoryChart history={scorecard.history} />
      )}
    </Panel>
  );
};

const InboxPanel = ({ inbox }: { inbox: InboxItem[] }): React.ReactElement => (
  <Panel title="Inbox">
    {inbox.length === 0 ? (
      <p className="empty-state">Your inbox is empty.</p>
    ) : (
      inbox.map((item) => (
        <div className="inbox-item" key={item.id}>
          <strong>{item.title}</strong>
          <span>{item.body}</span>
          <span className="subtle">{item.createdOn}</span>
        </div>
      ))
    )}
  </Panel>
);

const TransactionList = ({
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
  <ul className="compact-list">
    {entries.length ? (
      entries.slice(0, 8).map((entry) => (
        <li key={entry.id}>
          {entry.date} · {entry.description} · {entry.direction === "DEBIT" ? "−" : "+"}
          {money(entry.amount, entry.currency)}
        </li>
      ))
    ) : (
      <li>No transactions recorded.</li>
    )}
  </ul>
);
