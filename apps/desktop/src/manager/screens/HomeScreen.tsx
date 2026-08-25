import React from "react";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, FormRun, Metrics, Panel, useRuntimeData } from "../ui.js";

export const HomeScreen = ({
  onContinue,
  busy,
  refreshKey,
}: {
  onContinue: () => void;
  busy: boolean;
  refreshKey: number;
}): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getManagerDashboard(), [refreshKey]);
  const [calendar] = useRuntimeData(() => managerBridge.getCalendar(), [refreshKey]);

  return (
    <AsyncPanel state={state}>
      {(dashboard) => (
        <section className="dashboard">
          <Panel title="Club">
            <Metrics
              items={[
                { label: "Club", value: dashboard.clubName ?? "Unemployed" },
                { label: "Competition", value: dashboard.competitionName },
                { label: "Position", value: dashboard.leaguePosition ?? "—" },
                { label: "Played", value: dashboard.played },
                { label: "Points", value: dashboard.points },
                { label: "Date", value: dashboard.worldDate },
              ]}
            />
            <p>
              Form <FormRun form={dashboard.form} />
            </p>
            <button className="primary" disabled={busy} onClick={onContinue}>
              {busy ? "Advancing…" : "Continue"}
            </button>
          </Panel>

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
                    {fixture.date} · {fixture.homeAway === "home" ? "vs" : "at"} {fixture.opponent}{" "}
                    · <strong>{fixture.score}</strong>{" "}
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
        </section>
      )}
    </AsyncPanel>
  );
};
