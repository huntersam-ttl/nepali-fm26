import React, { useState } from "react";
import type { EntityId, EntityReferenceType, MediaFeedItem, MediaSection } from "@nepal-football-sim/shared-types";
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

const importanceTone = (band: string): "ok" | "warn" | "bad" | "info" =>
  band === "BREAKING" ? "bad" : band === "MAJOR" ? "warn" : "info";

export const NewsroomScreen = ({
  onOpenEntity,
}: {
  onOpenEntity: (entityType: EntityReferenceType, id: EntityId) => void;
}): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getMediaCentre(), []);
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