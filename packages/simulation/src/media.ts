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
  EventRoutingRepository,
  ManagerRepository,
  MediaPhaseBRepository,
  MediaRepository,
  SupporterCultureRepository,
  type GameDatabase,
  type PublicEventRole,
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

const numericImportance = (event: HistoricalEvent): number =>
  event.importance === "historic" ? 10 : importance(event);

const idsOfType = (event: HistoricalEvent, type: "club" | "federation"): EntityId[] =>
  event.involvedEntities.filter((entity) => entity.type === type).map((entity) => entity.id);

const eventDataId = (event: HistoricalEvent, key: string): EntityId | undefined => {
  const value = event.data?.[key];
  return typeof value === "string" ? (value as EntityId) : undefined;
};

const federationEvent = (event: HistoricalEvent): boolean =>
  event.scope === "federation" ||
  event.scope === "country" ||
  /(ELECTION|FEDERATION|GOVERNANCE|POLICY|PROJECT|FUNDING|NATIONAL_TEAM|REFEREE|WOMEN|GIRLS|YOUTH|LEAGUE_REFORM)/i.test(
    event.eventType,
  );

const ownerEvent = (event: HistoricalEvent): boolean =>
  numericImportance(event) >= 5 &&
  /(OWNERSHIP|INVESTOR|TAKEOVER|CAPITAL|SPONSOR|COMMERCIAL|FACILITY|STADIUM|DEBT|DEFAULT|MANAGER_APPOINT|MANAGER_DISMISS|STAFF_APPOINT|TRANSFER|PROMOTION|RELEGATION|TROPHY|CHAMPION|PROTEST)/i.test(
    event.eventType,
  );

const managerEvent = (event: HistoricalEvent): boolean =>
  numericImportance(event) >= 5 &&
  /(PROMISE|TRANSFER|LOAN|INJURY|MANAGER|MATCH|PROMOTION|RELEGATION|TROPHY|CHAMPION|PROTEST)/i.test(
    event.eventType,
  );

const activeManagersForClub = (db: GameDatabase, clubId: EntityId): EntityId[] =>
  (
    db
      .prepare(
        `SELECT mc.person_id AS personId FROM manager_contracts mc
       WHERE mc.club_id=? AND mc.status='ACTIVE' ORDER BY mc.person_id`,
      )
      .all(clubId) as Array<{ personId: EntityId }>
  ).map((row) => row.personId);

const activeOwnersForClub = (db: GameDatabase, clubId: EntityId): EntityId[] =>
  (
    db
      .prepare(
        `SELECT holder_id AS personId FROM club_ownership_stakes
       WHERE club_id=? AND status='ACTIVE' AND holder_type='PERSON'
         AND holder_id IS NOT NULL AND COALESCE(voting_percentage, percentage, 0) >= 51
       ORDER BY holder_id`,
      )
      .all(clubId) as Array<{ personId: EntityId }>
  ).map((row) => row.personId);

const activePresidentsForFederation = (db: GameDatabase, federationId: EntityId): EntityId[] =>
  (
    db
      .prepare(
        `SELECT person_id AS personId FROM federation_leadership_tenures
       WHERE federation_id=? AND role='FEDERATION_PRESIDENT' AND status IN ('ACTIVE','INTERIM')
       ORDER BY person_id`,
      )
      .all(federationId) as Array<{ personId: EntityId }>
  ).map((row) => row.personId);

/** Central routing policy for all persisted public gameplay events. */
const routeHistoricalEvent = (db: GameDatabase, event: HistoricalEvent): void => {
  const routing = new EventRoutingRepository(db);
  const clubIds = [
    ...new Set(
      [...idsOfType(event, "club"), eventDataId(event, "clubId")].filter(Boolean) as EntityId[],
    ),
  ];
  const federationIds = [
    ...new Set(
      [...idsOfType(event, "federation"), eventDataId(event, "federationId")].filter(
        Boolean,
      ) as EntityId[],
    ),
  ];
  if (federationEvent(event)) {
    for (const federationId of federationIds) {
      for (const personId of activePresidentsForFederation(db, federationId)) {
        routing.insert({
          id: createStableEntityId("event-delivery", `${event.id}:PRESIDENT:${personId}`),
          eventId: event.id,
          role: "PRESIDENT",
          personId,
          federationId,
          createdOn: event.occurredOn,
        });
      }
    }
  }
  for (const clubId of clubIds) {
    if (managerEvent(event)) {
      for (const personId of activeManagersForClub(db, clubId)) {
        routing.insert({
          id: createStableEntityId("event-delivery", `${event.id}:MANAGER:${personId}`),
          eventId: event.id,
          role: "MANAGER",
          personId,
          clubId,
          createdOn: event.occurredOn,
        });
      }
    }
    if (ownerEvent(event)) {
      for (const personId of activeOwnersForClub(db, clubId)) {
        routing.insert({
          id: createStableEntityId("event-delivery", `${event.id}:OWNER:${personId}`),
          eventId: event.id,
          role: "OWNER",
          personId,
          clubId,
          createdOn: event.occurredOn,
        });
      }
    }
  }
};

export type RoleInboxEvent = {
  delivery: import("@nepal-football-sim/database").EventInboxDelivery;
  event: HistoricalEvent;
  category: string;
  source: "SIMULATION_ONLY";
};

export const roleInboxEvents = (
  db: GameDatabase,
  personId: EntityId,
  role: PublicEventRole,
): RoleInboxEvent[] => {
  const events = new Map(
    new EventRepository(db).historicalEvents().map((event) => [event.id, event]),
  );
  return new EventRoutingRepository(db).deliveries(personId, role).flatMap((delivery) => {
    const event = events.get(delivery.eventId);
    return event ? [{ delivery, event, category: event.eventType, source: status }] : [];
  });
};

const inboxTypeForEvent = (event: HistoricalEvent): InboxItem["type"] => {
  const normalized = event.eventType.toUpperCase();
  if (normalized.includes("INJUR")) return "INJURY";
  if (normalized.includes("MATCH")) return "MATCH_RESULT";
  if (normalized.includes("FIXTURE")) return "FIXTURE_UPCOMING";
  return "COMPETITION_UPDATE";
};

/** Role-facing inbox items, retaining legacy records with no public event. */
export const roleInboxItems = (
  db: GameDatabase,
  input: { personId: EntityId; role: PublicEventRole; legacyItems?: InboxItem[] },
): InboxItem[] => {
  const deliveries = roleInboxEvents(db, input.personId, input.role);
  const eventIds = new Set(deliveries.map((item) => item.event.id));
  const stories = new MediaRepository(db).stories();
  const legacyReadByEvent = new Map<EntityId, boolean>();
  for (const item of input.legacyItems ?? new ManagerRepository(db).inboxItems()) {
    const story = stories.find((candidate) =>
      item.id === createStableEntityId("media-inbox", candidate.id),
    );
    if (story && eventIds.has(story.sourceEntityId)) {
      legacyReadByEvent.set(story.sourceEntityId, item.read);
    }
  }
  const legacy = (input.legacyItems ?? new ManagerRepository(db).inboxItems()).filter((item) => {
    const story = stories.find((candidate) =>
      item.id === createStableEntityId("media-inbox", candidate.id),
    );
    return !story || !eventIds.has(story.sourceEntityId);
  });
  const routed = deliveries.map(({ event }) => ({
    id: createStableEntityId("role-inbox", `${input.role}:${input.personId}:${event.id}`),
    createdOn: event.occurredOn,
    type: inboxTypeForEvent(event),
    title: event.title,
    body: event.title,
    relatedEntity: event.involvedEntities[0],
    read: legacyReadByEvent.get(event.id) ?? false,
  } satisfies InboxItem));
  return [...legacy, ...routed].sort(
    (a, b) => b.createdOn.localeCompare(a.createdOn) || b.id.localeCompare(a.id),
  );
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
  const events = new EventRepository(db)
    .historicalEvents()
    .filter((item) => item.occurredOn <= input.date);
  for (const event of events) routeHistoricalEvent(db, event);
  for (const event of events.filter(
    (item) => importance(item) >= threshold && !repo.hasStory(item.id),
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
