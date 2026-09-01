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
    /*
     * The dashboard grid is auto-fit at 260px, so this screen's one panel was
     * given a single narrow column while a line of helper text claimed another
     * and the rest of the row sat empty. Fixtures needs the full width.
     */
    <section className="fixtures-screen">
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
            /*
             * A club usually plays one competition, so the column repeated the
             * same long league name on every row and squeezed the opponent out.
             * When it is the same throughout it is stated once instead.
             */
            const competitions = [...new Set(rows.map((fixture) => fixture.competition))];
            const sharedCompetition = competitions.length === 1 ? competitions[0] : undefined;
            return (
              <div className="table-scroll">
                {sharedCompetition && <p className="subtle">{sharedCompetition}</p>}
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      {!sharedCompetition && <th>Competition</th>}
                      <th>H/A</th>
                      <th>Opponent</th>
                      <th>Venue</th>
                      <th>Status</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((fixture, index) => (
                      <FixtureLine
                        key={fixture.id}
                        fixture={fixture}
                        showCompetition={!sharedCompetition}
                        /* Upcoming fixtures are listed in date order, so the
                           first is the one being prepared for. */
                        isNext={tab === "upcoming" && index === 0}
                        actionable={tab === "results" || fixture.date <= list.worldDate}
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
  actionable,
  showCompetition,
  isNext,
  onSelect,
}: {
  fixture: FixtureRow;
  actionable: boolean;
  showCompetition: boolean;
  isNext: boolean;
  onSelect: () => void;
}): React.ReactElement => (
  <tr
    tabIndex={actionable ? 0 : -1}
    aria-disabled={!actionable}
    className={!actionable ? "fixture-readonly" : undefined}
    onClick={actionable ? onSelect : undefined}
    onKeyDown={(event) => {
      if (actionable && event.key === "Enter") onSelect();
    }}
  >
    <td>
      {fixture.date}
      {isNext && (
        <>
          {" "}
          <Badge tone="info">Next</Badge>
        </>
      )}
    </td>
    {showCompetition && <td>{fixture.competition}</td>}
    <td>{fixture.homeAway === "home" ? "H" : "A"}</td>
    <td>{fixture.opponent}</td>
    <td>{fixture.venue ?? <span className="unknown">Unknown</span>}</td>
    <td>{fixture.status === "scheduled" && !actionable ? "Future · read only" : fixture.status}</td>
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
