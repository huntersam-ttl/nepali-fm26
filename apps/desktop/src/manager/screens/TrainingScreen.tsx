import React, { useState } from "react";
import type {
  CreateDevelopmentPlanCommand,
  EntityId,
  PlayerDevelopmentView,
  TrainingView,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Metrics, Panel, useRuntimeData } from "../ui.js";
import { TrainingPlanner } from "../TrainingPlanner.js";
import type { AppError } from "../../appBridge.js";

export const TrainingScreen = ({
  onSelectPlayer,
}: {
  onSelectPlayer: (playerId: EntityId) => void;
}): React.ReactElement => {
  const [state, , replace] = useRuntimeData(() => managerBridge.getTraining());
  const [devState, , replaceDev] = useRuntimeData(() => managerBridge.getPlayerDevelopment());
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

  const applyPlan = async (command: CreateDevelopmentPlanCommand) => {
    setBusy(true);
    const result = await managerBridge.createPlayerDevelopmentPlan(command);
    setBusy(false);
    if (result.ok) {
      replaceDev(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  };

  const setPlanStatus = async (planId: EntityId, status: string) => {
    setBusy(true);
    const result = await managerBridge.setPlayerDevelopmentPlanStatus(planId, status);
    setBusy(false);
    if (result.ok) {
      replaceDev(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  };

  return (
    <>
      {error && <ErrorBanner error={error} />}
      <AsyncPanel state={state}>
        {(view) => <TrainingBoard view={view} busy={busy} onApply={apply} onSelectPlayer={onSelectPlayer} />}
      </AsyncPanel>
      <AsyncPanel state={devState}>
        {(view) => (
          <PlayerDevelopmentBoard view={view} busy={busy} onCreatePlan={applyPlan} onSetStatus={setPlanStatus} onSelectPlayer={onSelectPlayer} />
        )}
      </AsyncPanel>
    </>
  );
};

const TrainingBoard = ({
  view,
  busy,
  onApply,
  onSelectPlayer,
}: {
  view: TrainingView;
  busy: boolean;
  onApply: (command: Parameters<typeof managerBridge.updateTraining>[0]) => Promise<void>;
  onSelectPlayer: (playerId: EntityId) => void;
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
      <TrainingPlanner view={view} />
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

      <Panel title="Squad development" className="panel-wide">
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
                    <td>
                      <button className="link" onClick={() => onSelectPlayer(player.personId)}>
                        {player.name}
                      </button>
                    </td>
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

const PlayerDevelopmentBoard = ({
  view,
  busy,
  onCreatePlan,
  onSetStatus,
  onSelectPlayer,
}: {
  view: PlayerDevelopmentView;
  busy: boolean;
  onCreatePlan: (command: CreateDevelopmentPlanCommand) => Promise<void>;
  onSetStatus: (planId: EntityId, status: string) => Promise<void>;
  onSelectPlayer: (playerId: EntityId) => void;
}): React.ReactElement => {
  const [focusType, setFocusType] = useState<string>("BALANCED");
  const [targetPosition, setTargetPosition] = useState<string>(view.positionOptions[0] ?? "ST");
  const [targetRole, setTargetRole] = useState<string>("");
  const [targetAttributeGroup, setTargetAttributeGroup] = useState<string>(view.attributeGroupOptions[0] ?? "technical");
  const [intensity, setIntensity] = useState<string>("NORMAL");
  const [selectedPersonId, setSelectedPersonId] = useState<string>(view.players[0]?.personId ?? "");

  return (
    <section className="dashboard">
      {view.environment && (
        <Panel title="Development environment">
          <Metrics
            items={[
              { label: "Coaching quality", value: view.environment.coachingQuality?.toFixed(2) ?? "Unknown" },
              { label: "Facilities effect", value: view.environment.facilitiesEffect?.toFixed(2) ?? "Unknown" },
            ]}
          />
        </Panel>
      )}

      <Panel title="Set individual focus">
        <div className="controls">
          <label>
            Player
            <select value={selectedPersonId} onChange={(e) => setSelectedPersonId(e.target.value)}>
              {view.players.map((player) => (
                <option key={player.personId} value={player.personId}>
                  {player.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Focus
            <select value={focusType} onChange={(e) => setFocusType(e.target.value)}>
              {view.focusTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, " ").toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          {focusType === "POSITION" && (
            <label>
              Target position
              <select value={targetPosition} onChange={(e) => setTargetPosition(e.target.value)}>
                {view.positionOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          )}
          {focusType === "ROLE" && (
            <label>
              Target role
              <input value={targetRole} onChange={(e) => setTargetRole(e.target.value)} placeholder="e.g. wing-back" />
            </label>
          )}
          {focusType === "ATTRIBUTE" && (
            <label>
              Attribute group
              <select value={targetAttributeGroup} onChange={(e) => setTargetAttributeGroup(e.target.value)}>
                {view.attributeGroupOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Intensity
            <select value={intensity} onChange={(e) => setIntensity(e.target.value)}>
              {view.intensityOptions.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={busy || !selectedPersonId}
            onClick={() =>
              void onCreatePlan({
                personId: selectedPersonId as never,
                focusType,
                targetPosition: focusType === "POSITION" ? targetPosition : undefined,
                targetRole: focusType === "ROLE" ? targetRole : undefined,
                targetAttributeGroup: focusType === "ATTRIBUTE" ? targetAttributeGroup : undefined,
                intensity: intensity as never,
              })
            }
          >
            Set focus
          </button>
        </div>
      </Panel>

      <Panel title="Player progress" className="panel-wide">
        {view.players.length === 0 ? (
          <p className="empty-state">No players to develop yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Age</th>
                  <th>Position</th>
                  <th>Phase</th>
                  <th>Trend</th>
                  <th>Ability</th>
                  <th>Fitness</th>
                  <th>Injury risk</th>
                  <th>Active focus</th>
                  <th>Review</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {view.players.map((player) => (
                  <tr key={player.personId}>
                    <td>
                      <button className="link" onClick={() => onSelectPlayer(player.personId)}>
                        {player.name}
                      </button>
                    </td>
                    <td>{player.age ?? "—"}</td>
                    <td>{player.primaryPosition}</td>
                    <td>{player.phase.replace(/_/g, " ").toLowerCase()}</td>
                    <td>
                      <Badge tone={player.trend === "IMPROVING" ? "ok" : player.trend === "DECLINING" ? "bad" : "info"}>
                        {player.trend.toLowerCase()}
                      </Badge>
                    </td>
                    <td>{player.currentAbility}</td>
                    <td>
                      {player.fitness}
                      {player.trainingAvailability === "INJURED" && <Badge tone="bad">injured</Badge>}
                      {player.trainingAvailability === "RETURNING" && <Badge tone="warn">returning</Badge>}
                    </td>
                    <td>{Math.round(player.injuryRisk * 100)}%</td>
                    <td>
                      {player.activePlan
                        ? `${player.activePlan.focusType.toLowerCase()}${
                            player.activePlan.targetPosition ? ` → ${player.activePlan.targetPosition}` : ""
                          }`
                        : "—"}
                    </td>
                    <td>
                      {player.plateaued && <Badge tone="warn">plateaued</Badge>}
                      {player.latestRecommendation && (
                        <span className="subtle">{player.latestRecommendation.replace(/_/g, " ").toLowerCase()}</span>
                      )}
                    </td>
                    <td>
                      {player.activePlan && (
                        <button
                          className="ghost small"
                          disabled={busy}
                          onClick={() => void onSetStatus(player.activePlan!.id, "PAUSED")}
                        >
                          Pause
                        </button>
                      )}
                    </td>
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
