import React, { useMemo, useState } from "react";
import type {
  DressingRoomHierarchyLabel,
  EntityId,
  ManagerSupportLabel,
  SquadPlayerRow,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, EmptyState, FactValue, Panel, availabilityTone, useRuntimeData } from "../ui.js";
import { PersonPortrait } from "../../presentation/PersonPortrait.js";
import { buildPersonVisualIdentity } from "../../presentation/personVisualIdentity.js";

type SortKey = "ability" | "name" | "fitness" | "goals" | "appearances";

export const SquadScreen = ({
  onSelectPlayer,
}: {
  onSelectPlayer: (playerId: EntityId) => void;
}): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getSquad());
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [availability, setAvailability] = useState("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("ability");

  return (
    <>
      <AsyncPanel
        state={state}
        isEmpty={(data) => data.players.length === 0}
        empty="No players registered."
      >
        {(squad) => (
          <SquadTable
            players={squad.players}
            positionOptions={squad.positionOptions}
            query={query}
            setQuery={setQuery}
            position={position}
            setPosition={setPosition}
            availability={availability}
            setAvailability={setAvailability}
            sortKey={sortKey}
            setSortKey={setSortKey}
            onSelectPlayer={onSelectPlayer}
          />
        )}
      </AsyncPanel>
      <DressingRoomPanel onSelectPlayer={onSelectPlayer} />
    </>
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

const SOCIAL_GROUP_LABELS: Record<string, string> = {
  FRIENDSHIP: "Friendship",
  MENTORSHIP: "Mentorship",
  RIVALRY: "Rivalry",
  DISTRUST: "Distrust",
  INFLUENTIAL: "Influential",
};

const DressingRoomPanel = ({
  onSelectPlayer,
}: {
  onSelectPlayer: (playerId: EntityId) => void;
}): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getDressingRoom());

  return (
    <AsyncPanel state={state}>
      {(room) => {
        const notable = room.hierarchy.filter((entry) => entry.label !== "REGULAR");
        const lifestyleByPerson = new Map(room.lifestyle.map((entry) => [entry.personId, entry]));
        const supportByPerson = new Map(room.managerSupport.map((entry) => [entry.personId, entry]));
        const detailPersonIds = Array.from(
          new Set([...lifestyleByPerson.keys(), ...supportByPerson.keys()]),
        );

        return (
          <>
            <Panel title="Dressing room">
              <h3>Notable players</h3>
              {notable.length === 0 ? (
                <EmptyState>No standout hierarchy figures yet.</EmptyState>
              ) : (
                <ul className="report-list">
                  {notable.map((entry) => (
                    <li key={entry.personId}>
                      <button className="link" onClick={() => onSelectPlayer(entry.personId)}>
                        {entry.playerName}
                      </button>{" "}
                      <Badge tone={hierarchyTone(entry.label)}>{HIERARCHY_LABELS[entry.label]}</Badge>
                    </li>
                  ))}
                </ul>
              )}

              <h3>Social groups</h3>
              {room.socialGroups.length === 0 ? (
                <EmptyState>No notable social groups detected yet.</EmptyState>
              ) : (
                <ul className="report-list">
                  {room.socialGroups.map((group, index) => (
                    <li key={`${group.type}-${index}`}>
                      <Badge tone={group.type === "RIVALRY" || group.type === "DISTRUST" ? "bad" : "ok"}>
                        {SOCIAL_GROUP_LABELS[group.type] ?? group.type}
                      </Badge>{" "}
                      {group.memberNames.join(" & ")} <span className="subtle">{group.clue}</span>
                    </li>
                  ))}
                </ul>
              )}

              <h3>Mentoring</h3>
              {room.mentoring.length === 0 ? (
                <EmptyState>No active mentoring assignments.</EmptyState>
              ) : (
                <ul className="report-list">
                  {room.mentoring.map((entry, index) => (
                    <li key={index}>
                      {entry.mentorName} mentors {entry.menteeName} on{" "}
                      {entry.focus.replace(/_/g, " ").toLowerCase()}{" "}
                      <span className="subtle">
                        {entry.status.toLowerCase()} · {entry.progressBand.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Player lifestyle & manager support" className="panel-wide">
              {detailPersonIds.length === 0 ? (
                <EmptyState>No lifestyle or relationship reads available yet.</EmptyState>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Professionalism</th>
                        <th>Training</th>
                        <th>Media activity</th>
                        <th>Off-field focus</th>
                        <th>Manager support</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailPersonIds.map((personId) => {
                        const lifestyle = lifestyleByPerson.get(personId);
                        const support = supportByPerson.get(personId);
                        const name = lifestyle?.playerName ?? support?.playerName ?? "Unknown player";
                        return (
                          <tr key={personId}>
                            <td>
                              <button className="link" onClick={() => onSelectPlayer(personId)}>
                                {name}
                              </button>
                            </td>
                            <td>{lifestyle ? lifestyle.professionalismHabits.toLowerCase() : "—"}</td>
                            <td>{lifestyle ? lifestyle.trainingDiscipline.toLowerCase() : "—"}</td>
                            <td>{lifestyle ? lifestyle.mediaActivity.toLowerCase() : "—"}</td>
                            <td>{lifestyle ? lifestyle.offFieldFocus.replace(/_/g, " ").toLowerCase() : "—"}</td>
                            <td>
                              {support ? (
                                <Badge tone={supportTone(support.support)}>
                                  {SUPPORT_LABELS[support.support]}
                                </Badge>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        );
      }}
    </AsyncPanel>
  );
};

const SquadTable = (props: {
  players: SquadPlayerRow[];
  positionOptions: string[];
  query: string;
  setQuery: (value: string) => void;
  position: string;
  setPosition: (value: string) => void;
  availability: string;
  setAvailability: (value: string) => void;
  sortKey: SortKey;
  setSortKey: (value: SortKey) => void;
  onSelectPlayer: (playerId: EntityId) => void;
}): React.ReactElement => {
  const rows = useMemo(() => {
    const filtered = props.players.filter(
      (player) =>
        player.name.toLowerCase().includes(props.query.toLowerCase()) &&
        (props.position === "ALL" || player.positions.includes(props.position as never)) &&
        (props.availability === "ALL" || player.availability === props.availability),
    );
    return filtered.sort((a, b) => {
      switch (props.sortKey) {
        case "name":
          return a.name.localeCompare(b.name);
        case "fitness":
          return b.fitness - a.fitness;
        case "goals":
          return b.goals - a.goals;
        case "appearances":
          return b.appearances - a.appearances;
        default:
          return b.ability - a.ability;
      }
    });
  }, [props.players, props.query, props.position, props.availability, props.sortKey]);

  return (
    <Panel title={`Senior squad: ${props.players.length}${props.players.length > 26 ? " · Oversized squad" : ""}`}>
      <div className="table-tools">
        <label className="sr-label">
          Search squad
          <input
            placeholder="Search squad"
            value={props.query}
            onChange={(event) => props.setQuery(event.target.value)}
          />
        </label>
        <label className="sr-label">
          Position
          <select
            value={props.position}
            onChange={(event) => props.setPosition(event.target.value)}
          >
            <option value="ALL">All positions</option>
            {props.positionOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="sr-label">
          Availability
          <select
            value={props.availability}
            onChange={(event) => props.setAvailability(event.target.value)}
          >
            <option value="ALL">All availability</option>
            <option value="AVAILABLE">Available</option>
            <option value="INJURED">Injured</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="INTERNATIONAL_DUTY">International duty</option>
          </select>
        </label>
        <label className="sr-label">
          Sort
          <select
            value={props.sortKey}
            onChange={(event) => props.setSortKey(event.target.value as SortKey)}
          >
            <option value="ability">Ability</option>
            <option value="name">Name</option>
            <option value="fitness">Fitness</option>
            <option value="goals">Goals</option>
            <option value="appearances">Appearances</option>
          </select>
        </label>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Pos</th>
              <th>Age</th>
              <th>Nat</th>
              <th>Status</th>
              <th>Fit</th>
              <th>Mor</th>
              <th>Apps</th>
              <th>G</th>
              <th>A</th>
              <th>Cards</th>
              <th>Contract</th>
              <th>Wage/month</th>
              <th>Ability</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((player) => (
              <tr
                key={player.personId}
                tabIndex={0}
                onClick={() => props.onSelectPlayer(player.personId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    props.onSelectPlayer(player.personId);
                  }
                }}
              >
                <td className="squad-name-cell">
                  {/* decorative: the visible name text right next to it
                      already identifies the player, so the portrait is
                      hidden from assistive tech rather than announced
                      redundantly. Built from data already on this row —
                      no extra bridge call per player. */}
                  <PersonPortrait
                    identity={buildPersonVisualIdentity(player.personId, player.age.value)}
                    role="PLAYER"
                    size="small"
                    decorative
                  />
                  {player.name}
                </td>
                <td>{player.positions.join(", ")}</td>
                <td>
                  <FactValue fact={player.age} />
                </td>
                <td>{player.nationality}</td>
                <td>
                  <Badge tone={availabilityTone(player.availability)}>
                    {player.availability.replace("_", " ").toLowerCase()}
                  </Badge>
                  {player.transferStatus === "TRANSFER_LISTED" && <Badge tone="warn">listed</Badge>}
                </td>
                <td>{player.fitness}</td>
                <td>{player.morale}</td>
                <td>{player.appearances}</td>
                <td>{player.goals}</td>
                <td>{player.assists}</td>
                <td>
                  {player.yellowCards}/{player.redCards}
                </td>
                <td>{player.contractExpiry ?? "—"}</td>
                <td>{player.salary === undefined ? "—" : `NPR ${Math.round(player.salary / 1000).toLocaleString("en-US")}k`}</td>
                <td title={player.abilityLabel}>{player.ability.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="empty-state">No players match these filters.</p>}
    </Panel>
  );
};
