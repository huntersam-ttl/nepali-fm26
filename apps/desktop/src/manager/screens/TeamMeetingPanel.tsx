import React, { useState } from "react";
import type {
  SquadMeeting,
  TeamMeetingContext,
  TeamMeetingMessage,
  TeamMeetingMessageId,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import {
  MeetingBrief,
  MeetingOptions,
  MeetingParticipants,
  MeetingShell,
  type MeetingContextItem,
  type MeetingOption,
} from "../meetings.js";
import { humanizeEnum } from "../storyHumanizer.js";

const messageOption = (message: TeamMeetingMessage): MeetingOption => ({
  id: message.id,
  label: message.label,
  description: message.description,
  tone: message.fit === "GOOD" ? "primary" : message.fit === "POOR" ? "risk" : "neutral",
});

/**
 * The Team Meeting — reached from the Dressing Room only when a real context
 * (evaluateTeamMeetingContext / getTeamMeetingContext) says one is actually
 * warranted. Built on the same reusable Meeting framework every other
 * manager negotiation uses; the message choice and its GOOD/NEUTRAL/POOR fit
 * both come straight from the backend context, never invented here.
 */
export const TeamMeetingPanel = ({
  managerName,
  teamName,
  context,
  onClose,
  onUpdate,
}: {
  managerName: string;
  teamName: string;
  context: TeamMeetingContext;
  onClose: () => void;
  onUpdate: () => void;
}): React.ReactElement => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meeting, setMeeting] = useState<SquadMeeting | null>(null);

  const contextItems: MeetingContextItem[] = [
    { label: "Situation", value: humanizeEnum(context.type), tone: context.urgency >= 7 ? "bad" : context.urgency >= 5 ? "warn" : "info" },
    { label: "Urgency", value: `${context.urgency}/10` },
  ];

  const options: MeetingOption[] = context.messages.map(messageOption);

  const onChoose = async (id: string): Promise<void> => {
    setBusyId(id);
    setError(null);
    const result = await managerBridge.holdSquadMeeting({
      type: "SQUAD_MEETING",
      messageId: id as TeamMeetingMessageId,
    });
    setBusyId(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setMeeting(result.data.meeting);
    onUpdate();
  };

  return (
    <div className="meeting-overlay" role="dialog" aria-modal="true" aria-label="Team meeting">
      <MeetingShell
        title={`Team meeting — ${teamName}`}
        meetingType={humanizeEnum(context.type)}
        context={contextItems}
      >
        <MeetingParticipants
          initiator={{ name: managerName, role: "Manager" }}
          counterpart={{ name: teamName, role: "Squad" }}
        />
        <MeetingBrief heading="What's happening">
          <ul className="compact-list">
            {context.evidence.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </MeetingBrief>
        {error && (
          <p className="warning" role="alert">
            {error}
          </p>
        )}
        {meeting ? (
          <p className={meeting.outcome === "POSITIVE" ? "ok" : meeting.outcome === "NEGATIVE" ? "warning" : "subtle"}>
            {meeting.summary}
          </p>
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
