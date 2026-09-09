import React, { useState } from "react";
import type {
  ConcernResponseAction,
  EntityId,
  EntityReference,
  PlayerDemandManagerResponse,
  SquadConcernView,
  SquadDemandView,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { EntityRefLink } from "../RoleDetailScreen.js";
import {
  MeetingBrief,
  MeetingOptions,
  MeetingParticipants,
  MeetingShell,
  type MeetingContextItem,
  type MeetingOption,
} from "../meetings.js";
import { humanizeEnum } from "../storyHumanizer.js";

const concernActionOption = (action: ConcernResponseAction): MeetingOption => {
  switch (action) {
    case "REASSURE":
      return { id: action, label: "Reassure", description: "Explain your thinking without a firm commitment.", tone: "neutral" };
    case "DISMISS":
      return { id: action, label: "Dismiss", description: "Tell them this isn't changing.", tone: "risk" };
    case "PROMISE_PLAYING_TIME":
      return { id: action, label: "Promise more minutes", description: "A real, measurable commitment.", tone: "primary" };
    case "PROMISE_CONTRACT_REVIEW":
      return { id: action, label: "Promise a contract review", tone: "primary" };
    case "PROMISE_SQUAD_ROLE":
      return { id: action, label: "Promise to reconsider their role", tone: "primary" };
    case "PROMISE_TRANSFER_STANCE":
      return { id: action, label: "Promise not to sanction a move", tone: "primary" };
    case "PROMISE_LOAN_CONSIDERATION":
      return { id: action, label: "Promise to consider a loan", tone: "primary" };
    case "PROMISE_SQUAD_STRENGTHENING":
      return { id: action, label: "Promise to strengthen the squad", tone: "primary" };
    default:
      return { id: action, label: humanizeEnum(action) };
  }
};

const demandActionOption = (response: PlayerDemandManagerResponse): MeetingOption => {
  switch (response) {
    case "ACCEPT":
      return { id: response, label: "Accept", description: "Grant the request — creates a real, measurable promise.", tone: "primary" };
    case "REJECT":
      return { id: response, label: "Reject", description: "Turn the request down.", tone: "risk" };
    case "DEFER":
      return { id: response, label: "Defer", description: "Ask for more time before deciding.", tone: "neutral" };
    case "ALTERNATIVE":
      return { id: response, label: "Offer an alternative", tone: "neutral" };
  }
};

/**
 * The Player Meeting — the shared entry point for every squad-dynamics
 * concern/demand response, built on the same reusable Meeting framework
 * (MeetingShell/MeetingParticipants/MeetingBrief/MeetingOptions) every
 * other manager-facing negotiation already uses. Takes exactly one of a
 * concern or a demand; whichever is present determines the real backend
 * command this dispatches to (respondToConcern / respondToDemand) — no
 * local-only outcome is ever fabricated.
 */
export const PlayerMeetingPanel = ({
  playerName,
  managerName,
  concern,
  demand,
  onOpenReference,
  onClose,
  onUpdate,
}: {
  playerName: string;
  managerName: string;
  concern?: SquadConcernView;
  demand?: SquadDemandView;
  /** Present wherever the caller already has somewhere to route a clicked
   * entity — without it, the transfer-context club/competition rows simply
   * render as plain text instead of a link. */
  onOpenReference?: (reference: EntityReference) => void;
  onClose: () => void;
  onUpdate: () => void;
}): React.ReactElement => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  const transferContext = concern?.transferContext;

  const issue = concern
    ? concern.type === "TRANSFER_INTEREST"
      ? `${playerName} is unhappy about a blocked move${transferContext ? ` to ${transferContext.interestedClub.label}` : ""}.`
      : `${playerName} is unhappy about ${humanizeEnum(concern.type).toLowerCase()}.`
    : demand
      ? `${playerName} has a request: ${demand.requestedOutcome}`
      : "";

  const context: MeetingContextItem[] = concern
    ? [
        { label: "Concern", value: humanizeEnum(concern.type) },
        { label: "Status", value: humanizeEnum(concern.status), tone: concern.status === "ESCALATED" ? "bad" : "warn" },
        { label: "Severity", value: `${concern.severity}/10` },
        { label: "Raised on", value: concern.raisedOn },
        ...(concern.note ? [{ label: "Evidence", value: concern.note }] : []),
        ...(transferContext
          ? [
              {
                label: "Interested club",
                value: onOpenReference ? (
                  <EntityRefLink reference={transferContext.interestedClub} onOpen={onOpenReference} />
                ) : (
                  transferContext.interestedClub.label
                ),
              },
              ...(transferContext.competition
                ? [
                    {
                      label: "Competition",
                      value: onOpenReference ? (
                        <EntityRefLink reference={transferContext.competition} onOpen={onOpenReference} />
                      ) : (
                        transferContext.competition.label
                      ),
                    },
                  ]
                : []),
              ...(transferContext.offerStatus
                ? [{ label: "Offer", value: humanizeEnum(transferContext.offerStatus), tone: "info" as const }]
                : []),
              ...(transferContext.requestStatus
                ? [{ label: "Player's request", value: humanizeEnum(transferContext.requestStatus), tone: "warn" as const }]
                : []),
            ]
          : []),
        ...(concern.activePromise
          ? [{ label: "Active promise", value: `${concern.activePromise.description} (due ${concern.activePromise.dueOn})`, tone: "info" as const }]
          : []),
      ]
    : demand
      ? [
          { label: "Request", value: humanizeEnum(demand.type) },
          { label: "Severity", value: `${demand.severity}/10` },
          { label: "Opened on", value: demand.openedOn },
          ...(demand.reviewOn ? [{ label: "Review by", value: demand.reviewOn, tone: "warn" as const }] : []),
          { label: "Trigger", value: demand.trigger },
        ]
      : [];

  const options: MeetingOption[] = concern
    ? concern.activePromise
      ? []
      : concern.validActions.map(concernActionOption)
    : demand
      ? (["ACCEPT", "DEFER", "REJECT"] as PlayerDemandManagerResponse[]).map(demandActionOption)
      : [];

  const onChoose = async (id: string): Promise<void> => {
    setBusyId(id);
    setError(null);
    const result = concern
      ? await managerBridge.respondToConcern(concern.id, id as ConcernResponseAction)
      : demand
        ? await managerBridge.respondToDemand({ demandId: demand.id, response: id as PlayerDemandManagerResponse })
        : { ok: false as const, error: { code: "INVALID_SELECTION" as const, message: "Nothing to respond to." } };
    setBusyId(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setResolved(true);
    onUpdate();
  };

  return (
    <div className="meeting-overlay" role="dialog" aria-modal="true" aria-label="Player meeting">
      <MeetingShell
        title={`Meeting with ${playerName}`}
        meetingType={concern ? "Player concern" : "Player request"}
        deadline={demand?.reviewOn}
        context={context}
      >
        <MeetingParticipants
          initiator={{ name: managerName, role: "Manager" }}
          counterpart={{ name: playerName, role: "Player" }}
        />
        <MeetingBrief heading="Issue">
          <p>{issue}</p>
        </MeetingBrief>
        {error && (
          <p className="warning" role="alert">
            {error}
          </p>
        )}
        {resolved ? (
          <p className="ok">The meeting concluded. Close this to return to the squad.</p>
        ) : (
          <MeetingOptions options={options} onChoose={(id) => void onChoose(id)} busyId={busyId} />
        )}
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </MeetingShell>
    </div>
  );
};

export type PlayerMeetingTarget = { personId: EntityId; concernId?: EntityId; demandId?: EntityId };
