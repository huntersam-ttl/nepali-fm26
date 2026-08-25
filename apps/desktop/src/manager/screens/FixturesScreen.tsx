import React, { useState } from "react";
import type { EntityId, FixtureRow, QuickSimSummary } from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import {
  AsyncPanel,
  Badge,
  ErrorBanner,
  FormRun,
  Metrics,
  Panel,
  availabilityTone,
  useRuntimeData,
} from "../ui.js";
import type { AppError } from "../../appBridge.js";

export const FixturesScreen = ({
  onQuickSim,
}: {
  onQuickSim: (fixtureId: EntityId) => Promise<QuickSimSummary | undefined>;
}): React.ReactElement => {
  const [state, refresh] = useRuntimeData(() => managerBridge.getFixtures());
  const [selected, setSelected] = useState<EntityId | null>(null);
  const [tab, setTab] = useState<"upcoming" | "results">("upcoming");
  const [summary, setSummary] = useState<QuickSimSummary | undefined>();
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="dashboard">
      {error && <ErrorBanner error={error} />}
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
                        onSelect={() => setSelected(fixture.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        </AsyncPanel>
      </Panel>

      {selected && (
        <FixtureDetailPanel
          fixtureId={selected}
          busy={busy}
          onClose={() => setSelected(null)}
          onQuickSim={async () => {
            setBusy(true);
            try {
              const result = await onQuickSim(selected);
              setSummary(result);
              setSelected(null);
              refresh();
            } catch (cause) {
              setError({
                code: "SIMULATION_ERROR",
                message: cause instanceof Error ? cause.message : "Quick sim failed.",
              });
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {summary && <QuickSimPanel summary={summary} onDismiss={() => setSummary(undefined)} />}
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

/** Pre-match view: opponent, form, availability and the XI about to be sent out. */
const FixtureDetailPanel = ({
  fixtureId,
  busy,
  onClose,
  onQuickSim,
}: {
  fixtureId: EntityId;
  busy: boolean;
  onClose: () => void;
  onQuickSim: () => Promise<void>;
}): React.ReactElement => {
  const [state] = useRuntimeData(() => managerBridge.getFixture(fixtureId), [fixtureId]);
  return (
    <Panel
      title="Match preparation"
      actions={
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      }
    >
      <AsyncPanel state={state}>
        {(detail) => (
          <>
            <Metrics
              items={[
                { label: "Opponent", value: detail.fixture.opponent },
                { label: "Competition", value: detail.fixture.competition },
                { label: "Venue", value: detail.fixture.venue ?? "Unknown" },
                { label: "Date", value: detail.fixture.date },
                { label: "Home/Away", value: detail.fixture.homeAway },
                { label: "Available", value: detail.availableCount },
              ]}
            />
            <p>
              Our form: <FormRun form={detail.ownForm} /> · Their form:{" "}
              <FormRun form={detail.opponentForm} />
            </p>

            {detail.previousMeetings.length > 0 && (
              <>
                <h3>Previous meetings</h3>
                <ul>
                  {detail.previousMeetings.map((meeting) => (
                    <li key={`${meeting.date}-${meeting.score}`}>
                      {meeting.date} · {meeting.score} · {meeting.competition}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h3>Selected XI</h3>
            <ol className="xi-list">
              {detail.selectedXI.map((slot) => (
                <li key={slot.slotId}>
                  <strong>{slot.slotId}</strong> {slot.playerName ?? "— empty —"}{" "}
                  <span className="subtle">{slot.roleId.replace(/_/g, " ").toLowerCase()}</span>
                </li>
              ))}
            </ol>
            <p className="subtle">Bench: {detail.bench.join(", ") || "none named"}</p>

            {detail.unavailable.length > 0 && (
              <>
                <h3>Unavailable</h3>
                <ul>
                  {detail.unavailable.map((player) => (
                    <li key={player.personId}>
                      {player.name}{" "}
                      <Badge tone={availabilityTone(player.availability)}>
                        {player.availability.replace("_", " ").toLowerCase()}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {detail.warnings.length > 0 && (
              <div className="notice">
                {detail.warnings.map((warning) => (
                  <div key={warning}>
                    <Badge tone="warn">warning</Badge> {warning}
                  </div>
                ))}
              </div>
            )}

            {detail.fixture.status === "scheduled" && (
              <button
                className="primary"
                disabled={busy || !detail.selectionValid}
                onClick={() => void onQuickSim()}
              >
                {busy ? "Simulating…" : "Confirm XI and Quick Sim"}
              </button>
            )}
            {!detail.selectionValid && (
              <p className="subtle">Fix the selection errors on the Tactics screen first.</p>
            )}
          </>
        )}
      </AsyncPanel>
    </Panel>
  );
};

const QuickSimPanel = ({
  summary,
  onDismiss,
}: {
  summary: QuickSimSummary;
  onDismiss: () => void;
}): React.ReactElement => (
  <Panel
    title="Match result"
    actions={
      <button className="ghost" onClick={onDismiss}>
        Dismiss
      </button>
    }
  >
    <h2>
      {summary.homeTeam} {summary.score} {summary.awayTeam}
    </h2>
    <Metrics
      items={[
        { label: "Result", value: summary.result },
        { label: "Shots", value: `${summary.shots.home}-${summary.shots.away}` },
        {
          label: "On target",
          value: `${summary.shotsOnTarget.home}-${summary.shotsOnTarget.away}`,
        },
        { label: "xG", value: `${summary.xg.home}-${summary.xg.away}` },
        { label: "Attendance", value: summary.attendance ?? "Unknown" },
      ]}
    />
    <h3>Scorers</h3>
    {summary.scorers.length === 0 ? (
      <p className="empty-state">No goals.</p>
    ) : (
      <ul>
        {summary.scorers.map((scorer, index) => (
          <li key={`${scorer.playerName}-${index}`}>
            {scorer.minute}&rsquo; {scorer.playerName} ({scorer.teamName})
          </li>
        ))}
      </ul>
    )}
    {summary.cards.length > 0 && (
      <>
        <h3>Cards</h3>
        <ul>
          {summary.cards.map((card, index) => (
            <li key={`${card.playerName}-${index}`}>
              {card.minute}&rsquo; {card.playerName} — {card.type.replace(/_/g, " ").toLowerCase()}
            </li>
          ))}
        </ul>
      </>
    )}
    {summary.injuries.length > 0 && (
      <>
        <h3>Injuries</h3>
        <ul>
          {summary.injuries.map((injury, index) => (
            <li key={`${injury.playerName}-${index}`}>
              {injury.playerName} ({injury.minute}&rsquo;)
            </li>
          ))}
        </ul>
      </>
    )}
  </Panel>
);
