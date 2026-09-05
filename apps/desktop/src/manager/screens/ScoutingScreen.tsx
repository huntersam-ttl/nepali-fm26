import React, { useState } from "react";
import type { EntityId, RecruitmentSearchPage } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Metrics, Panel, useRuntimeData } from "../ui.js";
import type { AppError } from "../../appBridge.js";
import { EntityRefLink } from "../RoleDetailScreen.js";

const PAGE_SIZE = 20;

export const ScoutingScreen = ({
  onSelectPlayer,
  onOpenClub,
}: {
  onSelectPlayer: (playerId: EntityId) => void;
  onOpenClub: (clubId: EntityId) => void;
}): React.ReactElement => {
  const [dashboard, refreshDashboard, replaceDashboard] = useRuntimeData(() =>
    managerBridge.getScoutingDashboard(),
  );
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [search, refreshSearch] = useRuntimeData(
    () => managerBridge.searchRecruitment({ query: query || undefined, page, pageSize: PAGE_SIZE }),
    [query, page],
  );
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (
    action: () => Promise<Awaited<ReturnType<typeof managerBridge.toggleShortlist>>>,
  ) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      replaceDashboard(result.data);
      setError(null);
      refreshSearch();
    } else {
      setError(result.error);
    }
  };

  return (
    <section className="dashboard">
      {error && <ErrorBanner error={error} />}

      <Panel title="Scouting coverage">
        <AsyncPanel state={dashboard}>
          {(view) => (
            <Metrics
              items={[
                { label: "Well known", value: view.coverage.knownPlayers },
                { label: "Discovered", value: view.coverage.discoveredPlayers },
                { label: "Unknown", value: view.coverage.unknownPlayers },
                { label: "Total players", value: view.coverage.totalPlayers },
              ]}
            />
          )}
        </AsyncPanel>
      </Panel>

      <Panel title="Recruitment search" className="panel-wide">
        <div className="table-tools">
          <label className="sr-label">
            Search players
            <input
              placeholder="Search known players"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
        <p className="subtle">
          You only see what your club actually knows. Undiscovered players stay hidden.
        </p>
        <AsyncPanel
          state={search}
          isEmpty={(data) => data.rows.length === 0}
          empty="No players match."
        >
          {(results: RecruitmentSearchPage) => (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Club</th>
                      <th>Position</th>
                      <th>Knowledge</th>
                      <th>Est. ability</th>
                      <th>Potential</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {results.rows.map((row) => (
                      <tr key={row.playerId}>
                        <td>
                          {row.name ? (
                            <button className="link" onClick={() => onSelectPlayer(row.playerId)}>
                              {row.name}
                            </button>
                          ) : (
                            <span className="unknown">Unknown player</span>
                          )}
                        </td>
                        <td>
                          {row.club ? (
                            <EntityRefLink reference={row.club} onOpen={(reference) => onOpenClub(reference.id)} />
                          ) : (
                            (row.clubName ?? "Free agent")
                          )}
                        </td>
                        <td>{row.knownPosition ?? row.positionGroup ?? "Unknown"}</td>
                        <td>
                          <Badge tone={row.knowledge === "NONE" ? "info" : "ok"}>
                            {row.knowledge.toLowerCase()}
                          </Badge>
                        </td>
                        <td>
                          {row.estimatedAbility
                            ? `${row.estimatedAbility.min}–${row.estimatedAbility.max}`
                            : "Unknown"}
                        </td>
                        <td>{row.estimatedPotential ?? "Unknown"}</td>
                        <td>
                          <button
                            className="ghost small"
                            disabled={busy}
                            onClick={() =>
                              void act(() => managerBridge.toggleShortlist(row.playerId))
                            }
                          >
                            {row.shortlisted ? "Unshortlist" : "Shortlist"}
                          </button>
                          <button
                            className="ghost small"
                            disabled={busy}
                            onClick={() =>
                              void act(() =>
                                managerBridge.createScoutingAssignment({
                                  targetPlayerId: row.playerId,
                                  priority: "HIGH",
                                }),
                              )
                            }
                          >
                            Scout
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pager">
                <button className="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <span>
                  {results.page * results.pageSize + 1}–
                  {Math.min(results.total, (results.page + 1) * results.pageSize)} of{" "}
                  {results.total}
                </span>
                <button
                  className="ghost"
                  disabled={(results.page + 1) * results.pageSize >= results.total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </AsyncPanel>
      </Panel>

      <Panel title="Shortlist">
        <AsyncPanel
          state={dashboard}
          isEmpty={(view) => view.shortlist.length === 0}
          empty="No players shortlisted."
        >
          {(view) => (
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Club</th>
                  <th>Knowledge</th>
                  <th>Est. ability</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {view.shortlist.map((entry) => (
                  <tr key={entry.playerId}>
                    <td>
                      <button className="link" onClick={() => onSelectPlayer(entry.playerId)}>
                        {entry.playerName ?? "Unknown"}
                      </button>
                    </td>
                    <td>
                      {entry.club ? (
                        <EntityRefLink reference={entry.club} onOpen={(reference) => onOpenClub(reference.id)} />
                      ) : (
                        (entry.clubName ?? "Free agent")
                      )}
                    </td>
                    <td>{entry.knowledge.toLowerCase()}</td>
                    <td>
                      {entry.estimatedAbility
                        ? `${entry.estimatedAbility.min}–${entry.estimatedAbility.max}`
                        : "Unknown"}
                    </td>
                    <td>
                      <button
                        className="ghost small"
                        disabled={busy}
                        onClick={() =>
                          void act(() => managerBridge.toggleShortlist(entry.playerId))
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AsyncPanel>
      </Panel>

      <Panel title="Assignments">
        <AsyncPanel
          state={dashboard}
          isEmpty={(view) => view.assignments.length === 0}
          empty="No scouts are currently assigned."
        >
          {(view) => (
            <table>
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Type</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {view.assignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>{assignment.targetName}</td>
                    <td>{assignment.assignmentType.toLowerCase()}</td>
                    <td>{assignment.priority.toLowerCase()}</td>
                    <td>{assignment.status.toLowerCase()}</td>
                    <td>{assignment.expectedCompletionAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AsyncPanel>
      </Panel>

      <Panel title="Recent reports">
        <AsyncPanel
          state={dashboard}
          isEmpty={(view) => view.recentReports.length === 0}
          empty="No scout reports yet. Assign a scout and continue."
        >
          {(view) => (
            <ul className="report-list">
              {view.recentReports.map((report) => (
                <li key={`${report.playerId}-${report.generatedAt}`}>
                  <strong>{report.playerName}</strong> · {report.generatedAt} ·{" "}
                  {report.estimatedAbility
                    ? `${report.estimatedAbility.min}–${report.estimatedAbility.max}`
                    : "Unknown"}{" "}
                  · {report.estimatedPotentialBand} · confidence {report.confidence.toLowerCase()}
                  <div className="subtle">{report.recommendation}</div>
                </li>
              ))}
            </ul>
          )}
        </AsyncPanel>
        <button className="ghost" onClick={refreshDashboard}>
          Refresh
        </button>
      </Panel>
    </section>
  );
};
