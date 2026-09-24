import React, { useEffect, useState } from "react";
import type {
  ChairmanDashboard,
  CareerHeader,
  CareerRoleState,
  ClubBudgetCategory,
  EntityId,
  EntityReferenceType,
  EntityReference,
  ExecutiveAuthorityDesktopView,
  FederationPresidentDashboard,
  InboxItem,
  InfrastructureStoryEntry,
  NationDevelopmentScorecard,
  OwnerManagerCandidate,
} from "@nepal-football-sim/shared-types";
import type { AppError, DesktopRuntimeApi } from "../appBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Metrics, Panel, useReturnFocusOnClose, useRuntimeData } from "./ui.js";
import { CandidacyPanel } from "./screens/HomeScreen.js";
import { StructuredPressConferencePanel } from "./screens/MediaScreen.js";
import { managerBridge } from "./managerBridge.js";
import {
  BankMeeting,
  EntityRefLink,
  EntityStorylinePanel,
  FacilityPlanner,
  InboxPanel,
  OrganizationProfilePanel,
  PlayerContextPanel,
  RoleDetailScreen,
  SponsorMeeting,
  type ChairmanScreen,
  type PresidentScreen,
  type ProfileEntityType,
} from "./RoleDetailScreen.js";
import { projectStatusLabel } from "./clubWorldPresentation.js";
import { humanizeEnum, humanizeToken } from "./storyHumanizer.js";
import { FederationEnvironmentScene } from "../presentation/FederationEnvironmentScene.js";

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
  onOpenEntity,
}: {
  header: CareerHeader;
  roles: CareerRoleState;
  bridge: DesktopRuntimeApi;
  screen: ChairmanScreen | PresidentScreen;
  onNavigate: (screen: ChairmanScreen | PresidentScreen) => void;
  onOpenEntity?: (entityType: EntityReferenceType, entityId: EntityId) => void;
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
      onOpenEntity={onOpenEntity}
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
  // The single natural Sporting Director / Director of Football press entry
  // point — evaluated once when this dashboard opens, mirroring the Owner
  // and President dashboards' own natural-trigger pattern exactly:
  // deliberately placed at this outer Screen level (not inside
  // ExecutiveDashboardView, AsyncPanel's inner render-prop child) with an
  // empty dependency array, so it fires exactly once per mount of this
  // Screen component — which a later refresh() never itself remounts, only
  // its AsyncPanel-wrapped inner child does. A mount-effect living in that
  // inner child would re-fire on every one of those remounts, and since
  // evaluate*Press keeps resolving the same still-OPEN interview until it's
  // answered, that would loop forever. The backend command itself already
  // enforces SD/DoF authority (currentRecruitmentActor) and CEO/General
  // Secretary — who own no distinct press-worthy authority of their own,
  // see the CEO/GS audit — simply get ROLE_NOT_AUTHORIZED and no-op here.
  useEffect(() => {
    let cancelled = false;
    void managerBridge.evaluateSportingDirectorPress().then((result) => {
      if (!cancelled && result.ok && result.data) refresh();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

/**
 * The recruitment surface for a sporting director / director of football.
 * Their authorities (recruitment, transfer negotiation, loans, contracts,
 * squad planning) previously had no rendered surface at all — the executive
 * landing only showed CEO-shaped budget/sponsor/facility panels — so the
 * roles listed powers they could never use. Every row here is a canonical
 * transfer/loan/contract record, and each player opens the shared profile.
 */
const RecruitmentDesk = ({
  bridge,
  clubId,
}: {
  bridge: DesktopRuntimeApi;
  clubId: EntityId;
}): React.ReactElement => {
  const [player, setPlayer] = useState<EntityId | null>(null);
  const [desk] = useRuntimeData(async () => bridge.getExecutiveRecruitmentDesk(clubId), [clubId]);
  if (player) return <PlayerContextPanel bridge={bridge} playerId={player} onClose={() => setPlayer(null)} />;
  return (
    <AsyncPanel state={desk}>
      {(view) =>
        view.blockedReason ? (
          <Panel title="Recruitment desk">
            <p className="empty-state">{view.blockedReason}</p>
          </Panel>
        ) : (
          <>
            <Panel title="Recruitment desk">
              <Metrics
                items={[
                  { label: "Squad under contract", value: String(view.squadSize) },
                  { label: "Live negotiations", value: String(view.negotiations.length) },
                  { label: "Players on loan", value: String(view.loans.length) },
                  { label: "Contracts expiring", value: String(view.expiringContracts.length) },
                ]}
              />
              <p className="subtle">
                {view.clubName} — these are the club's own canonical transfer, loan and contract
                records. Your delegated authority decides which of them you may act on.
              </p>
            </Panel>
            <Panel title="Live negotiations">
              {view.negotiations.length === 0 ? (
                <p className="empty-state">
                  No transfer offer is open in either direction right now.
                </p>
              ) : (
                <ul className="report-list">
                  {view.negotiations.map((row) => (
                    <li key={row.offerId}>
                      <button className="link" onClick={() => setPlayer(row.playerId)}>
                        {row.playerName}
                      </button>{" "}
                      <Badge tone={row.direction === "IN" ? "info" : "warn"}>
                        {row.direction === "IN" ? "Incoming" : "Outgoing"}
                      </Badge>{" "}
                      <span className="subtle">
                        {row.otherClubName} · {money(row.fee)} ·{" "}
                        {humanizeToken(row.status)} · closes {row.expiresAt.slice(0, 10)}
                      </span>
                      {!row.canNegotiate && (
                        <p className="subtle">
                          You may follow this negotiation, but transfer negotiation is not
                          delegated to your role.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            {view.authorities.includes("LOAN_STRATEGY") && (
              <Panel title="Loans in and out">
                {view.loans.length === 0 ? (
                  <p className="empty-state">No player is on loan in either direction.</p>
                ) : (
                  <ul className="report-list">
                    {view.loans.map((row) => (
                      <li key={`${row.playerId}-${row.endDate}`}>
                        <button className="link" onClick={() => setPlayer(row.playerId)}>
                          {row.playerName}
                        </button>{" "}
                        <span className="subtle">
                          {row.direction === "IN" ? "on loan from" : "on loan at"}{" "}
                          {row.otherClubName} · until {row.endDate.slice(0, 10)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
            {view.authorities.includes("SQUAD_PLANNING") && (
              <Panel title="Contracts to resolve this cycle">
                {view.expiringContracts.length === 0 ? (
                  <p className="empty-state">
                    No contract at the club expires within the next twelve months.
                  </p>
                ) : (
                  <ul className="report-list">
                    {view.expiringContracts.map((row) => (
                      <li key={row.playerId}>
                        <button className="link" onClick={() => setPlayer(row.playerId)}>
                          {row.playerName}
                        </button>{" "}
                        <span className="subtle">
                          expires {row.endDate.slice(0, 10)} · {money(row.monthlyWage)} per month
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
          </>
        )
      }
    </AsyncPanel>
  );
};

/**
 * The general secretary's operations desk. Their four authorities all have
 * canonical commands on the service already; what was missing was any surface
 * telling them what needs administering. Each section renders only when the
 * matching authority is genuinely delegated, and each action calls the same
 * canonical command an owner-driven path would.
 */
const SecretaryDesk = ({
  bridge,
  clubId,
}: {
  bridge: DesktopRuntimeApi;
  clubId: EntityId;
}): React.ReactElement => {
  const [player, setPlayer] = useState<EntityId | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [desk, refresh] = useRuntimeData(
    async () => bridge.getSecretaryOperationsDesk(clubId),
    [clubId],
  );
  const closeLicence = async (caseId: EntityId, seasonLabel: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const result = await bridge.closeExecutiveLicence(caseId);
    setBusy(false);
    if (result.ok) {
      setError(null);
      setMessage(`Licence cycle for ${seasonLabel} closed and filed with the federation.`);
      refresh();
    } else setError(result.error);
  };
  if (player)
    return <PlayerContextPanel bridge={bridge} playerId={player} onClose={() => setPlayer(null)} />;
  return (
    <AsyncPanel state={desk}>
      {(view) =>
        view.blockedReason ? (
          <Panel title="Club operations">
            <p className="empty-state">{view.blockedReason}</p>
          </Panel>
        ) : (
          <>
            {error && <ErrorBanner error={error} />}
            {message && (
              <p className="notice" role="status">
                {message}
              </p>
            )}
            <Panel title="Club operations">
              <Metrics
                items={[
                  { label: "Contracts to file", value: String(view.contracts.length) },
                  {
                    label: "Open licence cases",
                    value: String(view.licensing.filter((item) => item.canClose).length),
                  },
                  {
                    label: "Teams to register",
                    value: String(view.registrations.filter((item) => item.registrable).length),
                  },
                  { label: "Staff vacancies", value: String(view.openVacancies) },
                ]}
              />
              <p className="subtle">
                {view.clubName} — the club's administrative workload: contract paperwork, the
                federation licence cycle, competition registration and the staff roster.
              </p>
            </Panel>
            {view.authorities.includes("LICENSING") && (
              <Panel title="Federation licensing">
                {view.licensing.length === 0 ? (
                  <p className="empty-state">
                    The federation has opened no licence case for this club.
                  </p>
                ) : (
                  <ul className="report-list">
                    {view.licensing.map((item) => (
                      <li key={item.caseId}>
                        <strong>{item.seasonLabel}</strong>{" "}
                        <Badge tone={item.canClose ? "warn" : "ok"}>
                          {humanizeToken(item.status)}
                        </Badge>
                        {item.outstanding.length === 0 ? (
                          <p className="subtle">No outstanding requirement on this case.</p>
                        ) : (
                          <ul className="compact-list">
                            {item.outstanding.map((task) => (
                              <li key={task.requirement}>
                                {task.requirement} — due {task.deadline.slice(0, 10)}
                              </li>
                            ))}
                          </ul>
                        )}
                        {item.sanctions.length > 0 && (
                          <p className="subtle">
                            Sanctions: {item.sanctions.map(humanizeToken).join(", ")}
                          </p>
                        )}
                        {item.canClose && (
                          <button
                            className="primary small"
                            disabled={busy}
                            onClick={() => void closeLicence(item.caseId, item.seasonLabel)}
                          >
                            {busy ? "Filing…" : "Close licence cycle"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
            {view.authorities.includes("COMPETITION_REGISTRATION") && (
              <Panel title="Competition registration">
                {view.registrations.length === 0 ? (
                  <p className="empty-state">This club has no team on the register.</p>
                ) : (
                  <ul className="report-list">
                    {view.registrations.map((row) => (
                      <li key={row.teamId}>
                        <strong>{row.teamName}</strong>{" "}
                        <span className="subtle">
                          {row.registeredPlayers} of {row.squadSize} players registered
                        </span>
                        {row.registrable && (
                          <p className="subtle">
                            This squad has players awaiting registration for the women's
                            competition.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
            {view.authorities.includes("CONTRACT_ADMINISTRATION") && (
              <Panel title="Contract paperwork">
                {view.contracts.length === 0 ? (
                  <p className="empty-state">
                    No contract at the club runs out inside the next four months.
                  </p>
                ) : (
                  <ul className="report-list">
                    {view.contracts.map((row) => (
                      <li key={row.playerId}>
                        <button className="link" onClick={() => setPlayer(row.playerId)}>
                          {row.playerName}
                        </button>{" "}
                        <span className="subtle">
                          {humanizeToken(row.contractType)} · expires {row.endDate.slice(0, 10)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
            {view.authorities.includes("STAFF_RECRUITMENT") && (
              <Panel title="Staff roster">
                {view.staff.length === 0 ? (
                  <p className="empty-state">The club has no active staff appointment on record.</p>
                ) : (
                  <ul className="report-list">
                    {view.staff.map((row) => (
                      <li key={row.appointmentId}>
                        <strong>{row.personName}</strong>{" "}
                        <span className="subtle">
                          {humanizeToken(row.role)}
                          {row.startDate ? ` · since ${row.startDate.slice(0, 10)}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {view.openVacancies > 0 && (
                  <p className="subtle">
                    {view.openVacancies} staff{" "}
                    {view.openVacancies === 1 ? "vacancy is" : "vacancies are"} open at the club.
                  </p>
                )}
              </Panel>
            )}
          </>
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
  const [openPressInterviewId, setOpenPressInterviewId] = useState<EntityId | null>(null);
  const pressFocus = useReturnFocusOnClose();
  const canSetBudget = authority.permittedActions.includes("BUDGET_ADMINISTRATION");
  const canManageCommercial = authority.permittedActions.includes("COMMERCIAL_OVERSIGHT");
  const canManageFacilities = authority.permittedActions.includes("FACILITY_OVERSIGHT");
  // Recruitment-side authority — the sporting director / director of football half
  // of the executive model, which previously had no rendered surface at all.
  const canWorkRecruitment = (
    ["RECRUITMENT_STRATEGY", "TRANSFER_NEGOTIATION", "LOAN_STRATEGY", "SQUAD_PLANNING"] as const
  ).some((item) => authority.permittedActions.includes(item));
  // Administrative authority — the general secretary / CEO half of the model.
  const canAdminister = (
    [
      "CONTRACT_ADMINISTRATION",
      "LICENSING",
      "COMPETITION_REGISTRATION",
      "STAFF_RECRUITMENT",
    ] as const
  ).some((item) => authority.permittedActions.includes(item));
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
      {canWorkRecruitment && <RecruitmentDesk bridge={bridge} clubId={authority.clubId} />}
      {canWorkRecruitment && (
        <InboxPanel
          inbox={authority.inbox}
          bridge={bridge}
          onOpenPressConference={(interviewId) => {
            pressFocus.capture();
            setOpenPressInterviewId(interviewId);
          }}
        />
      )}
      {canAdminister && <SecretaryDesk bridge={bridge} clubId={authority.clubId} />}
      {canSetBudget && <BankMeeting bridge={bridge} role="CEO" clubId={authority.clubId} />}
      {canManageCommercial && <SponsorMeeting bridge={bridge} role="CEO" clubId={authority.clubId} />}
      {canManageFacilities && <FacilityPlanner bridge={bridge} clubId={authority.clubId} />}
      {openPressInterviewId && (
        <StructuredPressConferencePanel
          interviewId={openPressInterviewId}
          sportingDirectorContext
          onClose={() => {
            setOpenPressInterviewId(null);
            refresh();
            pressFocus.restore();
          }}
        />
      )}
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
      {/* A section heading, not a second page title: the sidebar's club (or
       * federation) name is the shell's single <h1> for every role, exactly as
       * on the Manager screens. Owner and President previously rendered a
       * second level-1 heading here, so those shells announced two page
       * titles. .page-header styles h1 and h2 identically, so this changes the
       * document outline without changing what the player sees, and every spec
       * asserting this title matches by name without a level.
       *
       * tabIndex=-1 is preserved: programmatically focusable (never in the Tab
       * order) so useReturnFocusOnClose has a real, always-present landing spot
       * when a closed panel's own triggering element is gone. */}
      <h2 tabIndex={-1}>{roleName(header.activeRole)}</h2>
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
  // The single natural Owner press entry point — evaluated once when the
  // dashboard opens, mirroring evaluatePreMatchPress's own natural-trigger
  // pattern for the Manager. Creates an interview only from a genuinely new
  // real club-business fact (never a recurring schedule); a no-op refresh
  // when there is nothing new. The created interview then surfaces through
  // the dashboard's own Inbox (ownerPressInboxItems), never a second UI.
  useEffect(() => {
    let cancelled = false;
    void managerBridge.evaluateOwnerBusinessPress().then((result) => {
      if (!cancelled && result.ok && result.data) refresh();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const [openPressInterviewId, setOpenPressInterviewId] = useState<EntityId | null>(null);
  const pressFocus = useReturnFocusOnClose();
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
                  {item.holderName} · {item.percentage === undefined ? "shared holding" : `${item.percentage}%`} ·{" "}
                  {item.role.replaceAll("_", " ").toLowerCase()}
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
      <InboxPanel
        inbox={dashboard.inbox}
        bridge={bridge}
        onOpenPressConference={(interviewId) => {
          pressFocus.capture();
          setOpenPressInterviewId(interviewId);
        }}
      />
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
      {openPressInterviewId && (
        <StructuredPressConferencePanel
          interviewId={openPressInterviewId}
          ownerContext
          onClose={() => {
            setOpenPressInterviewId(null);
            refresh();
            pressFocus.restore();
          }}
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
  // The single natural President press entry point — evaluated once when
  // the federation dashboard opens, mirroring evaluateOwnerBusinessPress's
  // own natural-trigger pattern. Creates an interview only from a
  // genuinely new real federation-governance fact (never a recurring
  // schedule); a no-op refresh when there is nothing new. The created
  // interview then surfaces through the dashboard's own Inbox
  // (presidentPressInboxItems), never a second UI.
  useEffect(() => {
    let cancelled = false;
    void managerBridge.evaluatePresidentPress().then((result) => {
      if (!cancelled && result.ok && result.data) refresh();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const [openPressInterviewId, setOpenPressInterviewId] = useState<EntityId | null>(null);
  const pressFocus = useReturnFocusOnClose();
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
      <Panel title="Federation world">
        <FederationEnvironmentScene
          dashboard={dashboard}
          fallback={
            <p className="empty-state">
              {dashboard.federation.name} headquarters and national football centre — 3D presentation
              unavailable or turned off; see the summary panels below for the same facts.
            </p>
          }
          onOpenGovernance={() => onNavigate("governance")}
          onOpenNationalDevelopment={() => onNavigate("national-development")}
        />
      </Panel>
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
                  {item.title} · {humanizeEnum(item.status)}
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
      <InboxPanel
        inbox={dashboard.inbox}
        bridge={bridge}
        onOpenPressConference={(interviewId) => {
          pressFocus.capture();
          setOpenPressInterviewId(interviewId);
        }}
      />
      <EntityStorylinePanel bridge={bridge} entityId={dashboard.federation.id} onOpenReference={openReference} />
      {openReferenceTarget && (
        <OrganizationProfilePanel
          bridge={bridge}
          entityType={openReferenceTarget.entityType}
          entityId={openReferenceTarget.entityId}
          onClose={() => setOpenReferenceTarget(null)}
        />
      )}
      {openPressInterviewId && (
        <StructuredPressConferencePanel
          interviewId={openPressInterviewId}
          presidentContext
          onClose={() => {
            setOpenPressInterviewId(null);
            refresh();
            pressFocus.restore();
          }}
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

// InboxPanel now lives in RoleDetailScreen.tsx (shared with Manager Home,
// which cannot import from this file without a circular dependency).

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
