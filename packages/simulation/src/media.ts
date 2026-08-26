import { createStableEntityId, type EntityId, type HistoricalEvent, type InboxItem, type MediaOutlet, type MediaStory } from "@nepal-football-sim/shared-types";
import { EventRepository, ManagerRepository, MediaRepository, type GameDatabase } from "@nepal-football-sim/database";

const status = "SIMULATION_ONLY" as const;
const outlets: Array<Omit<MediaOutlet, "id">> = [
  { name: "Kathmandu Football Desk", scope: "LOCAL", reputation: 5.8, reach: 3.5, bias: "CLUB_FOCUSED", style: "ANALYSIS", status },
  { name: "Nepal Football News", scope: "NATIONAL", reputation: 6.8, reach: 6.5, bias: "NATIONAL_FOCUS", style: "WIRE", status },
  { name: "South Asia Football Review", scope: "REGIONAL_INTERNATIONAL", reputation: 8.1, reach: 7.4, bias: "NEUTRAL", style: "TRADE", status },
];

export const initializeMediaForSave = (db: GameDatabase): MediaOutlet[] => { const repo = new MediaRepository(db); for (const outlet of outlets) repo.upsertOutlet({ ...outlet, id: createStableEntityId("media-outlet", outlet.name) }); return repo.outlets(); };

const importance = (event: HistoricalEvent): number => event.importance === "high" ? 8 : event.importance === "medium" ? 5 : 2;
const outletFor = (repo: MediaRepository, score: number): MediaOutlet => repo.outlets().sort((a, b) => b.reach - a.reach || a.id.localeCompare(b.id)).find((outlet) => score >= 7 ? outlet.scope !== "LOCAL" : outlet.scope === "LOCAL" || outlet.scope === "NATIONAL") ?? repo.outlets()[0];

const eventStory = (event: HistoricalEvent, outlet: MediaOutlet): MediaStory => {
  const score = importance(event); const normalized = event.eventType.toUpperCase(); const type: MediaStory["eventType"] = normalized.includes("TRANSFER") ? "TRANSFER" : normalized.includes("STAFF") || normalized.includes("MANAGER") ? "STAFF_CHANGE" : normalized.includes("INJUR") ? "INJURY" : normalized.includes("NATIONAL") || normalized.includes("INTERNATIONAL") ? "NATIONAL_TEAM" : normalized.includes("COMPETITION") || normalized.includes("MATCH") ? "MATCH_RESULT" : "MILESTONE";
  const headline = score >= 7 ? event.title : `${event.title} noted by ${outlet.name}`;
  return { id: createStableEntityId("media-story", `${event.id}:${outlet.id}`), outletId: outlet.id, eventType: type, sourceEntityId: event.id, publishedOn: event.occurredOn, importance: score, headline, summary: event.data ? `${event.title}. Recorded event data is available.` : event.title, subjectIds: event.involvedEntities.map((item) => item.id), reputationEffect: score >= 7 ? 0.05 : 0, status: "PUBLISHED", provenanceStatus: status };
};

export const publishMediaForDate = (db: GameDatabase, input: { date: string; minimumImportance?: number }): MediaStory[] => {
  const repo = new MediaRepository(db); initializeMediaForSave(db); const threshold = input.minimumImportance ?? 4; const published: MediaStory[] = [];
  for (const event of new EventRepository(db).historicalEvents().filter((item) => item.occurredOn <= input.date && importance(item) >= threshold && !repo.hasStory(item.id))) {
    const outlet = outletFor(repo, importance(event)); const story = eventStory(event, outlet); repo.upsertStory(story); published.push(story);
    if (story.importance >= 6) { const inbox: InboxItem = { id: createStableEntityId("media-inbox", story.id), createdOn: story.publishedOn, type: "COMPETITION_UPDATE", title: story.headline, body: story.summary, read: false }; new ManagerRepository(db).insertInboxItem(inbox); }
  }
  return published;
};

export const getMediaArchive = (db: GameDatabase, publishedOn?: string): MediaStory[] => new MediaRepository(db).stories(publishedOn);
