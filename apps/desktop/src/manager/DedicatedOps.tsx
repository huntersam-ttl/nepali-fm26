import React, { useState } from "react";
import type { EntityId, EntityReference } from "@nepal-football-sim/shared-types";
import type { ManagerWorkspace } from "../navigation.js";
import { managerBridge } from "./managerBridge.js";
import { useRuntimeData, AsyncPanel } from "./ui.js";
import { StatusChip } from "./StatusChip.js";
import { calendarByDate, inboxClassification, orderNews } from "./dailyOps.js";

/**
 * Phase 2D — dedicated Daily Operations workspaces (Messages / News / Calendar).
 * Reuses Phase 2C helpers + existing read models. Selecting a message or day is
 * local state (no navigation) unless a real entity/workspace is opened.
 */

const kindStatus: Record<ReturnType<typeof inboxClassification>, string | undefined> = {
  info: undefined,
  actionable: "ACTIVE",
  warning: "INJURED",
  resolved: "COMPLETED",
};

export const EntityLinks = ({
  references,
  onOpenEntity,
}: {
  references: EntityReference[];
  onOpenEntity: (reference: EntityReference) => void;
}): React.ReactElement | null => {
  const unique = Array.from(new Map(references.map((r) => [`${r.entityType}:${r.id}`, r])).values());
  if (unique.length === 0) return null;
  return (
    <div className="button-row">
      {unique.slice(0, 4).map((reference) => (
        <button key={`${reference.entityType}:${reference.id}`} type="button" className="link" onClick={() => onOpenEntity(reference)}>
          {reference.label}
        </button>
      ))}
    </div>
  );
};

export const MessagesScreen = ({ onOpenEntity }: { onOpenEntity: (reference: EntityReference) => void }): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getManagerDashboard(), []);
  const [selectedId, setSelectedId] = useState<EntityId | null>(null);
  return (
    <AsyncPanel state={state}>
      {(dashboard) => {
        const inbox = dashboard.inbox;
        if (inbox.length === 0) {
          return <div className="surface-primary"><p className="state-noresults">Your inbox is empty.</p></div>;
        }
        const selected = inbox.find((item) => item.id === selectedId) ?? inbox[0];
        const kind = inboxClassification(selected);
        return (
          <section className="messages-layout" aria-label="Messages">
            <div className="surface-primary messages-list" role="listbox" aria-label="Messages">
              {inbox.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`messages-row${item.id === selected.id ? " active" : ""}`}
                  role="option"
                  aria-selected={item.id === selected.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="messages-row-title">{item.title}</span>
                  <span className="page-metadata">{item.body}</span>
                </button>
              ))}
            </div>
            <div className="surface-primary messages-detail" aria-live="polite">
              <div className="button-row">
                <h2 className="section-title">{selected.title}</h2>
                <StatusChip label={kind} status={kindStatus[kind]} />
              </div>
              <p>{selected.body}</p>
              {selected.entityReferences && <EntityLinks references={selected.entityReferences} onOpenEntity={onOpenEntity} />}
            </div>
          </section>
        );
      }}
    </AsyncPanel>
  );
};

export const NewsScreen = ({ onOpenEntity }: { onOpenEntity: (reference: EntityReference) => void }): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getStoryThreads(), []);
  return (
    <AsyncPanel state={state}>
      {(threads) => {
        const news = orderNews(threads, 5);
        return (
          <section className="news-workspace" aria-label="News">
            {news.lead ? (
              <article className="surface-hero news-lead">
                <span className="page-eyebrow">Lead story</span>
                <h2 className="section-title">{news.lead.currentState}</h2>
                <EntityLinks
                  references={[...news.lead.involvedEntities, news.lead.primaryEntity].filter(Boolean)}
                  onOpenEntity={onOpenEntity}
                />
              </article>
            ) : (
              <div className="surface-secondary"><p className="state-empty">No current stories.</p></div>
            )}
            {news.recent.length > 0 && (
              <ul className="report-list news-list">
                {news.recent.map((thread) => (
                  <li key={thread.id}>
                    <StatusChip label={thread.category.toLowerCase()} status={thread.resolved ? "COMPLETED" : "ACTIVE"} />
                    <span> {thread.currentState}</span>
                    <EntityLinks references={[thread.primaryEntity].filter(Boolean)} onOpenEntity={onOpenEntity} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      }}
    </AsyncPanel>
  );
};

export const CalendarScreen = ({ today, onNavigate }: { today: string; onNavigate: (next: ManagerWorkspace) => void }): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getCalendar(), []);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  return (
    <AsyncPanel state={state}>
      {(entries) => {
        const days = calendarByDate(entries);
        const selectedDay = days.find((day) => day.date === selectedDate) ?? null;
        return (
          <section className="calendar-workspace" aria-label="Calendar">
            <div className="surface-primary">
              <h2 className="section-title">Calendar · {today}</h2>
              {days.length === 0 ? (
                <p className="state-empty">No events are currently scheduled.</p>
              ) : (
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
              )}
              <div className="button-row">
                <button className="ghost small" onClick={() => onNavigate("fixtures")}>Open fixtures</button>
                <button className="ghost small" onClick={() => onNavigate("competition")}>Competition</button>
              </div>
            </div>
            <div className="surface-secondary calendar-detail" aria-live="polite">
              <h2 className="section-title">Selected day</h2>
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
          </section>
        );
      }}
    </AsyncPanel>
  );
};