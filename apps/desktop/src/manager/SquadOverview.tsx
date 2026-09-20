import React from "react";
import type { EntityId } from "@nepal-football-sim/shared-types";
import type { ManagerWorkspace } from "../navigation.js";
import { managerBridge } from "./managerBridge.js";
import { useRuntimeData, AsyncPanel } from "./ui.js";
import {
  contractsExpiring,
  injuredOrSuspended,
  positionalDepth,
  squadAvailability,
  squadTotal,
} from "./squad.js";

/** Phase 3A Squad Overview — a summary, not one-card-per-player. */
export const SquadOverview = ({
  onSelectPlayer,
  onNavigate,
}: {
  onSelectPlayer: (playerId: EntityId) => void;
  onNavigate: (next: ManagerWorkspace) => void;
}): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getSquad(), []);
  return (
    <AsyncPanel state={state}>
      {(squad) => {
        const availability = squadAvailability(squad);
        const attention = injuredOrSuspended(squad);
        const expiring = contractsExpiring(squad);
        const depth = positionalDepth(squad);
        const stats: Array<{ label: string; value: number }> = [
          { label: "Available", value: availability.AVAILABLE ?? 0 },
          { label: "Injured", value: availability.INJURED ?? 0 },
          { label: "Suspended", value: availability.SUSPENDED ?? 0 },
          { label: "Total", value: squadTotal(squad) },
        ];
        return (
          <section className="squad-overview" aria-label="Squad overview">
            <div className="surface-primary squad-availability">
              <h3 className="section-title">Availability</h3>
              <div className="stats-strip">
                {stats.map((stat) => (
                  <div key={stat.label}>
                    <span className="data-label">{stat.label}</span>
                    <span className="stat-value">{stat.value}</span>
                  </div>
                ))}
              </div>
              {attention.length === 0 ? (
                <p className="ok">No injuries or suspensions.</p>
              ) : (
                <>
                  <p className="data-label">Needs attention</p>
                  <ul className="report-list">
                    {attention.map((player) => (
                      <li key={player.personId}>
                        <button className="link" onClick={() => onSelectPlayer(player.personId)}>
                          {player.name}
                        </button>{" "}
                        · {player.availability.toLowerCase()}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="u-split">
              <div className="surface-primary squad-depth">
                <h4 className="data-label">Squad depth by position</h4>
                {depth.length === 0 ? (
                  <p className="state-noresults">No senior players recorded.</p>
                ) : (
                  depth.map((entry) => (
                    <div className="quiet-region" key={entry.position}>
                      {entry.position} · {entry.count}
                    </div>
                  ))
                )}
              </div>

              <div className="surface-secondary squad-contracts">
                <h4 className="data-label">Contracts expiring</h4>
                {expiring.length === 0 ? (
                  <p className="state-noresults">No contracts expiring.</p>
                ) : (
                  <ul className="report-list">
                    {expiring.map((player) => (
                      <li key={player.personId}>
                        <button className="link" onClick={() => onSelectPlayer(player.personId)}>
                          {player.name}
                        </button>{" "}
                        · {player.contractExpiry}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="button-row">
              <button className="ghost small" onClick={() => onNavigate("squad")}>
                First Team
              </button>
              <button className="ghost small" onClick={() => onNavigate("training")}>
                Training
              </button>
              <button className="ghost small" onClick={() => onNavigate("dressing-room")}>
                Dynamics
              </button>
              <button className="ghost small" onClick={() => onNavigate("medical")}>
                Medical
              </button>
              <button className="ghost small" onClick={() => onNavigate("loans")}>
                Loans
              </button>
            </div>
          </section>
        );
      }}
    </AsyncPanel>
  );
};