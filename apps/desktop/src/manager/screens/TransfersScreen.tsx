import React, { useState } from "react";
import type {
  EntityId,
  TransferCentre,
  TransferOfferCommand,
  ClubBudgetCategory,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Metrics, Panel, money, useRuntimeData } from "../ui.js";
import type { AppError } from "../../appBridge.js";

type Tab = "targets" | "offers" | "loans" | "free" | "expiring" | "requests" | "history";

export const TransfersScreen = ({
  onSelectPlayer,
}: {
  onSelectPlayer: (playerId: EntityId) => void;
}): React.ReactElement => {
  const [state, , replace] = useRuntimeData(() => managerBridge.getTransferCentre());
  const [tab, setTab] = useState<Tab>("targets");
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState({ fee: "", installments: "", addOns: "", sellOn: "" });
  const [exchangePlayerId, setExchangePlayerId] = useState("");
  const [requestedPlayerId, setRequestedPlayerId] = useState("");
  const [appearanceClause, setAppearanceClause] = useState({ threshold: "", amount: "" });
  const [budgetRequest, setBudgetRequest] = useState({ category: "TRANSFER_BUDGET" as ClubBudgetCategory, amount: "" });
  const [budgetMessage, setBudgetMessage] = useState<string | null>(null);

  const requestBudget = async (seasonLabel: string): Promise<void> => {
    const result = await managerBridge.requestManagerBudget(seasonLabel, budgetRequest.category, Number(budgetRequest.amount));
    if (result.ok) setBudgetMessage("Budget request submitted to the owner/board.");
    else setError(result.error);
  };

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

  const makeOffer = (playerId: EntityId): void => {
    const command: TransferOfferCommand = {
      playerId,
      fee: offer.fee ? Number(offer.fee) : undefined,
      installments: offer.installments ? Number(offer.installments) : undefined,
      addOns: offer.addOns ? Number(offer.addOns) : undefined,
      sellOnPercentage: offer.sellOn ? Number(offer.sellOn) : undefined,
      exchangePlayerIds: exchangePlayerId ? [exchangePlayerId as EntityId] : undefined,
      conditionals:
        appearanceClause.threshold && appearanceClause.amount
          ? [
              {
                type: "APPEARANCE",
                threshold: Number(appearanceClause.threshold),
                amount: Number(appearanceClause.amount),
                description: `${appearanceClause.threshold} appearances trigger add-on`,
              },
            ]
          : undefined,
    };
    void act(() => managerBridge.makeTransferOffer(command));
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
              <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void requestBudget(centre.budget.seasonLabel); }}>
                <label>Request increase<select value={budgetRequest.category} onChange={(event) => setBudgetRequest({ ...budgetRequest, category: event.target.value as ClubBudgetCategory })}><option value="TRANSFER_BUDGET">Transfer budget</option><option value="WAGE_BUDGET">Wage budget</option><option value="STAFF_BUDGET">Staff budget</option></select></label>
                <label>New total<input type="number" min="0" value={budgetRequest.amount} onChange={(event) => setBudgetRequest({ ...budgetRequest, amount: event.target.value })} /></label>
                <button className="small" type="submit">Request</button>
              </form>
              {budgetMessage && <p className="notice" role="status">{budgetMessage}</p>}
              {!centre.windowOpen && (
                <p className="warning">
                  The window is closed. Enquiries can still be prepared for the next eligible
                  window.
                </p>
              )}
            </Panel>

            <Panel
              title="Transfer centre"
              actions={
                <div className="tab-row">
                  {(
                    [
                      "targets",
                      "offers",
                      "loans",
                      "free",
                      "expiring",
                      "requests",
                      "history",
                    ] as Tab[]
                  ).map((option) => (
                    <button
                      key={option}
                      className={tab === option ? "active" : ""}
                      onClick={() => setTab(option)}
                    >
                      {option === "free"
                        ? "Free agents"
                        : option === "expiring"
                          ? "Expiring"
                          : option === "requests"
                            ? "Requests"
                            : option}
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
                  <>
                    <div className="transfer-form">
                      <label>
                        Cash
                        <input
                          inputMode="numeric"
                          value={offer.fee}
                          onChange={(e) => setOffer({ ...offer, fee: e.target.value })}
                          placeholder="Use asking range"
                        />
                      </label>
                      <label>
                        Installments
                        <input
                          inputMode="numeric"
                          value={offer.installments}
                          onChange={(e) => setOffer({ ...offer, installments: e.target.value })}
                          placeholder="0"
                        />
                      </label>
                      <label>
                        Add-ons
                        <input
                          inputMode="numeric"
                          value={offer.addOns}
                          onChange={(e) => setOffer({ ...offer, addOns: e.target.value })}
                          placeholder="0"
                        />
                      </label>
                      <label>
                        Sell-on %
                        <input
                          inputMode="decimal"
                          value={offer.sellOn}
                          onChange={(e) => setOffer({ ...offer, sellOn: e.target.value })}
                          placeholder="0"
                        />
                      </label>
                      <label>
                        Exchange player ID
                        <input
                          value={exchangePlayerId}
                          onChange={(e) => setExchangePlayerId(e.target.value)}
                          placeholder="Optional"
                        />
                      </label>
                      <label>
                        Requested exchange ID
                        <input
                          value={requestedPlayerId}
                          onChange={(e) => setRequestedPlayerId(e.target.value)}
                          placeholder="Seller response"
                        />
                      </label>
                      <label>
                        Appearance trigger
                        <input
                          inputMode="numeric"
                          value={appearanceClause.threshold}
                          onChange={(e) =>
                            setAppearanceClause({ ...appearanceClause, threshold: e.target.value })
                          }
                          placeholder="Optional"
                        />
                      </label>
                      <label>
                        Trigger amount
                        <input
                          inputMode="numeric"
                          value={appearanceClause.amount}
                          onChange={(e) =>
                            setAppearanceClause({ ...appearanceClause, amount: e.target.value })
                          }
                          placeholder="Optional"
                        />
                      </label>
                    </div>
                    <p className="subtle">
                      Valuations are ranges, not public exact prices. Player and agent terms are
                      negotiated after club agreement.
                    </p>
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
                                onClick={() => makeOffer(target.playerId)}
                              >
                                Make offer
                              </button>
                              <button
                                className="ghost small"
                                disabled={busy || !target.clubName}
                                onClick={() =>
                                  void act(() =>
                                    managerBridge.negotiateLoan({
                                      playerId: target.playerId,
                                      wageContributionPercent: 60,
                                      playingTimeExpectation: "ROTATION",
                                    }),
                                  )
                                }
                              >
                                Loan enquiry
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
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
                      onRespond={(offerId, action, transferFee) =>
                        void act(() =>
                          managerBridge.respondTransferOffer({
                            offerId,
                            action,
                            transferFee,
                            sellerRequestedPlayerId: requestedPlayerId
                              ? (requestedPlayerId as EntityId)
                              : undefined,
                          }),
                        )
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

              {tab === "expiring" &&
                (centre.expiringContracts.length === 0 ? (
                  <p className="empty-state">No contracts expire in the next six months.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Role</th>
                        <th>Ends</th>
                        <th>Months</th>
                      </tr>
                    </thead>
                    <tbody>
                      {centre.expiringContracts.map((contract) => (
                        <tr key={contract.playerId}>
                          <td>
                            <button
                              className="link"
                              onClick={() => onSelectPlayer(contract.playerId)}
                            >
                              {contract.playerName}
                            </button>
                          </td>
                          <td>{contract.squadRole}</td>
                          <td>{contract.endDate}</td>
                          <td>{contract.monthsRemaining}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}

              {tab === "requests" &&
                (centre.requests.length === 0 ? (
                  <p className="empty-state">No player transfer requests.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Reason</th>
                        <th>Pressure</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {centre.requests.map((request) => (
                        <tr key={request.id}>
                          <td>{request.playerName}</td>
                          <td>{request.reason}</td>
                          <td>{Math.round(request.pressureScore)}</td>
                          <td>
                            <Badge
                              tone={
                                request.status === "ACCEPTED"
                                  ? "ok"
                                  : request.status === "REJECTED"
                                    ? "bad"
                                    : "warn"
                              }
                            >
                              {request.status}
                            </Badge>
                          </td>
                          <td>
                            {request.status === "PENDING" && (
                              <>
                                <button
                                  className="ghost small"
                                  disabled={busy}
                                  onClick={() =>
                                    void act(() =>
                                      managerBridge.respondTransferRequest({
                                        requestId: request.id,
                                        decision: "ACCEPTED",
                                      }),
                                    )
                                  }
                                >
                                  Accept
                                </button>
                                <button
                                  className="ghost small"
                                  disabled={busy}
                                  onClick={() =>
                                    void act(() =>
                                      managerBridge.respondTransferRequest({
                                        requestId: request.id,
                                        decision: "REJECTED",
                                      }),
                                    )
                                  }
                                >
                                  Reject
                                </button>
                              </>
                            )}
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
  onRespond?: (
    offerId: EntityId,
    action: "ACCEPT" | "REJECT" | "COUNTER",
    transferFee?: number,
  ) => void;
  busy?: boolean;
}): React.ReactElement => (
  <div className="table-scroll">
    <table>
      <thead>
        <tr>
          <th>Player</th>
          <th>Club</th>
          <th>Fee</th>
          <th>Asking / contact</th>
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
            <td className="subtle">
              {offer.askingRange
                ? `${money(offer.askingRange.min, offer.currency)}–${money(offer.askingRange.max, offer.currency)}`
                : "—"}
              <div>
                {offer.agentContact === "AGENT" ? "Agent contact" : "Direct player contact"}
              </div>
              <div>
                {offer.installments
                  ? `${money(offer.installments, offer.currency)} installments`
                  : "No installments"}{" "}
                · {offer.sellOnPercentage}% sell-on
              </div>
              {offer.conditionals.length > 0 && (
                <div>{offer.conditionals.length} conditional clause(s)</div>
              )}
              {offer.playerExchanges.length > 0 && (
                <div>{offer.playerExchanges.length} player exchange(s)</div>
              )}
            </td>
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
            <td className="subtle">
              {offer.negotiation.at(-1)?.message ?? "Awaiting response"}
              <details>
                <summary>History</summary>
                {offer.negotiation.map((round) => (
                  <div key={`${offer.id}-${round.round}-${round.action}`}>
                    {round.round}. {round.actor}: {round.message}
                  </div>
                ))}
              </details>
            </td>
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
                <button
                  className="ghost small"
                  disabled={busy}
                  onClick={() =>
                    onRespond(offer.id, "COUNTER", Math.round(offer.transferFee * 1.1))
                  }
                >
                  Counter
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
