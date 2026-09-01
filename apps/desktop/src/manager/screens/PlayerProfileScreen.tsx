import React, { useState } from "react";
import type {
  DressingRoomHierarchyLabel,
  EntityId,
  ManagerSupportLabel,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import {
  AsyncPanel,
  Badge,
  EmptyState,
  FactValue,
  Metrics,
  Panel,
  availabilityTone,
  money,
  useRuntimeData,
} from "../ui.js";

const HIERARCHY_LABELS: Record<DressingRoomHierarchyLabel, string> = {
  TEAM_LEADER: "Team leader",
  HIGHLY_INFLUENTIAL: "Highly influential",
  REGULAR: "Regular",
  FRINGE: "Fringe",
  YOUNGSTER: "Youngster",
};

const hierarchyTone = (label: DressingRoomHierarchyLabel): "ok" | "warn" | "bad" | "info" => {
  switch (label) {
    case "TEAM_LEADER":
    case "HIGHLY_INFLUENTIAL":
      return "ok";
    case "FRINGE":
      return "warn";
    default:
      return "info";
  }
};

const SUPPORT_LABELS: Record<ManagerSupportLabel, string> = {
  FULLY_ONSIDE: "Fully onside",
  NEUTRAL: "Neutral",
  AT_ODDS: "At odds",
};

const supportTone = (label: ManagerSupportLabel): "ok" | "warn" | "bad" | "info" =>
  label === "FULLY_ONSIDE" ? "ok" : label === "AT_ODDS" ? "bad" : "info";

/** Reuses the same squad-wide dressing-room bridge as SquadScreen; no per-player endpoint needed. */
const PlayerDressingRoomPanel = ({ playerId }: { playerId: EntityId }): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getDressingRoom());

  return (
    <AsyncPanel state={state}>
      {(room) => {
        const hierarchy = room.hierarchy.find((entry) => entry.personId === playerId);
        const lifestyle = room.lifestyle.find((entry) => entry.personId === playerId);
        const support = room.managerSupport.find((entry) => entry.personId === playerId);
        const groups = room.socialGroups.filter((group) =>
          group.memberNames.includes(hierarchy?.playerName ?? ""),
        );
        const mentoring = room.mentoring.filter(
          (entry) => entry.mentorName === hierarchy?.playerName || entry.menteeName === hierarchy?.playerName,
        );
        const hasAnything = Boolean(hierarchy || lifestyle || support || groups.length || mentoring.length);

        return (
          <Panel title="Dressing room">
            {!hasAnything ? (
              <EmptyState>No dressing-room reads available for this player yet.</EmptyState>
            ) : (
              <>
                {hierarchy && (
                  <p>
                    Standing <Badge tone={hierarchyTone(hierarchy.label)}>{HIERARCHY_LABELS[hierarchy.label]}</Badge>
                  </p>
                )}
                {support && (
                  <p>
                    Relationship with you <Badge tone={supportTone(support.support)}>{SUPPORT_LABELS[support.support]}</Badge>
                  </p>
                )}
                {lifestyle && (
                  <p className="subtle">
                    {lifestyle.professionalismHabits.toLowerCase()} professionalism ·{" "}
                    {lifestyle.trainingDiscipline.toLowerCase()} training discipline ·{" "}
                    {lifestyle.mediaActivity.toLowerCase()} media activity ·{" "}
                    {lifestyle.offFieldFocus.replace(/_/g, " ").toLowerCase()}
                  </p>
                )}
                {groups.map((group, index) => (
                  <p key={index} className="subtle">
                    {group.type.charAt(0) + group.type.slice(1).toLowerCase()}: {group.clue}
                  </p>
                ))}
                {mentoring.map((entry, index) => (
                  <p key={index} className="subtle">
                    {entry.mentorName === hierarchy?.playerName
                      ? `Mentoring ${entry.menteeName}`
                      : `Mentored by ${entry.mentorName}`}{" "}
                    on {entry.focus.replace(/_/g, " ").toLowerCase()} ·{" "}
                    {entry.progressBand.replace(/_/g, " ").toLowerCase()}
                  </p>
                ))}
              </>
            )}
          </Panel>
        );
      }}
    </AsyncPanel>
  );
};

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
                {/* The panel is titled with the display name, so the full name is
                    only worth repeating when it actually says something more. */}
                {player.fullName !== player.name && `${player.fullName} · `}
                {player.primaryPosition}
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

            <PlayerDressingRoomPanel playerId={playerId} />

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
