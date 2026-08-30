import React, { useState } from "react";
import type { EntityId, FixtureRow } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Panel, useRuntimeData } from "../ui.js";

export const FixturesScreen = ({
  onOpenMatch,
}: {
  onOpenMatch: (fixtureId: EntityId) => void;
}): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getFixtures());
  const [tab, setTab] = useState<"upcoming" | "results">("upcoming");

  return (
    <section className="dashboard">
      <Panel
        title="Fixtures"
        actions={
          <div className="tab-row">
            <button
              className={tab === "upcoming" ? "active" : ""}
              onClick={() => setTab("upcoming")}
            >
              Upcoming
            </button>
            <button className={tab === "results" ? "active" : ""} onClick={() => setTab("results")}>
              Results
            </button>
          </div>
        }
      >
        <AsyncPanel state={state}>
          {(list) => {
            const rows = tab === "upcoming" ? list.upcoming : list.results;
            if (rows.length === 0) {
              return (
                <p className="empty-state">
                  {tab === "upcoming" ? "No fixtures scheduled." : "No matches played yet."}
                </p>
              );
            }
            return (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Competition</th>
                      <th>H/A</th>
                      <th>Opponent</th>
                      <th>Venue</th>
                      <th>Status</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((fixture) => (
                      <FixtureLine
                        key={fixture.id}
                        fixture={fixture}
                        onSelect={() => onOpenMatch(fixture.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        </AsyncPanel>
      </Panel>

      <p className="subtle">
        Select an upcoming fixture for match preparation and Quick Sim, or open a result to review it.
      </p>
    </section>
  );
};

const FixtureLine = ({
  fixture,
  onSelect,
}: {
  fixture: FixtureRow;
  onSelect: () => void;
}): React.ReactElement => (
  <tr
    tabIndex={0}
    onClick={onSelect}
    onKeyDown={(event) => {
      if (event.key === "Enter") onSelect();
    }}
  >
    <td>{fixture.date}</td>
    <td>{fixture.competition}</td>
    <td>{fixture.homeAway === "home" ? "H" : "A"}</td>
    <td>{fixture.opponent}</td>
    <td>{fixture.venue ?? <span className="unknown">Unknown</span>}</td>
    <td>{fixture.status}</td>
    <td>
      {fixture.score ?? "—"}{" "}
      {fixture.result && (
        <Badge tone={fixture.result === "W" ? "ok" : fixture.result === "D" ? "info" : "bad"}>
          {fixture.result}
        </Badge>
      )}
    </td>
  </tr>
);
