import React, { useState } from "react";
import type { ConcernResponseAction, EntityId, FederationCandidacyAssessment } from "@nepal-football-sim/shared-types";
import type { DesktopRuntimeApi } from "../../appBridge.js";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, FormRun, Metrics, Panel, useRuntimeData } from "../ui.js";
import { OwnerPlayerRequestInbox } from "./OwnerPlayerRequestInbox.js";

const concernLabel = (type: string): string => {
  switch (type) {
    case "PLAYING_TIME":
      return "Playing time";
    case "CONTRACT":
      return "Contract";
    case "ROLE_STATUS":
      return "Squad status";
    case "TRANSFER_INTEREST":
      return "Transfer interest";
    default:
      return type;
  }
};

const actionLabel = (action: ConcernResponseAction): string => {
  switch (action) {
    case "REASSURE":
      return "Reassure";
    case "PROMISE_PLAYING_TIME":
      return "Promise more minutes";
    case "PROMISE_CONTRACT_REVIEW":
      return "Promise contract review";
    case "PROMISE_SQUAD_ROLE":
      return "Promise squad status review";
    case "PROMISE_TRANSFER_STANCE":
      return "Promise to keep them";
    case "DISMISS":
      return "Dismiss";
    default:
      return action;
  }
};

const groupLabel = (groupType: string): string => {
  switch (groupType) {
    case "CORE_LEADERS":
      return "Core leaders";
    case "MAIN_GROUP":
      return "Main group";
    case "PERIPHERAL":
      return "Peripheral";
    default:
      return groupType;
  }
};

const meetingTypeLabel = (type: string): string => {
  switch (type) {
    case "ONE_TO_ONE":
      return "One-to-one";
    case "MEDIATE_DISPUTE":
      return "Mediation";
    case "ADDRESS_MANAGER_DISPUTE":
      return "Cleared the air";
    case "CAPTAIN_CONSULTATION":
      return "Captain consultation";
    case "SQUAD_MEETING":
      return "Squad meeting";
    default:
      return type;
  }
};

export const CandidacyPanel = (): React.ReactElement => {
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; data: FederationCandidacyAssessment } | { status: "error"; message: string }>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const load = async (): Promise<void> => {
    const result = await managerBridge.getFederationCandidacy();
    setState(result.ok ? { status: "ready", data: result.data } : { status: "error", message: result.error.message });
  };
  React.useEffect(() => { void load(); }, []);
  if (state.status === "loading") return <Panel title="ANFA Presidency Path"><p className="muted">Loading eligibility…</p></Panel>;
  if (state.status === "error") return <Panel title="ANFA Presidency Path"><p className="subtle">{state.message}</p></Panel>;
  const assessment = state.data;
  return <Panel title="ANFA Presidency Path"><Metrics items={[{ label: "Game election eligibility", value: assessment.eligible ? "Eligible to stand" : "Not eligible" }, { label: "Nepal career seasons", value: assessment.careerSeasons }, { label: "Game reputation", value: assessment.reputation }, { label: "Next election", value: assessment.nextElectionDate ?? "Not scheduled" }]} />{assessment.reasons.length > 0 && <ul className="compact-list">{assessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}{assessment.eligible && !assessment.candidateId && <button className="primary" disabled={busy} onClick={async () => { setBusy(true); await managerBridge.declareFederationElectionCandidacy(); await load(); setBusy(false); }}>{busy ? "Declaring…" : "Declare Candidacy"}</button>} </Panel>;
};

export const HomeScreen = ({
  busy,
  refreshKey,
  onAction,
  onNavigate,
  bridge,
  onSelectPlayer,
}: {
  busy: boolean;
  refreshKey: number;
  onAction: () => Promise<void>;
  onNavigate: (screen: "squad" | "tactics" | "fixtures" | "staff" | "contracts" | "competition") => void;
  bridge: DesktopRuntimeApi;
  onSelectPlayer: (playerId: EntityId) => void;
}): React.ReactElement => {
  const [state, refreshDashboard] = useRuntimeData(() => managerBridge.getManagerDashboard(), [
    refreshKey,
  ]);
  const [calendar] = useRuntimeData(() => managerBridge.getCalendar(), [refreshKey]);
  const [history] = useRuntimeData(() => managerBridge.getCareerHistory(), [refreshKey]);
  const [concerns, refreshConcerns] = useRuntimeData(() => managerBridge.getSquadConcerns(), [refreshKey]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (key: string, run: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setActionBusy(key);
    setActionError(null);
    const result = await run();
    setActionBusy(null);
    if (!result.ok) {
      setActionError(result.error?.message ?? "That action failed.");
      return;
    }
    refreshDashboard();
    await onAction();
  };

  return (
    <AsyncPanel state={state}>
      {(dashboard) => (
        <section className="dashboard">
          {actionError && (
            <div className="warning" role="alert">
              {actionError}
            </div>
          )}
          <Panel title="Club">
            {dashboard.employmentStatus === "UNEMPLOYED" ? (
              <>
                <p className="empty-state">You are currently unemployed.</p>
                <Metrics items={[{ label: "Date", value: dashboard.worldDate }]} />
              </>
            ) : (
              <>
                <Metrics
                  items={[
                    /*
                     * Club, competition and date are permanently on screen in the
                     * sidebar and top bar. Repeating them here squeezed a full
                     * league name into a narrow metric cell, so this panel now
                     * carries only the standing that belongs to it.
                     */
                    { label: "Position", value: dashboard.leaguePosition ?? "—" },
                    { label: "Played", value: dashboard.played },
                    { label: "Points", value: dashboard.points },
                    {
                      label: "Board confidence",
                      value:
                        dashboard.boardConfidence === undefined
                          ? "—"
                          : Math.round(dashboard.boardConfidence),
                    },
                    { label: "Board expects", value: dashboard.boardExpectation ?? "—" },
                  ]}
                />
                <p>
                  Form <FormRun form={dashboard.form} />
                </p>
              </>
            )}
            {/*
             * Advancing the world is the shell's Continue, which also refuses to
             * skip a matchday. A second copy here ran the same action without
             * that guard, so the club panel keeps only what is specific to it.
             */}
            <div className="button-row">
              {dashboard.employmentStatus === "EMPLOYED" && (
                <button
                  className="ghost"
                  disabled={actionBusy !== null}
                  onClick={() => void runAction("resign", () => managerBridge.resignFromClub())}
                >
                  {actionBusy === "resign" ? "Resigning…" : "Resign"}
                </button>
              )}
            </div>
          </Panel>

          {dashboard.employmentStatus === "UNEMPLOYED" && dashboard.jobCentre && (
            <Panel title="Job Centre">
              <p className="subtle">Reputation: {dashboard.jobCentre.reputationProfile}</p>
              <h3>Open vacancies</h3>
              {dashboard.jobCentre.vacancies.length === 0 ? (
                <p className="empty-state">No manager vacancies are open right now.</p>
              ) : (
                <ul className="report-list">
                  {dashboard.jobCentre.vacancies.map((vacancy) => (
                    <li key={vacancy.id}>
                      <strong>{vacancy.clubName}</strong> · {vacancy.competitionName}
                      <span className="subtle"> · expects {vacancy.boardExpectation}</span>
                      {!vacancy.eligible && vacancy.eligibilityNote && (
                        <div className="subtle">{vacancy.eligibilityNote}</div>
                      )}
                      <div className="button-row">
                        <button
                          className="ghost small"
                          disabled={!vacancy.eligible || actionBusy !== null}
                          onClick={() =>
                            void runAction(`apply-${vacancy.id}`, () =>
                              managerBridge.applyForJob(vacancy.id as EntityId),
                            )
                          }
                        >
                          {actionBusy === `apply-${vacancy.id}` ? "Applying…" : "Apply"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <h3>Your applications</h3>
              {dashboard.jobCentre.applications.length === 0 ? (
                <p className="empty-state">You have not applied anywhere yet.</p>
              ) : (
                <ul className="report-list">
                  {dashboard.jobCentre.applications.map((application) => (
                    <li key={application.id}>
                      <strong>{application.clubName}</strong>{" "}
                      <Badge
                        tone={
                          application.status === "OFFERED" || application.status === "ACCEPTED"
                            ? "ok"
                            : application.status === "PENDING"
                              ? "info"
                              : "bad"
                        }
                      >
                        {application.status}
                      </Badge>
                      {application.status === "OFFERED" && (
                        <div className="button-row">
                          <button
                            className="primary small"
                            disabled={actionBusy !== null}
                            onClick={() =>
                              void runAction(`accept-${application.id}`, () =>
                                managerBridge.acceptJobOffer(application.id as EntityId),
                              )
                            }
                          >
                            {actionBusy === `accept-${application.id}` ? "Accepting…" : "Accept"}
                          </button>
                          <button
                            className="ghost small"
                            disabled={actionBusy !== null}
                            onClick={() =>
                              void runAction(`decline-${application.id}`, () =>
                                managerBridge.declineJobOffer(application.id as EntityId),
                              )
                            }
                          >
                            Decline
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {dashboard.employmentStatus === "EMPLOYED" && (
            <>
              <Panel title="Next fixture" actions={<button className="ghost small" onClick={() => onNavigate("fixtures")}>Open fixtures</button>}>
                {dashboard.nextFixture ? (
                  <>
                    <h2>
                      {dashboard.nextFixture.homeAway === "home" ? "vs" : "at"}{" "}
                      {dashboard.nextFixture.opponent}
                    </h2>
                    <p className="subtle">
                      {dashboard.nextFixture.date} · {dashboard.nextFixture.competition}
                      {dashboard.nextFixture.venue ? ` · ${dashboard.nextFixture.venue}` : ""}
                    </p>
                  </>
                ) : (
                  <p className="empty-state">No fixture scheduled.</p>
                )}
              </Panel>

              <Panel title="Squad availability" actions={<button className="ghost small" onClick={() => onNavigate("squad")}>Open squad</button>}>
                <Metrics
                  items={[
                    { label: "Squad", value: dashboard.squadAvailability.total },
                    { label: "Available", value: dashboard.squadAvailability.available },
                    { label: "Injured", value: dashboard.squadAvailability.injured },
                    { label: "Suspended", value: dashboard.squadAvailability.suspended },
                    { label: "Other", value: dashboard.squadAvailability.unavailable },
                  ]}
                />
                <p className="subtle">Morale: {dashboard.moraleSummary}</p>
                {dashboard.squadAvailability.injured === 0 &&
                  dashboard.squadAvailability.suspended === 0 && (
                    <p className="ok">No injuries or suspensions.</p>
                  )}
              </Panel>

              <Panel title="Club attention" actions={<div className="button-row"><button className="ghost small" onClick={() => onNavigate("staff")}>Staff</button><button className="ghost small" onClick={() => onNavigate("contracts")}>Contracts</button></div>}>
                <Metrics
                  items={[
                    { label: "Training", value: dashboard.trainingSummary },
                    { label: "Scout reports (30d)", value: dashboard.scoutingUpdates },
                    { label: "Active transfers", value: dashboard.transferActivity },
                    { label: "Contracts expiring", value: dashboard.contractIssues },
                    { label: "Staff vacancies", value: dashboard.staffIssues },
                    { label: "Player concerns", value: dashboard.concernCount ?? 0 },
                    { label: "Dressing room", value: dashboard.cohesionLevel ?? "STABLE" },
                  ]}
                />
              </Panel>

              <Panel title="Medical Centre">
                {(dashboard.medicalCentre ?? []).filter((item) => item.availabilityRecommendation !== "FULLY_FIT").slice(0, 5).map((item) => (
                  <p key={item.id} className="subtle">
                    <strong>{item.playerName}</strong>: {item.availabilityRecommendation.replaceAll("_", " ").toLowerCase()} · return {item.estimatedReturnStart}–{item.estimatedReturnEnd} · {item.workloadFlag.toLowerCase()} load
                  </p>
                ))}
                {(dashboard.medicalCentre ?? []).every((item) => item.availabilityRecommendation === "FULLY_FIT") && <p className="ok">No medical restrictions.</p>}
              </Panel>

              <Panel title="Dressing room">
                <AsyncPanel state={concerns}>
                  {(view) => (
                    <>
                      <Metrics
                        items={[
                          { label: "Atmosphere", value: view.cohesion.level },
                          { label: "Cohesion", value: view.cohesion.score },
                          { label: "Captain", value: view.cohesion.captainName ?? "None" },
                          { label: "Captain's influence", value: view.cohesion.captainInfluence },
                        ]}
                      />
                      {view.cohesion.topIssue && (
                        <p className="warning" role="alert">
                          {view.cohesion.topIssue}
                        </p>
                      )}
                      <ul className="report-list">
                        {(["CORE_LEADERS", "MAIN_GROUP", "PERIPHERAL"] as const).map((groupType) => {
                          const members = view.groups.filter((member) => member.groupType === groupType);
                          if (members.length === 0) return null;
                          return (
                            <li key={groupType}>
                              <strong>{groupLabel(groupType)}</strong> ({members.length}):{" "}
                              {members.map((member) => member.playerName).join(", ")}
                            </li>
                          );
                        })}
                      </ul>

                      <div className="button-row">
                        <button
                          className="ghost small"
                          disabled={actionBusy !== null}
                          onClick={() =>
                            void runAction("meeting-captain", async () => {
                              const result = await managerBridge.holdSquadMeeting({
                                type: "CAPTAIN_CONSULTATION",
                              });
                              if (result.ok) refreshConcerns();
                              return result;
                            })
                          }
                        >
                          {actionBusy === "meeting-captain" ? "…" : "Consult captain"}
                        </button>
                        <button
                          className="ghost small"
                          disabled={actionBusy !== null}
                          onClick={() =>
                            void runAction("meeting-squad", async () => {
                              const result = await managerBridge.holdSquadMeeting({ type: "SQUAD_MEETING" });
                              if (result.ok) refreshConcerns();
                              return result;
                            })
                          }
                        >
                          {actionBusy === "meeting-squad" ? "…" : "Hold squad meeting"}
                        </button>
                      </div>

                      {view.disputes.length > 0 && (
                        <>
                          <h3>Open disputes</h3>
                          <ul className="report-list">
                            {view.disputes.map((dispute) => (
                              <li key={dispute.id}>
                                {dispute.kind === "PLAYER_VS_PLAYER" ? (
                                  <>
                                    <strong>{dispute.playerName}</strong> vs{" "}
                                    <strong>{dispute.withPlayerName}</strong>
                                  </>
                                ) : (
                                  <strong>{dispute.playerName}</strong>
                                )}{" "}
                                <span className="subtle">({concernLabel(dispute.concernType)})</span>
                                <div className="button-row">
                                  <button
                                    className="ghost small"
                                    disabled={actionBusy !== null}
                                    onClick={() =>
                                      void runAction(`meeting-dispute-${dispute.id}`, async () => {
                                        const result = await managerBridge.holdSquadMeeting({
                                          type:
                                            dispute.kind === "PLAYER_VS_PLAYER"
                                              ? "MEDIATE_DISPUTE"
                                              : "ADDRESS_MANAGER_DISPUTE",
                                          disputeId: dispute.kind === "PLAYER_VS_PLAYER" ? dispute.id : undefined,
                                          personId: dispute.kind === "PLAYER_VS_MANAGER" ? dispute.personId : undefined,
                                        });
                                        if (result.ok) refreshConcerns();
                                        return result;
                                      })
                                    }
                                  >
                                    {actionBusy === `meeting-dispute-${dispute.id}`
                                      ? "…"
                                      : dispute.kind === "PLAYER_VS_PLAYER"
                                        ? "Mediate"
                                        : "Address"}
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}

                      {view.meetings.length > 0 && (
                        <>
                          <h3>Recent meetings</h3>
                          <ul className="report-list">
                            {view.meetings.slice(0, 5).map((meeting) => (
                              <li key={meeting.id}>
                                {meeting.occurredOn} · {meetingTypeLabel(meeting.type)} ·{" "}
                                <Badge
                                  tone={
                                    meeting.outcome === "POSITIVE"
                                      ? "ok"
                                      : meeting.outcome === "NEUTRAL"
                                        ? "info"
                                        : "bad"
                                  }
                                >
                                  {meeting.outcome}
                                </Badge>
                                <div className="subtle">{meeting.summary}</div>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </>
                  )}
                </AsyncPanel>
              </Panel>

              <Panel title="Squad concerns">
                <AsyncPanel
                  state={concerns}
                  isEmpty={(view) => view.concerns.length === 0}
                  empty="No active squad concerns."
                >
                  {(view) => (
                    <ul className="report-list">
                      {view.concerns.map((concern) => (
                        <li key={concern.id}>
                          <strong>{concern.playerName}</strong>{" "}
                          <Badge tone={concern.status === "ESCALATED" ? "bad" : "warn"}>
                            {concernLabel(concern.type)}
                          </Badge>{" "}
                          <span className="subtle">({concern.status.toLowerCase()})</span>
                          {concern.note && <div className="subtle">{concern.note}</div>}
                          {concern.activePromise ? (
                            <div className="subtle">
                              Promise pending: {concern.activePromise.description} (due{" "}
                              {concern.activePromise.dueOn})
                            </div>
                          ) : (
                            <div className="button-row">
                              {concern.validActions.map((action) => (
                                <button
                                  key={action}
                                  className="ghost small"
                                  disabled={actionBusy !== null}
                                  onClick={() =>
                                    void runAction(`concern-${concern.id}-${action}`, async () => {
                                      const result = await managerBridge.respondToConcern(
                                        concern.id,
                                        action,
                                      );
                                      if (result.ok) refreshConcerns();
                                      return result;
                                    })
                                  }
                                >
                                  {actionBusy === `concern-${concern.id}-${action}`
                                    ? "…"
                                    : actionLabel(action)}
                                </button>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </AsyncPanel>
              </Panel>

              <Panel title="Recent results" actions={<button className="ghost small" onClick={() => onNavigate("competition")}>Competition</button>}>
                {dashboard.recentResults.length === 0 ? (
                  <p className="empty-state">No matches played yet.</p>
                ) : (
                  <ul className="report-list">
                    {dashboard.recentResults.map((fixture) => (
                      <li key={fixture.id}>
                        {fixture.date} · {fixture.homeAway === "home" ? "vs" : "at"}{" "}
                        {fixture.opponent} · <strong>{fixture.score}</strong>{" "}
                        {fixture.result && (
                          <Badge
                            tone={
                              fixture.result === "W" ? "ok" : fixture.result === "D" ? "info" : "bad"
                            }
                          >
                            {fixture.result}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </>
          )}

          <Panel title="Inbox">
            {dashboard.inbox.length === 0 ? (
              <p className="empty-state">Your inbox is empty.</p>
            ) : (
              dashboard.inbox.map((item) => (
                <div className="inbox-item" key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                  <span className="subtle">{item.createdOn}</span>
                </div>
              ))
            )}
          </Panel>

          {dashboard.employmentStatus === "EMPLOYED" && (
            <OwnerPlayerRequestInbox
              bridge={bridge}
              refreshKey={refreshKey}
              onSelectPlayer={onSelectPlayer}
            />
          )}

          <Panel title="Career history">
            <AsyncPanel state={history}>
              {(view) => (
                <>
                  <p className="subtle">
                    {view.jobsHeld} job{view.jobsHeld === 1 ? "" : "s"} · reputation:{" "}
                    {view.reputationProfile}
                  </p>
                  {view.history.length === 0 ? (
                    <p className="empty-state">No previous appointments yet.</p>
                  ) : (
                    <ul className="report-list">
                      {view.history.map((entry) => (
                        <li key={entry.contractId}>
                          {entry.clubName ?? entry.teamName ?? "Unknown club"} · {entry.start} –{" "}
                          {entry.end ?? "present"} · <Badge tone="info">{entry.outcome}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                  {view.trophies.length > 0 && (
                    <>
                      <h3>Trophies</h3>
                      <ul className="report-list">
                        {view.trophies.map((trophy, index) => (
                          <li key={`${trophy.wonOn}-${index}`}>
                            {trophy.competitionName} with {trophy.teamName} · {trophy.wonOn}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </AsyncPanel>
          </Panel>

          {dashboard.employmentStatus === "EMPLOYED" && (
            <Panel title="Calendar">
              <AsyncPanel
                state={calendar}
                isEmpty={(entries) => entries.length === 0}
                empty="Nothing scheduled in the next few months."
              >
                {(entries) => (
                  <ul className="report-list">
                    {entries.slice(0, 12).map((entry, index) => (
                      <li key={`${entry.date}-${index}`}>
                        {entry.date} · <strong>{entry.title}</strong>
                        {entry.detail ? ` · ${entry.detail}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </AsyncPanel>
            </Panel>
          )}

          {/*
           * The federation path is a long-horizon career option, not a manager's
           * daily business: it sits after the club, the next match and the squad
           * rather than above them.
           */}
          <CandidacyPanel />
        </section>
      )}
    </AsyncPanel>
  );
};
