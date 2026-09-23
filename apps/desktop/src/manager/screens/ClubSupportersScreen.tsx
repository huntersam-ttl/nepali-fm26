import React from "react";
import type { SupporterReadModel, SupporterReactionState, SupporterUnrestState } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Metrics, Panel, useRuntimeData } from "../ui.js";

/**
 * Phase 6D — Club Supporters (Manager read-only).
 *
 * Canonical `SupporterReadModel` surfaced truthfully. Everything in this module
 * is SIMULATION_ONLY generated gameplay state — never a claim about a real
 * club's real supporters. Mood/unrest/reactions are shown exactly as stored;
 * no invented "supporter score" or engagement formulas are added.
 */

export const unrestLabel = (state: SupporterUnrestState | undefined): string =>
  state ? state.replaceAll("_", " ").toLowerCase() : "Unknown";

export const reactionLabel = (state: SupporterReactionState | undefined): string =>
  state ? state.toLowerCase() : "No current reaction";

export const humanizeEventType = (type: string): string =>
  type.replaceAll("_", " ").toLowerCase();

const unrestTone = (state: SupporterUnrestState | undefined): "ok" | "warn" | "bad" | "info" =>
  state === "CONTENT" ? "ok" : state === "CONCERNED" ? "info" : state === "FRUSTRATED" ? "warn" : "bad";

/** Compact supporter-base facts, from the canonical read model. */
export const supporterMetrics = (view: SupporterReadModel): Array<{ label: string; value: string }> => {
  const base = view.supporterBase;
  return [
    { label: "Active fanbase", value: base.activeFanbase.toLocaleString("en-US") },
    { label: "Matchgoing base", value: base.matchgoingBase.toLocaleString("en-US") },
    { label: "Season tickets", value: base.seasonTicketBase.toLocaleString("en-US") },
    { label: "Potential reach", value: base.potentialReach.toLocaleString("en-US") },
  ];
};

export const ClubSupportersScreen = (): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getSupporterOverview(), []);

  return (
    <AsyncPanel state={state} isEmpty={(v) => !v} empty="No supporter data is available for this club.">
      {(raw) => {
        const view = raw as SupporterReadModel | undefined;
        if (!view) return <p className="empty-state">No supporter data is available for this club.</p>;
        const metrics = supporterMetrics(view);
        return (
          <>
            <Panel title="Mood" className="panel-wide">
              <Badge tone={unrestTone(view.unrest)}>{unrestLabel(view.unrest)}</Badge>{" "}
              <Badge tone="info">simulated</Badge>
              <p className="subtle">
                Mood {Math.round(view.mood)}/100 · Expectations {Math.round(view.expectations)}/100
              </p>
              <p className="subtle">
                {reactionLabel(view.reaction)} · Manager approval {Math.round(view.managerApproval)}/100 ·{" "}
                Ownership trust {Math.round(view.ownershipTrust)}/100
              </p>
            </Panel>

            <Panel title="Club connection" className="panel-wide">
              {metrics.length > 0 ? (
                <Metrics items={metrics} />
              ) : (
                <p className="empty-state">No supporter-base figures have been modelled.</p>
              )}
              <p className="subtle">
                Commercial engagement index {Math.round(view.commercialEngagementIndex)}/100 ·{" "}
                {view.fanFavourites.length} fan favourite{view.fanFavourites.length === 1 ? "" : "s"} ·{" "}
                {view.topRivalries.length} rivalr{view.topRivalries.length === 1 ? "y" : "ies"}
              </p>
            </Panel>

            <Panel title="What supporters are reacting to" className="panel-wide">
              {view.recentEvents.length === 0 ? (
                <p className="empty-state">No recent supporter reactions have been recorded.</p>
              ) : (
                <ul className="report-list">
                  {view.recentEvents.map((event) => (
                    <li key={event.id}>
                      <Badge tone="info">{humanizeEventType(event.type)}</Badge>{" "}
                      {event.summary} <span className="subtle">{event.date}</span>
                    </li>
                  ))}
                </ul>
              )}
              {(view.activeConcerns ?? []).length > 0 && (
                <p className="subtle">Active concerns: {(view.activeConcerns ?? []).join("; ")}</p>
              )}
              {(view.factions ?? []).length > 0 && (
                <p className="subtle">
                  Supporter factions: {(view.factions ?? []).map((f) => f.replaceAll("_", " ").toLowerCase()).join(", ")}
                </p>
              )}
            </Panel>

            <Panel title="Authority">
              <p className="subtle">
                Supporter state is shown for the football department&rsquo;s awareness. Community investment, ticket
                pricing and engagement decisions are institutional authority held by the owner.
              </p>
            </Panel>
          </>
        );
      }}
    </AsyncPanel>
  );
};