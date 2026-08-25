import React, { useState } from "react";
import type { EntityId, TacticsView } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Panel, useRuntimeData } from "../ui.js";
import type { AppError } from "../../appBridge.js";

export const TacticsScreen = (): React.ReactElement => {
  const [state, , replace] = useRuntimeData(() => managerBridge.getTactics());
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async (command: Parameters<typeof managerBridge.updateTactics>[0]) => {
    setBusy(true);
    const result = await managerBridge.updateTactics(command);
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
        {(view) => <TacticsBoard view={view} busy={busy} onApply={apply} />}
      </AsyncPanel>
    </>
  );
};

const TacticsBoard = ({
  view,
  busy,
  onApply,
}: {
  view: TacticsView;
  busy: boolean;
  onApply: (command: Parameters<typeof managerBridge.updateTactics>[0]) => Promise<void>;
}): React.ReactElement => {
  const [name, setName] = useState(view.setup.name);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const fitFor = (slotId: string) => view.roleFits.find((fit) => fit.slotId === slotId);
  const assignment = (slotId: string) =>
    view.setup.assignments.find((item) => item.slotId === slotId);

  const assignPlayer = (slotId: string, playerId?: EntityId) =>
    onApply({
      assignments: view.setup.assignments.map((item) =>
        item.slotId === slotId ? { ...item, playerId } : item,
      ),
      // Keep the bench consistent: a promoted player leaves the bench.
      bench: view.setup.bench.filter((id) => id !== playerId),
    });

  return (
    <section className="tactics-layout">
      <Panel title="Shape and style">
        <div className="controls">
          <label>
            Tactic name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => name !== view.setup.name && void onApply({ name })}
            />
          </label>
          <label>
            Formation
            <select
              value={view.setup.formation.id}
              disabled={busy}
              onChange={(event) => void onApply({ formationId: event.target.value })}
            >
              {view.formations.map((formation) => (
                <option key={formation.id} value={formation.id}>
                  {formation.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Style
            <select
              value={view.setup.style}
              disabled={busy}
              onChange={(event) => void onApply({ style: event.target.value })}
            >
              {view.styles.map((style) => (
                <option key={style} value={style}>
                  {style.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mentality
            <select
              value={view.setup.instructions.mentality}
              disabled={busy}
              onChange={(event) =>
                void onApply({
                  instructions: {
                    ...view.setup.instructions,
                    mentality: event.target.value as typeof view.setup.instructions.mentality,
                  },
                })
              }
            >
              {view.mentalities.map((mentality) => (
                <option key={mentality} value={mentality}>
                  {mentality.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
        </div>

        <h3>In possession</h3>
        <Slider
          label="Tempo"
          value={view.setup.instructions.inPossession.tempo}
          onCommit={(value) =>
            void onApply({
              instructions: {
                ...view.setup.instructions,
                inPossession: { ...view.setup.instructions.inPossession, tempo: value },
              },
            })
          }
        />
        <Slider
          label="Passing length"
          value={view.setup.instructions.inPossession.passingLength}
          onCommit={(value) =>
            void onApply({
              instructions: {
                ...view.setup.instructions,
                inPossession: { ...view.setup.instructions.inPossession, passingLength: value },
              },
            })
          }
        />
        <Slider
          label="Width"
          value={view.setup.instructions.inPossession.width}
          onCommit={(value) =>
            void onApply({
              instructions: {
                ...view.setup.instructions,
                inPossession: { ...view.setup.instructions.inPossession, width: value },
              },
            })
          }
        />
        <h3>Out of possession</h3>
        <Slider
          label="Pressing intensity"
          value={view.setup.instructions.outOfPossession.pressingIntensity}
          onCommit={(value) =>
            void onApply({
              instructions: {
                ...view.setup.instructions,
                outOfPossession: {
                  ...view.setup.instructions.outOfPossession,
                  pressingIntensity: value,
                },
              },
            })
          }
        />
        <Slider
          label="Defensive line"
          value={view.setup.instructions.outOfPossession.defensiveLine}
          onCommit={(value) =>
            void onApply({
              instructions: {
                ...view.setup.instructions,
                outOfPossession: {
                  ...view.setup.instructions.outOfPossession,
                  defensiveLine: value,
                },
              },
            })
          }
        />
      </Panel>

      <div>
        <div className="pitch">
          {view.setup.formation.slots.map((slot) => {
            const fit = fitFor(slot.id);
            return (
              <button
                key={slot.id}
                className={`slot ${selectedSlot === slot.id ? "slot-active" : ""}`}
                style={{ left: `${slot.x}%`, top: `${100 - slot.y}%` }}
                onClick={() => setSelectedSlot(slot.id === selectedSlot ? null : slot.id)}
              >
                <strong>{slot.label ?? slot.id}</strong>
                <span>{fit?.playerName?.split(" ")[0] ?? "—"}</span>
                {fit && fit.overall > 0 && <em className="slot-fit">{fit.label}</em>}
              </button>
            );
          })}
        </div>
        <p className="subtle">
          Familiarity — formation {view.familiarity.formation}%, style {view.familiarity.style}%,
          roles {view.familiarity.roles}%, instructions {view.familiarity.instructions}%
        </p>
      </div>

      <Panel title={selectedSlot ? `Position ${selectedSlot}` : "Selection"}>
        {selectedSlot ? (
          <div className="controls">
            <label>
              Role
              <select
                value={assignment(selectedSlot)?.roleId ?? ""}
                disabled={busy}
                onChange={(event) =>
                  void onApply({
                    assignments: view.setup.assignments.map((item) =>
                      item.slotId === selectedSlot ? { ...item, roleId: event.target.value } : item,
                    ),
                  })
                }
              >
                {view.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Player
              <select
                value={assignment(selectedSlot)?.playerId ?? ""}
                disabled={busy}
                onChange={(event) =>
                  void assignPlayer(
                    selectedSlot,
                    (event.target.value || undefined) as EntityId | undefined,
                  )
                }
              >
                <option value="">— empty —</option>
                {view.roleFits
                  .filter((fit) => fit.playerId && fit.slotId === selectedSlot)
                  .map((fit) => (
                    <option key={fit.playerId} value={fit.playerId}>
                      {fit.playerName}
                    </option>
                  ))}
                {view.benchCandidates.map((player) => (
                  <option key={player.personId} value={player.personId}>
                    {player.name} ({player.primaryPosition})
                  </option>
                ))}
              </select>
            </label>
            {fitFor(selectedSlot) && fitFor(selectedSlot)!.overall > 0 && (
              <p className="subtle">
                Role fit {fitFor(selectedSlot)!.overall} ({fitFor(selectedSlot)!.label}) · position{" "}
                {fitFor(selectedSlot)!.positionFit} · attributes{" "}
                {fitFor(selectedSlot)!.attributeFit}
              </p>
            )}
          </div>
        ) : (
          <p className="subtle">Select a position on the pitch to change its player or role.</p>
        )}

        <h3>Bench ({view.setup.bench.length})</h3>
        <ul className="bench-list">
          {view.setup.bench.length === 0 && <li className="empty-state">No substitutes named.</li>}
          {view.setup.bench.map((id) => {
            const player = view.benchCandidates.find((candidate) => candidate.personId === id);
            return (
              <li key={id}>
                {player?.name ?? id}
                <button
                  className="ghost small"
                  disabled={busy}
                  onClick={() =>
                    void onApply({ bench: view.setup.bench.filter((item) => item !== id) })
                  }
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
        <label>
          Add to bench
          <select
            value=""
            disabled={busy}
            onChange={(event) =>
              event.target.value &&
              void onApply({ bench: [...view.setup.bench, event.target.value as EntityId] })
            }
          >
            <option value="">— choose player —</option>
            {view.benchCandidates
              .filter((player) => !view.setup.bench.includes(player.personId))
              .map((player) => (
                <option key={player.personId} value={player.personId}>
                  {player.name} ({player.primaryPosition})
                </option>
              ))}
          </select>
        </label>

        {view.validation.blockingErrors.length > 0 && (
          <div className="warning">
            {view.validation.blockingErrors.map((message) => (
              <div key={message}>{message}</div>
            ))}
          </div>
        )}
        {view.validation.warnings.length > 0 && (
          <div className="notice">
            {view.validation.warnings.map((message) => (
              <div key={message}>
                <Badge tone="warn">warning</Badge> {message}
              </div>
            ))}
          </div>
        )}
        {view.validation.isValid && view.validation.warnings.length === 0 && (
          <div className="ok">Selection is legal.</div>
        )}
      </Panel>
    </section>
  );
};

/** Commits on release so a drag does not fire a runtime call per pixel. */
const Slider = ({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState(value);
  React.useEffect(() => setDraft(value), [value]);
  return (
    <label>
      {label} ({draft})
      <input
        type="range"
        min="0"
        max="100"
        value={draft}
        onChange={(event) => setDraft(Number(event.target.value))}
        onMouseUp={() => draft !== value && onCommit(draft)}
        onKeyUp={() => draft !== value && onCommit(draft)}
      />
    </label>
  );
};
