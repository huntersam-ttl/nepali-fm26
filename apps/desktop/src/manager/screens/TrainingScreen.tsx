import React, { useState } from "react";
import type { TrainingView } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, ErrorBanner, Metrics, Panel, useRuntimeData } from "../ui.js";
import type { AppError } from "../../appBridge.js";

export const TrainingScreen = (): React.ReactElement => {
  const [state, , replace] = useRuntimeData(() => managerBridge.getTraining());
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async (command: Parameters<typeof managerBridge.updateTraining>[0]) => {
    setBusy(true);
    const result = await managerBridge.updateTraining(command);
    setBusy(false);
    if (result.ok) {
      replace(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  };

  return (
    <>
      {error && <ErrorBanner error={error} />}
      <AsyncPanel state={state}>
        {(view) => <TrainingBoard view={view} busy={busy} onApply={apply} />}
      </AsyncPanel>
    </>
  );
};

const TrainingBoard = ({
  view,
  busy,
  onApply,
}: {
  view: TrainingView;
  busy: boolean;
  onApply: (command: Parameters<typeof managerBridge.updateTraining>[0]) => Promise<void>;
}): React.ReactElement => {
  const [name, setName] = useState(view.plan.name);

  const editSession = (index: number, patch: Record<string, string>) =>
    onApply({
      sessions: view.plan.sessions.map((session, position) =>
        position === index
          ? {
              day: session.day,
              slot: session.slot,
              category: session.category,
              intensity: session.intensity,
              targetGroup: session.targetGroup,
              ...patch,
            }
          : {
              day: session.day,
              slot: session.slot,
              category: session.category,
              intensity: session.intensity,
              targetGroup: session.targetGroup,
            },
      ) as never,
    });

  return (
    <section className="dashboard">
      <Panel title="Weekly training plan">
        <div className="controls">
          <label>
            Plan name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => name !== view.plan.name && void onApply({ name })}
            />
          </label>
          <label>
            Overall intensity
            <select
              value={view.plan.intensity}
              disabled={busy}
              onChange={(event) =>
                void onApply({ intensity: event.target.value as typeof view.plan.intensity })
              }
            >
              {view.intensityOptions.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="subtle">
          Source: {view.plan.source} · effective from {view.plan.effectiveFrom}
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Focus</th>
                <th>Intensity</th>
                <th>Group</th>
              </tr>
            </thead>
            <tbody>
              {view.plan.sessions.map((session, index) => (
                <tr key={`${session.day}-${session.slot}`}>
                  <td>{session.day.slice(0, 3)}</td>
                  <td>
                    <select
                      aria-label={`${session.day} focus`}
                      value={session.category}
                      disabled={busy}
                      onChange={(event) =>
                        void editSession(index, { category: event.target.value })
                      }
                    >
                      {view.categoryOptions.map((option) => (
                        <option key={option} value={option}>
                          {option.replace(/_/g, " ").toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`${session.day} intensity`}
                      value={session.intensity}
                      disabled={busy}
                      onChange={(event) =>
                        void editSession(index, { intensity: event.target.value })
                      }
                    >
                      {view.intensityOptions.map((option) => (
                        <option key={option} value={option}>
                          {option.replace(/_/g, " ").toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`${session.day} group`}
                      value={session.targetGroup}
                      disabled={busy}
                      onChange={(event) =>
                        void editSession(index, { targetGroup: event.target.value })
                      }
                    >
                      {view.groupOptions.map((option) => (
                        <option key={option} value={option}>
                          {option.replace(/_/g, " ").toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {view.facility && (
        <Panel title="Facilities">
          <Metrics
            items={[
              { label: "Training", value: view.facility.trainingQuality ?? "Unknown" },
              { label: "Youth", value: view.facility.youthQuality ?? "Unknown" },
              { label: "Medical", value: view.facility.medicalQuality ?? "Unknown" },
            ]}
          />
        </Panel>
      )}

      <Panel title="Squad development">
        {view.squadDevelopment.length === 0 ? (
          <p className="empty-state">No development data recorded yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Phase</th>
                  <th>Momentum</th>
                  <th>Fitness</th>
                  <th>Fatigue</th>
                  <th>Sharpness</th>
                </tr>
              </thead>
              <tbody>
                {view.squadDevelopment.map((player) => (
                  <tr key={player.personId}>
                    <td>{player.name}</td>
                    <td>{player.phase.replace(/_/g, " ").toLowerCase()}</td>
                    <td>{player.momentum.toFixed(2)}</td>
                    <td>{player.fitness}</td>
                    <td>{player.fatigue}</td>
                    <td>{player.matchSharpness}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </section>
  );
};
