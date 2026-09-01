import React from "react";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, FormRun, Panel, useRuntimeData } from "../ui.js";

export const CompetitionScreen = (): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getCompetition());
  return (
    <section className="dashboard">
      <AsyncPanel state={state}>
        {(view) => (
          <>
            {/* Ten columns of standings do not fit an auto-fit dashboard column. */}
            <Panel title={view.seasonName} className="panel-wide">
              <p>
                Position {view.managerPosition ?? "—"} · Form <FormRun form={view.form} />
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Club</th>
                      <th>P</th>
                      <th>W</th>
                      <th>D</th>
                      <th>L</th>
                      <th>GF</th>
                      <th>GA</th>
                      <th>GD</th>
                      <th>Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.table.map((row) => (
                      <tr key={row.teamId} className={row.isManagerTeam ? "row-highlight" : ""}>
                        <td>{row.position}</td>
                        <td>{row.teamName}</td>
                        <td>{row.played}</td>
                        <td>{row.won}</td>
                        <td>{row.drawn}</td>
                        <td>{row.lost}</td>
                        <td>{row.goalsFor}</td>
                        <td>{row.goalsAgainst}</td>
                        <td>{row.goalDifference}</td>
                        <td>
                          <strong>{row.points}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Top scorers">
              {view.topScorers.length === 0 ? (
                <p className="empty-state">No goals scored in the competition yet.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Club</th>
                      <th>Goals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.topScorers.map((scorer) => (
                      <tr key={scorer.personId}>
                        <td>{scorer.name}</td>
                        <td>{scorer.teamName}</td>
                        <td>{scorer.goals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </>
        )}
      </AsyncPanel>
    </section>
  );
};
