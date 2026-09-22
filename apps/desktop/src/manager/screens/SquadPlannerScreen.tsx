import React, { useState } from "react";
import type { EntityId, SquadList, ShortlistEntry } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Panel, useRuntimeData } from "../ui.js";
import { HORIZONS, POSITION_LANES, classifyHorizon, knowledgeText, knowledgeTone, positionGroupFor, rangeText } from "../recruitment.js";

export const SquadPlannerScreen = ({
  onSelectPlayer,
  today,
}: {
  onSelectPlayer: (playerId: EntityId) => void;
  today?: string;
}): React.ReactElement => {
  const [squad] = useRuntimeData(() => managerBridge.getSquad());
  const [dashboard] = useRuntimeData(() => managerBridge.getScoutingDashboard());
  const [horizonDays, setHorizonDays] = useState(0);
  const [horizonLabel, setHorizonLabel] = useState("Now");
  const worldDate = today ?? new Date().toISOString().slice(0, 10);

  return (
    <section className="dashboard">
      <Panel title="Squad Planner" className="panel-wide">
        <p className="subtle">
          A derived view of real squad state against real contract futures. An expiring contract is shown as such,
          never as a confirmed departure. Recruitment targets stay targets.
        </p>
        <label>
          Future horizon
          <select
            value={String(horizonDays)}
            onChange={(event) => {
              const value = Number(event.target.value);
              setHorizonDays(value);
              setHorizonLabel(HORIZONS.find((h) => h.value === value)?.label ?? "Now");
            }}
          >
            {HORIZONS.map((horizon) => (
              <option key={horizon.value} value={String(horizon.value)}>
                {horizon.label}
              </option>
            ))}
          </select>
        </label>
        <p className="subtle">Horizon: {horizonLabel} (world date {worldDate}).</p>

        <AsyncPanel
          state={squad}
          isEmpty={(list: SquadList) => list.players.length === 0}
          empty="No senior squad to plan with."
        >
          {(list: SquadList) => {
            const players = list.players;
            return (
              <>
                {POSITION_LANES.map((lane) => {
                  const lanePlayers = players
                    .filter((player) => positionGroupFor(player.primaryPosition) === lane.value)
                    .sort((a, b) => a.name.localeCompare(b.name));
                  const expiring = lanePlayers.filter((player) => {
                    const state = classifyHorizon(player, horizonDays, worldDate).state;
                    return state === "CONTRACT_EXPIRES" || state === "NO_CONTRACT";
                  }).length;
                  if (lanePlayers.length === 0) return null;
                  return (
                    <div key={lane.value}>
                      <h3>
                        {lane.label}
                        <span className="subtle">
                          {" "}({lanePlayers.length} players · {expiring} expiring at horizon)
                        </span>
                      </h3>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Player</th>
                              <th>Position</th>
                              <th>Age</th>
                              <th>Availability</th>
                              <th>Contract</th>
                              <th>At horizon</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lanePlayers.map((player) => {
                              const horizon = classifyHorizon(player, horizonDays, worldDate);
                              return (
                                <tr key={player.personId}>
                                  <td>
                                    <button className="link" onClick={() => onSelectPlayer(player.personId)}>
                                      {player.name}
                                    </button>
                                  </td>
                                  <td>{player.primaryPosition}</td>
                                  <td>{player.age.value ?? "Unknown"}</td>
                                  <td>{player.availability.toLowerCase()}</td>
                                  <td>{player.contractExpiry ?? "—"}</td>
                                  <td>{horizon.text}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </>
            );
          }}
        </AsyncPanel>

        <Panel title="Recruitment targets (shortlist)">
          <p className="subtle">
            Shortlisted targets for comparison — no hidden ranking, no position inference. Ranges and unknown stay
            as-is.
          </p>
          <AsyncPanel
            state={dashboard}
            isEmpty={(view) => view.shortlist.length === 0}
            empty="No shortlisted targets to compare. Add some from the Player Database."
          >
            {(view) => (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Target</th>
                      <th>Knowledge</th>
                      <th>Est. ability</th>
                      <th>Scout status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.shortlist.map((entry: ShortlistEntry) => (
                      <tr key={entry.playerId}>
                        <td>
                          <button className="link" onClick={() => onSelectPlayer(entry.playerId)}>
                            {entry.playerName ?? "Unknown"}
                          </button>
                        </td>
                        <td>
                          <Badge tone={knowledgeTone(entry.knowledge)}>{knowledgeText(entry.knowledge)}</Badge>
                        </td>
                        <td>{rangeText(entry.estimatedAbility)}</td>
                        <td>{entry.scoutingStatus.toLowerCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AsyncPanel>
        </Panel>
      </Panel>
    </section>
  );
};