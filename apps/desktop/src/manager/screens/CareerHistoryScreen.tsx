import React from "react";
import type { ManagerCareerHistoryView } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Panel, useRuntimeData } from "../ui.js";

/**
 * Phase 8A — Career History (persistent appointments + honours).
 * Read from the canonical career record (getCareerHistory). Current active
 * role is visually distinct from completed history; honours come only from the
 * recorded trophy set.
 */

export const appointments = (view: ManagerCareerHistoryView): ManagerCareerHistoryView["history"] => view.history;

export const honours = (view: ManagerCareerHistoryView): ManagerCareerHistoryView["trophies"] => view.trophies;

export const isCurrent = (entry: ManagerCareerHistoryView["history"][number]): boolean =>
  entry.outcome === "ACTIVE";

const humanizeOutcome = (outcome: string): string => outcome.replaceAll("_", " ").toLowerCase();

const outcomeTone = (outcome: string): "ok" | "warn" | "bad" | "info" =>
  outcome === "ACTIVE" ? "ok" : "bad";

export const CareerHistoryScreen = (): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getCareerHistory(), []);
  return (
    <AsyncPanel state={state} isEmpty={(v) => !v} empty="No career record available.">
      {(view) => {
        const roles = appointments(view);
        const trophies = honours(view);
        return (
          <>
            <Panel title="Appointments" className="panel-wide">
              {roles.length === 0 ? (
                <p className="empty-state">No prior roles are on record yet.</p>
              ) : (
                <dl className="detail-list">
                  {roles.map((entry) => (
                    <div key={entry.contractId}>
                      <dt>
                        {humanizeOutcome(entry.jobTitle)}
                        {isCurrent(entry) ? <Badge tone="info">current</Badge> : null}
                      </dt>
                      <dd>
                        {entry.clubName ?? "an unknown club"}
                        {entry.teamName ? ` · ${entry.teamName}` : ""}
                        <span className="subtle">
                          {" "}· {entry.start.slice(0, 4)}–{(isCurrent(entry) ? "present" : (entry.end ?? "").slice(0, 4))}
                          {" "}· <Badge tone={outcomeTone(entry.outcome)}>{humanizeOutcome(entry.outcome)}</Badge>
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </Panel>

            <Panel title="Honours" className="panel-wide">
              {trophies.length === 0 ? (
                <p className="empty-state">No honours are on record yet.</p>
              ) : (
                <ul className="report-list">
                  {trophies.map((trophy, index) => (
                    <li key={`${trophy.wonOn}-${index}`}>
                      <strong>{trophy.competitionName}</strong>{" "}
                      <span className="subtle">{`${trophy.wonOn.slice(0, 4)} · ${trophy.teamName}`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        );
      }}
    </AsyncPanel>
  );
};