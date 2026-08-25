import React, { useState } from "react";
import type { EntityId, TransferCentre } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Metrics, Panel, money, useRuntimeData } from "../ui.js";
import type { AppError } from "../../appBridge.js";

type Tab = "targets" | "offers" | "loans" | "free" | "history";

export const TransfersScreen = ({
  onSelectPlayer,
}: {
  onSelectPlayer: (playerId: EntityId) => void;
}): React.ReactElement => {
  const [state, , replace] = useRuntimeData(() => managerBridge.getTransferCentre());
  const [tab, setTab] = useState<Tab>("targets");
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (
    action: () => Promise<Awaited<ReturnType<typeof managerBridge.getTransferCentre>>>,
  ) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      replace(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  };

  return (
    <section className="dashboard">
      {error && <ErrorBanner error={error} />}
      <AsyncPanel state={state}>
        {(centre: TransferCentre) => (
          <>
            <Panel title="Budget">
              <Metrics
                items={[
                  {
                    label: "Transfer budget",
                    value: money(centre.budget.transferBudget, centre.budget.currency),
                  },
                  {
                    label: "Remaining",
                    value: money(centre.budget.transferRemaining, centre.budget.currency),
                  },
                  {
                    label: "Wage budget",
                    value: money(centre.budget.wageBudget, centre.budget.currency),
                  },
                  {
                    label: "Committed wages",
                    value: money(centre.budget.committedWages, centre.budget.currency),
                  },
                  {
                    label: "Window",
                    value: centre.windowOpen
                      ? `Open until ${centre.windowCloses ?? "unknown"}`
                      : "Closed",
                  },
                ]}
              />
              <p className="subtle">
                The transfer budget is a board allocation, not the club&rsquo;s cash balance.
              </p>
            </Panel>

            <Panel
              title="Transfer centre"
              actions={
                <div className="tab-row">
                  {(["targets", "offers", "loans", "free", "history"] as Tab[]).map((option) => (
                    <button
                      key={option}
                      className={tab === option ? "active" : ""}
                      onClick={() => setTab(option)}
                    >
                      {option === "free" ? "Free agents" : option}
                    </button>
                  ))}
                </div>
              }
            >
              {tab === "targets" &&
                (centre.targets.length === 0 ? (
                  <p className="empty-state">
                    No targets yet. Shortlist players on the Scouting screen.
                  </p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Club</th>
                        <th>Est. ability</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {centre.targets.map((target) => (
                        <tr key={target.playerId}>
                          <td>
                            <button
                              className="link"
                              onClick={() => onSelectPlayer(target.playerId)}
                            >
                              {target.playerName ?? "Unknown"}
                            </button>
                          </td>
                          <td>{target.clubName ?? "Free agent"}</td>
                          <td>
                            {target.estimatedAbility
                              ? `${target.estimatedAbility.min}–${target.estimatedAbility.max}`
                              : "Unknown"}
                          </td>
                          <td>
                            <button
                              className="primary small"
                              disabled={busy}
                              onClick={() =>
                                void act(() =>
                                  managerBridge.makeTransferOffer({ playerId: target.playerId }),
                                )
                              }
                            >
                              Make offer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}

              {tab === "offers" && (
                <>
                  <h3>Our bids</h3>
                  {centre.incoming.length === 0 ? (
                    <p className="empty-state">No active bids.</p>
                  ) : (
                    <OfferTable offers={centre.incoming} />
                  )}
                  <h3>Bids for our players</h3>
                  {centre.outgoing.length === 0 ? (
                    <p className="empty-state">No clubs have bid for your players.</p>
                  ) : (
                    <OfferTable
                      offers={centre.outgoing}
                      onRespond={(offerId, action) =>
                        void act(() => managerBridge.respondTransferOffer({ offerId, action }))
                      }
                      busy={busy}
                    />
                  )}
                </>
              )}

              {tab === "loans" &&
                (centre.loans.length === 0 ? (
                  <p className="empty-state">No players on loan in or out.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Direction</th>
                        <th>Club</th>
                        <th>Until</th>
                        <th>Wage share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {centre.loans.map((loan) => (
                        <tr key={loan.playerId}>
                          <td>{loan.playerName}</td>
                          <td>{loan.direction}</td>
                          <td>{loan.otherClubName ?? "—"}</td>
                          <td>{loan.endDate}</td>
                          <td>{loan.wageContributionPercent}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}

              {tab === "free" &&
                (centre.freeAgents.length === 0 ? (
                  <p className="empty-state">No free agents known to your scouts.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Position</th>
                        <th>Est. ability</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {centre.freeAgents.map((agent) => (
                        <tr key={agent.playerId}>
                          <td>{agent.name ?? "Unknown player"}</td>
                          <td>{agent.knownPosition ?? agent.positionGroup ?? "Unknown"}</td>
                          <td>
                            {agent.estimatedAbility
                              ? `${agent.estimatedAbility.min}–${agent.estimatedAbility.max}`
                              : "Unknown"}
                          </td>
                          <td>
                            <button
                              className="primary small"
                              disabled={busy}
                              onClick={() =>
                                void act(() =>
                                  managerBridge.makeTransferOffer({ playerId: agent.playerId }),
                                )
                              }
                            >
                              Offer contract
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}

              {tab === "history" &&
                (centre.history.length === 0 ? (
                  <p className="empty-state">No transfer activity recorded.</p>
                ) : (
                  <ul className="report-list">
                    {centre.history.map((event, index) => (
                      <li key={`${event.playerId}-${index}`}>
                        {event.occurredOn} · <strong>{event.playerName}</strong> ·{" "}
                        {event.eventType.replace(/_/g, " ").toLowerCase()}
                        {event.otherClubName ? ` · ${event.otherClubName}` : ""}
                      </li>
                    ))}
                  </ul>
                ))}
            </Panel>
          </>
        )}
      </AsyncPanel>
    </section>
  );
};

const OfferTable = ({
  offers,
  onRespond,
  busy,
}: {
  offers: TransferCentre["incoming"];
  onRespond?: (offerId: EntityId, action: "ACCEPT" | "REJECT") => void;
  busy?: boolean;
}): React.ReactElement => (
  <div className="table-scroll">
    <table>
      <thead>
        <tr>
          <th>Player</th>
          <th>Club</th>
          <th>Fee</th>
          <th>Status</th>
          <th>Latest</th>
          {onRespond && <th />}
        </tr>
      </thead>
      <tbody>
        {offers.map((offer) => (
          <tr key={offer.id}>
            <td>{offer.playerName}</td>
            <td>{offer.otherClubName ?? "—"}</td>
            <td>{money(offer.transferFee, offer.currency)}</td>
            <td>
              <Badge
                tone={
                  offer.status === "ACCEPTED" || offer.status === "COMPLETED"
                    ? "ok"
                    : offer.status === "REJECTED"
                      ? "bad"
                      : "info"
                }
              >
                {offer.status.toLowerCase()}
              </Badge>
            </td>
            <td className="subtle">{offer.negotiation.at(-1)?.message ?? "Awaiting response"}</td>
            {onRespond && (
              <td>
                <button
                  className="ghost small"
                  disabled={busy}
                  onClick={() => onRespond(offer.id, "ACCEPT")}
                >
                  Accept
                </button>
                <button
                  className="ghost small"
                  disabled={busy}
                  onClick={() => onRespond(offer.id, "REJECT")}
                >
                  Reject
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
