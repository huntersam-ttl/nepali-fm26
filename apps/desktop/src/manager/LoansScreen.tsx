import React from "react";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { managerBridge } from "./managerBridge.js";
import { useRuntimeData, AsyncPanel } from "./ui.js";
import { splitLoans } from "./loan.js";

/**
 * Phase 3D — Loans workspace (read-only, real transfer-centre active loans).
 * Shows Loaned-Out and Loaned-In lists with canonical player links. No
 * recall/terminate buttons are invented: no dedicated squad-loan command is
 * exposed (loan offers are negotiated in the Transfers workspace).
 */
export const LoansScreen = ({ onSelectPlayer }: { onSelectPlayer: (playerId: EntityId) => void }): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getTransferCentre(), []);
  return (
    <AsyncPanel state={state}>
      {(centre) => {
        const { out, in: inside } = splitLoans(centre.loans);
        if (out.length === 0 && inside.length === 0) {
          return (
            <div className="surface-primary">
              <h3 className="section-title">Loans</h3>
              <p className="state-noresults">No players are currently on loan.</p>
            </div>
          );
        }
        return (
          <section className="loans-layout" aria-label="Loans">
            {out.length > 0 && (
              <div className="surface-primary">
                <h3 className="section-title">Loaned out</h3>
                <ul className="report-list">
                  {out.map((loan) => (
                    <li key={loan.playerId}>
                      <button className="link" onClick={() => onSelectPlayer(loan.playerId)}>
                        {loan.playerName ?? "Player"}
                      </button>
                      {" — "}
                      {loan.otherClubName ?? "another club"}
                      {" · ends "}
                      {loan.endDate}
                      {loan.status ? ` · ${loan.status}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {inside.length > 0 && (
              <div className="surface-primary">
                <h3 className="section-title">Loaned in</h3>
                <ul className="report-list">
                  {inside.map((loan) => (
                    <li key={loan.playerId}>
                      <button className="link" onClick={() => onSelectPlayer(loan.playerId)}>
                        {loan.playerName ?? "Player"}
                      </button>
                      {" — "}
                      {loan.otherClubName ?? "loaning club"}
                      {" · ends "}
                      {loan.endDate}
                      {loan.status ? ` · ${loan.status}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      }}
    </AsyncPanel>
  );
};