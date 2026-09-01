import React, { useState } from "react";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Metrics, Panel, money, useRuntimeData } from "../ui.js";
import type { AppError } from "../../appBridge.js";

export const ContractsScreen = (): React.ReactElement => {
  const [state, , replace] = useRuntimeData(() => managerBridge.getContracts());
  const [filter, setFilter] = useState<"all" | "expiring">("all");
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="dashboard">
      {error && <ErrorBanner error={error} />}
      <AsyncPanel
        state={state}
        isEmpty={(data) => data.contracts.length === 0}
        empty="No player contracts registered at this club."
      >
        {(list) => {
          const rows =
            filter === "expiring"
              ? list.contracts.filter((contract) => contract.expiringSoon)
              : list.contracts;
          return (
            <Panel
              title="Contracts"
              className="panel-wide"
              actions={
                <div className="tab-row">
                  <button
                    className={filter === "all" ? "active" : ""}
                    onClick={() => setFilter("all")}
                  >
                    All
                  </button>
                  <button
                    className={filter === "expiring" ? "active" : ""}
                    onClick={() => setFilter("expiring")}
                  >
                    Expiring ({list.expiringCount})
                  </button>
                </div>
              }
            >
              <Metrics
                items={[
                  { label: "Squad wage bill", value: money(list.totalWageBill, list.currency) },
                  { label: "Contracts", value: list.contracts.length },
                  { label: "Expiring within 6 months", value: list.expiringCount },
                ]}
              />
              {rows.length === 0 ? (
                <p className="empty-state">No contracts match this filter.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Salary</th>
                        <th>Role</th>
                        <th>Expires</th>
                        <th>Months</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((contract) => (
                        <tr key={contract.playerId}>
                          <td>{contract.playerName}</td>
                          <td>{money(contract.salary, contract.currency)} / month</td>
                          <td>{contract.squadRole.replace(/_/g, " ").toLowerCase()}</td>
                          <td>{contract.endDate}</td>
                          <td>
                            {contract.monthsRemaining}
                            {contract.expiringSoon && <Badge tone="warn">renew</Badge>}
                          </td>
                          <td>{contract.status.toLowerCase()}</td>
                          <td>
                            <button
                              className="ghost small"
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                const result = await managerBridge.renewContract({
                                  playerId: contract.playerId,
                                  months: 24,
                                });
                                setBusy(false);
                                if (result.ok) {
                                  replace(result.data);
                                  setError(null);
                                } else {
                                  setError(result.error);
                                }
                              }}
                            >
                              Renew 2y
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          );
        }}
      </AsyncPanel>
    </section>
  );
};
