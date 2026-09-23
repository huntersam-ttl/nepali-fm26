import React, { useState } from "react";
import type { EntityId, EntityReferenceType, MediaFeedItem, MediaSection, StoryThread } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Panel, useRuntimeData } from "../ui.js";
import { EntityRefLink } from "../RoleDetailScreen.js";

/**
 * Phase 7A — Newsroom (world-media browsing).
 *
 * The deeper news surface, distinct from the compact Daily Ops News workspace
 * and the press-conference Media workspace. Reads the canonical categorized
 * `getMediaCentre().feed`; stories carry their real source/date/section/
 * importance and only canonical referenced entities are clickable. No
 * fabricated quotes, sources, controversy tags, or engagement scores.
 */

export const MEDIA_SECTIONS: MediaSection[] = [
  "TOP_STORIES",
  "CLUB_NEWS",
  "TRANSFERS",
  "NATIONAL_TEAM",
  "FEDERATION",
  "AROUND_NEPAL",
  "INTERNATIONAL_CONTEXT",
];

export const humanizeSection = (section: MediaSection | string): string =>
  section.replaceAll("_", " ").toLowerCase();

/** Filters the canonical feed by section, preserving the newest-first order. */
export const filterFeed = (feed: MediaFeedItem[], section?: MediaSection): MediaFeedItem[] =>
  section ? feed.filter((item) => item.section === section) : feed;

/** The lead/current story is the first (most recent) item of the filtered feed. */
export const leadStory = (feed: MediaFeedItem[]): MediaFeedItem | undefined => feed[0];

/** Threads that are still open (not collapsed), newest first (latest event). */
export const ongoingThreads = (threads: StoryThread[]): StoryThread[] =>
  threads
    .filter((thread) => thread.statusLabel !== "Collapsed")
    .sort((a, b) => (b.latestEvent.occurredOn < a.latestEvent.occurredOn ? 1 : b.latestEvent.occurredOn > a.latestEvent.occurredOn ? -1 : 0));

const threadTone = (statusLabel: string): "ok" | "warn" | "bad" | "info" =>
  statusLabel === "Resolved" ? "ok" : statusLabel === "Active" ? "warn" : statusLabel === "Collapsed" ? "bad" : "info";

const importanceTone = (band: string): "ok" | "warn" | "bad" | "info" =>
  band === "BREAKING" ? "bad" : band === "MAJOR" ? "warn" : "info";

const reactionTone = (label: string): "ok" | "warn" | "bad" | "info" =>
  label === "POSITIVE" ? "ok" : label === "MIXED" ? "info" : label === "CRITICAL" ? "warn" : "bad";

export const NewsroomScreen = ({
  onOpenEntity,
}: {
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void;
}): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getMediaCentre(), []);
  const [threadsState] = useRuntimeData(() => managerBridge.getStoryThreads(), []);
  const [section, setSection] = useState<MediaSection | undefined>(undefined);

  return (
    <AsyncPanel state={state}>
      {(centre) => {
        const feed = filterFeed(centre.feed, section);
        const lead = leadStory(feed);
        const stream = feed.slice(1);
        return (
          <>
            <div className="newsroom-toolbar">
              <label>
                Section
                <select
                  value={section ?? "ALL"}
                  onChange={(event) =>
                    setSection(event.target.value === "ALL" ? undefined : (event.target.value as MediaSection))
                  }
                >
                  <option value="ALL">All sections</option>
                  {MEDIA_SECTIONS.map((item) => (
                    <option key={item} value={item}>
                      {humanizeSection(item)}
                    </option>
                  ))}
                </select>
              </label>
              <Badge tone="info">simulated world media</Badge>
            </div>

            {feed.length === 0 ? (
              <Panel title="Newsroom" className="panel-wide">
                <p className="empty-state">No published stories match this view right now.</p>
              </Panel>
            ) : (
              <>
                <Panel title="Lead story" className="panel-wide">
                  {StoryCard(lead!, onOpenEntity)}
                </Panel>
                <Panel title="Story stream" className="panel-wide">
                  {stream.length === 0 ? (
                    <p className="empty-state">No further stories in this section.</p>
                  ) : (
                    <ul className="report-list">
                      {stream.map((item) => <li key={item.story.id}>{StoryCard(item, onOpenEntity)}</li>)}
                    </ul>
                  )}
                </Panel>
                <AsyncPanel state={threadsState}>
                  {(threads) => {
                    const open = ongoingThreads(threads);
                    return (
                      <Panel title="Story threads" className="panel-wide">
                        {open.length === 0 ? (
                          <p className="empty-state">No ongoing story threads are being tracked.</p>
                        ) : (
                          <ul className="report-list">
                            {open.map((thread) => (
                              <li key={`${thread.category}-${thread.primaryEntity.id}`}>
                                <Badge tone={threadTone(thread.statusLabel)}>{thread.statusLabel.toLowerCase()}</Badge>{" "}
                                <Badge tone="info">{thread.category.toLowerCase()}</Badge>{" "}
                                <strong>{thread.latestEvent.title}</strong>
                                <span className="subtle">{" "}· {thread.events.length} report{thread.events.length === 1 ? "" : "s"} · {thread.latestEvent.occurredOn}</span>
                                {thread.involvedEntities.length > 0 && (
                                  <span className="subtle">
                                    {" "}·{" "}
                                    {thread.involvedEntities
                                      .filter((ref) => ref.visible)
                                      .map((ref, index) => (
                                        <span key={`${ref.id}-${index}`}>
                                          {index > 0 ? " · " : null}
                                          <EntityRefLink reference={ref} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
                                        </span>
                                      ))}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </Panel>
                    );
                  }}
                </AsyncPanel>
              </>
            )}
          </>
        );
      }}
    </AsyncPanel>
  );
};

const StoryCard = (
  item: MediaFeedItem,
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void,
): React.ReactElement => (
  <article className="story-card" aria-label={item.story.headline}>
    <h3>{item.story.headline}</h3>
    <p className="subtle">{item.standfirst}</p>
    <div className="button-row">
      <Badge tone={importanceTone(item.importanceBand)}>{item.importanceBand.toLowerCase()}</Badge>
      <Badge tone="info">{humanizeSection(item.section)}</Badge>
      <span className="subtle">
        {item.outletName} · {item.story.publishedOn}
      </span>
    </div>
    {item.reaction && item.reaction.label && (
      <p className="subtle">
        <Badge tone={reactionTone(item.reaction.label)}>{item.reaction.label.toLowerCase()}</Badge>{" "}
        {item.reaction.summary} <Badge tone="info">simulated reaction</Badge>
      </p>
    )}
    {item.entities.length > 0 && (
      <p className="subtle">
        Related:{" "}
        {item.entities
          .filter((ref) => ref.visible)
          .map((ref, index) => (
            <span key={`${ref.id}-${index}`}>
              {index > 0 ? " · " : null}
              <EntityRefLink reference={ref} onOpen={(r) => onOpenEntity(r.entityType, r.id)} />
            </span>
          ))}
      </p>
    )}
    {item.threadStatus && <p className="subtle">Thread: {item.threadStatus.toLowerCase()}</p>}
  </article>
);