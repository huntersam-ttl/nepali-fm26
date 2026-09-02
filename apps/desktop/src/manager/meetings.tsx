import React from "react";
import { Badge, Panel } from "./ui.js";

/**
 * Reusable presentation layer for every "sit down with someone and talk it
 * through" screen — government, bank, investor, sponsor, board, agent, and
 * staff meetings all render through the same six pieces. None of these
 * components know anything about a specific domain: every label, option,
 * and status they render is passed in by the screen that owns the real
 * backend read model, so this file cannot itself invent a gameplay outcome.
 */

export type MeetingTone = "ok" | "warn" | "bad" | "info";

export type MeetingParticipant = {
  name: string;
  role: string;
  organisation?: string;
};

export type MeetingContextItem = {
  label: string;
  value: React.ReactNode;
  tone?: MeetingTone;
};

export type MeetingOption = {
  id: string;
  label: string;
  description?: string;
  tone?: "primary" | "neutral" | "risk";
  disabled?: boolean;
  /** Shown whenever an option is disabled, so a greyed-out choice is never unexplained. */
  disabledReason?: string;
};

export type MeetingOutcomeEntry = {
  date: string;
  label: string;
  tone: MeetingTone;
  detail?: string;
};

export type MeetingStatus = {
  label: string;
  tone: MeetingTone;
  detail?: string;
};

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

export const MeetingParticipants = ({
  initiator,
  counterpart,
}: {
  initiator: MeetingParticipant;
  counterpart: MeetingParticipant;
}): React.ReactElement => (
  <div className="meeting-participants">
    {[initiator, counterpart].map((participant, index) => (
      <div className="meeting-participant" key={index}>
        <span className="meeting-avatar" aria-hidden="true">
          {initialsOf(participant.name)}
        </span>
        <div>
          <strong>{participant.name}</strong>
          <span className="subtle">
            {participant.role}
            {participant.organisation ? ` · ${participant.organisation}` : ""}
          </span>
        </div>
      </div>
    ))}
  </div>
);

export const MeetingBrief = ({
  heading,
  children,
}: {
  heading?: string;
  children: React.ReactNode;
}): React.ReactElement => (
  <div className="meeting-brief">
    {heading && <h3>{heading}</h3>}
    <div className="meeting-brief-body">{children}</div>
  </div>
);

export const MeetingOptions = ({
  options,
  onChoose,
  busyId,
}: {
  options: MeetingOption[];
  onChoose?: (id: string) => void;
  busyId?: string | null;
}): React.ReactElement => (
  <div className="meeting-options" role="group" aria-label="Meeting responses">
    {options.length === 0 && (
      <p className="empty-state">No responses are available for this meeting yet.</p>
    )}
    {options.map((option) => (
      <button
        key={option.id}
        type="button"
        className={`meeting-option meeting-option-${option.tone ?? "neutral"}`}
        disabled={option.disabled || (busyId != null && busyId !== option.id)}
        title={option.disabled ? option.disabledReason : undefined}
        onClick={() => onChoose?.(option.id)}
      >
        <span className="meeting-option-label">
          {busyId === option.id ? "Sending…" : option.label}
        </span>
        {option.description && <span className="meeting-option-desc">{option.description}</span>}
        {option.disabled && option.disabledReason && (
          <span className="meeting-option-reason">{option.disabledReason}</span>
        )}
      </button>
    ))}
  </div>
);

export const MeetingOutcome = ({
  status,
  history,
}: {
  status?: MeetingStatus;
  history: MeetingOutcomeEntry[];
}): React.ReactElement => (
  <div className="meeting-outcome">
    {status && (
      <p className={`meeting-status meeting-status-${status.tone}`}>
        <Badge tone={status.tone}>{status.label}</Badge>
        {status.detail && <span>{status.detail}</span>}
      </p>
    )}
    {history.length === 0 ? (
      <p className="empty-state">No meeting history recorded yet.</p>
    ) : (
      <ul className="meeting-history compact-list">
        {history.map((entry, index) => (
          <li key={index}>
            <span className="subtle">{entry.date}</span> <Badge tone={entry.tone}>{entry.label}</Badge>
            {entry.detail && <span> — {entry.detail}</span>}
          </li>
        ))}
      </ul>
    )}
  </div>
);

export const MeetingContextPanel = ({
  items,
}: {
  items: MeetingContextItem[];
}): React.ReactElement => (
  <Panel title="Context" className="meeting-context">
    {items.length === 0 ? (
      <p className="empty-state">No relevant context is available yet.</p>
    ) : (
      <dl className="metrics">
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.tone ? <Badge tone={item.tone}>{item.value}</Badge> : item.value}</dd>
          </div>
        ))}
      </dl>
    )}
  </Panel>
);

export const MeetingShell = ({
  title,
  meetingType,
  deadline,
  context,
  children,
}: {
  title: string;
  meetingType: string;
  deadline?: string;
  context: MeetingContextItem[];
  children: React.ReactNode;
}): React.ReactElement => (
  <div className="meeting-shell">
    <header className="meeting-shell-head">
      <div>
        <span className="eyebrow">{meetingType}</span>
        <h2>{title}</h2>
      </div>
      {deadline && <span className="meeting-deadline">Follow-up by {deadline}</span>}
    </header>
    <div className="meeting-shell-body">
      <div className="meeting-shell-main">{children}</div>
      <MeetingContextPanel items={context} />
    </div>
  </div>
);
