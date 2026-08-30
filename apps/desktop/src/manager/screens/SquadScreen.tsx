import React, { useMemo, useState } from "react";
import type { EntityId, SquadPlayerRow } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, FactValue, Panel, availabilityTone, useRuntimeData } from "../ui.js";

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
    <Panel title={`Senior squad: ${rows.length}${rows.length > 26 ? " · Oversized squad" : ""}`}>
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
                <td>{player.name}</td>
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
