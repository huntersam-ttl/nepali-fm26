import {
  createStableEntityId,
  type EntityId,
  type HistoricalEvent,
  type InboxItem,
  type MediaInterview,
  type MediaJournalist,
  type MediaJournalistRelationship,
  type MediaOutlet,
  type MediaStory,
} from "@nepal-football-sim/shared-types";
import {
  EventRepository,
  ManagerRepository,
  MediaPhaseBRepository,
  MediaRepository,
  SupporterCultureRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  buildSupporterEvent,
  clampSupporterScore,
  supporterUnrestState,
} from "./supporter-culture.js";

const status = "SIMULATION_ONLY" as const;
const outlets: Array<Omit<MediaOutlet, "id">> = [
  {
    name: "Kathmandu Football Desk",
    scope: "LOCAL",
    reputation: 5.8,
    reach: 3.5,
    bias: "CLUB_FOCUSED",
    style: "ANALYSIS",
    status,
  },
  {
    name: "Nepal Football News",
    scope: "NATIONAL",
    reputation: 6.8,
    reach: 6.5,
    bias: "NATIONAL_FOCUS",
    style: "WIRE",
    status,
  },
  {
    name: "South Asia Football Review",
    scope: "REGIONAL_INTERNATIONAL",
    reputation: 8.1,
    reach: 7.4,
    bias: "NEUTRAL",
    style: "TRADE",
    status,
  },
];

export const initializeMediaForSave = (db: GameDatabase): MediaOutlet[] => {
  const repo = new MediaRepository(db);
  for (const outlet of outlets)
    repo.upsertOutlet({ ...outlet, id: createStableEntityId("media-outlet", outlet.name) });
  return repo.outlets();
};

const importance = (event: HistoricalEvent): number =>
  event.importance === "high" ? 8 : event.importance === "medium" ? 5 : 2;
const outletFor = (repo: MediaRepository, score: number): MediaOutlet =>
  repo
    .outlets()
    .sort((a, b) => b.reach - a.reach || a.id.localeCompare(b.id))
    .find((outlet) =>
      score >= 7
        ? outlet.scope !== "LOCAL"
        : outlet.scope === "LOCAL" || outlet.scope === "NATIONAL",
    ) ?? repo.outlets()[0];

const eventStory = (event: HistoricalEvent, outlet: MediaOutlet): MediaStory => {
  const score = importance(event);
  const normalized = event.eventType.toUpperCase();
  const type: MediaStory["eventType"] = normalized.includes("TRANSFER")
    ? "TRANSFER"
    : normalized.includes("STAFF") || normalized.includes("MANAGER")
      ? "STAFF_CHANGE"
      : normalized.includes("INJUR")
        ? "INJURY"
        : normalized.includes("NATIONAL") || normalized.includes("INTERNATIONAL")
          ? "NATIONAL_TEAM"
          : normalized.includes("COMPETITION") || normalized.includes("MATCH")
            ? "MATCH_RESULT"
            : "MILESTONE";
  const headline = score >= 7 ? event.title : `${event.title} noted by ${outlet.name}`;
  return {
    id: createStableEntityId("media-story", `${event.id}:${outlet.id}`),
    outletId: outlet.id,
    eventType: type,
    sourceEntityId: event.id,
    publishedOn: event.occurredOn,
    importance: score,
    headline,
    summary: event.data ? `${event.title}. Recorded event data is available.` : event.title,
    subjectIds: event.involvedEntities.map((item) => item.id),
    reputationEffect: score >= 7 ? 0.05 : 0,
    status: "PUBLISHED",
    provenanceStatus: status,
  };
};

/**
 * Applies the supporter side of public promise outcomes exactly once. Other
 * club events keep their existing specialised supporter hooks; this adapter
 * only owns the promise events that previously had no public reaction.
 */
const applyPromiseSupporterReaction = (db: GameDatabase, event: HistoricalEvent): void => {
  if (event.eventType !== "PROMISE_KEPT" && event.eventType !== "PROMISE_BROKEN") return;
  const club = event.involvedEntities.find((entity) => entity.type === "club");
  if (!club) return;
  const repository = new SupporterCultureRepository(db);
  const profile = repository.profile(club.id, "men");
  if (!profile) return;
  const supporterEventId = createStableEntityId("supporter-event", `public:${event.id}`);
  if (repository.hasEvent(supporterEventId)) return;
  const broken = event.eventType === "PROMISE_BROKEN";
  const moodDelta = broken ? -4 : 3;
  const next = {
    ...profile,
    currentMood: clampSupporterScore(profile.currentMood + moodDelta),
    optimism: clampSupporterScore(profile.optimism + (broken ? -2 : 2)),
    trustInManager: clampSupporterScore(profile.trustInManager + (broken ? -4 : 3)),
    lastEvaluatedOn: event.occurredOn,
  };
  repository.upsertProfile({ ...next, unrest: supporterUnrestState(next) });
  repository.recordEvent({
    ...buildSupporterEvent({
      clubId: club.id,
      gender: "men",
      date: event.occurredOn,
      type: broken ? "MANAGER_PRESSURE" : "MANAGER_BACKING",
      magnitude: broken ? 55 : 40,
      moodDelta,
      summary: broken
        ? "Supporters react to a broken manager promise"
        : "Supporters react to a fulfilled manager promise",
      subjectIds: event.involvedEntities.map((entity) => entity.id),
      key: `public:${event.id}`,
    }),
    id: supporterEventId,
  });
};

export const publishMediaForDate = (
  db: GameDatabase,
  input: { date: string; minimumImportance?: number },
): MediaStory[] => {
  const repo = new MediaRepository(db);
  initializeMediaForSave(db);
  const threshold = input.minimumImportance ?? 4;
  const published: MediaStory[] = [];
  for (const event of new EventRepository(db)
    .historicalEvents()
    .filter(
      (item) =>
        item.occurredOn <= input.date && importance(item) >= threshold && !repo.hasStory(item.id),
    )) {
    applyPromiseSupporterReaction(db, event);
    const outlet = outletFor(repo, importance(event));
    const story = eventStory(event, outlet);
    repo.upsertStory(story);
    published.push(story);
    if (story.importance >= 6) {
      const inbox: InboxItem = {
        id: createStableEntityId("media-inbox", story.id),
        createdOn: story.publishedOn,
        type: "COMPETITION_UPDATE",
        title: story.headline,
        body: story.summary,
        read: false,
      };
      new ManagerRepository(db).insertInboxItem(inbox);
    }
  }
  return published;
};

export const getMediaArchive = (db: GameDatabase, publishedOn?: string): MediaStory[] =>
  new MediaRepository(db).stories(publishedOn);

const journalists: Array<Omit<MediaJournalist, "id" | "outletId">> = [
  {
    name: "Asha Shrestha",
    beat: "Domestic football",
    temperament: "NEUTRAL",
    reputation: 6.5,
    status,
  },
  {
    name: "Rijan Gurung",
    beat: "National teams",
    temperament: "SCEPTICAL",
    reputation: 7.2,
    status,
  },
  {
    name: "Mina Rai",
    beat: "Player development",
    temperament: "FRIENDLY",
    reputation: 6.8,
    status,
  },
];

export const initializeMediaJournalists = (db: GameDatabase): MediaJournalist[] => {
  const outletsRepo = new MediaRepository(db);
  const repo = new MediaPhaseBRepository(db);
  initializeMediaForSave(db);
  const all = outletsRepo.outlets();
  for (const [index, profile] of journalists.entries()) {
    const outlet = all[index % all.length];
    repo.upsertJournalist({
      ...profile,
      id: createStableEntityId("media-journalist", profile.name),
      outletId: outlet.id,
    });
  }
  return repo.journalists();
};

const questionsFor = (story: MediaStory): string[] => {
  const questions: Record<MediaStory["eventType"], string> = {
    MATCH_RESULT: "What did this result show about the team's current level?",
    TRANSFER: "How does this move fit the club's sporting plan?",
    STAFF_CHANGE: "What is the priority after this football change?",
    INJURY: "What is the responsible plan for the player's recovery?",
    COMPETITION: "What is the target for the next stage of this competition?",
    MILESTONE: "What does this milestone mean for the next phase?",
    NATIONAL_TEAM: "What did this international event reveal?",
  };
  return [questions[story.eventType]];
};

export const createMediaInterview = (
  db: GameDatabase,
  input: {
    storyId: EntityId;
    managerPersonId?: EntityId;
    date: string;
    context: MediaInterview["context"];
    minimumImportance?: number;
  },
): MediaInterview => {
  const story = new MediaRepository(db).stories().find((item) => item.id === input.storyId);
  if (!story || story.importance < (input.minimumImportance ?? 6))
    throw new Error("Media event is not important enough for an interview");
  initializeMediaJournalists(db);
  const journalist =
    new MediaPhaseBRepository(db).journalists().find((item) => item.outletId === story.outletId) ??
    new MediaPhaseBRepository(db).journalists()[0];
  if (!journalist) throw new Error("No journalist is available");
  const interview: MediaInterview = {
    id: createStableEntityId("media-interview", `${story.id}:${input.context}:${input.date}`),
    outletId: story.outletId,
    journalistId: journalist.id,
    sourceEntityId: story.sourceEntityId,
    managerPersonId: input.managerPersonId,
    interviewDate: input.date,
    context: input.context,
    importance: story.importance,
    questions: questionsFor(story),
    responses: [],
    summary: `Interview opened from ${story.headline}`,
    managerReputationEffect: 0,
    clubSupportEffect: 0,
    status: "OPEN",
    provenanceStatus: status,
  };
  new MediaPhaseBRepository(db).upsertInterview(interview);
  return interview;
};

export type MediaResponseStance = "CALM" | "AMBITIOUS" | "PROTECTIVE" | "CONCILIATORY";
export const answerMediaInterview = (
  db: GameDatabase,
  input: { interviewId: EntityId; stance: MediaResponseStance; response: string },
): MediaInterview => {
  const repo = new MediaPhaseBRepository(db);
  const interview = repo.interviews().find((item) => item.id === input.interviewId);
  if (!interview || interview.status !== "OPEN") throw new Error("Media interview is unavailable");
  const journalist = repo.journalists().find((item) => item.id === interview.journalistId);
  const previous = repo
    .relationships(interview.journalistId)
    .find((item) => item.managerPersonId === interview.managerPersonId);
  const temperamentAdjustment =
    journalist?.temperament === "FRIENDLY" && input.stance !== "PROTECTIVE"
      ? 0.06
      : journalist?.temperament === "SCEPTICAL" && input.stance === "AMBITIOUS"
        ? -0.04
        : 0.02;
  const trust = Math.max(0, Math.min(1, (previous?.trust ?? 0.5) + temperamentAdjustment));
  const next: MediaInterview = {
    ...interview,
    responses: [input.response],
    summary: `${interview.summary}; manager responded ${input.stance.toLowerCase()}.`,
    managerReputationEffect:
      input.stance === "AMBITIOUS" ? 0.04 : input.stance === "CONCILIATORY" ? 0.02 : 0,
    clubSupportEffect:
      input.stance === "PROTECTIVE" ? 0.03 : input.stance === "AMBITIOUS" ? 0.01 : 0,
    status: "COMPLETED",
  };
  repo.upsertInterview(next);
  const relationship: MediaJournalistRelationship = {
    id:
      previous?.id ??
      createStableEntityId(
        "media-journalist-relationship",
        `${interview.journalistId}:${interview.managerPersonId ?? "general"}`,
      ),
    journalistId: interview.journalistId,
    managerPersonId: interview.managerPersonId,
    trust,
    lastInteraction: interview.interviewDate,
    status,
  };
  repo.upsertRelationship(relationship);
  return next;
};

export const answerMediaInterviewAsAi = (
  db: GameDatabase,
  input: { interviewId: EntityId; seed: string },
): MediaInterview => {
  const interview = new MediaPhaseBRepository(db)
    .interviews()
    .find((item) => item.id === input.interviewId);
  if (!interview) throw new Error("Media interview not found");
  const stance: MediaResponseStance =
    interview.context === "POST_MATCH"
      ? "CALM"
      : interview.importance >= 8
        ? "PROTECTIVE"
        : "CONCILIATORY";
  return answerMediaInterview(db, {
    interviewId: input.interviewId,
    stance,
    response: `We will focus on the next football task and the facts available to us (${input.seed.slice(0, 8)}).`,
  });
};
