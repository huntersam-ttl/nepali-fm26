import React, { useEffect, useState } from "react";
import type {
  AppResult,
  DesktopRuntimeApi,
  EntityId,
  EntityReference,
  MediaFeedItem,
  MediaResponseStance,
  MediaSection,
  PressResponseStance,
  StoryImportanceBand,
  StructuredPressConferenceView,
  SupporterReactionState,
  SupporterUnrestState,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, EmptyState, Metrics, Panel, useRuntimeData } from "../ui.js";
import { EntityRefLink, OrganizationProfilePanel, StoryDetailPanel, type ProfileEntityType } from "../RoleDetailScreen.js";
import { TransferNegotiationLauncher } from "./TransferNegotiationMeeting.js";

/**
 * OrganizationProfilePanel's `bridge` prop is typed as the full
 * DesktopRuntimeApi because it also serves Owner/President screens, but for
 * the entity types this panel ever opens from a press conference —
 * JOURNALIST, MEDIA_OUTLET, and CLUB — it only ever calls
 * bridge.getOrganizationProfile / bridge.getClubProfile, both of which
 * managerBridge genuinely implements. A PLAYER reference never goes through
 * this panel — it routes through the caller's own onSelectPlayer instead,
 * the same canonical Player Profile navigation every other manager screen
 * uses — so this narrowing is safe in practice, not just suppressed.
 */
const organizationBridge = managerBridge as unknown as DesktopRuntimeApi;

const PRESS_CONTEXT_LABEL: Record<StructuredPressConferenceView["context"], string> = {
  PRE_MATCH: "Pre-match press conference",
  POST_MATCH: "Post-match press conference",
  TRANSFER: "Transfer interview",
  PLAYER_ISSUE: "Player issue interview",
  EVENT: "Press conference",
  OWNER_BUSINESS: "Owner interview",
};

/**
 * The player-visible, question-by-question structured press conference —
 * one canonical view (StructuredPressConferenceView) resolved server-side,
 * never raw JSON. Opens (or resumes) an interview on mount, answers one
 * question at a time, and shows the completion summary once COMPLETED.
 * Reload-safe: re-mounting with the same interviewId reproduces the exact
 * same state from the persisted interview.
 */
export const StructuredPressConferencePanel = ({
  trigger,
  interviewId,
  ownerContext,
  onClose,
  onSelectPlayer,
}: {
  /** Opens a new-or-resumed conference of this type. */
  trigger?: {
    context: "PRE_MATCH" | "POST_MATCH" | "TRANSFER" | "PLAYER_ISSUE";
    fixtureId?: EntityId;
  };
  /** Resumes/reviews an already-known interview instead of opening one. */
  interviewId?: EntityId;
  /** Present when this panel is showing an Owner interview (never a manager
   * one) — routes answer/resume calls to the Owner's own commands instead of
   * the Manager's, the same one canonical MediaInterview pipeline either
   * way. Owner interviews are always opened by evaluateOwnerBusinessPress
   * (called from the Owner dashboard), never by this panel's own trigger. */
  ownerContext?: boolean;
  onClose: () => void;
  /** Present wherever the caller already has a Player Profile surface to
   * route a question's subject player into — the same canonical navigation
   * every other manager screen uses, not a second bridge/panel. */
  onSelectPlayer?: (playerId: EntityId) => void;
}): React.ReactElement => {
  const [state, setState] = useState<AppResult<StructuredPressConferenceView> | null>(null);
  const [busy, setBusy] = useState(false);
  const [openReferenceTarget, setOpenReferenceTarget] = useState<EntityReference | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const result =
        interviewId !== undefined
          ? ownerContext
            ? await managerBridge.getOwnerStructuredPressConference(interviewId)
            : await managerBridge.getStructuredPressConference(interviewId)
          : trigger
            ? await managerBridge.requestStructuredPressConference(trigger)
            : null;
      if (!cancelled && result) setState(result);
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId, ownerContext, trigger?.context, trigger?.fixtureId]);

  const answer = async (stance: PressResponseStance) => {
    if (!state?.ok) return;
    setBusy(true);
    const result = ownerContext
      ? await managerBridge.answerOwnerStructuredPressQuestion({
          interviewId: state.data.interviewId,
          stance,
        })
      : await managerBridge.answerStructuredPressQuestion({
          interviewId: state.data.interviewId,
          stance,
        });
    setBusy(false);
    setState(result);
  };

  if (!state) return <Panel title="Press conference">{<EmptyState>Opening…</EmptyState>}</Panel>;
  if (!state.ok)
    return (
      <Panel title="Press conference" actions={<button onClick={onClose}>Close</button>}>
        <p className="warning" role="alert">
          {state.error?.message ?? "Could not open this press conference."}
        </p>
      </Panel>
    );

  const view = state.data;
  return (
    <Panel
      title={PRESS_CONTEXT_LABEL[view.context]}
      actions={<button onClick={onClose}>Close</button>}
    >
      <p className="subtle">
        Interview with <EntityRefLink reference={view.journalist} onOpen={setOpenReferenceTarget} /> ·{" "}
        <EntityRefLink reference={view.outlet} onOpen={setOpenReferenceTarget} />
      </p>

      {view.priorAnswers.length > 0 && (
        <ul className="report-list">
          {view.priorAnswers.map((answered, index) => (
            <li key={index}>
              <strong>{answered.prompt}</strong>
              <br />
              {answered.responseText}
              {answered.consequenceSummary && <p className="subtle">{answered.consequenceSummary}</p>}
            </li>
          ))}
        </ul>
      )}

      {view.status === "OPEN" && view.currentQuestion ? (
        <>
          <p className="subtle">
            Question {view.currentQuestionIndex + 1} of {view.totalQuestions}
          </p>
          {view.currentQuestion.subjectEntities.length > 0 && (
            <div className="button-row">
              {view.currentQuestion.subjectEntities.map((reference) =>
                // A player subject routes through the same canonical Player
                // Profile every other manager screen uses (onSelectPlayer),
                // not a second bridge/panel — see the file-level bridge note.
                reference.entityType === "PLAYER" && onSelectPlayer ? (
                  <button
                    key={`${reference.entityType}:${reference.id}`}
                    className="link"
                    onClick={() => onSelectPlayer(reference.id)}
                  >
                    {reference.label}
                  </button>
                ) : reference.entityType === "PLAYER" ? (
                  <Badge key={`${reference.entityType}:${reference.id}`} tone="info">
                    {reference.label}
                  </Badge>
                ) : (
                  <EntityRefLink
                    key={`${reference.entityType}:${reference.id}`}
                    reference={reference}
                    onOpen={setOpenReferenceTarget}
                  />
                ),
              )}
            </div>
          )}
          <h3>{view.currentQuestion.prompt}</h3>
          <div className="controls">
            {view.currentQuestion.options.map((option) => (
              <button
                key={option.stance}
                className="ghost"
                disabled={busy}
                onClick={() => void answer(option.stance)}
              >
                {option.text}
              </button>
            ))}
          </div>
        </>
      ) : (
        <EmptyState>
          {view.completedSummary ??
            (view.totalQuestions === 0
              ? "The press has nothing pressing to ask about right now."
              : "This interview has concluded.")}
        </EmptyState>
      )}

      {openReferenceTarget && (
        <OrganizationProfilePanel
          bridge={organizationBridge}
          entityType={openReferenceTarget.entityType as ProfileEntityType}
          entityId={openReferenceTarget.id}
          onClose={() => setOpenReferenceTarget(null)}
        />
      )}
    </Panel>
  );
};

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

export const MediaScreen = ({
  onSelectPlayer,
}: {
  /** Present wherever the caller already has a Player Profile surface
   * (ManagerCareer's `openPlayer`) to route a press question's subject
   * player into. */
  onSelectPlayer?: (playerId: EntityId) => void;
} = {}): React.ReactElement => {
  const [mediaState, refreshMedia] = useRuntimeData(() => managerBridge.getMediaCentre());
  const [supporterState] = useRuntimeData(() => managerBridge.getSupporterOverview());
  const [stance, setStance] = useState<MediaResponseStance>("CALM");
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openStoryEventId, setOpenStoryEventId] = useState<EntityId | null>(null);
  const [openTransferOfferId, setOpenTransferOfferId] = useState<EntityId | null>(null);
  const [structuredTrigger, setStructuredTrigger] = useState<{
    context: "TRANSFER" | "PLAYER_ISSUE";
  } | null>(null);
  const [structuredReviewId, setStructuredReviewId] = useState<EntityId | null>(null);

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

            <Panel title="Interviews">
              <p className="subtle">Speak to the press about a squad or transfer matter directly.</p>
              <div className="button-row">
                <button
                  className="ghost small"
                  onClick={() => {
                    setStructuredReviewId(null);
                    setStructuredTrigger({ context: "TRANSFER" });
                  }}
                >
                  Transfer interview
                </button>
                <button
                  className="ghost small"
                  onClick={() => {
                    setStructuredReviewId(null);
                    setStructuredTrigger({ context: "PLAYER_ISSUE" });
                  }}
                >
                  Player issue interview
                </button>
              </div>
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
                onOpenTransferNegotiation={setOpenTransferOfferId}
              />
            )}
            {openTransferOfferId && (
              <TransferNegotiationLauncher offerId={openTransferOfferId} onClose={() => setOpenTransferOfferId(null)} />
            )}

            {media.completedInterviews.length > 0 && (
              <Panel title="Past interviews">
                <ul className="report-list">
                  {media.completedInterviews.map((interview) => (
                    <li key={interview.id}>
                      {interview.summary} <span className="subtle">{interview.interviewDate}</span>
                      {interview.structuredQuestions && (
                        <div className="button-row">
                          <button
                            className="link"
                            onClick={() => {
                              setStructuredTrigger(null);
                              setStructuredReviewId(interview.id);
                            }}
                          >
                            View interview
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {(structuredTrigger || structuredReviewId) && (
              <StructuredPressConferencePanel
                trigger={structuredTrigger ?? undefined}
                interviewId={structuredReviewId ?? undefined}
                onSelectPlayer={onSelectPlayer}
                onClose={() => {
                  setStructuredTrigger(null);
                  setStructuredReviewId(null);
                  refreshMedia();
                }}
              />
            )}
          </>
        )}
      </AsyncPanel>
    </section>
  );
};
