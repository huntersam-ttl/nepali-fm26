import React, { useState } from "react";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, FormRun, Metrics, Panel, useRuntimeData } from "../ui.js";

export const HomeScreen = ({
  onContinue,
  busy,
  refreshKey,
  onAction,
}: {
  onContinue: () => void;
  busy: boolean;
  refreshKey: number;
  onAction: () => Promise<void>;
}): React.ReactElement => {
  const [state, refreshDashboard] = useRuntimeData(() => managerBridge.getManagerDashboard(), [
    refreshKey,
  ]);
  const [calendar] = useRuntimeData(() => managerBridge.getCalendar(), [refreshKey]);
  const [history] = useRuntimeData(() => managerBridge.getCareerHistory(), [refreshKey]);
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
                    { label: "Club", value: dashboard.clubName ?? "Unemployed" },
                    { label: "Competition", value: dashboard.competitionName },
                    { label: "Position", value: dashboard.leaguePosition ?? "—" },
                    { label: "Played", value: dashboard.played },
                    { label: "Points", value: dashboard.points },
                    { label: "Date", value: dashboard.worldDate },
                    { label: "Board confidence", value: dashboard.boardConfidence ?? "—" },
                    { label: "Board expects", value: dashboard.boardExpectation ?? "—" },
                  ]}
                />
                <p>
                  Form <FormRun form={dashboard.form} />
                </p>
              </>
            )}
            <div className="button-row">
              <button className="primary" disabled={busy} onClick={onContinue}>
                {busy ? "Advancing…" : "Continue"}
              </button>
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
              <Panel title="Next fixture">
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

              <Panel title="Squad availability">
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

              <Panel title="Club attention">
                <Metrics
                  items={[
                    { label: "Training", value: dashboard.trainingSummary },
                    { label: "Scout reports (30d)", value: dashboard.scoutingUpdates },
                    { label: "Active transfers", value: dashboard.transferActivity },
                    { label: "Contracts expiring", value: dashboard.contractIssues },
                    { label: "Staff vacancies", value: dashboard.staffIssues },
                  ]}
                />
              </Panel>

              <Panel title="Recent results">
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
        </section>
      )}
    </AsyncPanel>
  );
};
