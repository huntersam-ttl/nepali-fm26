import type { GameDatabase } from "@nepal-football-sim/database";
import { MediaPhaseBRepository, MediaRepository } from "@nepal-football-sim/database";
import type {
  EntityId,
  MediaCentreView,
  MediaInterview,
  MediaResponseStance,
  PressConferenceView,
  SaveMetadata,
  SupporterReadModel,
} from "@nepal-football-sim/shared-types";
import type { ManagerContext } from "./desktop-application.js";
import {
  deriveSocialReaction,
  openPressConference,
  resolvePressConference,
  type PressConferenceReadModel,
} from "./press-social-lifestyle.js";
import { commitmentFromPressResponse } from "./commitments.js";
import { supporterReadModel } from "./supporter-culture.js";

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
  return {
    recentStories: stories.map((story) => ({
      story,
      reaction: deriveSocialReaction(story, supporters),
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
