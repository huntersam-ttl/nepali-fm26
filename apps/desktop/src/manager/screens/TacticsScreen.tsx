import React, { useRef, useState } from "react";
import type { EntityId, SetPieceAssignments, TacticsView } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Panel, useRuntimeData } from "../ui.js";
import type { AppError } from "../../appBridge.js";

/** Plain-language band for a familiarity value — text, never colour alone. */
const familiarityBand = (value: number): string =>
  value >= 85
    ? "fluent"
    : value >= 70
      ? "comfortable"
      : value >= 55
        ? "still settling"
        : value >= 40
          ? "unfamiliar"
          : "learning from scratch";

const CORNER_ROUTINES = ["NEAR_POST", "FAR_POST", "SHORT_CORNER", "CROWD_KEEPER"] as const;
const CORNER_ZONES = ["NEAR_POST", "FAR_POST", "CENTRE", "EDGE"] as const;
const DEFENSIVE_CORNER_SCHEMES = ["ZONAL", "MAN_ORIENTED", "MIXED"] as const;
const FREE_KICK_ROUTINES = ["DIRECT", "INDIRECT", "CROSS"] as const;

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: "12px",
};

export const TacticsScreen = (): React.ReactElement => {
  const [state, , replace] = useRuntimeData(() => managerBridge.getTactics());
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingUpdate = useRef(Promise.resolve());

  const apply = (command: Parameters<typeof managerBridge.updateTactics>[0]) => {
    const update = pendingUpdate.current.then(async () => {
      setBusy(true);
      const result = await managerBridge.updateTactics(command);
      if (result.ok) {
        replace(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
      setBusy(false);
    });
    pendingUpdate.current = update.catch(() => undefined);
    return update;
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
  const [formationId, setFormationId] = useState(view.setup.formation.id);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fitFor = (slotId: string) => view.roleFits.find((fit) => fit.slotId === slotId);
  const assignment = (slotId: string) =>
    view.setup.assignments.find((item) => item.slotId === slotId);

  const applyCommand = (command: Parameters<typeof onApply>[0]) => {
    setSaved(false);
    return onApply({ formationId, ...command }).then(() => setSaved(true));
  };

  const assignPlayer = (slotId: string, playerId?: EntityId) =>
    applyCommand({
      assignments: view.setup.assignments.map((item) =>
        item.slotId === slotId ? { ...item, playerId } : item,
      ),
      // Keep the bench consistent: a promoted player leaves the bench.
      bench: view.setup.bench.filter((id) => id !== playerId),
    });

  return (
    <section className="tactics-layout">
      <Panel title="Shape and style">
        <p className="subtle tactics-status" role="status">{busy ? "Saving tactics…" : saved ? "Saved" : "Changes save automatically"}</p>
        <div className="controls">
          <label>
            Tactic name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => name !== view.setup.name && void applyCommand({ name })}
            />
          </label>
          <label>
            Formation
            <select
              value={formationId}
              disabled={busy}
              onChange={(event) => {
                setFormationId(event.target.value);
                void applyCommand({ formationId: event.target.value });
              }}
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
              onChange={(event) => void applyCommand({ style: event.target.value })}
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
                void applyCommand({
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
            void applyCommand({
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
            void applyCommand({
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
            void applyCommand({
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
            void applyCommand({
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
            void applyCommand({
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

      <SetPiecesPanel
        setPieces={view.setup.setPieces}
        busy={busy}
        players={[
          ...view.roleFits
            .filter((fit): fit is typeof fit & { playerId: EntityId } => Boolean(fit.playerId))
            .map((fit) => ({ personId: fit.playerId, name: fit.playerName ?? "Unknown player" })),
          ...view.benchCandidates.map((player) => ({ personId: player.personId, name: player.name })),
        ].filter((player, index, all) => all.findIndex((item) => item.personId === player.personId) === index)}
        onApply={(setPieces) => void applyCommand({ setPieces })}
      />

      <div>
        <div className="pitch">
          {view.setup.formation.slots.map((slot) => {
            const fit = fitFor(slot.id);
            return (
              <button
                key={slot.id}
                className={`slot ${selectedSlot === slot.id ? "slot-active" : ""}`}
                style={{ left: `${slot.x}%`, top: `${100 - slot.y}%` }}
                /* The slot is a toggle, and selection was shown only by colour;
                   aria-pressed makes the same state available non-visually. */
                aria-pressed={selectedSlot === slot.id}
                aria-label={`${slot.label ?? slot.id}: ${fit?.playerName ?? "no player selected"}`}
                onClick={() => setSelectedSlot(slot.id === selectedSlot ? null : slot.id)}
              >
                <strong>{slot.label ?? slot.id}</strong>
                <span>{fit?.playerName?.split(" ")[0] ?? "—"}</span>
                {fit && fit.overall > 0 && <em className="slot-fit">{fit.label}</em>}
              </button>
            );
          })}
        </div>
        <div className="tactics-familiarity">
          <h3>Familiarity</h3>
          <ul className="report-list">
            {(
              [
                ["Formation", view.familiarity.formation],
                ["Style", view.familiarity.style],
                ["Roles", view.familiarity.roles],
                ["Instructions", view.familiarity.instructions],
              ] as const
            ).map(([label, value]) => (
              <li key={label}>
                {label}: <strong>{value}%</strong> — {familiarityBand(value)}
              </li>
            ))}
          </ul>
          <p className="subtle">
            Familiarity grows with training-ground time, dedicated tactical sessions and matches
            played in this setup. A radical change — a new shape or a very different style —
            temporarily lowers it and, with it, how sharply the squad executes until they re-learn
            the system.
          </p>
        </div>
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
            {/* Fit scores are derived ratings, so they are read as whole numbers
                rather than to two decimal places. */}
            {fitFor(selectedSlot) && fitFor(selectedSlot)!.overall > 0 && (
              <p className="subtle">
                Role fit {Math.round(fitFor(selectedSlot)!.overall)} (
                {fitFor(selectedSlot)!.label}) · position{" "}
                {Math.round(fitFor(selectedSlot)!.positionFit)} · attributes{" "}
                {Math.round(fitFor(selectedSlot)!.attributeFit)}
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
                {player?.name ?? "Unknown player"}
                <button
                  className="ghost small"
                  disabled={busy}
                  onClick={() =>
                    void applyCommand({ bench: view.setup.bench.filter((item) => item !== id) })
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
              void applyCommand({ bench: [...view.setup.bench, event.target.value as EntityId] })
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

const SetPiecesPanel = ({
  setPieces,
  players,
  busy,
  onApply,
}: {
  setPieces: SetPieceAssignments;
  players: Array<{ personId: EntityId; name: string }>;
  busy: boolean;
  onApply: (setPieces: SetPieceAssignments) => void;
}): React.ReactElement => {
  const set = <K extends keyof SetPieceAssignments>(key: K, value: SetPieceAssignments[K]) =>
    onApply({ ...setPieces, [key]: value });

  const PlayerSelect = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value?: EntityId;
    onChange: (value?: EntityId) => void;
  }): React.ReactElement => (
    <label>
      {label}
      <select
        value={value ?? ""}
        disabled={busy}
        onChange={(event) => onChange((event.target.value || undefined) as EntityId | undefined)}
      >
        <option value="">— none —</option>
        {players.map((player) => (
          <option key={player.personId} value={player.personId}>
            {player.name}
          </option>
        ))}
      </select>
    </label>
  );

  const MultiPlayerSelect = ({
    label,
    values,
    onChange,
  }: {
    label: string;
    values?: EntityId[];
    onChange: (values: EntityId[]) => void;
  }): React.ReactElement => (
    <label>
      {label}
      <select
        multiple
        value={values ?? []}
        disabled={busy}
        size={4}
        onChange={(event) =>
          onChange(Array.from(event.target.selectedOptions, (option) => option.value as EntityId))
        }
      >
        {players.map((player) => (
          <option key={player.personId} value={player.personId}>
            {player.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Panel title="Set pieces" className="panel-wide">
      <h3>Penalties</h3>
      <div style={gridStyle}>
        <PlayerSelect
          label="Penalty taker"
          value={setPieces.penaltyTaker}
          onChange={(value) => set("penaltyTaker", value)}
        />
      </div>

      <h3>Corners — attacking</h3>
      <div style={gridStyle}>
        <PlayerSelect
          label="Left corner taker"
          value={setPieces.leftCornerTaker}
          onChange={(value) => set("leftCornerTaker", value)}
        />
        <PlayerSelect
          label="Right corner taker"
          value={setPieces.rightCornerTaker}
          onChange={(value) => set("rightCornerTaker", value)}
        />
        <label>
          Routine
          <select
            value={setPieces.cornerRoutine ?? ""}
            disabled={busy}
            onChange={(event) =>
              set(
                "cornerRoutine",
                (event.target.value || undefined) as SetPieceAssignments["cornerRoutine"],
              )
            }
          >
            <option value="">— default —</option>
            {CORNER_ROUTINES.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Delivery zone
          <select
            value={setPieces.cornerDeliveryZone ?? ""}
            disabled={busy}
            onChange={(event) =>
              set(
                "cornerDeliveryZone",
                (event.target.value || undefined) as SetPieceAssignments["cornerDeliveryZone"],
              )
            }
          >
            <option value="">— default —</option>
            {CORNER_ZONES.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <PlayerSelect
          label="Primary target"
          value={setPieces.cornerPrimaryTarget}
          onChange={(value) => set("cornerPrimaryTarget", value)}
        />
        <PlayerSelect
          label="Secondary target"
          value={setPieces.cornerSecondaryTarget}
          onChange={(value) => set("cornerSecondaryTarget", value)}
        />
        <PlayerSelect
          label="Edge target"
          value={setPieces.cornerEdgeTarget}
          onChange={(value) => set("cornerEdgeTarget", value)}
        />
        <MultiPlayerSelect
          label="Stay back (ctrl/cmd-click to select multiple)"
          values={setPieces.cornerStayBack}
          onChange={(values) => set("cornerStayBack", values)}
        />
      </div>

      <h3>Corners — defensive</h3>
      <div style={gridStyle}>
        <label>
          Scheme
          <select
            value={setPieces.defensiveCornerScheme ?? ""}
            disabled={busy}
            onChange={(event) =>
              set(
                "defensiveCornerScheme",
                (event.target.value || undefined) as SetPieceAssignments["defensiveCornerScheme"],
              )
            }
          >
            <option value="">— default —</option>
            {DEFENSIVE_CORNER_SCHEMES.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <MultiPlayerSelect
          label="Marking assignments"
          values={setPieces.defensiveCornerAssignments}
          onChange={(values) => set("defensiveCornerAssignments", values)}
        />
        <MultiPlayerSelect
          label="Aerial priority"
          values={setPieces.defensiveAerialPriority}
          onChange={(values) => set("defensiveAerialPriority", values)}
        />
      </div>

      <h3>Free kicks</h3>
      <div style={gridStyle}>
        <label>
          Routine
          <select
            value={setPieces.freeKickRoutine ?? ""}
            disabled={busy}
            onChange={(event) =>
              set(
                "freeKickRoutine",
                (event.target.value || undefined) as SetPieceAssignments["freeKickRoutine"],
              )
            }
          >
            <option value="">— default —</option>
            {FREE_KICK_ROUTINES.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <PlayerSelect
          label="Direct taker"
          value={setPieces.directFreeKickTaker}
          onChange={(value) => set("directFreeKickTaker", value)}
        />
        <PlayerSelect
          label="Indirect taker"
          value={setPieces.indirectFreeKickTaker}
          onChange={(value) => set("indirectFreeKickTaker", value)}
        />
        <PlayerSelect
          label="Target"
          value={setPieces.freeKickTarget}
          onChange={(value) => set("freeKickTarget", value)}
        />
        <PlayerSelect
          label="Secondary target"
          value={setPieces.freeKickSecondaryTarget}
          onChange={(value) => set("freeKickSecondaryTarget", value)}
        />
      </div>
    </Panel>
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
