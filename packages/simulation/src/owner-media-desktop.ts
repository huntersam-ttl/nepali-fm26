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
 * Owner press — the same MediaInterview/journalist/outlet pipeline
 * press-interviews.ts already runs for the Manager, entered through its own
 * OWNER_BUSINESS context instead of a second engine. See
 * manager-media-desktop.ts's structured-press section for the sibling
 * Manager entry points this mirrors.
 */

/** Turns a real, persisted OWNER_BUSINESS MediaInterview into the one
 * canonical, UI-ready structured-press view — identical shape to the
 * Manager's own view, entity references resolved for the CHAIRMAN_OWNER
 * role so an owner-appropriate action set is offered (e.g. an
 * infrastructure-project reference opens with OPEN_PROJECT/VIEW_PROGRESS,
 * not a manager's actions). */
const buildOwnerStructuredPressConferenceView = (
  db: GameDatabase,
  interview: MediaInterview,
): StructuredPressConferenceView => {
  const journalist = buildEntityReference(db, "JOURNALIST", interview.journalistId, "CHAIRMAN_OWNER");
  const outlet = buildEntityReference(db, "MEDIA_OUTLET", interview.outletId, "CHAIRMAN_OWNER");
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
            .map((ref) => resolveStoryEntityReference(db, ref, "CHAIRMAN_OWNER"))
            .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref)),
          options: question.options,
        }
      : undefined,
    priorAnswers,
    completedSummary: interview.status === "COMPLETED" ? interview.summary : undefined,
    createdOn: interview.interviewDate,
  };
};

/** Every real, currently-true owner-press topic (infrastructure project,
 * sponsorship) this club has already been asked about AND answered — checked
 * once ever, not per calendar date, so a topic that stays true across many
 * dashboard opens is never re-asked. Scope is intentionally narrow: an
 * owner is asked about a genuinely new fact once, never on a recurring
 * schedule. Only COMPLETED interviews count: a still-OPEN interview's own
 * topic must stay a valid candidate so startPressConference's existingOpen
 * check (one open conference per role) can resolve back to that same
 * interview instead of generatePressQuestions finding nothing left and
 * evaluateOwnerBusinessPress reporting "nothing new" while a conference is
 * still sitting unanswered in the owner's inbox. */
const alreadyAskedOwnerTopics = (db: GameDatabase, ownerPersonId: EntityId): Set<string> => {
  const asked = new Set<string>();
  for (const interview of new MediaPhaseBRepository(db).interviews(ownerPersonId)) {
    if (interview.context !== "OWNER_BUSINESS" || interview.status !== "COMPLETED") continue;
    for (const question of interview.structuredQuestions ?? []) {
      for (const subject of question.subjectEntities) {
        asked.add(`${question.topic}:${subject.id}`);
      }
    }
  }
  return asked;
};

/**
 * The single canonical production point for natural Owner press: called
 * once when the owner opens their dashboard. Creates an OWNER_BUSINESS
 * interview only when a genuinely new, real club-business fact exists that
 * hasn't already been asked about (a freshly APPROVED/COMPLETED
 * infrastructure project, a freshly ACTIVE sponsorship) — never a
 * recurring/weekly interview. Returns undefined when there is nothing new.
 * Idempotent: re-running once the same facts have already produced an
 * interview creates nothing further.
 */
export const evaluateOwnerBusinessPress = (
  db: GameDatabase,
  save: SaveMetadata,
  input: { clubId: EntityId; ownerPersonId: EntityId },
): StructuredPressConferenceView | undefined => {
  const asked = alreadyAskedOwnerTopics(db, input.ownerPersonId);
  const questions = generatePressQuestions(db, {
    context: "OWNER_BUSINESS",
    clubId: input.clubId,
    excludeTopicSubjectKeys: asked,
  });
  if (questions.length === 0) return undefined;

  // clubId alone is not a unique dedup key for OWNER_BUSINESS: two distinct
  // real facts (a new sponsorship, a new infrastructure project) can both
  // become press-worthy on the very same calendar date, and without a
  // per-event key they would collide onto the same interview id.
  const dedupeKey = Array.from(
    new Set(questions.flatMap((question) => question.subjectEntities.map((subject) => subject.id))),
  )
    .sort()
    .join(",");

  const interview = startPressConference(db, {
    context: "OWNER_BUSINESS",
    managerPersonId: input.ownerPersonId,
    clubId: input.clubId,
    date: save.worldDate,
    dedupeKey,
    excludeTopicSubjectKeys: asked,
  });
  if (!interview.structuredQuestions || interview.structuredQuestions.length === 0) return undefined;
  return buildOwnerStructuredPressConferenceView(db, interview);
};

export const answerOwnerStructuredPressQuestion = (
  db: GameDatabase,
  save: SaveMetadata,
  input: { ownerPersonId: EntityId; interviewId: EntityId; stance: PressResponseStance },
): StructuredPressConferenceView => {
  const interview = new MediaPhaseBRepository(db)
    .interviews(input.ownerPersonId)
    .find((item) => item.id === input.interviewId && item.context === "OWNER_BUSINESS");
  if (!interview) throw new Error("Owner interview not found");
  const answered = answerPressQuestion(db, {
    interviewId: input.interviewId,
    stance: input.stance,
    date: save.worldDate,
  });
  return buildOwnerStructuredPressConferenceView(db, answered);
};

/** Re-fetches an already-open/completed Owner interview without answering
 * anything — resumes after a reload, and reviews a completed one. */
export const getOwnerStructuredPressConference = (
  db: GameDatabase,
  input: { ownerPersonId: EntityId; interviewId: EntityId },
): StructuredPressConferenceView => {
  const interview = new MediaPhaseBRepository(db)
    .interviews(input.ownerPersonId)
    .find((item) => item.id === input.interviewId && item.context === "OWNER_BUSINESS");
  if (!interview) throw new Error("Owner interview not found");
  return buildOwnerStructuredPressConferenceView(db, interview);
};

/** The canonical, exact-once Inbox delivery for an owner's own pending
 * OWNER_BUSINESS interviews — mirrors structuredPressInboxItems exactly,
 * scoped to this role's own context so it never mixes with (or duplicates)
 * a Manager interview the same physical person might also hold open. */
export const ownerPressInboxItems = (db: GameDatabase, ownerPersonId: EntityId): InboxItem[] => {
  const open = new MediaPhaseBRepository(db)
    .interviews(ownerPersonId)
    .filter(
      (interview) =>
        interview.status === "OPEN" &&
        interview.context === "OWNER_BUSINESS" &&
        interview.structuredQuestions &&
        interview.structuredQuestions.length > 0,
    );
  return open.map((interview) => {
    const index = interview.currentQuestionIndex ?? 0;
    const question = interview.structuredQuestions![index];
    const journalist = buildEntityReference(db, "JOURNALIST", interview.journalistId, "CHAIRMAN_OWNER");
    const outlet = buildEntityReference(db, "MEDIA_OUTLET", interview.outletId, "CHAIRMAN_OWNER");
    const subjectRefs = question
      ? question.subjectEntities
          .map((ref) => resolveStoryEntityReference(db, ref, "CHAIRMAN_OWNER"))
          .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
      : [];
    const answered = interview.structuredAnswers?.length ?? 0;
    return {
      id: createStableEntityId("press-inbox", interview.id),
      createdOn: interview.interviewDate,
      type: "PRESS_INTERVIEW",
      title: answered > 0 ? "Continuing: Owner interview" : "Owner interview available",
      body: question?.prompt ?? "The press would like to speak with you.",
      relatedEntity: { id: interview.id, type: "mediaInterview" },
      read: false,
      entityReferences: [journalist, outlet, ...subjectRefs],
    } satisfies InboxItem;
  });
};
