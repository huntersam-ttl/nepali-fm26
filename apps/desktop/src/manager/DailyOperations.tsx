import React, { useState } from "react";
import type { CalendarEntry, EntityReference, InboxItem } from "@nepal-football-sim/shared-types";
import type { ManagerWorkspace } from "../navigation.js";
import { managerBridge } from "./managerBridge.js";
import { useRuntimeData, type Async } from "./ui.js";
import { StatusChip } from "./StatusChip.js";
import { calendarByDate, orderNews } from "./dailyOps.js";

/**
 * Phase 2C — Daily Operations (integrated into Home).
 *
 * A coherent operational strip of the real views the player lives in:
 *  - CALENDAR: a spatial date grid (real events only), current world date
 *    highlighted, selecting a day opens its events (navigable where links exist).
 *  - NEWS: a lead story + bounded recent list from canonical story threads,
 *    with entity links through Phase 1 onOpenEntity.
 * Inbox is surfaced by Home's Attention (action surface). Nothing is invented.
 */

export const DailyOperations = ({
  today,
  messages,
  calendar,
  onOpenEntity,
  onNavigate,
}: {
  today: string;
  messages: InboxItem[];
  calendar: Async<CalendarEntry[]>;
  onOpenEntity: (reference: EntityReference) => void;
  onNavigate: (next: ManagerWorkspace) => void;
}): React.ReactElement => {
  const [threads] = useRuntimeData(() => managerBridge.getStoryThreads(), []);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const days = calendar.status === "ready" ? calendarByDate(calendar.data) : [];
  const selectedDay = days.find((day) => day.date === selectedDate) ?? null;
  const news = threads.status === "ready" ? orderNews(threads.data, 4) : { lead: undefined, recent: [] };

  return (
    <section className="daily-operations" aria-label="Daily operations">
      <h3 className="section-title">Operations</h3>
      <div className="button-row">
        <button className="ghost small" onClick={() => onNavigate("messages")}>Open messages</button>
        <button className="ghost small" onClick={() => onNavigate("news")}>Open news</button>
        <button className="ghost small" onClick={() => onNavigate("calendar")}>Open calendar</button>
      </div>
      <div className="u-split">
        <div className="surface-primary">
          <h4 className="data-label">Calendar · {today}</h4>
          {days.length === 0 ? (
            <p className="state-empty">No events are currently scheduled.</p>
          ) : (
            <>
              <div className="calendar-grid">
                {days.map((day) => (
                  <button
                    key={day.date}
                    type="button"
                    className={`calendar-cell${day.date === today ? " today" : ""}${day.date === selectedDate ? " selected" : ""}`}
                    aria-pressed={day.date === selectedDate}
                    onClick={() => setSelectedDate(day.date === selectedDate ? null : day.date)}
                  >
                    <span className="calendar-cell-date">{day.date}</span>
                    <span className="calendar-cell-count">{day.entries.length}</span>
                  </button>
                ))}
              </div>
              <div className="calendar-detail" aria-live="polite">
                {selectedDay ? (
                  <ul className="report-list">
                    {selectedDay.entries.map((entry, index) => (
                      <li key={`${entry.date}-${index}`}>
                        <StatusChip label={entry.type.replaceAll("_", " ").toLowerCase()} status={entry.type} />
                        <span> {entry.title}</span>
                        {entry.detail && <span className="page-metadata"> · {entry.detail}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="quiet-region">Select a day to see its events.</p>
                )}
              </div>
            </>
          )}
          <div className="button-row">
            <button className="ghost small" onClick={() => onNavigate("fixtures")}>Open fixtures</button>
            <button className="ghost small" onClick={() => onNavigate("competition")}>Competition</button>
          </div>
        </div>
<div className="u-stack">
          <div className="surface-primary">
            <h4 className="data-label">News</h4>
            {news.lead ? (
              <article className="news-lead">
                <h4 className="home-news-title">{news.lead.currentState}</h4>
                <StoryLinks
                  references={[...news.lead.involvedEntities, news.lead.primaryEntity].filter(Boolean)}
                  onOpenEntity={onOpenEntity}
                />
              </article>
            ) : (
              <p className="state-empty">No current stories.</p>
            )}
            {news.recent.length > 0 && (
              <ul className="report-list news-list">
                {news.recent.map((thread) => (
                  <li key={thread.id}>
                    <StatusChip label={thread.category.toLowerCase()} status={thread.resolved ? "COMPLETED" : "ACTIVE"} />
                    <span> {thread.currentState}</span>
                    <StoryLinks references={[thread.primaryEntity].filter(Boolean)} onOpenEntity={onOpenEntity} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="surface-secondary">
            <h4 className="data-label">Messages · {messages.length}</h4>
            {messages.length === 0 ? (
              <p className="state-noresults">No messages.</p>
            ) : (
              <p className="quiet-region">Open decisions appear in Attention above.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

const StoryLinks = ({
  references,
  onOpenEntity,
}: {
  references: EntityReference[];
  onOpenEntity: (reference: EntityReference) => void;
}): React.ReactElement | null => {
  const unique = Array.from(
    new Map(references.map((reference) => [`${reference.entityType}:${reference.id}`, reference])).values(),
  );
  if (unique.length === 0) return null;
  return (
    <div className="button-row">
      {unique.slice(0, 3).map((reference) => (
        <button key={`${reference.entityType}:${reference.id}`} type="button" className="link" onClick={() => onOpenEntity(reference)}>
          {reference.label}
        </button>
      ))}
    </div>
  );
};