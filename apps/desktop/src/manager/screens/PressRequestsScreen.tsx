import React, { useState } from "react";
import type {
  EntityId,
  EntityReference,
  EntityReferenceType,
  MediaCentreView,
  MediaDirectoryView,
  MediaInterview,
  MediaResponseStance,
  MediaStory,
  PressConferenceView,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Panel, useRuntimeData, type Async } from "../ui.js";
import { EntityRefLink } from "../RoleDetailScreen.js";

/**
 * Phase 7B — Press Requests (Media interaction).
 *
 * Drives the canonical press-request + interview flow: stories that can be
 * requested as press coverage, an open interview to answer with a stance and
 * the player's own text, and the recent completed-interview history. Every
 * action uses the canonical request/answer commands; nothing is React-only.
 * The player always writes their own response text (no fabricated quotes).
 */

export const MEDIA_STANCES: MediaResponseStance[] = ["CALM", "AMBITIOUS", "PROTECTIVE", "CONCILIATORY"];

export const pendingInterview = (view: MediaCentreView): PressConferenceView | undefined => view.pendingInterview;

export const eligibleStories = (view: MediaCentreView): MediaStory[] => view.eligibleForInterview ?? [];

export const completedInterviews = (view: MediaCentreView): MediaInterview[] => view.completedInterviews ?? [];

export const journalistRefFor = (dir: MediaDirectoryView | undefined, id: EntityId): EntityReference | undefined =>
  dir?.journalists.find((entry) => entry.reference.id === id)?.reference;

export const outletRefFor = (dir: MediaDirectoryView | undefined, id: EntityId): EntityReference | undefined =>
  dir?.outlets.find((entry) => entry.reference.id === id)?.reference;

const framingTone = (framing: string): "ok" | "warn" | "bad" | "info" =>
  framing === "POSITIVE" ? "ok" : framing === "NEUTRAL" ? "info" : framing === "CRITICAL" ? "warn" : "bad";

const humanizeContext = (context: string): string => context.replaceAll("_", " ").toLowerCase();

/** Journalist + outlet canonical links for one interview, joined with dot separators. */
const renderPeople = (
  dir: Async<MediaDirectoryView>,
  interview: MediaInterview,
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void,
): React.ReactNode => {
  const journalist = interview.journalistId && dir.status === "ready" ? journalistRefFor(dir.data, interview.journalistId) : undefined;
  const outlet = interview.outletId && dir.status === "ready" ? outletRefFor(dir.data, interview.outletId) : undefined;
  return (
    <span className="subtle">
      {journalist && <EntityRefLink reference={journalist} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />}
      {outlet && (
        <>
          {journalist ? " · " : ""}
          <EntityRefLink reference={outlet} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
        </>
      )}
    </span>
  );
};

export const PressRequestsScreen = ({
  onOpenEntity,
}: {
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void;
}): React.ReactElement => {
  const [centre, refresh] = useRuntimeData(() => managerBridge.getMediaCentre(), []);
  const [directory] = useRuntimeData(() => managerBridge.getMediaDirectory(), []);
  const [stance, setStance] = useState<MediaResponseStance>("CALM");
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const requestConference = async (storyId: EntityId): Promise<void> => {
    setBusy(true);
    setMessage(null);
    const result = await managerBridge.requestPressConference(storyId);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error?.message ?? "That press request could not be made.");
      return;
    }
    setMessage("Press coverage requested — an interview is now open.");
    await refresh();
  };

  const answerConference = async (interviewId: EntityId): Promise<void> => {
    if (!response.trim()) return;
    setBusy(true);
    setMessage(null);
    const result = await managerBridge.answerPressConference({ interviewId, stance, response: response.trim() });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error?.message ?? "That response could not be sent.");
      return;
    }
    setResponse("");
    setMessage("Response given — the interview is complete.");
    await refresh();
  };

  return (
    <AsyncPanel state={centre}>
      {(view) => {
        const pending = pendingInterview(view);
        const stories = eligibleStories(view);
        const completed = completedInterviews(view);
        return (
          <>
            {message && <p className="notice" role="status">{message}</p>}
<Panel title="Open press request" className="panel-wide">
              {pending ? (
                <>
                  <Badge tone={framingTone(pending.framing)}>{pending.framing.toLowerCase()} framing</Badge>{" "}
                  <Badge tone="info">{humanizeContext(pending.interview.context)}</Badge>
                  <p className="subtle">
                    {renderPeople(directory, pending.interview, onOpenEntity)}{" "}· {pending.interview.interviewDate}
                  </p>
                  {pending.questions.length > 0 && (
                    <>
                      <h3>Question</h3>
                      <p className="subtle">{pending.questions[0]!.prompt}</p>
                    </>
                  )}
                  <div className="inline-form">
                    <label>
                      Stance
                      <select aria-label="Response stance" value={stance} onChange={(e) => setStance(e.target.value as MediaResponseStance)}>
                        {MEDIA_STANCES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
                      </select>
                    </label>
                    <label>
                      Your response
                      <textarea
                        aria-label="Your public response"
                        rows={3}
                        value={response}
                        onChange={(e) => setResponse(e.target.value)}
                        placeholder="Write your own quoted response"
                      />
                    </label>
                    <button className="primary small" disabled={busy || !response.trim()} onClick={() => void answerConference(pending.interview.id)}>
                      Give response
                    </button>
                  </div>
                </>
              ) : (
                <p className="empty-state">No press request is currently open.</p>
              )}
            </Panel>
<Panel title="Request press coverage" className="panel-wide">
              {stories.length === 0 ? (
                <p className="empty-state">No stories are eligible for a press request right now.</p>
              ) : (
                <ul className="report-list">
                  {stories.map((story) => (
                    <li key={story.id}>
                      <button className="primary small" disabled={busy} onClick={() => void requestConference(story.id)}>
                        Request coverage
                      </button>{" "}
                      {story.headline} <span className="subtle">{story.publishedOn}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Recent press" className="panel-wide">
              {completed.length === 0 ? (
                <p className="empty-state">No completed press interactions are on record.</p>
              ) : (
                <ul className="report-list">
                  {completed.map((interview) => (
                    <li key={interview.id}>
                      <Badge tone="info">{humanizeContext(interview.context)}</Badge>{" "}
                      {renderPeople(directory, interview, onOpenEntity)}{" "}· {interview.interviewDate}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Authority">
              <p className="subtle">
                Press responses are public: choose your own wording. Responses persist through the canonical media
                pipeline and can feed stories and public reaction.
              </p>
            </Panel>
          </>
        );
      }}
    </AsyncPanel>
  );
};