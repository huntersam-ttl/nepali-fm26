import React, { useState } from "react";
import type { EntityId, MatchRatingRow } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, Metrics, Panel, money, useRuntimeData } from "../ui.js";
import { StructuredPressConferencePanel } from "../screens/MediaScreen.js";

type TimelineFilter = "all" | "goals" | "chances" | "cards" | "subs" | "injuries" | "tactics";

const FILTERS: Array<{ id: TimelineFilter; label: string; types: string[] }> = [
  { id: "all", label: "All", types: [] },
  { id: "goals", label: "Goals", types: ["GOAL", "ASSIST"] },
  { id: "chances", label: "Chances", types: ["SHOT", "SHOT_ON_TARGET", "SAVE"] },
  { id: "cards", label: "Cards", types: ["YELLOW_CARD", "SECOND_YELLOW", "RED_CARD"] },
  { id: "subs", label: "Subs", types: ["SUBSTITUTION"] },
  { id: "injuries", label: "Injuries", types: ["INJURY"] },
  { id: "tactics", label: "Tactics", types: ["TACTICAL_CHANGE"] },
];

export const PostMatchReportScreen = ({
  fixtureId,
  onReturn,
  onSelectPlayer,
}: {
  fixtureId: EntityId;
  onReturn: () => void;
  onSelectPlayer?: (playerId: EntityId) => void;
}): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getPostMatchReport(fixtureId), [fixtureId]);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [showPressConference, setShowPressConference] = useState(false);

  return (
    <section className="dashboard">
      <AsyncPanel state={state}>
        {(report) => {
          if (!report) return <p className="empty-state">No report is available yet.</p>;
          const active = FILTERS.find((entry) => entry.id === filter)!;
          const timeline =
            active.types.length === 0
              ? report.timeline
              : report.timeline.filter((line) => active.types.includes(line.type));

          return (
            <>
              <Panel
                title="Full time"
                actions={
                  <div className="button-row">
                    <button className="ghost" onClick={() => setShowPressConference(true)}>
                      Press conference
                    </button>
                    <button className="primary" onClick={onReturn}>
                      Return to career
                    </button>
                  </div>
                }
              >
                <h2 className="report-score">
                  {report.homeTeamName} {report.homeGoals} – {report.awayGoals}{" "}
                  {report.awayTeamName}
                </h2>
                <Metrics
                  items={[
                    { label: "Result", value: resultLabel(report.result) },
                    { label: "Competition", value: report.competitionName },
                    { label: "Date", value: report.date },
                    {
                      label: "Venue",
                      value: report.venue ?? <span className="unknown">Unknown</span>,
                    },
                    {
                      label: "Attendance",
                      value: report.attendance?.toLocaleString("en-US") ?? (
                        <span className="unknown">Unknown</span>
                      ),
                    },
                  ]}
                />
                <Metrics
                  items={
                    report.startingTactics === "UNAVAILABLE"
                      ? [
                          {
                            label: "Starting tactics",
                            value: <span className="unknown">Unavailable</span>,
                          },
                        ]
                      : [
                          {
                            label: `${report.homeTeamName} started`,
                            value: `${report.startingTactics.home.formationName}, ${formatMentality(report.startingTactics.home.mentality)}`,
                          },
                          {
                            label: `${report.awayTeamName} started`,
                            value: `${report.startingTactics.away.formationName}, ${formatMentality(report.startingTactics.away.mentality)}`,
                          },
                        ]
                  }
                />
                {report.scorers.length === 0 ? (
                  <p className="empty-state">No goals.</p>
                ) : (
                  <ul className="report-list">
                    {report.scorers.map((scorer, index) => (
                      <li key={`${scorer.playerName}-${index}`}>
                        {scorer.minute}&rsquo; <strong>{scorer.playerName}</strong> (
                        {scorer.teamName}){scorer.assist ? ` — assist ${scorer.assist}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {report.playerOfTheMatch && (
                  <p>
                    <Badge tone="ok">Player of the match</Badge>{" "}
                    <strong>
                      {onSelectPlayer ? (
                        <button className="link" onClick={() => onSelectPlayer(report.playerOfTheMatch!.personId)}>
                          {report.playerOfTheMatch.name}
                        </button>
                      ) : (
                        report.playerOfTheMatch.name
                      )}
                    </strong>{" "}
                    ·{" "}
                    {report.playerOfTheMatch.rating.toFixed(2)}
                  </p>
                )}
              </Panel>

              <Panel title="Match stats">
                <table className="stat-table">
                  <thead>
                    <tr>
                      <th>{report.homeTeamName.split(" ")[0]}</th>
                      <th />
                      <th>{report.awayTeamName.split(" ")[0]}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        [
                          "Possession",
                          `${report.stats.possession.home}%`,
                          `${report.stats.possession.away}%`,
                        ],
                        ["Shots", report.stats.shots.home, report.stats.shots.away],
                        [
                          "On target",
                          report.stats.shotsOnTarget.home,
                          report.stats.shotsOnTarget.away,
                        ],
                        ["xG", report.stats.xg.home.toFixed(2), report.stats.xg.away.toFixed(2)],
                        ["Corners", report.stats.corners.home, report.stats.corners.away],
                        ["Fouls", report.stats.fouls.home, report.stats.fouls.away],
                        ["Yellow", report.stats.yellowCards.home, report.stats.yellowCards.away],
                        ["Red", report.stats.redCards.home, report.stats.redCards.away],
                      ] as const
                    ).map(([label, home, away]) => (
                      <tr key={label}>
                        <td>{home}</td>
                        <th scope="row">{label}</th>
                        <td>{away}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>

              <Panel
                title="Timeline"
                actions={
                  <div className="tab-row">
                    {FILTERS.map((entry) => (
                      <button
                        key={entry.id}
                        className={filter === entry.id ? "active" : ""}
                        onClick={() => setFilter(entry.id)}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                }
              >
                {timeline.length === 0 ? (
                  <p className="empty-state">Nothing of that kind happened.</p>
                ) : (
                  <div className="commentary-feed report-timeline">
                    {timeline.map((line) => (
                      <div
                        key={`${line.eventId}-${line.sequence}`}
                        className={`commentary-line importance-${line.importance.toLowerCase()} type-${line.type.toLowerCase()}`}
                      >
                        <span className="commentary-minute">{line.minute ?? 0}&rsquo;</span>
                        <span className="commentary-text">{line.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Player ratings">
                <RatingsTable ratings={report.ratings} best={report.playerOfTheMatch} onSelectPlayer={onSelectPlayer} />
              </Panel>

              <Panel title="Tactical summary">
                {report.tacticalChanges.length === 0 && report.substitutions.length === 0 ? (
                  <p className="empty-state">No changes were made by either side.</p>
                ) : (
                  <>
                    {report.tacticalChanges.length > 0 && (
                      <ul className="report-list">
                        {report.tacticalChanges.map((change, index) => (
                          <li key={index}>
                            {change.minute}&rsquo; {change.teamName} — {change.summary}{" "}
                            <span className="subtle">({change.decidedBy.toLowerCase()})</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {report.substitutions.length > 0 && (
                      <>
                        <h3>Substitutions</h3>
                        <ul className="report-list">
                          {report.substitutions.map((sub, index) => (
                            <li key={index}>
                              {sub.minute}&rsquo; {sub.teamName}: {sub.playerOn} for {sub.playerOff}
                              {sub.reason ? ` (${sub.reason})` : ""}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </Panel>

              {(report.cards.length > 0 || report.injuries.length > 0) && (
                <Panel title="Discipline and injuries">
                  {report.cards.map((card, index) => (
                    <div key={`card-${index}`}>
                      {card.minute}&rsquo; {card.playerName} ({card.teamName}){" "}
                      <Badge tone={card.type === "YELLOW_CARD" ? "warn" : "bad"}>
                        {card.type.replace(/_/g, " ").toLowerCase()}
                      </Badge>
                    </div>
                  ))}
                  {report.injuries.map((injury, index) => (
                    <div key={`injury-${index}`}>
                      {injury.minute}&rsquo; {injury.playerName} ({injury.teamName}){" "}
                      <Badge tone="bad">{injury.severity ?? "injury"}</Badge>
                    </div>
                  ))}
                </Panel>
              )}

              <Panel title="Matchday finances">
                {report.finances.length === 0 ? (
                  <p className="empty-state">
                    No matchday finances were recorded for this fixture.
                  </p>
                ) : (
                  <ul className="report-list">
                    {report.finances.map((entry, index) => (
                      <li key={index}>
                        {entry.description} —{" "}
                        <strong>
                          {entry.direction === "DEBIT" ? "-" : "+"}
                          {money(entry.amount, entry.currency)}
                        </strong>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {showPressConference && (
                <StructuredPressConferencePanel
                  trigger={{ context: "POST_MATCH", fixtureId }}
                  onClose={() => setShowPressConference(false)}
                />
              )}
            </>
          );
        }}
      </AsyncPanel>
    </section>
  );
};

const resultLabel = (result: "W" | "D" | "L"): string =>
  result === "W" ? "Win" : result === "D" ? "Draw" : "Defeat";

const formatMentality = (mentality: string): string =>
  mentality
    .toLowerCase()
    .split("_")
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");

const RatingsTable = ({
  ratings,
  best,
  onSelectPlayer,
}: {
  ratings: MatchRatingRow[];
  best?: MatchRatingRow;
  onSelectPlayer?: (playerId: EntityId) => void;
}): React.ReactElement => {
  const teams = [...new Set(ratings.map((rating) => rating.teamName))];
  return (
    <>
      {teams.map((team) => (
        <div key={team}>
          <h3>{team}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Pos</th>
                  <th>Min</th>
                  <th>G</th>
                  <th>A</th>
                  <th>Cards</th>
                  <th>Rating</th>
                </tr>
              </thead>
              <tbody>
                {ratings
                  .filter((rating) => rating.teamName === team)
                  .sort((a, b) => b.rating - a.rating)
                  .map((rating) => (
                    <tr
                      key={rating.personId}
                      className={rating.personId === best?.personId ? "row-highlight" : ""}
                    >
                      <td>
                        {onSelectPlayer ? (
                          <button className="link" onClick={() => onSelectPlayer(rating.personId)}>
                            {rating.name}
                          </button>
                        ) : (
                          rating.name
                        )}
                        {!rating.started && <span className="subtle"> (sub)</span>}
                      </td>
                      <td>{rating.position ?? "-"}</td>
                      <td>{rating.minutes}</td>
                      <td>{rating.goals}</td>
                      <td>{rating.assists}</td>
                      <td>
                        {rating.yellowCards > 0 && <Badge tone="warn">Y</Badge>}
                        {rating.redCard && <Badge tone="bad">R</Badge>}
                      </td>
                      <td>
                        <strong>{rating.rating.toFixed(2)}</strong>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
};
