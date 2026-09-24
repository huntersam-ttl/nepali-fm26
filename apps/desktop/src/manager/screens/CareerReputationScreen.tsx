import React from "react";
import type { ManagerCareerHistoryView, ManagerDashboard, SupporterReadModel } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { humanizeToken } from "../storyHumanizer.js";
import { AsyncPanel, Badge, Metrics, Panel, useRuntimeData } from "../ui.js";
import { unrestLabel } from "./ClubSupportersScreen.js";

/**
 * Phase 8B — Career Reputation (Manager, read-only).
 *
 * Three DISTINCT concepts, each read from its own canonical source and shown at
 * its real scope. They are deliberately never combined into one score and no
 * concept is relabelled as another. Media reputation, federation standing and
 * the multi-dimension career reputation are hidden simulation state and are not
 * surfaced here.
 */

export const professionalStanding = (view: ManagerCareerHistoryView): string =>
  view.reputationProfile ? humanizeToken(view.reputationProfile) : "Not yet profiled";

export const boardConfidenceMetrics = (
  dashboard: Pick<ManagerDashboard, "boardConfidence" | "boardExpectation">,
): Array<{ label: string; value: string }> => [
  {
    label: "Board confidence",
    value: dashboard.boardConfidence === undefined ? "—" : `${Math.round(dashboard.boardConfidence)} / 100`,
  },
  {
    label: "Board expects",
    value: dashboard.boardExpectation ? humanizeToken(dashboard.boardExpectation) : "—",
  },
];

export const CareerReputationScreen = (): React.ReactElement => {
  const [history] = useRuntimeData(() => managerBridge.getCareerHistory(), []);
  const [dashboard] = useRuntimeData(() => managerBridge.getManagerDashboard(), []);
  const [supporters] = useRuntimeData(() => managerBridge.getSupporterOverview(), []);

  return (
    <>
      <Panel title="Professional standing" className="panel-wide">
        <AsyncPanel state={history} isEmpty={(v) => !v} empty="No career profile is on record yet.">
          {(view: ManagerCareerHistoryView) => (
            <>
              <p>
                <strong>{professionalStanding(view)}</strong> <Badge tone="info">career profile</Badge>
              </p>
              <p className="subtle">
                How your career is currently classed across football. This is a profile label, not a score.
              </p>
            </>
          )}
        </AsyncPanel>
      </Panel>

      <Panel title="Board confidence" className="panel-wide">
        <AsyncPanel state={dashboard} isEmpty={(v) => !v} empty="No board assessment is available.">
          {(view: ManagerDashboard) => (
            <>
              <Metrics items={boardConfidenceMetrics(view)} />
              <p className="subtle">
                The board of your current club judging your work. It applies to this club only.
              </p>
            </>
          )}
        </AsyncPanel>
      </Panel>

      <Panel title="Supporter approval" className="panel-wide">
        <AsyncPanel state={supporters} isEmpty={(v) => !v} empty="No supporter data is available for this club.">
          {(raw) => {
            const view = raw as SupporterReadModel | undefined;
            if (!view) return <p className="empty-state">No supporter data is available for this club.</p>;
            return (
              <>
                <Metrics
                  items={[
                    { label: "Manager approval", value: `${Math.round(view.managerApproval)} / 100` },
                    { label: "Supporter mood", value: unrestLabel(view.unrest) },
                  ]}
                />
                <p className="subtle">
                  How supporters of your current club regard you. This is separate from board confidence.
                </p>
              </>
            );
          }}
        </AsyncPanel>
      </Panel>

      <Panel title="How to read this" className="panel-wide">
        <p className="subtle">
          Each measure has its own scope and source. They are shown separately and are not combined into a single
          career score.
        </p>
      </Panel>
    </>
  );
};
