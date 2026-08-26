import React, { useState } from "react";
import type { EntityId, MatchViewMode } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import {
  AsyncPanel,
  Badge,
  FormRun,
  Metrics,
  Panel,
  availabilityTone,
  useRuntimeData,
} from "../ui.js";

const VIEW_MODES: Array<{ id: MatchViewMode; label: string; detail: string }> = [
  { id: "QUICK_SIM", label: "Quick Sim", detail: "Simulate the whole match instantly." },
  { id: "KEY_EVENTS", label: "Key Events", detail: "Skip the quiet spells, stop at the moments." },
  { id: "TEXT_LIVE", label: "Text Live", detail: "Follow the match minute by minute." },
];

/**
 * Pre-match. Everything shown here comes from the fixture read model and the
 * team's own knowledge — no hidden opposition detail.
 */
export const PreMatchPanel = ({
  fixtureId,
  busy,
  onKickOff,
  onBack,
}: {
  fixtureId: EntityId;
  busy: boolean;
  onKickOff: (viewMode: MatchViewMode) => void;
  onBack: () => void;
}): React.ReactElement => {
  const [detail] = useRuntimeData(() => managerBridge.getFixture(fixtureId), [fixtureId]);
  const [tactics] = useRuntimeData(() => managerBridge.getTactics(), [fixtureId]);
  const [viewMode, setViewMode] = useState<MatchViewMode>("TEXT_LIVE");

  return (
    <section className="dashboard">
      <AsyncPanel state={detail}>
        {(fixture) => (
          <>
            <Panel
              title="Match preparation"
              actions={
                <button className="ghost" onClick={onBack} disabled={busy}>
                  Back to fixtures
                </button>
              }
            >
              <h2>
                {fixture.fixture.homeAway === "home" ? "vs" : "at"} {fixture.fixture.opponent}
              </h2>
              <Metrics
                items={[
                  { label: "Competition", value: fixture.fixture.competition },
                  { label: "Date", value: fixture.fixture.date },
                  {
                    label: "Venue",
                    value: fixture.fixture.venue ?? <span className="unknown">Unknown</span>,
                  },
                  { label: "Home/Away", value: fixture.fixture.homeAway },
                  { label: "Available", value: fixture.availableCount },
                ]}
              />
              <p>
                Our form <FormRun form={fixture.ownForm} /> · Their form{" "}
                <FormRun form={fixture.opponentForm} />
              </p>
              {fixture.previousMeetings.length > 0 && (
                <p className="subtle">
                  Previous meetings:{" "}
                  {fixture.previousMeetings
                    .map((meeting) => `${meeting.date} ${meeting.score}`)
                    .join(" · ")}
                </p>
              )}
              <p className="subtle">
                Referee and weather are not recorded for this fixture in the current Nepal data.
              </p>
            </Panel>

            <Panel title="Match view">
              <div className="view-mode-choice" role="radiogroup" aria-label="Match view">
                {VIEW_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    role="radio"
                    aria-checked={viewMode === mode.id}
                    className={`club-row ${viewMode === mode.id ? "selected" : ""}`}
                    onClick={() => setViewMode(mode.id)}
                    disabled={busy}
                  >
                    <strong>{mode.label}</strong>
                    <span>{mode.detail}</span>
                  </button>
                ))}
              </div>
              <button
                className="primary kick-off"
                disabled={busy || !fixture.selectionValid}
                onClick={() => onKickOff(viewMode)}
              >
                {busy ? "Starting…" : "Kick Off"}
              </button>
              {!fixture.selectionValid && (
                <p className="subtle">Fix the selection errors on the Tactics screen first.</p>
              )}
            </Panel>

            <Panel title="Selected XI">
              <AsyncPanel state={tactics}>
                {(view) => (
                  <>
                    <Metrics
                      items={[
                        { label: "Formation", value: view.setup.formation.name },
                        { label: "Style", value: view.setup.style.replace(/_/g, " ") },
                        {
                          label: "Mentality",
                          value: view.setup.instructions.mentality.replace(/_/g, " "),
                        },
                        { label: "Bench", value: view.setup.bench.length },
                      ]}
                    />
                    <ol className="xi-list">
                      {fixture.selectedXI.map((slot) => (
                        <li key={slot.slotId}>
                          <strong>{slot.slotId}</strong> {slot.playerName ?? "— empty —"}{" "}
                          <span className="subtle">
                            {slot.roleId.replace(/_/g, " ").toLowerCase()}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <p className="subtle">Bench: {fixture.bench.join(", ") || "none named"}</p>
                  </>
                )}
              </AsyncPanel>
            </Panel>

            {fixture.unavailable.length > 0 && (
              <Panel title="Unavailable">
                <ul>
                  {fixture.unavailable.map((player) => (
                    <li key={player.personId}>
                      {player.name}{" "}
                      <Badge tone={availabilityTone(player.availability)}>
                        {player.availability.replace("_", " ").toLowerCase()}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {fixture.warnings.length > 0 && (
              <Panel title="Warnings">
                {fixture.warnings.map((warning) => (
                  <div key={warning}>
                    <Badge tone="warn">warning</Badge> {warning}
                  </div>
                ))}
              </Panel>
            )}
          </>
        )}
      </AsyncPanel>
    </section>
  );
};
