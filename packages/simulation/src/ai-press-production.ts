import type { GameDatabase } from "@nepal-football-sim/database";
import type { EntityId, SaveMetadata } from "@nepal-football-sim/shared-types";
import {
  generatePressQuestions,
  runAiPressConference,
  shouldCreatePostMatchPress,
} from "./press-interviews.js";
import { responsibilityOwner } from "./staff-market.js";
import { MediaPhaseBRepository } from "@nepal-football-sim/database";

/** Every real TRANSFER/PLAYER_ISSUE topic this AI manager has already been
 * asked about AND answered — the AI-production equivalent of
 * alreadyAskedOwnerTopics/alreadyAskedPresidentTopics/alreadyAskedSdTopics/
 * alreadyAskedManagerTopics, so a genuinely new topic (e.g. a transfer
 * moving from SUBMITTED to COMPLETED) can follow up on an already-completed
 * one instead of the flat TRANSFER/PLAYER_ISSUE cooldown blocking it. */
const alreadyAskedAiTopics = (
  db: GameDatabase,
  managerPersonId: EntityId,
  context: "TRANSFER" | "PLAYER_ISSUE",
): Set<string> => {
  const asked = new Set<string>();
  for (const interview of new MediaPhaseBRepository(db).interviews(managerPersonId)) {
    if (interview.context !== context || interview.status !== "COMPLETED") continue;
    for (const question of interview.structuredQuestions ?? []) {
      for (const subject of question.subjectEntities) {
        asked.add(`${question.topic}:${subject.id}`);
      }
    }
  }
  return asked;
};

const dedupeKeyForQuestions = (
  questions: ReturnType<typeof generatePressQuestions>,
): string | undefined =>
  Array.from(new Set(questions.flatMap((question) => question.subjectEntities.map((subject) => subject.id))))
    .sort()
    .join(",") || undefined;

/**
 * The single canonical producer of AI press participation — called once per
 * AI-managed team from the exact same per-fixture, per-team loop that
 * already runs manageAiPromisesForTeam/manageAiDemandsForTeam/
 * manageAiTeamMeetingsForTeam in career-world.ts, immediately after a real
 * fixture is simulated. Never a second scheduler, never invoked per render
 * or per tick — exactly once per real matchday event, for a team a human is
 * not actively controlling.
 *
 * Every call here is bounded and cheap even when it produces nothing:
 * generatePressQuestions/startPressConference's own exact-once dedup means
 * a call against an unchanged fact resolves instantly with zero rows
 * written, and shouldCreatePostMatchPress gates POST_MATCH so a routine,
 * unremarkable result never spins up a conference at all.
 */
export const manageAiPressForTeam = (
  db: GameDatabase,
  save: SaveMetadata,
  input: { teamId: EntityId; clubId: EntityId | undefined; managerPersonId: EntityId; fixtureId: EntityId },
): void => {
  const seed = `${save.randomSeed}:ai-press:${input.fixtureId}`;

  // POST_MATCH: only for a materially notable result — a red card, a heavy
  // margin, or genuine title/relegation table stakes. This is the gate that
  // stops every single AI fixture in every league from generating a
  // conference.
  const postMatch = shouldCreatePostMatchPress(db, { teamId: input.teamId, fixtureId: input.fixtureId });
  if (postMatch.trigger) {
    runAiPressConference(db, {
      context: "POST_MATCH",
      managerPersonId: input.managerPersonId,
      teamId: input.teamId,
      fixtureId: input.fixtureId,
      date: save.worldDate,
      seed,
    });
  }

  if (!input.clubId) return;

  // TRANSFER: only when this AI manager is the club's own canonical
  // TRANSFERS owner — never when the club has delegated recruitment to a
  // Sporting Director (human or otherwise), which owns that fact through
  // its own RECRUITMENT press pipeline instead. One source fact, one
  // primary press owner, same rule the human Manager-vs-SD split uses.
  if (responsibilityOwner(db, input.clubId, "TRANSFERS").ownerType === "MANAGER") {
    const transferAsked = alreadyAskedAiTopics(db, input.managerPersonId, "TRANSFER");
    const transferQuestions = generatePressQuestions(db, {
      context: "TRANSFER",
      teamId: input.teamId,
      excludeTopicSubjectKeys: transferAsked,
    });
    if (transferQuestions.length > 0) {
      runAiPressConference(db, {
        context: "TRANSFER",
        managerPersonId: input.managerPersonId,
        teamId: input.teamId,
        date: save.worldDate,
        seed,
        dedupeKey: dedupeKeyForQuestions(transferQuestions),
        excludeTopicSubjectKeys: transferAsked,
      });
    }
  }

  // PLAYER_ISSUE: only when a real active concern/demand already exists —
  // generatePressQuestions itself is the materiality check here (it returns
  // nothing for a team with no active concern), so no separate threshold is
  // needed beyond what playerIssueCandidates already requires.
  const playerIssueAsked = alreadyAskedAiTopics(db, input.managerPersonId, "PLAYER_ISSUE");
  const playerIssueQuestions = generatePressQuestions(db, {
    context: "PLAYER_ISSUE",
    teamId: input.teamId,
    excludeTopicSubjectKeys: playerIssueAsked,
  });
  if (playerIssueQuestions.length > 0) {
    runAiPressConference(db, {
      context: "PLAYER_ISSUE",
      managerPersonId: input.managerPersonId,
      teamId: input.teamId,
      date: save.worldDate,
      seed,
      dedupeKey: dedupeKeyForQuestions(playerIssueQuestions),
      excludeTopicSubjectKeys: playerIssueAsked,
    });
  }
};
