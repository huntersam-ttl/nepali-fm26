import React from "react";
import type { EntityId, EntityReference } from "@nepal-football-sim/shared-types";
import type { ManagerWorkspace } from "../navigation.js";
import { managerBridge } from "./managerBridge.js";
import { useRuntimeData, AsyncPanel, FormRun, Metrics, Panel } from "./ui.js";
import { StatusChip } from "./StatusChip.js";
import { attentionLimit, managerPrimaryPriority } from "./homePriorities.js";

/**
 * Phase 2B — Manager Home / Daily Hub.
 *
 * A single aggregate read (getManagerDashboard + getCalendar) drives a clear
 * hierarchy instead of a grid of equal cards:
 *   HERO - next fixture (real state), opponent club as a canonical CLUB link,
 *          primary actions (Match Day / Tactics / Squad).
 *   CLUB - league stance. ATTENTION - bounded actionable inbox items.
 *   STATE - squad availability / readiness as a stats strip.
 *   UPCOMING / COMPETITION - calendar + recent results with navigation.
 *
 * Empty/unknown states use the Phase 2A grammar; nothing is invented. Read and
 * navigate only — routing goes through Phase 1 onNavigate/onOpenEntity.
 */

const useDashboard = (refreshKey: number) =>
  useRuntimeData(() => managerBridge.getManagerDashboard(), [refreshKey]);
const useCalendar = (refreshKey: number) => useRuntimeData(() => managerBridge.getCalendar(), [refreshKey]);

export const HomeCommandCentre = ({
  refreshKey,
  onNavigate,
  onSelectPlayer,
  onOpenEntity,
}: {
  refreshKey: number;
  onNavigate: (next: ManagerWorkspace) => void;
  onSelectPlayer: (playerId: EntityId) => void;
  onOpenEntity: (reference: EntityReference) => void;
}): React.ReactElement => {
  const [state] = useDashboard(refreshKey);
  const [calendar] = useCalendar(refreshKey);

  return (
    <AsyncPanel state={state}>
      {(dashboard) => {
        const primary = managerPrimaryPriority(dashboard);
        if (dashboard.employmentStatus === "UNEMPLOYED") {
          return (
            <div className="surface-secondary">
              <span className="page-eyebrow">Career</span>
              <div className="state-empty">You are currently unemployed. Use the job market to find your next role.</div>
            </div>
          );
        }

        const nextFixture = dashboard.nextFixture;
        const attention = dashboard.inbox;
        const squad = dashboard.squadAvailability;

        return (
          <section className="dashboard home-command-centre" aria-label="Manager home">
            {/* HERO + club stance */}
            <div className="u-split home-hero-row">
              <Panel title="Next fixture" className="surface-hero">
                <span className="page-eyebrow">Match day · {primary === "NEXT_MATCH" ? "next up" : "preparing"}</span>
                {nextFixture ? (
                  <>
                    <p className="home-opponent">
                      {nextFixture.homeAway === "home" ? "vs" : "at"} {nextFixture.opponent}
                    </p>
                    {nextFixture.opponentClub && (
                      <button className="link" onClick={() => onOpenEntity(nextFixture.opponentClub!)}>
                        {nextFixture.opponentClub.label}
                      </button>
                    )}
                    <p className="page-metadata">
                      {nextFixture.competition} · {nextFixture.date}
                      {nextFixture.venue ? ` · ${nextFixture.venue}` : ""}
                    </p>
                    <div className="button-row">
                      <button className="primary" onClick={() => onNavigate("fixtures")}>
                        Match Day
                      </button>
                      <button className="ghost" onClick={() => onNavigate("tactics")}>
                        Set Tactics
                      </button>
                      <button className="ghost" onClick={() => onNavigate("squad")}>
                        View Squad
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="state-empty">No fixture scheduled.</p>
                )}
              </Panel>

              <Panel title="Club">
                <Metrics
                  items={[
                    { label: "Position", value: dashboard.leaguePosition ?? "—" },
                    { label: "Played", value: dashboard.played },
                    { label: "Points", value: dashboard.points },
                    {
                      label: "Board confidence",
                      value: dashboard.boardConfidence === undefined ? "—" : Math.round(dashboard.boardConfidence),
                    },
                  ]}
                />
                {dashboard.form.length > 0 && (
                  <div className="stats-strip">
                    <span className="data-label">Form</span>
                    <FormRun form={dashboard.form} />
                  </div>
                )}
              </Panel>
            </div>
            {/* ATTENTION: bounded, actionable inbox items */}
            <h3 className="section-title">Attention</h3>
            {attention.length === 0 ? (
              <p className="state-noresults">No open decisions in your inbox.</p>
            ) : (
              <ul className="report-list home-attention">
                {attention.slice(0, attentionLimit(attention.length)).map((item) => (
                  <li key={item.id}>
                    <div className="home-attention-title">
                      <span>{item.title}</span>
                      {item.importanceBand && <StatusChip label={item.importanceBand} status={item.importanceBand} />}
                    </div>
                    {item.entityReferences && item.entityReferences.length > 0 ? (
                      <button className="link" onClick={() => onOpenEntity(item.entityReferences![0])}>
                        {item.body}
                      </button>
                    ) : (
                      <span className="page-metadata">{item.body}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* STATE: squad availability / readiness as a stats strip */}
            <div className="surface-primary home-state">
              <h3 className="section-title">Squad</h3>
              <div className="stats-strip">
                <div>
                  <span className="data-label">Available</span>
                  <span className="stat-value">{squad.available}</span>
                </div>
                <div>
                  <span className="data-label">Injured</span>
                  <span className="stat-value">{squad.injured}</span>
                </div>
                <div>
                  <span className="data-label">Suspended</span>
                  <span className="stat-value">{squad.suspended}</span>
                </div>
                <div>
                  <span className="data-label">Morale</span>
                  <span className="data-value">{dashboard.moraleSummary}</span>
                </div>
                <div>
                  <span className="data-label">Training</span>
                  <span className="data-value">{dashboard.trainingSummary}</span>
                </div>
                <div>
                  <span className="data-label">Transfers active</span>
                  <span className="stat-value">{dashboard.transferActivity}</span>
                </div>
                <div>
                  <span className="data-label">Contracts expiring</span>
                  <span className="stat-value">{dashboard.contractIssues}</span>
                </div>
              </div>
              {squad.injured + squad.suspended === 0 && <p className="ok">No injuries or suspensions.</p>}
            </div>

            {/* UPCOMING / COMPETITION CONTEXT */}
            <div className="u-split">
              <div className="u-stack">
                <Panel
                  title="Upcoming"
                  actions={<button className="ghost small" onClick={() => onNavigate("fixtures")}>Open fixtures</button>}
                >
                  {calendar.status === "ready" && calendar.data.length > 0 ? (
                    <ul className="report-list">
                      {calendar.data.slice(0, 5).map((entry) => (
                        <li key={`${entry.date}-${entry.title}`}>
                          <span className="page-metadata">{entry.date}</span> · {entry.title}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="state-empty">No upcoming events are scheduled.</p>
                  )}
                </Panel>

                <Panel
                  title="Recent results"
                  actions={<button className="ghost small" onClick={() => onNavigate("competition")}>See competition</button>}
                >
                  {dashboard.recentResults.length === 0 ? (
                    <p className="state-empty">No results yet.</p>
                  ) : (
                    <ul className="report-list">
                      {dashboard.recentResults.map((result) => (
                        <li key={result.id}>
                          {result.date} · {result.competition} · {result.homeAway === "home" ? "vs" : "at"}{" "}
                          {result.opponent}
                          {result.score ? ` · ${result.score}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>

              <Panel
                title="League context"
                actions={<button className="ghost small" onClick={() => onNavigate("competition")}>Open table</button>}
              >
                <Metrics
                  items={[
                    { label: "Competition", value: dashboard.competitionName },
                    { label: "Position", value: dashboard.leaguePosition ?? "—" },
                    { label: "Played", value: dashboard.played },
                    { label: "Points", value: dashboard.points },
                  ]}
                />
              </Panel>
            </div>
          </section>
        );
      }}
    </AsyncPanel>
  );
};