import React, { useState } from "react";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import {
  AsyncPanel,
  Badge,
  FactValue,
  Metrics,
  Panel,
  availabilityTone,
  money,
  useRuntimeData,
} from "../ui.js";

export const PlayerProfileScreen = ({
  playerId,
  onClose,
}: {
  playerId: EntityId;
  onClose: () => void;
}): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getPlayerProfile(playerId), [playerId]);
  const [salary, setSalary] = useState("");
  const [months, setMonths] = useState("24");
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  return (
    <section
      className="player-detail"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <button className="ghost" onClick={onClose}>
        ← Back to squad
      </button>
      <AsyncPanel state={state}>
        {(player) => (
          <>
            <Panel title={player.name}>
              <p className="subtle">
                {player.fullName} · {player.primaryPosition}
                {player.secondaryPositions.length > 0 &&
                  ` (${player.secondaryPositions.join(", ")})`}{" "}
                ·{" "}
                <Badge tone={availabilityTone(player.availability)}>
                  {player.availability.replace("_", " ").toLowerCase()}
                </Badge>
              </p>
              <Metrics
                items={[
                  { label: "Date of birth", value: <FactValue fact={player.dateOfBirth} /> },
                  { label: "Age", value: <FactValue fact={player.age} /> },
                  { label: "Nationality", value: <FactValue fact={player.nationality} /> },
                  {
                    label: "Height",
                    value: <FactValue fact={player.heightCm} render={(cm) => `${cm} cm`} />,
                  },
                  { label: "Preferred foot", value: <FactValue fact={player.preferredFoot} /> },
                  { label: "Club", value: player.clubName ?? "—" },
                  { label: "Squad status", value: player.squadStatus },
                  { label: "Knowledge", value: player.knowledge },
                ]}
              />
            </Panel>

            <Panel title="Form and condition">
              <Metrics
                items={[
                  {
                    label: "Assessment",
                    value: `${player.ability.toFixed(1)} (${player.abilityLabel})`,
                  },
                  { label: "Fitness", value: player.fitness },
                  { label: "Condition", value: player.condition },
                  { label: "Morale", value: player.morale },
                  { label: "Form", value: player.form },
                ]}
              />
            </Panel>

            <Panel title="Season">
              <Metrics
                items={[
                  { label: "Appearances", value: player.season.appearances },
                  { label: "Starts", value: player.season.starts },
                  { label: "Minutes", value: player.season.minutes },
                  { label: "Goals", value: player.season.goals },
                  { label: "Assists", value: player.season.assists },
                  {
                    label: "Cards",
                    value: `${player.season.yellowCards}/${player.season.redCards}`,
                  },
                  {
                    label: "Average rating",
                    value: player.season.averageRating
                      ? player.season.averageRating.toFixed(2)
                      : "—",
                  },
                ]}
              />
            </Panel>

            {player.contract ? (
              <Panel title="Contract">
                <Metrics
                  items={[
                    {
                      label: "Salary",
                      value: `${money(player.contract.salary, player.contract.currency)} / month`,
                    },
                    { label: "Expires", value: player.contract.endDate },
                    { label: "Squad role", value: player.contract.squadRole },
                    { label: "Status", value: player.contract.status },
                    {
                      label: "Release clause",
                      value: player.contract.releaseClause
                        ? money(player.contract.releaseClause, player.contract.currency)
                        : "None",
                    },
                  ]}
                />
                <div className="contract-action">
                  <h3>Offer Contract</h3>
                  <p className="subtle">Propose a renewal through the manager contract service.</p>
                  <div className="contract-form">
                    <label>Monthly wage (NPR)<input inputMode="numeric" value={salary} onChange={(event) => setSalary(event.target.value)} placeholder="Current wage" /></label>
                    <label>Duration (months)<input inputMode="numeric" value={months} onChange={(event) => setMonths(event.target.value)} /></label>
                    <button className="primary" disabled={busy} onClick={async () => {
                      setBusy(true);
                      setActionMessage(null);
                      const result = await managerBridge.renewContract({ playerId, salary: salary ? Number(salary) * 1000 : undefined, months: Number(months) });
                      setBusy(false);
                      setActionMessage(result.ok ? "Contract offer submitted." : result.error.message);
                    }}>{busy ? "Submitting…" : "Offer Contract"}</button>
                  </div>
                  {actionMessage && <p className="notice" role="status">{actionMessage}</p>}
                </div>
              </Panel>
            ) : (
              <Panel title="Contract">
                <p className="empty-state">No active contract at your club.</p>
              </Panel>
            )}

            {player.development && (
              <Panel title="Development">
                <Metrics
                  items={[
                    { label: "Phase", value: player.development.phase.replace(/_/g, " ") },
                    { label: "Momentum", value: player.development.momentum.toFixed(2) },
                    { label: "Match sharpness", value: player.development.matchSharpness },
                    { label: "Fatigue", value: player.development.fatigue },
                    { label: "Recovery", value: player.development.recovery },
                    { label: "Potential", value: player.development.potentialBand },
                  ]}
                />
                <p className="subtle">
                  Potential is shown as a band. Exact ceilings stay hidden by design.
                </p>
              </Panel>
            )}

            <Panel title="Attributes">
              <p className="subtle">
                Gameplay attributes on the engine&rsquo;s 1&ndash;20 scale. These are{" "}
                <span className="sim-tag">simulation-only</span> values, not researched facts.
              </p>
              <div className="attribute-groups">
                {player.attributeGroups.map((group) => (
                  <section key={group.group}>
                    <h3>{group.group}</h3>
                    {group.attributes.map((attribute) => (
                      <div className="attribute" key={attribute.key}>
                        <span>{attribute.label}</span>
                        <span className="attribute-bar">
                          <span
                            className="attribute-fill"
                            style={{ width: `${(attribute.value / 20) * 100}%` }}
                          />
                        </span>
                        <strong>{attribute.value}</strong>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            </Panel>

            {player.scoutingSummary && (
              <Panel title="Scouting">
                <Metrics
                  items={[
                    {
                      label: "Estimated ability",
                      value: player.scoutingSummary.estimatedAbility
                        ? `${player.scoutingSummary.estimatedAbility.min}–${player.scoutingSummary.estimatedAbility.max}`
                        : "Unknown",
                    },
                    { label: "Potential", value: player.scoutingSummary.estimatedPotentialBand },
                    { label: "Confidence", value: player.scoutingSummary.confidence },
                    { label: "Observations", value: player.scoutingSummary.observations },
                    { label: "Recommendation", value: player.scoutingSummary.recommendation },
                  ]}
                />
                <p>
                  <strong>Strengths:</strong>{" "}
                  {player.scoutingSummary.strengths.join(", ") || "Not yet identified"}
                </p>
                <p>
                  <strong>Weaknesses:</strong>{" "}
                  {player.scoutingSummary.weaknesses.join(", ") || "Not yet identified"}
                </p>
              </Panel>
            )}
          </>
        )}
      </AsyncPanel>
    </section>
  );
};
