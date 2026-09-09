import React, { useState } from "react";
import type {
  AppResult,
  AttributeGroupView,
  DressingRoomHierarchyLabel,
  EntityId,
  EntityReference,
  ManagerSupportLabel,
  PlayerMarketValueView,
  PlayerProfile,
  PlayerValuationSnapshot,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { EntityRefLink, EntityStorylinePanel, OrganizationProfilePanel, type ProfileEntityType } from "../RoleDetailScreen.js";
import type { DesktopRuntimeApi } from "../../appBridge.js";
import { TransferNegotiationLauncher } from "./TransferNegotiationMeeting.js";
import { humanizeEnum } from "../storyHumanizer.js";
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

const band = (value: string): string => value.replaceAll("_", " ").toLowerCase();

/**
 * Position abbreviation for the football-card badge — a compact identity
 * marker, not a tactical diagram (that already exists on the Tactics screen).
 */
const POSITION_SHORT: Record<string, string> = {
  GOALKEEPER: "GK",
  CENTRE_BACK: "CB",
  LEFT_BACK: "LB",
  RIGHT_BACK: "RB",
  DEFENSIVE_MIDFIELDER: "DM",
  CENTRAL_MIDFIELDER: "CM",
  ATTACKING_MIDFIELDER: "AM",
  LEFT_MIDFIELDER: "LM",
  RIGHT_MIDFIELDER: "RM",
  LEFT_WINGER: "LW",
  RIGHT_WINGER: "RW",
  STRIKER: "ST",
};

const positionShort = (position: string): string =>
  POSITION_SHORT[position] ?? position.slice(0, 2).toUpperCase();

const initialsFor = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

/**
 * A compact 2D football-card presentation for the header — silhouette
 * initials, position badge, club identity chip, and an overall-rating ring.
 * Deliberately simple SVG/CSS, not an attempt at proprietary FM/EA card art.
 */
const PlayerCard = ({
  player,
  onOpenClub,
}: {
  player: PlayerProfile;
  onOpenClub: (clubId: EntityId) => void;
}): React.ReactElement => {
  const ringCircumference = 2 * Math.PI * 42;
  const ringProgress = Math.max(0, Math.min(1, player.ability / 20));
  return (
    <div className="player-card">
      <svg viewBox="0 0 120 120" className="player-card-ring" role="img" aria-label={`Overall rating ${player.ability.toFixed(1)}`}>
        <circle cx="60" cy="60" r="42" className="player-card-ring-track" />
        <circle
          cx="60"
          cy="60"
          r="42"
          className="player-card-ring-fill"
          strokeDasharray={`${ringCircumference}`}
          strokeDashoffset={`${ringCircumference * (1 - ringProgress)}`}
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="55" textAnchor="middle" className="player-card-silhouette">
          {initialsFor(player.name)}
        </text>
        <text x="60" y="78" textAnchor="middle" className="player-card-rating">
          {player.ability.toFixed(1)}
        </text>
      </svg>
      <div className="player-card-meta">
        <span className="player-card-position">{positionShort(player.primaryPosition)}</span>
        {player.club ? (
          <EntityRefLink reference={player.club} onOpen={(reference) => onOpenClub(reference.id)} />
        ) : (
          <span className="subtle">{player.clubName ?? "Free agent"}</span>
        )}
      </div>
    </div>
  );
};

/**
 * Grouped attribute radar. Only ever fed groups the backend has already
 * decided are safe to show in full (buildPlayerProfile gates this by
 * knowledge level) — never per-attribute values for a player you don't know
 * well, which would leak past the same scouting-report banding the rest of
 * this screen respects.
 */
const AttributeRadar = ({ groups }: { groups: AttributeGroupView[] }): React.ReactElement | null => {
  const visible = groups.filter((group) => group.attributes.length > 0);
  if (visible.length < 3) return null;
  const size = 240;
  const center = size / 2;
  const maxRadius = center - 46;
  const angleStep = (2 * Math.PI) / visible.length;
  const averages = visible.map(
    (group) => group.attributes.reduce((sum, attribute) => sum + attribute.value, 0) / group.attributes.length,
  );
  const pointAt = (ratio: number, index: number) => {
    const angle = -Math.PI / 2 + index * angleStep;
    return { x: center + ratio * maxRadius * Math.cos(angle), y: center + ratio * maxRadius * Math.sin(angle) };
  };
  const shapePoints = averages.map((average, index) => pointAt(average / 20, index));
  const shape = shapePoints.map((point) => `${point.x},${point.y}`).join(" ");
  const rings = [0.25, 0.5, 0.75, 1].map((ratio) =>
    visible.map((_, index) => pointAt(ratio, index)).map((point) => `${point.x},${point.y}`).join(" "),
  );
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="attribute-radar" role="img" aria-label="Attribute radar">
      {rings.map((ring, index) => (
        <polygon key={index} points={ring} className="radar-ring" />
      ))}
      <polygon points={shape} className="radar-shape" />
      {visible.map((group, index) => {
        const label = pointAt(1.18, index);
        const dot = shapePoints[index]!;
        return (
          <g key={group.group}>
            <circle cx={dot.x} cy={dot.y} r={3.5} className="radar-point" />
            <text x={label.x} y={label.y} textAnchor="middle" className="radar-label">
              {group.group}
            </text>
            <text x={label.x} y={label.y + 13} textAnchor="middle" className="radar-label-value">
              {averages[index]!.toFixed(1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/** A simpler gauge for players whose full attribute breakdown isn't visible
 * to you — an honest scouted-ability band, never a fabricated per-attribute
 * radar for a player you don't actually know well. */
const ScoutedAbilityGauge = ({
  min,
  max,
}: {
  min: number;
  max: number;
}): React.ReactElement => (
  <div className="scouted-gauge">
    <div className="scouted-gauge-track">
      <div
        className="scouted-gauge-fill"
        style={{ left: `${(min / 20) * 100}%`, width: `${((max - min) / 20) * 100}%` }}
      />
    </div>
    <p className="subtle">
      Scouted estimate: {min}–{max} <span className="sim-tag">est</span>
    </p>
  </div>
);

const ValuationSparkline = ({
  history,
}: {
  history: PlayerValuationSnapshot[];
}): React.ReactElement => {
  if (history.length < 2) {
    return <p className="empty-state">Not enough valuation history yet to chart a trend.</p>;
  }
  const width = 360;
  const height = 90;
  const pad = 10;
  const values = history.map((entry) => (entry.internalMin + entry.internalMax) / 2);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coords = values.map((value, index) => ({
    x: pad + (index / (values.length - 1)) * (width - pad * 2),
    y: height - pad - ((value - min) / range) * (height - pad * 2),
  }));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="valuation-sparkline" role="img" aria-label="Market value history">
      <polyline points={coords.map((point) => `${point.x},${point.y}`).join(" ")} className="sparkline-line" />
      {coords.map((point, index) => (
        <circle key={index} cx={point.x} cy={point.y} r={2.5} className="sparkline-point" />
      ))}
    </svg>
  );
};

const MarketValuePanel = ({ playerId }: { playerId: EntityId }): React.ReactElement | null => {
  const [state] = useRuntimeData(() => managerBridge.getPlayerMarketValue(playerId), [playerId]);
  if (state.status === "error") return null;
  return (
    <AsyncPanel state={state}>
      {(value: PlayerMarketValueView) => (
        <Panel title="Market value">
          <p className="market-value-headline">
            {money(value.currentValue, value.currency)} <span className="sim-tag">sim</span>
          </p>
          <Metrics
            items={[
              {
                label: "Estimated deal range",
                value: `${money(value.valuationMin, value.currency)} – ${money(value.valuationMax, value.currency)}`,
              },
              {
                label: "Club asking range",
                value: `${money(value.askingMin, value.currency)} – ${money(value.askingMax, value.currency)}`,
              },
              { label: "Club stance", value: value.clubStance },
              {
                label: "Contract leverage",
                value:
                  value.contractLeverageMonths !== undefined
                    ? `${value.contractLeverageMonths} months remaining`
                    : "No active contract",
              },
              { label: "Interest", value: value.interestSummary },
            ]}
          />
          <h3>Valuation history</h3>
          <ValuationSparkline history={value.history} />
          <p className="subtle">
            Simulation-derived from ability, potential, form, reputation, contract position, and
            market interest — not a factual appraisal.
          </p>
        </Panel>
      )}
    </AsyncPanel>
  );
};

/**
 * Real, actor-aware actions only — grouped, not a button dump. RELEASE and
 * SQUAD_ROLE have no manual command anywhere in the codebase yet (release
 * only ever happens automatically via contract expiry/squad-balancing
 * cadence; there is no per-player squad-role change command) — shown
 * disabled with an honest reason rather than omitted silently or faked.
 * PROMISES has no per-player command either (createPromise is internal to
 * squad-dynamics.ts, not exposed as a desktop command).
 */
const PlayerActionRail = ({
  player,
  actionBusy,
  setActionBusy,
  setActionMessage,
  refresh,
}: {
  player: PlayerProfile;
  actionBusy: string | null;
  setActionBusy: (id: string | null) => void;
  setActionMessage: (message: string | null) => void;
  refresh: () => void;
}): React.ReactElement => {
  const run = async (id: string, action: () => Promise<AppResult<unknown>>): Promise<void> => {
    if (actionBusy) return;
    setActionBusy(id);
    setActionMessage(null);
    const result = await action();
    setActionBusy(null);
    if (result.ok) refresh();
    else setActionMessage(result.error.message);
  };

  const transferListed = player.transferListStatus === "TRANSFER_LISTED";
  const loanListed = player.transferListStatus === "LOAN_LISTED";

  return (
    <Panel title="Actions">
      {player.ownSquad && (
        <div className="action-group">
          <h3>Transfer</h3>
          <div className="button-row">
            <button
              className={transferListed ? "primary small" : "ghost small"}
              disabled={actionBusy !== null}
              onClick={() =>
                void run("transfer", () =>
                  managerBridge.setTransferStatus({ playerId: player.personId, status: transferListed ? "NOT_FOR_SALE" : "TRANSFER_LISTED" }),
                )
              }
            >
              {actionBusy === "transfer" ? "Updating…" : transferListed ? "Remove from transfer list" : "Transfer list"}
            </button>
            <button
              className={loanListed ? "primary small" : "ghost small"}
              disabled={actionBusy !== null}
              onClick={() =>
                void run("loan", () =>
                  managerBridge.setTransferStatus({ playerId: player.personId, status: loanListed ? "NOT_FOR_SALE" : "LOAN_LISTED" }),
                )
              }
            >
              {actionBusy === "loan" ? "Updating…" : loanListed ? "Remove from loan list" : "Loan list"}
            </button>
          </div>
        </div>
      )}

      <div className="action-group">
        <h3>Scouting</h3>
        <div className="button-row">
          <button
            className="ghost small"
            disabled={actionBusy !== null}
            onClick={() => void run("shortlist", () => managerBridge.toggleShortlist(player.personId))}
          >
            {actionBusy === "shortlist" ? "Updating…" : "Toggle shortlist"}
          </button>
        </div>
      </div>

      {player.ownSquad && (
        <div className="action-group">
          <h3>Squad status</h3>
          <div className="button-row">
            <button className="ghost small" disabled title="Manual release isn't available yet — releases only happen automatically, through contract expiry or squad-balancing.">
              Release
            </button>
            <button className="ghost small" disabled title="Changing a player's squad role isn't available as a direct action yet.">
              Change squad role
            </button>
          </div>
          <p className="subtle">Release and squad-role changes are not yet available as direct manager actions.</p>
        </div>
      )}

      <div className="action-group">
        <h3>Discussion</h3>
        <button className="ghost small" disabled title="Per-player promises/discussion is not yet available as a direct action.">
          Discuss / promise
        </button>
      </div>
    </Panel>
  );
};

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

/** No call-up history is the common case for most players, not an error —
 * this quietly renders nothing rather than showing a warning banner for
 * every player who has simply never been capped. Women & Girls call-ups
 * form their own stage sequence in the backend, never a renamed men's flow. */
const PlayerPathwayPanel = ({ playerId }: { playerId: EntityId }): React.ReactElement | null => {
  const [state] = useRuntimeData(() => managerBridge.getPlayerPathway(playerId), [playerId]);
  if (state.status !== "ready") return null;
  const pathway = state.data;
  return (
    <Panel title="National pathway">
      <ul className="compact-list">
        {pathway.stages.map((stage) => (
          <li key={`${stage.team.id}:${stage.programme}`}>
            <EntityRefLink reference={stage.team} onOpen={() => undefined} /> ·{" "}
            <Badge tone="info">{stage.programme.replace(/_/g, " ")}</Badge> · {stage.appearances} appearance
            {stage.appearances === 1 ? "" : "s"} · called up {stage.firstCallup}
            {stage.firstCallup !== stage.lastCallup ? ` – ${stage.lastCallup}` : ""}
            {stage.firstAppearance && ` · debut ${stage.firstAppearance}`}
          </li>
        ))}
      </ul>
      {pathway.nextPlausibleStage && (
        <p className="subtle">Next plausible stage: {pathway.nextPlausibleStage.toUpperCase()}.</p>
      )}
    </Panel>
  );
};

export const PlayerProfileScreen = ({
  playerId,
  onClose,
  onOpenClub,
  onOpenPlayer,
  bridge,
}: {
  playerId: EntityId;
  onClose: () => void;
  onOpenClub: (clubId: EntityId) => void;
  /** Navigates this same screen to a different player — e.g. a teammate
   * referenced from a storyline entry. Optional so existing callers that
   * haven't wired player-to-player navigation yet keep compiling; without
   * it, a PLAYER reference simply has no click handler (falls through to
   * OrganizationProfilePanel's own PlayerContextPanel instead, which is a
   * self-contained overlay rather than a navigation). */
  onOpenPlayer?: (playerId: EntityId) => void;
  /** The full DesktopRuntimeApi, passed down from the app root — used only
   * for the generic OrganizationProfilePanel fallback below (COMPETITION,
   * STAFF, INFRASTRUCTURE_PROJECT, a different PLAYER); every other command
   * on this screen still goes through the narrower managerBridge. CLUB
   * keeps its existing dedicated onOpenClub path unchanged. */
  bridge: DesktopRuntimeApi;
}): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => managerBridge.getPlayerProfile(playerId), [playerId]);
  const [salary, setSalary] = useState("");
  const [months, setMonths] = useState("24");
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [openTransferOfferId, setOpenTransferOfferId] = useState<EntityId | null>(null);
  const [openProfileRef, setOpenProfileRef] = useState<{ entityType: ProfileEntityType; entityId: EntityId } | null>(null);
  /** CLUB keeps its existing dedicated overlay (onOpenClub, from the
   * caller); every other resolvable reference type (COMPETITION, STAFF,
   * INFRASTRUCTURE_PROJECT, a different PLAYER, ...) opens through the
   * same generic OrganizationProfilePanel every other screen already
   * uses — using the full `bridge` prop passed down from the app root
   * (not the narrower managerBridge, which doesn't structurally satisfy
   * what that panel needs) — so a storyline entry never falls back to a
   * plain, unclickable label just because it references something other
   * than a club. */
  const openReference = (reference: EntityReference): void => {
    if (reference.entityType === "CLUB") {
      onOpenClub(reference.id);
      return;
    }
    setOpenProfileRef({ entityType: reference.entityType as ProfileEntityType, entityId: reference.id });
  };

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
            <Panel title={player.name} className="player-header-panel">
              <div className="player-header-layout">
                <PlayerCard player={player} onOpenClub={onOpenClub} />
                <div className="player-header-details">
                  <p className="subtle">
                    {/* The panel is titled with the display name, so the full name is
                        only worth repeating when it actually says something more. */}
                    {player.fullName !== player.name && `${player.fullName} · `}
                    {player.primaryPosition}
                    {player.secondaryPositions.length > 0 &&
                      ` (${player.secondaryPositions.join(", ")})`}{" "}
                    ·{" "}
                    <Badge tone={availabilityTone(player.availability)}>
                      {band(player.availability)}
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
                      { label: "Squad standing", value: player.squadStatus },
                      { label: "Your knowledge", value: <Badge tone="info">{band(player.knowledge)}</Badge> },
                    ]}
                  />
                </div>
              </div>
            </Panel>

            <MarketValuePanel playerId={playerId} />

            {/* A profile opens for every role, but player actions belong to
                whoever actually holds player-management authority. Roles
                without it get no action rail rather than controls that would
                be rejected on click. */}
            {player.viewer.canManagePlayer ? (
              <PlayerActionRail
                player={player}
                actionBusy={actionBusy}
                setActionBusy={setActionBusy}
                setActionMessage={setActionMessage}
                refresh={refresh}
              />
            ) : (
              <Panel title="Actions">
                <p className="subtle">
                  You are viewing this player as {player.viewer.role.replaceAll("_", " ").toLowerCase()}. Player
                  actions belong to the club's football management.
                </p>
              </Panel>
            )}
            {actionMessage && (
              <p className="notice" role="status">
                {actionMessage}
              </p>
            )}

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
                    { label: "Squad role", value: band(player.contract.squadRole) },
                    { label: "Status", value: <Badge tone="info">{band(player.contract.status)}</Badge> },
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
                    { label: "Phase", value: humanizeEnum(player.development.phase) },
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

            <PlayerPathwayPanel playerId={playerId} />
            <EntityStorylinePanel
              bridge={managerBridge}
              entityId={playerId}
              onOpenReference={openReference}
              onOpenTransferNegotiation={setOpenTransferOfferId}
            />
            {openTransferOfferId && (
              <TransferNegotiationLauncher offerId={openTransferOfferId} onClose={() => setOpenTransferOfferId(null)} />
            )}
            {openProfileRef && (
              <OrganizationProfilePanel
                bridge={bridge}
                entityType={openProfileRef.entityType}
                entityId={openProfileRef.entityId}
                onClose={() => setOpenProfileRef(null)}
                onOpenPlayer={
                  onOpenPlayer
                    ? (nextPlayerId) => {
                        setOpenProfileRef(null);
                        onOpenPlayer(nextPlayerId);
                      }
                    : undefined
                }
              />
            )}

            <Panel title="Attributes">
              <p className="subtle">
                Gameplay attributes on the engine&rsquo;s 1&ndash;20 scale. These are{" "}
                <span className="sim-tag">simulation-only</span> values, not researched facts.
              </p>
              {player.attributeGroups.length > 0 ? (
                <>
                  <AttributeRadar groups={player.attributeGroups} />
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
                </>
              ) : player.scoutingSummary?.estimatedAbility ? (
                <ScoutedAbilityGauge
                  min={player.scoutingSummary.estimatedAbility.min}
                  max={player.scoutingSummary.estimatedAbility.max}
                />
              ) : (
                <p className="empty-state">
                  Your knowledge of this player isn&rsquo;t deep enough yet for a detailed breakdown.
                </p>
              )}
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
