import React, { useState } from "react";
import type {
  EntityId,
  ManagerOwnerPlayerRequest,
  OwnerManagerMeetingStance,
} from "@nepal-football-sim/shared-types";
import type { DesktopRuntimeApi } from "../../appBridge.js";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Metrics, Panel, useRuntimeData } from "../ui.js";
import { OrganizationProfilePanel } from "../RoleDetailScreen.js";

const band = (value: string): string => value.replaceAll("_", " ").toLowerCase();

const OWNER_PLAYER_REQUEST_TERMINAL_STAGES = new Set([
  "ACCEPTED",
  "REJECTED",
  "WALKED_AWAY",
  "DEFERRED",
  "COMPLETED",
  "CANCELLED",
]);

const REQUEST_INTENT_LABELS: Record<string, string> = {
  CONSIDER_TRANSFER_LIST: "Consider transfer-listing",
  CONSIDER_LOAN_LIST: "Consider loan-listing",
  CONSIDER_RENEWAL: "Consider contract renewal",
  REVIEW_SQUAD_ROLE: "Review squad role",
  STRENGTHEN_POSITION: "Strengthen this position",
  CONSIDER_RELEASE: "Consider release",
};

const FULFILLMENT_TONE: Record<
  ManagerOwnerPlayerRequest["fulfillmentState"],
  "ok" | "warn" | "bad" | "info"
> = {
  OPEN: "info",
  FULFILLED: "ok",
  DECLINED: "bad",
  DEFERRED: "warn",
  STALE: "warn",
  EXPIRED: "bad",
};

/**
 * respondToOwnerPlayerRequest always attempts to accept the underlying
 * owner-manager meeting (the same resolveOwnerManagerMeeting mechanic the
 * Owner's own meeting screen uses) — stance only flavors tone and the
 * probabilistic outcome, exactly like the existing "Extend support / Ask
 * for improvement / Raise a concern" Owner meeting UI. There is no distinct
 * reject/defer action wired to this command, so these labels describe the
 * Manager's stance, not a guaranteed verdict — the copy above the buttons
 * says so honestly instead of implying a hard decline/defer control.
 */
const RESPONSE_OPTIONS: Array<{
  stance: OwnerManagerMeetingStance;
  label: string;
  tone: "primary" | "ghost";
}> = [
  { stance: "SUPPORT", label: "Agree", tone: "primary" },
  { stance: "REQUEST", label: "Defer", tone: "ghost" },
  { stance: "CONCERN", label: "Decline", tone: "ghost" },
];

const RequestCard = ({
  request,
  bridge,
  refresh,
  onSelectPlayer,
  onOpenOwner,
}: {
  request: ManagerOwnerPlayerRequest;
  bridge: DesktopRuntimeApi;
  refresh: () => void;
  onSelectPlayer: (playerId: EntityId) => void;
  onOpenOwner: (id: EntityId) => void;
}): React.ReactElement => {
  const [busy, setBusy] = useState<OwnerManagerMeetingStance | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // fulfillmentState alone stays "OPEN" through ACCEPTED (accepting the
  // meeting is deliberately not the same as fulfilling the request — see the
  // notice below) — but ACCEPTED/terminal stages have no further
  // availableActions on the backend, so responding again would just surface
  // an "action not available" error. Only offer a response while the
  // interaction itself is still actually negotiable.
  const respondable = request.fulfillmentState === "OPEN" && !OWNER_PLAYER_REQUEST_TERMINAL_STAGES.has(request.stage);

  const respond = async (stance: OwnerManagerMeetingStance): Promise<void> => {
    setBusy(stance);
    setMessage(null);
    const result = await bridge.respondToOwnerPlayerRequest(request.requestId, stance);
    setBusy(null);
    setMessage(
      result.ok
        ? `Recorded — ${band(result.data.stage)}${result.data.outcome ? `: ${result.data.outcome}` : ""}.`
        : result.error.message,
    );
    if (result.ok) refresh();
  };

  return (
    <div className="commercial-property-card">
      <header>
        <h4>
          <button className="link" onClick={() => onSelectPlayer(request.player.id)}>
            {request.player.label}
          </button>
        </h4>
        <Badge tone={FULFILLMENT_TONE[request.fulfillmentState]}>{band(request.fulfillmentState)}</Badge>
      </header>
      <p className="subtle">
        {REQUEST_INTENT_LABELS[request.requestIntent] ?? band(request.requestIntent)} · from{" "}
        <button className="link" onClick={() => onOpenOwner(request.requestedByReference.id)}>
          {request.requestedByReference.label}
        </button>
      </p>
      <Metrics
        items={[
          { label: "Raised", value: request.requestedOn },
          ...(request.deadline ? [{ label: "Deadline", value: request.deadline }] : []),
          { label: "Stage", value: band(request.stage) },
          ...(request.response ? [{ label: "Response", value: request.response }] : []),
          ...(request.linkedPromiseId ? [{ label: "Commitment", value: "Linked" }] : []),
        ]}
      />
      {request.staleReason && <p className="empty-state">{request.staleReason}</p>}
      {request.fulfillmentState === "FULFILLED" && (
        <p className="subtle">Fulfilled through the normal squad-management action.</p>
      )}
      {respondable && (
        <>
          <p className="subtle">
            Your response records your stance toward this request — the relationship between you
            and the Owner (not a guaranteed switch) decides whether it settles as agreed or bounces
            back into negotiation. Agreeing never transfer-lists, loan-lists, renews, or releases
            the player by itself — use Squad, Transfers, or Contracts to actually act on it.
          </p>
          <div className="button-row">
            {RESPONSE_OPTIONS.map((option) => (
              <button
                key={option.stance}
                className={`${option.tone} small`}
                disabled={busy !== null}
                onClick={() => void respond(option.stance)}
              >
                {busy === option.stance ? "…" : option.label}
              </button>
            ))}
          </div>
        </>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </div>
  );
};

/**
 * MANAGER OWNER-REQUEST INBOX — the Manager's side of Owner→Manager player
 * requests (getManagerOwnerPlayerRequests). Active (fulfillmentState OPEN)
 * requests render first as respondable cards; resolved/stale entries render
 * below as bounded read-only history, exactly the shape the backend already
 * returns (up to 50, newest first) — nothing here recomputes staleness,
 * fulfillment, or history bounds itself.
 */
export const OwnerPlayerRequestInbox = ({
  bridge,
  refreshKey,
  onSelectPlayer,
}: {
  bridge: DesktopRuntimeApi;
  refreshKey: number;
  onSelectPlayer: (playerId: EntityId) => void;
}): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => managerBridge.getManagerOwnerPlayerRequests(), [
    refreshKey,
  ]);
  const [openOwnerId, setOpenOwnerId] = useState<EntityId | undefined>(undefined);

  return (
    <AsyncPanel state={state}>
      {(requests) => {
        const active = requests.filter((item) => item.fulfillmentState === "OPEN");
        const history = requests.filter((item) => item.fulfillmentState !== "OPEN");
        return (
          <>
            <Panel title="Owner requests">
              {active.length === 0 ? (
                <p className="empty-state">
                  No open requests from the Owner about a player right now.
                </p>
              ) : (
                <div className="commercial-property-grid">
                  {active.map((request) => (
                    <RequestCard
                      key={request.requestId}
                      request={request}
                      bridge={bridge}
                      refresh={refresh}
                      onSelectPlayer={onSelectPlayer}
                      onOpenOwner={setOpenOwnerId}
                    />
                  ))}
                </div>
              )}
            </Panel>
            {history.length > 0 && (
              <Panel title="Recent Owner requests" className="panel-wide">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Request</th>
                        <th>Response</th>
                        <th>Status</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((request) => (
                        <tr key={request.requestId}>
                          <td>
                            <button
                              className="link"
                              onClick={() => onSelectPlayer(request.player.id)}
                            >
                              {request.player.label}
                            </button>
                          </td>
                          <td>
                            {REQUEST_INTENT_LABELS[request.requestIntent] ??
                              band(request.requestIntent)}
                          </td>
                          <td>{request.response ?? band(request.stage)}</td>
                          <td>
                            <Badge tone={FULFILLMENT_TONE[request.fulfillmentState]}>
                              {band(request.fulfillmentState)}
                            </Badge>
                          </td>
                          <td>{request.requestedOn}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
            {openOwnerId && (
              <OrganizationProfilePanel
                bridge={bridge}
                entityType="INVESTOR"
                entityId={openOwnerId}
                onClose={() => setOpenOwnerId(undefined)}
              />
            )}
          </>
        );
      }}
    </AsyncPanel>
  );
};
