import React, { useState } from "react";
import type {
  EntityId,
  MediaFeedItem,
  MediaResponseStance,
  MediaSection,
  StoryImportanceBand,
  SupporterReactionState,
  SupporterUnrestState,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, EmptyState, Metrics, Panel, useRuntimeData } from "../ui.js";
import { StoryDetailPanel } from "../RoleDetailScreen.js";

const IMPORTANCE_TONE: Record<StoryImportanceBand, "bad" | "warn" | "info" | "ok"> = {
  BREAKING: "bad",
  MAJOR: "warn",
  IMPORTANT: "info",
  ROUTINE: "ok",
};

const MEDIA_SECTION_TITLE: Record<Exclude<MediaSection, "TOP_STORIES">, string> = {
  CLUB_NEWS: "Club News",
  TRANSFERS: "Transfers",
  NATIONAL_TEAM: "National Team",
  FEDERATION: "Federation",
  AROUND_NEPAL: "Around Nepal",
  INTERNATIONAL_CONTEXT: "International Context",
};

const THREAD_STATUS_TONE: Record<NonNullable<MediaFeedItem["threadStatus"]>, "bad" | "warn" | "info" | "ok"> = {
  Active: "info",
  Waiting: "warn",
  Resolved: "ok",
  Collapsed: "bad",
};

/** One card in the Media/News feed — importance, source, headline, a short
 * standfirst, world date, involved entities, and thread status when this
 * story belongs to a still-derivable saga. The headline opens the same
 * Story Detail used everywhere else in the game. */
const MediaFeedCard = ({ item, onOpen }: { item: MediaFeedItem; onOpen: (eventId: EntityId) => void }): React.ReactElement => (
  <li className="media-feed-card">
    <div className="button-row">
      <Badge tone={IMPORTANCE_TONE[item.importanceBand]}>{item.importanceBand}</Badge>
      <span className="subtle">{item.outletName}</span>
      {item.threadStatus && <Badge tone={THREAD_STATUS_TONE[item.threadStatus]}>{item.threadStatus}</Badge>}
    </div>
    <button className="link" onClick={() => onOpen(item.story.sourceEntityId)}>
      {item.story.headline}
    </button>
    <p className="subtle">{item.standfirst}</p>
    <div className="button-row">
      <span className="subtle">{item.story.publishedOn}</span>
      {item.entities.map((entity) => (
        <Badge key={`${entity.entityType}:${entity.id}`} tone="info">
          {entity.label}
        </Badge>
      ))}
    </div>
  </li>
);

const MediaFeedSection = ({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: MediaFeedItem[];
  onOpen: (eventId: EntityId) => void;
}): React.ReactElement | null => {
  if (items.length === 0) return null;
  return (
    <Panel title={title}>
      <ul className="report-list">
        {items.map((item) => (
          <MediaFeedCard key={item.story.id} item={item} onOpen={onOpen} />
        ))}
      </ul>
    </Panel>
  );
};

const STANCES: MediaResponseStance[] = ["CALM", "AMBITIOUS", "PROTECTIVE", "CONCILIATORY"];

const unrestTone = (state: SupporterUnrestState): "ok" | "warn" | "bad" | "info" => {
  switch (state) {
    case "CONTENT":
      return "ok";
    case "CONCERNED":
      return "warn";
    case "FRUSTRATED":
      return "warn";
    default:
      return "bad";
  }
};

const reactionTone = (state?: SupporterReactionState): "ok" | "warn" | "bad" | "info" => {
  switch (state) {
    case "SUPPORTIVE":
    case "CONTENT":
      return "ok";
    case "RESTLESS":
      return "warn";
    case "ANGRY":
    case "PROTESTING":
      return "bad";
    default:
      return "info";
  }
};

const framingTone = (framing: "POSITIVE" | "NEUTRAL" | "CRITICAL" | "SENSATIONAL"): "ok" | "warn" | "bad" | "info" =>
  framing === "POSITIVE" ? "ok" : framing === "CRITICAL" ? "bad" : framing === "SENSATIONAL" ? "warn" : "info";

export const MediaScreen = (): React.ReactElement => {
  const [mediaState, refreshMedia] = useRuntimeData(() => managerBridge.getMediaCentre());
  const [supporterState] = useRuntimeData(() => managerBridge.getSupporterOverview());
  const [stance, setStance] = useState<MediaResponseStance>("CALM");
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openStoryEventId, setOpenStoryEventId] = useState<EntityId | null>(null);

  const requestConference = async (storyId: EntityId) => {
    setBusy(true);
    setActionError(null);
    const result = await managerBridge.requestPressConference(storyId);
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error?.message ?? "Could not open a press conference.");
      return;
    }
    setResponse("");
    setStance("CALM");
    refreshMedia();
  };

  const answerConference = async (interviewId: EntityId) => {
    if (!response.trim()) return;
    setBusy(true);
    setActionError(null);
    const result = await managerBridge.answerPressConference({
      interviewId,
      stance,
      response: response.trim(),
    });
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error?.message ?? "Could not send that response.");
      return;
    }
    setResponse("");
    refreshMedia();
  };

  return (
    <section className="dashboard">
      {actionError && (
        <div className="warning" role="alert">
          {actionError}
        </div>
      )}

      <AsyncPanel state={supporterState} isEmpty={(data) => !data}>
        {(supporters) =>
          supporters ? (
            <Panel title="Supporters">
              <Metrics
                items={[
                  { label: "Mood", value: Math.round(supporters.mood) },
                  { label: "Expectations", value: Math.round(supporters.expectations) },
                  { label: "Manager approval", value: Math.round(supporters.managerApproval) },
                  { label: "Ownership trust", value: Math.round(supporters.ownershipTrust) },
                ]}
              />
              <p>
                Unrest <Badge tone={unrestTone(supporters.unrest)}>{supporters.unrest.toLowerCase()}</Badge>
                {supporters.reaction && (
                  <>
                    {" "}
                    · Reaction <Badge tone={reactionTone(supporters.reaction)}>{supporters.reaction.toLowerCase()}</Badge>
                  </>
                )}
              </p>
              {supporters.activeConcerns && supporters.activeConcerns.length > 0 && (
                <>
                  <h3>Active concerns</h3>
                  <ul className="report-list">
                    {supporters.activeConcerns.map((concern, index) => (
                      <li key={`${index}-${concern}`}>{concern}</li>
                    ))}
                  </ul>
                </>
              )}
              {supporters.protestCooldownUntil && (
                <p className="warning">
                  Supporters are protesting; the next protest cannot be organised again until{" "}
                  {supporters.protestCooldownUntil}.
                </p>
              )}
              {supporters.recentEvents.length > 0 && (
                <>
                  <h3>Recent supporter events</h3>
                  <ul className="report-list">
                    {supporters.recentEvents.slice(0, 6).map((event) => (
                      <li key={event.id}>
                        {event.summary} <span className="subtle">{event.date}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>
          ) : (
            <></>
          )
        }
      </AsyncPanel>

      <AsyncPanel state={mediaState}>
        {(media) => (
          <>
            <Panel title="Press conference">
              {media.pendingInterview ? (
                <>
                  <p className="subtle">
                    Open with{" "}
                    <Badge tone={framingTone(media.pendingInterview.framing)}>
                      {media.pendingInterview.framing.toLowerCase()}
                    </Badge>{" "}
                    framing.
                  </p>
                  {media.pendingInterview.questions.length > 0 && (
                    <ul className="report-list">
                      {media.pendingInterview.questions.map((question) => (
                        <li key={question.id}>{question.prompt}</li>
                      ))}
                    </ul>
                  )}
                  <div className="controls">
                    <label>
                      Stance
                      <select
                        value={stance}
                        onChange={(event) => setStance(event.target.value as MediaResponseStance)}
                        disabled={busy}
                      >
                        {STANCES.map((option) => (
                          <option key={option} value={option}>
                            {option.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Response
                      <textarea
                        value={response}
                        onChange={(event) => setResponse(event.target.value)}
                        disabled={busy}
                        rows={3}
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={busy || !response.trim()}
                      onClick={() => void answerConference(media.pendingInterview!.interview.id)}
                    >
                      {busy ? "Sending…" : "Give response"}
                    </button>
                  </div>
                </>
              ) : media.eligibleForInterview.length > 0 ? (
                <>
                  <p className="subtle">Request a press conference about a recent story.</p>
                  <ul className="report-list">
                    {media.eligibleForInterview.map((story) => (
                      <li key={story.id}>
                        {story.headline}
                        <div className="button-row">
                          <button
                            className="ghost small"
                            disabled={busy}
                            onClick={() => void requestConference(story.id)}
                          >
                            Request press conference
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState>No press conference is available right now.</EmptyState>
              )}
            </Panel>

            {media.feed.length === 0 ? (
              <Panel title="Media">
                <EmptyState>No media coverage yet.</EmptyState>
              </Panel>
            ) : (
              <>
                <MediaFeedSection
                  title="Top Stories"
                  items={[...media.feed].sort((a, b) => b.story.importance - a.story.importance).slice(0, 5)}
                  onOpen={setOpenStoryEventId}
                />
                {(Object.keys(MEDIA_SECTION_TITLE) as Exclude<MediaSection, "TOP_STORIES">[]).map((section) => (
                  <MediaFeedSection
                    key={section}
                    title={MEDIA_SECTION_TITLE[section]}
                    items={media.feed.filter((item) => item.section === section)}
                    onOpen={setOpenStoryEventId}
                  />
                ))}
              </>
            )}
            {openStoryEventId && (
              <StoryDetailPanel
                bridge={managerBridge}
                eventId={openStoryEventId}
                onClose={() => setOpenStoryEventId(null)}
                onOpenReference={() => undefined}
              />
            )}

            {media.completedInterviews.length > 0 && (
              <Panel title="Past interviews">
                <ul className="report-list">
                  {media.completedInterviews.map((interview) => (
                    <li key={interview.id}>
                      {interview.summary} <span className="subtle">{interview.interviewDate}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        )}
      </AsyncPanel>
    </section>
  );
};
