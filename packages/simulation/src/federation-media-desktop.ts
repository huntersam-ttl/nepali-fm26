import type { GameDatabase } from "@nepal-football-sim/database";
import { MediaPhaseBRepository } from "@nepal-football-sim/database";
import type {
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
 * Federation President press — the same MediaInterview/journalist/outlet
 * pipeline press-interviews.ts already runs for the Manager and Owner,
 * entered through its own FEDERATION_GOVERNANCE context instead of a second
 * engine. Mirrors owner-media-desktop.ts exactly, one role down.
 */

const buildPresidentStructuredPressConferenceView = (
  db: GameDatabase,
  interview: MediaInterview,
): StructuredPressConferenceView => {
  const journalist = buildEntityReference(db, "JOURNALIST", interview.journalistId, "FEDERATION_PRESIDENT");
  const outlet = buildEntityReference(db, "MEDIA_OUTLET", interview.outletId, "FEDERATION_PRESIDENT");
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
            .map((ref) => resolveStoryEntityReference(db, ref, "FEDERATION_PRESIDENT"))
            .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref)),
          options: question.options,
        }
      : undefined,
    priorAnswers,
    completedSummary: interview.status === "COMPLETED" ? interview.summary : undefined,
    createdOn: interview.interviewDate,
  };
};

/** Every real, currently-true federation-press topic (infrastructure
 * project, competition reform, coach appointment) this federation has
 * already been asked about AND answered — checked once ever, not per
 * calendar date. Only COMPLETED interviews count: a still-OPEN interview's
 * own topic must stay a valid candidate so startPressConference's
 * existingOpen check (one open conference per role) can resolve back to
 * that same interview instead of generatePressQuestions finding nothing
 * left and evaluatePresidentPress reporting "nothing new" while a
 * conference is still sitting unanswered in the President's inbox. */
const alreadyAskedPresidentTopics = (db: GameDatabase, presidentPersonId: EntityId): Set<string> => {
  const asked = new Set<string>();
  for (const interview of new MediaPhaseBRepository(db).interviews(presidentPersonId)) {
    if (interview.context !== "FEDERATION_GOVERNANCE" || interview.status !== "COMPLETED") continue;
    for (const question of interview.structuredQuestions ?? []) {
      for (const subject of question.subjectEntities) {
        asked.add(`${question.topic}:${subject.id}`);
      }
    }
  }
  return asked;
};

/**
 * The single canonical production point for natural President press: called
 * once when the President opens their federation dashboard. Creates a
 * FEDERATION_GOVERNANCE interview only when a genuinely new, real
 * federation-governance fact exists that hasn't already been asked about (a
 * federation project reaching a construction/completion milestone, an
 * implemented competition reform, a national team coach appointment) —
 * never a recurring/weekly interview. Returns undefined when there is
 * nothing new. Idempotent: re-running once the same facts have already
 * produced an interview creates nothing further.
 */
export const evaluatePresidentPress = (
  db: GameDatabase,
  save: SaveMetadata,
  input: { federationId: EntityId; presidentPersonId: EntityId },
): StructuredPressConferenceView | undefined => {
  const asked = alreadyAskedPresidentTopics(db, input.presidentPersonId);
  const questions = generatePressQuestions(db, {
    context: "FEDERATION_GOVERNANCE",
    federationId: input.federationId,
    excludeTopicSubjectKeys: asked,
  });
  if (questions.length === 0) return undefined;

  // federationId alone is not a unique dedup key for FEDERATION_GOVERNANCE:
  // two distinct real facts (a coach appointment, a completed project) can
  // both become press-worthy on the very same calendar date, and without a
  // per-event key they would collide onto the same interview id.
  const dedupeKey = Array.from(
    new Set(questions.flatMap((question) => question.subjectEntities.map((subject) => subject.id))),
  )
    .sort()
    .join(",");

  const interview = startPressConference(db, {
    context: "FEDERATION_GOVERNANCE",
    managerPersonId: input.presidentPersonId,
    federationId: input.federationId,
    date: save.worldDate,
    dedupeKey,
    excludeTopicSubjectKeys: asked,
  });
  if (!interview.structuredQuestions || interview.structuredQuestions.length === 0) return undefined;
  return buildPresidentStructuredPressConferenceView(db, interview);
};

export const answerPresidentStructuredPressQuestion = (
  db: GameDatabase,
  save: SaveMetadata,
  input: { presidentPersonId: EntityId; interviewId: EntityId; stance: PressResponseStance },
): StructuredPressConferenceView => {
  const interview = new MediaPhaseBRepository(db)
    .interviews(input.presidentPersonId)
    .find((item) => item.id === input.interviewId && item.context === "FEDERATION_GOVERNANCE");
  if (!interview) throw new Error("Federation President interview not found");
  const answered = answerPressQuestion(db, {
    interviewId: input.interviewId,
    stance: input.stance,
    date: save.worldDate,
  });
  return buildPresidentStructuredPressConferenceView(db, answered);
};

/** Re-fetches an already-open/completed President interview without
 * answering anything — resumes after a reload, and reviews a completed
 * one. */
export const getPresidentStructuredPressConference = (
  db: GameDatabase,
  input: { presidentPersonId: EntityId; interviewId: EntityId },
): StructuredPressConferenceView => {
  const interview = new MediaPhaseBRepository(db)
    .interviews(input.presidentPersonId)
    .find((item) => item.id === input.interviewId && item.context === "FEDERATION_GOVERNANCE");
  if (!interview) throw new Error("Federation President interview not found");
  return buildPresidentStructuredPressConferenceView(db, interview);
};

/** The canonical, exact-once Inbox delivery for a President's own pending
 * FEDERATION_GOVERNANCE interviews — mirrors ownerPressInboxItems exactly,
 * scoped to this role's own context so it never mixes with (or duplicates)
 * a Manager/Owner interview the same physical person might also hold
 * open. */
export const presidentPressInboxItems = (db: GameDatabase, presidentPersonId: EntityId): InboxItem[] => {
  const open = new MediaPhaseBRepository(db)
    .interviews(presidentPersonId)
    .filter(
      (interview) =>
        interview.status === "OPEN" &&
        interview.context === "FEDERATION_GOVERNANCE" &&
        interview.structuredQuestions &&
        interview.structuredQuestions.length > 0,
    );
  return open.map((interview) => {
    const index = interview.currentQuestionIndex ?? 0;
    const question = interview.structuredQuestions![index];
    const journalist = buildEntityReference(db, "JOURNALIST", interview.journalistId, "FEDERATION_PRESIDENT");
    const outlet = buildEntityReference(db, "MEDIA_OUTLET", interview.outletId, "FEDERATION_PRESIDENT");
    const subjectRefs = question
      ? question.subjectEntities
          .map((ref) => resolveStoryEntityReference(db, ref, "FEDERATION_PRESIDENT"))
          .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
      : [];
    const answered = interview.structuredAnswers?.length ?? 0;
    return {
      id: createStableEntityId("press-inbox", interview.id),
      createdOn: interview.interviewDate,
      type: "PRESS_INTERVIEW",
      title: answered > 0 ? "Continuing: Federation press conference" : "Federation press conference available",
      body: question?.prompt ?? "The press would like to speak with you.",
      relatedEntity: { id: interview.id, type: "mediaInterview" },
      read: false,
      entityReferences: [journalist, outlet, ...subjectRefs],
    } satisfies InboxItem;
  });
};
