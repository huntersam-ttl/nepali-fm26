import React from "react";
import type { EntityId, ScoutingAssignmentView } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Panel, useRuntimeData } from "../ui.js";
import {
  activeAssignments,
  assignmentStatusText,
  assignmentTypeLabel,
  orderAssignments,
} from "../recruitment.js";

export const RecruitmentFocusesScreen = ({
  onSelectPlayer,
  onOpenClub,
}: {
  onSelectPlayer: (playerId: EntityId) => void;
  onOpenClub: (clubId: EntityId) => void;
}): React.ReactElement => {
  const [dashboard, refreshDashboard] = useRuntimeData(() => managerBridge.getScoutingDashboard());
  const statusTone = (status: string): "ok" | "warn" | "bad" | "info" =>
    status === "COMPLETED" ? "ok" : status === "ACTIVE" ? "warn" : status === "CANCELLED" ? "bad" : "info";

  return (
    <section className="dashboard">
      <Panel title="Recruitment Focuses">
        <p className="subtle">
          Persistent scouting assignments from your scouting network. Status, target, priority and dates are
          canonical — scouting only shows what is actually in progress.
        </p>
        <AsyncPanel
          state={dashboard}
          isEmpty={(view) => view.assignments.length === 0}
          empty="No scouting assignments yet. Use the Scout action in the Player Database to create one."
        >
          {(view) => {
            const ordered = orderAssignments(view.assignments as ScoutingAssignmentView[]);
            const active = activeAssignments(ordered);
            const others = ordered.filter((a) => !active.includes(a));
            return (
              <>
                <h3>Active focuses ({active.length})</h3>
                {active.length === 0 ? (
                  <p className="subtle">No active focuses right now.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Focus</th>
                          <th>Target</th>
                          <th>Status</th>
                          <th>Priority</th>
                          <th>Started</th>
                          <th>Expected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {active.map((assignment) => (
                          <tr key={assignment.id}>
                            <td>{assignmentTypeLabel(assignment.assignmentType)}</td>
                            <td>{assignment.targetName}</td>
                            <td>
                              <Badge tone={statusTone(assignment.status)}>{assignmentStatusText(assignment.status)}</Badge>
                            </td>
                            <td>{assignment.priority.toLowerCase()}</td>
                            <td>{assignment.startedAt}</td>
                            <td>{assignment.expectedCompletionAt}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {others.length > 0 && (
                  <>
                    <h3>Recent / completed</h3>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Focus</th>
                            <th>Target</th>
                            <th>Status</th>
                            <th>Started</th>
                            <th>Expected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {others.map((assignment) => (
                            <tr key={assignment.id}>
                              <td>{assignmentTypeLabel(assignment.assignmentType)}</td>
                              <td>{assignment.targetName}</td>
                              <td>
                                <Badge tone={statusTone(assignment.status)}>
                                  {assignmentStatusText(assignment.status)}
                                </Badge>
                              </td>
                              <td>{assignment.startedAt}</td>
                              <td>{assignment.expectedCompletionAt}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                <button className="ghost" onClick={refreshDashboard}>
                  Refresh
                </button>
              </>
            );
          }}
        </AsyncPanel>
      </Panel>
    </section>
  );
};