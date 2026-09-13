import type { GameDatabase } from "@nepal-football-sim/database";
import { MediaPhaseBRepository } from "@nepal-football-sim/database";
import type {
  CareerRole,
  EntityId,
  InboxItem,
  MediaInterview,
  PressResponseStance,
  SaveMetadata,
  StructuredPressConferenceView,
} from "@nepal-football-sim/shared-types";
import { createStableEntityId } from "@nepal-football-sim/shared-types";
import { answerPressQuestion, generatePressQuestions, startPressConference } from "./press-interviews.js";
import { buildEntityReference } from "./entity-reference.js";
import { resolveStoryEntityReference } from "./story-entities.js";

/**
 * Sporting Director / Director of Football press — the same MediaInterview/
 * journalist/outlet pipeline Manager, Owner and President press already
 * run, entered through a new RECRUITMENT context instead of a second
 * engine. Mirrors owner-media-desktop.ts and federation-media-desktop.ts
 * exactly. `actorRole` is threaded through (rather than hardcoded) because
 * either SPORTING_DIRECTOR or DIRECTOR_OF_FOOTBALL can genuinely hold this
 * authority, with identical permissions either way.
 */

const buildSdStructuredPressConferenceView = (
  db: GameDatabase,
  interview: MediaInterview,
  actorRole: CareerRole,
): StructuredPressConferenceView => {
  const journalist = buildEntityReference(db, "JOURNALIST", interview.journalistId, actorRole);
  const outlet = buildEntityReference(db, "MEDIA_OUTLET", interview.outletId, actorRole);
  const questions = interview.structuredQuestions ?? [];
  const answers = interview.structuredAnswers ?? [];
  const index = interview.currentQuestionIndex ?? 0;
  const question = questions[index];
  const priorAnswers = answers.map((answer) => ({
    prompt: questions.find((item) => item.id === answer.questionId)?.prompt ?? "",
    responseText: answer.text,
    consequenceSummary: answer.consequenceSummary,
  }));
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
            .map((ref) => resolveStoryEntityReference(db, ref, actorRole))
            .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref)),
          options: question.options,
        }
      : undefined,
    priorAnswers,
    completedSummary: interview.status === "COMPLETED" ? interview.summary : undefined,
    createdOn: interview.interviewDate,
  };
};

/** Every real, currently-true recruitment topic (incoming signing, outgoing
 * sale, failed deal) this club has already been asked about AND answered —
 * checked once ever, not per calendar date. Only COMPLETED interviews
 * count, for the same reason as Owner/President press: a still-OPEN
 * interview's own topic must stay a valid candidate so
 * startPressConference's existingOpen check can resolve back to it. */
const alreadyAskedSdTopics = (db: GameDatabase, sdPersonId: EntityId): Set<string> => {
  const asked = new Set<string>();
  for (const interview of new MediaPhaseBRepository(db).interviews(sdPersonId)) {
    if (interview.context !== "RECRUITMENT" || interview.status !== "COMPLETED") continue;
    for (const question of interview.structuredQuestions ?? []) {
      for (const subject of question.subjectEntities) {
        asked.add(`${question.topic}:${subject.id}`);
      }
    }
  }
  return asked;
};

/**
 * The single canonical production point for natural Sporting Director /
 * Director of Football press: called once when the executive dashboard
 * opens. Creates a RECRUITMENT interview only when a genuinely new, real
 * transfer-business fact exists that hasn't already been asked about (a
 * completed incoming signing, a completed outgoing sale, a failed deal) —
 * never a recurring/weekly interview, and never at all unless the club has
 * actually delegated the TRANSFERS domain away from its Manager. Returns
 * undefined when there is nothing new.
 */
export const evaluateSportingDirectorPress = (
  db: GameDatabase,
  save: SaveMetadata,
  input: { clubId: EntityId; sdPersonId: EntityId; actorRole: CareerRole },
): StructuredPressConferenceView | undefined => {
  const asked = alreadyAskedSdTopics(db, input.sdPersonId);
  const questions = generatePressQuestions(db, {
    context: "RECRUITMENT",
    clubId: input.clubId,
    excludeTopicSubjectKeys: asked,
  });
  if (questions.length === 0) return undefined;

  // clubId alone is not a unique dedup key for RECRUITMENT: two distinct
  // real facts (an incoming signing, a failed deal) can both become
  // press-worthy on the very same calendar date, and without a per-event
  // key they would collide onto the same interview id.
  const dedupeKey = Array.from(
    new Set(questions.flatMap((question) => question.subjectEntities.map((subject) => subject.id))),
  )
    .sort()
    .join(",");

  const interview = startPressConference(db, {
    context: "RECRUITMENT",
    managerPersonId: input.sdPersonId,
    clubId: input.clubId,
    date: save.worldDate,
    dedupeKey,
    excludeTopicSubjectKeys: asked,
  });
  if (!interview.structuredQuestions || interview.structuredQuestions.length === 0) return undefined;
  return buildSdStructuredPressConferenceView(db, interview, input.actorRole);
};

export const answerSportingDirectorStructuredPressQuestion = (
  db: GameDatabase,
  save: SaveMetadata,
  input: { sdPersonId: EntityId; actorRole: CareerRole; interviewId: EntityId; stance: PressResponseStance },
): StructuredPressConferenceView => {
  const interview = new MediaPhaseBRepository(db)
    .interviews(input.sdPersonId)
    .find((item) => item.id === input.interviewId && item.context === "RECRUITMENT");
  if (!interview) throw new Error("Recruitment interview not found");
  const answered = answerPressQuestion(db, {
    interviewId: input.interviewId,
    stance: input.stance,
    date: save.worldDate,
  });
  return buildSdStructuredPressConferenceView(db, answered, input.actorRole);
};

/** Re-fetches an already-open/completed Recruitment interview without
 * answering anything — resumes after a reload, and reviews a completed
 * one. */
export const getSportingDirectorStructuredPressConference = (
  db: GameDatabase,
  input: { sdPersonId: EntityId; actorRole: CareerRole; interviewId: EntityId },
): StructuredPressConferenceView => {
  const interview = new MediaPhaseBRepository(db)
    .interviews(input.sdPersonId)
    .find((item) => item.id === input.interviewId && item.context === "RECRUITMENT");
  if (!interview) throw new Error("Recruitment interview not found");
  return buildSdStructuredPressConferenceView(db, interview, input.actorRole);
};

/** The canonical, exact-once Inbox delivery for a Sporting Director's own
 * pending RECRUITMENT interviews — mirrors ownerPressInboxItems/
 * presidentPressInboxItems exactly, scoped to this role's own context so it
 * never mixes with (or duplicates) a Manager/Owner/President interview the
 * same physical person might also hold open. */
export const sportingDirectorPressInboxItems = (
  db: GameDatabase,
  sdPersonId: EntityId,
  actorRole: CareerRole,
): InboxItem[] => {
  const open = new MediaPhaseBRepository(db)
    .interviews(sdPersonId)
    .filter(
      (interview) =>
        interview.status === "OPEN" &&
        interview.context === "RECRUITMENT" &&
        interview.structuredQuestions &&
        interview.structuredQuestions.length > 0,
    );
  return open.map((interview) => {
    const index = interview.currentQuestionIndex ?? 0;
    const question = interview.structuredQuestions![index];
    const journalist = buildEntityReference(db, "JOURNALIST", interview.journalistId, actorRole);
    const outlet = buildEntityReference(db, "MEDIA_OUTLET", interview.outletId, actorRole);
    const subjectRefs = question
      ? question.subjectEntities
          .map((ref) => resolveStoryEntityReference(db, ref, actorRole))
          .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
      : [];
    const answered = interview.structuredAnswers?.length ?? 0;
    return {
      id: createStableEntityId("press-inbox", interview.id),
      createdOn: interview.interviewDate,
      type: "PRESS_INTERVIEW",
      title: answered > 0 ? "Continuing: Recruitment interview" : "Recruitment interview available",
      body: question?.prompt ?? "The press would like to speak with you.",
      relatedEntity: { id: interview.id, type: "mediaInterview" },
      read: false,
      entityReferences: [journalist, outlet, ...subjectRefs],
    } satisfies InboxItem;
  });
};
