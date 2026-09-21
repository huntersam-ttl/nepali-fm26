import React from "react";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Metrics, Panel, useRuntimeData } from "../ui.js";
import { rangeText } from "../recruitment.js";

export const RecruitmentOverviewScreen = ({
  onSelectPlayer,
}: {
  onSelectPlayer: (playerId: EntityId) => void;
}): React.ReactElement => {
  const [dashboard, refreshDashboard] = useRuntimeData(() => managerBridge.getScoutingDashboard());

  return (
    <section className="dashboard">
      <Panel title="Recruitment Overview">
        <p className="subtle">
          What the club knows, what is being scouted, and what is waiting. Summaries only — use the family pages to
          act.
        </p>
        <AsyncPanel state={dashboard}>
          {(view) => (
            <Metrics
              items={[
                { label: "Well known", value: view.coverage.knownPlayers },
                { label: "Discovered", value: view.coverage.discoveredPlayers },
                { label: "Unknown", value: view.coverage.unknownPlayers },
                { label: "Total players", value: view.coverage.totalPlayers },
                { label: "Shortlisted", value: view.shortlist.length },
                { label: "Active scouting", value: view.assignments.length },
                { label: "Recent reports", value: view.recentReports.length },
              ]}
            />
          )}
        </AsyncPanel>
      </Panel>

      <Panel title="Active scouting">
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
                    <td>{entry.clubName ?? "Free agent"}</td>
                    <td>
                      <Badge tone="info">{entry.knowledge.toLowerCase()}</Badge>
                    </td>
                    <td>{rangeText(entry.estimatedAbility)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AsyncPanel>
        <button className="ghost" onClick={refreshDashboard}>
          Refresh
        </button>
      </Panel>
    </section>
  );
};