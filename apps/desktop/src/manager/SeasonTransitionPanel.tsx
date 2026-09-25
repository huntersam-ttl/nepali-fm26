import React, { useState } from "react";
import type { SeasonStatusView } from "@nepal-football-sim/shared-types";
import type { AppError, DesktopRuntimeApi } from "../appBridge.js";
import { ErrorBanner } from "./ui.js";

const STAGE_STATE_LABEL = { DONE: "Done", CURRENT: "In progress", PENDING: "Waiting", FAILED: "Failed" } as const;

/**
 * The finished season and the staged transition into the next one. Functional
 * only: what the season came to, a button to begin, and stage-by-stage progress.
 * The transition runs one stage per request, so the page is never frozen and
 * always says which stage it is on.
 */
export const SeasonTransitionPanel = ({
  status,
  bridge,
  onStatus,
  onFinished,
}: {
  status: SeasonStatusView;
  bridge: DesktopRuntimeApi;
  onStatus: (status: SeasonStatusView) => void;
  onFinished: () => void;
}): React.ReactElement | null => {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  if (status.phase === "IN_PROGRESS") return null;

  const run = async (): Promise<void> => {
    if (!bridge.advanceSeasonTransition) return;
    setRunning(true);
    setError(null);
    for (;;) {
      const step = await bridge.advanceSeasonTransition();
      if (!step.ok) {
        setError(step.error);
        break;
      }
      onStatus(step.data.seasonStatus);
      if (step.data.finished) {
        setRunning(false);
        onFinished();
        return;
      }
      if (step.data.seasonStatus.phase === "TRANSITION_FAILED") break;
    }
    setRunning(false);
  };

  const transition = status.transition;
  const failed = status.phase === "TRANSITION_FAILED";
  const inFlight = status.phase === "TRANSITIONING" || running;
  const summary = status.summary;

  return (
    <section className="panel season-transition" aria-labelledby="season-transition-title">
      <h2 id="season-transition-title">
        {status.phase === "COMPLETE" ? "Season complete" : failed ? "The new season could not be prepared" : "Preparing the new season"}
      </h2>
      {status.phase === "COMPLETE" && (
        <>
          <p>
            {status.seasonName ?? "The season"} has finished: all {status.competitions.total} competitions have played every
            fixture.
          </p>
          {summary && (
            <dl className="metrics">
              <div>
                <dt>Competition</dt>
                <dd>{summary.competition}</dd>
              </div>
              {summary.champion && (
                <div>
                  <dt>Champions</dt>
                  <dd>{summary.champion}</dd>
                </div>
              )}
              {summary.humanClubPosition !== undefined && summary.humanClub && (
                <div>
                  <dt>{summary.humanClub} finished</dt>
                  <dd>
                    {summary.humanClubPosition} of {summary.teams}
                  </dd>
                </div>
              )}
            </dl>
          )}
          <p className="subtle">
            Starting the new season closes this one: promotion and relegation, the transfer window, youth intake and
            retirement, finances, the federation and the international calendar.
          </p>
        </>
      )}
      {inFlight && transition && (
        <p role="status" aria-live="polite">
          Processing new season — {Math.min(transition.completedStages + 1, transition.totalStages)} of{" "}
          {transition.totalStages}: {transition.currentStageLabel ?? "Finishing"}
        </p>
      )}
      {inFlight && !transition && (
        <p role="status" aria-live="polite">
          Processing new season…
        </p>
      )}
      {failed && transition?.error && (
        <p className="warning" role="alert">
          {transition.currentStageLabel ?? "A stage"} failed: {transition.error}. Nothing from that stage was kept. You can try
          again.
        </p>
      )}
      {error && <ErrorBanner error={error} />}
      {status.phase !== "COMPLETE" && (
        <ol className="stage-list" aria-label="Season transition stages">
          {status.stages.map((stage) => (
            <li key={stage.key}>
              {stage.label} — {STAGE_STATE_LABEL[stage.state]}
              {stage.durationMs !== undefined ? ` (${(stage.durationMs / 1000).toFixed(1)} s)` : ""}
            </li>
          ))}
        </ol>
      )}
      <div className="button-row">
        <button className="primary" disabled={running} onClick={() => void run()}>
          {running ? "Working…" : failed ? "Try again" : status.phase === "TRANSITIONING" ? "Resume" : "Begin next season"}
        </button>
      </div>
    </section>
  );
};
