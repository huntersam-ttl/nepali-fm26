import type { GameDatabase } from "@nepal-football-sim/database";
import { EventRepository, MediaPhaseBRepository, MediaRepository } from "@nepal-football-sim/database";
import type {
  EntityId,
  HistoricalEvent,
  InboxItem,
  MediaCentreView,
  MediaFeedItem,
  MediaInterview,
  MediaResponseStance,
  MediaSection,
  MediaStory,
  PressConferenceView,
  PressResponseStance,
  SaveMetadata,
  StructuredPressConferenceView,
  SupporterReadModel,
} from "@nepal-football-sim/shared-types";
import { createStableEntityId } from "@nepal-football-sim/shared-types";
import type { ManagerContext } from "./desktop-application.js";
import {
  deriveSocialReaction,
  openPressConference,
  resolvePressConference,
  type PressConferenceReadModel,
} from "./press-social-lifestyle.js";
import { answerPressQuestion, startPressConference } from "./press-interviews.js";
import { buildEntityReference } from "./entity-reference.js";
import { commitmentFromPressResponse } from "./commitments.js";
import { supporterReadModel } from "./supporter-culture.js";
import { resolveStoryEntityReference, storyImportanceBand } from "./story-entities.js";
import { deriveStoryThreadsFromEvents, findThreadForEvent } from "./story-threads.js";

const sectionFor = (
  story: MediaStory,
  event: HistoricalEvent | undefined,
  mySubjectIds: Set<EntityId>,
): MediaSection => {
  // "world" scope is the actual signal for a genuinely foreign story — the
  // outlet reporting it (even a wide-reach regional desk) is a publication
  // choice, not evidence the subject itself is international.
  if (event?.scope === "world") return "INTERNATIONAL_CONTEXT";
  if (story.eventType === "NATIONAL_TEAM") return "NATIONAL_TEAM";
  if (event?.scope === "federation" || event?.scope === "country") return "FEDERATION";
  if (story.eventType === "TRANSFER") return "TRANSFERS";
  if (story.subjectIds.some((id) => mySubjectIds.has(id))) return "CLUB_NEWS";
  return "AROUND_NEPAL";
};

/** The bounded, categorized Media/News feed — built once from the same
 * canonical published stories the club-scoped view already reads, never a
 * second content source. International stories stay CONTEXT_ONLY: they are
 * shown, never made interactive or playable. */
const buildFeed = (db: GameDatabase, stories: MediaStory[], mySubjectIds: Set<EntityId>): MediaFeedItem[] => {
  const outlets = new Map(new MediaRepository(db).outlets().map((outlet) => [outlet.id, outlet]));
  const eventsById = new Map(new EventRepository(db).historicalEvents().map((event) => [event.id, event]));
  const relevantEvents = stories
    .map((story) => eventsById.get(story.sourceEntityId))
    .filter((event): event is HistoricalEvent => Boolean(event));
  const threads = deriveStoryThreadsFromEvents(db, relevantEvents, "MANAGER");
  return stories.map((story) => {
    const outlet = outlets.get(story.outletId);
    const event = eventsById.get(story.sourceEntityId);
    const entities = event
      ? event.involvedEntities
          .map((ref) => resolveStoryEntityReference(db, ref, "MANAGER"))
          .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
      : [];
    const thread = event ? findThreadForEvent(threads, event.id) : undefined;
    return {
      story,
      reaction: deriveSocialReaction(story, undefined),
      section: sectionFor(story, event, mySubjectIds),
      outletName: outlet?.name ?? "Unattributed desk",
      importanceBand: storyImportanceBand(event?.importance ?? "low"),
      standfirst: story.summary,
      entities,
      threadStatus: thread?.statusLabel,
    };
  });
};

/** Minimum story importance eligible for a press-conference request, matching createMediaInterview's own gate. */
const INTERVIEW_IMPORTANCE_THRESHOLD = 6;

const ALL_STANCES: MediaResponseStance[] = ["CALM", "AMBITIOUS", "PROTECTIVE", "CONCILIATORY"];

const toView = (conference: PressConferenceReadModel): PressConferenceView => ({
  interview: conference.interview,
  questions: conference.questions,
  status: conference.status,
  framing: conference.framing,
});

/**
 * Reconstructs a view for an already-persisted interview when we no longer
 * have the ephemeral PressQuestion[] from the moment it was opened (that list
 * is not itself persisted). Falls back to the interview's own stored question
 * text, real data, just without the original per-question option split.
 */
const viewFromStoredInterview = (interview: MediaInterview): PressConferenceView => ({
  interview,
  questions: interview.questions.map((prompt, index) => ({
    id: `Q${index}`,
    prompt,
    options: ALL_STANCES,
  })),
  status: interview.status,
  framing: interview.importance >= 8 ? "CRITICAL" : interview.importance >= 6 ? "NEUTRAL" : "POSITIVE",
});

const relevantSubjects = (context: ManagerContext): Set<EntityId> => {
  const ids = new Set<EntityId>([context.team.id, context.character.personId]);
  if (context.club) ids.add(context.club.id);
  return ids;
};

const clubGender = (context: ManagerContext): "men" | "women" =>
  context.team.gender === "women" ? "women" : "men";

export const buildMediaCentreView = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
): MediaCentreView => {
  const subjects = relevantSubjects(context);
  const supporters = context.club
    ? supporterReadModel(db, context.club.id, clubGender(context))
    : undefined;
  const stories = new MediaRepository(db)
    .stories()
    .filter((story) => story.subjectIds.some((id) => subjects.has(id)))
    .sort((a, b) => (a.publishedOn < b.publishedOn ? 1 : a.publishedOn > b.publishedOn ? -1 : 0))
    .slice(0, 12);
  const interviews = new MediaPhaseBRepository(db).interviews(context.character.personId);
  const openInterview = interviews.find((item) => item.status === "OPEN");
  const answeredSourceIds = new Set(interviews.map((item) => item.sourceEntityId));
  const eligibleForInterview = stories.filter(
    (story) => story.importance >= INTERVIEW_IMPORTANCE_THRESHOLD && !answeredSourceIds.has(story.id),
  );
  const pendingInterview = openInterview ? viewFromStoredInterview(openInterview) : undefined;
  const allStories = new MediaRepository(db)
    .stories()
    .sort((a, b) => (a.publishedOn < b.publishedOn ? 1 : a.publishedOn > b.publishedOn ? -1 : 0))
    .slice(0, 60);
  return {
    recentStories: buildFeed(db, stories, subjects).map((item) => ({
      ...item,
      reaction: deriveSocialReaction(item.story, supporters),
    })),
    feed: buildFeed(db, allStories, subjects).map((item) => ({
      ...item,
      reaction: deriveSocialReaction(item.story, item.section === "CLUB_NEWS" ? supporters : undefined),
    })),
    eligibleForInterview,
    pendingInterview,
    completedInterviews: interviews.filter((item) => item.status === "COMPLETED").slice(-8).reverse(),
  };
};

export const requestManagerPressConference = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  storyId: EntityId,
): PressConferenceView => {
  const repository = new MediaPhaseBRepository(db);
  const existingOpen = repository
    .interviews(context.character.personId)
    .find((item) => item.status === "OPEN");
  // One press conference open at a time; re-opening the same story/date/context
  // would otherwise overwrite an in-progress response with a blank one.
  if (existingOpen) return viewFromStoredInterview(existingOpen);
  const story = new MediaRepository(db).stories().find((item) => item.id === storyId);
  if (!story) throw new Error("Media story not found");
  const conference = openPressConference({
    db,
    storyId,
    managerPersonId: context.character.personId,
    date: save.worldDate,
    context: "EVENT",
  });
  return toView(conference);
};

export const answerManagerPressConference = (
  db: GameDatabase,
  context: ManagerContext,
  input: { interviewId: EntityId; stance: MediaResponseStance; response: string },
): PressConferenceView => {
  const interview = new MediaPhaseBRepository(db)
    .interviews(context.character.personId)
    .find((item) => item.id === input.interviewId);
  if (!interview) throw new Error("Press conference not found");
  const conference: PressConferenceReadModel = {
    interview,
    questions: [],
    status: interview.status,
    framing: interview.importance >= 8 ? "CRITICAL" : interview.importance >= 6 ? "NEUTRAL" : "POSITIVE",
  };
  const resolved = resolvePressConference(db, { conference, stance: input.stance, response: input.response });
  commitmentFromPressResponse(db, interview.interviewDate, {
    managerProfileId: context.manager.id,
    managerPersonId: context.character.personId,
    teamId: context.team.id,
    originEventId: input.interviewId,
    dueOn: `${Number(interview.interviewDate.slice(0, 4)) + 1}-05-31`,
    response: input.response,
  });
  return toView(resolved);
};

export const buildSupporterOverview = (
  db: GameDatabase,
  context: ManagerContext,
): SupporterReadModel | undefined =>
  context.club ? supporterReadModel(db, context.club.id, clubGender(context)) : undefined;

// ---------------------------------------------------------------------------
// Structured, multi-question press conferences (press-interviews.ts). These
// are reached only through the manager desktop command layer below, so — the
// same way requestManagerPressConference/answerManagerPressConference above
// are implicitly manager-scoped — a role other than MANAGER can never reach
// this flow. It is a second entry point into the SAME MediaInterview/
// journalist/outlet pipeline above, not a second press system.
// ---------------------------------------------------------------------------

/** Turns a real, persisted MediaInterview into the one canonical, UI-ready
 * structured-press view — journalist/outlet/subject entities already
 * resolved to clickable EntityReferences, response options carrying only
 * their real text. Never a second data source: rebuilding this view from
 * the same interview row after a reload always reproduces it identically. */
const buildStructuredPressConferenceView = (
  db: GameDatabase,
  interview: MediaInterview,
): StructuredPressConferenceView => {
  const journalist = buildEntityReference(db, "JOURNALIST", interview.journalistId, "MANAGER");
  const outlet = buildEntityReference(db, "MEDIA_OUTLET", interview.outletId, "MANAGER");
  const questions = interview.structuredQuestions ?? [];
  const answers = interview.structuredAnswers ?? [];
  const index = interview.currentQuestionIndex ?? 0;
  const question = questions[index];
  const priorAnswers: import("@nepal-football-sim/shared-types").PressConferenceAnswerView[] = answers.map(
    (answer) => ({
      prompt: questions.find((item) => item.id === answer.questionId)?.prompt ?? "",
      responseText: answer.text,
      consequenceSummary: answer.consequenceSummary,
    }),
  );
  return {
    interviewId: interview.id,
    context: interview.context,
    status: interview.status,
    journalist,
    outlet,
    totalQuestions: questions.length,
    currentQuestionIndex: index,
    currentQuestion: question
      ? {
          prompt: question.prompt,
          subjectEntities: question.subjectEntities
            .map((ref) => resolveStoryEntityReference(db, ref, "MANAGER"))
            .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref)),
          options: question.options,
        }
      : undefined,
    priorAnswers,
    completedSummary: interview.status === "COMPLETED" ? interview.summary : undefined,
    createdOn: interview.interviewDate,
  };
};

export const requestManagerStructuredPressConference = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  input: { context: "PRE_MATCH" | "POST_MATCH" | "TRANSFER" | "PLAYER_ISSUE"; fixtureId?: EntityId },
): StructuredPressConferenceView => {
  const interview = startPressConference(db, {
    context: input.context,
    managerPersonId: context.character.personId,
    teamId: context.team.id,
    date: save.worldDate,
    fixtureId: input.fixtureId,
  });
  return buildStructuredPressConferenceView(db, interview);
};

export const answerManagerStructuredPressQuestion = (
  db: GameDatabase,
  save: SaveMetadata,
  context: ManagerContext,
  input: { interviewId: EntityId; stance: PressResponseStance },
): StructuredPressConferenceView => {
  const interview = new MediaPhaseBRepository(db)
    .interviews(context.character.personId)
    .find((item) => item.id === input.interviewId);
  if (!interview) throw new Error("Press conference not found");
  const answered = answerPressQuestion(db, {
    interviewId: input.interviewId,
    stance: input.stance,
    teamId: context.team.id,
    date: save.worldDate,
  });
  return buildStructuredPressConferenceView(db, answered);
};

/** Re-fetches the current view of an already-open/completed structured
 * interview without answering anything — used to resume mid-conference
 * after a reload, and to review a completed interview from history. */
export const getManagerStructuredPressConference = (
  db: GameDatabase,
  context: ManagerContext,
  interviewId: EntityId,
): StructuredPressConferenceView => {
  const interview = new MediaPhaseBRepository(db)
    .interviews(context.character.personId)
    .find((item) => item.id === interviewId);
  if (!interview) throw new Error("Press conference not found");
  return buildStructuredPressConferenceView(db, interview);
};

const PRESS_CONTEXT_TITLE: Record<MediaInterview["context"], string> = {
  PRE_MATCH: "Pre-match press conference",
  POST_MATCH: "Post-match press conference",
  TRANSFER: "Transfer interview",
  PLAYER_ISSUE: "Player issue interview",
  EVENT: "Press conference",
};

/**
 * The canonical, exact-once Inbox delivery for a manager's own pending
 * structured press interviews — computed fresh from the real MediaInterview
 * rows each call (never a second persisted delivery record), so there is
 * never more than one Inbox item per open interview, it updates itself from
 * PENDING to PARTIALLY-ANSWERED automatically, and disappears the moment the
 * interview completes (a completed interview is reviewed from Media's own
 * "Past interviews" instead — no stale "Open Press Conference" action).
 * Skips an interview with zero grounded questions: there is genuinely
 * nothing to notify the manager about yet.
 */
export const structuredPressInboxItems = (
  db: GameDatabase,
  managerPersonId: EntityId,
): InboxItem[] => {
  const open = new MediaPhaseBRepository(db)
    .interviews(managerPersonId)
    .filter(
      (interview) =>
        interview.status === "OPEN" &&
        interview.structuredQuestions &&
        interview.structuredQuestions.length > 0,
    );
  return open.map((interview) => {
    const index = interview.currentQuestionIndex ?? 0;
    const question = interview.structuredQuestions![index];
    const journalist = buildEntityReference(db, "JOURNALIST", interview.journalistId, "MANAGER");
    const outlet = buildEntityReference(db, "MEDIA_OUTLET", interview.outletId, "MANAGER");
    const subjectRefs = question
      ? question.subjectEntities
          .map((ref) => resolveStoryEntityReference(db, ref, "MANAGER"))
          .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
      : [];
    const answered = interview.structuredAnswers?.length ?? 0;
    const contextLabel = PRESS_CONTEXT_TITLE[interview.context];
    return {
      id: createStableEntityId("press-inbox", interview.id),
      createdOn: interview.interviewDate,
      type: "PRESS_INTERVIEW",
      title: answered > 0 ? `Continuing: ${contextLabel}` : `${contextLabel} available`,
      body: question?.prompt ?? "The press would like to speak with you.",
      relatedEntity: { id: interview.id, type: "mediaInterview" },
      read: false,
      entityReferences: [journalist, outlet, ...subjectRefs],
    } satisfies InboxItem;
  });
};
